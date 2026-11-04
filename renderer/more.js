// Counter Launcher – more home/console features on top of console.js: skin library page, favourite servers with live
// status on the home page, random screenshot background, mod updates on the home page, the skin running off when the
// game starts and the extra design options (skin size/position/speed, cube colour, launch button, rail, pixel size).

// ================================================================= small helpers
function rangeRow(label, key, min, max, step, def, unit = '', live) {
  const t = theme();
  const val = h('span', { class: 'muted', style: 'min-width:52px;text-align:right' }, `${t[key] ?? def}${unit}`);
  return [h('label', {}, label), h('div', { class: 'row' }, h('input', { type: 'range', min, max, step, value: t[key] ?? def, class: 'grow',
    oninput: (e) => {
      val.textContent = `${e.target.value}${unit}`;
      state.settings.theme = { ...(state.settings.theme || {}), [key]: Number(e.target.value) };
      if (live) live(Number(e.target.value));
    },
    onchange: (e) => saveTheme({ [key]: Number(e.target.value) }) }), val)];
}
function segRow(label, key, opts, def) {
  const t = theme();
  return [h('label', {}, label), h('div', { class: 'seg' }, opts.map(([k, l]) => h('button', { class: (t[key] ?? def) === k ? 'on' : '', onclick: async (e) => {
    await saveTheme({ [key]: k });
    e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.currentTarget));
  } }, l)))];
}
function switchRow(label, key, def, after) {
  const b = h('button', { class: 'switch' + ((theme()[key] ?? def) ? ' on' : '') });
  b.addEventListener('click', async () => {
    const v = !(theme()[key] ?? def);
    b.classList.toggle('on', v);
    await saveTheme({ [key]: v });
    if (after) after(v);
  });
  return [h('label', {}, label), b];
}

// ================================================================= skin library
(() => {
  const btn = h('button', { class: 'nav', 'data-page': 'skins' }, svg('M8 3h8l1 4-2 1v13H9V8L7 7z'), h('span', { class: 'tip' }, 'Skins'));
  btn.addEventListener('click', () => go({ page: 'skins' }));
  $('#rail .nav[data-page="browse"]').before(btn);
})();
extraPages.skins = skinsPage;
extraNames.skins = 'Skins';

/** 2D front view of a skin texture (head, body, arms, legs + overlay layer) */
function skinFront(src, slim, scale = 6) {
  const c = h('canvas', { width: 16 * scale, height: 32 * scale, class: 'skin2d' });
  const img = new Image();
  img.onload = () => {
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    const tall = img.height === 64;
    const aw = slim ? 3 : 4;
    const part = (sx, sy, w, hh, dx, dy, flip) => {
      g.save();
      if (flip) {
        g.translate((dx + w) * scale, dy * scale);
        g.scale(-1, 1);
        g.drawImage(img, sx, sy, w, hh, 0, 0, w * scale, hh * scale);
      } else g.drawImage(img, sx, sy, w, hh, dx * scale, dy * scale, w * scale, hh * scale);
      g.restore();
    };
    part(8, 8, 8, 8, 4, 0); part(40, 8, 8, 8, 4, 0);
    part(20, 20, 8, 12, 4, 8);
    part(44, 20, aw, 12, 4 - aw, 8);
    if (tall) part(36, 52, aw, 12, 12, 8); else part(44, 20, aw, 12, 12, 8, true);
    part(4, 20, 4, 12, 4, 20);
    if (tall) part(20, 52, 4, 12, 8, 20); else part(4, 20, 4, 12, 8, 20, true);
    if (tall) {
      part(20, 36, 8, 12, 4, 8); part(44, 36, aw, 12, 4 - aw, 8); part(52, 52, aw, 12, 12, 8); part(4, 36, 4, 12, 4, 20); part(4, 52, 4, 12, 8, 20);
    }
  };
  img.src = src;
  return c;
}

