// Counter Launcher – bigger features on top of app.js: instance icons, favourites and groups in the library,
// command palette (Ctrl+K), keyboard shortcuts, server quick join, world backups, .mrpack export, statistics,
// crash dialog, news page, Java picker and the "layout & behaviour" settings (fonts, custom CSS, theme sharing).
// Functions declared here replace the simpler versions from app.js (same global names).

// ================================================================= instance icons
let iconCache = {};
async function loadIcons() {
  const r = await api.icons();
  if (r.ok) iconCache = r.data || {};
}
function instIcon(i, size = 34) {
  if (iconCache[i.id]) return h('img', { src: iconCache[i.id], class: 'icon' + (size > 40 ? ' lg' : ''), alt: '' });
  if (i.emoji) return h('div', { class: 'icon emoji' + (size > 40 ? ' lg' : ''), style: `background:${i.color || 'var(--accent)'}` }, i.emoji);
  return pixelIcon(i.id, size);
}

// ================================================================= library: favourites, groups, sort
const SORTS = { recent: 'Zuletzt gespielt', name: 'Name', version: 'Version', created: 'Erstellt' };
function sortInstances(list) {
  const mode = theme().librarySort || 'recent';
  const cmpVer = (a, b) => b.mcVersion.localeCompare(a.mcVersion, undefined, { numeric: true });
  const by = { recent: (a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0), name: (a, b) => a.name.localeCompare(b.name), version: cmpVer, created: (a, b) => (b.created || 0) - (a.created || 0) }[mode];
  return [...list].sort(by);
}
const collapsed = new Set(JSON.parse(localStorageGet('cl.collapsed') || '[]'));
function localStorageGet(k) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function localStorageSet(k, v) {
  try {
    localStorage.setItem(k, v);
  } catch {}
}

function drawLibrary() {
  const filter = $('#lib-filter').value.toLowerCase();
  const list = sortInstances(state.instances.filter((i) => !filter || i.name.toLowerCase().includes(filter) || (i.group || '').toLowerCase().includes(filter)));
  const item = (i) => {
    const running = state.running.includes(i.id);
    const active = route.page === 'instance' && route.id === i.id;
    return h('div', { class: 'lib-item' + (active ? ' active' : '') + (running ? ' running' : ''), onclick: () => go({ page: 'instance', id: i.id }), oncontextmenu: (e) => { e.preventDefault(); instanceMenu(i, e); } },
      instIcon(i),
      h('div', { class: 'grow' }, h('div', { class: 't' }, i.pinned ? '★ ' : '', i.name), h('div', { class: 'm' }, `${i.mcVersion} · ${loaderName(i.loader)}${i.counter ? ' · Counter' : ''}`)),
      h('button', { class: 'mini-play' + (running ? ' on' : ''), title: running ? 'Stoppen' : 'Spielen', onclick: (e) => { e.stopPropagation(); play(i); } }, svg(running ? I.stop : I.play)));
  };
  const out = [];
  const pinned = list.filter((i) => i.pinned);
  if (pinned.length) out.push(h('div', { class: 'lib-group' }, 'Favoriten'), ...pinned.map(item));
  const groups = {};
  for (const i of list.filter((x) => !x.pinned)) (groups[i.group || ''] ||= []).push(i);
  for (const [g, items] of Object.entries(groups).sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))) {
    const name = g || (pinned.length || Object.keys(groups).length > 1 ? 'Weitere' : '');
    if (name) {
      const closed = collapsed.has(name);
      out.push(h('button', { class: 'lib-group', onclick: () => { closed ? collapsed.delete(name) : collapsed.add(name); localStorageSet('cl.collapsed', JSON.stringify([...collapsed])); drawLibrary(); } }, closed ? '▸ ' : '▾ ', name, h('span', { class: 'cnt' }, items.length)));
      if (closed) continue;
    }
    out.push(...items.map(item));
  }
  $('#lib-list').replaceChildren(...out);
  const acc = state.accounts.find((a) => a.uuid === state.activeAccount);
  $('#lib-account').replaceChildren(
    acc ? h('img', { src: `https://mc-heads.net/avatar/${acc.type === 'msa' ? acc.uuid : 'MHF_Steve'}/28`, alt: '' }) : h('div', { class: 'ph' }),
    h('div', { class: 'grow' }, h('div', { style: 'font-weight:600' }, acc ? acc.name : 'Kein Konto'), h('div', { class: 'muted', style: 'font-size:11.5px' }, acc ? (acc.type === 'msa' ? 'Microsoft' : acc.type === 'official' ? 'über Minecraft Launcher' : 'Offline') : 'Klicken zum Hinzufügen')));
}

