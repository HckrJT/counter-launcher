// Launcher extras: instance health check (missing / duplicate / wrong-version mods), jar security check against
// Modrinth, mod backup before updates, share codes for mod lists, disk and Java advice, settings export.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const store = require('./store');
const { getJson, postJson } = require('./http');

const dirOf = (inst, ...p) => path.join(store.dirs.instance(inst.id), ...p);
const sha1 = (file) => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');

/** every mod jar with its id, version, requirements (Fabric / Quilt / NeoForge / Forge) */
function readMods(inst) {
  const dir = dirOf(inst, 'mods');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!/\.jar(\.disabled)?$/.test(f)) continue;
    const mod = { file: f, enabled: !f.endsWith('.disabled'), id: '', name: f, version: '', depends: {}, provides: [], mc: '', broken: false };
    try {
      const zip = new AdmZip(path.join(dir, f));
      const text = (n) => zip.getEntry(n) && zip.readAsText(n);
      const fabric = text('fabric.mod.json');
      const quilt = text('quilt.mod.json');
      const toml = text('META-INF/neoforge.mods.toml') || text('META-INF/mods.toml');
      if (fabric) {
        const j = JSON.parse(fabric.replace(/[\u0000-\u001f]+/g, ' '));
        Object.assign(mod, { id: j.id, name: j.name || j.id, version: j.version, depends: j.depends || {}, provides: j.provides || [] });
        mod.mc = String(j.depends && j.depends.minecraft ? [].concat(j.depends.minecraft).join(' || ') : '');
        mod.loader = 'fabric';
      } else if (quilt) {
        const q = JSON.parse(quilt).quilt_loader || {};
        const deps = {};
        for (const d of q.depends || []) if (typeof d === 'string') deps[d] = '*'; else if (d.id && !d.optional) deps[d.id] = d.versions || '*';
        Object.assign(mod, { id: q.id, name: q.metadata?.name || q.id, version: q.version, depends: deps, loader: 'quilt' });
      } else if (toml) {
        const id = (/modId\s*=\s*"([^"]+)"/.exec(toml) || [])[1];
        const deps = {};
        const re = /\[\[dependencies\.[^\]]+\]\]([\s\S]*?)(?=\[\[|$)/g;
        let m;
        while ((m = re.exec(toml))) {
          const dep = (/modId\s*=\s*"([^"]+)"/.exec(m[1]) || [])[1];
          const type = (/type\s*=\s*"([^"]+)"/.exec(m[1]) || [])[1];
          const mandatory = /mandatory\s*=\s*true/.test(m[1]) || type === 'required';
          if (dep && mandatory && !['minecraft', 'neoforge', 'forge'].includes(dep)) deps[dep] = '*';
        }
        Object.assign(mod, { id, name: (/displayName\s*=\s*"([^"]*)"/.exec(toml) || [])[1] || id, version: (/\nversion\s*=\s*"([^"]*)"/.exec(toml) || [])[1], depends: deps, loader: 'forge' });
      }
    } catch {
      mod.broken = true;
    }
    out.push(mod);
  }
  return out;
}

const BUILTIN = new Set(['minecraft', 'java', 'fabricloader', 'fabric-loader', 'fabric', 'quilt_loader', 'neoforge', 'forge', 'mixinextras']);

