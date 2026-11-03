// Imports instances, mods and settings from other launchers and .mrpack / .noriskpack / Prism export files.
// Copying runs asynchronously (fs.promises.cp) so the window never freezes, even for big modpacks with worlds.
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const AdmZip = require('adm-zip');
const { download, downloadAll } = require('./http');
const store = require('./store');

const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const home = os.homedir();

/** folders / files that are copied from a source game directory */
const GROUPS = {
  mods: ['mods'],
  settings: ['options.txt', 'optionsof.txt', 'optionsshaders.txt', 'servers.dat', 'hotbar.nbt', 'counter'],
  config: ['config', 'defaultconfigs'],
  resourcepacks: ['resourcepacks'],
  shaderpacks: ['shaderpacks'],
  saves: ['saves'],
  screenshots: ['screenshots'],
};
/** worlds and screenshots are often gigabytes: only on request */
const DEFAULT_PARTS = ['mods', 'settings', 'config', 'resourcepacks', 'shaderpacks'];
const LOADERS = ['fabric', 'quilt', 'neoforge', 'forge', 'vanilla'];
/** never worth taking over from an export: logs, caches, crash reports and the other launcher's own client data */
const JUNK = new Set(['logs', 'crash-reports', 'debug', 'downloads', 'cache', '.cache', '.mixin.out', '.fabric', '.replay_cache', 'usercache.json', 'usernamecache.json',
  'command_history.txt', 'debug-profile.json', 'export.log', 'servers.dat_old', 'noriskclient', 'noriskclientlauncher']);

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function guessVersion(name) {
  const m = /(\d+\.\d+(?:\.\d+)?)/.exec(name || '');
  return m ? m[1] : '';
}

function guessLoader(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('neoforge')) return 'neoforge';
  if (n.includes('forge')) return 'forge';
  if (n.includes('quilt')) return 'quilt';
  return 'fabric';
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

const hasSettings = (dir) => exists(path.join(dir, 'options.txt')) || exists(path.join(dir, 'servers.dat'));
/** short note for the list what will come along, so a missing servers.dat is visible before importing */
const what = (dir) => [exists(path.join(dir, 'options.txt')) && 'Einstellungen', exists(path.join(dir, 'servers.dat')) && 'Server'].filter(Boolean).join(' + ') || 'keine Einstellungen gefunden';

// ---------------------------------------------------------------- NoRiskClient (V3 launcher)

/** mods NRC downloads itself (it keeps them outside the profile folder); switched off ones stay off */
const nrcMods = (p) => (p.mods || []).filter((m) => m.source?.download_url).map((m) => ({
  url: m.source.download_url, file: (m.source.file_name || path.basename(decodeURIComponent(m.source.download_url))) + (m.enabled === false ? '.disabled' : ''), sha1: m.source.file_hash_sha1,
}));
const nrcLoaderVersion = (v) => (/\d+(?:\.\d+)+/.exec(v || '') || [''])[0];

/**
 * NRC used to keep its profiles in profiles.json; newer versions moved them into meta/app.db (SQLite, not readable
 * here) and only leave profiles.json.migrated behind. So the folders in data/profiles are the source of truth and the
 * old list only adds version, loader and mod list where it still matches. Profiles with "shared Minecraft folder"
 * keep options and servers in data/profiles/groups/<group>.
 */
