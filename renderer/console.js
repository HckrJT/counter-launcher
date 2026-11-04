// Counter Launcher – "Konsole" layout (default): labelled pixel rail, top bar with history and account menu, a home
// stage with the 3D skin and a big LAUNCH button, an instance shelf, a news column, floating cubes and a pixel night
// landscape. Like features.js it replaces some functions from app.js/features.js by assigning the same global names.
// The classic layout stays available (Einstellungen → Startseite & Layout).

const isConsole = () => (theme().layout || 'console') === 'console';
const opt = (key, def) => theme()[key] ?? def;

// ================================================================= chrome: rail brand, labels, top bar
const CHEVRON = 'M6 9l6 6 6-6';
(() => {
  const rail = $('#rail');
  rail.prepend(h('div', { class: 'rail-brand' }, h('div', { class: 'mark' }, 'C'), h('span', {}, 'Counter')));
  const label = (page, text) => {
    const tip = rail.querySelector(`.nav[data-page="${page}"] .tip`);
    if (tip) tip.textContent = text;
  };
  label('home', 'Spielen');
  // instances page (the library as big tiles) right below "Spielen"
  const inst = h('button', { class: 'nav', 'data-page': 'instances' }, svg('M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z'), h('span', { class: 'tip' }, 'Instanzen'));
  inst.addEventListener('click', () => go({ page: 'instances' }));
  rail.querySelector('.nav[data-page="home"]').after(inst);

  const bar = $('#titlebar');
  const back = h('button', { title: 'Zurück', onclick: () => history2(-1) }, svg('M15 6l-6 6 6 6'));
  const fwd = h('button', { title: 'Vor', onclick: () => history2(1) }, svg('M9 6l6 6-6 6'));
  bar.querySelector('.brand').after(h('div', { class: 'hist', id: 'hist' }, back, fwd));
  const right = h('div', { class: 'top-right', id: 'top-right' });
  bar.insertBefore(right, bar.querySelector('.win-buttons'));
})();

// back / forward like in a browser (also the mouse side buttons)
const hist = { back: [], fwd: [] };
const _go = go;
go = function (r, fromHistory = false) {
  if (!fromHistory && route && (route.page !== r.page || route.id !== r.id)) {
    hist.back.push(route);
    if (hist.back.length > 60) hist.back.shift();
    hist.fwd.length = 0;
  }
  _go(r);
  drawTop();
};
function history2(dir) {
  const from = dir < 0 ? hist.back : hist.fwd;
  const to = dir < 0 ? hist.fwd : hist.back;
  if (!from.length) return;
  to.push(route);
  go(from.pop(), true);
}
window.addEventListener('mouseup', (e) => {
  if (e.button === 3) history2(-1);
  if (e.button === 4) history2(1);
});

const headUrl = (a, size) => `https://mc-heads.net/avatar/${a.type === 'msa' ? a.uuid : encodeURIComponent(a.name)}/${size}`;
function drawTop() {
  const hb = $('#hist');
  if (hb) {
    hb.children[0].disabled = !hist.back.length;
    hb.children[1].disabled = !hist.fwd.length;
  }
  const acc = state.accounts.find((a) => a.uuid === state.activeAccount);
  const runningCount = state.running.length;
  $('#top-right').replaceChildren(...[
    runningCount ? h('div', { class: 'top-chip live' }, h('i'), `${runningCount} läuft`) : null,
    h('button', { class: 'top-chip', title: 'Alle Instanzen', onclick: () => go({ page: 'instances' }) }, `${state.instances.length} ${state.instances.length === 1 ? 'Instanz' : 'Instanzen'}`),
    h('button', { class: 'top-icon', title: 'Neuigkeiten', onclick: () => go({ page: 'news' }) }, svg('M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20h4')),
    h('button', { class: 'top-acc', onclick: (e) => { e.stopPropagation(); accountMenu(e.currentTarget); } },
      acc ? h('img', { src: headUrl(acc, 28), alt: '' }) : h('div', { class: 'ph' }),
      h('div', { class: 'who' }, h('b', {}, acc ? acc.name : 'Kein Konto'), h('span', {}, acc ? (acc.type === 'msa' ? 'Microsoft' : acc.type === 'official' ? 'Minecraft Launcher' : 'Offline') : 'hinzufügen')),
      svg(CHEVRON))].filter(Boolean));
}
function accountMenu(anchor) {
  closeMenu();
  const r = anchor.getBoundingClientRect();
  const menu = h('div', { class: 'ctx-menu acc-menu', id: 'ctx-menu', style: `right:${innerWidth - r.right}px;top:${r.bottom + 6}px` },
    state.accounts.map((a) => h('button', { class: 'menu-item acc-item' + (a.uuid === state.activeAccount ? ' on' : ''), onclick: async () => { closeMenu(); await call(api.selectAccount, a.uuid); await refresh(); drawTop(); render(); } },
      h('img', { src: headUrl(a, 24), alt: '' }), h('span', { class: 'grow' }, a.name), a.uuid === state.activeAccount ? h('span', { class: 'tag g' }, 'Aktiv') : null)),
    state.accounts.length ? h('div', { class: 'menu-sep' }) : null,
    h('button', { class: 'menu-item', onclick: () => { closeMenu(); go({ page: 'accounts' }); } }, '+ Konto hinzufügen / verwalten'));
  document.body.append(menu);
}

