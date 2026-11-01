// Counter Launcher: Electron main process. All Minecraft / network work happens here, the window only asks via IPC.
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const store = require('./src/core/store');
const mc = require('./src/core/minecraft');
const modrinth = require('./src/core/modrinth');
const curseforge = require('./src/core/curseforge');
const importers = require('./src/core/importers');
const auth = require('./src/core/auth');
const extras = require('./src/core/extras');
const labs = require('./src/core/labs');
const labs2 = require('./src/core/labs2');
const discord = require('./src/core/discord-rpc');
const updates = require('./src/updates');
const tools = require('./src/core/tools');
const social = require('./src/core/social');
const media = require('./src/core/media');
protocol.registerSchemesAsPrivileged([{ scheme: 'clmedia', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }]);
const { Notification } = require('electron');

let win;
const running = new Map();
const stopped = new Set();
function notify(title, body) {
  if (Notification.isSupported() && store.get().settings.notifications !== false) new Notification({ title, body, icon: path.join(__dirname, 'renderer', 'icon.png') }).show();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    frame: false,
    backgroundColor: '#0b0b14',
    show: false,
    icon: path.join(__dirname, 'renderer', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), { hash: process.env.CL_PAGE || '' });
  // test runs (CL_DATA set) open without taking the focus
  win.once('ready-to-show', () => (process.env.CL_DATA ? win.showInactive() : win.show()));
  // links open in the normal browser, never inside the launcher
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  // test runs only (CL_DATA + CL_EVAL): run a script in the window after loading
  if (process.env.CL_DATA && process.env.CL_EVAL) win.webContents.once('did-finish-load', () => setTimeout(() => win.webContents.executeJavaScript(fs.readFileSync(process.env.CL_EVAL, 'utf8')).catch((e) => console.log('CL_EVAL', e.message)), 2500));
}

/** unexpected errors of the launcher itself go into a file (Settings → "Fehlerprotokoll"), not just into the void */
function logLauncherError(kind, e) {
  try {
    const file = path.join(store.dirs.root, 'launcher-errors.log');
    const line = `[${new Date().toISOString()}] ${kind}: ${String((e && e.stack) || e).slice(0, 1500)}\n`;
    fs.appendFileSync(file, line);
    if (fs.statSync(file).size > 200000) fs.writeFileSync(file, fs.readFileSync(file, 'utf8').slice(-100000));
  } catch {}
}
process.on('uncaughtException', (e) => logLauncherError('uncaughtException', e));
process.on('unhandledRejection', (e) => logLauncherError('unhandledRejection', e));
/** "--play=<instance id>" (desktop shortcut): start that instance as soon as the window is ready */
const playArg = (process.argv.find((a) => a.startsWith('--play=')) || '').slice(7);

app.whenReady().then(() => {
  store.init(process.env.CL_DATA || path.join(app.getPath('appData'), '.counter-launcher'));
  // Encrypt tokens from older launcher versions as soon as Electron's
  // OS-backed safe storage is available.
  let migrated = false;
  for (const account of store.get().accounts) {
    if (account.refreshToken && !account.refreshTokenEncrypted) {
      try {
        const protectedAccount = auth.protectAccount(account);
        delete account.refreshToken;
        delete account.accessToken;
        Object.assign(account, protectedAccount);
        migrated = true;
      } catch {}
    }
  }
  if (migrated) store.save();
  media.register(protocol, net);
  createWindow();
  win.webContents.once('did-finish-load', () => {
    updates.init(send);
    if (playArg && instanceById(playArg)) setTimeout(() => HANDLERS.play(playArg).catch((e) => send('status', `Start fehlgeschlagen: ${e.message}`)), 3000);
  });
});
app.on('window-all-closed', () => app.quit());

const send = (channel, data) => win && !win.isDestroyed() && win.webContents.send(channel, data);
const instanceById = (id) => store.get().instances.find((i) => i.id === id);
const azureClientId = () => (process.env.COUNTER_AZURE_CLIENT_ID || store.get().settings.azureClientId || store.DEFAULT_AZURE_CLIENT_ID).trim();
/** every IPC handler is also kept here, so the assistant can use the same functions as the window */
const HANDLERS = {};
const handle = (name, fn) =>
  (HANDLERS[name] = fn) && ipcMain.handle(name, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

// ---------------------------------------------------------------- window
ipcMain.on('win', (_e, action) => {
  if (action === 'min') win.minimize();
  else if (action === 'max') win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (action === 'close') win.close();
});

// ---------------------------------------------------------------- state
handle('state', () => {
  const s = store.get();
  const mask = (o) => Object.fromEntries(Object.keys(o || {}).filter((k) => o[k]).map((k) => [k, true]));
  return { ...s, settings: { ...s.settings, groqKey: s.settings.groqKey ? 'gesetzt' : '', aiKeys: mask(s.settings.aiKeys) }, accounts: s.accounts.map(({ accessToken, refreshToken, accessTokenEncrypted, refreshTokenEncrypted, ...rest }) => rest), running: [...running.keys()], aiShared: !!aiProxy.url, counterFamilies: updates.counterFamilies() };
});
handle('settings:set', (patch) => {
  Object.assign(store.get().settings, patch);
  store.save();
});
/** background picture for the launcher: copied into the data folder, returned as data url */
handle('theme:pickImage', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] });
  if (r.canceled) return null;
  const ext = path.extname(r.filePaths[0]).toLowerCase();
  const target = path.join(store.dirs.root, 'background' + ext);
  fs.copyFileSync(r.filePaths[0], target);
  store.get().settings.theme = { ...(store.get().settings.theme || {}), bgImage: target };
  store.save();
  return readImage(target);
});
handle('theme:image', () => {
  const p = store.get().settings.theme?.bgImage;
  return p && fs.existsSync(p) ? readImage(p) : null;
});
function readImage(p) {
  const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }[path.extname(p).toLowerCase()] || 'image/png';
  return `data:${mime};base64,` + fs.readFileSync(p).toString('base64');
}
handle('versions', async () => {
  const m = await mc.versionList();
  return { latest: m.latest, versions: m.versions.map((v) => ({ id: v.id, type: v.type, time: v.releaseTime })) };
});
handle('loaders', (mcVersion, loader) => mc.newestLoader({ mcVersion, loader, loaderVersion: '' }).catch(() => null));