function scanNrc(found) {
  const base = path.join(appData, 'norisk', 'NoRiskClientV3');
  const profilesDir = path.join(base, 'data', 'profiles');
  if (!exists(profilesDir)) return;
  const list = readJson(path.join(base, 'profiles.json')) || readJson(path.join(base, 'profiles.json.migrated'));
  const meta = Array.isArray(list) ? list : list && typeof list === 'object' ? Object.values(list.profiles || list) : [];
  const seen = new Set();
  const add = (p, dir, name) => {
    // NRC's own standard profiles share one folder per kind: list each folder once
    if (seen.has(dir.toLowerCase())) return;
    seen.add(dir.toLowerCase());
    const group = path.join(profilesDir, 'groups', p?.group || 'main');
    const settingsDir = !hasSettings(dir) && p?.use_shared_minecraft_folder !== false && hasSettings(group) ? group : dir;
    const mods = p ? nrcMods(p) : [];
    const mcVersion = p?.game_version || guessVersion(name);
    const loader = LOADERS.includes(p?.loader) ? p.loader : guessLoader(name);
    found.push({
      source: 'NoRiskClient', name, dir, shared: settingsDir === dir ? null : settingsDir, mcVersion, loader, loaderVersion: nrcLoaderVersion(p?.loader_version), mods,
      detail: `${mcVersion || '?'} · ${loader} · ${p ? `${mods.length} Mods` : 'alle Mods nur über den NRC-Export'} · ${what(settingsDir)}`,
    });
  };
  const usable = (dir) => dir && exists(dir) && fs.readdirSync(dir).length;
  for (const p of meta) {
    if (!p || !p.name || /^noriskclient\//.test(p.path || '')) continue;
    const dir = [path.join(profilesDir, ...(p.path || p.name).split('/')), path.join(profilesDir, p.name)].find(usable);
    if (dir) add(p, dir, p.name);
  }
  // profiles that only exist in NRC's database: take the folder as it is
  for (const n of fs.readdirSync(profilesDir)) {
    const dir = path.join(profilesDir, n);
    if (['groups', 'noriskclient'].includes(n.toLowerCase()) || !fs.statSync(dir).isDirectory()) continue;
    if (hasSettings(dir) || exists(path.join(dir, 'mods'))) add(null, dir, n);
  }
  // NRC's standard profiles (one folder for all versions of a kind, e.g. "new"): the version has to be entered
  const std = path.join(profilesDir, 'noriskclient');
  if (exists(std)) {
    for (const n of fs.readdirSync(std)) {
      const dir = path.join(std, n);
      if (!hasSettings(dir)) continue;
      const versions = [...new Set(meta.filter((p) => p && p.path === `noriskclient/${n}`).map((p) => p.game_version).filter(Boolean))];
      add({ game_version: versions.length === 1 ? versions[0] : '', loader: 'fabric', use_shared_minecraft_folder: false }, dir, `NRC Standard (${n})`);
    }
  }
}

// ---------------------------------------------------------------- Lunar / Feather (no instances of their own)

/** Lunar: one folder per main version with options, servers, packs and shaders; your own mods per Fabric version */
function scanLunar(found) {
  const base = path.join(home, '.lunarclient', 'profiles');
  if (!exists(base)) return;
  for (const major of fs.readdirSync(base)) {
    const dir = path.join(base, major);
    if (!fs.statSync(dir).isDirectory() || !hasSettings(dir)) continue;
    const modsRoot = path.join(dir, 'mods');
    const jars = (n) => fs.readdirSync(path.join(modsRoot, n)).filter((f) => f.endsWith('.jar')).length;
    const modDirs = exists(modsRoot) ? fs.readdirSync(modsRoot).filter((n) => /^fabric-/.test(n) && jars(n)) : [];
    for (const m of modDirs.length ? modDirs : [null]) {
      const mcVersion = m ? m.replace(/^fabric-/, '') : guessVersion(major);
      found.push({
        source: 'Lunar Client', name: `Lunar ${mcVersion}`, dir, modsDir: m ? path.join(modsRoot, m) : null, rename: { shaderpacks: 'shaders' },
        mcVersion, loader: 'fabric', detail: `${mcVersion} · ${m ? jars(m) : 0} eigene Mods · ${what(dir)}`,
      });
    }
  }
}

/** Feather plays in .minecraft (options, servers, packs); your own mods are in .feather/user-mods/<version>-fabric */
function scanFeather(found) {
  const base = path.join(appData, '.feather', 'user-mods');
  const mc = path.join(appData, '.minecraft');
  if (!exists(base)) return;
  for (const n of fs.readdirSync(base)) {
    const modsDir = path.join(base, n);
    if (!fs.statSync(modsDir).isDirectory()) continue;
    const jars = fs.readdirSync(modsDir).filter((f) => f.endsWith('.jar')).length;
    const mcVersion = guessVersion(n);
    found.push({ source: 'Feather', name: `Feather ${mcVersion || n}`, dir: mc, modsDir, mcVersion, loader: 'fabric', detail: `${mcVersion || '?'} · ${jars} eigene Mods · ${what(mc)} aus .minecraft` });
  }
}

function scan() {
  const found = [];
  scanNrc(found);
  // Modrinth App
  const mr = path.join(appData, 'ModrinthApp', 'profiles');
  if (exists(mr)) {
    for (const n of fs.readdirSync(mr)) {
      const dir = path.join(mr, n);
      if (fs.statSync(dir).isDirectory()) found.push({ source: 'Modrinth App', name: n, dir, mcVersion: guessVersion(n), loader: guessLoader(n), detail: `${dir} · ${what(dir)}` });
    }
  }
  // CurseForge
  const cf = path.join(home, 'curseforge', 'minecraft', 'Instances');
  if (exists(cf)) {
    for (const n of fs.readdirSync(cf)) {
      const dir = path.join(cf, n);
      let mcVersion = guessVersion(n), loader = guessLoader(n), loaderVersion = '';
      const j = readJson(path.join(dir, 'minecraftinstance.json'));
      if (j) {
        mcVersion = j.gameVersion || mcVersion;
        const ml = j.baseModLoader?.name || '';
        if (ml) {
          loader = ml.split('-')[0];
          loaderVersion = ml.split('-')[1] || '';
        }
      }
      found.push({ source: 'CurseForge', name: n, dir, mcVersion, loader, loaderVersion, detail: `${mcVersion || '?'} · ${loader} · ${what(dir)}` });
    }
  }
  // Prism / MultiMC
  for (const base of [path.join(appData, 'PrismLauncher', 'instances'), path.join(appData, 'MultiMC', 'instances')]) {
    if (!exists(base)) continue;
    for (const n of fs.readdirSync(base)) {
      const dir = path.join(base, n);
      const pack = readJson(path.join(dir, 'mmc-pack.json'));
      if (!pack) continue;
      const v = prismVersion(pack);
      const game = exists(path.join(dir, '.minecraft')) ? path.join(dir, '.minecraft') : path.join(dir, 'minecraft');
      found.push({ source: base.includes('Prism') ? 'Prism' : 'MultiMC', name: n, dir: game, ...v, detail: `${v.mcVersion || '?'} · ${v.loader} · ${what(game)}` });
    }
  }
  // official launcher
  const mc = path.join(appData, '.minecraft');
  if (exists(mc)) found.push({ source: 'Minecraft Launcher', name: '.minecraft', dir: mc, mcVersion: '', loader: 'fabric', detail: `${mc} · ${what(mc)}` });
  scanLunar(found);
  scanFeather(found);
  return found;
}

/** version and loader from a Prism / MultiMC mmc-pack.json */
function prismVersion(pack) {
  let mcVersion = '', loader = 'vanilla', loaderVersion = '';
  const map = { 'net.fabricmc.fabric-loader': 'fabric', 'org.quiltmc.quilt-loader': 'quilt', 'net.neoforged': 'neoforge', 'net.minecraftforge': 'forge' };
  for (const c of pack.components || []) {
    if (c.uid === 'net.minecraft') mcVersion = c.version;
    if (map[c.uid]) {
      loader = map[c.uid];
      loaderVersion = c.version;
    }
  }
  return { mcVersion, loader, loaderVersion };
}

// ---------------------------------------------------------------- copying (async)

async function copyAsync(from, to) {
  if (!exists(from)) return;
  await fs.promises.mkdir(path.dirname(to), { recursive: true });
  // NRC links resourcepacks / shaderpacks to .minecraft (junctions): copy the real folder, recreating the link would
  // need admin rights and older Node versions trip over junctions in cp
  const real = await fs.promises.realpath(from).catch(() => from);
  await fs.promises.cp(real, to, { recursive: true, force: true, errorOnExist: false, dereference: true });
}

/** kept for duplicating instances (small, called rarely) */
function copyRecursive(from, to) {
  if (!exists(from)) return;
  fs.cpSync(from, to, { recursive: true, force: true });
}

function newInstanceId(name) {
  const base = (name || 'imported').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'imported';
  let id = base, i = 2;
  while (store.get().instances.some((x) => x.id === id)) id = `${base}-${i++}`;
  return id;
}

/** downloads mod jars one by one in parallel; a single dead link must not stop the import */
async function downloadMods(mods, target, onStatus, warn) {
  const jobs = mods.map((m) => ({ url: m.url, file: path.join(target, 'mods', path.basename(m.file)), sha1: m.sha1 }));
  let done = 0;
  const failed = [];
  await Promise.all(Array.from({ length: Math.min(8, jobs.length) }, async (_, w) => {
    for (let i = w; i < jobs.length; i += 8) {
      try {
        await download(jobs[i].url, jobs[i].file, jobs[i].sha1);
      } catch {
        failed.push(path.basename(jobs[i].file));
      }
      onStatus(`Mods ${++done}/${jobs.length}`);
    }
  }));
  if (failed.length) warn(`${failed.length} Mod(s) nicht ladbar: ${failed.slice(0, 5).join(', ')}${failed.length > 5 ? ' …' : ''}`);
}

/** copies a found installation into a new instance (and downloads the mods NRC keeps elsewhere) */
async function importFound(f, mcVersion, onStatus = () => {}, parts = DEFAULT_PARTS) {
  const inst = {
    id: newInstanceId(f.name), name: f.name, mcVersion: mcVersion || f.mcVersion || '26.1.2', loader: LOADERS.includes(f.loader) ? f.loader : 'fabric',
    loaderVersion: f.loaderVersion || '', counter: false, icon: 'import', created: Date.now(), lastPlayed: 0, playTime: 0, importedFrom: f.source,
  };
  const warn = (t) => { inst.importWarnings = [...(inst.importWarnings || []), t]; };
  const target = store.dirs.instance(inst.id);
  await fs.promises.mkdir(target, { recursive: true });
  const copy = parts.flatMap((g) => GROUPS[g] || []);
  if (f.modsOnly) {
    onStatus('Kopiere Mods …');
    await copyAsync(f.dir, path.join(target, 'mods'));
  } else {
    for (let i = 0; i < copy.length; i++) {
      const n = copy[i];
      onStatus(`Kopiere ${n} (${i + 1}/${copy.length}) …`);
      // Lunar / Feather keep your own mods apart from the game folder
      if (n === 'mods' && f.modsDir) {
        await copyAsync(f.modsDir, path.join(target, 'mods')).catch((e) => warn(`mods: ${e.code || e.message}`));
        continue;
      }
      // the source may call a folder differently (Lunar: "shaders"); NRC shares settings / servers in a group folder
      const name = f.rename?.[n] || n;
      const src = exists(path.join(f.dir, name)) ? path.join(f.dir, name) : f.shared && exists(path.join(f.shared, name)) && !['mods', 'saves'].includes(n) ? path.join(f.shared, name) : null;
      if (!src) continue;
      try {
        await copyAsync(src, path.join(target, n));
      } catch (e) {
        // one unreadable folder must not stop the whole import
        warn(`${n}: ${e.code || e.message}`);
      }
    }
  }
  if (f.mods?.length && parts.includes('mods')) await downloadMods(f.mods, target, onStatus, warn);
  store.get().instances.push(inst);
  store.save();
  onStatus('');
  return inst;
}

/** .mrpack: index with files to download plus an overrides folder */
async function importMrpack(file, onStatus) {
  const zip = new AdmZip(file);
  const index = JSON.parse(zip.readAsText('modrinth.index.json'));
  const deps = index.dependencies || {};
  const loader = deps['fabric-loader'] ? 'fabric' : deps['quilt-loader'] ? 'quilt' : deps.neoforge ? 'neoforge' : deps.forge ? 'forge' : 'vanilla';
  const inst = {
    id: newInstanceId(index.name), name: index.name || path.basename(file, '.mrpack'), mcVersion: deps.minecraft, loader,
    loaderVersion: deps['fabric-loader'] || deps['quilt-loader'] || deps.neoforge || deps.forge || '', counter: false, icon: 'import', created: Date.now(), lastPlayed: 0, playTime: 0, importedFrom: '.mrpack',
  };
  const target = store.dirs.instance(inst.id);
  const jobs = [];
  for (const f of index.files || []) {
    if (f.env && f.env.client === 'unsupported') continue;
    const dest = path.join(target, ...f.path.split('/'));
    if (!dest.startsWith(target)) continue; // never write outside the instance
    jobs.push({ url: f.downloads[0], file: dest, sha1: f.hashes?.sha1 });
  }
  await downloadAll(jobs, (d, t) => onStatus?.(`Mods ${d}/${t}`), 8);
  for (const e of zip.getEntries()) {
    for (const prefix of ['overrides/', 'client-overrides/']) {
      if (!e.entryName.startsWith(prefix) || e.isDirectory) continue;
      const dest = path.join(target, ...e.entryName.slice(prefix.length).split('/'));
      if (!dest.startsWith(target)) continue;
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      await fs.promises.writeFile(dest, e.getData());
    }
  }
  store.get().instances.push(inst);
  store.save();
  return inst;
}

// ---------------------------------------------------------------- export files read entry by entry

/**
 * Small zip reader that streams entries straight from disk. adm-zip loads the whole archive into memory, and an NRC
 * export with packs and screenshots can be many GB (zip64). Only "stored" and "deflate" entries exist in practice.
 */
async function zipEntries(fh) {
  const { size } = await fh.stat();
  const tail = Buffer.alloc(Math.min(size, 65557 + 20));
  await fh.read(tail, 0, tail.length, size - tail.length);
  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('Die Datei ist kein gültiges Archiv');
  let count = tail.readUInt16LE(eocd + 10), cdSize = tail.readUInt32LE(eocd + 12), cdOffset = tail.readUInt32LE(eocd + 16);
  // zip64: the real numbers are in the zip64 end record the locator in front of the normal end record points to
  if (eocd >= 20 && tail.readUInt32LE(eocd - 20) === 0x07064b50) {
    const z64 = Buffer.alloc(56);
    await fh.read(z64, 0, 56, Number(tail.readBigUInt64LE(eocd - 12)));
    count = Number(z64.readBigUInt64LE(32));
    cdSize = Number(z64.readBigUInt64LE(40));
    cdOffset = Number(z64.readBigUInt64LE(48));
  }
  const cd = Buffer.alloc(cdSize);
  await fh.read(cd, 0, cdSize, cdOffset);
  const entries = [];
  for (let p = 0, i = 0; i < count && cd.readUInt32LE(p) === 0x02014b50; i++) {
    const method = cd.readUInt16LE(p + 10);
    let csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24), offset = cd.readUInt32LE(p + 42);
    const nameLen = cd.readUInt16LE(p + 28), extraLen = cd.readUInt16LE(p + 30), commentLen = cd.readUInt16LE(p + 32);
    const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
    // zip64 extra field: 64-bit values only for the fields that are 0xFFFFFFFF, in this order
    for (let e = p + 46 + nameLen; e + 4 <= p + 46 + nameLen + extraLen; e += 4 + cd.readUInt16LE(e + 2)) {
      if (cd.readUInt16LE(e) !== 1) continue;
      let q = e + 4;
      if (usize === 0xffffffff) { usize = Number(cd.readBigUInt64LE(q)); q += 8; }
      if (csize === 0xffffffff) { csize = Number(cd.readBigUInt64LE(q)); q += 8; }
      if (offset === 0xffffffff) offset = Number(cd.readBigUInt64LE(q));
    }
    entries.push({ name, method, csize, usize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
/** stream of one entry's content (the local header in front of the data has its own name / extra lengths) */
async function entryStream(file, fh, e) {
  const head = Buffer.alloc(30);
  await fh.read(head, 0, 30, e.offset);
  const start = e.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
  // empty files: a read stream with start === end would still deliver one byte
  if (e.csize === 0) return Readable.from([]);
  const raw = fs.createReadStream(file, { start, end: start + e.csize - 1 });
  if (e.method === 0) return raw;
  if (e.method !== 8) throw new Error(`${e.name}: Packmethode ${e.method} wird nicht unterstützt`);
  return raw.pipe(zlib.createInflateRaw()).on('error', () => raw.destroy());
}
async function withZip(file, fn) {
  const fh = await fs.promises.open(file, 'r');
  try {
    return await fn(await zipEntries(fh), fh);
  } finally {
    await fh.close();
  }
}
async function readText(file, fh, e) {
  const parts = [];
  for await (const c of await entryStream(file, fh, e)) parts.push(c);
  return Buffer.concat(parts).toString('utf8');
}

/** which launcher an archive comes from (only the table of contents is read, so this is quick even for big files) */
async function zipKind(file) {
  const names = await withZip(file, async (entries) => entries.map((e) => e.name));
  if (names.includes('modrinth.index.json')) return 'modrinth';
  if (names.includes('profile.json')) return 'norisk';
  if (names.some((n) => /^([^/]+\/)?mmc-pack\.json$/.test(n))) return 'prism';
  if (names.includes('manifest.json')) return 'curseforge';
  return null;
}

/**
 * NoRiskClient export (.noriskpack: profile.json + overrides/) or Prism / MultiMC export (.zip: instance.cfg,
 * mmc-pack.json and the .minecraft folder). Everything the user ticked in the export comes along except logs and caches.
 */
async function importPack(file, onStatus = () => {}) {
  onStatus('Lese Datei …');
  return withZip(file, async (entries, fh) => {
    const names = entries.map((e) => e.name);
    const small = {};
    for (const e of entries) if (/^([^/]+\/)?(profile\.json|mmc-pack\.json|instance\.cfg)$/.test(e.name)) small[e.name] = await readText(file, fh, e);
    const base = { counter: false, icon: 'import', created: Date.now(), lastPlayed: 0, playTime: 0 };
    let inst, prefix, mods = [];
    if (small['profile.json']) {
      const p = JSON.parse(small['profile.json']);
      const name = p.name || path.basename(file, path.extname(file));
      inst = { ...base, id: newInstanceId(name), name, mcVersion: p.game_version, loader: LOADERS.includes(p.loader) ? p.loader : guessLoader(name), loaderVersion: nrcLoaderVersion(p.loader_version), importedFrom: 'NoRiskClient' };
      if (p.settings?.memory?.max >= 1024) inst.ramMb = p.settings.memory.max;
      prefix = 'overrides/';
      mods = nrcMods(p);
    } else {
      const packFile = Object.keys(small).find((n) => n.endsWith('mmc-pack.json'));
      if (!packFile) throw new Error('Unbekanntes Format – erwartet wird ein Export aus NoRiskClient (.noriskpack), Modrinth (.mrpack), CurseForge oder Prism (.zip)');
      const root = packFile.slice(0, -'mmc-pack.json'.length);
      const name = ((/^name=(.*)$/m.exec(small[root + 'instance.cfg'] || '') || [])[1] || '').trim() || path.basename(file, path.extname(file));
      inst = { ...base, id: newInstanceId(name), name, ...prismVersion(JSON.parse(small[packFile])), importedFrom: 'Prism' };
      prefix = [root + '.minecraft/', root + 'minecraft/'].find((pre) => names.some((n) => n.startsWith(pre))) || root + '.minecraft/';
    }
    const warn = (t) => { inst.importWarnings = [...(inst.importWarnings || []), t]; };
    const target = store.dirs.instance(inst.id);
    await fs.promises.mkdir(target, { recursive: true });
    const total = names.filter((n) => n.startsWith(prefix) && !n.endsWith('/')).length;
    let done = 0;
    for (const e of entries) {
      if (!e.name.startsWith(prefix) || e.name.endsWith('/')) continue;
      const rel = e.name.slice(prefix.length);
      if (JUNK.has(rel.split('/')[0].toLowerCase())) continue;
      const dest = path.join(target, ...rel.split('/'));
      if (!dest.startsWith(target + path.sep)) continue; // never write outside the instance
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      await pipeline(await entryStream(file, fh, e), fs.createWriteStream(dest));
      if (++done % 100 === 0) onStatus(`Entpacke ${done}/${total} …`);
    }
    if (mods.length) await downloadMods(mods, target, onStatus, warn);
    store.get().instances.push(inst);
    store.save();
    onStatus('');
    return inst;
  });
}

/** what ended up in an instance, shown after every import so missing settings or servers are obvious */
function summary(inst) {
  const dir = store.dirs.instance(inst.id);
  const list = (sub) => {
    try {
      return fs.readdirSync(path.join(dir, sub));
    } catch {
      return [];
    }
  };
  const mods = list('mods');
  return {
    mods: mods.filter((f) => f.endsWith('.jar')).length, modsOff: mods.filter((f) => f.endsWith('.jar.disabled')).length,
    settings: exists(path.join(dir, 'options.txt')), servers: exists(path.join(dir, 'servers.dat')), config: list('config').length,
    resourcepacks: list('resourcepacks').length, shaderpacks: list('shaderpacks').length, saves: list('saves').length, warnings: inst.importWarnings || [],
  };
}

module.exports = { scan, importFound, importMrpack, importPack, zipKind, summary, copyRecursive };