// ================================================================= routing with the extra pages
const extraPages = {};
const extraNames = {};
let lastRoute = '';
render = async function () {
  const view = h('div', { class: 'page' });
  const key = JSON.stringify(route);
  // same page again (a setting was changed, a game started ...): swap without transition and keep the scroll position;
  // only a real page change fades and starts at the top
  const soft = key === lastRoute && $('#content').firstElementChild;
  lastRoute = key;
  if (soft) {
    const top = $('#content').scrollTop;
    view.style.minHeight = $('#content').scrollHeight + 'px';
    view.classList.add('soft');
    $('#content').replaceChildren(view);
    $('#content').scrollTop = top;
    view.dataset.soft = top;
  } else {
    await window.transition(() => {
      $('#content').replaceChildren(view);
      $('#content').scrollTop = 0;
    });
  }
  const pages = { ...extraPages, home, instances: instancesPage, instance, browse, project, import: importPage, accounts, settings, news: (v) => newsPage(v) };
  const names = { ...extraNames, news: 'Neuigkeiten', home: 'Spielen', instances: 'Instanzen', instance: 'Instanz', browse: 'Entdecken', project: 'Projekt', import: 'Importieren', accounts: 'Konten', settings: 'Einstellungen' };
  $('#crumbs').replaceChildren(h('span', {}, 'Counter'), '/', h('b', {}, route.page === 'instance' ? (instById(route.id) || selected())?.name || '' : names[route.page] || ''));
  document.body.dataset.page = route.page;
  try {
    await (pages[route.page] || home)(view, route);
  } catch (e) {
    view.append(h('div', { class: 'empty' }, h('b', {}, 'Fehler'), e.message));
  }
  if (soft) {
    view.style.minHeight = '';
    $('#content').scrollTop = Number(view.dataset.soft) || 0;
    delete view.dataset.soft;
  }
  if (viewer) viewer.renderPaused = !viewer.canvas.isConnected;
};