// ---------------------------------------------------------------- instances
handle('instance:create', (data) => {
  const base = (data.name || 'instance').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'instance';
  let id = base, n = 2;
  while (instanceById(id)) id = `${base}-${n++}`;
  const inst = { id, name: data.name || id, mcVersion: data.mcVersion, loader: data.loader || 'vanilla', loaderVersion: '', counter: !!data.counter, icon: data.icon || 'grass', created: Date.now(), lastPlayed: 0, playTime: 0 };
  store.get().instances.push(inst);
  store.get().selectedInstance = id;
  store.save();
  return inst;
});
handle('instance:update', (id, patch) => {
  Object.assign(instanceById(id), patch);
  store.save();
});
handle('instance:select', (id) => {
  store.get().selectedInstance = id;
  store.save();
});
handle('instance:delete', (id) => {
  const s = store.get();
  s.instances = s.instances.filter((i) => i.id !== id);
  if (s.selectedInstance === id) s.selectedInstance = s.instances[0]?.id || null;
  store.save();
  // files are moved to the recycle bin by the shell, not deleted for good
  const dir = store.dirs.instance(id);
  if (fs.existsSync(dir)) shell.trashItem(dir).catch(() => {});
});
handle('instance:open', (id) => {
  const dir = store.dirs.instance(id);
  fs.mkdirSync(dir, { recursive: true });
  shell.openPath(dir);
});
handle('content:list', (id, type) => modrinth.listInstalled(instanceById(id), type));
handle('content:toggle', (id, type, file) => modrinth.toggle(instanceById(id), type, file));
handle('content:remove', (id, type, file) => modrinth.remove(instanceById(id), type, file));
/** own files: copied into the instance (button or drag and drop) */
handle('content:add', async (id, type, files) => {
  const inst = instanceById(id);
  let list = files;
  if (!list || list.length === 0) {
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: type === 'mod' ? [{ name: 'Mods', extensions: ['jar'] }] : [{ name: 'Packs', extensions: ['zip', 'jar'] }],
    });
    if (r.canceled) return [];
    list = r.filePaths;
  }
  const folder = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' }[type] || 'mods';
  const dir = path.join(store.dirs.instance(inst.id), folder);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of list) fs.copyFileSync(f, path.join(dir, path.basename(f)));
  return list.map((f) => path.basename(f));
});

// ---------------------------------------------------------------- browse (Modrinth + CurseForge)
handle('browse:search', async (source, query, type, id, offset) => {
  const inst = instanceById(id) || store.get().instances[0];
  if (source === 'curseforge') return curseforge.search(query, type, inst, offset);
  const r = await modrinth.search(query, type, inst, offset);
  return { hits: r.hits.map((h) => ({ ...h, source: 'modrinth' })), total: r.total_hits };
});
handle('browse:install', async (source, projectId, type, id) => {
  const status = (t) => send('status', t);
  if (type === 'modpack') {
    return source === 'curseforge' ? (await curseforge.installModpack(projectId, status)).instance : modrinth.installModpack(projectId, status);
  }
  const inst = instanceById(id);
  return source === 'curseforge' ? curseforge.install(projectId, type, inst) : modrinth.install(projectId, type, inst);
});
handle('curseforge:available', () => curseforge.available());
handle('project', (id) => modrinth.project(id));
handle('project:versions', (id, type, instId) => modrinth.versions(id, type, instanceById(instId) || store.get().instances[0]));
handle('project:installVersion', (versionId, type, instId) => modrinth.installVersion(versionId, type, instanceById(instId)));