/** does a Fabric style version range ("1.21.x", ">=1.21 <1.22", ["1.21.1","1.21.2"]) allow this Minecraft version? */
function mcAllowed(range, mc) {
  if (!range || range === '*') return true;
  return String(range).split('||').some((part) => {
    part = part.trim();
    if (!part || part === '*') return true;
    const tokens = part.split(/\s+/).filter(Boolean);
    return tokens.every((t) => {
      const m = /^(>=|<=|>|<|=|~|\^)?(.+)$/.exec(t);
      let [, op, v] = m;
      v = v.replace(/-[\w.]*$/, '');
      if (/x$|\*$/.test(v)) return mc.startsWith(v.replace(/\.?[x*]$/, ''));
      const cmp = compareVersions(mc, v);
      if (!op || op === '=') return cmp === 0 || (v.split('.').length < mc.split('.').length && mc.startsWith(v + '.'));
      if (op === '>=') return cmp >= 0;
      if (op === '>') return cmp > 0;
      if (op === '<=') return cmp <= 0;
      if (op === '<') return cmp < 0;
      if (op === '~') return mc.startsWith(v.split('.').slice(0, 2).join('.')) && cmp >= 0;
      if (op === '^') return mc.split('.')[0] === v.split('.')[0] && cmp >= 0;
      return true;
    });
  });
}
function compareVersions(a, b) {
  const pa = String(a).split(/[.\-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split(/[.\-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

/**
 * Looks at every mod of the instance without starting the game. Returns issues sorted by severity:
 * error = the game will very likely not start, warn = probably a problem, info = hint.
 */
function healthCheck(inst) {
  const mods = readMods(inst);
  const issues = [];
  const add = (level, title, detail, file) => issues.push({ level, title, detail, file });
  const active = mods.filter((m) => m.enabled);
  const ids = new Map();
  for (const m of active) {
    if (m.broken) add('error', `${m.file} ist beschädigt`, 'Die Datei lässt sich nicht lesen – neu herunterladen oder entfernen.', m.file);
    if (!m.id) continue;
    if (ids.has(m.id)) add('error', `Doppelt: ${m.name}`, `${ids.get(m.id)} und ${m.file} sind dieselbe Mod – eine davon entfernen.`, m.file);
    else ids.set(m.id, m.file);
    for (const p of m.provides || []) ids.set(typeof p === 'string' ? p : p.id, m.file);
  }
  const fabricApiMissing = [];
  for (const m of active) {
    for (const dep of Object.keys(m.depends || {})) {
      if (BUILTIN.has(dep) || ids.has(dep)) continue;
      // every part of the Fabric API (fabric-block-getter-api-v2 …) is one install: report it once
      if (/^fabric-/.test(dep) && inst.loader !== 'forge' && inst.loader !== 'neoforge') {
        // the parts of the Fabric API sit inside the Fabric API jar itself
        if (ids.has('fabric-api') || ids.has('fabric')) continue;
        if (!fabricApiMissing.includes(m.name)) fabricApiMissing.push(m.name);
        continue;
      }
      const off = mods.find((x) => !x.enabled && x.id === dep);
      add('error', `${m.name} braucht „${dep}“`, off ? `„${dep}“ ist installiert, aber ausgeschaltet (${off.file}) – einschalten.` : `„${dep}“ fehlt. Über „Inhalte hinzufügen“ installieren${dep === 'fabric-api' ? ' (Fabric API)' : ''}.`, m.file);
    }
    if (m.mc && inst.mcVersion && !mcAllowed(m.mc, inst.mcVersion)) add('error', `${m.name} passt nicht zu ${inst.mcVersion}`, `Die Mod verlangt Minecraft ${m.mc}. Passende Version suchen oder entfernen.`, m.file);
    if (m.loader && inst.loader && inst.loader !== 'vanilla' && m.loader !== inst.loader && !(inst.loader === 'neoforge' && m.loader === 'forge') && !(inst.loader === 'quilt' && m.loader === 'fabric'))
      add('error', `${m.name} ist für ${m.loader}, die Instanz nutzt ${inst.loader}`, 'Falscher Mod-Loader – die Mod wird nicht geladen.', m.file);
  }
  const apiOff = mods.find((x) => !x.enabled && x.id === 'fabric-api');
  if (fabricApiMissing.length) add('error', 'Fabric API fehlt', `${fabricApiMissing.slice(0, 4).join(', ')}${fabricApiMissing.length > 4 ? ' u. a.' : ''} brauchen die Fabric API. ${apiOff ? 'Sie ist installiert, aber ausgeschaltet – einschalten.' : 'Über „Entdecken“ installieren (Modrinth: Fabric API).'}`, apiOff && apiOff.file);
  else if (inst.loader === 'fabric' && active.length && !ids.has('fabric-api') && !ids.has('fabric')) add('warn', 'Fabric API fehlt', 'Die meisten Fabric-Mods brauchen die Fabric API.');
  const sodiumLike = active.filter((m) => ['sodium', 'embeddium', 'rubidium'].includes(m.id));
  if (sodiumLike.length > 1) add('warn', 'Mehrere Render-Mods', `${sodiumLike.map((m) => m.name).join(' + ')} stören sich gegenseitig.`);
  if (active.length > 150) add('info', `${active.length} Mods aktiv`, 'Das ist viel – Start dauert länger und braucht mehr RAM (mind. 6 GB).');
  const ramGb = (store.get().settings.ramMb || 4096) / 1024;
  if (active.length > 60 && ramGb < 4) add('warn', 'Wenig RAM für viele Mods', `Nur ${ramGb} GB zugewiesen – in den Einstellungen mehr geben.`);
  const rank = { error: 0, warn: 1, info: 2 };
  issues.sort((a, b) => rank[a.level] - rank[b.level]);
  return { mods: active.length, off: mods.length - active.length, issues };
}

/** asks Modrinth whether each jar is a known file; unknown ones are not necessarily bad, but worth a look */
async function securityCheck(inst) {
  const dir = dirOf(inst, 'mods');
  if (!fs.existsSync(dir)) return { known: [], unknown: [] };
  const files = fs.readdirSync(dir).filter((f) => /\.jar(\.disabled)?$/.test(f));
  const byHash = {};
  for (const f of files) byHash[sha1(path.join(dir, f))] = f;
  const known = [];
  const found = Object.keys(byHash).length ? await postJson('https://api.modrinth.com/v2/version_files', { hashes: Object.keys(byHash), algorithm: 'sha1' }) : {};
  for (const [h, v] of Object.entries(found)) known.push({ file: byHash[h], project: v.project_id, version: v.version_number });
  const unknown = files.filter((f) => !known.some((k) => k.file === f)).map((f) => {
    const flags = [];
    try {
      const zip = new AdmZip(path.join(dir, f));
      const names = zip.getEntries().map((e) => e.entryName);
      if (names.some((n) => /(^|\/)(\.\.|[a-z]:)/i.test(n))) flags.push('Pfad außerhalb der Datei');
      if (names.some((n) => /\.(exe|bat|cmd|ps1|vbs|scr|dll)$/i.test(n))) flags.push('enthält ausführbare Dateien (.exe/.bat/.dll …)');
      if (names.some((n) => /(^|\/)(discord|webhook)/i.test(n))) flags.push('Dateiname deutet auf Discord/Webhook');
    } catch {
      flags.push('nicht lesbar');
    }
    return { file: f, flags };
  });
  return { known, unknown, total: files.length };
}

/** copies the mods folder before updates / mass changes; keeps the newest 5 */
function backupMods(inst, reason = 'update') {
  const src = dirOf(inst, 'mods');
  if (!fs.existsSync(src)) return null;
  const root = path.join(store.dirs.root, 'backups', inst.id, 'mods');
  fs.mkdirSync(root, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const dest = path.join(root, `${stamp}-${reason}`);
  fs.mkdirSync(dest);
  for (const f of fs.readdirSync(src)) {
    const p = path.join(src, f);
    if (fs.statSync(p).isFile()) fs.copyFileSync(p, path.join(dest, f));
  }
  const all = fs.readdirSync(root).sort();
  for (const old of all.slice(0, Math.max(0, all.length - 5))) fs.rmSync(path.join(root, old), { recursive: true, force: true });
  return path.basename(dest);
}
function listModBackups(inst) {
  const root = path.join(store.dirs.root, 'backups', inst.id, 'mods');
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).sort().reverse().map((n) => ({ name: n, files: fs.readdirSync(path.join(root, n)).length }));
}
function restoreModBackup(inst, name) {
  if (path.basename(name) !== name) throw new Error('Ungültiger Name');
  const src = path.join(store.dirs.root, 'backups', inst.id, 'mods', name);
  if (!fs.existsSync(src)) throw new Error('Backup nicht gefunden');
  backupMods(inst, 'vor-wiederherstellung');
  const dest = dirOf(inst, 'mods');
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(dest)) if (/\.jar(\.disabled)?$/.test(f)) fs.rmSync(path.join(dest, f));
  for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(dest, f));
  return fs.readdirSync(src).length;
}

/** share code: Minecraft version, loader and the Modrinth projects of the mods (the receiver downloads fresh files) */
async function shareCode(inst) {
  const dir = dirOf(inst, 'mods');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.jar')) : [];
  const byHash = {};
  for (const f of files) byHash[sha1(path.join(dir, f))] = f;
  const found = Object.keys(byHash).length ? await postJson('https://api.modrinth.com/v2/version_files', { hashes: Object.keys(byHash), algorithm: 'sha1' }) : {};
  const projects = [...new Set(Object.values(found).map((v) => v.project_id))];
  const own = files.filter((f) => !Object.values(found).some((v) => v.files.some((x) => x.filename === f)));
  const payload = { v: 1, n: inst.name, mc: inst.mcVersion, l: inst.loader, c: inst.counter ? 1 : 0, p: projects };
  return { code: 'CNTR1.' + Buffer.from(JSON.stringify(payload)).toString('base64url'), mods: projects.length, skipped: own };
}
function parseShareCode(code) {
  const m = /^\s*CNTR1\.([\w-]+)\s*$/.exec(code || '');
  if (!m) throw new Error('Das ist kein gültiger Counter-Code (beginnt mit CNTR1.)');
  const j = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
  if (!j.mc || !Array.isArray(j.p) || j.p.length > 300) throw new Error('Der Code ist beschädigt');
  return { name: String(j.n || 'Geteilte Instanz').slice(0, 40), mcVersion: String(j.mc), loader: String(j.l || 'fabric'), counter: !!j.c, projects: j.p.filter((x) => /^[\w-]{4,16}$/.test(x)) };
}

/** size of the instance parts, biggest first */
function diskUsage(inst) {
  const size = (p) => {
    let n = 0;
    try {
      const st = fs.statSync(p);
      if (st.isFile()) return st.size;
      for (const f of fs.readdirSync(p)) n += size(path.join(p, f));
    } catch {}
    return n;
  };
  const root = store.dirs.instance(inst.id);
  const parts = [];
  if (!fs.existsSync(root)) return { total: 0, parts };
  for (const f of fs.readdirSync(root)) parts.push({ name: f, size: size(path.join(root, f)) });
  parts.sort((a, b) => b.size - a.size);
  return { total: parts.reduce((s, p) => s + p.size, 0), parts: parts.slice(0, 12) };
}

/** RAM / Java advice from the PC and the number of mods */
function javaAdvice(inst) {
  const totalGb = os.totalmem() / 1073741824;
  const mods = readMods(inst).filter((m) => m.enabled).length;
  let want = mods > 200 ? 8 : mods > 100 ? 6 : mods > 40 ? 4 : 3;
  if (inst.loader === 'vanilla') want = 3;
  const cap = Math.max(2, Math.floor(totalGb / 2));
  const rec = Math.min(want, cap);
  const cur = (store.get().settings.ramMb || 4096) / 1024;
  const javaMajor = /^(26|1\.2[1-9])/.test(inst.mcVersion) ? 21 : /^1\.20\.[5-9]|^1\.21/.test(inst.mcVersion) ? 21 : /^1\.1[7-9]|^1\.20/.test(inst.mcVersion) ? 17 : 8;
  return {
    pcRamGb: Math.round(totalGb * 10) / 10, cpus: os.cpus().length, mods, currentGb: cur, recommendedGb: rec, javaMajor,
    flags: '-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M',
    note: cur > cap ? `Du hast ${cur} GB zugewiesen, dein PC hat nur ${Math.round(totalGb)} GB – das macht das Spiel eher langsamer.` : cur < rec ? `Für ${mods} Mods sind ${rec} GB besser.` : 'Die RAM-Einstellung passt.',
  };
}

/** all update checks in one go for the home page / weekly overview */
async function updateOverview(instances, checkUpdates) {
  const rows = [];
  for (const inst of instances.slice(0, 12)) {
    try {
      const u = await checkUpdates(inst);
      if (u.length) rows.push({ id: inst.id, name: inst.name, updates: u.map((x) => ({ name: x.name, version: x.version })) });
    } catch {}
  }
  return rows;
}

function exportSettings() {
  const s = store.get();
  const { azureClientId, curseforgeKey, groqKey, ...settings } = s.settings;
  return JSON.stringify({ counterSettings: 1, settings, instances: s.instances.map(({ id, name, mcVersion, loader, counter, icon }) => ({ id, name, mcVersion, loader, counter, icon })) }, null, 2);
}
function importSettings(text) {
  const j = JSON.parse(text);
  if (!j.counterSettings || !j.settings) throw new Error('Das ist keine Counter-Einstellungsdatei');
  const keep = ['groqKey', 'curseforgeKey', 'azureClientId', 'javaPath'];
  const cur = store.get().settings;
  const next = { ...cur, ...j.settings };
  for (const k of keep) next[k] = cur[k];
  store.get().settings = next;
  store.save();
  return Object.keys(j.settings).length;
}

// ---------------------------------------------------------------- mod profiles, mass switch, version upgrade

const modsDir = (inst) => dirOf(inst, 'mods');
function listProfiles(inst) {
  return Object.entries(inst.profiles || {}).map(([name, files]) => ({ name, mods: files.length }));
}
/** a profile = which mod files are switched on right now */
function saveProfile(inst, name) {
  name = String(name || '').trim().slice(0, 30);
  if (!name) throw new Error('Name fehlt');
  const on = readMods(inst).filter((m) => m.enabled).map((m) => m.file);
  (inst.profiles ||= {})[name] = on;
  store.save();
  return on.length;
}
function applyProfile(inst, name) {
  const want = new Set((inst.profiles || {})[name] || []);
  if (!want.size && !(inst.profiles || {})[name]) throw new Error('Profil nicht gefunden');
  backupMods(inst, 'vor-profil');
  let changed = 0;
  for (const m of readMods(inst)) {
    const base = m.file.replace(/\.disabled$/, '');
    const shouldBeOn = want.has(base);
    if (shouldBeOn && !m.enabled) fs.renameSync(path.join(modsDir(inst), m.file), path.join(modsDir(inst), base)), changed++;
    else if (!shouldBeOn && m.enabled) fs.renameSync(path.join(modsDir(inst), m.file), path.join(modsDir(inst), m.file + '.disabled')), changed++;
  }
  return changed;
}
function deleteProfile(inst, name) {
  if (inst.profiles) delete inst.profiles[name];
  store.save();
}
/** all mods on / off at once; the Fabric API and the loader helpers stay on when switching off */
function massToggle(inst, enabled) {
  backupMods(inst, 'massenaktion');
  let n = 0;
  for (const m of readMods(inst)) {
    if (m.enabled === enabled) continue;
    if (!enabled && /^(fabric-api|fabric|quilted-fabric-api|qsl)$/.test(m.id || '')) continue;
    const from = path.join(modsDir(inst), m.file);
    fs.renameSync(from, enabled ? from.replace(/\.disabled$/, '') : from + '.disabled');
    n++;
  }
  return n;
}
/**
 * Switches the instance to another Minecraft version: mods that have a build for it are updated, the others are
 * switched off (not deleted) and listed. The old state is backed up first.
 */
async function upgradeInstance(inst, newVersion, checkUpdates, applyUpdates) {
  newVersion = String(newVersion || '').trim();
  if (!/^[\w.\-]{3,20}$/.test(newVersion)) throw new Error('Ungültige Version');
  backupMods(inst, 'vor-versionswechsel');
  const target = { ...inst, mcVersion: newVersion };
  const updates = await checkUpdates(target);
  const done = updates.length ? await applyUpdates(target, updates) : 0;
  const fitted = new Set(updates.map((u) => u.newFile));
  const disabled = [];
  const unknown = [];
  const mods = readMods({ ...inst });
  for (const m of mods) {
    if (!m.enabled || fitted.has(m.file)) continue;
    const fits = m.mc && mcAllowed(m.mc, newVersion);
    if (fits) continue;
    if (m.mc || (m.loader && inst.loader !== 'vanilla')) {
      fs.renameSync(path.join(modsDir(inst), m.file), path.join(modsDir(inst), m.file + '.disabled'));
      disabled.push(m.name);
    } else unknown.push(m.name);
  }
  inst.mcVersion = newVersion;
  inst.loaderVersion = '';
  store.save();
  return { updated: done, disabled, unknown };
}

// ---------------------------------------------------------------- parental limit
const todayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
/** minutes played today over all instances (finished sessions plus running ones) */
function playedTodayMin(instances, runningSince = []) {
  const t0 = todayStart();
  const now = Date.now();
  let ms = 0;
  for (const i of instances) for (const s of i.sessions || []) ms += Math.max(0, Math.min(s.end, now) - Math.max(s.start, t0));
  for (const since of runningSince) ms += Math.max(0, now - Math.max(since, t0));
  return Math.round(ms / 60000);
}
const hashPin = (pin) => crypto.createHash('sha256').update('counter-pin:' + String(pin)).digest('hex');
function parentStatus(settings, instances) {
  const p = settings.parent || {};
  const bonus = p.bonus && p.bonus.day === todayStart() ? p.bonus.min : 0;
  const limit = p.limitMin ? p.limitMin + bonus : 0;
  const played = playedTodayMin(instances);
  return { enabled: !!p.limitMin, limitMin: p.limitMin || 0, bonus, played, left: limit ? Math.max(0, limit - played) : null, blocked: !!limit && played >= limit };
}
function parentSet(settings, limitMin, pin) {
  limitMin = Math.max(0, Math.min(720, Number(limitMin) || 0));
  const cur = settings.parent || {};
  if (cur.pin && hashPin(pin) !== cur.pin) throw new Error('Falsche PIN');
  if (limitMin && !/^\d{4,8}$/.test(String(pin))) throw new Error('Die PIN braucht 4–8 Ziffern');
  settings.parent = limitMin ? { limitMin, pin: cur.pin || hashPin(pin), bonus: cur.bonus } : {};
  store.save();
}
function parentExtend(settings, pin, minutes) {
  const p = settings.parent;
  if (!p || !p.pin) throw new Error('Kein Limit gesetzt');
  if (hashPin(pin) !== p.pin) throw new Error('Falsche PIN');
  p.bonus = { day: todayStart(), min: (p.bonus && p.bonus.day === todayStart() ? p.bonus.min : 0) + Math.max(5, Math.min(240, Number(minutes) || 30)) };
  store.save();
}

// ---------------------------------------------------------------- theme codes
function themeCode(settings) {
  const { accent, theme } = settings;
  return 'CNTRT1.' + Buffer.from(JSON.stringify({ a: accent, t: theme || {} })).toString('base64url');
}
function applyThemeCode(settings, code) {
  const m = /^\s*CNTRT1\.([\w-]+)\s*$/.exec(code || '');
  if (!m) throw new Error('Das ist kein Design-Code (beginnt mit CNTRT1.)');
  const j = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
  const hex = (x) => typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x);
  const t = {};
  for (const [k, v] of Object.entries(j.t || {})) {
    if (['accent2', 'solid', 'cubeColor'].includes(k)) { if (hex(v) || k === 'cubeColor') t[k] = v; }
    else if (['bg', 'layout', 'style', 'font2', 'skinAnim', 'launchStyle'].includes(k)) t[k] = String(v).slice(0, 20).replace(/[^\w-]/g, '');
    else if (typeof v === 'number' && Math.abs(v) < 1000) t[k] = v;
    else if (typeof v === 'boolean') t[k] = v;
  }
  settings.theme = { ...(settings.theme || {}), ...t };
  if (hex(j.a)) settings.accent = j.a;
  store.save();
  return Object.keys(t).length;
}

module.exports = { listProfiles, saveProfile, applyProfile, deleteProfile, massToggle, upgradeInstance, playedTodayMin, parentStatus, parentSet, parentExtend, themeCode, applyThemeCode, readMods, healthCheck, securityCheck, backupMods, listModBackups, restoreModBackup, shareCode, parseShareCode, diskUsage, javaAdvice, updateOverview, exportSettings, importSettings, mcAllowed };