// ================================================================= 3D skin (skinview3d, one viewer reused)
let viewer = null;
let skinFor = null;
let skinData = null;
let waveTimer = null;
const ANIMS = { idle: 'IdleAnimation', walk: 'WalkingAnimation', run: 'RunningAnimation', fly: 'FlyingAnimation', wave: 'WaveAnimation' };
// own poses (194): joint angles per frame; `t` is the animation clock in seconds
const POSES = {
  cheer: (s, t) => { const a = 2.6 + Math.sin(t * 6) * 0.25; s.leftArm.rotation.set(-a, 0, 0.2); s.rightArm.rotation.set(-a, 0, -0.2); s.leftLeg.rotation.x = Math.sin(t * 6) * 0.15; s.rightLeg.rotation.x = -Math.sin(t * 6) * 0.15; },
  think: (s, t) => { s.rightArm.rotation.set(-1.9, 0.5, 0); s.leftArm.rotation.set(0, 0, 0.05); s.head.rotation.set(0.1, Math.sin(t) * 0.3, 0.1); },
  sit: (s, t) => { s.leftLeg.rotation.set(-1.5, 0.15, 0); s.rightLeg.rotation.set(-1.5, -0.15, 0); s.leftArm.rotation.set(-0.6, 0, 0.1); s.rightArm.rotation.set(-0.6, 0, -0.1); s.head.rotation.y = Math.sin(t * 0.6) * 0.25; },
  dab: (s) => { s.head.rotation.set(0.5, -0.4, 0); s.rightArm.rotation.set(-1.6, 0, -0.5); s.leftArm.rotation.set(-1.3, 0, 1.6); },
  sneak: (s, t) => { s.body.rotation.x = 0.45; s.head.rotation.x = 0.2; s.leftArm.rotation.x = 0.4 + Math.sin(t * 2) * 0.05; s.rightArm.rotation.x = 0.4; s.leftLeg.rotation.x = -0.3; s.rightLeg.rotation.x = 0.3; },
};
function poseAnimation(name) {
  const Base = window.skinview3d && skinview3d.PlayerAnimation;
  if (!Base || !POSES[name]) return null;
  return new (class extends Base { animate(player) {
    const s = player.skin;
    for (const j of [s.head, s.body, s.leftArm, s.rightArm, s.leftLeg, s.rightLeg]) j.rotation.set(0, 0, 0);
    POSES[name](s, this.progress / 1);
  } })();
}
function animation(name) {
  if (POSES[name]) return poseAnimation(name);
  const cls = ANIMS[name] && window.skinview3d && skinview3d[ANIMS[name]];
  return cls ? new cls() : null;
}
/** simple default skin in the accent colour, used while offline / for unknown names */
function defaultSkin() {
  const c = h('canvas', { width: 64, height: 64 });
  const g = c.getContext('2d');
  const [r, gr, b] = accentRgb();
  const fill = (col, x, y, w, hh) => { g.fillStyle = col; g.fillRect(x, y, w, hh); };
  const skinCol = '#c69c7b', hair = '#3b2a20', shirt = `rgb(${r},${gr},${b})`, dark = `rgb(${(r * 0.35) | 0},${(gr * 0.35) | 0},${(b * 0.45) | 0})`;
  fill(skinCol, 0, 8, 32, 8); fill(skinCol, 8, 0, 16, 8); fill(hair, 8, 0, 8, 8); fill(hair, 0, 8, 32, 2);
  fill('#fff', 9, 12, 2, 1); fill('#fff', 13, 12, 2, 1); fill('#2a1a5e', 10, 12, 1, 1); fill('#2a1a5e', 13, 12, 1, 1); fill('#8a5a44', 11, 14, 2, 1);
  fill(shirt, 16, 16, 24, 16); fill(dark, 20, 26, 8, 1);
  fill(shirt, 40, 16, 16, 16); fill(skinCol, 40, 26, 16, 6);
  fill(shirt, 32, 48, 16, 16); fill(skinCol, 32, 58, 16, 6);
  fill(dark, 0, 16, 16, 16); fill(dark, 16, 48, 16, 16); fill('#222', 0, 29, 16, 3); fill('#222', 16, 61, 16, 3);
  return c;
}
function applySkinPrefs() {
  if (!viewer) return;
  viewer.autoRotate = opt('skinRotate', true) && !document.body.classList.contains('no-motion');
  viewer.autoRotateSpeed = 0.55 * opt('skinSpeed', 1);
  viewer.zoom = 0.74 * (opt('skinSize', 100) / 100);
  if (!waveTimer) viewer.animation = animation(opt('skinAnim', 'idle'));
  if (skinData) viewer.loadCape(opt('skinCape', true) ? skinData.cape : null);
}
async function loadSkin() {
  const key = state.activeAccount || '-';
  if (skinFor === key) return;
  skinFor = key;
  viewer.loadSkin(defaultSkin());
  try {
    skinData = await call(api.skin);
    if (skinFor !== key) return;
    if (skinData.url) viewer.loadSkin(skinData.url, { model: skinData.slim ? 'slim' : 'default' });
    applySkinPrefs();
  } catch {}
}
function skinCanvas() {
  if (!window.skinview3d) return null;
  if (!viewer) {
    const canvas = h('canvas', { class: 'skin3d' });
    viewer = new skinview3d.SkinViewer({ canvas, width: 320, height: 420 });
    viewer.fov = 38;
    viewer.zoom = 0.86;
    viewer.controls.enableZoom = false;
    viewer.controls.enablePan = false;
    viewer.playerObject.rotation.y = 0.45;
    // click: wave hello
    canvas.addEventListener('dblclick', () => {
      clearTimeout(waveTimer);
      viewer.animation = animation('wave');
      waveTimer = setTimeout(() => { waveTimer = null; applySkinPrefs(); }, 2600);
    });
    new ResizeObserver(() => {
      const p = canvas.parentElement;
      if (p && p.clientWidth && p.clientHeight) viewer.setSize(p.clientWidth, p.clientHeight);
    }).observe(document.getElementById('content'));
  }
  applySkinPrefs();
  loadSkin();
  return viewer.canvas;
}

