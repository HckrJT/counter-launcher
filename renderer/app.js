// Counter Launcher window. Files and network go through window.counter (preload bridge); text from the internet is
// always inserted as text (or through the small escaping markdown renderer below), never as raw HTML.
const api = window.counter;
let state = null;
let route = { page: 'home' };
const busy = new Set();

// ================================================================= helpers
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
const $ = (s) => document.querySelector(s);
const svg = (d) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  for (const part of d.split('|')) {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', part);
    s.append(p);
  }
  return s;
};
const I = {
  play: 'M7 4l13 8-13 8z', stop: 'M6 6h12v12H6z', folder: 'M3 7h6l2 2h10v10H3z', plus: 'M12 5v14M5 12h14', search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14M20 20l-3.5-3.5',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13', refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7', upload: 'M12 17V5m0 0l-4 4m4-4l4 4M4 19h16', ext: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  copy: 'M8 8h12v12H8zM4 16V4h12', box: 'M12 3l8 4.5v9L12 21l-8-4.5v-9z', term: 'M4 5h16v14H4zM7 9l3 3-3 3M12 15h5',
};
const fmt = (n) => Intl.NumberFormat('de', { notation: 'compact' }).format(n || 0);
const ago = (t) => {
  if (!t) return 'nie';
  const d = (Date.now() - t) / 1000;
  if (d < 60) return 'gerade eben';
  if (d < 3600) return `vor ${Math.floor(d / 60)} Min.`;
  if (d < 86400) return `vor ${Math.floor(d / 3600)} Std.`;
  return `vor ${Math.floor(d / 86400)} Tagen`;
};
const loaderName = (l) => ({ vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', neoforge: 'NeoForge', forge: 'Forge' })[l] || l;

function toast(text, error = false) {
  const t = h('div', { class: 'toast' + (error ? ' error' : '') }, text);
  $('#toasts').append(t);
  setTimeout(() => {
    t.style.transition = 'opacity .3s, transform .3s';
    t.style.opacity = '0';
    t.style.transform = 'translateY(8px)';
    setTimeout(() => t.remove(), 300);
  }, 4200);
}

async function call(fn, ...args) {
  const r = await fn(...args);
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

// pressed buttons get a small ripple
document.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('.btn');
  if (!b) return;
  const r = b.getBoundingClientRect();
  const size = Math.max(r.width, r.height);
  if (getComputedStyle(b).position === 'static') b.style.position = 'relative';
  b.style.overflow = 'hidden';
  const dot = h('span', { class: 'ripple', style: `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px` });
  b.append(dot);
  setTimeout(() => dot.remove(), 600);
});
// light behind the glass follows the mouse (smoothed)
let lx = innerWidth / 2, ly = innerHeight / 2, tx = lx, ty = ly;
document.addEventListener('mousemove', (e) => { tx = e.clientX; ty = e.clientY; });
(function followLight() {
  lx += (tx - lx) * 0.12;
  ly += (ty - ly) * 0.12;
  document.documentElement.style.setProperty('--mx', lx + 'px');
  document.documentElement.style.setProperty('--my', ly + 'px');
  requestAnimationFrame(followLight);
})();
// pixel night sky behind everything: twinkling stars, a few shooting stars, slow drift with the mouse
(function sky() {
  const c = document.getElementById('sky');
  const g = c.getContext('2d');
  const S = 3;
  const stars = Array.from({ length: 160 }, () => ({ x: Math.random(), y: Math.random(), p: Math.random() * 6, b: Math.random() }));
  let shoot = null;
  function frame(t) {
    const w = Math.ceil(innerWidth / S), hh = Math.ceil(innerHeight / S);
    if (c.width !== w || c.height !== hh) { c.width = w; c.height = hh; }
    g.clearRect(0, 0, w, hh);
    const ox = (lx / innerWidth - 0.5) * 6, oy = (ly / innerHeight - 0.5) * 4;
    for (const s of stars) {
      const a = (0.15 + 0.55 * s.b) * (0.5 + 0.5 * Math.sin(t / 900 + s.p));
      g.fillStyle = `rgba(255,255,255,${a.toFixed(2)})`;
      g.fillRect(Math.floor(s.x * w + ox * s.b), Math.floor(s.y * hh + oy * s.b), 1, 1);
    }
    if (!shoot && Math.random() < 0.004) shoot = { x: Math.random() * w * 0.7, y: Math.random() * hh * 0.4, life: 0 };
    if (shoot) {
      shoot.life += 1;
      for (let i = 0; i < 10; i++) {
        g.fillStyle = `rgba(255,255,255,${((1 - i / 10) * (1 - shoot.life / 40)).toFixed(2)})`;
        g.fillRect(Math.floor(shoot.x + (shoot.life - i) * 2), Math.floor(shoot.y + (shoot.life - i)), 1, 1);
      }
      if (shoot.life > 40) shoot = null;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
// border highlight follows the mouse
document.addEventListener('mousemove', (e) => {
  const el = e.target.closest?.('.hl');
  if (!el) return;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--cx', e.clientX - r.left + 'px');
  el.style.setProperty('--cy', e.clientY - r.top + 'px');
});

// ================================================================= pixel art (seeded per instance)
function hash(str) {
  let x = 2166136261;
  for (const c of str) x = Math.imul(x ^ c.charCodeAt(0), 16777619);
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 10000) / 10000;
  };
}
function accentRgb() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#9d5cff';
  const n = parseInt(v.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** small symmetric pixel icon, like a Minecraft item */
function pixelIcon(seed, size = 34) {
  const c = h('canvas', { width: 8, height: 8 });
  const g = c.getContext('2d');
  const rnd = hash(seed);
  const [r, gr, b] = accentRgb();
  const shift = rnd() * 80 - 40;
  g.fillStyle = `rgb(${(r * 0.25) | 0},${(gr * 0.22) | 0},${(b * 0.3) | 0})`;
  g.fillRect(0, 0, 8, 8);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 4; x++) {
      if (rnd() < 0.5) continue;
      const k = 0.55 + rnd() * 0.6;
      g.fillStyle = `rgb(${Math.min(255, r * k + shift) | 0},${Math.min(255, gr * k) | 0},${Math.min(255, b * k - shift) | 0})`;
      g.fillRect(x, y, 1, 1);
      g.fillRect(7 - x, y, 1, 1);
    }
  }
  return h('div', { class: 'icon' + (size > 40 ? ' lg' : '') }, c);
}
/** wide pixel landscape for the instance banner, with a few twinkling pixels */
function pixelBanner(seed) {
  const c = h('canvas', { width: 160, height: 48 });
  const g = c.getContext('2d');
  const rnd = hash(seed + 'banner');
  const [r, gr, b] = accentRgb();
  for (let y = 0; y < 48; y++) {
    for (let x = 0; x < 160; x++) {
      const k = 0.1 + (y / 48) * 0.25 + rnd() * 0.05;
      g.fillStyle = `rgb(${(r * k) | 0},${(gr * k * 0.8) | 0},${(b * k) | 0})`;
      g.fillRect(x, y, 1, 1);
    }
  }
  // blocky hills
  let hgt = 30;
  for (let x = 0; x < 160; x += 2) {
    hgt = Math.max(16, Math.min(40, hgt + Math.round((rnd() - 0.5) * 6)));
    for (let y = hgt; y < 48; y++) {
      const k = 0.06 + rnd() * 0.04;
      g.fillStyle = `rgb(${(r * k) | 0},${(gr * k) | 0},${(b * k * 1.2) | 0})`;
      g.fillRect(x, y, 2, 1);
    }
  }
  const stars = Array.from({ length: 26 }, () => [Math.floor(rnd() * 160), Math.floor(rnd() * 24), rnd() * 6]);
  const base = g.getImageData(0, 0, 160, 48);
  let alive = true;
  (function twinkle(t) {
    if (!alive) return;
    if (!c.isConnected && t > 1000) {
      alive = false;
      return;
    }
    g.putImageData(base, 0, 0);
    for (const [x, y, p] of stars) {
      const a = 0.25 + 0.75 * Math.max(0, Math.sin(t / 700 + p));
      g.fillStyle = `rgba(255,255,255,${a.toFixed(2)})`;
      g.fillRect(x, y, 1, 1);
    }
    setTimeout(() => requestAnimationFrame(twinkle), 90);
  })(0);
  return c;
}

// ================================================================= state, library, chrome
const THEME_DEFAULT = { accent2: '#29d3ff', bg: 'sky', glass: 48, blur: 22, radius: 12, font: 13.5, light: 100, stars: true, motion: true, v2: true, compact: false, library: true, bgDim: 45, gradAngle: 135, solid: '#0b0b12' };
const PRESETS = [
  { name: 'Counter', accent: '#9d5cff', theme: { accent2: '#29d3ff', bg: 'sky', glass: 48, blur: 22 } },
  { name: 'Mitternacht', accent: '#5b6cff', theme: { accent2: '#0f1a4a', bg: 'sky', glass: 62, blur: 28 } },
  { name: 'Sonnenuntergang', accent: '#ff7a59', theme: { accent2: '#c64fd8', bg: 'gradient', gradAngle: 160, glass: 40, blur: 24 } },
  { name: 'Ozean', accent: '#2ac9ff', theme: { accent2: '#1b3a8c', bg: 'gradient', gradAngle: 200, glass: 45, blur: 26 } },
  { name: 'Aurora', accent: '#2ee6a8', theme: { accent2: '#7b5cff', bg: 'gradient', gradAngle: 120, glass: 42, blur: 24 } },
  { name: 'Candy', accent: '#ff8ad8', theme: { accent2: '#8ad2ff', bg: 'gradient', gradAngle: 45, glass: 38, blur: 20 } },
  { name: 'Blutmond', accent: '#ff3b5c', theme: { accent2: '#3a0a14', bg: 'sky', glass: 55, blur: 22 } },
  { name: 'Mono', accent: '#d8d8e0', theme: { accent2: '#6b6b78', bg: 'solid', solid: '#0a0a0c', glass: 60, blur: 10, stars: false } },
];
let bgImage = null;
function theme() {
  return { ...THEME_DEFAULT, ...(state.settings.theme || {}) };
}
/** applies the design settings to the whole window (live, without reloading) */
function applyTheme(t = theme(), accent = state.settings.accent) {
  const r = document.documentElement.style;
  r.setProperty('--accent', accent || '#9d5cff');
  r.setProperty('--accent-2', t.accent2);
  r.setProperty('--glass-a', (t.glass / 100).toFixed(2));
  r.setProperty('--blur', t.blur + 'px');
  r.setProperty('--radius', t.radius + 'px');
  r.setProperty('--font', t.font + 'px');
  r.setProperty('--light', (t.light / 100).toFixed(2));
  r.setProperty('--bg-dim', (t.bgDim / 100).toFixed(2));
  r.setProperty('--grad-angle', t.gradAngle + 'deg');
  r.setProperty('--solid-bg', t.solid);
  r.setProperty('--bg-image', bgImage ? `url("${bgImage}")` : 'none');
  const b = document.body.classList;
  b.toggle('no-stars', !t.stars || t.bg !== 'sky');
  b.toggle('no-motion', !t.motion);
  b.toggle('v2', t.v2 !== false);
  b.toggle('compact', !!t.compact);
  b.toggle('no-library', !t.library);
  for (const m of ['solid', 'gradient', 'image']) b.toggle('bg-' + m, t.bg === m);
}
async function saveTheme(patch, accent) {
  const t = { ...(state.settings.theme || {}), ...patch };
  await call(api.setSettings, accent ? { theme: t, accent } : { theme: t });
  state.settings.theme = t;
  if (accent) state.settings.accent = accent;
  applyTheme();
}

async function refresh() {
  state = await call(api.state);
  applyTheme();
  drawLibrary();
}
const selected = () => state.instances.find((i) => i.id === state.selectedInstance) || state.instances[0];
const instById = (id) => state.instances.find((i) => i.id === id);

function drawLibrary() {
  const filter = $('#lib-filter').value.toLowerCase();
  const list = state.instances.filter((i) => !filter || i.name.toLowerCase().includes(filter)).sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
  $('#lib-list').replaceChildren(...list.map((i) => {
    const running = state.running.includes(i.id);
    const active = route.page === 'instance' && route.id === i.id;
    return h('div', { class: 'lib-item' + (active ? ' active' : '') + (running ? ' running' : ''), onclick: () => go({ page: 'instance', id: i.id }) },
      pixelIcon(i.id),
      h('div', { class: 'grow' }, h('div', { class: 't' }, i.name), h('div', { class: 'm' }, `${i.mcVersion} · ${loaderName(i.loader)}${i.counter ? ' · Counter' : ''}`)),
      h('button', { class: 'mini-play' + (running ? ' on' : ''), title: running ? 'Stoppen' : 'Spielen', onclick: (e) => { e.stopPropagation(); play(i); } }, svg(running ? I.stop : I.play)));
  }));
  const acc = state.accounts.find((a) => a.uuid === state.activeAccount);
  $('#lib-account').replaceChildren(
    acc ? h('img', { src: `https://mc-heads.net/avatar/${acc.type === 'msa' ? acc.uuid : 'MHF_Steve'}/28`, alt: '' }) : h('div', { class: 'ph' }),
    h('div', { class: 'grow' }, h('div', { style: 'font-weight:600' }, acc ? acc.name : 'Kein Konto'), h('div', { class: 'muted', style: 'font-size:11.5px' }, acc ? (acc.type === 'msa' ? 'Microsoft' : acc.type === 'official' ? 'über Minecraft Launcher' : 'Offline') : 'Klicken zum Hinzufügen')));
}
$('#lib-filter').addEventListener('input', drawLibrary);
$('#lib-account').addEventListener('click', () => go({ page: 'accounts' }));
$('#new-instance').addEventListener('click', createInstanceModal);
document.querySelectorAll('[data-win]').forEach((b) => b.addEventListener('click', () => api.win(b.dataset.win)));
document.querySelectorAll('.nav').forEach((b) => b.addEventListener('click', () => go({ page: b.dataset.page })));
$('#console-close').addEventListener('click', () => $('#console').classList.add('hidden'));

// status line + top progress bar
const progress = h('div', { id: 'progress' });
document.body.append(progress);
api.on('status', (t) => {
  $('#status').textContent = t || '';
  const m = /(\d+)\/(\d+)/.exec(t || '');
  progress.style.opacity = t ? '1' : '0';
  progress.style.width = m ? `${(m[1] / m[2]) * 100}%` : t ? '12%' : '100%';
});
api.on('log', ({ line }) => {
  const pre = $('#console-log');
  pre.textContent += line;
  if (pre.textContent.length > 200000) pre.textContent = pre.textContent.slice(-150000);
  pre.scrollTop = pre.scrollHeight;
});
api.on('running', async (ids) => {
  state.running = ids;
  drawLibrary();
  if (route.page === 'home' || route.page === 'instance') render();
});

// ================================================================= updates
let updateInfo = { state: 'idle' };
const updatePill = h('button', { class: 'update-pill hidden', onclick: () => updateInfo.state === 'ready' && api.installUpdate() });
$('#titlebar').insertBefore(updatePill, $('#status'));
function drawUpdate() {
  const u = updateInfo;
  updatePill.classList.toggle('hidden', !['downloading', 'ready'].includes(u.state));
  updatePill.classList.toggle('ready', u.state === 'ready');
  updatePill.textContent = u.state === 'ready' ? `Update ${u.newVersion} bereit – neu starten` : `Update ${u.newVersion || ''} lädt … ${u.percent || 0}%`;
}
api.on('update', (u) => {
  const before = updateInfo.state;
  updateInfo = u;
  drawUpdate();
  if (u.state === 'ready' && before !== 'ready') toast(`Launcher-Update ${u.newVersion} ist bereit – oben rechts klicken zum Neustarten`);
  if (u.counter) toast(`Counter ${u.counter} heruntergeladen – wird beim nächsten Start benutzt`);
  if (route.page === 'settings') render();
});

// ================================================================= routing
function go(r) {
  route = r;
  document.querySelectorAll('.nav').forEach((b) => b.classList.toggle('active', b.dataset.page === r.page));
  drawLibrary();
  render();
}
async function render() {
  const view = h('div', { class: 'page' });
  await window.transition(() => {
    $('#content').replaceChildren(view);
    $('#content').scrollTop = 0;
  });
  const pages = { home, instance, browse, project, import: importPage, accounts, settings, news: (v) => newsPage(v) };
  const names = { news: 'Neuigkeiten', home: 'Start', instance: 'Instanz', browse: 'Entdecken', project: 'Projekt', import: 'Importieren', accounts: 'Konten', settings: 'Einstellungen' };
  $('#crumbs').replaceChildren(h('span', {}, 'Counter'), '/', h('b', {}, route.page === 'instance' ? (instById(route.id) || selected())?.name || '' : names[route.page]));
  try {
    await pages[route.page](view, route);
  } catch (e) {
    view.append(h('div', { class: 'empty' }, h('b', {}, 'Fehler'), e.message));
  }
}

// ================================================================= play
async function play(inst, opts = {}) {
  if (busy.has(inst.id)) return;
  if (state.running.includes(inst.id)) {
    await call(api.stop, inst.id);
    return;
  }
  busy.add(inst.id);
  if (route.page === 'home' || route.page === 'instance') render();
  try {
    const r = await call(api.play, inst.id, opts);
    if (r && r.official) toast(`Minecraft Launcher öffnet sich – dort ist „${r.official}“ ausgewählt, einfach auf Spielen drücken`);
    else toast(`${inst.name} startet`);
  } catch (e) {
    if (e.message === 'NO_ACCOUNT') {
      toast('Füge zuerst ein Konto hinzu', true);
      go({ page: 'accounts' });
    } else toast(e.message, true);
  } finally {
    busy.delete(inst.id);
    $('#status').textContent = '';
    progress.style.opacity = '0';
    await refresh();
    if (route.page === 'home' || route.page === 'instance') render();
  }
}
function playButton(inst) {
  const running = state.running.includes(inst.id);
  const loading = busy.has(inst.id);
  return h('button', { class: 'btn primary play' + (running ? ' running' : ''), onclick: (e) => { if (!running) window.pixelBurst(e.currentTarget); play(inst); } },
    loading ? [h('span', { class: 'spin' }), 'Startet'] : running ? [svg(I.stop), 'Stoppen'] : [svg(I.play), 'Spielen']);
}

// ================================================================= home
async function home(view) {
  const inst = [...state.instances].sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0))[0];
  const acc = state.accounts.find((a) => a.uuid === state.activeAccount);
  if (inst) {
    view.append(
      h('div', { class: 'label' }, acc ? `Hallo ${acc.name}` : 'Willkommen'),
      h('div', { class: 'banner', style: 'margin-top:10px' }, pixelBanner(inst.id + (inst.bannerSeed || '')),
        h('div', { class: 'over' }, instIcon(inst, 72),
          h('div', { class: 'grow' }, h('div', { class: 'label' }, 'Weiterspielen'), h('h1', {}, inst.name),
            h('div', { class: 'row', style: 'margin-top:6px' }, h('span', { class: 'tag a' }, inst.mcVersion), h('span', { class: 'tag' }, loaderName(inst.loader)), inst.counter && h('span', { class: 'tag a' }, 'Counter'), h('span', { class: 'muted', style: 'font-size:12px' }, `zuletzt ${ago(inst.lastPlayed)}`))),
          h('button', { class: 'btn', onclick: () => go({ page: 'instance', id: inst.id }) }, 'Öffnen'),
          playButton(inst))));
  }
  view.append(h('h2', {}, 'Alle Instanzen'),
    h('div', { class: 'grid stagger' }, state.instances.map((i, n) =>
      h('div', { class: 'panel tile hl', style: `animation-delay:${n * 35}ms`, onclick: () => go({ page: 'instance', id: i.id }) },
        instIcon(i), h('div', { class: 't' }, i.name), h('div', { class: 'muted', style: 'font-size:12px' }, `${i.mcVersion} · ${loaderName(i.loader)}`))),
    h('div', { class: 'panel tile hl', onclick: createInstanceModal, style: 'display:grid;place-items:center;border-style:dashed;min-height:110px' }, h('div', { class: 'muted' }, '+ Neue Instanz'))));
  const packs = h('div', { class: 'grid stagger' }, Array.from({ length: 4 }, () => h('div', { class: 'skeleton', style: 'height:150px' })));
  view.append(h('div', { class: 'row', style: 'margin-top:28px' }, h('h2', { style: 'margin:0', class: 'grow' }, 'Beliebte Modpacks'), h('button', { class: 'btn sm ghost', onclick: () => go({ page: 'browse', type: 'modpack' }) }, 'Alle ansehen')), h('div', { style: 'height:12px' }), packs);
  try {
    const r = await call(api.search, 'modrinth', '', 'modpack', inst?.id, 0);
    packs.replaceChildren(...r.hits.slice(0, 8).map((m, n) =>
      h('div', { class: 'panel tile hl', style: `animation-delay:${n * 35}ms`, onclick: () => go({ page: 'project', id: m.project_id, source: 'modrinth', type: 'modpack' }) },
        m.icon_url ? h('img', { src: m.icon_url, class: 'icon', style: 'width:44px;height:44px' }) : pixelIcon(m.project_id),
        h('div', { class: 't' }, m.title), h('div', { class: 'muted', style: 'font-size:12px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden' }, m.description),
        h('div', { class: 'muted', style: 'font-size:11.5px;margin-top:6px' }, h('span', { 'data-count': m.downloads || 0 }, fmt(m.downloads)), ' Downloads'))));
  } catch {
    packs.replaceChildren(h('div', { class: 'muted' }, 'Keine Verbindung zu Modrinth'));
  }
}

