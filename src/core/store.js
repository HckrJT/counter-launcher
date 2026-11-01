// Settings, accounts and instances, stored as JSON in the launcher's data folder.
const fs = require('fs');
const path = require('path');

let root;
let file;
let state;

const DEFAULT_AZURE_CLIENT_ID = 'bb5d17f5-97e1-4cb0-b2e8-de162f69470d';

const DEFAULTS = {
  settings: {
    ramMb: 4096,
    javaPath: '',
    jvmArgs: '',
    azureClientId: DEFAULT_AZURE_CLIENT_ID,
    curseforgeKey: '',
    accent: '#9d5cff',
    closeOnLaunch: false,
    discordRpc: false,
    discordClientId: '',
    showSnapshots: false,
    showOld: false,
    theme: {},
  },
  accounts: [],
  activeAccount: null,
  instances: [],
  selectedInstance: null,
};

function init(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  // the real path: Fabric compares classpath entries with where classes come from, links / redirects must not differ
  root = fs.realpathSync.native(dataDir);
  file = path.join(root, 'launcher.json');
  try {
    state = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    state.settings = { ...DEFAULTS.settings, ...state.settings };
    if (state.settings.openrouterKey && !state.settings.aiKeys?.openrouter) {
      state.settings.aiKeys = { ...(state.settings.aiKeys || {}), openrouter: state.settings.openrouterKey };
      delete state.settings.openrouterKey;
      save();
    }
  } catch {
    state = JSON.parse(JSON.stringify(DEFAULTS));
  }
  if (state.instances.length === 0) {
    state.instances.push(defaultInstance());
    state.selectedInstance = state.instances[0].id;
    save();
  }
  return state;
}

function defaultInstance() {
  return {
    id: 'counter',
    name: 'Counter',
    mcVersion: '26.1.2',
    loader: 'fabric',
    loaderVersion: '',
    counter: true,
    icon: 'counter',
    created: Date.now(),
    lastPlayed: 0,
    playTime: 0,
  };
}

function save() {
  fs.writeFileSync(file + '.tmp', JSON.stringify(state, null, 2));
  fs.renameSync(file + '.tmp', file);
}

const dirs = {
  get root() { return root; },
  get versions() { return path.join(root, 'versions'); },
  get libraries() { return path.join(root, 'libraries'); },
  get assets() { return path.join(root, 'assets'); },
  get runtimes() { return path.join(root, 'runtime'); },
  get instances() { return path.join(root, 'instances'); },
  instance(id) { return path.join(root, 'instances', id); },
};

module.exports = { init, save, get: () => state, dirs, defaultInstance, DEFAULT_AZURE_CLIENT_ID };
