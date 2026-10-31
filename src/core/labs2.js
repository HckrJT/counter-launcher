// More launcher extras: PC check (GPU driver age), duplicate mods across instances (hard links save space),
// dependency tree, collections (named share codes), world copy between instances, desktop shortcut.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const store = require('./store');
const labs = require('./labs');

const dirOf = (inst, ...p) => path.join(store.dirs.instance(inst.id), ...p);

function ps(command) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { timeout: 15000, windowsHide: true }, (err, out) => resolve(err ? '' : String(out)));
  });
}

/** graphics card, driver age, CPU, RAM: old drivers are a common reason for crashes and low FPS */
async function pcCheck() {
  const out = { os: `${os.type()} ${os.release()}`, cpu: (os.cpus()[0] || {}).model || '?', cores: os.cpus().length, ramGb: Math.round(os.totalmem() / 1073741824 * 10) / 10, freeRamGb: Math.round(os.freemem() / 1073741824 * 10) / 10, gpus: [], notes: [] };
  if (process.platform === 'win32') {
    const raw = await ps("Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,@{n='DriverDate';e={if($_.DriverDate){$_.DriverDate.ToString('yyyy-MM-dd')}}},AdapterRAM | ConvertTo-Json -Compress");
    try {
      const j = JSON.parse(raw || '[]');
      for (const g of [].concat(j)) {
        const age = g.DriverDate ? Math.floor((Date.now() - new Date(g.DriverDate).getTime()) / 86400000) : null;
        out.gpus.push({ name: g.Name, driver: g.DriverVersion, date: g.DriverDate, ageDays: age, vendor: /nvidia/i.test(g.Name) ? 'nvidia' : /amd|radeon/i.test(g.Name) ? 'amd' : /intel/i.test(g.Name) ? 'intel' : '' });
      }
    } catch {
      out.notes.push('Grafikkarte konnte nicht gelesen werden.');
    }
  }
  for (const g of out.gpus) {
    if (g.ageDays != null && g.ageDays > 365 && !/Microsoft Basic|Remote/i.test(g.name)) out.notes.push(`Der Treiber von „${g.name}“ ist ${Math.floor(g.ageDays / 30)} Monate alt – ein neuer Treiber behebt oft Abstürze und bringt FPS.`);
    if (/Microsoft Basic/i.test(g.name)) out.notes.push('Windows nutzt nur den Basis-Grafiktreiber – ohne richtigen Treiber ist Minecraft sehr langsam.');
  }
  if (out.ramGb < 8) out.notes.push('Weniger als 8 GB RAM: nutze am besten nur Performance-Mods und höchstens 3 GB für Minecraft.');
  if (out.freeRamGb < 2) out.notes.push('Gerade ist kaum freier Arbeitsspeicher da – schließe andere Programme vor dem Spielen.');
  return out;
}

/** identical mod files in different instances: how much space hard links would save */
function duplicates() {
  const bySha = new Map();
  for (const inst of store.get().instances) {
    const dir = dirOf(inst, 'mods');
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!/\.jar(\.disabled)?$/.test(f)) continue;
      const file = path.join(dir, f);
      let st;
      try {
        st = fs.statSync(file);
      } catch {
        continue;
      }
      if (!st.isFile() || st.size < 4096) continue;
      const sha = crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
      const list = bySha.get(sha) || [];
      list.push({ file, inst: inst.name, size: st.size, ino: st.ino, dev: st.dev });
      bySha.set(sha, list);
    }
  }
  const groups = [];
  let wasted = 0;
  for (const [sha, list] of bySha) {
    // files that already share one inode (hard links) do not cost space twice
    const distinct = new Map(list.map((x) => [`${x.dev}:${x.ino}`, x]));
    if (distinct.size < 2) continue;
    wasted += (distinct.size - 1) * list[0].size;
    groups.push({ sha, name: path.basename(list[0].file), copies: distinct.size, size: list[0].size, instances: [...new Set(list.map((x) => x.inst))] });
  }
  groups.sort((a, b) => b.size * b.copies - a.size * a.copies);
  return { groups: groups.slice(0, 40), total: groups.length, wasted };
}
/** replaces the extra copies by hard links to one file (same drive only); the files stay usable everywhere */
function dedupe() {
  const bySha = new Map();
  for (const inst of store.get().instances) {
    const dir = dirOf(inst, 'mods');
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!/\.jar(\.disabled)?$/.test(f)) continue;
      const file = path.join(dir, f);
      try {
        const st = fs.statSync(file);
        if (!st.isFile() || st.size < 4096) continue;
        const sha = crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex') + path.extname(f);
        (bySha.get(sha) || bySha.set(sha, []).get(sha)).push({ file, ino: st.ino, dev: st.dev, size: st.size });
      } catch {}
    }
  }
  let linked = 0, saved = 0, failed = 0;
  for (const list of bySha.values()) {
    const first = list[0];
    for (const x of list.slice(1)) {
      if (x.ino === first.ino && x.dev === first.dev) continue;
      const tmp = x.file + '.linktmp';
      try {
        fs.linkSync(first.file, tmp);
        fs.renameSync(tmp, x.file);
        linked++;
        saved += x.size;
      } catch {
        failed++;
        try {
          fs.rmSync(tmp, { force: true });
        } catch {}
      }
    }
  }
  return { linked, saved, failed };
}

