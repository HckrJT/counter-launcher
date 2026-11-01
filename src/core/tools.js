// Extra instance tools: world backups, .mrpack export, custom instance icons, Java detection and news from GitHub.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { getJson, postJson } = require('./http');
const store = require('./store');

const dirOf = (inst, ...p) => path.join(store.dirs.instance(inst.id), ...p);

/** adm-zip never resolves addLocalFolderPromise for folders without files, so those are skipped */
function hasFiles(dir) {
  try {
    for (const n of fs.readdirSync(dir)) {
      const p = path.join(dir, n);
      if (fs.statSync(p).isFile() || hasFiles(p)) return true;
    }
  } catch {}
  return false;
}
const backupsDir = (inst) => path.join(store.dirs.root, 'backups', inst.id);

// ---------------------------------------------------------------- world backups

async function backupWorld(inst, world) {
  const src = dirOf(inst, 'saves', world);
  if (!fs.existsSync(path.join(src, 'level.dat'))) throw new Error('Welt nicht gefunden');
  fs.mkdirSync(backupsDir(inst), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const file = path.join(backupsDir(inst), `${world.replace(/[^\w\- ]+/g, '_')}__${stamp}.zip`);
  const zip = new AdmZip();
  if (hasFiles(src)) await zip.addLocalFolderPromise(src, { zipPath: world });
  await zip.writeZipPromise(file);
  return path.basename(file);
}

function listBackups(inst) {
  const dir = backupsDir(inst);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.zip')).map((f) => {
    const st = fs.statSync(path.join(dir, f));
    return { file: f, world: f.split('__')[0], time: st.mtimeMs, size: st.size };
  }).sort((a, b) => b.time - a.time);
}

/** restores a backup as a new world folder (never overwrites the current world) */
async function restoreBackup(inst, file) {
  const zipPath = path.join(backupsDir(inst), path.basename(file));
  const zip = new AdmZip(zipPath);
  const saves = dirOf(inst, 'saves');
  const world = path.basename(file).split('__')[0];
  let name = `${world} (Backup)`, n = 2;
  while (fs.existsSync(path.join(saves, name))) name = `${world} (Backup ${n++})`;
  const target = path.join(saves, name);
  for (const e of zip.getEntries()) {
    if (e.isDirectory) continue;
    const rel = e.entryName.split('/').slice(1).join('/');
    const dest = path.join(target, ...rel.split('/'));
    if (!dest.startsWith(target)) continue;
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    await fs.promises.writeFile(dest, e.getData());
  }
  return name;
}

function deleteBackup(inst, file) {
  fs.rmSync(path.join(backupsDir(inst), path.basename(file)), { force: true });
}

// ---------------------------------------------------------------- .mrpack export

/** builds a Modrinth modpack: mods known to Modrinth are referenced by url, everything else goes into overrides */
async function exportMrpack(inst, target, onStatus = () => {}) {
  const modsDir = dirOf(inst, 'mods');
  const jars = fs.existsSync(modsDir) ? fs.readdirSync(modsDir).filter((f) => f.endsWith('.jar')) : [];
  const info = {};
  for (const f of jars) {
    const buf = fs.readFileSync(path.join(modsDir, f));
    info[f] = { sha1: crypto.createHash('sha1').update(buf).digest('hex'), sha512: crypto.createHash('sha512').update(buf).digest('hex'), size: buf.length };
  }
  onStatus('Modrinth-Abgleich …');
  let known = {};
  if (jars.length) {
    try {
      known = await postJson('https://api.modrinth.com/v2/version_files', { hashes: Object.values(info).map((i) => i.sha1), algorithm: 'sha1' });
    } catch {
      known = {};
    }
  }
  const files = [];
  const zip = new AdmZip();
  for (const f of jars) {
    const v = known[info[f].sha1];
    const file = v && v.files.find((x) => x.hashes.sha1 === info[f].sha1);
    if (file) {
      files.push({ path: `mods/${f}`, hashes: { sha1: info[f].sha1, sha512: info[f].sha512 }, env: { client: 'required', server: 'optional' }, downloads: [file.url], fileSize: info[f].size });
    } else {
      zip.addLocalFile(path.join(modsDir, f), 'overrides/mods');
    }
  }
  for (const extra of ['config', 'resourcepacks', 'shaderpacks']) {
    const p = dirOf(inst, extra);
    if (hasFiles(p)) await zip.addLocalFolderPromise(p, { zipPath: `overrides/${extra}` });
  }
  for (const f of ['options.txt', 'servers.dat']) if (fs.existsSync(dirOf(inst, f))) zip.addLocalFile(dirOf(inst, f), 'overrides');
  const deps = { minecraft: inst.mcVersion };
  const loaderKey = { fabric: 'fabric-loader', quilt: 'quilt-loader', neoforge: 'neoforge', forge: 'forge' }[inst.loader];
  if (loaderKey) deps[loaderKey] = inst.loaderVersion || (await require('./minecraft').newestLoader(inst));
  const index = { formatVersion: 1, game: 'minecraft', versionId: '1.0.0', name: inst.name, summary: 'Exported with the Counter Launcher', files, dependencies: deps };
  zip.addFile('modrinth.index.json', Buffer.from(JSON.stringify(index, null, 2)));
  onStatus('Schreibe Datei …');
  await zip.writeZipPromise(target);
  onStatus('');
  return { file: target, linked: files.length, bundled: jars.length - files.length };
}

