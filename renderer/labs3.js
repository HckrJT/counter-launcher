// Counter Launcher – "Erfolge" page (achievements, weekly challenges, "Dein Counter-Jahr"), the Snake easter egg,
// the "what's new" popup after an update and "accent colour from my skin". Everything is computed from data the
// launcher already keeps (sessions, instances); only a few counters live in localStorage.

(() => {
  const btn = h('button', { class: 'nav', 'data-page': 'achievements' }, svg('M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3'), h('span', { class: 'tip' }, 'Erfolge'));
  btn.addEventListener('click', () => go({ page: 'achievements' }));
  const anchor = $('#rail .nav[data-page="assistant"]') || $('#rail .nav[data-page="news"]');
  anchor.after(btn);
})();
extraPages.achievements = achievementsPage;
extraNames.achievements = 'Erfolge';

/** counters for things the launcher cannot derive from its data (tools used, AI questions) */
const bumpStat = (key) => {
  const s = lsGet('cl.stats', {});
  s[key] = (s[key] || 0) + 1;
  lsSet('cl.stats', s);
};
const statOf = (key) => lsGet('cl.stats', {})[key] || 0;

const DAY = 86400000;
const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const startOfWeek = () => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
const hoursLabel = (ms) => (ms >= 3600000 ? (ms / 3600000).toFixed(ms >= 36000000 ? 0 : 1) + ' Std.' : Math.round(ms / 60000) + ' Min.');