/** which mod needs which other mods, and whether they are there */
function depTree(inst) {
  const mods = labs.readMods(inst).filter((m) => m.enabled && m.id);
  const ids = new Set(mods.flatMap((m) => [m.id, ...(m.provides || []).map((p) => (typeof p === 'string' ? p : p.id))]));
  const skip = new Set(['minecraft', 'java', 'fabricloader', 'fabric-loader', 'quilt_loader', 'neoforge', 'forge', 'mixinextras']);
  const nodes = mods.map((m) => ({
    name: m.name, id: m.id,
    needs: Object.keys(m.depends || {}).filter((d) => !skip.has(d)).map((d) => ({ id: d, present: ids.has(d) || (/^fabric-/.test(d) && ids.has('fabric-api')) })),
  }));
  const needed = new Map();
  for (const n of nodes) for (const d of n.needs) needed.set(d.id, (needed.get(d.id) || 0) + 1);
  return { nodes: nodes.sort((a, b) => b.needs.length - a.needs.length), mostNeeded: [...needed.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5) };
}

// ---------------------------------------------------------------- collections: named share codes
function listCollections() {
  return Object.entries(store.get().settings.collections || {}).map(([name, c]) => ({ name, mods: c.mods, mc: c.mc, loader: c.loader }));
}
async function saveCollection(inst, name) {
  name = String(name || '').trim().slice(0, 40);
  if (!name) throw new Error('Name fehlt');
  const r = await labs.shareCode(inst);
  const s = store.get().settings;
  s.collections = { ...(s.collections || {}), [name]: { code: r.code, mods: r.mods, mc: inst.mcVersion, loader: inst.loader } };
  store.save();
  return r.mods;
}
function collectionCode(name) {
  const c = (store.get().settings.collections || {})[name];
  if (!c) throw new Error('Sammlung nicht gefunden');
  return c.code;
}
function deleteCollection(name) {
  const s = store.get().settings;
  if (s.collections) delete s.collections[name];
  store.save();
}

// ---------------------------------------------------------------- worlds and shortcuts
const { copyRecursive } = require('./importers');
/** copies a world into another instance (never overwrites: a free name is chosen) */
function copyWorld(src, world, dst) {
  if (path.basename(world) !== world) throw new Error('Ungültiger Weltname');
  const from = dirOf(src, 'saves', world);
  if (!fs.existsSync(path.join(from, 'level.dat'))) throw new Error('Welt nicht gefunden');
  const savesDir = dirOf(dst, 'saves');
  fs.mkdirSync(savesDir, { recursive: true });
  let name = world;
  let n = 2;
  while (fs.existsSync(path.join(savesDir, name))) name = `${world} (${n++})`;
  copyRecursive(from, path.join(savesDir, name));
  return name;
}
/** desktop shortcut that starts the launcher and the instance right away (installed launcher only) */
async function desktopShortcut(inst, exePath) {
  if (process.platform !== 'win32') throw new Error('Verknüpfungen gibt es nur unter Windows');
  if (!/Counter Launcher/i.test(exePath)) throw new Error('Das geht nur mit dem installierten Launcher, nicht in der Entwicklung');
  const desktop = path.join(os.homedir(), 'Desktop');
  const name = inst.name.replace(/[\\/:*?"<>|]/g, '_');
  const lnk = path.join(desktop, `${name} (Counter).lnk`);
  const cmd = `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${lnk.replace(/'/g, "''")}');$s.TargetPath='${exePath.replace(/'/g, "''")}';$s.Arguments='--play=${inst.id}';$s.Description='${name.replace(/'/g, "''")} starten';$s.Save()`;
  await ps(cmd);
  if (!fs.existsSync(lnk)) throw new Error('Verknüpfung konnte nicht erstellt werden');
  return lnk;
}

module.exports = { pcCheck, duplicates, dedupe, depTree, listCollections, saveCollection, collectionCode, deleteCollection, copyWorld, desktopShortcut };
