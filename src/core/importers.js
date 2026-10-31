// Imports instances, mods and settings from other launchers and .mrpack files.
// Copying runs asynchronously (fs.promises.cp) so the window never freezes, even for big modpacks with worlds.
const fs = require('fs');
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');
const { download, downloadAll } = require('./http');
const store = require('./store');

const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const home = os.homedir();

/** folders / files that are copied from a source game directory */
const GROUPS = {
  mods: ['mods'],
  settings: ['options.txt', 'optionsof.txt', 'optionsshaders.txt', 'servers.dat', 'counter'],
  config: ['config'],
  resourcepacks: ['resourcepacks'],
  shaderpacks: ['shaderpacks'],
  saves: ['saves'],
  screenshots: ['screenshots'],
};
/** worlds and screenshots are often gigabytes: only on request */
const DEFAULT_PARTS = ['mods', 'settings', 'config', 'resourcepacks', 'shaderpacks'];
const LOADERS = ['fabric', 'quilt', 'neoforge', 'forge', 'vanilla'];

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

// ---------------------------------------------------------------- NoRiskClient (V3 launcher)

/** NRC keeps its profiles in profiles.json (older installs: profiles.json.migrated) with version, loader and mod list */
function scanNrc(found) {
  const base = path.join(appData, 'norisk', 'NoRiskClientV3');
  if (!exists(base)) return;
  const list = readJson(path.join(base, 'profiles.json')) || readJson(path.join(base, 'profiles.json.migrated'));
  const profiles = Array.isArray(list) ? list : list && typeof list === 'object' ? Object.values(list.profiles || list) : [];
  const shared = path.join(base, 'data');
  for (const p of profiles) {
    if (!p || !p.name) continue;
    const dir = [path.join(shared, 'profiles', ...(p.path || p.name).split('/')), path.join(shared, 'profiles', p.name)].find(exists) || shared;
    // mods NRC downloads itself (it keeps them outside the profile folder)
    const mods = (p.mods || []).filter((m) => m.enabled !== false && m.source?.download_url).map((m) => ({ url: m.source.download_url, file: m.source.file_name || path.basename(m.source.download_url), sha1: m.source.file_hash_sha1 }));
    found.push({
      source: 'NoRiskClient', name: p.name, dir, shared, mcVersion: p.game_version || guessVersion(p.name),
      loader: LOADERS.includes(p.loader) ? p.loader : guessLoader(p.name), loaderVersion: (/\d+(?:\.\d+)+/.exec(p.loader_version || '') || [''])[0], mods,
      detail: `${p.game_version || '?'} · ${p.loader || '?'} · ${mods.length} Mods`,
    });
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
      if (fs.statSync(dir).isDirectory()) found.push({ source: 'Modrinth App', name: n, dir, mcVersion: guessVersion(n), loader: guessLoader(n) });
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
      found.push({ source: 'CurseForge', name: n, dir, mcVersion, loader, loaderVersion });
    }
  }
  // Prism / MultiMC
  for (const base of [path.join(appData, 'PrismLauncher', 'instances'), path.join(appData, 'MultiMC', 'instances')]) {
    if (!exists(base)) continue;
    for (const n of fs.readdirSync(base)) {
      const dir = path.join(base, n);
      const pack = readJson(path.join(dir, 'mmc-pack.json'));
      if (!pack) continue;
      let mcVersion = '', loader = 'vanilla', loaderVersion = '';
      for (const c of pack.components || []) {
        if (c.uid === 'net.minecraft') mcVersion = c.version;
        const map = { 'net.fabricmc.fabric-loader': 'fabric', 'org.quiltmc.quilt-loader': 'quilt', 'net.neoforged': 'neoforge', 'net.minecraftforge': 'forge' };
        if (map[c.uid]) {
          loader = map[c.uid];
          loaderVersion = c.version;
        }
      }
      const game = exists(path.join(dir, '.minecraft')) ? path.join(dir, '.minecraft') : path.join(dir, 'minecraft');
      found.push({ source: base.includes('Prism') ? 'Prism' : 'MultiMC', name: n, dir: game, mcVersion, loader, loaderVersion });
    }
  }
  // official launcher
  const mc = path.join(appData, '.minecraft');
  if (exists(mc)) found.push({ source: 'Minecraft Launcher', name: '.minecraft', dir: mc, mcVersion: '', loader: 'fabric' });
  // Lunar / Feather keep their own formats: only their mod folders can be taken over
  const lunar = path.join(home, '.lunarclient', 'offline', 'multiver', 'mods');
  if (exists(lunar)) found.push({ source: 'Lunar Client', name: 'Lunar mods', dir: lunar, mcVersion: '', loader: 'fabric', modsOnly: true });
  const feather = path.join(appData, '.feather', 'user-mods');
  if (exists(feather)) found.push({ source: 'Feather', name: 'Feather mods', dir: feather, mcVersion: '', loader: 'fabric', modsOnly: true });
  return found;
}

// ---------------------------------------------------------------- copying (async)

async function copyAsync(from, to) {
  if (!exists(from)) return;
  await fs.promises.mkdir(path.dirname(to), { recursive: true });
  // dereference: some launchers (NRC) link folders like resourcepacks to .minecraft; copy the real files,
  // recreating the link would need admin rights
  await fs.promises.cp(from, to, { recursive: true, force: true, errorOnExist: false, dereference: true });
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

/** copies a found installation into a new instance (and downloads the mods NRC keeps elsewhere) */
async function importFound(f, mcVersion, onStatus = () => {}, parts = DEFAULT_PARTS) {
  const inst = {
    id: newInstanceId(f.name), name: f.name, mcVersion: mcVersion || f.mcVersion || '26.1.2', loader: LOADERS.includes(f.loader) ? f.loader : 'fabric',
    loaderVersion: f.loaderVersion || '', counter: false, icon: 'import', created: Date.now(), lastPlayed: 0, playTime: 0, importedFrom: f.source,
  };
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
      // NRC shares settings / servers between profiles in its data folder
      const src = exists(path.join(f.dir, n)) ? path.join(f.dir, n) : f.shared && exists(path.join(f.shared, n)) && !['mods', 'saves'].includes(n) ? path.join(f.shared, n) : null;
      if (!src) continue;
      try {
        await copyAsync(src, path.join(target, n));
      } catch (e) {
        // one unreadable folder must not stop the whole import
        inst.importWarnings = [...(inst.importWarnings || []), `${n}: ${e.code || e.message}`];
      }
    }
  }
  if (f.mods?.length && parts.includes('mods')) {
    const jobs = f.mods.map((m) => ({ url: m.url, file: path.join(target, 'mods', path.basename(m.file)), sha1: m.sha1 }));
    try {
      await downloadAll(jobs, (d, t) => onStatus(`Mods ${d}/${t}`), 8);
    } catch (e) {
      inst.importWarnings = [...(inst.importWarnings || []), `mods: ${e.message}`];
    }
  }
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

module.exports = { scan, importFound, importMrpack, copyRecursive };