let previewViewer = null;
function previewCanvas() {
  if (!window.skinview3d) return null;
  if (!previewViewer) {
    previewViewer = new skinview3d.SkinViewer({ canvas: h('canvas', { class: 'skin3d' }), width: 280, height: 380 });
    previewViewer.controls.enableZoom = false;
    previewViewer.controls.enablePan = false;
    previewViewer.fov = 38;
    previewViewer.zoom = 0.85;
    previewViewer.playerObject.rotation.y = 0.45;
    previewViewer.autoRotate = true;
    previewViewer.autoRotateSpeed = 0.8;
    previewViewer.animation = new skinview3d.WalkingAnimation();
    previewViewer.animation.speed = 0.6;
  }
  previewViewer.renderPaused = false;
  return previewViewer.canvas;
}
const _renderMore = render;
render = async function () {
  await _renderMore();
  if (previewViewer) previewViewer.renderPaused = !previewViewer.canvas.isConnected;
};

async function skinsPage(view) {
  const acc = state.accounts.find((a) => a.uuid === state.activeAccount);
  const skins = await call(api.skinsList);
  const current = await call(api.skin).catch(() => ({}));
  let sel = skins.find((s) => s.id === state.settings.localSkin) || null;
  const box = h('div', { class: 'skin-preview panel' });
  const canvas = previewCanvas();
  const info = h('div', { class: 'skin-info' });
  const show = () => {
    const src = sel ? sel.data : current.url;
    if (previewViewer && src) previewViewer.loadSkin(src, { model: (sel ? sel.slim : current.slim) ? 'slim' : 'default' });
    if (previewViewer) previewViewer.loadCape(!sel && current.cape ? current.cape : null);
    const usingLocal = sel && state.settings.localSkin === sel.id;
    info.replaceChildren(...[
      h('div', { class: 'label' }, sel ? 'Aus deiner Bibliothek' : 'Aktueller Skin'),
      h('div', { class: 'skin-name' }, sel ? sel.name : acc ? acc.name : 'Standard'),
      sel ? h('div', { class: 'row', style: 'margin-top:12px' },
        h('div', { class: 'seg' }, [['classic', 'Breit'], ['slim', 'Schmal']].map(([k, l]) => h('button', { class: (sel.slim ? 'slim' : 'classic') === k ? 'on' : '', onclick: async () => { sel.slim = k === 'slim'; await call(api.skinsUpdate, sel.id, { slim: sel.slim }); show(); } }, l))),
        h('button', { class: 'btn sm', onclick: () => promptModal('Name', '', sel.name, async (v) => { if (v.trim()) { await call(api.skinsUpdate, sel.id, { name: v.trim() }); render(); } }) }, 'Umbenennen')) : null,
      sel ? h('div', { class: 'col-actions' },
        h('button', { class: 'btn primary', disabled: !acc || acc.type !== 'msa', title: acc && acc.type === 'msa' ? '' : 'Nur mit einem Microsoft-Konto', onclick: async (e) => {
          e.currentTarget.disabled = true;
          try {
            await call(api.skinsUpload, sel.id);
            await call(api.setSettings, { localSkin: '' });
            state.settings.localSkin = '';
            skinFor = null;
            toast('Skin bei Minecraft gesetzt – sichtbar beim nächsten Server-Join');
            render();
          } catch (err) {
            toast(err.message, true);
            e.currentTarget.disabled = false;
          }
        } }, svg(I.upload), 'Bei Minecraft setzen'),
        h('button', { class: 'btn', onclick: async () => {
          const v = usingLocal ? '' : sel.id;
          await call(api.setSettings, { localSkin: v });
          state.settings.localSkin = v;
          skinFor = null;
          toast(v ? 'Wird jetzt im Launcher gezeigt' : 'Launcher zeigt wieder deinen echten Skin');
          render();
        } }, usingLocal ? 'Nicht mehr im Launcher zeigen' : 'Im Launcher zeigen'),
        h('button', { class: 'btn ghost danger', onclick: () => confirmModal(`„${sel.name}“ entfernen? Die Datei kommt in den Papierkorb.`, async () => {
          await call(api.skinsRemove, sel.id);
          if (state.settings.localSkin === sel.id) { await call(api.setSettings, { localSkin: '' }); state.settings.localSkin = ''; skinFor = null; }
          render();
        }, 'Entfernen') }, svg(I.trash), 'Entfernen'))
        : h('p', { class: 'muted', style: 'margin-top:10px' }, acc && acc.type === 'msa' ? 'Wähle rechts einen Skin, um ihn anzusehen oder bei Minecraft zu setzen.' : 'Mit einem Microsoft-Konto kannst du Skins direkt setzen. Sonst kannst du sie hier sammeln und im Launcher anzeigen.')].filter(Boolean));
  };
  if (canvas) box.append(h('div', { class: 'skin-stage' }, h('div', { class: 'pedestal' }), canvas));
  box.append(info);
  const add = async () => {
    try {
      const ids = await call(api.skinsAdd);
      if (ids.length) { toast(`${ids.length} Skin(s) hinzugefügt`); render(); }
    } catch (e) {
      toast(e.message, true);
    }
  };
  const grid = h('div', { class: 'skin-grid stagger' },
    h('div', { class: 'skin-card' + (!sel ? ' on' : ''), onclick: () => { sel = null; mark(); show(); } },
      current.url ? skinFront(current.url, current.slim) : h('div', { class: 'skin2d' }), h('div', { class: 't' }, 'Aktuell'), h('div', { class: 'm' }, acc ? acc.name : 'Standard')),
    skins.map((s) => h('div', { class: 'skin-card' + (sel && sel.id === s.id ? ' on' : '') + (state.settings.localSkin === s.id ? ' used' : ''), 'data-id': s.id, onclick: () => { sel = s; mark(); show(); } },
      skinFront(s.data, s.slim), h('div', { class: 't' }, s.name), h('div', { class: 'm' }, s.slim ? 'Schmal' : 'Breit'))),
    h('div', { class: 'skin-card add', onclick: add }, h('div', { class: 'plus' }, '+'), h('div', { class: 't' }, 'Skin hinzufügen'), h('div', { class: 'm' }, '64×64 PNG')));
  const mark = () => grid.querySelectorAll('.skin-card').forEach((c, k) => c.classList.toggle('on', sel ? c.dataset.id === sel.id : k === 0));
  view.append(h('div', { class: 'row' }, h('div', { class: 'grow' }, h('h1', {}, 'Skins'), h('p', { class: 'sub' }, 'Deine Skin-Bibliothek – ansehen, wechseln, bei Minecraft setzen.')),
    h('button', { class: 'btn', onclick: () => api.openExternal('https://namemc.com/minecraft-skins') }, svg(I.ext), 'Skins finden'),
    h('button', { class: 'btn primary', onclick: add }, svg(I.plus), 'Hinzufügen')),
  h('div', { style: 'height:18px' }), h('div', { class: 'skins-layout' }, box, grid));
  show();
}

