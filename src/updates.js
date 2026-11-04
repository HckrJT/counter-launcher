// Updates: the launcher itself (electron-updater, GitHub Releases) and the bundled Counter mod jar, which is taken
// from the same GitHub release so a new Counter version does not need a new launcher.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { getJson, download } = require('./core/http');
const store = require('./core/store');

const publish = require('./publish');
const configured = () => publish.owner && !publish.owner.startsWith('DEIN_');

let send = () => {};
let updater = null;
let lastState = { state: 'idle', version: app.getVersion() };

function report(state) {
  lastState = { ...lastState, ...state };
  send('update', lastState);
}

function init(sendFn) {
  send = sendFn;
  if (!app.isPackaged || !configured()) {
    report({ state: configured() ? 'dev' : 'unconfigured' });
    return;
  }
  updater = require('electron-updater').autoUpdater;
  updater.autoDownload = true;
  // beta channel: also take pre-releases (setting in the launcher settings)
  updater.allowPrerelease = !!require('./core/store').get().settings.beta;
  updater.autoInstallOnAppQuit = true;
  updater.on('checking-for-update', () => report({ state: 'checking' }));
  updater.on('update-available', (i) => report({ state: 'downloading', newVersion: i.version, percent: 0 }));
  updater.on('update-not-available', () => report({ state: 'latest' }));
  updater.on('download-progress', (p) => report({ state: 'downloading', percent: Math.round(p.percent) }));
  updater.on('update-downloaded', (i) => report({ state: 'ready', newVersion: i.version }));
  updater.on('error', (e) => report({ state: 'error', error: String(e && e.message ? e.message : e).slice(0, 160) }));
  check();
  // look again every 3 hours while the launcher stays open
  setInterval(check, 3 * 60 * 60 * 1000);
}

function check() {
  if (updater) updater.checkForUpdates().catch(() => {});
  checkCounterJar().catch(() => {});
}

function install() {
  if (updater && lastState.state === 'ready') updater.quitAndInstall(false, true);
}

// ---------------------------------------------------------------- Counter mod jar

// Counter jars: counter-client-<version>.jar is for 26.1.x, counter-client-<version>+mc<family>.jar for other versions
const JAR = /counter-client-(\d+(?:\.\d+)*)(?:[+.-]mc(\d+\.\d+))?\.jar$/;
const versionOf = (name) => (JAR.exec(name) || [])[1];
const familyOf = (name) => (JAR.exec(name) ? JAR.exec(name)[2] || '26.1' : null);
/** "26.2.1" -> "26.2", "1.21.11" -> "1.21" */
const family = (mc) => String(mc || '').split('.').slice(0, 2).join('.');
function newer(a, b) {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

function downloadedDir() {
  return path.join(store.dirs.root, 'counter');
}

function allJars() {
  const bundled = path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, '..'), 'bundled');
  const files = [];
  for (const dir of [bundled, downloadedDir()]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) if (versionOf(f)) files.push(path.join(dir, f));
  }
  return files;
}

/** the newest Counter jar for a Minecraft version (shipped with the launcher or downloaded from a release) */
function newestCounterJar(mcVersion = '26.1.2') {
  const fam = family(mcVersion);
  const files = allJars().filter((f) => familyOf(path.basename(f)) === fam);
  files.sort((a, b) => (newer(versionOf(path.basename(a)), versionOf(path.basename(b))) ? -1 : 1));
  return files[0] || null;
}

/** Minecraft version families Counter is available for (from local jars and the latest release) */
let releaseFamilies = [];
function counterFamilies() {
  return [...new Set([...allJars().map((f) => familyOf(path.basename(f))), ...releaseFamilies])].filter(Boolean);
}

async function checkCounterJar() {
  if (!configured()) return;
  const rel = await getJson(`https://api.github.com/repos/${publish.owner}/${publish.repo}/releases/latest`);
  const jars = (rel.assets || []).filter((a) => versionOf(a.name));
  releaseFamilies = [...new Set(jars.map((a) => familyOf(a.name)))];
  for (const fam of releaseFamilies) {
    const asset = jars.filter((a) => familyOf(a.name) === fam).sort((a, b) => (newer(versionOf(a.name), versionOf(b.name)) ? -1 : 1))[0];
    const have = newestCounterJar(fam + '.0');
    if (have && !newer(versionOf(asset.name), versionOf(path.basename(have)))) continue;
    await download(asset.browser_download_url, path.join(downloadedDir(), asset.name), null, asset.size);
    send('update', { ...lastState, counter: versionOf(asset.name) + (fam === '26.1' ? '' : ` (${fam})`) });
  }
}

module.exports = { init, check, install, state: () => lastState, newestCounterJar, counterFamilies, configured, checkCounterJar, counterVersionOf: versionOf };