// ================================================================= create instance
async function createInstanceModal() {
  const data = { name: '', mcVersion: '', loader: 'fabric', counter: false };
  let filter = 'release', all = [];
  const list = h('div', { class: 'vlist' }, h('div', { class: 'skeleton', style: 'height:200px' }));
  const loaderInfo = h('div', { class: 'muted', style: 'margin-top:8px;font-size:12.5px' });
  const counterRow = h('div', { style: 'margin-top:12px' });
  const draw = () => {
    const shown = all.filter((v) => (filter === 'all' ? true : filter === 'snapshot' ? v.type === 'snapshot' : filter === 'old' ? v.type.startsWith('old') : v.type === 'release'));
    list.replaceChildren(...shown.map((v) => h('button', { class: v.id === data.mcVersion ? 'on' : '', onclick: () => { data.mcVersion = v.id; draw(); check(); } }, h('span', { class: 'grow' }, v.id), h('span', { class: 'muted', style: 'font-size:12px' }, new Date(v.time).toLocaleDateString()))));
  };
  async function check() {
    loaderInfo.textContent = '';
    counterRow.replaceChildren();
    if (!data.mcVersion) return;
    if (data.loader !== 'vanilla') {
      loaderInfo.textContent = `Suche ${loaderName(data.loader)} …`;
      const r = await api.loaders(data.mcVersion, data.loader);
      loaderInfo.textContent = r.ok && r.data ? `${loaderName(data.loader)} ${r.data} wird installiert` : `${loaderName(data.loader)} gibt es für ${data.mcVersion} nicht`;
    }
    // Counter runs on all 26.1 versions; further versions are added as their ports are finished
    const fams = state.counterFamilies && state.counterFamilies.length ? state.counterFamilies : ['26.1'];
    if (fams.includes(data.mcVersion.split('.').slice(0, 2).join('.')) && data.loader === 'fabric') {
      const sw = h('span', { class: 'switch' + (data.counter ? ' on' : '') });
      counterRow.append(h('button', { class: 'row', onclick: () => { data.counter = !data.counter; sw.classList.toggle('on', data.counter); } }, sw, 'Counter Client installieren'));
    } else {
      data.counter = false;
      if (data.loader === 'fabric') counterRow.append(h('span', { class: 'muted', style: 'font-size:12px' }, `Counter gibt es gerade für ${fams.join(', ')} – weitere Versionen folgen`));
    }
  }
  const seg = (opts, get, set) => {
    const el = h('div', { class: 'seg' });
    for (const [k, l] of opts) el.append(h('button', { class: k === get() ? 'on' : '', onclick: (e) => { set(k); el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.currentTarget)); } }, l));
    return el;
  };
  modal(h('div', {},
    h('h2', {}, 'Neue Instanz'),
    h('input', { placeholder: 'Name (optional)', style: 'width:100%', oninput: (e) => (data.name = e.target.value) }),
    h('div', { class: 'label', style: 'margin:16px 0 8px' }, 'Mod-Loader'),
    seg([['vanilla', 'Vanilla'], ['fabric', 'Fabric'], ['quilt', 'Quilt'], ['neoforge', 'NeoForge'], ['forge', 'Forge']], () => data.loader, (k) => { data.loader = k; check(); }),
    loaderInfo,
    h('div', { class: 'label', style: 'margin:16px 0 8px' }, 'Minecraft-Version'),
    seg([['release', 'Releases'], ['snapshot', 'Snapshots'], ['old', 'Beta & Alpha'], ['all', 'Alle']], () => filter, (k) => { filter = k; draw(); }),
    list, counterRow,
    h('div', { class: 'row', style: 'margin-top:18px;justify-content:flex-end' },
      h('button', { class: 'btn ghost', onclick: closeModal }, 'Abbrechen'),
      h('button', { class: 'btn primary', onclick: async () => {
        if (!data.mcVersion) return toast('Wähle eine Version', true);
        const inst = await call(api.createInstance, { ...data, name: data.name || `${loaderName(data.loader)} ${data.mcVersion}` });
        closeModal();
        await refresh();
        go({ page: 'instance', id: inst.id });
      } }, 'Erstellen'))));
  try {
    const v = await call(api.versions);
    all = v.versions;
    data.mcVersion = v.latest.release;
    draw();
    check();
  } catch (e) {
    list.replaceChildren(h('div', { class: 'empty' }, e.message));
  }
}