/** right click menu of a library entry */
function instanceMenu(i, e) {
  closeMenu();
  const entry = (label, fn, cls = '') => h('button', { class: 'menu-item ' + cls, onclick: async () => { closeMenu(); await fn(); } }, label);
  const menu = h('div', { class: 'ctx-menu', id: 'ctx-menu', style: `left:${Math.min(e.clientX, innerWidth - 220)}px;top:${Math.min(e.clientY, innerHeight - 260)}px` },
    entry(state.running.includes(i.id) ? 'Stoppen' : 'Spielen', () => play(i)),
    entry(i.pinned ? 'Von Favoriten entfernen' : 'Zu Favoriten', async () => { await call(api.updateInstance, i.id, { pinned: !i.pinned }); await refresh(); }),
    entry('Gruppe festlegen …', () => promptModal('Gruppe', 'z. B. PvP, Modpacks, Tests (leer = keine)', i.group || '', async (v) => { await call(api.updateInstance, i.id, { group: v.trim() }); await refresh(); })),
    entry('Umbenennen …', () => promptModal('Name', '', i.name, async (v) => { if (v.trim()) { await call(api.updateInstance, i.id, { name: v.trim() }); await refresh(); render(); } })),
    entry('Ordner öffnen', () => call(api.openInstance, i.id)),
    entry('Duplizieren', async () => { const c = await call(api.duplicateInstance, i.id); await refresh(); go({ page: 'instance', id: c.id }); }),
    entry('Als .mrpack exportieren', () => exportPack(i)),
    entry('Löschen …', () => confirmModal(`„${i.name}“ löschen? Die Dateien kommen in den Papierkorb.`, async () => { await call(api.deleteInstance, i.id); await refresh(); go({ page: 'home' }); }, 'Löschen'), 'danger'));
  document.body.append(menu);
}
function closeMenu() {
  document.getElementById('ctx-menu')?.remove();
}
document.addEventListener('click', closeMenu);
document.addEventListener('scroll', closeMenu, true);