// ================================================================= favourite servers on the home page
const pingCache = new Map();
async function pingCached(ip) {
  const c = pingCache.get(ip);
  if (c && Date.now() - c.at < 60_000) return c.r;
  const r = await call(api.pingServer, ip).catch(() => ({ online: false, error: 'Fehler' }));
  pingCache.set(ip, { at: Date.now(), r });
  return r;
}
const favServers = () => state.settings.favServers || [];
async function saveFavs(list) {
  await call(api.setSettings, { favServers: list });
  state.settings.favServers = list;
}
function joinServer(ip) {
  const inst = instById(state.selectedInstance) || sortInstances(state.instances)[0];
  if (!inst) return toast('Lege zuerst eine Instanz an', true);
  if (state.running.includes(inst.id)) return toast(`${inst.name} läuft schon`, true);
  play(inst, { server: ip });
}
function serverRow(s, fav) {
  const icon = h('div', { class: 'srv-icon' }, s.icon ? h('img', { src: s.icon, alt: '' }) : pixelIcon(s.ip, 30));
  const meta = h('div', { class: 'srv-meta' }, 'Verbinde …');
  const dot = h('span', { class: 'srv-dot' });
  const row = h('div', { class: 'srv-row', title: 'Klicken zum Beitreten', onclick: () => joinServer(s.ip), oncontextmenu: (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeMenu();
    const item = (label, fn, cls = '') => h('button', { class: 'menu-item ' + cls, onclick: async () => { closeMenu(); await fn(); } }, label);
    document.body.append(h('div', { class: 'ctx-menu', id: 'ctx-menu', style: `left:${Math.min(e.clientX, innerWidth - 220)}px;top:${Math.min(e.clientY, innerHeight - 160)}px` },
      item('Beitreten', () => joinServer(s.ip)),
      item('Adresse kopieren', () => navigator.clipboard.writeText(s.ip)),
      fav ? item('Umbenennen …', () => promptModal('Name', '', s.name, async (v) => { await saveFavs(favServers().map((x) => (x.ip === s.ip ? { ...x, name: v.trim() || x.name } : x))); render(); })) : null,
      fav ? item('Entfernen', async () => { await saveFavs(favServers().filter((x) => x.ip !== s.ip)); render(); }, 'danger') : item('Zu Favoriten', async () => { await saveFavs([...favServers(), { name: s.name, ip: s.ip }]); render(); })));
  } },
  icon, h('div', { class: 'grow', style: 'min-width:0' }, h('div', { class: 'srv-name' }, s.name || s.ip), meta), dot,
  fav ? null : h('button', { class: 'srv-star', title: 'Zu Favoriten', onclick: async (e) => { e.stopPropagation(); await saveFavs([...favServers(), { name: s.name, ip: s.ip }]); render(); } }, '☆'));
  pingCached(s.ip).then((r) => {
    if (r.favicon && !s.icon) icon.replaceChildren(h('img', { src: r.favicon, alt: '' }));
    dot.className = 'srv-dot ' + (r.online ? (r.ping != null && r.ping > 150 ? 'mid' : 'on') : 'off');
    dot.title = r.online ? `${r.ping ?? '?'} ms` : r.error;
    meta.textContent = r.online ? `${r.players}/${r.max} online${r.version ? ' · ' + r.version : ''}` : r.error || 'Offline';
    if (r.online && r.motd) row.title = `${r.motd}${r.sample.length ? '\n\nOnline: ' + r.sample.join(', ') : ''}\n\nKlicken zum Beitreten`;
  });
  return row;
}
async function serverBox() {
  const favs = favServers();
  const list = h('div', { class: 'srv-list' });
  const box = h('div', { class: 'srv-box' }, h('div', { class: 'nc-head' }, h('span', { class: 'label grow' }, 'Server'),
    h('button', { class: 'btn sm ghost', title: 'Server hinzufügen', onclick: () => promptModal('Server hinzufügen', 'Adresse, z. B. play.example.net oder 1.2.3.4:25565', '', async (v) => {
      const ip = v.trim();
      if (!ip) return;
      await saveFavs([...favServers().filter((x) => x.ip !== ip), { name: ip, ip }]);
      render();
    }) }, svg(I.plus))), list);
  if (favs.length) list.append(...favs.map((s) => serverRow(s, true)));
  else {
    const known = (await call(api.knownServers).catch(() => [])).slice(0, 3);
    list.append(...(known.length ? [h('div', { class: 'srv-hint' }, 'Aus deinen Instanzen – ☆ zum Merken'), ...known.map((s) => serverRow(s, false))] : [h('div', { class: 'srv-hint' }, 'Noch keine Server. Mit + hinzufügen, dann mit einem Klick beitreten.')]));
  }
  return box;
}