// ================================================================= instance page
async function instance(view, r) {
  const inst = instById(r.id) || selected();
  if (!inst) return go({ page: 'home' });
  const tab = r.tab || 'content';
  view.append(h('div', { class: 'banner' }, pixelBanner(inst.id),
    h('div', { class: 'over' }, pixelIcon(inst.id, 72),
      h('div', { class: 'grow' }, h('h1', {}, inst.name),
        h('div', { class: 'row', style: 'margin-top:6px' }, h('span', { class: 'tag a' }, inst.mcVersion), h('span', { class: 'tag' }, loaderName(inst.loader)), inst.counter && h('span', { class: 'tag a' }, 'Counter'), inst.importedFrom && h('span', { class: 'tag' }, `aus ${inst.importedFrom}`),
          h('span', { class: 'muted', style: 'font-size:12px' }, `Spielzeit ${Math.round((inst.playTime || 0) / 3600000)} Std. · zuletzt ${ago(inst.lastPlayed)}`))),
      h('button', { class: 'btn', title: 'Ordner öffnen', onclick: () => call(api.openInstance, inst.id) }, svg(I.folder)),
      h('button', { class: 'btn', title: 'Konsole', onclick: () => $('#console').classList.toggle('hidden') }, svg(I.term)),
      playButton(inst))));
  const tabs = [['content', 'Inhalte'], ['worlds', 'Welten'], ['servers', 'Server'], ['screenshots', 'Screenshots'], ['logs', 'Logs'], ['tools', 'Werkzeuge'], ['options', 'Einstellungen']];
  view.append(h('div', { class: 'tabs' }, tabs.map(([k, l]) => h('button', { class: k === tab ? 'on' : '', onclick: () => go({ ...r, tab: k }) }, l))));
  const body = h('div', {});
  view.append(body);
  await ({ content: tabContent, worlds: tabWorlds, servers: tabServers, screenshots: tabShots, logs: tabLogs, tools: tabTools, options: tabOptions })[tab](body, inst, r);
}

