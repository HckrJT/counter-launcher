// Instance extras: worlds, screenshots, servers.dat, logs / crash reports, mod updates and the export to the
// official Minecraft Launcher (which then handles the Microsoft login itself).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { getJson, postJson, download } = require('./http');
const store = require('./store');
const mc = require('./minecraft');

const dirOf = (inst, ...p) => path.join(store.dirs.instance(inst.id), ...p);

function worlds(inst) {
  const dir = dirOf(inst, 'saves');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, 'level.dat'))).map((n) => {
    const icon = path.join(dir, n, 'icon.png');
    return {
      name: n,
      modified: fs.statSync(path.join(dir, n, 'level.dat')).mtimeMs,
      icon: fs.existsSync(icon) ? 'data:image/png;base64,' + fs.readFileSync(icon).toString('base64') : null,
    };
  }).sort((a, b) => b.modified - a.modified);
}

function screenshots(inst) {
  const dir = dirOf(inst, 'screenshots');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => /\.png$/i.test(n)).map((n) => ({ name: n, path: path.join(dir, n), time: fs.statSync(path.join(dir, n)).mtimeMs }))
    .sort((a, b) => b.time - a.time).slice(0, 60)
    .map((s) => ({ ...s, data: 'data:image/png;base64,' + fs.readFileSync(s.path).toString('base64') }));
}

// ---------------------------------------------------------------- servers.dat (uncompressed NBT)

function readNbt(buf) {
  let o = 0;
  const u8 = () => buf.readInt8(o++);
  const i16 = () => { const v = buf.readInt16BE(o); o += 2; return v; };
  const i32 = () => { const v = buf.readInt32BE(o); o += 4; return v; };
  const str = () => { const n = buf.readUInt16BE(o); o += 2; const s = buf.toString('utf8', o, o + n); o += n; return s; };
  function payload(type) {
    switch (type) {
      case 1: return u8();
      case 2: return i16();
      case 3: return i32();
      case 4: { o += 8; return 0; }
      case 5: { const v = buf.readFloatBE(o); o += 4; return v; }
      case 6: { const v = buf.readDoubleBE(o); o += 8; return v; }
      case 7: { const n = i32(); const b = buf.subarray(o, o + n); o += n; return b; }
      case 8: return str();
      case 9: { const t = u8(); const n = i32(); const a = []; for (let i = 0; i < n; i++) a.push(payload(t)); return a; }
      case 10: { const c = {}; for (;;) { const t = u8(); if (t === 0) break; const name = str(); c[name] = payload(t); } return c; }
      case 11: { const n = i32(); o += n * 4; return []; }
      case 12: { const n = i32(); o += n * 8; return []; }
      default: throw new Error('bad nbt tag ' + type);
    }
  }
  const t = u8();
  str();
  return payload(t);
}

function writeNbt(servers) {
  const parts = [];
  const b = (n) => { const x = Buffer.alloc(1); x.writeInt8(n); parts.push(x); };
  const s = (v) => { const d = Buffer.from(v, 'utf8'); const l = Buffer.alloc(2); l.writeUInt16BE(d.length); parts.push(l, d); };
  const i = (v) => { const x = Buffer.alloc(4); x.writeInt32BE(v); parts.push(x); };
  b(10); s('');
  b(9); s('servers'); b(10); i(servers.length);
  for (const sv of servers) {
    b(8); s('name'); s(sv.name || 'Minecraft Server');
    b(8); s('ip'); s(sv.ip);
    if (sv.icon) { b(8); s('icon'); s(sv.icon); }
    b(0);
  }
  b(0);
  return Buffer.concat(parts);
}

function servers(inst) {
  const file = dirOf(inst, 'servers.dat');
  if (!fs.existsSync(file)) return [];
  let buf = fs.readFileSync(file);
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
  try {
    return (readNbt(buf).servers || []).map((s) => ({ name: s.name, ip: s.ip, icon: s.icon || null }));
  } catch {
    return [];
  }
}

function saveServers(inst, list) {
  fs.mkdirSync(store.dirs.instance(inst.id), { recursive: true });
  fs.writeFileSync(dirOf(inst, 'servers.dat'), writeNbt(list));
}

// ---------------------------------------------------------------- logs

function logs(inst) {
  const out = [];
  const latest = dirOf(inst, 'logs', 'latest.log');
  if (fs.existsSync(latest)) out.push({ name: 'latest.log', path: latest, time: fs.statSync(latest).mtimeMs, crash: false });
  const crashes = dirOf(inst, 'crash-reports');
  if (fs.existsSync(crashes)) for (const n of fs.readdirSync(crashes)) out.push({ name: n, path: path.join(crashes, n), time: fs.statSync(path.join(crashes, n)).mtimeMs, crash: true });
  return out.sort((a, b) => b.time - a.time).slice(0, 30);
}