// ================================================================= home additions
const _homeConsole = home;
let shotTimer = null;
home = async function (view, r) {
  const p = _homeConsole(view, r);
  if (isConsole()) {
    // the news column exists synchronously before the feed loads
    const col = view.querySelector('.newscol');
    if (col && opt('serverBox', true)) serverBox().then((b) => col.insertBefore(b, col.querySelector('.nc-head')));
    if (opt('homeUpdates', true)) watchUpdates(view);
    if (opt('homeUpdates', true)) updateOverviewCard(view);
  }
  return p;
};

// mod updates of the selected instance, as a small chip under the launch button
const updCache = new Map();
function watchUpdates(view) {
  let last = null;
  const tick = async () => {
    if (!view.isConnected) return clearInterval(iv);
    const id = state.selectedInstance || sortInstances(state.instances)[0]?.id;
    if (!id || id === last) return;
    last = id;
    const inst = instById(id);
    view.querySelector('.upd-chip')?.remove();
    if (!inst || inst.loader === 'vanilla') return;
    let c = updCache.get(id);
    if (!c || Date.now() - c.at > 15 * 60_000) {
      try {
        c = { at: Date.now(), list: await call(api.checkUpdates, id) };
      } catch {
        c = { at: Date.now(), list: [] };
      }
      updCache.set(id, c);
    }
    if (!c.list.length || (state.selectedInstance && state.selectedInstance !== id) || !view.isConnected) return;
    const chip = h('button', { class: 'upd-chip', onclick: () => confirmModal(`${c.list.length} Mod-Update(s) für „${inst.name}“:\n${c.list.map((x) => `${x.name} → ${x.version}`).join('\n')}`, async () => {
      await applyUpdatesWithProgress(inst, c.list);
      updCache.delete(id);
      chip.remove();
      toast(`${c.list.length} Mod(s) aktualisiert`);
    }, 'Aktualisieren') }, h('i'), `${c.list.length} Mod-Update${c.list.length === 1 ? '' : 's'}`);
    view.querySelector('.launch-status')?.after(chip);
  };
  const iv = setInterval(tick, 800);
  tick();
}