let contentType = 'mod';
let dropTarget = null;
async function tabContent(body, inst) {
  const filter = h('input', { placeholder: 'Installierte filtern', style: 'width:220px' });
  const list = h('div', { class: 'list panel stagger' });
  let files = [];
  const draw = () => {
    const f = filter.value.toLowerCase();
    const shown = files.filter((x) => !f || (x.name || x.file).toLowerCase().includes(f));
    list.replaceChildren(...(shown.length ? shown.map((x, n) =>
      h('div', { class: 'lrow' + (x.enabled ? '' : ' off'), style: `animation-delay:${Math.min(n, 20) * 18}ms` },
        x.icon ? h('img', { src: x.icon, class: 'icon' }) : pixelIcon(x.file),
        h('div', { class: 'grow' }, h('div', { class: 'name' }, x.name || x.file.replace(/\.disabled$/, '')), h('div', { class: 'meta' }, [x.version, x.authors, x.file].filter(Boolean).join(' · ')), contentType === 'mod' ? modMetaLine(inst, x) : null),
        h('div', { class: 'actions' },
          ...(contentType === 'mod' ? modMetaButtons(inst, x, draw) : []),
          h('button', { class: 'switch' + (x.enabled ? ' on' : ''), title: 'An/Aus', onclick: async () => { await call(api.toggleContent, inst.id, contentType, x.file); load(); } }),
          h('button', { class: 'btn sm ghost danger', title: 'Entfernen', onclick: async () => { await call(api.removeContent, inst.id, contentType, x.file); load(); } }, svg(I.trash))))) :
      [h('div', { class: 'empty' }, h('b', {}, 'Hier ist noch nichts'), 'Suche auf Modrinth / CurseForge oder ziehe eigene Dateien in das Fenster.')]));
  };
  async function load() {
    files = await call(api.listContent, inst.id, contentType);
    draw();
  }
  filter.addEventListener('input', draw);
  const seg = h('div', { class: 'seg' }, [['mod', 'Mods'], ['resourcepack', 'Ressourcenpakete'], ['shader', 'Shader']].map(([k, l]) => h('button', { class: k === contentType ? 'on' : '', onclick: () => { contentType = k; render(); } }, l)));
  const updates = h('button', { class: 'btn', onclick: async () => {
    updates.disabled = true;
    updates.replaceChildren(h('span', { class: 'spin' }), 'Prüfe …');
    try {
      const u = await call(api.checkUpdates, inst.id);
      if (!u.length) toast('Alle Mods sind aktuell');
      else confirmModal(`${u.length} Update(s) gefunden:\n${u.map((x) => `${x.name} → ${x.version}`).join('\n')}`, async () => { await call(api.applyUpdates, inst.id, u); toast(`${u.length} Mod(s) aktualisiert`); load(); }, 'Aktualisieren');
    } catch (e) {
      toast(e.message, true);
    }
    updates.disabled = false;
    updates.replaceChildren(svg(I.refresh), 'Updates');
  } }, svg(I.refresh), 'Updates');
  body.append(h('div', { class: 'row', style: 'margin-bottom:12px' }, seg, filter, h('div', { class: 'grow' }),
    contentType === 'mod' && updates,
    h('button', { class: 'btn', onclick: async () => { const a = await call(api.addContent, inst.id, contentType, []); if (a.length) toast(`${a.length} Datei(en) hinzugefügt`); load(); } }, svg(I.upload), 'Eigene Dateien'),
    h('button', { class: 'btn primary', onclick: () => go({ page: 'browse', instance: inst.id, type: contentType }) }, svg(I.plus), 'Inhalte hinzufügen')), list);
  dropTarget = { instance: inst.id, after: load };
  load();
}

async function tabWorlds(body, inst) {
  const w = await call(api.worlds, inst.id);
  body.append(w.length ? h('div', { class: 'list panel stagger' }, w.map((x, n) => h('div', { class: 'lrow', style: `animation-delay:${n * 20}ms` },
    x.icon ? h('img', { src: x.icon, class: 'icon' }) : pixelIcon(x.name), h('div', { class: 'grow' }, h('div', { class: 'name' }, x.name), h('div', { class: 'meta' }, `gespielt ${ago(x.modified)}`)))))
    : h('div', { class: 'empty panel' }, h('b', {}, 'Keine Welten'), 'Erstelle im Spiel eine Welt oder importiere eine Instanz mit Welten.'));
}

async function tabServers(body, inst) {
  let list = await call(api.servers, inst.id);
  const wrap = h('div', {});
  const name = h('input', { placeholder: 'Name' }), ip = h('input', { placeholder: 'Adresse, z. B. play.astraxsmp.de', class: 'grow' });
  const save = async () => { await call(api.saveServers, inst.id, list); draw(); };
  const draw = () => wrap.replaceChildren(list.length ? h('div', { class: 'list panel stagger' }, list.map((s, i) => h('div', { class: 'lrow' },
    s.icon ? h('img', { src: 'data:image/png;base64,' + s.icon, class: 'icon' }) : pixelIcon(s.ip),
    h('div', { class: 'grow' }, h('div', { class: 'name' }, s.name), h('div', { class: 'meta' }, s.ip)),
    h('div', { class: 'actions' },
      h('button', { class: 'btn sm ghost', disabled: i === 0, onclick: () => { list.splice(i - 1, 0, list.splice(i, 1)[0]); save(); } }, '↑'),
      h('button', { class: 'btn sm ghost danger', onclick: () => { list.splice(i, 1); save(); } }, svg(I.trash))))))
    : h('div', { class: 'empty panel' }, h('b', {}, 'Keine Server'), 'Füge unten einen Server hinzu – er erscheint im Spiel in der Serverliste.'));
  body.append(wrap, h('div', { class: 'row', style: 'margin-top:12px' }, name, ip, h('button', { class: 'btn primary', onclick: () => { if (!ip.value.trim()) return; list.push({ name: name.value.trim() || ip.value.trim(), ip: ip.value.trim() }); name.value = ip.value = ''; save(); } }, svg(I.plus), 'Hinzufügen')));
  draw();
}

async function tabShots(body, inst) {
  const s = await call(api.screenshots, inst.id);
  body.append(s.length ? h('div', { class: 'shots stagger' }, s.map((x, n) => h('img', { src: x.data, title: x.name, style: `animation-delay:${n * 25}ms`, onclick: () => call(api.openScreenshot, x.path) })))
    : h('div', { class: 'empty panel' }, h('b', {}, 'Keine Screenshots'), 'Drücke im Spiel F2.'));
}

async function tabLogs(body, inst) {
  const logs = await call(api.logs, inst.id);
  const view = h('pre', { class: 'logview' }, 'Wähle einen Log');
  const show = async (l) => {
    const text = await call(api.readLog, l.path);
    view.replaceChildren(...text.split('\n').map((line) => h('div', { class: /ERROR|Exception|FATAL|Caused by/.test(line) ? 'e' : /WARN/.test(line) ? 'w' : '' }, line)));
    view.scrollTop = l.crash ? 0 : view.scrollHeight;
  };
  body.append(logs.length ? h('div', { style: 'display:grid;grid-template-columns:240px 1fr;gap:14px' },
    h('div', { class: 'list panel', style: 'max-height:460px;overflow:auto' }, logs.map((l) => h('div', { class: 'lrow', style: 'cursor:pointer', onclick: () => show(l) },
      h('div', { class: 'grow' }, h('div', { class: 'name', style: l.crash ? 'color:var(--red)' : '' }, l.crash ? 'Absturz' : 'Letzter Start'), h('div', { class: 'meta' }, `${l.name} · ${ago(l.time)}`))))), view)
    : h('div', { class: 'empty panel' }, h('b', {}, 'Noch keine Logs'), 'Starte die Instanz einmal.'));
  if (logs[0]) show(logs[0]);
}

async function tabOptions(body, inst) {
  const set = async (patch) => { await call(api.updateInstance, inst.id, patch); await refresh(); };
  const ram = h('span', {}, inst.ramMb ? `${(inst.ramMb / 1024).toFixed(1)} GB` : 'Standard');
  body.append(h('div', { class: 'form panel' },
    h('label', {}, 'Name'), h('input', { value: inst.name, onchange: (e) => set({ name: e.target.value.trim() || inst.name }) }),
    h('label', {}, 'Minecraft-Version'), h('input', { value: inst.mcVersion, onchange: (e) => set({ mcVersion: e.target.value.trim(), loaderVersion: '' }) }),
    h('div', { class: 'hint' }, 'Mods müssen zur Version passen. Prüfe danach die Updates.'),
    h('label', {}, 'Mod-Loader'), h('select', { onchange: (e) => set({ loader: e.target.value, loaderVersion: '' }) }, ['vanilla', 'fabric', 'quilt', 'neoforge', 'forge'].map((l) => h('option', { value: l, selected: l === inst.loader }, loaderName(l)))),
    h('label', {}, 'Arbeitsspeicher'), h('div', { class: 'row' }, h('input', { type: 'range', min: 0, max: 16384, step: 512, value: inst.ramMb || 0, class: 'grow', oninput: (e) => (ram.textContent = Number(e.target.value) ? `${(e.target.value / 1024).toFixed(1)} GB` : 'Standard'), onchange: (e) => set({ ramMb: Number(e.target.value) || 0 }) }), ram),
    h('label', {}, 'Java (leer = automatisch)'), h('input', { value: inst.javaPath || '', onchange: (e) => set({ javaPath: e.target.value.trim() }) }),
    h('label', {}, 'JVM-Argumente'), h('input', { value: inst.jvmArgs || '', placeholder: 'Standard aus den Einstellungen', onchange: (e) => set({ jvmArgs: e.target.value }) })),
    h('h2', {}, 'Aktionen'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: async () => { try { const n = await call(api.exportOfficial, inst.id); toast(`Profil „${n}“ im Minecraft Launcher angelegt`); } catch (e) { toast(e.message, true); } } }, svg(I.ext), 'Im Minecraft Launcher öffnen'),
      h('button', { class: 'btn', onclick: async () => { const c = await call(api.duplicateInstance, inst.id); await refresh(); go({ page: 'instance', id: c.id }); } }, svg(I.copy), 'Duplizieren'),
      h('button', { class: 'btn danger', onclick: () => confirmModal(`„${inst.name}“ löschen? Die Dateien kommen in den Papierkorb.`, async () => { await call(api.deleteInstance, inst.id); await refresh(); go({ page: 'home' }); }, 'Löschen') }, svg(I.trash), 'Löschen')),
    h('p', { class: 'muted', style: 'margin-top:10px;font-size:12px' }, '„Im Minecraft Launcher öffnen“ legt ein Profil im offiziellen Launcher an. Dort meldet dich Microsoft an, damit kannst du auch ohne eigene Azure-App online spielen.'));
}