// ---------------------------------------------------------------- instance extras
handle('worlds', (id) => extras.worlds(instanceById(id)));
handle('screenshots', (id) => extras.screenshots(instanceById(id)));
handle('screenshot:open', (file) => {
  if (path.resolve(file).startsWith(store.dirs.instances)) shell.openPath(file);
});
handle('servers', (id) => extras.servers(instanceById(id)));
handle('servers:save', (id, list) => extras.saveServers(instanceById(id), list));
handle('logs', (id) => extras.logs(instanceById(id)));
handle('log:read', (file) => extras.readLog(file));
handle('updates:apply', (id, list) => {
  const inst = instanceById(id);
  labs.backupMods(inst, 'vor-update');
  return extras.applyUpdates(inst, list);
});
handle('updates:check', async (id) => {
  const inst = instanceById(id);
  const locked = new Set(Object.entries(inst.modMeta || {}).filter(([, m]) => m.lock).map(([f]) => f));
  return (await extras.checkUpdates(inst)).filter((u) => !locked.has(u.oldFile));
});
handle('mods:list', (id) => studio.listModules(instanceById(id)));
handle('mods:delete', (id, file) => shell.trashItem(studio.moduleFile(instanceById(id), file)));
handle('mods:code', (id, file) => studio.moduleCode(instanceById(id), file));
handle('mods:import', (id, code) => studio.importModuleCode(instanceById(id), code));
handle('labs:profiles', (id) => labs.listProfiles(instanceById(id)));
handle('labs:profileSave', (id, name) => labs.saveProfile(instanceById(id), name));
handle('labs:profileApply', (id, name) => labs.applyProfile(instanceById(id), name));
handle('labs:profileDelete', (id, name) => labs.deleteProfile(instanceById(id), name));
handle('labs:massToggle', (id, on) => labs.massToggle(instanceById(id), !!on));
handle('labs:upgrade', (id, version) => labs.upgradeInstance(instanceById(id), version, extras.checkUpdates, extras.applyUpdates));
handle('labs:parentStatus', () => labs.parentStatus(store.get().settings, store.get().instances));
handle('labs:parentSet', (limit, pin) => labs.parentSet(store.get().settings, limit, pin));
handle('labs:parentExtend', (pin, min) => labs.parentExtend(store.get().settings, pin, min));
handle('labs:themeCode', () => labs.themeCode(store.get().settings));
handle('labs:themeApply', (code) => labs.applyThemeCode(store.get().settings, code));
handle('labs2:pc', () => labs2.pcCheck());
handle('labs2:dups', () => labs2.duplicates());
handle('labs2:dedupe', () => labs2.dedupe());
handle('labs2:deps', (id) => labs2.depTree(instanceById(id)));
handle('labs2:collections', () => labs2.listCollections());
handle('labs2:collectionSave', (id, name) => labs2.saveCollection(instanceById(id), name));
handle('labs2:collectionCode', (name) => labs2.collectionCode(name));
handle('labs2:collectionDelete', (name) => labs2.deleteCollection(name));
handle('labs2:worldCopy', (id, world, targetId) => labs2.copyWorld(instanceById(id), world, instanceById(targetId)));
handle('labs2:shortcut', (id) => labs2.desktopShortcut(instanceById(id), process.execPath));
handle('labs2:repair', async (id) => {
  const inst = instanceById(id);
  if (running.has(id)) throw new Error('Die Instanz läuft gerade – bitte erst beenden');
  await mc.install(inst, (t) => send('status', t));
  send('status', '');
  return true;
});
handle('labs2:errors', () => {
  const f = path.join(store.dirs.root, 'launcher-errors.log');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').slice(-6000) : '';
});
handle('labs:health', (id) => labs.healthCheck(instanceById(id)));
handle('labs:security', (id) => labs.securityCheck(instanceById(id)));
handle('labs:modBackups', (id) => labs.listModBackups(instanceById(id)));
handle('labs:modBackup', (id) => labs.backupMods(instanceById(id), 'manuell'));
handle('labs:modRestore', (id, name) => labs.restoreModBackup(instanceById(id), name));
handle('labs:share', (id) => labs.shareCode(instanceById(id)));
handle('labs:disk', (id) => labs.diskUsage(instanceById(id)));
handle('labs:java', (id) => labs.javaAdvice(instanceById(id)));
handle('labs:overview', () => labs.updateOverview(store.get().instances, extras.checkUpdates));
handle('labs:modMeta', (id, file, patch) => {
  const inst = instanceById(id);
  inst.modMeta ||= {};
  const cur = (inst.modMeta[file] ||= {});
  if ('note' in patch) cur.note = String(patch.note || '').slice(0, 200);
  if ('tags' in patch) cur.tags = (patch.tags || []).map((t) => String(t).slice(0, 20)).slice(0, 6);
  if ('lock' in patch) cur.lock = !!patch.lock;
  if (!cur.note && !(cur.tags || []).length && !cur.lock) delete inst.modMeta[file];
  store.save();
  return inst.modMeta[file] || {};
});
handle('labs:settingsExport', async () => {
  const r = await dialog.showSaveDialog(win, { defaultPath: 'counter-einstellungen.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled) return null;
  fs.writeFileSync(r.filePath, labs.exportSettings());
  return r.filePath;
});
handle('labs:settingsImport', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled) return null;
  return labs.importSettings(fs.readFileSync(r.filePaths[0], 'utf8'));
});
handle('labs:importShare', async (code) => {
  const info = labs.parseShareCode(code);
  return buildFromProjects(info, (t) => send('status', t));
});
handle('export:official', (id) => extras.exportToOfficial(instanceById(id), (t) => send('status', t)));
handle('instance:duplicate', async (id) => {
  const src = instanceById(id);
  let nid = src.id + '-copy', n = 2;
  while (instanceById(nid)) nid = `${src.id}-copy-${n++}`;
  await fs.promises.cp(store.dirs.instance(src.id), store.dirs.instance(nid), { recursive: true, force: true }).catch(() => {});
  const copy = { ...src, id: nid, name: src.name + ' (Kopie)', created: Date.now(), lastPlayed: 0, playTime: 0 };
  store.get().instances.push(copy);
  store.save();
  return copy;
});