// the skin runs while the game is starting
const _playMore = play;
play = async function (inst, opts = {}) {
  const starting = !state.running.includes(inst.id) && !busy.has(inst.id);
  if (starting && viewer && !waveTimer) viewer.animation = animation('run');
  try {
    return await _playMore(inst, opts);
  } finally {
    if (starting && viewer) {
      clearTimeout(waveTimer);
      viewer.animation = animation('wave');
      waveTimer = setTimeout(() => { waveTimer = null; applySkinPrefs(); }, 2200);
    }
  }
};

// ================================================================= random screenshot background
const shotLayer = h('div', { id: 'shotbg' });
document.getElementById('sky').before(shotLayer);
let shotAt = 0;
async function loadShot(force) {
  const on = opt('shotBg', false);
  document.body.classList.toggle('has-shot', on && !!shotLayer.dataset.ok);
  if (!on || (!force && Date.now() - shotAt < 3 * 60_000)) return;
  shotAt = Date.now();
  const r = await api.randomShot();
  if (r.ok && r.data) {
    const img = new Image();
    img.onload = () => {
      shotLayer.style.opacity = '0';
      setTimeout(() => {
        shotLayer.style.backgroundImage = `url("${r.data}")`;
        shotLayer.dataset.ok = '1';
        shotLayer.style.opacity = '';
        document.body.classList.toggle('has-shot', opt('shotBg', false));
      }, shotLayer.dataset.ok ? 500 : 0);
    };
    img.src = r.data;
  } else if (force) toast('Keine Screenshots gefunden – mach im Spiel welche mit F2', true);
}
setInterval(() => state && loadShot(false), 60_000);