function allSessions() {
  const out = [];
  for (const i of state.instances) for (const s of i.sessions || []) out.push({ ...s, inst: i.name });
  return out.sort((a, b) => a.start - b.start);
}
function totalPlay() {
  return state.instances.reduce((n, i) => n + (i.playTime || 0), 0);
}
/** longest run of consecutive days with a session */
function streak(sessions) {
  const days = [...new Set(sessions.map((s) => startOfDay(s.start)))].sort((a, b) => a - b);
  let best = 0, run = 0, prev = 0;
  for (const d of days) {
    run = prev && d - prev === DAY ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

function achievementList() {
  const sessions = allSessions();
  const total = totalPlay();
  const longest = sessions.reduce((m, s) => Math.max(m, s.end - s.start), 0);
  const night = sessions.some((s) => { const hr = new Date(s.start).getHours(); return hr >= 0 && hr < 5; });
  const ai = lsGet('cl.aiChats', []).reduce((n, c) => n + c.messages.filter((m) => m.role === 'user').length, 0);
  const crashes = state.instances.reduce((n, i) => n + (i.crashes || []).length, 0);
  const A = (icon, title, text, value, goal, fmt = (v) => String(Math.floor(v))) => ({ icon, title, text, value: Math.min(value, goal), goal, done: value >= goal, fmt });
  return [
    A('🎮', 'Erste Schritte', 'Spiele eine Sitzung', sessions.length, 1),
    A('⏱', 'Dauerspieler', '10 Stunden Spielzeit', total, 36000000, hoursLabel),
    A('🔥', 'Stammgast', '50 Stunden Spielzeit', total, 180000000, hoursLabel),
    A('👑', 'Legende', '200 Stunden Spielzeit', total, 720000000, hoursLabel),
    A('📦', 'Sammler', '3 Instanzen anlegen', state.instances.length, 3),
    A('🗃', 'Archivar', '8 Instanzen anlegen', state.instances.length, 8),
    A('🌙', 'Nachteule', 'Spiele nach Mitternacht', night ? 1 : 0, 1),
    A('🏃', 'Marathon', 'Eine Sitzung über 3 Stunden', longest, 10800000, hoursLabel),
    A('📅', 'Dranbleiber', '5 Tage in Folge spielen', streak(sessions), 5),
    A('🛠', 'Aufräumer', 'Gesundheitscheck benutzen', statOf('health'), 1),
    A('🛡', 'Sicherheitsbewusst', 'Sicherheitscheck benutzen', statOf('security'), 1),
    A('💾', 'Vorsichtig', 'Ein Mod-Backup anlegen', statOf('backup'), 1),
    A('🤖', 'KI-Freund', '10 Fragen an den Assistenten', ai, 10),
    A('🧠', 'KI-Profi', '100 Fragen an den Assistenten', ai, 100),
    A('🔧', 'Zäh', 'Einen Absturz überstehen', crashes, 1),
    A('🐍', 'Snake-Meister', '20 Punkte in Snake', statOf('snake') , 20),
  ];
}
function challengeList() {
  const wk = startOfWeek();
  const week = allSessions().filter((s) => s.end > wk);
  const ms = week.reduce((n, s) => n + Math.max(0, Math.min(s.end, wk + 7 * DAY) - Math.max(s.start, wk)), 0);
  const days = new Set(week.map((s) => startOfDay(s.start))).size;
  const insts = new Set(week.map((s) => s.inst)).size;
  const C = (title, text, value, goal, fmt = (v) => String(Math.floor(v))) => ({ title, text, value: Math.min(value, goal), goal, done: value >= goal, fmt });
  return [
    C('Wochen-Ausdauer', '5 Stunden diese Woche spielen', ms, 18000000, hoursLabel),
    C('Regelmäßig', 'An 3 verschiedenen Tagen spielen', days, 3),
    C('Abwechslung', '2 verschiedene Instanzen starten', insts, 2),
    C('Aufmerksam', 'Diese Woche einen Gesundheitscheck machen', Math.min(1, statOf('healthWeek:' + wk)), 1),
  ];
}

function progressRow(a) {
  return h('div', { class: 'ach' + (a.done ? ' done' : '') },
    h('div', { class: 'ach-ico' }, a.icon || (a.done ? '✓' : '○')),
    h('div', { class: 'grow' }, h('div', { class: 'ach-t' }, a.title), h('div', { class: 'muted small' }, a.text),
      h('div', { class: 'ach-bar' }, h('i', { style: `width:${Math.round((a.value / a.goal) * 100)}%` }))),
    h('div', { class: 'muted small ach-v' }, a.done ? 'geschafft' : `${a.fmt(a.value)} / ${a.fmt(a.goal)}`));
}

function yearReview() {
  const sessions = allSessions();
  const year = new Date().getFullYear();
  const ys = sessions.filter((s) => new Date(s.start).getFullYear() === year);
  if (!ys.length) return h('div', { class: 'muted' }, 'Noch keine Sitzungen in diesem Jahr – nach dem ersten Spielstart siehst du hier deinen Rückblick.');
  const per = {};
  const perDay = new Array(7).fill(0);
  let total = 0, longest = 0;
  for (const s of ys) {
    const d = s.end - s.start;
    total += d;
    longest = Math.max(longest, d);
    per[s.inst] = (per[s.inst] || 0) + d;
    perDay[(new Date(s.start).getDay() + 6) % 7] += d;
  }
  const fav = Object.entries(per).sort((a, b) => b[1] - a[1])[0];
  const names = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
  const best = perDay.indexOf(Math.max(...perDay));
  const card = (big, label) => h('div', { class: 'panel stat hl' }, h('div', { class: 'label' }, label), h('div', { class: 'big' }, big));
  return h('div', { class: 'stats-grid' }, card(hoursLabel(total), 'Spielzeit ' + year), card(String(ys.length), 'Sitzungen'), card(fav[0], 'Lieblings-Instanz'), card(names[best], 'Stärkster Tag'), card(hoursLabel(longest), 'Längste Sitzung'), card(`${streak(ys)} Tage`, 'Längste Serie'));
}

async function achievementsPage(view) {
  const list = achievementList();
  const done = list.filter((a) => a.done).length;
  view.append(
    h('div', { class: 'row' }, h('div', { class: 'grow' }, h('h1', {}, 'Erfolge'), h('p', { class: 'sub' }, `${done} von ${list.length} geschafft`)),
      h('button', { class: 'btn sm', onclick: snakeGame }, '🐍 Snake')),
    h('h2', {}, 'Challenges dieser Woche'), h('div', { class: 'panel ach-list' }, challengeList().map(progressRow)),
    h('h2', {}, 'Dein Counter-Jahr'), yearReview(),
    h('h2', {}, 'Alle Erfolge'), h('div', { class: 'panel ach-list' }, list.map(progressRow)));
}

// ---------------------------------------------------------------- Snake (arrow keys / WASD, Esc closes)
function snakeGame() {
  const N = 18, S = 22;
  const canvas = h('canvas', { width: N * S, height: N * S, style: 'border-radius:12px;background:#0b0b14;display:block;margin:0 auto' });
  const info = h('div', { class: 'muted', style: 'text-align:center;margin-top:8px' }, 'Pfeiltasten oder WASD · Leertaste = Neustart');
  modal(h('div', {}, h('h2', {}, '🐍 Snake'), canvas, info, h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:12px' }, h('button', { class: 'btn', onclick: stop }, 'Schließen'))));
  const g = canvas.getContext('2d');
  let snake, dir, next, food, score, dead, timer;
  const place = () => { do { food = { x: Math.floor(Math.random() * N), y: Math.floor(Math.random() * N) }; } while (snake.some((p) => p.x === food.x && p.y === food.y)); };
  const reset = () => { snake = [{ x: 9, y: 9 }, { x: 8, y: 9 }, { x: 7, y: 9 }]; dir = next = { x: 1, y: 0 }; score = 0; dead = false; place(); };
  const accent = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#9d5cff';
  const draw = () => {
    g.clearRect(0, 0, N * S, N * S);
    g.fillStyle = '#ff5d73';
    g.beginPath();
    g.arc(food.x * S + S / 2, food.y * S + S / 2, S / 2 - 3, 0, 7);
    g.fill();
    snake.forEach((p, i) => { g.fillStyle = i ? accent() : '#fff'; g.fillRect(p.x * S + 1, p.y * S + 1, S - 2, S - 2); });
    if (dead) { g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(0, 0, N * S, N * S); g.fillStyle = '#fff'; g.font = '20px sans-serif'; g.textAlign = 'center'; g.fillText(`Game over – ${score} Punkte`, N * S / 2, N * S / 2); }
    info.textContent = `Punkte: ${score}   ·   Pfeiltasten oder WASD   ·   Leertaste = Neustart`;
  };
  const tick = () => {
    if (dead) return draw();
    dir = next;
    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
    if (head.x < 0 || head.y < 0 || head.x >= N || head.y >= N || snake.some((p) => p.x === head.x && p.y === head.y)) {
      dead = true;
      const s = lsGet('cl.stats', {});
      s.snake = Math.max(s.snake || 0, score);
      lsSet('cl.stats', s);
      return draw();
    }
    snake.unshift(head);
    if (head.x === food.x && head.y === food.y) { score++; place(); } else snake.pop();
    draw();
  };
  const key = (e) => {
    const m = { ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0] }[e.key];
    if (m) {
      e.preventDefault();
      if (!(m[0] === -dir.x && m[1] === -dir.y)) next = { x: m[0], y: m[1] };
    } else if (e.key === ' ') {
      e.preventDefault();
      reset();
    } else if (e.key === 'Escape') stop();
  };
  function stop() {
    clearInterval(timer);
    window.removeEventListener('keydown', key, true);
    closeModal();
  }
  window.addEventListener('keydown', key, true);
  reset();
  timer = setInterval(tick, 110);
  draw();
}
// Konami code opens Snake anywhere
(() => {
  const code = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
  let pos = 0;
  window.addEventListener('keydown', (e) => {
    if (/INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '')) return;
    pos = e.key === code[pos] ? pos + 1 : e.key === code[0] ? 1 : 0;
    if (pos === code.length) {
      pos = 0;
      snakeGame();
    }
  });
})();

// ---------------------------------------------------------------- what's new after an update
const CHANGELOG = {
  '1.12.0': [
    'Neuer Tab „Werkzeuge“ in jeder Instanz: Gesundheitscheck, Sicherheitscheck, Mod-Backups, Profile, Versionswechsel, Instanz teilen',
    'Assistent: 3 Denkstufen (bis Ultra), Gedächtnis, mehrere Chats, 54 Fähigkeiten, Modpack-Bau per Beschreibung',
    'Instanz-Vorlagen, Design-Codes, Spielzeit-Limit mit PIN, animierte Akzentfarbe, Erfolge und „Dein Counter-Jahr“',
  ],
};
async function whatsNew() {
  let v;
  try {
    v = (await call(api.appVersion)).replace(/^v/, '');
  } catch {
    return;
  }
  let seen = null;
  try {
    seen = localStorage.getItem('cl.seenVersion');
    localStorage.setItem('cl.seenVersion', v);
  } catch {}
  if (!seen || seen === v || !CHANGELOG[v]) return;
  modal(h('div', {}, h('h2', {}, `Neu in ${v}`), h('ul', { style: 'line-height:1.6' }, CHANGELOG[v].map((t) => h('li', {}, t))),
    h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:14px' }, h('button', { class: 'btn primary', onclick: closeModal }, 'Los geht’s'))));
}
setTimeout(whatsNew, 2500);

// ---------------------------------------------------------------- accent colour from the skin
async function accentFromSkin() {
  const r = await call(api.skin);
  if (!r || !r.url) throw new Error('Kein Skin gefunden');
  const img = new Image();
  await new Promise((ok, no) => { img.onload = ok; img.onerror = () => no(new Error('Skin nicht lesbar')); img.src = r.url; });
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, Math.min(32, c.height)).data;
  const bins = new Map();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) continue;
    const [hh, s, l] = hexToHsl('#' + [d[i], d[i + 1], d[i + 2]].map((x) => x.toString(16).padStart(2, '0')).join(''));
    if (s < 35 || l < 25 || l > 80) continue;
    const key = Math.round(hh / 20);
    bins.set(key, (bins.get(key) || 0) + s);
  }
  const best = [...bins.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!best) throw new Error('Dein Skin hat keine kräftige Farbe');
  const color = hslToHex(best[0] * 20, 80, 62);
  await saveTheme({}, color);
  return color;
}