// drag and drop of own files onto an open instance
document.addEventListener('dragover', (e) => {
  if (route.page !== 'instance') return;
  e.preventDefault();
  $('#drop-hint').classList.remove('hidden');
});
document.addEventListener('dragleave', (e) => { if (e.relatedTarget == null) $('#drop-hint').classList.add('hidden'); });
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  $('#drop-hint').classList.add('hidden');
  if (route.page !== 'instance' || !dropTarget) return;
  const files = [...e.dataTransfer.files].map((f) => api.filePath(f)).filter(Boolean);
  if (!files.length) return;
  const added = await call(api.addContent, dropTarget.instance, contentType, files);
  toast(`${added.length} Datei(en) hinzugefügt`);
  dropTarget.after();
});

// ================================================================= browse (infinite scroll)
const browseState = { source: 'modrinth', type: 'mod', query: '', sort: 'relevance', instance: null };
async function browse(view, r) {
  if (r.type) browseState.type = r.type;
  if (r.instance) browseState.instance = r.instance;
  if (!instById(browseState.instance)) browseState.instance = selected()?.id;
  const cfOk = (await api.curseforgeAvailable()).data;
  if (!cfOk) browseState.source = 'modrinth';
  const results = h('div', {});
  const more = h('div', { class: 'loading-more' });
  const query = h('input', { class: 'grow', value: browseState.query, placeholder: `Auf ${browseState.source === 'modrinth' ? 'Modrinth' : 'CurseForge'} suchen …` });
  let offset = 0, done = false, loading = false, seq = 0, timer;
  query.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { browseState.query = query.value; restart(); }, 300); });
  async function loadMore() {
    if (loading || done) return;
    loading = true;
    const my = seq;
    more.replaceChildren(h('span', { class: 'spin', style: 'display:inline-block' }));
    try {
      const res = await call(api.search, browseState.source, browseState.query, browseState.type, browseState.instance, offset);
      if (my !== seq) return;
      offset += res.hits.length;
      if (res.hits.length < 20) done = true;
      results.append(...res.hits.map((m, n) => resultRow(m, n)));
      more.textContent = done ? (offset ? 'Das war alles' : 'Nichts gefunden') : '';
    } catch (e) {
      more.textContent = e.message;
      done = true;
    } finally {
      loading = false;
    }
  }
  function restart() {
    seq++;
    offset = 0;
    done = false;
    loading = false;
    results.replaceChildren();
    loadMore();
  }
  function resultRow(m, n) {
    const btn = h('button', { class: 'btn sm primary', onclick: (e) => { e.stopPropagation(); install(m, btn); } }, browseState.type === 'modpack' ? 'Installieren' : 'Hinzufügen');
    return h('div', { class: 'result', style: `animation:rise .3s ${Math.min(n, 12) * 22}ms both`, onclick: () => go({ page: 'project', id: m.project_id, source: m.source, type: browseState.type }) },
      m.icon_url ? h('img', { src: m.icon_url, alt: '', loading: 'lazy' }) : h('div', { class: 'noimg' }),
      h('div', { class: 'grow' }, h('div', { class: 'row' }, h('span', { class: 'title' }, m.title), m.author && h('span', { class: 'by' }, `von ${m.author}`)),
        h('div', { class: 'desc' }, m.description || ''),
        h('div', { class: 'stats' }, h('span', {}, '↓ ', h('span', { 'data-count': m.downloads || 0 }, fmt(m.downloads))), m.follows != null && h('span', {}, `♥ ${fmt(m.follows)}`), m.date_modified && h('span', {}, `aktualisiert ${ago(Date.parse(m.date_modified))}`))),
      h('div', { class: 'side' }, btn));
  }
  async function install(m, btn) {
    btn.disabled = true;
    btn.replaceChildren(h('span', { class: 'spin' }));
    try {
      const r2 = await call(api.install, m.source, m.project_id, browseState.type, browseState.instance);
      if (browseState.type === 'modpack') { await refresh(); toast(`Modpack „${m.title}“ ist jetzt eine Instanz`); }
      else toast(`${m.title} installiert (${r2.length} Datei(en) mit Abhängigkeiten)`);
      btn.textContent = '✓ Installiert';
    } catch (e) {
      toast(e.message, true);
      btn.disabled = false;
      btn.textContent = 'Nochmal';
    }
  }
  const opt = (label, on, fn, disabled) => h('div', { class: 'opt' + (on ? ' on' : ''), style: disabled ? 'opacity:.4;pointer-events:none' : '', onclick: fn }, h('span', { class: 'box' }), label);
  const filters = h('div', { class: 'filters' },
    h('h4', {}, 'Quelle'),
    opt('Modrinth', browseState.source === 'modrinth', () => { browseState.source = 'modrinth'; render(); }),
    opt('CurseForge' + (cfOk ? '' : ' (API-Schlüssel fehlt)'), browseState.source === 'curseforge', () => { browseState.source = 'curseforge'; render(); }, !cfOk),
    h('h4', {}, 'Typ'),
    [['mod', 'Mods'], ['modpack', 'Modpacks'], ['resourcepack', 'Ressourcenpakete'], ['shader', 'Shader']].map(([k, l]) => opt(l, browseState.type === k, () => { browseState.type = k; render(); })),
    browseState.type !== 'modpack' && [h('h4', {}, 'Für Instanz'),
      h('select', { style: 'width:100%', onchange: (e) => { browseState.instance = e.target.value; restart(); } }, state.instances.map((i) => h('option', { value: i.id, selected: i.id === browseState.instance }, `${i.name} (${i.mcVersion})`)))]);
  view.append(h('h1', {}, 'Entdecken'), h('p', { class: 'sub' }, 'Abhängigkeiten werden automatisch mitinstalliert.'), h('div', { style: 'height:18px' }),
    h('div', { class: 'browse' }, filters, h('div', {}, h('div', { class: 'row', style: 'margin-bottom:8px' }, query), results, more)));
  // load the next page when the bottom comes into view
  const io = new IntersectionObserver((entries) => { if (entries[0].isIntersecting) loadMore(); }, { root: $('#content'), rootMargin: '600px' });
  io.observe(more);
  restart();
}