function promptModal(title, hint, value, onOk) {
  const input = h('input', { value, style: 'width:100%', onkeydown: (e) => e.key === 'Enter' && ok() });
  const ok = async () => { closeModal(); await onOk(input.value); };
  modal(h('div', {}, h('h2', {}, title), hint && h('p', { class: 'sub', style: 'margin-bottom:10px' }, hint), input,
    h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:16px' }, h('button', { class: 'btn ghost', onclick: closeModal }, 'Abbrechen'), h('button', { class: 'btn primary', onclick: ok }, 'OK'))));
  setTimeout(() => input.focus(), 30);
}

async function exportPack(i) {
  try {
    const r = await call(api.exportMrpack, i.id);
    if (r) toast(`Exportiert: ${r.linked} Mods von Modrinth verlinkt, ${r.bundled} direkt eingepackt`);
  } catch (e) {
    toast(e.message, true);
  }
}

// ================================================================= instance page (icon, more tabs)
async function instance(view, r) {
  const inst = instById(r.id) || selected();
  if (!inst) return go({ page: 'home' });
  const tab = r.tab || 'content';
  const iconBtn = h('button', { class: 'icon-edit', title: 'Icon ändern', onclick: () => iconModal(inst) }, instIcon(inst, 72));
  view.append(h('div', { class: 'banner' + (inst.bannerColor ? ' tinted' : ''), style: inst.bannerColor ? `--banner:${inst.bannerColor}` : '' }, pixelBanner(inst.id + (inst.bannerSeed || '')),
    h('div', { class: 'over' }, iconBtn,
      h('div', { class: 'grow' }, h('h1', {}, inst.pinned ? '★ ' : '', inst.name),
        h('div', { class: 'row', style: 'margin-top:6px' }, h('span', { class: 'tag a' }, inst.mcVersion), h('span', { class: 'tag' }, loaderName(inst.loader)), inst.counter && h('span', { class: 'tag a' }, 'Counter'), inst.group && h('span', { class: 'tag' }, inst.group), inst.importedFrom && h('span', { class: 'tag' }, `aus ${inst.importedFrom}`),
          h('span', { class: 'muted', style: 'font-size:12px' }, `Spielzeit ${fmtTime(inst.playTime)} · zuletzt ${ago(inst.lastPlayed)}`))),
      h('button', { class: 'btn', title: inst.pinned ? 'Von Favoriten entfernen' : 'Zu Favoriten', onclick: async () => { await call(api.updateInstance, inst.id, { pinned: !inst.pinned }); await refresh(); render(); } }, inst.pinned ? '★' : '☆'),
      inst.loader === 'fabric' ? h('button', { class: 'btn', title: 'Neueste Counter-Mod in diese Instanz laden', onclick: async (e) => {
        const b = e.currentTarget;
        b.disabled = true;
        try {
          const [r] = await call(api.updateCounter, inst.id);
          if (!r || !r.ok) toast(`Counter: ${(r && r.error) || 'fehlgeschlagen'}`, true);
          else toast(r.same ? `Counter ${r.to} ist schon aktuell` : `Counter ${r.to} ist drin${r.from ? ` (vorher ${r.from})` : ''}`);
          await refresh();
          render();
        } catch (err) {
          toast(err.message, true);
        }
        b.disabled = false;
      } }, 'Counter aktualisieren') : null,
      h('button', { class: 'btn', title: 'Ordner öffnen', onclick: () => call(api.openInstance, inst.id) }, svg(I.folder)),
      h('button', { class: 'btn', title: 'Konsole', onclick: () => $('#console').classList.toggle('hidden') }, svg(I.term)),
      playButton(inst))));
  const tabs = [['content', 'Inhalte'], ['worlds', 'Welten'], ['servers', 'Server'], ['screenshots', 'Screenshots'], ['stats', 'Statistik'], ['logs', 'Logs'], ['tools', 'Werkzeuge'], ['options', 'Einstellungen']];
  view.append(h('div', { class: 'tabs' }, tabs.map(([k, l]) => h('button', { class: k === tab ? 'on' : '', onclick: () => go({ ...r, tab: k }) }, l))));
  const body = h('div', {});
  view.append(body);
  await ({ content: tabContent, worlds: tabWorlds, servers: tabServers, screenshots: tabShots, stats: tabStats, logs: tabLogs, tools: tabTools, options: tabOptions })[tab](body, inst, r);
}

const fmtTime = (ms) => {
  const m = Math.round((ms || 0) / 60000);
  return m < 60 ? `${m} Min.` : `${Math.floor(m / 60)} Std. ${m % 60} Min.`;
};

const EMOJIS = ['⚔', '🏹', '🛡', '⛏', '🧪', '🔥', '❄', '🌙', '⭐', '💎', '🐉', '🌲', '🏰', '🎮', '🚀', '👑'];
const ICON_COLORS = ['#9d5cff', '#ff5470', '#ffb347', '#3ddc84', '#29d3ff', '#ff8ad8', '#5b6cff', '#2b2b38'];
function iconModal(inst) {
  let color = inst.color || ICON_COLORS[0];
  modal(h('div', {}, h('h2', {}, 'Icon'),
    h('div', { class: 'label', style: 'margin-bottom:8px' }, 'Symbol'),
    h('div', { class: 'emoji-grid' }, EMOJIS.map((e) => h('button', { class: 'icon emoji', style: `background:${color}`, onclick: async () => { await call(api.updateInstance, inst.id, { emoji: e, color }); await call(api.removeIcon, inst.id); await loadIcons(); await refresh(); closeModal(); render(); } }, e))),
    h('div', { class: 'label', style: 'margin:14px 0 8px' }, 'Farbe'),
    h('div', { class: 'row' }, ICON_COLORS.map((c) => h('button', { class: 'swatch', style: `background:${c}`, onclick: (ev) => { color = c; ev.currentTarget.parentElement.parentElement.querySelectorAll('.emoji-grid .icon').forEach((b) => (b.style.background = c)); } }))),
    h('div', { class: 'row', style: 'margin-top:18px' },
      h('button', { class: 'btn', onclick: async () => { const img = await call(api.pickIcon, inst.id); if (img) { await call(api.updateInstance, inst.id, { emoji: '' }); await loadIcons(); await refresh(); closeModal(); render(); } } }, svg(I.upload), 'Eigenes Bild'),
      h('button', { class: 'btn ghost', onclick: async () => { await call(api.updateInstance, inst.id, { emoji: '' }); await call(api.removeIcon, inst.id); await loadIcons(); await refresh(); closeModal(); render(); } }, 'Pixel-Icon'),
      h('div', { class: 'grow' }), h('button', { class: 'btn ghost', onclick: closeModal }, 'Schließen'))));
}

// ---------------------------------------------------------------- worlds with backups
async function tabWorlds(body, inst) {
  const [w, backups] = await Promise.all([call(api.worlds, inst.id), call(api.backupList, inst.id)]);
  const worldRow = (x, n) => {
    const btn = h('button', { class: 'btn sm', onclick: async () => {
      btn.disabled = true;
      btn.replaceChildren(h('span', { class: 'spin' }));
      try {
        await call(api.backupCreate, inst.id, x.name);
        toast(`Backup von „${x.name}“ erstellt`);
        render();
      } catch (e) {
        toast(e.message, true);
        btn.disabled = false;
        btn.textContent = 'Backup';
      }
    } }, 'Backup');
    return h('div', { class: 'lrow', style: `animation-delay:${n * 20}ms` },
      x.icon ? h('img', { src: x.icon, class: 'icon' }) : pixelIcon(x.name), h('div', { class: 'grow' }, h('div', { class: 'name' }, x.name), h('div', { class: 'meta' }, `gespielt ${ago(x.modified)}`)),
      h('div', { class: 'actions' }, btn, h('button', { class: 'btn sm ghost', title: 'Ordner öffnen', onclick: () => call(api.openWorld, inst.id, x.name) }, svg(I.folder))));
  };
  body.append(w.length ? h('div', { class: 'list panel stagger' }, w.map(worldRow)) : h('div', { class: 'empty panel' }, h('b', {}, 'Keine Welten'), 'Erstelle im Spiel eine Welt oder importiere eine Instanz mit Welten.'));
  body.append(h('h2', {}, 'Backups'), backups.length ? h('div', { class: 'list panel stagger' }, backups.map((b) => h('div', { class: 'lrow' },
    h('div', { class: 'grow' }, h('div', { class: 'name' }, b.world), h('div', { class: 'meta' }, `${new Date(b.time).toLocaleString()} · ${(b.size / 1048576).toFixed(1)} MB`)),
    h('div', { class: 'actions' },
      h('button', { class: 'btn sm', onclick: async () => { const n = await call(api.backupRestore, inst.id, b.file); toast(`Wiederhergestellt als „${n}“`); render(); } }, 'Wiederherstellen'),
      h('button', { class: 'btn sm ghost danger', onclick: () => confirmModal('Dieses Backup löschen?', async () => { await call(api.backupDelete, inst.id, b.file); render(); }, 'Löschen') }, svg(I.trash))))))
    : h('div', { class: 'empty panel' }, 'Noch keine Backups. „Backup“ bei einer Welt speichert sie als Zip – beim Wiederherstellen entsteht eine Kopie, deine Welt wird nie überschrieben.'));
}

// ---------------------------------------------------------------- servers with quick join
async function tabServers(body, inst) {
  let list = await call(api.servers, inst.id);
  const wrap = h('div', {});
  const name = h('input', { placeholder: 'Name' }), ip = h('input', { placeholder: 'Adresse, z. B. play.astraxsmp.de', class: 'grow' });
  const save = async () => { await call(api.saveServers, inst.id, list); draw(); };
  const draw = () => wrap.replaceChildren(list.length ? h('div', { class: 'list panel stagger' }, list.map((s, i) => h('div', { class: 'lrow' },
    s.icon ? h('img', { src: 'data:image/png;base64,' + s.icon, class: 'icon' }) : pixelIcon(s.ip),
    h('div', { class: 'grow' }, h('div', { class: 'name' }, s.name), h('div', { class: 'meta' }, s.ip)),
    h('button', { class: 'btn sm primary', title: 'Startet das Spiel und verbindet direkt', onclick: () => play(inst, { server: s.ip }) }, svg(I.play), 'Beitreten'),
    h('div', { class: 'actions' },
      h('button', { class: 'btn sm ghost', disabled: i === 0, onclick: () => { list.splice(i - 1, 0, list.splice(i, 1)[0]); save(); } }, '↑'),
      h('button', { class: 'btn sm ghost danger', onclick: () => { list.splice(i, 1); save(); } }, svg(I.trash))))))
    : h('div', { class: 'empty panel' }, h('b', {}, 'Keine Server'), 'Füge unten einen Server hinzu – er erscheint auch im Spiel in der Serverliste.'));
  body.append(wrap, h('div', { class: 'row', style: 'margin-top:12px' }, name, ip, h('button', { class: 'btn primary', onclick: () => { if (!ip.value.trim()) return; list.push({ name: name.value.trim() || ip.value.trim(), ip: ip.value.trim() }); name.value = ip.value = ''; save(); } }, svg(I.plus), 'Hinzufügen')));
  draw();
}

// ---------------------------------------------------------------- statistics
async function tabStats(body, inst) {
  const sessions = inst.sessions || [];
  const days = Array.from({ length: 14 }, (_, k) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (13 - k));
    return { start: d.getTime(), end: d.getTime() + 86400000, ms: 0, label: d.toLocaleDateString('de', { weekday: 'short' }).slice(0, 2) };
  });
  for (const s of sessions) for (const d of days) d.ms += Math.max(0, Math.min(s.end, d.end) - Math.max(s.start, d.start));
  const max = Math.max(1, ...days.map((d) => d.ms));
  const longest = sessions.reduce((m, s) => Math.max(m, s.end - s.start), 0);
  const avg = sessions.length ? sessions.reduce((a, s) => a + (s.end - s.start), 0) / sessions.length : 0;
  const card = (label, value) => h('div', { class: 'panel stat hl' }, h('div', { class: 'label' }, label), h('div', { class: 'big' }, value));
  body.append(
    h('div', { class: 'stats-grid stagger' }, card('Spielzeit gesamt', fmtTime(inst.playTime)), card('Sitzungen', String(sessions.length)), card('Längste Sitzung', fmtTime(longest)), card('Durchschnitt', fmtTime(avg))),
    h('h2', {}, 'Letzte 14 Tage'),
    h('div', { class: 'panel chart' }, days.map((d, n) => h('div', { class: 'bar-wrap', title: `${new Date(d.start).toLocaleDateString()}: ${fmtTime(d.ms)}` },
      h('div', { class: 'bar', style: `height:${Math.max(2, (d.ms / max) * 100)}%;animation-delay:${n * 30}ms` }), h('div', { class: 'bar-label' }, d.label)))),
    sessions.length ? '' : h('p', { class: 'muted', style: 'margin-top:10px' }, 'Sitzungen werden ab jetzt bei jedem Spielstart aufgezeichnet.'));
}

