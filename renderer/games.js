// "Laufende Spiele" window: every running game of the launcher with live log and a stop button.
const api = window.counter;
const $ = (s) => document.querySelector(s);
const MAX_LINES = 6000;
let games = [];
let sel = null;
const logs = new Map(); // sid -> text shown

const fmt = (ms) => {
  const m = Math.floor(ms / 60000);
  return m < 60 ? `${m} Min` : `${Math.floor(m / 60)} h ${m % 60} Min`;
};
function mk(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}
function drawList() {
  $('#gcount').textContent = games.length ? `${games.length} aktiv` : '';
  const list = $('#glist');
  list.replaceChildren(...games.map((g) => {
    const item = mk('div', 'g-item' + (g.sid === sel ? ' on' : ''));
    item.append(mk('div', 'n', g.name), (() => { const m = mk('div', 'm'); m.append(mk('i', 'g-dot'), mk('span', '', `${g.version} · seit ${fmt(Date.now() - g.started)}`)); return m; })());
    item.onclick = () => select(g.sid);
    return item;
  }));
  if (!games.length) list.append(mk('div', 'g-empty', 'Kein Spiel läuft'));
}
function drawHead() {
  const g = games.find((x) => x.sid === sel);
  const head = $('#ghead');
  head.replaceChildren();
  if (!g) return;
  head.append(mk('div', 't', g.name));
  const stop = mk('button', 'btn sm danger', 'Beenden');
  stop.onclick = () => api.gamesStop(g.sid);
  head.append(stop);
}
async function select(sid) {
  sel = sid;
  drawList();
  drawHead();
  const pre = $('#glog');
  if (!logs.has(sid)) logs.set(sid, await api.gamesLog(sid));
  if (sel === sid) {
    pre.textContent = logs.get(sid) || '';
    pre.scrollTop = pre.scrollHeight;
  }
}
function setGames(list) {
  games = list;
  if (!games.find((g) => g.sid === sel)) sel = games.length ? games[games.length - 1].sid : null;
  drawList();
  drawHead();
  if (sel) select(sel);
  else $('#glog').textContent = '';
}
api.on('games', setGames);
api.on('game:log', ({ sid, line }) => {
  let t = (logs.get(sid) || '') + line;
  if (t.length > 400000) t = t.slice(-300000);
  logs.set(sid, t);
  if (sid !== sel) return;
  const pre = $('#glog');
  pre.textContent = t;
  if ($('#gfollow').checked) pre.scrollTop = pre.scrollHeight;
});
$('#gmin').onclick = () => api.win('min');
$('#gclose').onclick = () => api.win('close');
$('#gcopy').onclick = () => navigator.clipboard.writeText($('#glog').textContent);
$('#gclear').onclick = () => { logs.set(sel, ''); $('#glog').textContent = ''; };
setInterval(drawList, 30000);
api.gamesList().then(setGames);