// ================================================================= project page
/** tiny markdown renderer: everything is escaped first, then a few safe constructs are turned into elements */
function markdown(src) {
  const root = h('div', { class: 'md' });
  const inline = (text) => {
    const out = [];
    const re = /!\[([^\]]*)\]\((https:\/\/[^)\s]+)\)|\[([^\]]+)\]\((https:\/\/[^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|(?<![\w*])\*([^*\s][^*]*?)\*(?![\w*])|~~([^~]+)~~|(https:\/\/[^\s)<>]+[^\s)<>.,;:!?])/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      out.push(text.slice(last, m.index));
      if (m[2]) out.push(h('img', { src: m[2], alt: m[1], loading: 'lazy' }));
      else if (m[4]) out.push(h('a', { href: '#', onclick: (e) => { e.preventDefault(); api.openExternal(m[4]); } }, m[3]));
      else if (m[5]) out.push(h('b', {}, m[5]));
      else if (m[6]) out.push(h('code', {}, m[6]));
      else if (m[7]) out.push(h('i', {}, m[7]));
      else if (m[8]) out.push(h('s', {}, m[8]));
      else if (m[9]) out.push(h('a', { href: '#', onclick: (e) => { e.preventDefault(); api.openExternal(m[9]); } }, m[9]));
      last = re.lastIndex;
    }
    out.push(text.slice(last));
    return out;
  };
  const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  // drop raw HTML tags but keep their text; pull image urls out of <img src>
  const text = (src || '').replace(/<img[^>]*src="(https:\/\/[^"]+)"[^>]*>/gi, '![]($1)').replace(/<br\s*\/?>/gi, '\n').replace(/<(?!\s*\d)[^>]+>/g, '');
  const lines = text.split('\n');
  let listEl = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    // code block with a copy button
    if (/^\s*```/.test(line)) {
      const code = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i]);
      const body = code.join('\n');
      root.append(h('div', { class: 'md-code' }, h('button', { class: 'md-copy', title: 'Kopieren', onclick: () => navigator.clipboard.writeText(body).then(() => toast('Kopiert')) }, '⧉'), h('pre', {}, h('code', {}, body))));
      listEl = null;
      continue;
    }
    // table: header row, separator row, body rows
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = cells(line);
      const rows = [];
      i++;
      while (i + 1 < lines.length && /^\s*\|.*\|\s*$/.test(lines[i + 1])) rows.push(cells(lines[++i]));
      root.append(h('div', { class: 'md-table' }, h('table', {}, h('thead', {}, h('tr', {}, head.map((c) => h('th', {}, inline(c))))), h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, inline(c)))))))));
      listEl = null;
      continue;
    }
    const hd = /^(#{1,4})\s+(.*)$/.exec(line);
    const li = /^\s*[-*•]\s+(.*)$/.exec(line);
    const ol = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    if (li || ol) {
      const tag = ol ? 'ol' : 'ul';
      if (!listEl || listEl.tagName.toLowerCase() !== tag) root.append((listEl = h(tag, ol && ol[1] !== '1' ? { start: ol[1] } : {})));
      listEl.append(h('li', {}, inline(ol ? ol[2] : li[1])));
      continue;
    }
    if (!line.trim()) {
      listEl = null;
      continue;
    }
    listEl = null;
    if (hd) root.append(h('h' + Math.min(5, hd[1].length + 1), {}, inline(hd[2])));
    else if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) root.append(h('hr'));
    else if (/^\s*>\s?/.test(line)) root.append(h('blockquote', {}, inline(line.replace(/^\s*>\s?/, ''))));
    else root.append(h('p', {}, inline(line)));
  }
  return root;
}

async function project(view, r) {
  if (r.source === 'curseforge') {
    view.append(h('div', { class: 'empty' }, h('b', {}, 'CurseForge-Projekt'), 'Für CurseForge-Projekte gibt es nur die Schnellinstallation in der Liste.'));
    return;
  }
  const inst = instById(browseState.instance) || selected();
  const p = await call(api.project, r.id);
  const versions = h('div', { class: 'list panel' }, h('div', { class: 'skeleton', style: 'height:120px;margin:10px' }));
  view.append(
    h('button', { class: 'btn sm ghost', onclick: () => go({ page: 'browse' }) }, '← Zurück'),
    h('div', { class: 'row', style: 'margin:14px 0 6px;gap:16px' },
      p.icon_url ? h('img', { src: p.icon_url, class: 'icon lg' }) : pixelIcon(p.id, 72),
      h('div', { class: 'grow' }, h('h1', {}, p.title), h('div', { class: 'sub' }, p.description),
        h('div', { class: 'row', style: 'margin-top:8px' }, (p.categories || []).slice(0, 6).map((c) => h('span', { class: 'tag' }, c)), h('span', { class: 'muted', style: 'font-size:12px' }, `↓ ${fmt(p.downloads)} · ♥ ${fmt(p.followers)}`))),
      h('button', { class: 'btn', onclick: () => api.openExternal(`https://modrinth.com/${p.project_type}/${p.slug}`) }, svg(I.ext), 'Modrinth')),
    p.gallery?.length ? h('div', { class: 'gallery', style: 'margin:16px 0' }, p.gallery.map((g) => h('img', { src: g.url, title: g.title || '', loading: 'lazy' }))) : '',
    h('div', { class: 'project' }, h('div', { class: 'panel', style: 'padding:6px 22px 18px' }, markdown(p.body)),
      h('div', {}, h('div', { class: 'label', style: 'margin-bottom:8px' }, r.type === 'modpack' ? 'Versionen' : `Versionen für ${inst?.name || ''}`), versions)));
  try {
    const vs = await call(api.projectVersions, r.id, r.type, inst?.id);
    versions.replaceChildren(...(vs.length ? vs.slice(0, 30).map((v) => {
      const btn = h('button', { class: 'btn sm' + (v.type === 'release' ? ' primary' : '') }, 'Installieren');
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.replaceChildren(h('span', { class: 'spin' }));
        try {
          if (r.type === 'modpack') { await call(api.install, 'modrinth', r.id, 'modpack', null); await refresh(); toast(`${p.title} ist jetzt eine Instanz`); }
          else { const f = await call(api.installVersion, v.id, r.type, inst.id); toast(`${f.length} Datei(en) installiert`); }
          btn.textContent = '✓';
        } catch (e) {
          toast(e.message, true);
          btn.disabled = false;
          btn.textContent = 'Nochmal';
        }
      });
      return h('div', { class: 'lrow' }, h('div', { class: 'grow' }, h('div', { class: 'name' }, v.number), h('div', { class: 'meta' }, `${v.type} · ${(v.loaders || []).join(', ')} · ${ago(Date.parse(v.date))}`)), btn);
    }) : [h('div', { class: 'empty' }, 'Keine passende Version')]));
  } catch (e) {
    versions.replaceChildren(h('div', { class: 'empty' }, e.message));
  }
}

// ================================================================= import
/**
 * Per launcher: how to export a profile there with everything ticked (that is the only way settings, servers and
 * packs reliably come along), or – for launchers without an export – which folders Counter reads directly.
 * "**text**" is shown bold.
 */
const IMPORT_GUIDES = {
  norisk: { name: 'NoRiskClient', file: true, steps: [
    'Im NoRiskClient-Launcher auf **Profile** gehen und beim Profil **Exportieren** wählen.',
    'Das Format **NoRiskClient** (Blitz-Symbol) lassen.',
    'Bei „Dateien & Ordner auswählen“ auf **Alle auswählen** klicken – nur so kommen Einstellungen (options.txt), Serverliste (servers.dat), Configs, Ressourcenpakete und Shader mit. Welten und Screenshots kannst du abwählen, wenn sie zu groß sind.',
    '**Profil exportieren** klicken – die .noriskpack landet in NoRiskClientV3\\exports.',
    'Hier auf **Export-Datei auswählen** klicken und die .noriskpack öffnen.',
  ] },
  modrinth: { name: 'Modrinth App', file: true, steps: [
    'In der Modrinth App die Instanz öffnen, oben rechts auf **⋯** und **Export modpack** wählen.',
    'In der Dateiliste **options.txt**, **servers.dat**, **config**, **resourcepacks** und **shaderpacks** anhaken (für Welten zusätzlich **saves**).',
    '**Export** klicken und die .mrpack speichern.',
    'Hier auf **Export-Datei auswählen** klicken und die .mrpack öffnen.',
  ] },
  curseforge: { name: 'CurseForge', file: true, steps: [
    'In CurseForge unter **My Modpacks** beim Profil auf **⋯** und **Export Profile** klicken.',
    '**config**, **resourcepacks**, **shaderpacks**, **options.txt** und **servers.dat** anhaken (für Welten zusätzlich **saves**).',
    '**Export** klicken und die .zip speichern.',
    'Hier auf **Export-Datei auswählen** klicken. Mods von CurseForge lädt Counter nur mit einem CurseForge-Schlüssel in den Einstellungen.',
  ] },
  prism: { name: 'Prism / MultiMC', file: true, steps: [
    'Rechtsklick auf die Instanz und **Exportieren** → **Prism Launcher (zip)** (oder Modrinth .mrpack) wählen.',
    'Alles angehakt lassen – nur **logs** darf weg.',
    'Speichern und hier auf **Export-Datei auswählen** klicken.',
  ] },
  lunar: { name: 'Lunar Client', source: 'Lunar Client', steps: [
    'Lunar hat keine Export-Funktion – Counter liest direkt aus **.lunarclient\\profiles**: Einstellungen, Serverliste, Ressourcenpakete, Shader und deine eigenen Fabric-Mods.',
    'Lunars eigene Mods (Lunar-Menü, Cosmetics) lassen sich nicht mitnehmen.',
    'Lunar vorher schließen und unten beim passenden Eintrag auf **Importieren** klicken.',
  ] },
  feather: { name: 'Feather', source: 'Feather', steps: [
    'Feather hat keine Export-Funktion – Counter nimmt deine eigenen Mods aus **.feather\\user-mods** und Einstellungen, Server und Packs aus **.minecraft**.',
    'Feathers eigene Mods lassen sich nicht mitnehmen.',
    'Feather vorher schließen und unten beim passenden Eintrag auf **Importieren** klicken.',
  ] },
  vanilla: { name: 'Minecraft / LabyMod / Badlion', source: 'Minecraft Launcher', steps: [
    'Der offizielle Launcher, LabyMod und Badlion spielen alle im Ordner **.minecraft** – Counter übernimmt von dort Einstellungen, Server, Packs und Mods.',
    'Spiel vorher schließen und unten bei **.minecraft** auf **Importieren** klicken.',
  ] },
};
const boldText = (t) => t.split('**').map((s, i) => (i % 2 ? h('b', {}, s) : s));

/** after every import: what came along, so a missing servers.dat or options.txt is obvious right away */
function importSummaryModal(inst, s, skipped = []) {
  const row = (ok, label, extra) => h('div', { class: 'lrow' }, h('span', { style: `width:22px;font-weight:800;color:${ok ? 'var(--accent)' : 'var(--muted)'}` }, ok ? '✓' : '–'), h('span', { class: 'grow' }, label), extra ? h('span', { class: 'meta' }, extra) : null);
  const missing = !s.settings || !s.servers;
  modal(h('div', {}, h('h2', {}, `„${inst.name}“ importiert`),
    h('p', { class: 'sub' }, `${inst.mcVersion || '?'} · ${inst.loader}${inst.importedFrom ? ` · aus ${inst.importedFrom}` : ''}`),
    h('div', { class: 'list panel', style: 'margin-top:12px' },
      row(s.mods + s.modsOff > 0, 'Mods', `${s.mods}${s.modsOff ? ` + ${s.modsOff} ausgeschaltet` : ''}`),
      row(s.settings, 'Einstellungen & Tastenbelegung', s.settings ? 'options.txt' : 'fehlt'),
      row(s.servers, 'Serverliste', s.servers ? `${s.serverCount} Server` : 'fehlt'),
      row(s.config > 0, 'Mod-Configs', String(s.config)),
      row(s.resourcepacks > 0, 'Ressourcenpakete', String(s.resourcepacks)),
      row(s.shaderpacks > 0, 'Shader', String(s.shaderpacks)),
      row(s.saves > 0, 'Welten', String(s.saves))),
    missing ? h('p', { class: 'sub', style: 'margin-top:12px' }, boldText('Fehlt etwas? Dann war es im Export nicht angehakt – beim Exportieren **Alle auswählen** bzw. **options.txt** und **servers.dat** anhaken und nochmal importieren.')) : null,
    skipped.length ? h('p', { class: 'sub', style: 'margin-top:8px' }, `${skipped.length} Datei(en) gibt es nur direkt auf CurseForge.`) : null,
    s.warnings?.length ? h('p', { class: 'sub', style: 'margin-top:8px;color:var(--danger, #ff6b6b)' }, `Nicht übernommen: ${s.warnings.join(', ')}`) : null,
    h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:16px' },
      h('button', { class: 'btn ghost', onclick: closeModal }, 'Schließen'),
      h('button', { class: 'btn primary', onclick: () => { closeModal(); go({ page: 'instance', id: inst.id }); } }, 'Zur Instanz'))));
}

