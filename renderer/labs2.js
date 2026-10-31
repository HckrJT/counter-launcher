// Counter Launcher – settings extras (design code, live accent colour, night mode, play-time limit) and the
// first-start setup. Loaded after labs.js.

function hexToHsl(hex) {
  const n = parseInt(String(hex).replace('#', '').slice(0, 6), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let hh = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    hh = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hh *= 60;
  }
  return [hh, s * 100, l * 100];
}
function hslToHex(hh, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + hh / 30) % 12;
  const f = (n) => l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}
let accentTimer = null;
/** runs after every applyTheme: live accent colour (rainbow / pulse) and the night mode */
function labsThemeHook() {
  const t = theme();
  const root = document.documentElement.style;
  if (t.dayNight) {
    const hr = new Date().getHours();
    if (hr >= 21 || hr < 6) {
      root.setProperty('--light', (0.72 * (t.light / 100)).toFixed(2));
      root.setProperty('--bg-dim', Math.min(0.9, t.bgDim / 100 + 0.15).toFixed(2));
    }
  }
  document.body.classList.toggle('hc', !!t.highContrast);
  clearInterval(accentTimer);
  accentTimer = null;
  if (!t.accentAnim || t.accentAnim === 'off' || t.motion === false) return;
  const [bh, bs, bl] = hexToHsl(state.settings.accent || '#9d5cff');
  const t0 = Date.now();
  const speed = t.accentSpeed || 20;
  accentTimer = setInterval(() => {
    const s = (Date.now() - t0) / 1000;
    const hue = t.accentAnim === 'rainbow' ? (bh + s * speed) % 360 : bh + Math.sin(s * speed / 10) * 28;
    // hex on purpose: other scripts append an alpha value to the colour string
    root.setProperty('--accent', hslToHex((hue + 360) % 360, Math.max(55, bs), Math.min(70, Math.max(55, bl))));
    root.setProperty('--accent-2', hslToHex((hue + 55 + 360) % 360, 85, 60));
  }, 100);
}
// eslint-disable-next-line no-func-assign
const _applyThemeLabs = applyTheme;
// eslint-disable-next-line no-func-assign
applyTheme = function (...a) {
  _applyThemeLabs(...a);
  labsThemeHook();
};

