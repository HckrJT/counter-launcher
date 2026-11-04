// Installing and starting Minecraft: version metadata, Fabric, Java runtime, libraries, natives, assets, arguments.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');
const { getJson, download, downloadAll } = require('./http');
const store = require('./store');

const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const JAVA_MANIFEST = 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';
const FABRIC_META = 'https://meta.fabricmc.net/v2';
const OS = 'windows';

let manifestCache;

async function versionList() {
  if (!manifestCache) manifestCache = await getJson(MANIFEST);
  return manifestCache;
}

/** fabric loader versions that support a game version (newest first) */
async function fabricLoaders(mcVersion) {
  try {
    return await getJson(`${FABRIC_META}/versions/loader/${encodeURIComponent(mcVersion)}`);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- rules

const ARCH = process.arch === 'arm64' ? 'arm64' : process.arch === 'ia32' ? 'x86' : 'x64';

function rulesAllow(rules, features = {}) {
  if (!rules || rules.length === 0) return true;
  let allowed = false;
  for (const r of rules) {
    let match = true;
    if (r.os) {
      if (r.os.name && r.os.name !== OS) match = false;
      // Mojang only names x86 and arm64 explicitly; anything else is the normal 64 bit build
      if (r.os.arch && r.os.arch !== ARCH) match = false;
    }
    if (r.features) {
      for (const [k, v] of Object.entries(r.features)) if (!!features[k] !== v) match = false;
    }
    if (match) allowed = r.action === 'allow';
  }
  return allowed;
}

// ---------------------------------------------------------------- version json (+ loaders)

const QUILT_META = 'https://meta.quiltmc.org/v3';

async function vanillaJson(id) {
  const file = path.join(store.dirs.versions, id, id + '.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const m = await versionList();
  const entry = m.versions.find((v) => v.id === id);
  if (!entry) throw new Error(`Unknown Minecraft version ${id}`);
  await download(entry.url, file, entry.sha1);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readVersion(id) {
  const file = path.join(store.dirs.versions, id, id + '.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

function writeVersion(id, json) {
  const file = path.join(store.dirs.versions, id, id + '.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(json, null, 2));
}

/** child version (loader profile) on top of its parent: child libraries first, arguments appended */
function merge(parent, child) {
  const key = (n) => {
    const p = n.split(':');
    return p[0] + ':' + p[1] + (p[3] ? ':' + p[3] : '');
  };
  const childKeys = new Set((child.libraries || []).map((l) => key(l.name)));
  const merged = { ...parent, ...child };
  merged.libraries = [...(child.libraries || []), ...(parent.libraries || []).filter((l) => !childKeys.has(key(l.name)))];
  if (parent.arguments || child.arguments) {
    merged.arguments = {
      game: [...(parent.arguments?.game || []), ...(child.arguments?.game || [])],
      jvm: [...(parent.arguments?.jvm || []), ...(child.arguments?.jvm || [])],
    };
  }
  for (const k of ['assetIndex', 'assets', 'downloads', 'javaVersion']) if (!child[k]) merged[k] = parent[k];
  return merged;
}

/** loads a version json and everything it inherits from */
async function fullVersion(id) {
  let json = readVersion(id);
  if (!json) json = await vanillaJson(id);
  if (json.inheritsFrom) return merge(await fullVersion(json.inheritsFrom), json);
  return json;
}

async function newestLoader(instance) {
  // imported profiles sometimes carry extra text ("0.19.3 (stable)"): keep only the version number
  const pinned = /\d+(?:\.\d+)+(?:[-+.][\w.]+)?/.exec(instance.loaderVersion || '');
  if (pinned) return pinned[0];
  const mc = instance.mcVersion;
  switch (instance.loader) {
    case 'fabric': {
      const list = await fabricLoaders(mc);
      const v = list.find((l) => l.loader.stable) || list[0];
      if (!v) throw new Error(`Fabric does not support ${mc} yet`);
      return v.loader.version;
    }
    case 'quilt': {
      const list = await getJson(`${QUILT_META}/versions/loader/${encodeURIComponent(mc)}`).catch(() => []);
      if (!list[0]) throw new Error(`Quilt does not support ${mc} yet`);
      return list[0].loader.version;
    }
    case 'neoforge': {
      const all = (await getJson('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge')).versions;
      const parts = mc.split('.');
      // 1.21.1 -> 21.1.x, year based versions (26.1.2) -> 26.1.2.x
      const prefix = parts[0] === '1' ? `${parts[1]}.${parts[2] || '0'}.` : `${mc}.`;
      const stable = all.filter((v) => v.startsWith(prefix) && !v.includes('beta'));
      const pick = stable[stable.length - 1] || all.filter((v) => v.startsWith(prefix)).pop();
      if (!pick) throw new Error(`NeoForge does not support ${mc} yet`);
      return pick;
    }
    case 'forge': {
      const promos = (await getJson('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json')).promos;
      const v = promos[`${mc}-recommended`] || promos[`${mc}-latest`];
      if (!v) throw new Error(`Forge does not support ${mc} yet`);
      return v;
    }
    default:
      return '';
  }
}

/** runs the (Neo)Forge installer once; it writes its own version json and libraries into the launcher folder */
async function runForgeInstaller(instance, loader, onStatus) {
  const neo = instance.loader === 'neoforge';
  const name = neo ? 'NeoForge' : 'Forge';
  const id = neo ? `neoforge-${loader}` : `${instance.mcVersion}-forge-${loader}`;
  if (readVersion(id)) return id;
  const url = neo
    ? `https://maven.neoforged.net/releases/net/neoforged/neoforge/${loader}/neoforge-${loader}-installer.jar`
    : `https://maven.minecraftforge.net/net/minecraftforge/forge/${instance.mcVersion}-${loader}/forge-${instance.mcVersion}-${loader}-installer.jar`;
  const jar = path.join(store.dirs.root, 'installers', path.basename(url));
  onStatus(`${name} …`);
  await download(url, jar);
  // the installer wants a launcher profile file and the vanilla version next to it
  const profiles = path.join(store.dirs.root, 'launcher_profiles.json');
  if (!fs.existsSync(profiles)) fs.writeFileSync(profiles, JSON.stringify({ profiles: {} }));
  const vanilla = await vanillaJson(instance.mcVersion);
  const clientJar = path.join(store.dirs.versions, instance.mcVersion, instance.mcVersion + '.jar');
  await download(vanilla.downloads.client.url, clientJar, vanilla.downloads.client.sha1);
  const java = path.join(path.dirname(await ensureJava(vanilla, onStatus)), 'java.exe');
  await new Promise((resolve, reject) => {
    const p = spawn(java, ['-jar', jar, neo ? '--install-client' : '--installClient', store.dirs.root], { cwd: path.dirname(jar), windowsHide: true });
    p.stdout.on('data', (d) => onStatus(`${name}: ${d.toString().trim().slice(0, 60)}`));
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${name} installer failed (${code})`))));
  });
  if (readVersion(id)) return id;
  // fall back to whatever version folder the installer created for this loader
  const made = fs.readdirSync(store.dirs.versions).find((d) => d.includes(loader) && readVersion(d));
  if (made) return made;
  throw new Error(`${name} installer did not create a version`);
}

/** the complete version json for an instance, including its mod loader */
async function resolveVersion(instance, onStatus = () => {}) {
  const base = await vanillaJson(instance.mcVersion);
  if (!instance.loader || instance.loader === 'vanilla') return base;
  let loader = await newestLoader(instance);
  let id;
  if (instance.loader === 'fabric' || instance.loader === 'quilt') {
    const meta = instance.loader === 'fabric' ? FABRIC_META : QUILT_META;
    const profileUrl = (l) => `${meta}/versions/loader/${encodeURIComponent(instance.mcVersion)}/${encodeURIComponent(l)}/profile/json`;
    id = `${instance.loader}-loader-${loader}-${instance.mcVersion}`;
    if (!readVersion(id)) {
      let profile;
      try {
        profile = await getJson(profileUrl(loader));
      } catch (e) {
        // a pinned loader version that does not exist (e.g. from an import): use the newest stable one instead
        if (!instance.loaderVersion) throw e;
        loader = await newestLoader({ ...instance, loaderVersion: '' });
        id = `${instance.loader}-loader-${loader}-${instance.mcVersion}`;
        profile = readVersion(id) || (await getJson(profileUrl(loader)));
      }
      writeVersion(id, profile);
    }
  } else {
    id = await runForgeInstaller(instance, loader, onStatus);
  }
  const merged = await fullVersion(id);
  merged.id = id;
  merged.loaderVersion = loader;
  return merged;
}

// ---------------------------------------------------------------- libraries

function mavenPath(name) {
  const [group, artifact, version, classifier] = name.split(':');
  const file = `${artifact}-${version}${classifier ? '-' + classifier : ''}.jar`;
  return path.join(...group.split('.'), artifact, version, file);
}

function libraryJobs(version) {
  const jobs = [];
  const classpath = [];
  const natives = [];
  for (const lib of version.libraries) {
    if (!rulesAllow(lib.rules)) continue;
    if (lib.downloads) {
      const art = lib.downloads.artifact;
      if (art) {
        const file = path.join(store.dirs.libraries, art.path);
        // (Neo)Forge creates some libraries locally during install: those have no url
        if (art.url) jobs.push({ url: art.url, file, sha1: art.sha1, size: art.size });
        classpath.push(file);
      }
      // old style natives (before 1.19): classifiers
      if (lib.natives && lib.natives[OS] && lib.downloads.classifiers) {
        const key = lib.natives[OS].replace('${arch}', '64');
        const nat = lib.downloads.classifiers[key];
        if (nat) {
          const file = path.join(store.dirs.libraries, nat.path);
          jobs.push({ url: nat.url, file, sha1: nat.sha1, size: nat.size });
          natives.push({ file, exclude: lib.extract?.exclude || [] });
        }
      }
    } else {
      // fabric style: maven coordinates + repository url
      const rel = mavenPath(lib.name);
      const repo = (lib.url || 'https://libraries.minecraft.net/').replace(/\/?$/, '/');
      const file = path.join(store.dirs.libraries, rel);
      jobs.push({ url: repo + rel.split(path.sep).join('/'), file, sha1: lib.sha1 });
      classpath.push(file);
    }
  }
  return { jobs, classpath, natives };
}

function extractNatives(natives, dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const n of natives) {
    const zip = new AdmZip(n.file);
    for (const e of zip.getEntries()) {
      if (e.isDirectory || n.exclude.some((x) => e.entryName.startsWith(x))) continue;
      if (!/\.(dll|so|dylib)$/i.test(e.entryName)) continue;
      const dest = path.join(dir, path.basename(e.entryName));
      const data = e.getData();
      // a second game of the same version may already have these DLLs loaded (Windows locks them): same size = same file
      try {
        if (fs.statSync(dest).size === data.length) continue;
      } catch {}
      try {
        fs.writeFileSync(dest, data);
      } catch (err) {
        if (err.code !== 'EBUSY' && err.code !== 'EPERM') throw err;
      }
    }
  }
}

// ---------------------------------------------------------------- assets

async function assetJobs(version) {
  const idx = version.assetIndex;
  const indexFile = path.join(store.dirs.assets, 'indexes', idx.id + '.json');
  await download(idx.url, indexFile, idx.sha1);
  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  const jobs = [];
  const legacy = index.map_to_resources || index.virtual;
  for (const [name, obj] of Object.entries(index.objects)) {
    const sub = obj.hash.substring(0, 2);
    const url = `https://resources.download.minecraft.net/${sub}/${obj.hash}`;
    jobs.push({ url, file: path.join(store.dirs.assets, 'objects', sub, obj.hash), sha1: obj.hash, size: obj.size });
    if (legacy) jobs.push({ url, file: path.join(store.dirs.assets, 'virtual', idx.id, ...name.split('/')), sha1: obj.hash, size: obj.size });
  }
  return { jobs, legacy };
}

// ---------------------------------------------------------------- java

/** downloads the Java runtime Mojang uses for this version and returns java(w).exe */
async function ensureJava(version, onStatus, instance) {
  const custom = instance?.javaPath || store.get().settings.javaPath;
  if (custom && fs.existsSync(custom)) return custom;
  const component = version.javaVersion?.component || 'jre-legacy';
  const dir = path.join(store.dirs.runtimes, component);
  const exe = path.join(dir, 'bin', 'javaw.exe');
  if (fs.existsSync(exe)) return exe;
  onStatus?.(`Java (${component}) …`);
  const all = await getJson(JAVA_MANIFEST);
  const platform = process.arch === 'arm64' ? 'windows-arm64' : 'windows-x64';
  const entry = all[platform]?.[component]?.[0];
  if (!entry) throw new Error(`No Java runtime ${component} for ${platform}`);
  const files = (await getJson(entry.manifest.url)).files;
  const jobs = [];
  for (const [rel, f] of Object.entries(files)) {
    const target = path.join(dir, ...rel.split('/'));
    if (f.type === 'directory') fs.mkdirSync(target, { recursive: true });
    else if (f.type === 'file') jobs.push({ url: f.downloads.raw.url, file: target, sha1: f.downloads.raw.sha1, size: f.downloads.raw.size });
  }
  await downloadAll(jobs, (d, t) => onStatus?.(`Java ${d}/${t}`));
  return exe;
}

// ---------------------------------------------------------------- install + launch

async function install(instance, onStatus) {
  onStatus('Version …');
  const version = await resolveVersion(instance, onStatus);
  const vanilla = await vanillaJson(instance.mcVersion);
  const clientJar = path.join(store.dirs.versions, instance.mcVersion, instance.mcVersion + '.jar');
  const { jobs: libJobs, classpath, natives } = libraryJobs(version);
  const { jobs: aJobs, legacy } = await assetJobs(version);
  const jobs = [{ url: vanilla.downloads.client.url, file: clientJar, sha1: vanilla.downloads.client.sha1, size: vanilla.downloads.client.size }, ...libJobs, ...aJobs];
  await downloadAll(jobs, (d, t) => onStatus(`Download ${d}/${t}`));
  const java = await ensureJava(version, onStatus, instance);
  return { version, classpath: [...classpath, clientJar], natives, legacy, java };
}

function fill(str, vars) {
  return str.replace(/\$\{([^}]+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

function collectArgs(list, vars, features) {
  const out = [];
  for (const a of list || []) {
    if (typeof a === 'string') out.push(fill(a, vars));
    else if (rulesAllow(a.rules, features)) for (const v of [].concat(a.value)) out.push(fill(v, vars));
  }
  return out;
}

async function launch(instance, account, onStatus, onLog, opts = {}) {
  const s = store.get().settings;
  const { version, classpath, natives, legacy, java } = await install(instance, onStatus);
  const gameDir = store.dirs.instance(instance.id);
  fs.mkdirSync(path.join(gameDir, 'mods'), { recursive: true });
  const nativesDir = path.join(store.dirs.versions, version.id, 'natives');
  if (natives.length) extractNatives(natives, nativesDir);
  onStatus('Start …');
  const vars = {
    auth_player_name: account.name,
    version_name: version.id,
    game_directory: gameDir,
    assets_root: legacy ? path.join(store.dirs.assets, 'virtual', version.assetIndex.id) : store.dirs.assets,
    game_assets: path.join(store.dirs.assets, 'virtual', version.assetIndex.id),
    assets_index_name: version.assetIndex.id,
    auth_uuid: account.uuid,
    auth_access_token: account.accessToken || '0',
    auth_session: account.accessToken || '0',
    clientid: process.env.COUNTER_AZURE_CLIENT_ID || s.azureClientId || store.DEFAULT_AZURE_CLIENT_ID,
    auth_xuid: account.xuid || '0',
    user_type: account.type === 'msa' ? 'msa' : 'legacy',
    user_properties: '{}',
    version_type: 'Counter',
    natives_directory: nativesDir,
    launcher_name: 'counter-launcher',
    launcher_version: '1.0.0',
    classpath: classpath.join(path.delimiter),
    classpath_separator: path.delimiter,
    library_directory: store.dirs.libraries,
    resolution_width: String(instance.width || 1280),
    resolution_height: String(instance.height || 720),
    quickPlayMultiplayer: opts.server || '',
    quickPlayPath: path.join(gameDir, 'quickPlay.json'),
  };
  const features = {
    has_custom_resolution: !!(instance.width && instance.height),
    is_demo_user: false,
    has_quick_plays_support: !!opts.server,
    is_quick_play_multiplayer: !!opts.server,
  };
  const ram = instance.ramMb || s.ramMb;
  let jvm = [`-Xmx${ram}M`, `-Xms${Math.min(ram, 1024)}M`];
  const extra = (instance.jvmArgs || s.jvmArgs || '').trim();
  if (extra) jvm.push(...extra.split(/\s+/));
  let game;
  if (version.arguments) {
    jvm.push(...collectArgs(version.arguments.jvm, vars, features));
    game = collectArgs(version.arguments.game, vars, features);
  } else {
    // old versions (1.12 and earlier): one argument string, classpath and natives by hand
    jvm.push(`-Djava.library.path=${nativesDir}`, '-cp', vars.classpath);
    game = fill(version.minecraftArguments, vars).split(' ');
  }
  // old versions without quick play arguments: --server / --port still work there
  if (opts.server && !version.arguments) {
    const [host, port] = opts.server.split(':');
    game.push('--server', host, '--port', port || '25565');
  }
  if (instance.fullscreen) game.push('--fullscreen');
  const args = [...jvm, version.mainClass, ...game];
  onLog?.(`> ${path.basename(java)} … ${version.mainClass} (${version.id})`);
  const child = spawn(java, args, { cwd: gameDir, detached: true, windowsHide: false });
  child.stdout.on('data', (d) => onLog?.(d.toString()));
  child.stderr.on('data', (d) => onLog?.(d.toString()));
  return child;
}

module.exports = { versionList, fabricLoaders, newestLoader, launch, install };