// ================================================================= home
const _home = home;
let newsCache = null;
async function homeFeed(inst) {
  if (newsCache && Date.now() - newsCache.at < 10 * 60 * 1000) return newsCache.items;
  const [rel, packs] = await Promise.allSettled([call(api.news), call(api.search, 'modrinth', '', 'modpack', inst?.id, 0)]);
  const items = [];
  if (rel.status === 'fulfilled') for (const n of rel.value.slice(0, 2)) items.push({ kind: 'release', ...n });
  if (packs.status === 'fulfilled') for (const m of packs.value.hits.slice(0, 8)) items.push({ kind: 'pack', ...m });
  if (items.length) newsCache = { at: Date.now(), items };
  return items;
}
function newsCard(n, k) {
  if (n.kind === 'release') {
    return h('div', { class: 'ncard', style: `animation-delay:${k * 50}ms`, onclick: () => go({ page: 'news' }) },
      h('div', { class: 'art' }, pixelBanner('release' + n.version), h('span', { class: 'badge' }, 'Update'), h('span', { class: 'big' }, n.version)),
      h('div', { class: 'body' }, h('div', { class: 't' }, n.name || n.version), h('div', { class: 'm' }, `Counter Launcher · ${new Date(n.date).toLocaleDateString()}`)));
  }
  const img = n.featured_gallery || (n.gallery && n.gallery[0]) || n.icon_url;
  return h('div', { class: 'ncard', style: `animation-delay:${k * 50}ms`, onclick: () => go({ page: 'project', id: n.project_id, source: 'modrinth', type: 'modpack' }) },
    h('div', { class: 'art' }, img ? h('img', { src: img, alt: '', loading: 'lazy' }) : pixelBanner(n.project_id), h('span', { class: 'badge soft' }, 'Modpack')),
    h('div', { class: 'body' }, h('div', { class: 't' }, n.title), h('div', { class: 'm' }, n.description), h('div', { class: 'm dl' }, `${fmt(n.downloads)} Downloads`)));
}