async function importPage(view) {
  const list = h('div', { class: 'list panel stagger' }, h('div', { class: 'skeleton', style: 'height:140px;margin:10px' }));
  let found = null;
  const pickFile = async (from, btn) => {
    btn.disabled = true;
    try {
      const r = await call(api.importFile, from);
      if (!r) return;
      await refresh();
      importSummaryModal(r.instance, r.summary, r.skipped);
    } catch (e) {
      toast(e.message, true);
    } finally {
      btn.disabled = false;
    }
  };
  const guideBox = h('div', { class: 'panel', style: 'padding:4px 0 14px;margin-top:10px' });
  const tabs = h('div', { class: 'seg', style: 'flex-wrap:wrap' });
  const showGuide = (id) => {
    const g = IMPORT_GUIDES[id];
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
    const fileBtn = h('button', { class: 'btn primary' }, svg(I.upload), 'Export-Datei auswählen');
    fileBtn.addEventListener('click', () => pickFile(id, fileBtn));
    const matches = found ? found.filter((f) => f.source === g.source).length : 0;
    guideBox.replaceChildren(h('ol', { class: 'steps' }, g.steps.map((s) => h('li', {}, boldText(s)))),
      h('div', { class: 'row', style: 'padding:0 22px' }, g.file ? fileBtn
        : h('span', { class: 'meta' }, found ? (matches ? `${matches} Eintrag/Einträge unten unter „Auf diesem PC gefunden“` : `${g.name} wurde auf diesem PC nicht gefunden`) : 'Suche läuft …')));
  };
  for (const [id, g] of Object.entries(IMPORT_GUIDES)) tabs.append(h('button', { 'data-id': id, onclick: () => showGuide(id) }, g.name));
  view.append(h('h1', {}, 'Importieren'),
    h('p', { class: 'sub' }, 'Übernimmt Mods, Einstellungen, Tastenbelegung (options.txt), Serverliste, Ressourcenpakete, Shader, Configs und Welten. Am zuverlässigsten über die Export-Funktion deines alten Launchers – wähl ihn aus:'),
    h('div', { style: 'margin:16px 0 22px' }, tabs, guideBox),
    h('div', { id: 'import-extras' }),
    h('h2', {}, 'Auf diesem PC gefunden'),
    h('p', { class: 'sub' }, 'Schnell-Import direkt aus den Ordnern der anderen Launcher – ohne Export, aber nicht jeder Launcher legt alles so ab, dass Counter es findet.'), list);
  showGuide('norisk');
  importExtras(view.querySelector('#import-extras'));
  found = await call(api.scanImports);
  showGuide(tabs.querySelector('button.on')?.dataset.id || 'norisk');
  list.replaceChildren(...(found.length ? found.map((f) => {
    const ver = h('input', { value: f.mcVersion || '', placeholder: 'Version', style: 'width:110px' });
    const btn = h('button', { class: 'btn sm primary' }, 'Importieren');
    btn.addEventListener('click', async () => {
      if (!ver.value.trim()) return toast('Gib die Minecraft-Version an', true);
      const parts = await chooseParts(f);
      if (!parts) return;
      btn.disabled = true;
      btn.replaceChildren(h('span', { class: 'spin' }));
      try {
        const inst = await call(api.importFound, f, ver.value.trim(), parts);
        await refresh();
        btn.textContent = '✓ Importiert';
        importSummaryModal(inst, inst.summary);
      } catch (e) {
        toast(e.message, true);
        btn.disabled = false;
        btn.textContent = 'Nochmal';
      }
    });
    return h('div', { class: 'lrow' }, h('span', { class: 'tag a', style: 'min-width:120px;justify-content:center' }, f.source), h('div', { class: 'grow' }, h('div', { class: 'name' }, f.name), h('div', { class: 'meta' }, f.detail || f.dir)), ver, btn);
  }) : [h('div', { class: 'empty' }, h('b', {}, 'Nichts gefunden'), 'Gesucht: Modrinth App, CurseForge, Prism, MultiMC, Minecraft Launcher, NoRiskClient, Lunar, Feather.')]));
}

/** asks which parts of an installation should be taken over */
function chooseParts(f) {
  const options = [
    ['mods', 'Mods', true], ['settings', 'Einstellungen, Tastenbelegung & Serverliste', true], ['config', 'Mod-Configs', true],
    ['resourcepacks', 'Ressourcenpakete', true], ['shaderpacks', 'Shader', true], ['saves', 'Welten (oft sehr groß)', false], ['screenshots', 'Screenshots (oft sehr groß)', false],
  ];
  const chosen = new Set(options.filter((o) => o[2]).map((o) => o[0]));
  return new Promise((resolve) => {
    const rows = options.map(([k, label]) => {
      const sw = h('span', { class: 'switch' + (chosen.has(k) ? ' on' : '') });
      return h('button', { class: 'lrow', style: 'width:100%;text-align:left', onclick: () => { chosen.has(k) ? chosen.delete(k) : chosen.add(k); sw.classList.toggle('on', chosen.has(k)); } }, sw, h('span', { class: 'grow' }, label));
    });
    modal(h('div', {}, h('h2', {}, `„${f.name}“ importieren`),
      h('p', { class: 'sub' }, `${f.source}${f.mods?.length ? ` · ${f.mods.length} Mods werden von Modrinth geladen` : ''}`),
      h('div', { class: 'list panel', style: 'margin-top:12px' }, rows),
      h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:16px' },
        h('button', { class: 'btn ghost', onclick: () => { closeModal(); resolve(null); } }, 'Abbrechen'),
        h('button', { class: 'btn primary', onclick: () => { closeModal(); resolve([...chosen]); } }, 'Importieren'))));
  });
}

// ================================================================= accounts
function accounts(view) {
  const nameInput = h('input', { placeholder: 'Spielername' });
  view.append(h('h1', {}, 'Konten'), h('p', { class: 'sub' }, 'Microsoft für Online-Server, Offline für Einzelspieler und Tests.'), h('div', { style: 'height:16px' }),
    state.accounts.length ? h('div', { class: 'list panel stagger' }, state.accounts.map((a) => h('div', { class: 'lrow' },
      h('img', { src: `https://mc-heads.net/avatar/${a.type === 'msa' ? a.uuid : 'MHF_Steve'}/34`, class: 'icon', alt: '' }),
      h('div', { class: 'grow' }, h('div', { class: 'name' }, a.name), h('div', { class: 'meta' }, a.type === 'msa' ? 'Microsoft-Konto' : a.type === 'official' ? 'Startet über den offiziellen Minecraft Launcher' : 'Offline-Konto')),
      a.uuid === state.activeAccount ? h('span', { class: 'tag g' }, 'Aktiv') : h('button', { class: 'btn sm', onclick: async () => { await call(api.selectAccount, a.uuid); await refresh(); render(); } }, 'Benutzen'),
      h('button', { class: 'btn sm ghost danger', onclick: async () => { await call(api.removeAccount, a.uuid); await refresh(); render(); } }, svg(I.trash)))))
      : h('div', { class: 'empty panel' }, h('b', {}, 'Noch kein Konto')),
    h('h2', {}, 'Hinzufügen'),
    h('div', { class: 'panel', style: 'padding:16px 18px;margin-bottom:14px' },
      h('div', { style: 'font-weight:650' }, 'Ohne Azure: über den Minecraft Launcher spielen'),
      h('div', { class: 'muted', style: 'margin:4px 0 12px' }, 'Der Counter Launcher installiert alles und öffnet den offiziellen Launcher mit deiner Instanz. Dort bist du schon mit Microsoft angemeldet – online spielen geht ganz normal.'),
      h('button', { class: 'btn primary', onclick: async () => { await call(api.officialAccount); await refresh(); render(); toast('Spielen startet jetzt über den Minecraft Launcher'); } }, 'Über Minecraft Launcher spielen')),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: microsoftLogin }, 'Mit Microsoft anmelden'), h('span', { class: 'muted' }, 'oder'), nameInput,
      h('button', { class: 'btn', onclick: async () => { try { await call(api.offline, nameInput.value.trim()); await refresh(); render(); } catch (e) { toast(e.message, true); } } }, 'Offline-Konto')));
}

async function microsoftLogin() {
  const info = h('p', { class: 'sub' }, 'Microsoft-Anmeldung wird im Standardbrowser geöffnet …');
  modal(h('div', {}, h('h2', {}, 'Microsoft-Anmeldung'), info, h('p', { class: 'muted' }, 'Melde dich dort an und kehre danach zum Counter Launcher zurück.'), h('div', { class: 'row', style: 'justify-content:flex-end' }, h('button', { class: 'btn ghost', onclick: () => { api.cancelLogin(); closeModal(); } }, 'Abbrechen'))));
  const r = await api.login();
  closeModal();
  if (r.ok) { toast(`Angemeldet als ${r.data}`); await refresh(); render(); }
  else if (r.error === 'NO_CLIENT_ID') toast('Microsoft-Anmeldung ist in dieser Launcher-Version nicht konfiguriert.', true);
  else if (r.error === 'SECURE_STORAGE_UNAVAILABLE') toast('Die sichere Windows-Speicherung ist nicht verfügbar. Starte den Launcher neu und versuche es erneut.', true);
  else if (r.error !== 'cancelled') toast(r.error, true);
}
api.on('login:browser', ({ redirectUri }) => {
  const text = document.querySelector('#modal-root .sub');
  if (text) text.textContent = `Browser geöffnet. Rückgabe-Adresse: ${redirectUri}`;
});