// ---------------------------------------------------------------- import
handle('import:scan', () => importers.scan());
handle('import:found', (found, mcVersion, parts) => importers.importFound(found, mcVersion, (t) => send('status', t), parts));
handle('import:file', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Modpacks', extensions: ['mrpack', 'zip'] }] });
  if (r.canceled) return null;
  const file = r.filePaths[0];
  const status = (t) => send('status', t);
  if (file.endsWith('.mrpack')) return { instance: await importers.importMrpack(file, status), skipped: [] };
  return curseforge.importModpack(file, status);
});

// ---------------------------------------------------------------- accounts
let loginCancelled = false;
handle('account:offline', (name) => {
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) throw new Error('Name: 3-16 letters, numbers or _');
  const acc = auth.offline(name);
  addAccount(acc);
  return acc.name;
});
/** account that plays through the official Minecraft Launcher: it handles the Microsoft login, no Azure app needed */
handle('account:official', () => {
  addAccount({ type: 'official', name: 'Minecraft Launcher', uuid: 'official-launcher' });
  return 'Minecraft Launcher';
});
handle('account:login', async () => {
  const clientId = azureClientId();
  if (!clientId) throw new Error('NO_CLIENT_ID');
  loginCancelled = false;
  const acc = await auth.browserLogin(clientId, (url) => shell.openExternal(url), () => loginCancelled, (url, redirectUri) => {
    send('login:browser', { url, redirectUri });
  });
  addAccount(acc);
  return acc.name;
});
handle('account:cancel', () => {
  loginCancelled = true;
});
handle('account:select', (uuid) => {
  store.get().activeAccount = uuid;
  store.save();
});
handle('account:remove', (uuid) => {
  const s = store.get();
  s.accounts = s.accounts.filter((a) => a.uuid !== uuid);
  if (s.activeAccount === uuid) s.activeAccount = s.accounts[0]?.uuid || null;
  store.save();
});
function addAccount(acc) {
  const s = store.get();
  acc = auth.protectAccount(acc);
  s.accounts = s.accounts.filter((a) => a.uuid !== acc.uuid);
  s.accounts.push(acc);
  s.activeAccount = acc.uuid;
  store.save();
}

// ---------------------------------------------------------------- play
async function prepareCounter(inst, status) {
  if (!inst.counter) return;
  const mods = path.join(store.dirs.instance(inst.id), 'mods');
  fs.mkdirSync(mods, { recursive: true });
  // the Counter jar shipped with the launcher, and Fabric API which it needs
  // the newest Counter jar: shipped with the launcher or downloaded from a newer release
  const source = updates.newestCounterJar(inst.mcVersion);
  if (!source) throw new Error(`Counter gibt es noch nicht für Minecraft ${inst.mcVersion}`);
  if (source) {
    const jar = path.basename(source);
    for (const old of fs.readdirSync(mods)) if (/^counter-client-.*\.jar$/.test(old) && old !== jar) fs.rmSync(path.join(mods, old));
    fs.copyFileSync(source, path.join(mods, jar));
  }
  if (!fs.readdirSync(mods).some((f) => f.startsWith('fabric-api'))) {
    status('Fabric API …');
    await modrinth.install('P7dR8mSH', 'mod', inst);
  }
  await syncBetterAnimations(inst, status);
}

/**
 * Counter module "Better Animations": the mod only writes a marker file; the launcher then installs (or switches on)
 * the mod Punchy! (first-person animations) for this instance, or switches it off again. Takes effect at the next start.
 */
async function syncBetterAnimations(inst, status) {
  try {
    const marker = path.join(store.dirs.instance(inst.id), 'config', 'counter', 'better-animations.json');
    if (!fs.existsSync(marker)) return;
    const want = !!JSON.parse(fs.readFileSync(marker, 'utf8')).enabled;
    const punchy = modrinth.listInstalled(inst, 'mod').find((m) => /punchy/i.test(m.name || m.file) && !/moves/i.test(m.name || m.file));
    if (want && !punchy) {
      status('Punchy! (Better Animations) …');
      await modrinth.install('8aoMKplv', 'mod', inst);
    } else if (want && punchy && !punchy.enabled) {
      modrinth.toggle(inst, 'mod', punchy.file);
    } else if (!want && punchy && punchy.enabled) {
      modrinth.toggle(inst, 'mod', punchy.file);
    }
  } catch (e) {
    send('status', `Better Animations: ${e.message}`);
  }
}

