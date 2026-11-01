// Counter Launcher – "Assistent" page: chat with the Counter assistant (Groq). It can search Modrinth and the web,
// read web pages and game files, generate images, ask back with answer buttons, remember things, and change mods,
// Counter settings, the launcher design, instances and worlds (each change confirmed, or directly when allowed).
// Everything about it is adjustable in the "KI-Studio": thinking level, personality, length, language, own
// instructions, permissions, voice, animations, mascot colour, own slash commands and the memory.
// Several chats are kept in localStorage (sidebar with search, pin, rename, export).

(() => {
  const btn = h('button', { class: 'nav', 'data-page': 'assistant' }, svg('M12 3l1.8 4.6L18 9.5l-4.2 1.9L12 16l-1.8-4.6L6 9.5l4.2-1.9zM19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8zM5 15l.6 1.4L7 17l-1.4.6L5 19l-.6-1.4L3 17l1.4-.6z'), h('span', { class: 'tip' }, 'Assistent'));
  btn.addEventListener('click', () => go({ page: 'assistant' }));
  $('#rail .nav[data-page="news"]').after(btn);
})();
extraPages.assistant = assistantPage;
extraNames.assistant = 'Assistent';

const lsGet = (k, d) => {
  try {
    const v = localStorage.getItem(k);
    return v == null ? d : JSON.parse(v);
  } catch {
    return d;
  }
};
const lsSet = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};

// ---------------------------------------------------------------- preferences ("KI-Studio")
const AI_PREF_DEFAULTS = {
  think: 'deep', tone: 'friendly', length: 'normal', emojis: true, formal: false, language: 'auto',
  allowWeb: true, allowImages: true, showThoughts: true, showSteps: true, instructions: '', name: '',
  tts: false, voice: '', rate: 1, anim: 'full', hue: 0, enterSends: true, customCmds: [], kidSafe: false,
};
let aiPrefs = { ...AI_PREF_DEFAULTS, ...lsGet('cl.aiPrefs', {}) };
const savePrefs = () => lsSet('cl.aiPrefs', aiPrefs);
const aiName = () => aiPrefs.name.trim() || mascotName();
const THINK_LEVELS = [['fast', 'Schnell', 'Antwortet sofort, denkt kurz nach'], ['deep', 'Gründlich', 'Denkt bei Bau-/Crash-/Planungsfragen länger nach'], ['max', 'Maximal', 'Denkt sehr lange, mehr Werkzeug-Runden und prüft die Antwort ein zweites Mal'], ['ultra', 'Ultra', 'Absolutes Limit: schreibt erst einen Plan, arbeitet bis zu 18 Runden, liest mehr vom Chat und prüft streng – dauert am längsten']];
const TONE_LIST = [['friendly', 'Freundlich'], ['cool', 'Lässig'], ['pro', 'Sachlich'], ['funny', 'Witzig'], ['teacher', 'Erklärend']];
const LENGTH_LIST = [['short', 'Kurz'], ['normal', 'Normal'], ['long', 'Ausführlich']];
const PERSONA_PRESETS = [
  ['', 'Maskottchen-Standard'],
  ['Du bist ein erfahrener PvP-Coach. Gib konkrete Tipps zu Settings, Crosshair, FPS und Taktik.', 'PvP-Coach'],
  ['Du bist ein Modpack-Architekt. Denk an Kompatibilität, Performance und ein rundes Spielerlebnis.', 'Modpack-Architekt'],
  ['Du bist ein Technik-Experte für Performance. Ziel: maximale FPS und flüssiges Spiel auf jedem PC.', 'FPS-Tuner'],
  ['Du bist ein kreativer Baumeister und Designer. Hilf bei Builds, Farbpaletten, Ressourcenpaketen und Looks.', 'Designer'],
  ['Du bist ein Redstone-Ingenieur. Erkläre Schaltungen präzise, mit Bauschritten.', 'Redstone-Profi'],
];

// ---------------------------------------------------------------- chats
function newChat() {
  return { id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title: 'Neuer Chat', pinned: false, updated: Date.now(), goal: '', messages: [] };
}
let aiChats = lsGet('cl.aiChats', null);
if (!Array.isArray(aiChats)) {
  // migrate the old single chat
  const old = lsGet('cl.ai', []);
  const c = newChat();
  c.messages = old;
  c.goal = lsGet('cl.aiGoal', '');
  if (old.length) c.title = String((old.find((m) => m.role === 'user') || {}).shown || 'Chat').slice(0, 40);
  aiChats = [c];
}
let aiChatId = lsGet('cl.aiChat', aiChats[0] && aiChats[0].id);
const curChat = () => aiChats.find((c) => c.id === aiChatId) || aiChats[0] || (aiChats.push(newChat()), aiChats[0]);
let aiAuto = lsGet('cl.aiAuto', false);
let aiBusy = false;
let aiAttach = [];
let aiStatusLabel = null;
let aiSideOpen = lsGet('cl.aiSide', true);
/** uploaded images are not stored (too big), the rest of every chat is */
function saveChats() {
  aiChats = aiChats.filter((c) => c.messages.length || c.id === aiChatId).slice(-60);
  lsSet('cl.aiChats', aiChats.map((c) => ({ ...c, messages: c.messages.slice(-60).map((m) => (m.images && m.role === 'user' ? { ...m, images: undefined, hadImages: m.images.length } : m)) })));
  lsSet('cl.aiChat', aiChatId);
}