// ---------------------------------------------------------------- options (resolution, java, export, …)
async function tabOptions(body, inst) {
  const set = async (patch) => { await call(api.updateInstance, inst.id, patch); await refresh(); };
  const ram = h('span', {}, inst.ramMb ? `${(inst.ramMb / 1024).toFixed(1)} GB` : 'Standard');
  const javaInput = h('input', { value: inst.javaPath || '', placeholder: 'automatisch passend zur Version', class: 'grow', onchange: (e) => set({ javaPath: e.target.value.trim() }) });
  const javaList = h('select', { onchange: (e) => { javaInput.value = e.target.value; set({ javaPath: e.target.value }); } }, h('option', { value: '' }, 'Gefundene Java-Versionen …'));
  call(api.javaList).then((l) => l.forEach((j) => javaList.append(h('option', { value: j.path }, `${j.version || '?'} – ${j.name}`)))).catch(() => {});
  const sw = (key, label) => {
    const b = h('button', { class: 'switch' + (inst[key] ? ' on' : '') });
    b.addEventListener('click', async () => { inst[key] = !inst[key]; b.classList.toggle('on', inst[key]); await set({ [key]: inst[key] }); });
    return [h('label', {}, label), b];
  };
  body.append(h('div', { class: 'form panel' },
    h('label', {}, 'Name'), h('input', { value: inst.name, onchange: (e) => set({ name: e.target.value.trim() || inst.name }) }),
    h('label', {}, 'Gruppe'), h('input', { value: inst.group || '', placeholder: 'z. B. PvP, Modpacks', onchange: (e) => set({ group: e.target.value.trim() }) }),
    h('label', {}, 'Minecraft-Version'), h('input', { value: inst.mcVersion, onchange: (e) => set({ mcVersion: e.target.value.trim(), loaderVersion: '' }) }),
    h('div', { class: 'hint' }, 'Mods müssen zur Version passen. Prüfe danach die Updates.'),
    h('label', {}, 'Mod-Loader'), h('select', { onchange: (e) => set({ loader: e.target.value, loaderVersion: '' }) }, ['vanilla', 'fabric', 'quilt', 'neoforge', 'forge'].map((l) => h('option', { value: l, selected: l === inst.loader }, loaderName(l)))),
    h('label', {}, 'Loader-Version'), h('input', { value: inst.loaderVersion || '', placeholder: 'leer = neueste stabile', onchange: (e) => set({ loaderVersion: e.target.value.trim() }) }),
    h('label', {}, 'Arbeitsspeicher'), h('div', { class: 'row' }, h('input', { type: 'range', min: 0, max: 16384, step: 512, value: inst.ramMb || 0, class: 'grow', oninput: (e) => (ram.textContent = Number(e.target.value) ? `${(e.target.value / 1024).toFixed(1)} GB` : 'Standard'), onchange: (e) => set({ ramMb: Number(e.target.value) || 0 }) }), ram),
    h('label', {}, 'Fenstergröße'), h('div', { class: 'row' },
      h('input', { type: 'number', min: 320, placeholder: 'Breite', value: inst.width || '', style: 'width:110px', onchange: (e) => set({ width: Number(e.target.value) || 0 }) }), '×',
      h('input', { type: 'number', min: 240, placeholder: 'Höhe', value: inst.height || '', style: 'width:110px', onchange: (e) => set({ height: Number(e.target.value) || 0 }) }),
      h('span', { class: 'muted' }, 'leer = Standard')),
    ...sw('fullscreen', 'Im Vollbild starten'),
    h('label', {}, 'Java'), h('div', { class: 'row' }, javaInput, javaList, h('button', { class: 'btn sm', onclick: async () => { const p = await call(api.pickJava); if (p) { javaInput.value = p; set({ javaPath: p }); } } }, 'Durchsuchen')),
    h('label', {}, 'JVM-Argumente'), h('input', { value: inst.jvmArgs || '', placeholder: 'Standard aus den Einstellungen', onchange: (e) => set({ jvmArgs: e.target.value }) }),
    h('label', {}, 'Banner-Farbe'), h('div', { class: 'row' }, h('input', { type: 'color', value: inst.bannerColor || '#9d5cff', style: 'width:64px;height:34px;padding:3px', onchange: (e) => set({ bannerColor: e.target.value }) }),
      h('button', { class: 'btn sm', onclick: async () => { await set({ bannerSeed: Math.random().toString(36).slice(2, 7) }); render(); } }, 'Neues Muster'),
      h('button', { class: 'btn sm ghost', onclick: async () => { await set({ bannerColor: '', bannerSeed: '' }); render(); } }, 'Zurücksetzen'))),
    h('h2', {}, 'Aktionen'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => iconModal(inst) }, 'Icon ändern'),
      h('button', { class: 'btn', onclick: () => exportPack(inst) }, svg(I.box), 'Als .mrpack exportieren'),
      h('button', { class: 'btn', onclick: async () => { try { const n = await call(api.exportOfficial, inst.id); toast(`Profil „${n}“ im Minecraft Launcher angelegt`); } catch (e) { toast(e.message, true); } } }, svg(I.ext), 'Im Minecraft Launcher anlegen'),
      h('button', { class: 'btn', onclick: async () => { const c = await call(api.duplicateInstance, inst.id); await refresh(); go({ page: 'instance', id: c.id }); } }, svg(I.copy), 'Duplizieren'),
      h('button', { class: 'btn danger', onclick: () => confirmModal(`„${inst.name}“ löschen? Die Dateien kommen in den Papierkorb.`, async () => { await call(api.deleteInstance, inst.id); await refresh(); go({ page: 'home' }); }, 'Löschen') }, svg(I.trash), 'Löschen')));
}