handle('play', async (id, opts = {}) => {
  const s = store.get();
  const inst = instanceById(id);
  const limit = labs.parentStatus(s.settings, s.instances);
  if (limit.blocked) throw new Error(`Das Tageslimit von ${limit.limitMin + limit.bonus} Minuten ist erreicht. Mit der PIN (Einstellungen → Spielzeit-Limit) kannst du verlängern.`);
  let acc = s.accounts.find((a) => a.uuid === s.activeAccount);
  if (!acc) throw new Error('NO_ACCOUNT');
  if (acc.type === 'msa' && acc.expires < Date.now() + 60_000) {
    send('status', 'Login …');
    const fresh = auth.protectAccount(await auth.refresh(azureClientId(), acc));
    for (const key of ['refreshToken', 'refreshTokenEncrypted', 'accessToken', 'accessTokenEncrypted', 'expires']) delete acc[key];
    Object.assign(acc, fresh);
    store.save();
  }
  const status = (t) => send('status', t);
  await prepareCounter(inst, status);
  if (acc.type === 'official') {
    // install everything here, then hand over to the official launcher with this profile preselected
    const profile = await extras.exportToOfficial(inst, status);
    extras.openOfficialLauncher();
    inst.lastPlayed = Date.now();
    store.save();
    send('status', '');
    return { official: profile };
  }
  const started = Date.now();
  const tail = [];
  let firstLine = 0;
  let startRecorded = false;
  const child = await mc.launch(inst, auth.unprotectAccount(acc), status, (line) => {
    send('log', { id, line });
    // start time = from the first game output to "Sound engine started" (the game is ready then)
    if (!firstLine) firstLine = Date.now();
    if (!startRecorded && /Sound engine started/.test(line)) {
      startRecorded = true;
      inst.startTimes = [...(inst.startTimes || []), Date.now() - firstLine].slice(-12);
      store.save();
    }
    tail.push(line);
    if (tail.length > 80) tail.shift();
  }, opts);
  running.set(id, child);
  inst.lastPlayed = Date.now();
  store.save();
  send('status', '');
  send('running', [...running.keys()]);
  if (s.settings.closeOnLaunch) win.minimize();
  // Discord status while the game runs (silent when Discord is not open)
  let rpc = null;
  if (s.settings.discordRpc && s.settings.discordClientId) {
    rpc = new discord.Rpc(s.settings.discordClientId);
    rpc.setActivity(discord.activityFor(inst, started));
    rpc.connect().catch(() => {});
  }
  child.on('exit', (code) => {
    running.delete(id);
    rpc?.close();
    const ended = Date.now();
    inst.playTime = (inst.playTime || 0) + (ended - started);
    inst.sessions = [...(inst.sessions || []), { start: started, end: ended }].slice(-60);
    store.save();
    // a crash: non zero exit code (killed by "stop" counts as normal)
    if (code && code !== 0 && !stopped.has(id)) {
      inst.crashes = [...(inst.crashes || []), { time: ended, code }].slice(-20);
      store.save();
      send('crash', { id, name: inst.name, code, tail: tail.join('').split('\n').slice(-40).join('\n') });
      notify(`${inst.name} ist abgestürzt`, 'Klicke im Counter Launcher auf „Logs“, um den Fehler zu sehen.');
    }
    stopped.delete(id);
    send('running', [...running.keys()]);
    send('log', { id, line: `\n[Counter Launcher] Minecraft closed (${code})\n` });
  });
  return true;
});
handle('stop', (id) => {
  stopped.add(id);
  running.get(id)?.kill();
});
handle('backup:create', (id, world) => tools.backupWorld(instanceById(id), world));
handle('backup:list', (id) => tools.listBackups(instanceById(id)));
handle('backup:restore', (id, file) => tools.restoreBackup(instanceById(id), file));
handle('backup:delete', (id, file) => tools.deleteBackup(instanceById(id), file));
handle('world:open', (id, world) => {
  const p = path.join(store.dirs.instance(id), 'saves', path.basename(world));
  if (fs.existsSync(p)) shell.openPath(p);
});
handle('export:mrpack', async (id) => {
  const inst = instanceById(id);
  const r = await dialog.showSaveDialog(win, { defaultPath: `${inst.name}.mrpack`, filters: [{ name: 'Modrinth Modpack', extensions: ['mrpack'] }] });
  if (r.canceled) return null;
  const out = await tools.exportMrpack(inst, r.filePath, (t) => send('status', t));
  shell.showItemInFolder(r.filePath);
  return out;
});
handle('icon:pick', async (id) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
  if (r.canceled) return null;
  tools.setIcon(instanceById(id), r.filePaths[0]);
  return tools.icon(instanceById(id));
});
handle('icon:remove', (id) => {
  instanceById(id).iconFile = false;
  store.save();
});
handle('icons', () => Object.fromEntries(store.get().instances.map((i) => [i.id, tools.icon(i)]).filter(([, v]) => v)));
handle('java:list', () => tools.javaList());
handle('java:pick', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Java', extensions: ['exe'] }] });
  return r.canceled ? null : r.filePaths[0];
});
handle('news', () => tools.news());
handle('skin', async () => {
  const s = store.get();
  const base = await tools.skin(s.accounts.find((a) => a.uuid === s.activeAccount));
  const local = s.settings.localSkin && social.skinPath(s.settings.localSkin);
  return local ? { ...base, url: 'data:image/png;base64,' + fs.readFileSync(local.path).toString('base64'), slim: local.slim, local: true } : base;
});
// video backgrounds (own file or a Wallpaper Engine video)
function setVideo(file) {
  if (!media.isVideo(file)) throw new Error('Nur MP4- oder WebM-Videos');
  store.get().settings.theme = { ...(store.get().settings.theme || {}), video: file, bg: 'video' };
  store.save();
  return media.urlFor(file);
}
handle('bg:pickVideo', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Videos', extensions: ['mp4', 'webm', 'm4v', 'mov'] }] });
  return r.canceled ? null : setVideo(r.filePaths[0]);
});
handle('bg:useVideo', (file) => setVideo(file));
handle('bg:video', () => {
  const f = store.get().settings.theme?.video;
  return f && media.isVideo(f) ? media.urlFor(f) : null;
});
handle('bg:wallpapers', () => media.wallpapers());
const http = require('./src/core/http');
handle('bg:shaders', () => media.shaderBackgrounds(store.dirs.root, http.getJson, require('./src/publish')));
handle('bg:useShader', async (name) => {
  const b = (await media.shaderBackgrounds(store.dirs.root, http.getJson, require('./src/publish'))).find((x) => x.name === name);
  if (!b) throw new Error('Hintergrund nicht gefunden');
  if (!b.downloaded) {
    send('status', `Hintergrund „${b.title}“ wird geladen …`);
    await http.download(b.url, b.file, null, b.size);
    send('status', '');
  }
  return setVideo(b.file);
});
// KI-Assistent (Groq, Schlüssel des Nutzers)
const assistant = require('./src/core/assistant');
const studio = require('./src/core/studio');
const aiProxy = require('./src/core/ai-proxy');
const aiInstance = (instId) => {
  const s = store.get();
  return instanceById(instId) || s.instances.find((i) => i.id === s.selectedInstance) || s.instances[0];
};
/** mod changes from the assistant; files only by plain name inside the instance, removals go to the recycle bin */
async function aiApply(inst, a) {
  if (!inst) throw new Error('Keine Instanz');
  const type = a.type === 'shader' ? 'shader' : a.type === 'resourcepack' ? 'resourcepack' : 'mod';
  if (a.kind === 'create_module') return studio.createModule(inst, a.spec);
  if (a.kind === 'counter_config') return studio.counterConfig(inst, a.changes, running.has(inst.id));
  if (a.kind === 'launcher_design') {
    const r = studio.launcherDesign(a.patch);
    send('theme:changed');
    return r;
  }
  if (a.kind === 'create_resourcepack') {
    try {
      return await studio.resourcePack(inst, a.spec, (t) => send('status', t));
    } finally {
      send('status', '');
    }
  }
  if (a.kind === 'build_modpack') {
    const projects = (a.projects || []).map((p) => (typeof p === 'string' ? p : p.project_id)).filter((x) => /^[\w-]{4,16}$/.test(x)).slice(0, 60);
    if (!projects.length) throw new Error('Keine Mods angegeben');
    const r = await buildFromProjects({ name: String(a.name || 'KI-Modpack').slice(0, 40), mcVersion: String(a.mcVersion || ''), loader: a.loader || 'fabric', counter: !!a.counter, projects }, (t) => send('status', t));
    send('theme:changed');
    return `${r.installed} Mods installiert${r.failed.length ? `, ${r.failed.length} passten nicht zur Version` : ''}`;
  }
  if (a.kind === 'create_instance') {
    const created = await HANDLERS['instance:create']({ name: String(a.name || 'KI-Instanz').slice(0, 40), mcVersion: String(a.mcVersion || ''), loader: a.loader || 'fabric', counter: !!a.counter });
    send('theme:changed');
    return created && created.id ? `ID ${created.id}` : '';
  }
  if (a.kind === 'launch_instance') {
    const target = instanceById(a.id) || inst;
    await HANDLERS['play'](target.id, a.server ? { server: String(a.server) } : {});
    return `${target.name} startet`;
  }
  if (a.kind === 'backup_world') return HANDLERS['backup:create'](inst.id, String(a.world || ''));
  if (a.kind === 'install_mod') {
    send('status', `${a.title || 'Mod'} wird installiert …`);
    try {
      await modrinth.install(a.project_id, type, inst);
    } finally {
      send('status', '');
    }
    return;
  }
  const file = String(a.file || '');
  if (!file || path.basename(file) !== file) throw new Error('Ungültiger Dateiname');
  const dir = path.join(store.dirs.instance(inst.id), 'mods');
  const real = [file, file + '.disabled', file.replace(/\.disabled$/, '')].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
  if (!real) throw new Error(`${file} nicht gefunden`);
  if (a.kind === 'remove_mod') return shell.trashItem(real);
  if (a.kind === 'toggle_mod') {
    const isOn = !real.endsWith('.disabled');
    if (isOn !== !!a.enabled) fs.renameSync(real, isOn ? real + '.disabled' : real.slice(0, -9));
  }
}
/** text files of an instance the assistant may read (no saves, no account data), size limited */
function aiReadFile(inst, rel) {
  const root = store.dirs.instance(inst.id);
  rel = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (rel === 'crash' || rel === 'crash-report') {
    const dir = path.join(root, 'crash-reports');
    const newest = fs.existsSync(dir) ? fs.readdirSync(dir).map((n) => path.join(dir, n)).sort((x, y) => fs.statSync(y).mtimeMs - fs.statSync(x).mtimeMs)[0] : null;
    if (!newest) return 'Keine Crash-Reports vorhanden.';
    rel = 'crash-reports/' + path.basename(newest);
  }
  if (rel === 'logs' || rel === 'log') rel = 'logs/latest.log';
  if (!/^(options\.txt|optionsof\.txt|logs\/[\w.-]+\.log|crash-reports\/[\w.-]+\.txt|config\/[\w./-]+\.(json|json5|toml|txt|properties|cfg|yml|yaml|ini))$/i.test(rel) || rel.includes('..'))
    return 'Diese Datei darf ich nicht lesen. Erlaubt: options.txt, logs/latest.log, crash (neuester Crash-Report), crash-reports/<datei>.txt, config/<datei>.(json|toml|txt|properties|cfg|yml).';
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) {
    if (rel.startsWith('config/')) {
      const dir = path.join(root, 'config');
      return `Gibt es nicht. Dateien in config/: ${fs.existsSync(dir) ? fs.readdirSync(dir).slice(0, 80).join(', ') : '-'}`;
    }
    return 'Gibt es nicht.';
  }
  let text = fs.readFileSync(file, 'utf8');
  // long logs: the end matters most (errors), plus every line that looks like an error
  if (text.length > 9000) {
    const errs = text.split(/\r?\n/).filter((l) => /ERROR|Exception|Caused by|FATAL|Mixin|incompatible|requires/i.test(l)).slice(-40).join('\n');
    text = `[gekürzt, ${text.length} Zeichen]\nFehlerzeilen:\n${errs.slice(0, 4000)}\n\nEnde der Datei:\n${text.slice(-4500)}`;
  }
  return text.replace(/(accessToken|--accessToken|token|session)[=: ]+[\w.-]{12,}/gi, '$1=***');
}
const aiMemory = {
  list: () => (store.get().settings.aiMemory ||= []),
  add(fact) {
    const list = aiMemory.list();
    if (fact && !list.includes(fact)) list.push(fact);
    if (list.length > 60) list.shift();
    store.save();
  },
  remove(item) {
    const list = aiMemory.list();
    const n = parseInt(item, 10);
    const i = n >= 1 && n <= list.length && String(n) === String(item).trim() ? n - 1 : list.findIndex((x) => x.toLowerCase().includes(String(item).toLowerCase()));
    if (i < 0) return false;
    list.splice(i, 1);
    store.save();
    return true;
  },
};
/** new instance with the given Modrinth projects (share codes and the assistant's modpack builder) */
async function buildFromProjects(info, status) {
  const inst = await HANDLERS['instance:create']({ name: info.name, mcVersion: info.mcVersion, loader: info.loader, counter: info.counter });
  const ok = [], failed = [];
  // Fabric / Quilt mods nearly always need the Fabric API (Modrinth does not always list it as required)
  if (['fabric', 'quilt'].includes(info.loader) && !info.projects.includes('P7dR8mSH')) info.projects = ['P7dR8mSH', ...info.projects];
  for (const [i, id] of info.projects.entries()) {
    status(`Installiere ${i + 1}/${info.projects.length} …`);
    try {
      await modrinth.install(id, 'mod', inst);
      ok.push(id);
    } catch {
      failed.push(id);
    }
  }
  status('');
  return { id: inst.id, name: inst.name, installed: ok.length, failed };
}
/**
 * Providers to try, best first: the one chosen in the studio (if it has a key), then every other provider with a key
 * (strongest first), the old Groq key, and last the shared Counter AI. When one is used up the next takes over.
 */