// ================================================================= settings
function settings(view) {
  const s = state.settings;
  const set = async (patch) => { await call(api.setSettings, patch); await refresh(); };
  const ram = h('span', {}, `${(s.ramMb / 1024).toFixed(1)} GB`);
  const sw = (key) => { const b = h('button', { class: 'switch' + (s[key] ? ' on' : '') }); b.addEventListener('click', async () => { await set({ [key]: !state.settings[key] }); b.classList.toggle('on', state.settings[key]); }); return b; };
  const link = (url, text) => h('a', { href: '#', onclick: (e) => { e.preventDefault(); api.openExternal(url); } }, text);
  view.append(h('h1', {}, 'Einstellungen'), updateSection(), designEditor(), extraSettings(), h('h2', {}, 'Spiel & Konten'),
    h('div', { class: 'form panel' },
      h('label', {}, 'Arbeitsspeicher (Standard)'), h('div', { class: 'row' }, h('input', { type: 'range', min: 1024, max: 16384, step: 512, value: s.ramMb, class: 'grow', oninput: (e) => (ram.textContent = `${(e.target.value / 1024).toFixed(1)} GB`), onchange: (e) => set({ ramMb: Number(e.target.value) }) }), ram),
      h('label', {}, 'Java (leer = automatisch)'), h('input', { value: s.javaPath, placeholder: 'wird pro Version automatisch geladen', onchange: (e) => set({ javaPath: e.target.value.trim() }) }),
      h('label', {}, 'JVM-Argumente'), h('input', { value: s.jvmArgs, placeholder: '-XX:+UseZGC', onchange: (e) => set({ jvmArgs: e.target.value }) }),
      h('label', {}, 'Beim Spielstart minimieren'), sw('closeOnLaunch'),
      h('label', {}, 'Discord-Status anzeigen'), sw('discordRpc'),
      h('label', {}, 'Discord-Anwendungs-ID'), h('input', { value: s.discordClientId, placeholder: 'discord.com/developers → New Application', onchange: (e) => set({ discordClientId: e.target.value.trim() }) }),
      h('label', {}, 'CurseForge-API-Schlüssel'), h('input', { value: s.curseforgeKey, type: 'password', placeholder: 'von console.curseforge.com', onchange: (e) => set({ curseforgeKey: e.target.value.trim() }) }),
      h('div', { class: 'hint' }, 'Nur für CurseForge nötig. Modrinth funktioniert ohne.')),
    h('h2', {}, 'Microsoft-Login'),
    h('div', { class: 'panel', style: 'padding:16px 18px' },
      h('div', { style: 'font-weight:650' }, 'Direkt mit Microsoft anmelden'),
      h('p', { class: 'muted', style: 'margin:6px 0 0' }, 'Die Counter-App ist bereits eingerichtet. Klicke unter „Konten“ einfach auf „Mit Microsoft anmelden“. Der Login öffnet sich sicher im Standardbrowser.')));
}

// ================================================================= update section
function updateSection() {
  const u = updateInfo;
  const text = {
    idle: 'Noch nicht geprüft', checking: 'Suche nach Updates …', latest: 'Du hast die neueste Version',
    downloading: `Lade Version ${u.newVersion || ''} … ${u.percent || 0}%`, ready: `Version ${u.newVersion} ist bereit`,
    error: `Update-Prüfung fehlgeschlagen: ${u.error || ''}`, dev: 'Entwicklerversion – automatische Updates nur in der installierten App',
    unconfigured: 'Automatische Updates sind noch nicht eingerichtet (GitHub-Repo fehlt in package.json)',
  }[u.state] || '';
  return h('div', { class: 'panel row', style: 'padding:14px 18px;margin-top:16px' },
    h('div', { class: 'grow' }, h('div', { style: 'font-weight:650' }, `Counter Launcher ${u.version || ''}`), h('div', { class: 'muted', style: 'font-size:12.5px' }, text)),
    u.state === 'ready'
      ? h('button', { class: 'btn primary', onclick: () => api.installUpdate() }, 'Jetzt neu starten')
      : h('button', { class: 'btn', disabled: ['checking', 'downloading', 'dev', 'unconfigured'].includes(u.state), onclick: () => api.checkUpdate() }, svg(I.refresh), 'Nach Updates suchen'));
}

// ================================================================= design editor
function designEditor() {
  const t = theme();
  const wrap = h('div', {});
  // live preview while dragging, saved when released
  const slider = (key, label, min, max, step, unit) => {
    const val = h('span', { class: 'muted', style: 'min-width:54px;text-align:right' }, `${t[key]}${unit}`);
    return [h('label', {}, label), h('div', { class: 'row' },
      h('input', { type: 'range', min, max, step, value: t[key], class: 'grow',
        oninput: (e) => { const v = Number(e.target.value); val.textContent = `${v}${unit}`; applyTheme({ ...theme(), [key]: v }); },
        onchange: (e) => saveTheme({ [key]: Number(e.target.value) }) }), val)];
  };
  const toggle = (key, label) => {
    const b = h('button', { class: 'switch' + (t[key] ? ' on' : '') });
    b.addEventListener('click', async () => { await saveTheme({ [key]: !theme()[key] }); b.classList.toggle('on', theme()[key]); });
    return [h('label', {}, label), b];
  };
  const color = (key, label, isAccent) => [h('label', {}, label), h('input', { type: 'color', value: isAccent ? state.settings.accent : t[key], style: 'width:64px;height:34px;padding:3px',
    oninput: (e) => (isAccent ? applyTheme(theme(), e.target.value) : applyTheme({ ...theme(), [key]: e.target.value })),
    onchange: (e) => (isAccent ? saveTheme({}, e.target.value) : saveTheme({ [key]: e.target.value })) })];
  const bgSeg = h('div', { class: 'seg' }, [['sky', 'Pixelhimmel'], ['gradient', 'Verlauf'], ['image', 'Eigenes Bild'], ['solid', 'Einfarbig']].map(([k, l]) =>
    h('button', { class: t.bg === k ? 'on' : '', onclick: async () => {
      if (k === 'image' && !bgImage) {
        const img = await call(api.pickBackground);
        if (!img) return;
        bgImage = img;
      }
      await saveTheme({ bg: k });
      render();
    } }, l)));
  wrap.append(
    h('h2', {}, 'Design-Presets'),
    h('div', { class: 'presets stagger' }, PRESETS.map((p, n) => h('div', { class: 'preset hl', style: `animation-delay:${n * 30}ms`, onclick: async () => { await saveTheme({ ...THEME_DEFAULT, ...p.theme }, p.accent); render(); } },
      h('div', { class: 'sw', style: `background:linear-gradient(135deg, ${p.accent}, ${p.theme.accent2})` }), h('div', { style: 'font-weight:600' }, p.name)))),
    h('h2', {}, 'Aussehen anpassen'),
    h('div', { class: 'form panel' },
      color('accent', 'Akzentfarbe', true),
      color('accent2', 'Zweitfarbe'),
      // the background itself is chosen in the gallery (backgrounds.js)
      slider('glass', 'Glas-Deckkraft', 5, 95, 1, '%'),
      slider('blur', 'Glas-Unschärfe', 0, 60, 1, 'px'),
      slider('radius', 'Ecken-Rundung', 0, 28, 1, 'px'),
      slider('font', 'Schriftgröße', 11, 17, 0.5, 'px'),
      slider('light', 'Mauslicht', 0, 200, 5, '%'),
      toggle('v2', 'Counter 2.0 (neues Design)'),
      toggle('motion', 'Animationen'),
      toggle('compact', 'Kompakte Ansicht'),
      toggle('library', 'Bibliothek-Leiste anzeigen')),
    h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn sm ghost', onclick: async () => { await saveTheme(THEME_DEFAULT, '#9d5cff'); render(); } }, 'Design zurücksetzen')));
  return wrap;
}

// ================================================================= modal helpers
function modal(content, wide) {
  const back = h('div', { class: 'backdrop', onclick: (e) => e.target === back && closeModal() }, h('div', { class: 'modal' + (wide ? ' wide' : '') }, content));
  $('#modal-root').replaceChildren(back);
}
function closeModal() {
  $('#modal-root').replaceChildren();
}
function confirmModal(text, onYes, yes = 'Ja') {
  modal(h('div', {}, h('h2', {}, 'Bestätigen'), h('p', { class: 'sub', style: 'white-space:pre-line' }, text),
    h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:16px' }, h('button', { class: 'btn ghost', onclick: closeModal }, 'Abbrechen'),
      h('button', { class: 'btn primary', onclick: async () => { closeModal(); await onYes(); } }, yes))));
}

// ================================================================= start
// started after every script (features.js) is loaded
window.addEventListener('DOMContentLoaded', async () => {
  await loadIcons();
  await refresh();
  const us = await api.updateState();
  if (us.ok) {
    updateInfo = us.data;
    drawUpdate();
  }
  const img = await api.backgroundImage();
  if (img.ok && img.data) {
    bgImage = img.data;
    applyTheme();
  }
  // a page can be opened directly with #page (used for testing)
  const start = location.hash.slice(1);
  if (start) go({ page: start });
  else render();
});