home = async function (view, r) {
  if (!isConsole()) return _home(view, r);
  view.classList.add('home2');
  const acc = state.accounts.find((a) => a.uuid === state.activeAccount);
  const list = sortInstances(state.instances);
  let cur = instById(state.selectedInstance) || list[0];

  // ---- stage: skin, name tag, launch button
  const nametag = h('div', { class: 'nametag' }, acc ? acc.name : 'Kein Konto');
  const wrap = h('div', { class: 'skin-wrap' }, h('div', { class: 'pedestal' }), nametag);
  const canvas = skinCanvas();
  if (canvas) {
    wrap.append(canvas);
    requestAnimationFrame(() => wrap.clientWidth && viewer.setSize(wrap.clientWidth, wrap.clientHeight));
  } else wrap.append(h('img', { class: 'skin-flat', src: acc ? `https://mc-heads.net/body/${acc.type === 'msa' ? acc.uuid : acc.name}/220` : 'https://mc-heads.net/body/MHF_Steve/220', alt: '' }));
  const launch = h('div', { class: 'launch' });
  const status = h('div', { class: 'launch-status' });
  const drawLaunch = () => {
    if (!cur) {
      launch.replaceChildren(h('button', { class: 'launch-main', onclick: createInstanceModal }, h('span', { class: 'lt' }, 'Neue Instanz'), h('span', { class: 'ls' }, 'Version und Loader wählen')));
      return;
    }
    const running = state.running.includes(cur.id);
    const loading = busy.has(cur.id);
    launch.className = 'launch' + (running ? ' running' : '') + (loading ? ' loading' : '');
    launch.replaceChildren(
      h('button', { class: 'launch-main', onclick: (e) => { if (!running && !loading) window.pixelBurst(e.currentTarget); play(cur); } },
        h('span', { class: 'lt' }, loading ? [h('span', { class: 'spin' }), ' Startet'] : running ? 'Stoppen' : 'Spielen'),
        h('span', { class: 'ls' }, `${cur.name} · ${loaderName(cur.loader)} ${cur.mcVersion}`)),
      h('button', { class: 'launch-drop', title: 'Instanz wählen', onclick: (e) => { e.stopPropagation(); pickMenu(e.currentTarget); } }, svg(CHEVRON)));
  };
  const pickMenu = (anchor) => {
    closeMenu();
    const rc = anchor.getBoundingClientRect();
    document.body.append(h('div', { class: 'ctx-menu pick-menu', id: 'ctx-menu', style: `left:${Math.max(8, rc.right - 300)}px;bottom:${innerHeight - rc.top + 8}px` },
      list.map((i) => h('button', { class: 'menu-item acc-item' + (i.id === cur.id ? ' on' : ''), onclick: () => { closeMenu(); select(i); } },
        instIcon(i), h('span', { class: 'grow' }, h('b', {}, i.name), h('small', {}, `${loaderName(i.loader)} ${i.mcVersion}`)), state.running.includes(i.id) ? h('span', { class: 'tag g' }, 'läuft') : null)),
      h('div', { class: 'menu-sep' }),
      h('button', { class: 'menu-item', onclick: () => { closeMenu(); createInstanceModal(); } }, '+ Neue Instanz')));
  };
  drawLaunch();
  const stage = h('section', { class: 'stage' }, wrap, launch, status,
    cur ? h('div', { class: 'stage-links' },
      h('button', { class: 'btn sm ghost', onclick: () => go({ page: 'instance', id: cur.id }) }, 'Instanz öffnen'),
      h('button', { class: 'btn sm ghost', onclick: () => go({ page: 'instance', id: cur.id, tab: 'content' }) }, 'Mods'),
      h('button', { class: 'btn sm ghost', onclick: () => call(api.openInstance, cur.id) }, 'Ordner')) : null);

  // ---- shelf: instances as console tiles
  const shelf = h('div', { class: 'shelf' });
  const tiles = new Map();
  for (const [n, i] of list.entries()) {
    const t = h('div', { class: 'stile' + (state.running.includes(i.id) ? ' running' : ''), style: `animation-delay:${n * 30}ms`, title: 'Doppelklick: öffnen',
      onclick: () => select(i), ondblclick: () => go({ page: 'instance', id: i.id }), oncontextmenu: (e) => { e.preventDefault(); e.stopPropagation(); instanceMenu(i, e); } },
    h('div', { class: 'stile-art' }, pixelBanner(i.id + (i.bannerSeed || '')), instIcon(i, 72)),
    h('div', { class: 'stile-name' }, i.pinned ? '★ ' : '', i.name), h('div', { class: 'stile-meta' }, `${i.mcVersion} · ${loaderName(i.loader)}`));
    tiles.set(i.id, t);
    shelf.append(t);
  }
  shelf.append(h('div', { class: 'stile add', onclick: createInstanceModal }, h('div', { class: 'stile-art' }, '+'), h('div', { class: 'stile-name' }, 'Neue Instanz'), h('div', { class: 'stile-meta' }, 'oder importieren')));
  shelf.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      shelf.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  }, { passive: false });
  const mark = () => {
    for (const [id, t] of tiles) t.classList.toggle('on', cur && id === cur.id);
    tiles.get(cur?.id)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  };
  async function select(i) {
    cur = i;
    state.selectedInstance = i.id;
    mark();
    drawLaunch();
    stage.querySelector('.stage-links')?.replaceWith(h('div', { class: 'stage-links' },
      h('button', { class: 'btn sm ghost', onclick: () => go({ page: 'instance', id: i.id }) }, 'Instanz öffnen'),
      h('button', { class: 'btn sm ghost', onclick: () => go({ page: 'instance', id: i.id, tab: 'content' }) }, 'Mods'),
      h('button', { class: 'btn sm ghost', onclick: () => call(api.openInstance, i.id) }, 'Ordner')));
    api.selectInstance(i.id);
  }
  homeKeys = (dir) => {
    if (!list.length) return;
    const k = Math.max(0, Math.min(list.length - 1, list.indexOf(cur) + dir));
    select(list[k]);
  };
  homePlay = () => cur && play(cur);

  view.append(stage, h('div', { class: 'shelf-wrap' }, h('div', { class: 'shelf-head' }, h('span', { class: 'label' }, 'Deine Instanzen'), h('span', { class: 'muted hint' }, '← → wählen · Enter spielen')), shelf));
  requestAnimationFrame(mark);

  // ---- news column
  if (opt('newsCol', true)) {
    const nl = h('div', { class: 'nc-list' }, Array.from({ length: 3 }, () => h('div', { class: 'skeleton', style: 'height:200px;flex:none' })));
    view.append(h('aside', { class: 'newscol' }, h('div', { class: 'nc-head' }, h('span', { class: 'label grow' }, 'Neuigkeiten'), h('button', { class: 'btn sm ghost', onclick: () => go({ page: 'browse', type: 'modpack' }) }, 'Entdecken')), nl));
    const items = await homeFeed(cur);
    nl.replaceChildren(...(items.length ? items.map(newsCard) : [h('div', { class: 'muted', style: 'padding:20px' }, 'Keine Verbindung')]));
  } else view.classList.add('no-news');
};
let homeKeys = null;
let homePlay = null;
document.addEventListener('keydown', (e) => {
  if (route.page !== 'home' || !isConsole() || e.ctrlKey || e.altKey) return;
  if (document.querySelector('.backdrop') || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
  if (e.key === 'ArrowRight' && homeKeys) { e.preventDefault(); homeKeys(1); }
  if (e.key === 'ArrowLeft' && homeKeys) { e.preventDefault(); homeKeys(-1); }
  if (e.key === 'Enter' && homePlay) { e.preventDefault(); homePlay(); }
});
api.on('status', (t) => {
  const s = document.querySelector('.launch-status');
  if (s) s.textContent = t || '';
});

// ================================================================= instances page (the library as tiles)
async function instancesPage(view) {
  const filter = h('input', { placeholder: 'Instanzen filtern …', style: 'width:260px' });
  const grid = h('div', { class: 'inst-grid stagger' });
  const draw = () => {
    const q = filter.value.toLowerCase();
    const list = sortInstances(state.instances).filter((i) => !q || i.name.toLowerCase().includes(q) || (i.group || '').toLowerCase().includes(q) || i.mcVersion.includes(q));
    const pinned = list.filter((i) => i.pinned);
    const rest = list.filter((i) => !i.pinned);
    grid.replaceChildren(...[...pinned, ...rest].map((i, n) => {
      const running = state.running.includes(i.id);
      return h('div', { class: 'stile big' + (running ? ' running' : ''), style: `animation-delay:${n * 25}ms`, onclick: () => go({ page: 'instance', id: i.id }), oncontextmenu: (e) => { e.preventDefault(); e.stopPropagation(); instanceMenu(i, e); } },
        h('div', { class: 'stile-art' }, pixelBanner(i.id + (i.bannerSeed || '')), instIcon(i, 72),
          h('button', { class: 'stile-play', title: running ? 'Stoppen' : 'Spielen', onclick: (e) => { e.stopPropagation(); play(i); } }, svg(running ? I.stop : I.play))),
        h('div', { class: 'stile-name' }, i.pinned ? '★ ' : '', i.name),
        h('div', { class: 'stile-meta' }, `${i.mcVersion} · ${loaderName(i.loader)}${i.group ? ' · ' + i.group : ''} · ${ago(i.lastPlayed)}`));
    }), h('div', { class: 'stile big add', onclick: createInstanceModal }, h('div', { class: 'stile-art' }, '+'), h('div', { class: 'stile-name' }, 'Neue Instanz'), h('div', { class: 'stile-meta' }, 'Version & Loader wählen')));
  };
  filter.addEventListener('input', draw);
  view.append(h('div', { class: 'row' }, h('div', { class: 'grow' }, h('h1', {}, 'Instanzen'), h('p', { class: 'sub' }, `${state.instances.length} Instanzen · Rechtsklick für mehr`)),
    filter, h('button', { class: 'btn', onclick: () => go({ page: 'import' }) }, svg(I.upload), 'Importieren'), h('button', { class: 'btn primary', onclick: createInstanceModal }, svg(I.plus), 'Neu')),
  h('div', { style: 'height:18px' }), grid);
  draw();
}

// ================================================================= floating cubes
(() => {
  const c = h('canvas', { id: 'cubes' });
  document.getElementById('light').before(c);
  const g = c.getContext('2d');
  const V = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) V.push([x, y, z]);
  const E = [];
  for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) if (V[a].filter((v, k) => v !== V[b][k]).length === 1) E.push([a, b]);
  const make = (anywhere) => ({ x: Math.random(), y: anywhere ? Math.random() : 1.15, z: 0.25 + Math.random() * 0.75, s: 10 + Math.random() * 26,
    a: Math.random() * 6, b: Math.random() * 6, va: (Math.random() - 0.5) * 0.012, vb: (Math.random() - 0.5) * 0.012, vy: 0.00008 + Math.random() * 0.00022, drift: Math.random() * 6 });
  let cubes = [];
  let dpr = 1;
  function frame(t) {
    requestAnimationFrame(frame);
    const on = stateReady() && opt('cubes', true);
    c.style.display = on ? '' : 'none';
    if (!on || document.hidden) return;
    const want = Math.round(opt('cubeCount', 16));
    while (cubes.length < want) cubes.push(make(true));
    if (cubes.length > want) cubes.length = want;
    dpr = devicePixelRatio || 1;
    const w = innerWidth, hh = innerHeight;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(hh * dpr); }
    if (c.height !== Math.round(hh * dpr)) c.height = Math.round(hh * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hh);
    const cc = opt('cubeColor', 'accent');
    const [r, gr, b] = cc === 'white' ? [200, 200, 215] : cc === 'accent2' ? hexRgb(theme().accent2) : accentRgb();
    const still = document.body.classList.contains('no-motion');
    const mx = (lx / w - 0.5), my = (ly / hh - 0.5);
    for (const q of cubes) {
      if (!still) {
        q.a += q.va; q.b += q.vb; q.y -= q.vy * (0.6 + q.z);
        if (q.y < -0.15) Object.assign(q, make(false));
      }
      const cx = q.x * w + Math.sin(t / 4000 + q.drift) * 14 - mx * 40 * q.z;
      const cy = q.y * hh - my * 30 * q.z;
      const s = q.s * (0.6 + q.z);
      const ca = Math.cos(q.a), sa = Math.sin(q.a), cb = Math.cos(q.b), sb = Math.sin(q.b);
      const P = V.map(([x, y, z]) => {
        const x1 = x * ca - z * sa, z1 = x * sa + z * ca;
        const y1 = y * cb - z1 * sb, z2 = y * sb + z1 * cb;
        const k = 1 / (1 + z2 * 0.12);
        return [cx + x1 * s * k, cy + y1 * s * k, z2];
      });
      const alpha = 0.07 + q.z * 0.2;
      g.strokeStyle = `rgba(${Math.min(255, r + 60)},${Math.min(255, gr + 60)},${Math.min(255, b + 60)},${alpha.toFixed(3)})`;
      g.lineWidth = 1;
      g.beginPath();
      for (const [a2, b2] of E) { g.moveTo(P[a2][0], P[a2][1]); g.lineTo(P[b2][0], P[b2][1]); }
      g.stroke();
      // faint fill so they read as glass blocks
      g.fillStyle = `rgba(${r},${gr},${b},${(alpha * 0.18).toFixed(3)})`;
      g.beginPath();
      const hull = [0, 1, 3, 2].map((k) => P[k]);
      g.moveTo(hull[0][0], hull[0][1]);
      for (const p of hull) g.lineTo(p[0], p[1]);
      g.fill();
    }
  }
  requestAnimationFrame(frame);
})();
function hexRgb(v) {
  const n = parseInt(String(v || '#29d3ff').slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function stateReady() {
  return !!(state && state.settings);
}

// ================================================================= pixel night landscape at the bottom
const land = h('canvas', { id: 'land' });
document.getElementById('cubes').before(land);
let landKey = '';
function drawLand() {
  if (!state) return;
  const on = opt('land', true);
  land.style.display = on ? '' : 'none';
  if (!on) return;
  const S = 4;
  const w = Math.ceil(innerWidth / S), hh = Math.ceil((innerHeight * 0.38) / S);
  const key = `${w}x${hh}:${state.settings.accent}`;
  if (key === landKey) return;
  landKey = key;
  land.width = w;
  land.height = hh;
  const g = land.getContext('2d');
  g.clearRect(0, 0, w, hh);
  const [r, gr, b] = accentRgb();
  const rnd = hash('counter-land');
  const col = (k, a = 1) => `rgba(${(r * k * 0.55 + 6) | 0},${(gr * k * 0.45 + 5) | 0},${(b * k * 0.9 + 12) | 0},${a})`;
  const layers = [{ base: 0.42, amp: 0.2, k: 0.2, trees: 0.04 }, { base: 0.6, amp: 0.16, k: 0.12, trees: 0.08 }, { base: 0.8, amp: 0.1, k: 0.06, trees: 0.1, lights: true }];
  for (const L of layers) {
    const p1 = rnd() * 9, p2 = rnd() * 9, p3 = rnd() * 9;
    let prev = 0;
    for (let x = 0; x < w; x += 2) {
      const n = Math.sin(x / 37 + p1) * 0.5 + Math.sin(x / 13 + p2) * 0.3 + Math.sin(x / 71 + p3) * 0.6;
      let y = Math.round((hh * (L.base - n * L.amp * 0.5)) / 2) * 2;
      y = Math.max(2, Math.min(hh - 2, y));
      g.fillStyle = col(L.k);
      g.fillRect(x, y, 2, hh - y);
      g.fillStyle = col(L.k * 1.9, 0.9);
      g.fillRect(x, y, 2, 1);
      if (rnd() < L.trees && Math.abs(y - prev) < 3) {
        const th = 3 + Math.floor(rnd() * 3);
        g.fillStyle = col(L.k * 0.8);
        g.fillRect(x, y - th, 1, th);
        g.fillStyle = col(L.k * 1.15);
        for (let k = 0; k < 4; k++) g.fillRect(x - k, y - th - 8 + k * 2, 1 + k * 2, 2);
      }
      if (L.lights && rnd() < 0.025) {
        g.fillStyle = 'rgba(255,190,110,0.9)';
        g.fillRect(x, y + 2, 1, 1);
        g.fillStyle = 'rgba(255,170,80,0.18)';
        g.fillRect(x - 1, y + 1, 3, 3);
      }
      prev = y;
    }
  }
}
addEventListener('resize', () => requestAnimationFrame(drawLand));

// ================================================================= theme hooks + settings
const _applyTheme2 = applyTheme;
// eslint-disable-next-line no-func-assign
applyTheme = function (t = theme(), accent = state.settings.accent) {
  _applyTheme2(t, accent);
  const b = document.body.classList;
  const consoleOn = (t.layout || 'console') === 'console';
  b.toggle('layout-console', consoleOn);
  b.toggle('show-library', consoleOn && !!t.consoleLibrary);
  b.toggle('pixel-heads', t.pixelHeads ?? true);
  b.toggle('clean', !t.style || t.style === 'clean');
  b.toggle('rail-icons', consoleOn && !!t.railIcons);
  b.toggle('stage-left', t.stageAlign === 'left');
  for (const m of ['gradient', 'solid', 'outline']) b.toggle('launch-' + m, (t.launchStyle || 'gradient') === m);
  document.documentElement.style.setProperty('--pixel-scale', String((t.pixelSize || 100) / 100));
  drawLand();
  applySkinPrefs();
  if (state) drawTop();
};

function consoleSettings() {
  const t = theme();
  const seg = (key, opts, def) => h('div', { class: 'seg' }, opts.map(([k, l]) => h('button', { class: (t[key] ?? def) === k ? 'on' : '', onclick: async () => { await saveTheme({ [key]: k }); render(); } }, l)));
  const sw = (key, label, def) => {
    const b = h('button', { class: 'switch' + ((t[key] ?? def) ? ' on' : '') });
    b.addEventListener('click', async () => { const v = !(theme()[key] ?? def); await saveTheme({ [key]: v }); b.classList.toggle('on', v); });
    return [h('label', {}, label), b];
  };
  const cnt = h('span', { class: 'muted', style: 'min-width:30px;text-align:right' }, String(t.cubeCount ?? 16));
  return h('div', {},
    h('h2', {}, 'Startseite & Layout'),
    h('div', { class: 'form panel' },
      h('label', {}, 'Layout'), seg('layout', [['console', 'Konsole'], ['classic', 'Klassisch']], 'console'),
      h('label', {}, 'Skin-Animation'), seg('skinAnim', [['idle', 'Stehen'], ['walk', 'Laufen'], ['run', 'Rennen'], ['wave', 'Winken'], ['fly', 'Fliegen'], ['cheer', 'Jubeln'], ['think', 'Denken'], ['sit', 'Sitzen'], ['dab', 'Dab'], ['sneak', 'Schleichen'], ['none', 'Aus']], 'idle'),
      ...sw('skinRotate', 'Skin dreht sich langsam', true),
      ...sw('skinCape', 'Umhang am Skin zeigen', true),
      ...sw('cubes', 'Schwebende Würfel', true),
      h('label', {}, 'Anzahl Würfel'), h('div', { class: 'row' }, h('input', { type: 'range', min: 4, max: 40, step: 1, value: t.cubeCount ?? 16, class: 'grow',
        oninput: (e) => { cnt.textContent = e.target.value; state.settings.theme = { ...(state.settings.theme || {}), cubeCount: Number(e.target.value) }; },
        onchange: (e) => saveTheme({ cubeCount: Number(e.target.value) }) }), cnt),
      ...sw('land', 'Pixel-Landschaft unten', true),
      ...sw('newsCol', 'Neuigkeiten-Spalte auf der Startseite', true),
      ...sw('consoleLibrary', 'Bibliothek-Spalte im Konsolen-Layout', false),
      ...sw('pixelHeads', 'Pixel-Schrift für Überschriften', true),
      h('div', { class: 'hint' }, 'Tipp: Skin mit der Maus drehen, Doppelklick lässt ihn winken.')));
}
const _extraSettings = extraSettings;
// eslint-disable-next-line no-func-assign
extraSettings = function () {
  return h('div', {}, consoleSettings(), _extraSettings());
};

const _refresh = refresh;
// eslint-disable-next-line no-func-assign
refresh = async function () {
  await _refresh();
  drawTop();
  if (viewer && skinFor !== (state.activeAccount || '-')) loadSkin();
};
api.on('running', () => drawTop());