// ================================================================= settings: more design options
const _applyTheme3 = applyTheme;
// eslint-disable-next-line no-func-assign
applyTheme = function (t = theme(), accent = state.settings.accent) {
  _applyTheme3(t, accent);
  const r = document.documentElement.style;
  r.setProperty('--shot-blur', (t.shotBlur ?? 4) + 'px');
  r.setProperty('--shot-dim', String((t.shotDim ?? 55) / 100));
  document.body.classList.toggle('has-shot', !!t.shotBg && !!shotLayer.dataset.ok);
  if (t.shotBg && !shotLayer.dataset.ok) loadShot(true);
};
const _consoleSettings = consoleSettings;
// eslint-disable-next-line no-func-assign
consoleSettings = function () {
  return h('div', {}, _consoleSettings(),
    h('h2', {}, 'Startseite – Feinschliff'),
    h('div', { class: 'form panel' },
      ...rangeRow('Skin-Größe', 'skinSize', 60, 140, 5, 100, '%', () => applySkinPrefs()),
      ...rangeRow('Skin-Drehtempo', 'skinSpeed', 0.2, 3, 0.1, 1, '×', () => applySkinPrefs()),
      ...segRow('Skin-Position', 'stageAlign', [['center', 'Mitte'], ['left', 'Links']], 'center'),
      ...segRow('Spielen-Knopf', 'launchStyle', [['gradient', 'Verlauf'], ['solid', 'Einfarbig'], ['outline', 'Umriss']], 'gradient'),
      ...segRow('Würfelfarbe', 'cubeColor', [['accent', 'Akzent'], ['accent2', 'Zweitfarbe'], ['white', 'Weiß']], 'accent'),
      ...segRow('Seitenleiste', 'railIcons', [[false, 'Mit Text'], [true, 'Nur Icons']], false),
      ...rangeRow('Pixel-Schriftgröße', 'pixelSize', 80, 130, 5, 100, '%', (v) => document.documentElement.style.setProperty('--pixel-scale', String(v / 100))),
      h('label', {}, 'Fenster „Laufende Spiele“ beim Start öffnen'),
      (() => {
        const b = h('button', { class: 'switch' + (state.settings.gamesWindow !== false ? ' on' : '') });
        b.addEventListener('click', async () => {
          const v = state.settings.gamesWindow === false;
          b.classList.toggle('on', v);
          state.settings.gamesWindow = v;
          await call(api.setSettings, { gamesWindow: v });
        });
        return b;
      })(),
      ...switchRow('Server auf der Startseite', 'serverBox', true),
      ...switchRow('Mod-Updates auf der Startseite anzeigen', 'homeUpdates', true),
      ...switchRow('Zufälliger Screenshot als Hintergrund', 'shotBg', false, (v) => v && loadShot(true)),
      ...rangeRow('Screenshot-Unschärfe', 'shotBlur', 0, 16, 1, 4, 'px', (v) => document.documentElement.style.setProperty('--shot-blur', v + 'px')),
      ...rangeRow('Screenshot abdunkeln', 'shotDim', 10, 90, 5, 55, '%', (v) => document.documentElement.style.setProperty('--shot-dim', String(v / 100))),
      h('label', {}, ''), h('div', { class: 'row' },
        h('button', { class: 'btn sm', onclick: () => loadShot(true) }, svg(I.refresh), 'Anderer Screenshot'),
        h('button', { class: 'btn sm ghost', onclick: async () => {
          const keys = ['layout', 'skinAnim', 'skinRotate', 'skinCape', 'cubes', 'cubeCount', 'land', 'newsCol', 'consoleLibrary', 'pixelHeads', 'skinSize', 'skinSpeed', 'stageAlign', 'launchStyle', 'cubeColor', 'railIcons', 'pixelSize', 'serverBox', 'homeUpdates', 'shotBg', 'shotBlur', 'shotDim'];
          await saveTheme(Object.fromEntries(keys.map((k) => [k, undefined])));
          toast('Startseite zurückgesetzt');
          render();
        } }, 'Startseite zurücksetzen'))));
};

// ================================================================= settings: jump bar to the sections
const _settingsMore = settings;
// eslint-disable-next-line no-func-assign
settings = function (view) {
  _settingsMore(view);
  const heads = [...view.querySelectorAll('h2')];
  const bar = h('div', { class: 'jump-bar' }, heads.map((hd) => h('button', { onclick: () => hd.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, hd.textContent)));
  view.querySelector('h1')?.after(bar);
};