// ================================================================= crash dialog
api.on('crash', ({ id, name, code, tail }) => {
  const lines = (tail || '').split('\n');
  modal(h('div', {}, h('h2', {}, `${name} ist abgestürzt`), h('p', { class: 'sub' }, `Exit-Code ${code}. Die letzten Zeilen:`),
    h('pre', { class: 'logview', style: 'height:260px;margin-top:12px' }, lines.map((l) => h('div', { class: /ERROR|Exception|Caused by|FATAL/.test(l) ? 'e' : /WARN/.test(l) ? 'w' : '' }, l))),
    h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:14px' },
      h('button', { class: 'btn', onclick: () => { closeModal(); go({ page: 'instance', id, tab: 'logs' }); } }, 'Alle Logs'),
      h('button', { class: 'btn', onclick: () => { closeModal(); go({ page: 'instance', id, tab: 'content' }); } }, 'Mods prüfen'),
      h('button', { class: 'btn primary', onclick: () => { closeModal(); askAssistant('Mein Spiel „' + name + '“ ist gerade abgestürzt (Exit-Code ' + code + '). Lies den Crash-Report bzw. das Log (read_game_file), prüf die Mods (check_instance), finde die Ursache und sag mir konkret, wie ich es behebe.', id); } }, '✨ KI analysiert den Absturz'),
      h('button', { class: 'btn primary', onclick: closeModal }, 'OK'))), true);
});