function aiChain() {
  const st = store.get().settings;
  const keys = { ...(st.aiKeys || {}) };
  if (st.groqKey && !keys.groq) keys.groq = st.groqKey;
  if (st.openrouterKey && !keys.openrouter) keys.openrouter = st.openrouterKey;
  const order = ['ollama', 'gemini', 'mistral', 'cerebras', 'nvidia', 'openrouter', 'groq', ...(process.env.CL_AI_TEST_URL ? ['mock'] : [])];
  const pick = st.aiProvider && st.aiProvider !== 'auto' ? st.aiProvider : null;
  const chain = [];
  if (pick && pick !== 'proxy' && keys[pick]) chain.push({ id: pick, key: keys[pick] });
  for (const id of order) if (keys[id] && !chain.some((c) => c.id === id)) chain.push({ id, key: keys[id] });
  if (aiProxy.url && (pick === 'proxy' || !chain.length || st.aiShareFallback !== false)) chain.push({ id: 'proxy', key: 'proxy' });
  return chain;
}
handle('ai:ask', async (history, instId, auto, goal, prefs) => {
  const s = store.get();
  const inst = aiInstance(instId);
  const ctx = {
    instances: s.instances.map((i) => `${i.name} (${i.loader} ${i.mcVersion}${i.counter ? ', mit Counter' : ''})`).join('; '),
    selected: inst ? `${inst.name} [id ${inst.id}] (${inst.loader} ${inst.mcVersion}${inst.counter ? ', mit Counter' : ''}${running.has(inst.id) ? ', läuft gerade' : ''})` : '',
  };
  const env = {
    instance: inst,
    listMods: () => modrinth.listInstalled(inst, 'mod').map((m) => ({ file: m.file, name: m.name, enabled: m.enabled })),
    listInstances: () => s.instances,
    worlds: () => extras.worlds(inst),
    readFile: (rel) => aiReadFile(inst, rel),
    listContent: (type) => modrinth.listInstalled(inst, type === 'shader' ? 'shader' : 'resourcepack').map((x) => `${x.file}${x.enabled ? '' : ' (aus)'}`).join('\n') || 'Keine',
    ping: async (address) => {
      const r = await social.ping(address);
      if (!r.online) return `${address}: offline (${r.error || ''})`;
      return JSON.stringify({ online: true, version: r.version, players: `${r.players}/${r.max}`, ping: r.ping + ' ms', motd: r.motd }).slice(0, 800);
    },
    memory: aiMemory,
    apply: (a) => aiApply(inst, a),
    listCustom: () => studio.listModules(inst),
    labs: { healthCheck: labs.healthCheck, securityCheck: labs.securityCheck, javaAdvice: labs.javaAdvice, diskUsage: labs.diskUsage, overview: () => labs.updateOverview(s.instances, extras.checkUpdates) },
  };
  // older windows send a persona string instead of the prefs object
  const p = typeof prefs === 'string' ? { persona: prefs } : { ...(prefs || {}) };
  p.memory = aiMemory.list();
  for (const k of ['persona', 'instructions', 'name']) if (p[k]) p[k] = String(p[k]).slice(0, k === 'instructions' ? 1500 : 400);
  const r = await assistant.ask({
    chain: aiChain(), model: s.settings.groqModel || '', history, ctx, env, auto: !!auto, goal: goal ? String(goal).slice(0, 500) : '', prefs: p,
    onStatus: (t) => send('ai:status', t),
  });
  r.memory = aiMemory.list();
  return r;
});
handle('ai:memory', () => aiMemory.list());
handle('ai:memorySet', (list) => {
  store.get().settings.aiMemory = (Array.isArray(list) ? list : []).map((x) => String(x).slice(0, 200)).filter(Boolean).slice(0, 60);
  store.save();
  return store.get().settings.aiMemory;
});
handle('ai:apply', (action, instId) => aiApply(aiInstance(instId), action));
handle('ai:models', () => {
  const first = aiChain()[0];
  return first ? assistant.models(first.key, first.id) : { ids: [], best: '', vision: false, search: false, reasoning: [], provider: 'none' };
});
handle('ai:providers', () => {
  const st = store.get().settings;
  const have = { ...(st.aiKeys || {}) };
  if (st.groqKey && !have.groq) have.groq = st.groqKey;
  if (st.openrouterKey && !have.openrouter) have.openrouter = st.openrouterKey;
  return { list: assistant.providerList().map((p) => ({ ...p, hasKey: p.id === 'proxy' ? !!aiProxy.url : !!have[p.id] })), selected: st.aiProvider || 'auto', shareFallback: st.aiShareFallback !== false };
});
handle('ai:setKey', async (id, key) => {
  if (!assistant.PROVIDERS[id] || id === 'proxy') throw new Error('Unbekannter Anbieter');
  const st = store.get().settings;
  st.aiKeys = { ...(st.aiKeys || {}) };
  key = String(key || '').trim();
  if (!key) {
    delete st.aiKeys[id];
    if (id === 'groq') st.groqKey = '';
  } else {
    if (id !== 'ollama' && (key.length < 15 || /\s/.test(key))) throw new Error('Das sieht nicht wie ein Schlüssel aus');
    if (id === 'ollama' && !/^https?:\/\//i.test(key)) key = 'ollama';
    // check it right away: a wrong key is reported here and not in the middle of a question
    st.aiKeys[id] = key;
    try {
      const m = await assistant.models(key, id);
      if (!m.ids.length) throw new Error('Keine Modelle');
      await assistant.checkKey(id, key);
    } catch (e) {
      delete st.aiKeys[id];
      throw new Error(e.badKey || /Schlüssel/.test(e.message) ? e.message : `Der Schlüssel funktioniert nicht (${e.message})`);
    }
    if (id === 'groq') st.groqKey = key;
  }
  store.save();
  return true;
});
handle('server:ping', (address) => social.ping(address));
handle('servers:known', () => social.knownServers());
handle('shot:random', () => social.randomScreenshot());
handle('skins:list', () => social.listSkins());
handle('skins:add', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Skins', extensions: ['png'] }] });
  if (r.canceled) return [];
  return r.filePaths.map((f) => social.addSkin(f));
});
handle('skins:addFile', (file) => social.addSkin(file));
handle('skins:update', (id, patch) => social.updateSkin(id, patch));
handle('skins:remove', (id) => social.removeSkin(id, (p) => shell.trashItem(p)));
handle('skins:upload', async (id) => {
  const s = store.get();
  const acc = s.accounts.find((a) => a.uuid === s.activeAccount);
  if (!acc || acc.type !== 'msa') throw new Error('Nur mit einem Microsoft-Konto möglich');
  if (acc.expires < Date.now() + 60_000) {
    const fresh = auth.protectAccount(await auth.refresh(azureClientId(), acc));
    for (const key of ['refreshToken', 'refreshTokenEncrypted', 'accessToken', 'accessTokenEncrypted', 'expires']) delete acc[key];
    Object.assign(acc, fresh);
    store.save();
  }
  await social.uploadSkin(auth.unprotectAccount(acc), id);
  tools.clearSkinCache();
});
handle('notify:test', () => notify('Counter Launcher', 'So sehen Benachrichtigungen aus.'));
handle('update:state', () => updates.state());
handle('update:check', () => updates.check());
handle('update:install', () => updates.install());
handle('app:version', () => app.getVersion());
handle('open:external', (url) => {
  if (/^https:\/\//.test(url)) shell.openExternal(url);
});