const AI_COMMANDS = [
  ['/goal', '<Ziel>', 'Ziel setzen, auf das der Assistent hinarbeitet (/goal ohne Text = löschen)'],
  ['/crash', '', 'Neuesten Crash-Report / Log der Instanz analysieren'],
  ['/image', '<Beschreibung>', 'Bild erzeugen'],
  ['/search', '<Frage>', 'Live im Internet suchen'],
  ['/mods', '', 'Mods der Instanz prüfen und verbessern'],
  ['/fps', '', 'Instanz auf maximale FPS optimieren'],
  ['/module', '<Idee>', 'Eigenes Counter-Modul bauen lassen'],
  ['/pack', '<Idee>', 'Ressourcenpaket bauen lassen'],
  ['/design', '<Idee>', 'Launcher-Design ändern lassen'],
  ['/think', 'fast|deep|max', 'Denkstufe wählen'],
  ['/remember', '<Info>', 'Etwas dauerhaft merken'],
  ['/memory', '', 'Gedächtnis anzeigen'],
  ['/instance', '<Name>', 'Instanz für den Chat wechseln'],
  ['/model', '<Name|auto>', 'Modell wählen'],
  ['/auto', 'on|off', 'Änderungen ohne Nachfrage ausführen lassen'],
  ['/studio', '', 'KI-Studio (alle Einstellungen) öffnen'],
  ['/skills', '', 'Fähigkeiten: fertige Aufgaben als Knöpfe'],
  ['/check', '', 'Mods der Instanz auf Probleme prüfen'],
  ['/modpack', '<Idee>', 'Modpack aus einer Beschreibung bauen'],
  ['/updates', '', 'Wochenübersicht der Mod-Updates'],
  ['/export', '', 'Chat als Markdown speichern'],
  ['/new', '', 'Neuer Chat'],
  ['/clear', '', 'Diesen Chat leeren'],
  ['/help', '', 'Alle Befehle anzeigen'],
];
const allCommands = () => AI_COMMANDS.concat((aiPrefs.customCmds || []).filter((c) => c.cmd && c.prompt).map((c) => ['/' + c.cmd.replace(/^\//, ''), c.prompt.includes('{text}') ? '<Text>' : '', 'Eigener Befehl: ' + c.prompt.slice(0, 60)]));

const AI_SUGGEST = [
  'Welche Mods machen mein Minecraft schneller?',
  'Was kann der Counter Client alles?',
  'Mein Spiel crasht – hilf mir',
  'Bau mir ein Counter-Modul, das bei wenig Leben warnt',
  'Mach mir ein Ressourcenpaket im Neon-Stil',
  'Was ist neu in der neuesten Minecraft-Version?',
  'Stell ein Abenteuer-Modpack für mich zusammen',
  'Gib dem Launcher ein Sonnenuntergang-Design',
];

const hasAnyAiKey = () => !!(state.settings.groqKey || Object.keys(state.settings.aiKeys || {}).length);

/** one card per AI provider: where to get the free key, key field, "main provider" choice */
function providerPanel(onChange) {
  const box = h('div', { class: 'prov-list' });
  const draw = async () => {
    const info = await call(api.aiProviders);
    box.replaceChildren(
      h('div', { class: 'prov-auto' }, h('label', { class: 'ai-tog' }, h('input', { type: 'checkbox', checked: info.shareFallback, onchange: async (e) => { await call(api.setSettings, { aiShareFallback: e.target.checked }); } }),
        h('span', {}, 'Wenn alle meine Anbieter voll sind, den geteilten Counter-Server als Reserve nutzen'))),
      ...info.list.map((p) => {
        const key = h('input', { type: 'password', placeholder: p.hint ? `Schlüssel (${p.hint})` : 'Schlüssel', class: 'grow', autocomplete: 'off' });
        const msg = h('div', { class: 'small', style: 'min-height:14px' });
        const main = info.selected === p.id || (info.selected === 'auto' && false);
        return h('div', { class: 'prov-card' + (p.hasKey ? ' on' : '') },
          h('div', { class: 'row' }, h('b', { class: 'grow' }, p.name), p.hasKey ? h('span', { class: 'tag g' }, p.id === 'proxy' ? 'immer da' : 'Schlüssel gespeichert') : null,
            p.hasKey ? h('label', { class: 'prov-main' }, h('input', { type: 'radio', name: 'prov-main', checked: main, onchange: async () => { await call(api.setSettings, { aiProvider: p.id }); toast(`${p.name} ist jetzt der Hauptanbieter`); onChange && onChange(); } }), 'Haupt') : null),
          h('div', { class: 'muted small' }, p.note),
          p.id === 'proxy' ? null : h('div', { class: 'row', style: 'margin-top:6px' },
            p.keyUrl ? h('a', { href: '#', class: 'small', onclick: (e) => { e.preventDefault(); api.openExternal(p.keyUrl); } }, 'Gratis-Schlüssel holen ↗') : null, h('span', { class: 'grow' }),
            key,
            h('button', { class: 'btn sm primary', onclick: async (e) => {
              const b = e.currentTarget;
              b.disabled = true;
              msg.textContent = 'Prüfe …';
              try {
                await call(api.aiSetKey, p.id, key.value);
                await refresh();
                toast(`${p.name}: gespeichert`);
                onChange && onChange();
                draw();
              } catch (err) {
                msg.textContent = err.message;
                msg.style.color = '#ff9aac';
              }
              b.disabled = false;
            } }, 'Speichern'),
            p.hasKey ? h('button', { class: 'btn sm ghost danger', onclick: async () => { await call(api.aiSetKey, p.id, ''); await refresh(); draw(); onChange && onChange(); } }, 'Entfernen') : null),
          msg);
      }));
  };
  draw();
  return box;
}

function aiKeySetup(view) {
  view.append(h('div', { class: 'ai-setup panel' },
    h('div', { class: 'ai-av big' }, mascot(80)),
    h('h2', {}, `${aiName()} einrichten`),
    h('p', { class: 'muted' }, 'Der Assistent braucht einen kostenlosen KI-Schlüssel. Google Gemini ist das stärkste Gratis-Modell – du kannst auch mehrere Anbieter eintragen, dann springt der nächste ein, wenn einer voll ist.'),
    providerPanel(() => { if (hasAnyAiKey()) render(); })));
}

// ---------------------------------------------------------------- attachments
const TEXT_EXT = /\.(txt|log|json|json5|toml|cfg|conf|properties|yml|yaml|ini|md|csv|xml|mcmeta|js|java|kt)$/i;
function readAttachment(file) {
  return new Promise((resolve) => {
    if (file.type.startsWith('image/')) {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1024 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        const g = c.getContext('2d');
        g.imageSmoothingEnabled = k < 1;
        g.drawImage(img, 0, 0, c.width, c.height);
        resolve({ kind: 'image', name: file.name, data: c.toDataURL('image/jpeg', 0.88) });
      };
      img.onerror = () => {
        toast(`${file.name} konnte nicht gelesen werden`, true);
        resolve(null);
      };
      // data: URL instead of blob: (the window's security policy only allows data: images)
      const fr = new FileReader();
      fr.onload = () => (img.src = fr.result);
      fr.onerror = img.onerror;
      fr.readAsDataURL(file);
      return;
    }
    if (!TEXT_EXT.test(file.name) && !file.type.startsWith('text/')) {
      toast(`${file.name}: nur Bilder und Textdateien (Logs, Configs …)`, true);
      return resolve(null);
    }
    const r = new FileReader();
    r.onload = () => {
      let text = String(r.result || '');
      // crash reports and logs: the interesting part is usually at the end
      if (text.length > 24000) text = text.slice(0, 4000) + '\n…\n' + text.slice(-20000);
      resolve({ kind: 'text', name: file.name, data: text });
    };
    r.onerror = () => resolve(null);
    r.readAsText(file);
  });
}

// ---------------------------------------------------------------- voice
function speakText(text) {
  if (!window.speechSynthesis) return toast('Vorlesen wird hier nicht unterstützt', true);
  speechSynthesis.cancel();
  const plain = String(text || '').replace(/```[\s\S]*?```/g, ' Code. ').replace(/[*_#`>|]/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/https?:\/\/\S+/g, '').slice(0, 3000);
  const u = new SpeechSynthesisUtterance(plain);
  const voices = speechSynthesis.getVoices();
  const v = voices.find((x) => x.name === aiPrefs.voice) || voices.find((x) => /^de/i.test(x.lang));
  if (v) {
    u.voice = v;
    u.lang = v.lang;
  }
  u.rate = aiPrefs.rate || 1;
  u.onstart = () => mascotsDo('talk', 0);
  u.onend = () => document.querySelectorAll('.ai-page .talk').forEach((e) => e.classList.remove('talk'));
  speechSynthesis.speak(u);
}

// ---------------------------------------------------------------- animations
const THINK = ['denkt nach', 'liest deine Nachricht', 'überlegt, welche Werkzeuge passen', 'durchsucht Modrinth', 'sucht im Internet', 'prüft die Counter-Module', 'baut etwas zusammen', 'checkt alles doppelt'];
function thinkingBubble() {
  const label = h('span', { class: 'think-text' }, `${aiName()} ${THINK[0]} …`);
  const steps = h('div', { class: 'think-steps' });
  const timer = h('span', { class: 'think-time' }, '0 s');
  const t0 = Date.now();
  let i = 0;
  let live = false;
  aiStatusLabel = { set: (t) => {
    live = true;
    label.classList.remove('swap');
    void label.offsetWidth;
    label.classList.add('swap');
    label.textContent = `${aiName()} ${t} …`;
    if (aiPrefs.showSteps && !/denkt|arbeitet weiter/.test(t)) steps.append(h('div', { class: 'think-step' }, h('i'), t));
  } };
  const iv = setInterval(() => {
    if (!label.isConnected) return clearInterval(iv);
    timer.textContent = `${Math.round((Date.now() - t0) / 1000)} s`;
    if (live || (Date.now() - t0) % 1700 > 1000) return;
    i = (i + 1) % THINK.length;
    label.textContent = `${aiName()} ${THINK[i]} …`;
  }, 1000);
  const lvl = THINK_LEVELS.find((x) => x[0] === aiPrefs.think);
  return h('div', { class: 'bubble typing' }, h('div', { class: 'row', style: 'gap:6px' }, h('i'), h('i'), h('i'), label, timer, lvl ? h('span', { class: 'tag' }, lvl[1]) : null), steps);
}
function mascotsDo(cls, ms = 1200) {
  if (aiPrefs.anim === 'off') return;
  for (const el of document.querySelectorAll('.ai-page .counti, .ai-page .mascot')) {
    el.classList.remove(cls);
    void el.getBoundingClientRect();
    el.classList.add(cls);
    if (ms) setTimeout(() => el.classList.remove(cls), ms);
  }
}
/** little party around the newest mascot: sparkles, stars and hearts fly out */
function celebrate() {
  if (aiPrefs.anim === 'off') return;
  mascotsDo('party');
  const avs = document.querySelectorAll('.ai-page .ai-av');
  const host = avs[avs.length - 1];
  if (!host) return;
  const r = host.getBoundingClientRect();
  const n = aiPrefs.anim === 'calm' ? 6 : 16;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + Math.random() * 0.4;
    const d = 40 + Math.random() * 50;
    const s = h('span', { class: 'ai-spark', style: `left:${r.left + r.width / 2}px;top:${r.top + r.height / 2}px;--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d - 20}px;--rot:${Math.random() * 360}deg` }, ['✦', '★', '♥', '✧'][k % 4]);
    document.body.append(s);
    setTimeout(() => s.remove(), 1100);
  }
}
api.on('ai:status', (t) => aiStatusLabel && aiStatusLabel.set(t));

// ---------------------------------------------------------------- message parts
function aiModCard(m) {
  const inst = instById(state.selectedInstance) || sortInstances(state.instances)[0];
  const b = h('button', { class: 'btn sm primary', onclick: async (e) => {
    e.stopPropagation();
    if (!inst) return toast('Lege zuerst eine Instanz an', true);
    b.disabled = true;
    b.replaceChildren(h('span', { class: 'spin' }), 'Installiere');
    try {
      await call(api.install, 'modrinth', m.project_id, m.type, inst.id);
      b.replaceChildren('✓ Installiert');
      toast(`${m.title} in „${inst.name}“ installiert`);
    } catch (err) {
      toast(err.message, true);
      b.disabled = false;
      b.replaceChildren('Installieren');
    }
  } }, 'Installieren');
  return h('div', { class: 'ai-mod', onclick: () => go({ page: 'project', id: m.project_id, source: 'modrinth', type: m.type }) },
    m.icon_url ? h('img', { src: m.icon_url, alt: '' }) : pixelIcon(m.project_id, 40),
    h('div', { class: 'grow' }, h('div', { class: 't' }, m.title), h('div', { class: 'm' }, m.description)), b);
}
const actionLabel = (a) => ({
  install_mod: () => `${a.title || a.project_id} installieren`,
  remove_mod: () => `${a.title || a.file} entfernen (Papierkorb)`,
  toggle_mod: () => `${a.title || a.file} ${a.enabled ? 'einschalten' : 'ausschalten'}`,
  create_module: () => `Eigenes Counter-Modul „${(a.spec && a.spec.name) || 'Modul'}“ erstellen`,
  create_resourcepack: () => `Ressourcenpaket „${(a.spec && a.spec.name) || 'KI Pack'}“ bauen (${((a.spec && a.spec.textures) || []).length} Texturen)`,
  counter_config: () => `Counter-Einstellungen: ${a.summary || (a.changes || []).length + ' Änderung(en)'}`,
  launcher_design: () => `Launcher-Design: ${a.summary || Object.keys(a.patch || {}).join(', ')}`,
  create_instance: () => `Neue Instanz „${a.name}“ (${a.loader || 'fabric'} ${a.mcVersion}${a.counter ? ' + Counter' : ''})`,
  build_modpack: () => `Modpack „${a.name}“ bauen (${(a.projects || []).length} Mods, ${a.loader || 'fabric'} ${a.mcVersion})`,
  launch_instance: () => `${(instById(a.id) || {}).name || a.id} starten${a.server ? ` und ${a.server} beitreten` : ''}`,
  backup_world: () => `Backup der Welt „${a.world}“`,
}[a.kind] || (() => a.kind))();
const actionIcon = (a) => ({ install_mod: '+', remove_mod: '−', toggle_mod: '⇄', create_module: '✦', create_resourcepack: '▦', counter_config: '⚙', launcher_design: '◐', create_instance: '▣', launch_instance: '▶', backup_world: '⛁', build_modpack: '📦' }[a.kind] || '•');
/** a short readable preview of what an action would change */
function actionDetail(a) {
  if (a.kind === 'counter_config') return (a.changes || []).map((c) => c.module ? `${c.module}${typeof c.enabled === 'boolean' ? (c.enabled ? ' an' : ' aus') : ''}${c.setting ? `.${c.setting} = ${JSON.stringify(c.value)}` : ''}${c.reset ? ' zurücksetzen' : ''}` : `Design ${c.theme} = ${JSON.stringify(c.value)}`).join('\n');
  if (a.kind === 'build_modpack') return `Modrinth-Projekte: ${(a.projects || []).join(', ')}`;
  if (a.kind === 'launcher_design') return Object.entries(a.patch || {}).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n');
  if (a.kind === 'create_module' && a.spec) return [a.spec.description, a.spec.hud && a.spec.hud.text ? `HUD: ${a.spec.hud.text}` : '', ...(a.spec.triggers || []).map((t) => `Wenn ${t.when}${t.value != null ? ' ' + t.value : ''} → ${(t.do || []).map((d) => d.action).join(', ')}`), ...(a.spec.keys || []).map((k) => `Taste ${k.key} → ${(k.do || []).map((d) => d.action).join(', ')}`)].filter(Boolean).join('\n');
  if (a.kind === 'create_resourcepack' && a.spec) return (a.spec.textures || []).map((t) => `${t.path}: ${t.prompt}`).join('\n');
  return '';
}
function aiActions(msg) {
  const box = h('div', { class: 'ai-actions' });
  const draw = () => {
    const open = msg.actions.filter((a) => !a.state);
    box.replaceChildren(...[
      h('div', { class: 'ai-actions-head' }, svg('M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z'), 'Vorgeschlagene Änderungen'),
      ...msg.actions.map((a) => {
        const detail = actionDetail(a);
        return h('div', { class: 'ai-action ' + (a.state || '') }, h('span', { class: 'ico' }, actionIcon(a)), h('span', { class: 'grow' }, actionLabel(a),
          detail ? h('details', { class: 'ai-detail' }, h('summary', {}, 'Details'), h('pre', {}, detail)) : null,
          a.state === 'fail' ? h('div', { class: 'ai-err' }, a.error) : null),
          a.state === 'done' ? h('span', { class: 'tag g' }, 'erledigt') : a.state === 'skip' ? h('span', { class: 'tag' }, 'abgelehnt') : a.state === 'fail' ? h('span', { class: 'tag' }, 'Fehler') : null);
      }),
      open.length ? h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:8px' },
        h('button', { class: 'btn sm ghost', onclick: () => { for (const a of open) a.state = 'skip'; saveChats(); draw(); } }, 'Ablehnen'),
        h('button', { class: 'btn sm primary', onclick: async (e) => {
          e.currentTarget.disabled = true;
          const inst = instById(state.selectedInstance) || sortInstances(state.instances)[0];
          for (const a of open) {
            try {
              await call(api.aiApply, a, inst && inst.id);
              a.state = 'done';
            } catch (err) {
              a.state = 'fail';
              a.error = err.message;
            }
            draw();
          }
          saveChats();
          await refresh();
          if (open.some((a) => a.state === 'done')) {
            window.pixelBurst && aiPrefs.anim !== 'off' && window.pixelBurst(box);
            celebrate();
          }
          toast(open.every((a) => a.state === 'done') ? 'Änderungen ausgeführt' : 'Nicht alles hat geklappt – siehe Fehler', !open.every((a) => a.state === 'done'));
        } }, `Ausführen (${open.length})`)) : null].filter(Boolean));
  };
  draw();
  return box;
}

function copyText(t) {
  navigator.clipboard.writeText(t).then(() => toast('Kopiert'), () => toast('Kopieren ging nicht', true));
}
function aiBubble(msg, ctl) {
  if (msg.role === 'user') {
    return h('div', { class: 'ai-msg me' }, h('div', { class: 'bubble' },
      msg.images && msg.images.length ? h('div', { class: 'ai-thumbs' }, msg.images.map((u) => h('img', { src: u, alt: '' }))) : msg.hadImages ? h('div', { class: 'muted', style: 'font-size:11px' }, `📎 ${msg.hadImages} Bild(er)`) : null,
      msg.files && msg.files.length ? h('div', { class: 'ai-files' }, msg.files.map((f) => h('span', { class: 'file-chip' }, '📄 ' + f))) : null,
      msg.shown || msg.content),
      h('div', { class: 'ai-tools me' }, h('button', { title: 'Bearbeiten und neu senden', onclick: () => ctl.edit(msg) }, '✎'), h('button', { title: 'Kopieren', onclick: () => copyText(msg.shown || msg.content) }, '⧉')));
  }
  const thoughts = aiPrefs.showThoughts && msg.thoughts && msg.thoughts.length;
  return h('div', { class: 'ai-msg bot' }, h('div', { class: 'ai-av' }, mascot(30)), h('div', { class: 'ai-col' }, h('div', { class: 'bubble' },
    thoughts || (aiPrefs.showSteps && msg.steps && msg.steps.length) ? h('details', { class: 'ai-thoughts' },
      h('summary', {}, svg('M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z'),
        thoughts ? `Gedanken${msg.secs ? ` · ${msg.secs} s` : ''}` : 'Arbeitsschritte', msg.steps && msg.steps.length ? h('span', { class: 'muted' }, ` · ${msg.steps.length} Schritt(e)`) : null, msg.reviewed ? h('span', { class: 'tag g' }, 'geprüft') : null),
      msg.plan ? h('div', { class: 'ai-plan' }, h('b', {}, 'Plan'), markdown(msg.plan)) : null,
      msg.steps && msg.steps.length ? h('ol', { class: 'ai-steps' }, msg.steps.map((s) => h('li', {}, s.label))) : null,
      thoughts ? h('div', { class: 'ai-thought-text' }, msg.thoughts.join('\n\n')) : null) : null,
    msg.searched && msg.searched.length ? h('div', { class: 'ai-searched' }, svg(I.search), 'Im Internet gesucht: ', msg.searched.join(' · ')) : null,
    msg.remembered && msg.remembered.length ? h('div', { class: 'ai-searched' }, '🧠 Gemerkt: ', msg.remembered.join(' · ')) : null,
    msg.error ? h('span', { class: 'err' }, msg.content) : markdown(msg.content || '…'),
    msg.images && msg.images.length ? h('div', { class: 'ai-gen' }, msg.images.map((im) => {
      const img = h('img', { src: im.url, alt: im.prompt, loading: 'lazy', onload: (e) => e.target.parentElement.classList.add('ready') });
      return h('div', { class: 'ai-gen-item', title: im.prompt }, img, h('button', { class: 'btn sm', onclick: () => api.openExternal(im.url) }, svg(I.ext), 'Öffnen / speichern'));
    })) : null,
    msg.ask && msg.ask.options && msg.ask.options.length && !msg.answered ? h('div', { class: 'ai-chips left' }, msg.ask.options.map((o) => h('button', { class: 'chip', onclick: () => { msg.answered = true; ctl.send(o); } }, o))) : null,
    msg.canContinue && ctl.isLast(msg) ? h('div', { class: 'ai-chips left' }, h('button', { class: 'chip', onclick: () => ctl.send('Mach weiter, wo du aufgehört hast, und bring die Aufgabe zu Ende.') }, '▶ Weitermachen')) : null,
    msg.mods && msg.mods.length ? h('div', { class: 'ai-mods' }, msg.mods.map(aiModCard)) : null,
    msg.applied && msg.applied.length ? h('div', { class: 'ai-actions' }, h('div', { class: 'ai-actions-head' }, 'Direkt ausgeführt'), msg.applied.map((a) => h('div', { class: 'ai-action done' }, h('span', { class: 'ico' }, actionIcon(a)), h('span', { class: 'grow' }, actionLabel(a))))) : null,
    msg.actions && msg.actions.length ? aiActions(msg) : null),
  msg.local ? null : h('div', { class: 'ai-tools' },
    h('button', { title: 'Kopieren', onclick: () => copyText(msg.content || '') }, '⧉'),
    h('button', { title: 'Vorlesen', onclick: () => speakText(msg.content) }, '🔊'),
    h('button', { title: 'Als Lesezeichen speichern', onclick: (e) => { const l = lsGet('cl.aiBookmarks', []); l.unshift({ q: ctl.questionOf(msg), a: msg.content }); lsSet('cl.aiBookmarks', l.slice(0, 80)); e.currentTarget.textContent = '★'; toast('Gespeichert unter Fähigkeiten → Lesezeichen'); } }, '☆'),
    msg.error || ctl.isLast(msg) ? h('button', { title: 'Neu generieren', onclick: () => ctl.retry() }, '↻') : null,
    h('button', { title: 'Gute Antwort', class: msg.rating === 1 ? 'on' : '', onclick: (e) => { msg.rating = msg.rating === 1 ? 0 : 1; saveChats(); e.currentTarget.classList.toggle('on'); } }, '👍'),
    msg.model ? h('span', { class: 'ai-model-tag' }, `${msg.model}${msg.effort ? ' · ' + (({ fast: 'schnell', deep: 'gründlich', max: 'maximal', ultra: 'ultra' })[msg.level] || ({ low: 'schnell', medium: 'gründlich', high: 'maximal' })[msg.effort] || msg.effort) : ''}`) : null)));
}

// ---------------------------------------------------------------- KI-Studio
function aiStudio(onClose) {
  const p = aiPrefs;
  const set = (k, v) => {
    p[k] = v;
    savePrefs();
    applyAiLook();
  };
  const seg = (k, list) => h('div', { class: 'seg' }, list.map(([v, l, tip]) => h('button', { class: p[k] === v ? 'on' : '', title: tip || '', onclick: (e) => { set(k, v); [...e.currentTarget.parentElement.children].forEach((b) => b.classList.toggle('on', b === e.currentTarget)); } }, l)));
  const tog = (k, label, tip) => h('label', { class: 'ai-tog', title: tip || '' }, h('input', { type: 'checkbox', checked: !!p[k], onchange: (e) => set(k, e.target.checked) }), h('span', {}, label));
  const field = (label, ...el) => h('div', { class: 'ai-field' }, h('div', { class: 'ai-field-l' }, label), ...el);
  const section = (title, ...el) => h('div', { class: 'ai-sec' }, h('h3', {}, title), ...el);

  const instr = h('textarea', { rows: 4, placeholder: 'z. B. „Ich spiele meist Bedwars auf Hypixel, mein PC ist schwach. Erklär Dinge kurz. Nenn mich Boss.“', value: p.instructions, oninput: (e) => set('instructions', e.target.value.slice(0, 1500)) });
  const persona = h('select', { onchange: (e) => { instr.value = e.target.value ? (instr.value ? instr.value + '\n' : '') + e.target.value : instr.value; set('instructions', instr.value.slice(0, 1500)); e.target.value = ''; } },
    PERSONA_PRESETS.map(([v, l]) => h('option', { value: v }, v ? `+ ${l}` : 'Rolle hinzufügen …')));

  // voices load asynchronously
  const voiceSel = h('select', { onchange: (e) => set('voice', e.target.value) }, h('option', { value: '' }, 'Automatisch (Deutsch)'));
  const fillVoices = () => {
    const vs = window.speechSynthesis ? speechSynthesis.getVoices() : [];
    voiceSel.replaceChildren(h('option', { value: '' }, 'Automatisch (Deutsch)'), ...vs.map((v) => h('option', { value: v.name }, `${v.name} (${v.lang})`)));
    voiceSel.value = p.voice;
  };
  fillVoices();
  if (window.speechSynthesis) speechSynthesis.onvoiceschanged = fillVoices;

  // own commands
  const cmdsBox = h('div', { class: 'ai-cmdlist' });
  const drawCmds = () => cmdsBox.replaceChildren(...(p.customCmds || []).map((c, i) => h('div', { class: 'ai-cmdrow' },
    h('input', { value: c.cmd, placeholder: 'befehl', style: 'width:110px', oninput: (e) => { c.cmd = e.target.value.replace(/[^\w-]/g, '').slice(0, 20); savePrefs(); } }),
    h('input', { value: c.prompt, placeholder: 'Was soll der Assistent tun? {text} = was du nach dem Befehl schreibst', class: 'grow', oninput: (e) => { c.prompt = e.target.value.slice(0, 600); savePrefs(); } }),
    h('button', { class: 'btn sm ghost', onclick: () => { p.customCmds.splice(i, 1); savePrefs(); drawCmds(); } }, '×'))),
  h('button', { class: 'btn sm', onclick: () => { (p.customCmds ||= []).push({ cmd: '', prompt: '' }); savePrefs(); drawCmds(); } }, '+ Befehl'));
  drawCmds();

  // memory
  const memBox = h('div', { class: 'ai-memlist' });
  const drawMem = (list) => memBox.replaceChildren(...list.map((m, i) => h('div', { class: 'ai-memrow' }, h('span', { class: 'grow' }, m),
    h('button', { class: 'btn sm ghost', onclick: async () => { list.splice(i, 1); drawMem(await call(api.aiMemorySet, list)); } }, '×'))),
  list.length ? '' : h('div', { class: 'muted' }, 'Noch nichts gemerkt. Sag z. B. „Merk dir, dass ich auf Hypixel spiele“.'),
  (() => {
    const inp = h('input', { placeholder: 'Selbst etwas hinzufügen …', class: 'grow' });
    const add = async () => {
      if (!inp.value.trim()) return;
      list.push(inp.value.trim());
      drawMem(await call(api.aiMemorySet, list));
    };
    inp.addEventListener('keydown', (e) => e.key === 'Enter' && add());
    return h('div', { class: 'row' }, inp, h('button', { class: 'btn sm', onclick: add }, 'Merken'), list.length ? h('button', { class: 'btn sm ghost', onclick: () => confirmModal('Gesamtes Gedächtnis löschen?', async () => drawMem(await call(api.aiMemorySet, []))) }, 'Alles vergessen') : null);
  })());
  call(api.aiMemory).then(drawMem).catch(() => drawMem([]));

  const memTools = h('div', { class: 'row' },
    h('button', { class: 'btn sm', onclick: async () => { const list = await call(api.aiMemory); navigator.clipboard.writeText(JSON.stringify({ counterMemory: 1, items: list }, null, 1)).then(() => toast('Gedächtnis in die Zwischenablage kopiert')); } }, 'Exportieren (kopieren)'),
    h('button', { class: 'btn sm', onclick: async () => { try { const t = await navigator.clipboard.readText(); const j = JSON.parse(t); if (!j.counterMemory) throw new Error('Kein Counter-Gedächtnis in der Zwischenablage'); const cur = await call(api.aiMemory); drawMem(await call(api.aiMemorySet, [...cur, ...j.items.filter((x) => !cur.includes(x))])); toast('Importiert'); } catch (e) { toast(e.message, true); } } }, 'Importieren (aus Zwischenablage)'));
  const hue = h('input', { type: 'range', min: 0, max: 360, value: p.hue, oninput: (e) => set('hue', +e.target.value) });
  const rate = h('input', { type: 'range', min: 0.6, max: 1.6, step: 0.1, value: p.rate, oninput: (e) => set('rate', +e.target.value) });

  return h('div', { class: 'ai-studio panel' },
    h('div', { class: 'row ai-studio-head' }, h('div', { class: 'ai-av' }, mascot(34)), h('div', { class: 'grow' }, h('h2', {}, 'KI-Studio'), h('p', { class: 'sub' }, 'Alles am Assistenten nach deinem Geschmack')),
      h('button', { class: 'btn sm ghost', onclick: () => confirmModal('Alle KI-Einstellungen zurücksetzen? (Chats und Gedächtnis bleiben)', () => { aiPrefs = { ...AI_PREF_DEFAULTS }; savePrefs(); applyAiLook(); onClose(true); }) }, 'Zurücksetzen'),
      h('button', { class: 'btn sm primary', onclick: () => onClose() }, 'Fertig')),
    h('div', { class: 'ai-studio-body' },
      section('🔌 Anbieter & Schlüssel', h('p', { class: 'muted small' }, 'Je stärker das Modell, desto schlauer der Assistent. Gemini ist am besten, die Reihenfolge bei mehreren Schlüsseln: Hauptanbieter, dann die übrigen, zuletzt der geteilte Counter-Server.'), providerPanel(() => {})),
      section('🧠 Denken',
        field('Denkstufe', seg('think', THINK_LEVELS)),
        h('p', { class: 'muted small' }, 'Maximal und Ultra brauchen länger und mehr vom Gratis-Limit, prüfen aber jede Antwort ein zweites Mal gegen die echten Ergebnisse. Ultra plant vorher und arbeitet am längsten.'),
        tog('showThoughts', 'Gedanken anzeigen', 'Die Überlegungen des Modells aufklappbar unter jeder Antwort'),
        tog('showSteps', 'Arbeitsschritte live anzeigen', 'Was der Assistent gerade sucht, liest oder baut')),
      section('🎭 Persönlichkeit',
        field('Name', h('input', { value: p.name, placeholder: mascotName(), maxlength: 24, oninput: (e) => set('name', e.target.value.slice(0, 24)) })),
        field('Ton', seg('tone', TONE_LIST)),
        field('Länge', seg('length', LENGTH_LIST)),
        field('Sprache', seg('language', [['auto', 'Automatisch'], ['de', 'Deutsch'], ['en', 'Englisch']])),
        field('Anrede', seg('formal', [[false, 'Du'], [true, 'Sie']])),
        tog('emojis', 'Emojis benutzen'),
        field('Eigene Anweisungen', h('div', { class: 'col grow' }, instr, h('div', { class: 'row' }, persona, h('span', { class: 'muted small' }, 'gilt für jede Antwort'))))),
      section('🔐 Rechte',
        tog('allowWeb', 'Im Internet suchen und Webseiten lesen'),
        tog('allowImages', 'Bilder erzeugen'),
        tog('kidSafe', 'Kindermodus (einfache Sprache, vorsichtige Antworten, keine Server-Abfragen)'),
        h('label', { class: 'ai-tog' }, h('input', { type: 'checkbox', checked: aiAuto, onchange: (e) => { aiAuto = e.target.checked; lsSet('cl.aiAuto', aiAuto); } }), h('span', {}, 'Änderungen ohne Nachfrage ausführen (Mods, Module, Einstellungen, Design, Instanzen)'))),
      section('🎨 Aussehen & Stimme',
        field('Maskottchen', h('div', { class: 'seg' }, [['counti', 'Counti'], ['pixi', 'Pixi'], ['byte', 'Byte']].map(([k, l]) => h('button', { class: mascotKind() === k ? 'on' : '', onclick: () => { lsSet('cl.aiMascot', k); onClose(true, true); } }, l)))),
        field('Farbe', hue, h('button', { class: 'btn sm ghost', onclick: () => { hue.value = 0; set('hue', 0); } }, 'Standard')),
        field('Animationen', seg('anim', [['full', 'Voll'], ['calm', 'Ruhig'], ['off', 'Aus']])),
        tog('tts', 'Antworten automatisch vorlesen'),
        field('Stimme', voiceSel, h('button', { class: 'btn sm ghost', onclick: () => speakText(`Hi, ich bin ${aiName()}!`) }, 'Testen')),
        field('Tempo', rate),
        tog('enterSends', 'Enter sendet (sonst Strg+Enter)')),
      section('⌨ Eigene Befehle', h('p', { class: 'muted small' }, 'Kurzbefehle für Dinge, die du oft fragst – z. B. „bw“ → „Gib mir die besten Counter-Einstellungen für Bedwars“.'), cmdsBox),
      section('💾 Gedächtnis', h('p', { class: 'muted small' }, 'Das weiß der Assistent dauerhaft über dich – in jedem Chat. Er ergänzt es selbst, wenn du ihm etwas erzählst.'), memBox, memTools)));
}
/** mascot colour + animation level as CSS variables on the page */
function applyAiLook() {
  const pg = document.querySelector('.ai-page');
  if (!pg) return;
  pg.style.setProperty('--ai-hue', aiPrefs.hue + 'deg');
  pg.dataset.anim = aiPrefs.anim;
}

// ---------------------------------------------------------------- page
async function assistantPage(view) {
  view.classList.add('ai-page');
  if (!hasAnyAiKey() && !state.aiShared) return aiKeySetup(view);
  const inst = instById(state.selectedInstance) || sortInstances(state.instances)[0];
  if (window.aiPending && curChat().messages.length) {
    const c = newChat();
    aiChats.push(c);
    aiChatId = c.id;
  }
  const chat = curChat();
  aiChatId = chat.id;
  const log = h('div', { class: 'ai-log' });
  const input = h('textarea', { rows: 1, placeholder: 'Frag mich etwas, häng Logs/Bilder an … oder / für Befehle' });
  const fileInput = h('input', { type: 'file', multiple: true, style: 'display:none', accept: 'image/*,.txt,.log,.json,.json5,.toml,.cfg,.properties,.yml,.yaml,.ini,.md' });
  const attachRow = h('div', { class: 'ai-attach' });
  const drawAttach = () => attachRow.replaceChildren(...aiAttach.map((a, i) => h('span', { class: 'file-chip' }, a.kind === 'image' ? h('img', { src: a.data, alt: '' }) : '📄', a.name, h('button', { title: 'Entfernen', onclick: () => { aiAttach.splice(i, 1); drawAttach(); } }, '×'))));
  const addFiles = async (files) => {
    for (const f of files) {
      if (aiAttach.length >= 6) break;
      const a = await readAttachment(f);
      if (a) aiAttach.push(a);
    }
    drawAttach();
  };
  fileInput.addEventListener('change', () => { addFiles([...fileInput.files]); fileInput.value = ''; });

  const ctl = {
    send: (t) => send(t),
    isLast: (m) => chat.messages[chat.messages.length - 1] === m,
    questionOf: (m) => { const i = chat.messages.indexOf(m); const u = chat.messages.slice(0, i).reverse().find((x) => x.role === 'user'); return String((u && (u.shown || u.content)) || '').slice(0, 120); },
    retry: () => {
      while (chat.messages.length && chat.messages[chat.messages.length - 1].role === 'assistant') chat.messages.pop();
      if (chat.messages.length) ask();
    },
    edit: (m) => {
      const i = chat.messages.indexOf(m);
      if (i < 0 || aiBusy) return;
      input.value = m.shown || m.content;
      chat.messages.splice(i);
      saveChats();
      draw();
      input.focus();
    },
  };
  const draw = () => {
    log.replaceChildren(...(chat.messages.length ? chat.messages.map((m) => aiBubble(m, ctl)) : [h('div', { class: 'ai-empty' },
      h('div', { class: 'ai-av big' }, mascot(110)), h('h1', {}, `Hi, ich bin ${aiName()}!`), h('p', { style: 'margin:4px 0 0' }, 'Wie kann ich helfen?'),
      h('p', { class: 'muted' }, inst ? `Ich kenne Counter, den Launcher, suche live im Internet und auf Modrinth, lese deine Logs und baue Module, Packs und Designs – passend zu „${inst.name}“ (${loaderName(inst.loader)} ${inst.mcVersion}).` : 'Ich kenne Counter, den Launcher und Minecraft-Mods.'),
      h('div', { class: 'ai-chips' }, AI_SUGGEST.map((s) => h('button', { class: 'chip', onclick: () => send(s) }, s))))]),
    ...(aiBusy ? [h('div', { class: 'ai-msg bot' }, h('div', { class: 'ai-av' }, (() => { const m = mascot(30); m.dataset.thinking = '1'; return m; })()), thinkingBubble())] : []));
    log.scrollTop = log.scrollHeight;
    drawSide();
  };

  // sidebar with all chats
  const side = h('div', { class: 'ai-side' + (aiSideOpen ? '' : ' closed') });
  let sideQuery = '';
  const drawSide = () => {
    const q = sideQuery.toLowerCase();
    const list = aiChats.filter((c) => c.messages.length || c.id === chat.id)
      .filter((c) => !q || c.title.toLowerCase().includes(q) || c.messages.some((m) => String(m.shown || m.content || '').toLowerCase().includes(q)))
      .sort((a, b) => (b.pinned - a.pinned) || (b.updated - a.updated));
    side.replaceChildren(
      h('button', { class: 'btn sm primary', style: 'width:100%', onclick: () => switchChat(newChat()) }, '+ Neuer Chat'),
      h('input', { class: 'ai-side-q', placeholder: 'Chats durchsuchen …', value: sideQuery, oninput: (e) => { sideQuery = e.target.value; drawSide(); setTimeout(() => { const el = side.querySelector('.ai-side-q'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }); } }),
      h('div', { class: 'ai-side-list' }, list.map((c) => h('div', { class: 'ai-chat-item' + (c.id === chat.id ? ' on' : ''), onclick: () => c.id !== chat.id && switchChat(c) },
        h('span', { class: 'grow' }, c.pinned ? '📌 ' : '', c.title),
        h('button', { title: c.pinned ? 'Lösen' : 'Anheften', onclick: (e) => { e.stopPropagation(); c.pinned = !c.pinned; saveChats(); drawSide(); } }, c.pinned ? '◉' : '○'),
        h('button', { title: 'Umbenennen', onclick: (e) => { e.stopPropagation(); renameChat(c); } }, '✎'),
        h('button', { title: 'Löschen', onclick: (e) => { e.stopPropagation(); confirmModal(`Chat „${c.title}“ löschen?`, () => { aiChats = aiChats.filter((x) => x !== c); if (c.id === chat.id) switchChat(aiChats[0] || newChat()); else { saveChats(); drawSide(); } }, 'Löschen'); } }, '×')))));
  };
  function switchChat(c) {
    if (aiBusy) return toast('Warte kurz, bis die Antwort da ist', true);
    if (!aiChats.includes(c)) aiChats.push(c);
    aiChatId = c.id;
    saveChats();
    render();
  }
  function renameChat(c) {
    const inp = h('input', { value: c.title, style: 'width:100%' });
    modal(h('div', {}, h('h2', {}, 'Chat umbenennen'), inp, h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:14px' },
      h('button', { class: 'btn ghost', onclick: closeModal }, 'Abbrechen'),
      h('button', { class: 'btn primary', onclick: () => { c.title = inp.value.trim().slice(0, 60) || c.title; saveChats(); closeModal(); drawSide(); } }, 'Speichern'))));
    setTimeout(() => inp.select(), 30);
  }
  function exportChat() {
    const md = `# ${chat.title}\n\n` + chat.messages.map((m) => `**${m.role === 'user' ? 'Du' : aiName()}:**\n\n${m.shown || m.content}\n`).join('\n');
    const a = h('a', { href: 'data:text/markdown;charset=utf-8,' + encodeURIComponent(md), download: chat.title.replace(/[^\wäöüÄÖÜß -]/g, '').trim() + '.md' });
    document.body.append(a);
    a.click();
    a.remove();
  }

  const goalBar = h('div', { class: 'ai-goal' });
  const drawGoal = () => {
    goalBar.classList.toggle('hidden', !chat.goal);
    goalBar.replaceChildren(svg('M12 2a10 10 0 1 0 10 10M12 6a6 6 0 1 0 6 6M12 10a2 2 0 1 0 2 2M12 12l9-9'), h('b', {}, 'Ziel'), h('span', { class: 'grow' }, chat.goal || ''),
      h('button', { title: 'Ziel löschen', onclick: () => { chat.goal = ''; saveChats(); drawGoal(); } }, '×'));
  };
  const note = (text) => {
    chat.messages.push({ role: 'assistant', content: text, local: true });
    saveChats();
    draw();
  };
  /** slash commands: returns the text to send to the model, {text, file} to send with a file, or null when done here */
  async function command(text) {
    const [cmd, ...rest] = text.split(' ');
    const arg = rest.join(' ').trim();
    const own = (aiPrefs.customCmds || []).find((c) => c.cmd && '/' + c.cmd.toLowerCase() === cmd.toLowerCase());
    if (own) return own.prompt.includes('{text}') ? own.prompt.replace(/\{text\}/g, arg) : own.prompt + (arg ? `\n${arg}` : '');
    switch (cmd.toLowerCase()) {
      case '/help':
        note(allCommands().map(([c, a, d]) => `**${c}** ${a} – ${d}`).join('\n\n'));
        return null;
      case '/clear':
        chat.messages = [];
        saveChats();
        draw();
        return null;
      case '/new':
        switchChat(newChat());
        return null;
      case '/studio':
        openStudio();
        return null;
      case '/skills':
        openSkills();
        return null;
      case '/check':
        return 'Prüf meine Instanz mit check_instance und erklär mir jedes Problem mit der Lösung.';
      case '/modpack':
        return `Bau mir ein Modpack: ${arg || 'frag mich nach Thema und Version'}. Such die Mods mit search_mods, prüf Abhängigkeiten mit mod_details und leg es mit build_modpack an.`;
      case '/updates':
        return 'Gib mir eine kurze Wochenübersicht mit update_overview: welche Updates sind wichtig und was ändert sich?';
      case '/export':
        exportChat();
        return null;
      case '/goal':
        chat.goal = arg;
        saveChats();
        drawGoal();
        if (!arg) {
          note('Ziel gelöscht.');
          return null;
        }
        return `Mein Ziel: ${arg}. Wie gehen wir das an? Schlag die ersten Schritte vor und frag nach, was du noch wissen musst.`;
      case '/think': {
        const lvl = THINK_LEVELS.find(([k, l]) => k === arg.toLowerCase() || l.toLowerCase() === arg.toLowerCase());
        if (!lvl) {
          note(`Denkstufen: ${THINK_LEVELS.map(([k, l, d]) => `**${k}** (${l}) – ${d}`).join('\n\n')}`);
          return null;
        }
        aiPrefs.think = lvl[0];
        savePrefs();
        note(`Denkstufe: **${lvl[1]}** – ${lvl[2]}`);
        drawHead();
        return null;
      }
      case '/remember':
        if (!arg) {
          note('Was soll ich mir merken? z. B. `/remember ich spiele am liebsten Bedwars`');
          return null;
        }
        await call(api.aiMemorySet, [...(await call(api.aiMemory)), arg]);
        note(`🧠 Gemerkt: ${arg}`);
        return null;
      case '/memory': {
        const mem = await call(api.aiMemory).catch(() => []);
        note(mem.length ? `**Das weiß ich über dich:**\n\n${mem.map((m, i) => `${i + 1}. ${m}`).join('\n')}\n\nBearbeiten im KI-Studio (/studio).` : 'Ich habe mir noch nichts gemerkt.');
        return null;
      }
      case '/auto':
        aiAuto = /^(on|an|ja|1)$/i.test(arg);
        lsSet('cl.aiAuto', aiAuto);
        drawHead();
        note(aiAuto ? 'Ich darf Änderungen jetzt direkt ausführen.' : 'Ich frage vor jeder Änderung nach.');
        return null;
      case '/model': {
        const v = /^(auto)?$/i.test(arg) ? '' : arg;
        await call(api.setSettings, { groqModel: v });
        state.settings.groqModel = v;
        modelSel.value = v;
        note(v ? `Modell: ${v}` : 'Modell: automatisch das beste');
        return null;
      }
      case '/instance': {
        const found = arg && state.instances.find((i) => i.name.toLowerCase().includes(arg.toLowerCase()));
        if (!found) {
          note(`Keine Instanz „${arg}“ gefunden. Deine Instanzen: ${state.instances.map((i) => i.name).join(', ')}`);
          return null;
        }
        state.selectedInstance = found.id;
        await call(api.selectInstance, found.id);
        render();
        return null;
      }
      case '/image':
        if (!arg) {
          note('Beschreib das Bild, z. B. `/image ein Drache über einer Minecraft-Burg bei Sonnenuntergang`');
          return null;
        }
        return `Erzeuge bitte ein Bild: ${arg}`;
      case '/search':
        if (!arg) {
          note('Was soll ich suchen? z. B. `/search neueste Sodium Version`');
          return null;
        }
        return `Suche im Internet: ${arg}`;
      case '/mods':
        return 'Zeig mir die Mods meiner Instanz (list_instance_mods), prüf ob etwas fehlt, doppelt ist oder nicht zusammenpasst (mod_details für Abhängigkeiten), und schlag Verbesserungen vor.';
      case '/fps':
        return 'Optimiere meine ausgewählte Instanz auf maximale FPS: schau dir die Mods an, lies options.txt, schlag passende Performance-Mods (search_mods) und bessere Einstellungen vor. Erklär kurz warum.';
      case '/module':
        return `Bau mir ein eigenes Counter-Modul: ${arg || 'frag mich, was es können soll'}`;
      case '/pack':
        return `Bau mir ein Ressourcenpaket: ${arg || 'frag mich nach Stil und Inhalt'}`;
      case '/design':
        return `Ändere das Launcher-Design: ${arg || 'schlag mir 3 Stile vor und frag, welcher'}`;
      case '/crash': {
        if (!inst) {
          note('Keine Instanz ausgewählt.');
          return null;
        }
        const logs = await call(api.logs, inst.id).catch(() => []);
        const pick = logs.find((l) => l.crash) || logs[0];
        if (!pick) {
          note('Keine Logs gefunden – starte das Spiel einmal.');
          return null;
        }
        let body = await call(api.readLog, pick.path).catch(() => '');
        body = Array.isArray(body) ? body.join('\n') : String(body || '');
        if (body.length > 24000) body = body.slice(0, 4000) + '\n…\n' + body.slice(-20000);
        return { text: `Analysiere ${pick.crash ? 'diesen Crash-Report' : 'dieses Log'} (${pick.name}) und sag mir, was kaputt ist und wie ich es behebe. Wenn eine Mod schuld ist, schlag vor sie zu entfernen oder zu aktualisieren.`, file: { name: pick.name, data: body } };
      }
      default:
        note(`Unbekannter Befehl ${cmd} – /help zeigt alle.`);
        return null;
    }
  }
  async function send(text) {
    text = (text || input.value).trim();
    if ((!text && !aiAttach.length) || aiBusy) return;
    hideCmds();
    if (text.startsWith('/')) {
      input.value = '';
      const r = await command(text);
      if (r == null) return;
      if (typeof r === 'object') {
        aiAttach.push({ kind: 'text', name: r.file.name, data: r.file.data });
        text = r.text;
      } else text = r;
    }
    const att = aiAttach;
    aiAttach = [];
    drawAttach();
    input.value = '';
    input.style.height = '';
    const texts = att.filter((a) => a.kind === 'text');
    const msg = {
      role: 'user',
      shown: text,
      content: (text || 'Schau dir das an.') + texts.map((a) => `\n\nDatei ${a.name}:\n\`\`\`\n${a.data}\n\`\`\``).join(''),
      files: texts.map((a) => a.name),
      images: att.filter((a) => a.kind === 'image').map((a) => a.data),
    };
    if (!msg.images.length) delete msg.images;
    if (!chat.messages.some((m) => m.role === 'user')) chat.title = (text || 'Datei-Analyse').slice(0, 48);
    chat.messages.push(msg);
    bumpStat('ai');
    await ask();
  }
  async function ask() {
    aiBusy = true;
    chat.updated = Date.now();
    draw();
    mascotsDo('hop');
    const t0 = Date.now();
    const prefs = { ...aiPrefs, persona: mascotPersona(), name: aiName() };
    delete prefs.customCmds;
    try {
      const history = chat.messages.filter((m) => !m.error && !m.local).map((m) => ({ role: m.role, content: m.content, images: m.images }));
      const r = await call(api.aiAsk, history, inst && inst.id, aiAuto, chat.goal, prefs);
      const reply = {
        role: 'assistant',
        content: r.text || (r.mods.length ? 'Das habe ich gefunden:' : r.images.length ? 'Bitte schön:' : r.actions.length ? 'Das würde ich ändern:' : '…'),
        mods: r.mods.slice(0, 6), images: r.images, ask: r.ask, actions: r.actions, applied: r.applied, model: r.model, searched: r.searched,
        thoughts: r.thoughts, steps: r.steps, reviewed: r.reviewed, effort: r.effort, remembered: r.remembered, secs: Math.round((Date.now() - t0) / 1000), plan: r.plan, canContinue: r.canContinue, level: r.level,
      };
      chat.messages.push(reply);
      if (aiPrefs.tts && reply.content) speakText(reply.content);
      if (r.applied.length) {
        setTimeout(celebrate, 300);
        await refresh();
        toast(`${r.applied.length} Änderung(en) ausgeführt`);
      }
    } catch (e) {
      if (e.message === 'NO_KEY') return render();
      const lastQ = String((chat.messages.filter((m) => m.role === 'user').pop() || {}).content || '');
      const fallback = offlineAnswer(lastQ);
      chat.messages.push(fallback ? { role: 'assistant', content: fallback + '\n\n(' + e.message + ')', local: true } : { role: 'assistant', content: e.message, error: true });
    } finally {
      aiBusy = false;
      aiStatusLabel = null;
      saveChats();
      if (log.isConnected) draw();
    }
  }
  const cmdBox = h('div', { class: 'ai-cmds hidden' });
  let cmdSel = 0;
  let cmdList = [];
  function hideCmds() {
    cmdBox.classList.add('hidden');
    cmdList = [];
  }
  function showCmds() {
    const v = input.value;
    if (!v.startsWith('/') || v.includes(' ')) return hideCmds();
    cmdList = allCommands().filter(([c]) => c.startsWith(v.toLowerCase()));
    if (!cmdList.length) return hideCmds();
    cmdSel = Math.min(cmdSel, cmdList.length - 1);
    cmdBox.classList.remove('hidden');
    cmdBox.replaceChildren(...cmdList.map(([c, a, d], i) => h('button', { class: 'ai-cmd' + (i === cmdSel ? ' on' : ''), onmousedown: (e) => { e.preventDefault(); pickCmd(i); } },
      h('b', {}, c), h('span', { class: 'arg' }, a), h('span', { class: 'grow muted' }, d))));
    const on = cmdBox.querySelector('.on');
    if (on) on.scrollIntoView({ block: 'nearest' });
  }
  function pickCmd(i) {
    const [c, a] = cmdList[i];
    input.value = c + (a ? ' ' : '');
    hideCmds();
    input.focus();
    if (!a) send();
  }
  input.addEventListener('keydown', (e) => {
    if (cmdList.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); cmdSel = (cmdSel + 1) % cmdList.length; showCmds(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); cmdSel = (cmdSel - 1 + cmdList.length) % cmdList.length; showCmds(); return; }
      if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); pickCmd(cmdSel); return; }
      if (e.key === 'Escape') { hideCmds(); return; }
    }
    if (e.key === 'Enter' && (aiPrefs.enterSends ? !e.shiftKey : e.ctrlKey)) {
      e.preventDefault();
      send();
    }
    // arrow up in an empty box: edit the last own message
    if (e.key === 'ArrowUp' && !input.value) {
      const last = [...chat.messages].reverse().find((m) => m.role === 'user');
      if (last) {
        e.preventDefault();
        ctl.edit(last);
      }
    }
  });
  input.addEventListener('input', () => {
    showCmds();
    input.style.height = '';
    input.style.height = Math.min(160, input.scrollHeight) + 'px';
  });
  input.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  });
  // drop files onto the chat (the global drop handler is for instance content, so stop it here)
  view.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); view.classList.add('drop'); }, true);
  view.addEventListener('dragleave', () => view.classList.remove('drop'));
  view.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); view.classList.remove('drop'); addFiles([...e.dataTransfer.files]); }, true);

  const modelSel = h('select', { class: 'ai-model', title: 'Modell', onchange: (e) => { call(api.setSettings, { groqModel: e.target.value }); state.settings.groqModel = e.target.value; } }, h('option', { value: '' }, 'Bestes Modell (automatisch)'));
  call(api.aiModels).then((m) => {
    for (const id of m.ids) modelSel.append(h('option', { value: id }, id + ((m.reasoning || []).includes(id) ? ' · denkt' : '')));
    modelSel.value = state.settings.groqModel || '';
  }).catch(() => {});

  const skillsHost = h('div', { class: 'ai-studio-host hidden' });
  function openSkills() {
    skillsHost.classList.remove('hidden');
    skillsHost.replaceChildren(skillsPanel((t) => send(t), () => { skillsHost.classList.add('hidden'); skillsHost.replaceChildren(); }));
  }
  const studioHost = h('div', { class: 'ai-studio-host hidden' });
  function openStudio() {
    studioHost.classList.remove('hidden');
    studioHost.replaceChildren(aiStudio((rerender, full) => {
      studioHost.classList.add('hidden');
      studioHost.replaceChildren();
      if (full || rerender) render();
      else {
        drawHead();
        draw();
      }
    }));
  }
  const head = h('div', { class: 'row ai-head' });
  function drawHead() {
    head.replaceChildren(
      h('button', { class: 'btn sm ghost ai-side-btn', title: 'Chats ein/aus', onclick: () => { aiSideOpen = !aiSideOpen; lsSet('cl.aiSide', aiSideOpen); side.classList.toggle('closed', !aiSideOpen); } }, '☰'),
      h('div', { class: 'ai-av head' }, mascot(42)),
      h('div', { class: 'grow' }, h('h1', {}, aiName()), h('p', { class: 'sub' }, `${chat.title} · ${inst ? inst.name : 'keine Instanz'}`)),
      h('div', { class: 'seg', title: 'Denkstufe' }, THINK_LEVELS.map(([k, l, d]) => h('button', { class: aiPrefs.think === k ? 'on' : '', title: d, onclick: () => { aiPrefs.think = k; savePrefs(); drawHead(); } }, l))),
      h('button', { class: 'perm' + (aiAuto ? ' on' : ''), title: 'Darf der Assistent Änderungen ohne Nachfrage ausführen?', onclick: () => {
        aiAuto = !aiAuto;
        lsSet('cl.aiAuto', aiAuto);
        if (aiAuto) toast('Der Assistent darf Änderungen jetzt direkt ausführen');
        drawHead();
      } }, h('i'), h('span', {}, aiAuto ? 'Ändern: automatisch' : 'Ändern: nachfragen')),
      modelSel,
      h('button', { class: 'btn sm ghost', title: 'Chat als Markdown speichern', onclick: exportChat }, '⤓'),
      h('button', { class: 'btn sm', title: 'Fertige Aufgaben als Knöpfe', onclick: openSkills }, '✨ Fähigkeiten'),
      h('button', { class: 'btn sm', title: 'KI-Studio: alle Einstellungen', onclick: openStudio }, svg(I.settings || 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'), 'KI-Studio'),
      '');
  }
  drawHead();

  view.append(
    head,
    goalBar,
    h('div', { class: 'ai-body' }, side, h('div', { class: 'ai-main' }, log,
      h('div', { class: 'ai-input panel' }, cmdBox, attachRow,
        h('div', { class: 'ai-input-row' },
          h('button', { class: 'btn ghost ai-clip', title: 'Datei oder Bild anhängen (auch per Drag & Drop oder Einfügen)', onclick: () => fileInput.click() }, svg('M21 11l-8.5 8.5a5 5 0 0 1-7-7L14 4a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4L15.5 7')),
          input,
          h('button', { class: 'btn ghost ai-clip', title: 'Diktieren (Spracheingabe)', onclick: (e) => dictate(e.currentTarget) }, '🎙'),
          h('button', { class: 'btn primary', onclick: () => send() }, svg('M4 12l16-8-6 16-3-6z'), 'Senden')))),
      studioHost, skillsHost),
    fileInput);
  /** speech input via the Chromium speech API (works when the system offers it) */
  function dictate(btn) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return toast('Spracheingabe gibt es hier nicht', true);
    const r = new SR();
    r.lang = aiPrefs.language === 'en' ? 'en-US' : 'de-DE';
    r.interimResults = true;
    btn.classList.add('rec');
    r.onresult = (ev) => {
      input.value = [...ev.results].map((x) => x[0].transcript).join(' ');
    };
    r.onerror = () => toast('Spracheingabe ging nicht', true);
    r.onend = () => btn.classList.remove('rec');
    r.start();
  }
  applyAiLook();
  draw();
  drawAttach();
  drawGoal();
  setTimeout(() => input.focus(), 50);
  if (window.aiPending) {
    const pending = window.aiPending;
    window.aiPending = null;
    setTimeout(() => send(pending.text), 200);
  }
}
api.on('theme:changed', () => refresh().then(() => route.page === 'settings' && render()));