// ================================================================= news page
async function newsPage(view) {
  view.append(h('h1', {}, 'Neuigkeiten'), h('p', { class: 'sub' }, 'Updates vom Counter Launcher und vom Counter Client.'), h('div', { style: 'height:16px' }));
  const list = h('div', { class: 'stagger' }, h('div', { class: 'skeleton', style: 'height:160px' }));
  view.append(list);
  try {
    const items = await call(api.news);
    list.replaceChildren(...(items.length ? items.map((n, k) => h('div', { class: 'panel news-item', style: `animation-delay:${k * 40}ms` },
      h('div', { class: 'row' }, h('span', { class: 'tag a' }, n.version), h('b', { class: 'grow' }, n.name || n.version), h('span', { class: 'muted', style: 'font-size:12px' }, new Date(n.date).toLocaleDateString()),
        h('button', { class: 'btn sm ghost', onclick: () => api.openExternal(n.url) }, svg(I.ext))),
      n.body ? markdown(n.body) : h('p', { class: 'muted' }, 'Keine Beschreibung'))) : [h('div', { class: 'empty panel' }, 'Noch keine Neuigkeiten')]));
  } catch (e) {
    list.replaceChildren(h('div', { class: 'empty panel' }, e.message));
  }
}

// ================================================================= command palette (Ctrl+K)
function commands() {
  const cmds = [
    { label: 'Start', hint: 'Seite', run: () => go({ page: 'home' }) },
    { label: 'Entdecken', hint: 'Mods, Modpacks, Shader', run: () => go({ page: 'browse' }) },
    { label: 'Importieren', hint: 'Seite', run: () => go({ page: 'import' }) },
    { label: 'Neuigkeiten', hint: 'Seite', run: () => go({ page: 'news' }) },
    { label: 'Konten', hint: 'Seite', run: () => go({ page: 'accounts' }) },
    { label: 'Einstellungen', hint: 'Seite', run: () => go({ page: 'settings' }) },
    { label: 'Neue Instanz', hint: 'Strg+N', run: createInstanceModal },
    { label: 'Nach Updates suchen', hint: 'Launcher', run: () => api.checkUpdate() },
    { label: 'Konsole ein/aus', hint: 'Strg+J', run: () => $('#console').classList.toggle('hidden') },
    ...PRESETS.map((p) => ({ label: `Design: ${p.name}`, hint: 'Preset', run: async () => { await saveTheme({ ...THEME_DEFAULT, ...p.theme }, p.accent); render(); } })),
  ];
  for (const i of state.instances) {
    cmds.push({ label: `${i.name} spielen`, hint: `${i.mcVersion} ${loaderName(i.loader)}`, run: () => play(i), icon: i });
    cmds.push({ label: `${i.name} öffnen`, hint: 'Instanz', run: () => go({ page: 'instance', id: i.id }), icon: i });
  }
  return cmds;
}