async function settingsLabs(view) {
  const t = theme();
  const code = h('input', { placeholder: 'CNTRT1.…  (Design-Code einfügen)', class: 'grow' });
  const st = await call(api.labsParentStatus).catch(() => ({ enabled: false, played: 0 }));
  const limit = h('input', { type: 'number', min: 0, max: 720, step: 15, value: st.limitMin || 0, style: 'width:90px' });
  const pin = h('input', { type: 'password', placeholder: 'PIN (4–8 Ziffern)', style: 'width:150px' });
  const seg = (key, opts, def) => h('div', { class: 'seg' }, opts.map(([k, l]) => h('button', { class: (t[key] ?? def) === k ? 'on' : '', onclick: async (e) => {
    await saveTheme({ [key]: k });
    e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.currentTarget));
  } }, l)));
  view.append(
    h('h2', {}, 'Design-Extras'),
    h('div', { class: 'form panel' },
      h('label', {}, 'Animierte Akzentfarbe'), seg('accentAnim', [['off', 'Aus'], ['pulse', 'Pulsieren'], ['rainbow', 'Regenbogen']], 'off'),
      h('label', {}, 'Nachtmodus automatisch'), h('button', { class: 'switch' + (t.dayNight ? ' on' : ''), title: 'Zwischen 21 und 6 Uhr etwas dunkler', onclick: async (e) => { const v = !theme().dayNight; await saveTheme({ dayNight: v }); e.currentTarget.classList.toggle('on', v); } }),
      h('label', {}, 'Akzentfarbe aus Skin'), h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: async () => { try { const c = await accentFromSkin(); toast(`Akzentfarbe ${c} übernommen`); } catch (e) { toast(e.message, true); } } }, 'Aus meinem Skin berechnen')),
      h('label', {}, 'Design teilen'), h('div', { class: 'row' }, code,
        h('button', { class: 'btn sm', onclick: async () => { navigator.clipboard.writeText(await call(api.labsThemeCode)); toast('Design-Code kopiert'); } }, 'Meinen Code kopieren'),
        h('button', { class: 'btn sm primary', onclick: async () => { try { const n = await call(api.labsThemeApply, code.value); await refresh(); toast(`Design übernommen (${n} Werte)`); render(); } catch (e) { toast(e.message, true); } } }, 'Anwenden'))),
    h('h2', {}, 'Spielzeit-Limit'),
    h('div', { class: 'form panel' },
      h('div', { class: 'hint' }, st.enabled ? `Heute gespielt: ${st.played} Min. · noch ${st.left} Min.${st.bonus ? ` (inkl. ${st.bonus} Min. Verlängerung)` : ''}` : `Heute gespielt: ${st.played} Min. Ohne Limit.`),
      h('label', {}, 'Minuten pro Tag (0 = aus)'), h('div', { class: 'row' }, limit, pin,
        h('button', { class: 'btn sm primary', onclick: async () => { try { await call(api.labsParentSet, Number(limit.value), pin.value); toast(Number(limit.value) ? 'Limit gespeichert' : 'Limit aus'); } catch (e) { toast(e.message, true); } } }, 'Speichern')),
      st.enabled && h('label', {}, 'Heute verlängern'),
      st.enabled && h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: async () => { try { await call(api.labsParentExtend, pin.value, 30); toast('30 Minuten mehr'); } catch (e) { toast(e.message, true); } } }, '+30 Min. (PIN oben eingeben)'))));

  // ---- more settings: accessibility, sounds, update channel, privacy, error log
  const sw = (key, label, tip, after) => [h('label', {}, label), h('button', { class: 'switch' + (theme()[key] ? ' on' : ''), title: tip || '', onclick: async (e) => { const v = !theme()[key]; await saveTheme({ [key]: v }); e.currentTarget.classList.toggle('on', v); after && after(v); } })];
  view.append(
    h('h2', {}, 'Komfort & Datenschutz'),
    h('div', { class: 'form panel' },
      ...sw('highContrast', 'Hoher Kontrast', 'Kräftigere Schrift und Ränder, besser lesbar'),
      ...sw('uiSounds', 'Klick-Töne', 'Kleine Töne bei Klicks'),
      h('label', {}, 'Beta-Updates'), h('button', { class: 'switch' + (state.settings.beta ? ' on' : ''), title: 'Auch Vorab-Versionen laden (wirkt nach dem nächsten Start)', onclick: async (e) => { const v = !state.settings.beta; await call(api.setSettings, { beta: v }); state.settings.beta = v; e.currentTarget.classList.toggle('on', v); toast(v ? 'Beta-Updates an (nach Neustart)' : 'Beta-Updates aus (nach Neustart)'); } }),
      h('label', {}, 'Datenschutz'), h('button', { class: 'btn sm', onclick: privacyModal }, 'Was verlässt meinen PC?'),
      h('label', {}, 'Fehlerprotokoll'), h('button', { class: 'btn sm', onclick: async () => { const t = await call(api.labs2Errors); modal(h('div', {}, h('h2', {}, 'Fehlerprotokoll des Launchers'), h('pre', { class: 'logview', style: 'height:260px' }, t || 'Keine Fehler aufgezeichnet.'), h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:12px' }, h('button', { class: 'btn', onclick: () => { navigator.clipboard.writeText(t || ''); toast('Kopiert'); } }, 'Kopieren'), h('button', { class: 'btn primary', onclick: closeModal }, 'Schließen'))), true); } }, 'Anzeigen')));
}

function privacyModal() {
  const row = (t, d) => h('li', {}, h('b', {}, t + ': '), d);
  modal(h('div', {}, h('h2', {}, 'Was verlässt meinen PC?'),
    h('p', { class: 'sub' }, 'Der Launcher sammelt keine Nutzungsdaten und hat kein Tracking. Das wird nach außen gesendet:'),
    h('ul', { style: 'line-height:1.6' },
      row('Minecraft & Mods', 'Downloads von Mojang, Fabric, Modrinth und (optional) CurseForge – dabei sieht der Server deine IP-Adresse.'),
      row('Anmeldung', 'Microsoft/Xbox, wenn du dich mit einem Konto anmeldest. Tokens bleiben verschlüsselt auf diesem PC.'),
      row('KI-Assistent', 'Deine Fragen (und angehängte Dateien/Bilder) gehen an den gewählten Anbieter: den Counter-Server (Cloudflare → Groq) oder deinen eigenen (Gemini, Mistral, OpenRouter …). Dazu ein anonymer Hash als Nutzer-Kennung für das Limit. Eigene Schlüssel bleiben nur hier gespeichert.'),
      row('Websuche der KI', 'DuckDuckGo und das Minecraft Wiki.'),
      row('Bilder der KI', 'Pollinations erzeugt sie anhand der Beschreibung.'),
      row('Server-Status', 'Beim Prüfen eines Servers wird dieser direkt angefragt.'),
      row('Updates', 'GitHub (HckrJT/counter-launcher) für Launcher und Counter-Mod.')),
    h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:12px' }, h('button', { class: 'btn primary', onclick: closeModal }, 'Verstanden'))), true);
}

// ---- click sounds (small WebAudio blips, only when switched on)
let audioCtx = null;
function uiBlip(freq = 880, ms = 45) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = freq;
    o.type = 'sine';
    g.gain.value = 0.04;
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + ms / 1000);
    o.stop(audioCtx.currentTime + ms / 1000 + 0.02);
  } catch {}
}
document.addEventListener('click', (e) => {
  if (theme().uiSounds && e.target.closest && e.target.closest('button, .btn, .nav, .skill-card')) uiBlip(e.target.closest('.switch') ? 660 : 880);
}, true);

// eslint-disable-next-line no-func-assign
const _settingsLabs = settings;
// eslint-disable-next-line no-func-assign
settings = function (view) {
  const r = _settingsLabs(view);
  settingsLabs(view);
  return r;
};

// ================================================================= first start: short setup
async function firstStartWizard() {
  try {
    if (localStorage.getItem('cl.wizard')) return;
  } catch {}
  if (!state || !state.instances || state.instances.length > 1) return;
  const pick = { style: 'Performance', pc: 'mid' };
  const opts = (key, list) => h('div', { class: 'seg' }, list.map(([k, l]) => h('button', { class: pick[key] === k ? 'on' : '', onclick: (e) => { pick[key] = k; [...e.currentTarget.parentElement.children].forEach((b) => b.classList.toggle('on', b === e.currentTarget)); } }, l)));
  const done = () => {
    try {
      localStorage.setItem('cl.wizard', '1');
    } catch {}
    closeModal();
  };
  modal(h('div', {}, h('h2', {}, 'Willkommen beim Counter Launcher!'), h('p', { class: 'sub' }, 'Zwei Fragen, dann passe ich die Einstellungen für dich an. Alles lässt sich später ändern.'),
    h('div', { class: 'form' },
      h('label', {}, 'Wie spielst du?'), opts('style', [['Performance', 'Möglichst viele FPS'], ['PvP', 'PvP'], ['Survival', 'Survival'], ['Schön', 'Schön & Shader']]),
      h('label', {}, 'Wie stark ist dein PC?'), opts('pc', [['low', 'Eher schwach'], ['mid', 'Normal'], ['high', 'Stark']])),
    h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:16px' },
      h('button', { class: 'btn ghost', onclick: done }, 'Überspringen'),
      h('button', { class: 'btn primary', onclick: async () => {
        const j = await call(api.labsJava, state.selectedInstance || state.instances[0].id).catch(() => null);
        const ram = { low: 3, mid: 4, high: 6 }[pick.pc];
        await call(api.setSettings, { ramMb: Math.min(ram, j && j.pcRamGb ? Math.floor(j.pcRamGb / 2) : ram) * 1024 });
        await refresh();
        done();
        const tpl = { Performance: 0, PvP: 1, Survival: 2, Schön: 3 }[pick.style];
        toast(`Fertig! Unter „Importieren“ findest du die Vorlage „${TEMPLATES[tpl][0].replace(/^\S+\s/, '')}“.`);
        go({ page: 'import' });
      } }, 'Einrichten'))));
}
setTimeout(firstStartWizard, 3500);