function readLog(file) {
  const root = store.dirs.instances;
  const real = path.resolve(file);
  if (!real.startsWith(root)) throw new Error('not an instance file');
  const text = fs.readFileSync(real, 'utf8');
  return text.length > 400000 ? text.slice(-400000) : text;
}

// ---------------------------------------------------------------- mod updates (Modrinth hash lookup)

function sha1(file) {
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
}

async function checkUpdates(inst) {
  const dir = dirOf(inst, 'mods');
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jar'));
  const byHash = {};
  for (const f of files) byHash[sha1(path.join(dir, f))] = f;
  const hashes = Object.keys(byHash);
  if (hashes.length === 0) return [];
  const r = await postJson('https://api.modrinth.com/v2/version_files/update', { hashes, algorithm: 'sha1', loaders: [inst.loader], game_versions: [inst.mcVersion] });
  const updates = [];
  for (const [hash, version] of Object.entries(r)) {
    const file = version.files.find((x) => x.primary) || version.files[0];
    if (!file || file.hashes.sha1 === hash) continue;
    updates.push({ oldFile: byHash[hash], name: version.name, version: version.version_number, url: file.url, newFile: file.filename, sha1: file.hashes.sha1 });
  }
  return updates;
}

async function applyUpdates(inst, updates, onProgress) {
  const dir = dirOf(inst, 'mods');
  let done = 0;
  for (const u of updates) {
    onProgress?.(done, updates.length, u.name);
    await download(u.url, path.join(dir, u.newFile), u.sha1);
    if (u.oldFile !== u.newFile) fs.rmSync(path.join(dir, u.oldFile), { force: true });
    onProgress?.(++done, updates.length, u.name);
  }
  return updates.length;
}

// ---------------------------------------------------------------- export to the official launcher

/** writes the instance's version (with loader) into .minecraft and adds a launcher profile that uses the instance folder */
async function exportToOfficial(inst, onStatus) {
  const appData = process.env.APPDATA;
  const mcDir = path.join(appData, '.minecraft');
  // the Microsoft Store / Xbox app version of the launcher keeps its own profile file
  const profileFiles = ['launcher_profiles.json', 'launcher_profiles_microsoft_store.json'].map((f) => path.join(mcDir, f)).filter((f) => fs.existsSync(f));
  if (profileFiles.length === 0) throw new Error('Der offizielle Minecraft Launcher ist nicht installiert (oder wurde noch nie gestartet)');
  onStatus?.('Version …');
  const { version } = await mc.install(inst, onStatus || (() => {}));
  // copy the loader version json chain into .minecraft/versions so the official launcher can resolve it
  let id = version.id;
  const copied = new Set();
  while (id && !copied.has(id)) {
    copied.add(id);
    const src = path.join(store.dirs.versions, id, id + '.json');
    if (!fs.existsSync(src)) break;
    const json = JSON.parse(fs.readFileSync(src, 'utf8'));
    const dst = path.join(mcDir, 'versions', id, id + '.json');
    if (!fs.existsSync(dst)) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }
    id = json.inheritsFrom;
  }
  const key = 'counter-' + inst.id;
  const name = `Counter · ${inst.name}`;
  for (const profilesFile of profileFiles) {
    const profiles = JSON.parse(fs.readFileSync(profilesFile, 'utf8'));
    profiles.profiles = profiles.profiles || {};
    profiles.profiles[key] = {
      ...(profiles.profiles[key] || {}),
      name,
      type: 'custom',
      lastVersionId: version.id,
      gameDir: store.dirs.instance(inst.id),
      javaArgs: `-Xmx${inst.ramMb || store.get().settings.ramMb}M`,
      icon: 'Bookshelf',
      created: profiles.profiles[key]?.created || new Date().toISOString(),
      // newest "lastUsed" makes the official launcher preselect this profile
      lastUsed: new Date().toISOString(),
    };
    fs.writeFileSync(profilesFile, JSON.stringify(profiles, null, 2));
  }
  return name;
}

/** starts the official Minecraft Launcher (classic install or the Microsoft Store / Xbox app version) */
function openOfficialLauncher() {
  const { spawn } = require('child_process');
  const candidates = [
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Minecraft Launcher', 'MinecraftLauncher.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Minecraft Launcher', 'MinecraftLauncher.exe'),
  ];
  const exe = candidates.find((c) => fs.existsSync(c));
  if (exe) {
    spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
    return exe;
  }
  // Store version: start it through its app id
  spawn('explorer.exe', ['shell:AppsFolder\\Microsoft.4297127D64EC6_8wekyb3d8bbwe!Minecraft'], { detached: true, stdio: 'ignore' }).unref();
  return 'store';
}

module.exports = { openOfficialLauncher, worlds, screenshots, servers, saveServers, logs, readLog, checkUpdates, applyUpdates, exportToOfficial };