function palette() {
  if (document.querySelector('.palette')) return closeModal();
  const all = commands();
  let sel = 0, shown = all;
  const input = h('input', { placeholder: 'Befehl oder Instanz suchen …', class: 'palette-input' });
  const list = h('div', { class: 'palette-list' });
  const score = (c, q) => {
    const t = (c.label + ' ' + (c.hint || '')).toLowerCase();
    if (!q) return 1;
    if (t.startsWith(q)) return 3;
    if (t.includes(q)) return 2;
    let i = 0;
    for (const ch of t) if (ch === q[i]) i++;
    return i === q.length ? 1 : 0;
  };
  const draw = () => {
    const q = input.value.toLowerCase().trim();
    shown = all.map((c) => [c, score(c, q)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, 12);
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    list.replaceChildren(...shown.map((c, k) => h('button', { class: 'palette-item' + (k === sel ? ' on' : ''), onmouseenter: () => { sel = k; draw(); }, onclick: () => run(c) },
      c.icon ? instIcon(c.icon) : h('span', { class: 'pi-dot' }), h('span', { class: 'grow' }, c.label), h('span', { class: 'muted' }, c.hint || ''))));
  };
  const run = (c) => { closeModal(); c.run(); };
  input.addEventListener('input', () => { sel = 0; draw(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(shown.length - 1, sel + 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
    else if (e.key === 'Enter' && shown[sel]) run(shown[sel]);
    else if (e.key === 'Escape') closeModal();
  });
  modal(h('div', { class: 'palette' }, input, list, h('div', { class: 'palette-foot muted' }, '↑↓ auswählen · Enter ausführen · Esc schließen')));
  draw();
  setTimeout(() => input.focus(), 20);
}

// ================================================================= keyboard shortcuts
document.addEventListener('keydown', (e) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); palette(); return; }
  if (e.key === 'Escape') { closeMenu(); if ($('#modal-root').children.length) closeModal(); return; }
  if (typing || !(e.ctrlKey || e.metaKey)) return;
  const pages = { 1: 'home', 2: 'browse', 3: 'import', 4: 'news', 5: 'accounts' };
  if (pages[e.key]) { e.preventDefault(); go({ page: pages[e.key] }); }
  else if (e.key === ',') { e.preventDefault(); go({ page: 'settings' }); }
  else if (e.key.toLowerCase() === 'n') { e.preventDefault(); createInstanceModal(); }
  else if (e.key.toLowerCase() === 'j') { e.preventDefault(); $('#console').classList.toggle('hidden'); }
  else if (e.key === 'Enter') { e.preventDefault(); const i = route.page === 'instance' ? instById(route.id) : sortInstances(state.instances)[0]; if (i) play(i); }
});

// ================================================================= layout & behaviour settings
const FONTS = {
  system: '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
  rounded: '"Nunito", "Segoe UI Variable Display", "Segoe UI", sans-serif',
  mono: '"Cascadia Code", Consolas, monospace',
  serif: 'Georgia, "Times New Roman", serif',
  pixel: '"Minecraft", "Press Start 2P", "Cascadia Code", Consolas, monospace',
};
function applyExtras(t = theme()) {
  const r = document.documentElement.style;
  r.setProperty('--font-family', FONTS[t.font2 || 'system'] || FONTS.system);
  r.setProperty('--light-color', t.lightColor === 'accent2' ? 'var(--accent-2)' : t.lightColor === 'white' ? '#ffffff' : 'var(--accent)');
  r.setProperty('--speed', String(t.speed || 1));
  document.body.classList.toggle('rail-labels', !!t.railLabels);
  document.body.classList.toggle('library-right', t.libraryPos === 'right');
  document.body.classList.toggle('flat', t.style === 'flat');
  document.body.classList.toggle('outline-style', t.style === 'outline');
  let style = document.getElementById('custom-css');
  if (!style) {
    style = document.createElement('style');
    style.id = 'custom-css';
    document.head.append(style);
  }
  style.textContent = t.customCss || '';
}
const _applyTheme = applyTheme;
// eslint-disable-next-line no-func-assign
applyTheme = function (t = theme(), accent = state.settings.accent) {
  _applyTheme(t, accent);
  applyExtras(t);
};