// ---------------------------------------------------------------- instance icons

function setIcon(inst, source) {
  const dest = dirOf(inst, 'icon.png');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(source, dest);
  inst.iconFile = true;
  store.save();
}

function icon(inst) {
  const p = dirOf(inst, 'icon.png');
  return inst.iconFile && fs.existsSync(p) ? 'data:image/png;base64,' + fs.readFileSync(p).toString('base64') : null;
}

// ---------------------------------------------------------------- Java

/** Java installations found on this PC (common folders, the launcher's own runtimes, JAVA_HOME) */
function javaList() {
  const roots = [
    process.env.JAVA_HOME,
    'C:\\Program Files\\Java', 'C:\\Program Files\\Eclipse Adoptium', 'C:\\Program Files\\Microsoft', 'C:\\Program Files\\Zulu', 'C:\\Program Files\\BellSoft',
    path.join(store.dirs.root, 'runtime'),
    path.join(require('os').homedir(), '.jdks'),
  ].filter(Boolean);
  const out = [];
  const seen = new Set();
  const look = (dir, depth) => {
    try {
      const exe = path.join(dir, 'bin', 'javaw.exe');
      if (fs.existsSync(exe) && !seen.has(exe)) {
        seen.add(exe);
        let version = '';
        try {
          const rel = fs.readFileSync(path.join(dir, 'release'), 'utf8');
          version = (/JAVA_VERSION="([^"]+)"/.exec(rel) || [])[1] || '';
        } catch {}
        out.push({ path: exe, version, name: path.basename(dir) });
        return;
      }
      if (depth > 0) for (const n of fs.readdirSync(dir)) look(path.join(dir, n), depth - 1);
    } catch {}
  };
  for (const r of roots) look(r, 2);
  return out;
}

// ---------------------------------------------------------------- news

async function news() {
  const pub = require('../publish');
  if (!pub.owner) return [];
  const list = await getJson(`https://api.github.com/repos/${pub.owner}/${pub.repo}/releases?per_page=15`);
  return list.filter((r) => !r.draft && /^v\d/.test(r.tag_name)).map((r) => ({ version: r.tag_name, name: r.name, body: r.body || '', date: r.published_at, url: r.html_url }));
}

// ---------------------------------------------------------------- skins (for the 3D model on the home page)

const skinCache = new Map();
/** skin of an account as data URL (+ slim flag), from Mojang; offline names are looked up by name, else Steve */
async function skin(account) {
  const key = account ? account.uuid + account.name : '-';
  if (skinCache.has(key)) return skinCache.get(key);
  let out = { url: null, slim: false, cape: null };
  try {
    let id = account && account.type === 'msa' ? account.uuid : null;
    for (const name of [account && account.name, 'MHF_Steve']) {
      if (id || !name || !/^\w{3,16}$/.test(name)) continue;
      id = await getJson(`https://api.mojang.com/users/profiles/minecraft/${name}`).then((p) => p.id, () => null);
    }
    if (id) {
      const prof = await getJson(`https://sessionserver.mojang.com/session/minecraft/profile/${id.replace(/-/g, '')}`);
      const tex = JSON.parse(Buffer.from(prof.properties.find((p) => p.name === 'textures').value, 'base64').toString()).textures;
      const toData = async (u) => (u ? 'data:image/png;base64,' + Buffer.from(await (await fetch(u.replace('http://', 'https://'))).arrayBuffer()).toString('base64') : null);
      out = { url: await toData(tex.SKIN && tex.SKIN.url), slim: !!(tex.SKIN && tex.SKIN.metadata && tex.SKIN.metadata.model === 'slim'), cape: await toData(tex.CAPE && tex.CAPE.url) };
    }
  } catch {
    // unknown name or no connection: the renderer falls back to the default skin
  }
  skinCache.set(key, out);
  return out;
}

module.exports = { backupWorld, listBackups, restoreBackup, deleteBackup, exportMrpack, setIcon, icon, javaList, news, skin, clearSkinCache: () => skinCache.clear() };