function extraSettings() {
  const t = theme();
  const seg = (key, opts) => h('div', { class: 'seg' }, opts.map(([k, l]) => h('button', { class: (t[key] || opts[0][0]) === k ? 'on' : '', onclick: async () => { await saveTheme({ [key]: k }); render(); } }, l)));
  const sw = (key, label, fallback = false) => {
    const on = t[key] ?? fallback;
    const b = h('button', { class: 'switch' + (on ? ' on' : '') });
    b.addEventListener('click', async () => { const v = !(theme()[key] ?? fallback); await saveTheme({ [key]: v }); b.classList.toggle('on', v); });
    return [h('label', {}, label), b];
  };
  const speedVal = h('span', { class: 'muted', style: 'min-width:46px;text-align:right' }, `${t.speed || 1}×`);
  const css = h('textarea', { rows: 6, style: 'width:100%;font:12px Consolas,monospace', placeholder: '/* eigenes CSS, z. B. */\n.lib-item { border-radius: 4px; }', onchange: (e) => saveTheme({ customCss: e.target.value }) });
  css.value = t.customCss || '';
  return h('div', {},
    h('h2', {}, 'Layout & Verhalten'),
    h('div', { class: 'form panel' },
      h('label', {}, 'Stil der Flächen'), seg('style', [['clean', 'Klar'], ['glass', 'Glas'], ['flat', 'Flach'], ['outline', 'Umrisse']]),
      h('label', {}, 'Schriftart'), seg('font2', [['system', 'System'], ['rounded', 'Rund'], ['mono', 'Mono'], ['serif', 'Serif'], ['pixel', 'Pixel']]),
      h('label', {}, 'Farbe des Mauslichts'), seg('lightColor', [['accent', 'Akzent'], ['accent2', 'Zweitfarbe'], ['white', 'Weiß']]),
      h('label', {}, 'Bibliothek-Position'), seg('libraryPos', [['left', 'Links'], ['right', 'Rechts']]),
      h('label', {}, 'Bibliothek sortieren'), seg('librarySort', Object.entries(SORTS)),
      ...sw('railLabels', 'Beschriftung an der Icon-Leiste'),
      h('label', {}, 'Animationstempo'), h('div', { class: 'row' }, h('input', { type: 'range', min: 0.5, max: 2, step: 0.25, value: t.speed || 1, class: 'grow',
        oninput: (e) => { speedVal.textContent = `${e.target.value}×`; applyExtras({ ...theme(), speed: Number(e.target.value) }); }, onchange: (e) => saveTheme({ speed: Number(e.target.value) }) }), speedVal),
      h('label', {}, 'Nach dem Spielstart'), h('div', { class: 'seg' }, [['stay', 'Offen lassen'], ['minimize', 'Minimieren']].map(([k, l]) =>
        h('button', { class: (state.settings.closeOnLaunch ? 'minimize' : 'stay') === k ? 'on' : '', onclick: async () => { await call(api.setSettings, { closeOnLaunch: k === 'minimize' }); await refresh(); render(); } }, l))),
      h('label', {}, 'Windows-Benachrichtigungen'), (() => {
        const b = h('button', { class: 'switch' + (state.settings.notifications !== false ? ' on' : '') });
        b.addEventListener('click', async () => { const v = state.settings.notifications === false; await call(api.setSettings, { notifications: v }); await refresh(); b.classList.toggle('on', v); if (v) api.testNotify(); });
        return b;
      })()),
    h('h2', {}, 'Eigenes CSS'),
    h('div', { class: 'panel', style: 'padding:16px' }, css, h('div', { class: 'muted', style: 'font-size:12px;margin-top:8px' }, 'Wird sofort beim Verlassen des Felds angewendet. Leeren, um es zu entfernen.')),
    h('h2', {}, 'Design teilen'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: async () => {
        const code = btoa(unescape(encodeURIComponent(JSON.stringify({ accent: state.settings.accent, theme: { ...theme(), bgImage: undefined } }))));
        await navigator.clipboard.writeText('counter-theme:' + code);
        toast('Design-Code in die Zwischenablage kopiert');
      } }, svg(I.copy), 'Design kopieren'),
      h('button', { class: 'btn', onclick: () => promptModal('Design einfügen', 'Füge einen Design-Code ein (beginnt mit counter-theme:)', '', async (v) => {
        try {
          const data = JSON.parse(decodeURIComponent(escape(atob(v.trim().replace(/^counter-theme:/, '')))));
          if (typeof data !== 'object' || !data.theme) throw new Error();
          await saveTheme({ ...THEME_DEFAULT, ...data.theme }, /^#[0-9a-f]{6}$/i.test(data.accent) ? data.accent : undefined);
          toast('Design übernommen');
          render();
        } catch {
          toast('Ungültiger Design-Code', true);
        }
      }) }, 'Design einfügen')),
    h('h2', {}, 'Tastenkürzel'),
    h('div', { class: 'panel shortcuts' },
      [['Strg+K', 'Befehlspalette'], ['Strg+1 … 5', 'Start, Entdecken, Import, Neuigkeiten, Konten'], ['Strg+,', 'Einstellungen'], ['Strg+N', 'Neue Instanz'], ['Strg+Enter', 'Instanz spielen'], ['Strg+J', 'Konsole'], ['Rechtsklick', 'Menü einer Instanz in der Bibliothek']]
        .map(([k, v]) => h('div', { class: 'sc' }, h('kbd', {}, k), h('span', {}, v)))));
}

// news item in the rail
(() => {
  const btn = h('button', { class: 'nav', 'data-page': 'news' }, svg('M5 4h14v16H5zM8 8h8M8 12h8M8 16h5'), h('span', { class: 'tip' }, 'Neuigkeiten'));
  btn.addEventListener('click', () => go({ page: 'news' }));
  const spacer = document.querySelector('#rail .spacer');
  spacer.parentNode.insertBefore(btn, spacer);
  const pal = h('button', { class: 'nav', title: 'Befehlspalette (Strg+K)' }, svg('M4 6h16M4 12h10M4 18h7M17 15l3 3-3 3'), h('span', { class: 'tip' }, 'Befehle (Strg+K)'));
  pal.addEventListener('click', palette);
  spacer.parentNode.insertBefore(pal, spacer.nextSibling);
})();
