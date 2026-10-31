// What the assistant may build or change, always validated here: custom Counter modules (JSON the Counter mod
// interprets – show info and harmless client actions only), Counter settings of an instance, generated resource packs
// and the launcher design. A content filter blocks inappropriate text and image prompts.
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { nativeImage } = require('electron');
const store = require('./store');

const DOCS = JSON.parse(fs.readFileSync(path.join(__dirname, 'counter-docs.json'), 'utf8'));

// ---------------------------------------------------------------- content filter

const BLOCK = [
  /\b(porn|nsfw|nude|naked|nackt|sex|sexy|hentai|boobs?|titten|penis|vagina|genital|erotic|erotik|onlyfans)\b/i,
  /\b(hitler|nazi|swastika|hakenkreuz|kkk|isis|terror(ist)?|genocide|völkermord)\b/i,
  /\b(gore|beheading|enthauptung|suicide|selbstmord|self[- ]?harm|ritzen)\b/i,
  /\b(n[i1]gg(a|er)|neger|f[a@]gg?ot|schwuchtel|kanake|retard|spast)\b/i,
  /\b(kys|kill yourself|bring dich um)\b/i,
];
function check(...texts) {
  for (const t of texts) {
    if (t && BLOCK.some((r) => r.test(String(t)))) throw new Error('Das ist durch den Inhaltsfilter blockiert.');
  }
}

// ---------------------------------------------------------------- Counter knowledge (names and settings, no code)

function docs(query) {
  const words = String(query || '').toLowerCase().split(/\W+/).filter((w) => w.length > 1);
  const score = (id, m) => words.reduce((s, w) => s + (id.includes(w) ? 3 : 0) + (m.name.toLowerCase().includes(w) ? 3 : 0) + (m.desc.toLowerCase().includes(w) ? 1 : 0)
    + Object.keys(m.settings).filter((k) => k.toLowerCase().includes(w)).length, 0);
  const hits = Object.entries(DOCS.modules).map(([id, m]) => [score(id, m), id, m]).filter((x) => x[0] > 0).sort((a, b) => b[0] - a[0]).slice(0, 4);
  if (/theme|design|farbe|color|glas|menü|menu|hintergrund/.test(words.join(' ')) && !hits.length) return JSON.stringify({ theme: DOCS.theme }).slice(0, 6000);
  if (!hits.length) return 'Nichts gefunden. Module: ' + Object.keys(DOCS.modules).join(', ');
  return hits.map(([, id, m]) => `${id} – ${m.name}: ${m.desc}\nEinstellungen: ${Object.entries(m.settings).map(([k, v]) => `${k}=${JSON.stringify(v.example)}${v.label ? ' (' + v.label + ')' : ''}`).join(', ')}`).join('\n\n');
}

// ---------------------------------------------------------------- custom modules

const slug = (s) => String(s || 'modul').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'modul';
const ACTIONS = ['chat', 'command', 'title', 'actionbar', 'sound', 'toggle_module'];
/** vanilla options a module may set (exact names; value type and range) */
const OPTIONS = {
  fov: ['int', 30, 110], gamma: ['num', 0, 1], sensitivity: ['num', 0, 1], renderDistance: ['int', 2, 32], simulationDistance: ['int', 5, 32],
  entityDistanceScaling: ['num', 0.5, 5], framerateLimit: ['int', 10, 260], guiScale: ['int', 0, 6], chatOpacity: ['num', 0, 1], chatScale: ['num', 0, 1],
  chatWidth: ['num', 0, 1], chatHeightFocused: ['num', 0, 1], chatHeightUnfocused: ['num', 0, 1], chatLineSpacing: ['num', 0, 1], chatDelay: ['num', 0, 6],
  textBackgroundOpacity: ['num', 0, 1], backgroundForChatOnly: ['bool'], chatColors: ['bool'], chatLinks: ['bool'], autoSuggestions: ['bool'], showSubtitles: ['bool'],
  bobView: ['bool'], autoJump: ['bool'], toggleSprint: ['bool'], toggleCrouch: ['bool'], toggleAttack: ['bool'], toggleUse: ['bool'], sprintWindow: ['int', 0, 10],
  entityShadows: ['bool'], vignette: ['bool'], ambientOcclusion: ['bool'], biomeBlendRadius: ['int', 0, 7], cloudRange: ['int', 2, 128], weatherRadius: ['int', 3, 10],
  screenEffectScale: ['num', 0, 1], fovEffectScale: ['num', 0, 1], darknessEffectScale: ['num', 0, 1], damageTiltStrength: ['num', 0, 1], glintSpeed: ['num', 0, 1],
  glintStrength: ['num', 0, 1], mouseWheelSensitivity: ['num', 0.01, 10], reducedDebugInfo: ['bool'], hideLightningFlash: ['bool'], highContrastBlockOutline: ['bool'],
  menuBackgroundBlurriness: ['int', 0, 10], invertMouseX: ['bool'], invertMouseY: ['bool'], directionalAudio: ['bool'], notificationDisplayTime: ['num', 0.5, 10],
  showAutosaveIndicator: ['bool'], rotateWithMinecart: ['bool'], mipmapLevels: ['int', 0, 4],
};
const WHEN = ['health_below', 'food_below', 'armor_below', 'join', 'interval'];
/** everything Counter needs for a user module; unknown fields are dropped */
function cleanModule(spec) {
  const s = typeof spec === 'string' ? JSON.parse(spec) : spec || {};
  // unknown parts are reported (not silently dropped), so the assistant can correct its spec
  const acts = (list) => (Array.isArray(list) ? list : []).slice(0, 6).map((a) => {
    if (!ACTIONS.includes(a && a.action)) throw new Error(`Aktion „${a && a.action}“ gibt es nicht. Erlaubt: ${ACTIONS.join(', ')}`);
    if (a.action === 'toggle_module' && !DOCS.modules[a.id]) throw new Error(`Counter-Modul „${a.id}“ gibt es nicht – die echte ID mit counter_docs nachschlagen.`);
    const text = String(a.text || '').slice(0, 200);
    check(text);
    if (a.action === 'command' && /^\/?(op|deop|ban|kick|stop|whitelist|pardon|kill @a|give|gamemode)\b/i.test(text)) throw new Error(`Befehl „${text}“ ist für eigene Module nicht erlaubt.`);
    return { action: a.action, text, id: String(a.id || '').slice(0, 80) };
  });
  const out = { name: String(s.name || 'Mein Modul').slice(0, 40), description: String(s.description || '').slice(0, 200), enabled: s.enabled !== false };
  check(out.name, out.description);
  // the model sometimes writes the HUD a bit differently: text at the top, hud as string, lines array, named position
  let hud = s.hud;
  if (typeof hud === 'string') hud = { text: hud };
  if (Array.isArray(hud)) hud = hud.length ? { ...hud[0], text: hud.map((x) => (typeof x === 'string' ? x : x.text)).filter(Boolean).join('\n') } : null;
  if (!hud && (s.text || s.lines)) hud = { text: s.text, lines: s.lines, position: s.position, color: s.color };
  if (hud && !hud.text && Array.isArray(hud.lines)) hud.text = hud.lines.join('\n');
  if (hud && Array.isArray(hud.text)) hud.text = hud.text.join('\n');
  if (hud && typeof hud.position === 'string' && hud.x == null) {
    const p = hud.position.toLowerCase();
    hud.x = /right|rechts/.test(p) ? 0.98 : /center|mitte/.test(p) && !/top|bottom|oben|unten/.test(p) ? 0.5 : /center|mitte/.test(p) ? 0.5 : 0.02;
    hud.y = /bottom|unten/.test(p) ? 0.98 : /top|oben/.test(p) ? 0.02 : 0.5;
  }
  s.hud = hud;
  if (s.hud && s.hud.text) {
    check(s.hud.text);
    out.hud = { text: String(s.hud.text).slice(0, 400), x: Number(s.hud.x ?? 0.02), y: Number(s.hud.y ?? 0.3), scale: Number(s.hud.scale ?? 1), color: /^#?[0-9a-f]{6,8}$/i.test(s.hud.color || '') ? s.hud.color : '#FFFFFF', background: s.hud.background !== false };
  }
  for (const t of Array.isArray(s.triggers) ? s.triggers : []) if (!WHEN.includes(t && t.when)) throw new Error(`Trigger „${t && t.when}“ gibt es nicht. Erlaubt: ${WHEN.join(', ')}`);
  const KEY = /^[a-z0-9]$|^f([1-9]|1[0-2])$|^(left|right)\.?(alt|control|shift)$|^(up|down|left|right|tab|space|enter|backspace|insert|home|end|page\.up|page\.down|delete)$/i;
  for (const k of Array.isArray(s.keys) ? s.keys : []) if (!KEY.test(String((k && k.key) || ''))) throw new Error(`Taste „${k && k.key}“ geht nicht. Erlaubt: einzelne Buchstaben/Ziffern, f1-f12, left.alt, right.shift, up, tab, space … (keine Kombinationen)`);
  if ((s.triggers || []).length > 6 || (s.keys || []).length > 6) throw new Error('Maximal 6 Trigger und 6 Tasten pro Modul');
  out.triggers = (Array.isArray(s.triggers) ? s.triggers : []).slice(0, 6).map((t) => {
    const talks = acts(t.do).some((a) => a.action === 'chat' || a.action === 'command');
    const value = Number(t.value ?? 0);
    return { when: t.when, value: t.when === 'interval' && talks ? Math.max(30, value) : value, cooldown: Math.max(1, Number(t.cooldown ?? 5)), do: acts(t.do) };
  });
  out.keys = (Array.isArray(s.keys) ? s.keys : []).slice(0, 6).map((k) => ({ key: String(k.key).toLowerCase(), do: acts(k.do) }));
  // features: built-in Counter modules this module switches on (with settings) while it is on – this is what really changes the game
  out.features = [];
  for (const f of Array.isArray(s.features) ? s.features : []) {
    const id = String((f && (f.module || f.id)) || '');
    const doc = DOCS.modules[id];
    if (!doc) throw new Error(`feature: Counter-Modul „${id}“ gibt es nicht – die echte ID mit counter_docs nachschlagen.`);
    const settings = {};
    for (const [k, v] of Object.entries((f && f.settings) || {})) {
      if (!doc.settings[k]) throw new Error(`feature ${id}: Einstellung „${k}“ gibt es nicht. Vorhanden: ${Object.keys(doc.settings).join(', ')}`);
      const ex = doc.settings[k].example;
      if (typeof ex !== typeof v) throw new Error(`feature ${id}.${k}: Wert muss vom Typ ${typeof ex} sein (z. B. ${JSON.stringify(ex)}), nicht ${typeof v}.`);
      if (typeof v === 'string' && /^#/.test(ex) && !/^#[0-9a-f]{6,8}$/i.test(v)) throw new Error(`feature ${id}.${k}: Farbe als "#AARRGGBB" oder "#RRGGBB" schreiben.`);
      settings[k] = v;
    }
    out.features.push({ module: id, settings });
  }
  if (out.features.length > 8) throw new Error('Maximal 8 features pro Modul');
  // options: vanilla game options set while the module is on (restored when it is switched off)
  out.options = {};
  for (const [k, v] of Object.entries(s.options || {})) {
    const def = OPTIONS[k];
    if (!def) throw new Error(`option „${k}“ gibt es nicht. Erlaubt: ${Object.keys(OPTIONS).join(', ')}`);
    if (def[0] === 'bool') { if (typeof v !== 'boolean') throw new Error(`option ${k} braucht true/false`); out.options[k] = v; continue; }
    const n = Number(v);
    if (!Number.isFinite(n) || n < def[1] || n > def[2]) throw new Error(`option ${k} muss eine Zahl zwischen ${def[1]} und ${def[2]} sein`);
    out.options[k] = def[0] === 'int' ? Math.round(n) : n;
  }
  if (!out.hud && !out.triggers.length && !out.keys.length && !out.features.length && !Object.keys(out.options).length) throw new Error('Das Modul braucht hud, triggers, keys, features oder options.');
  return out;
}
function createModule(inst, spec) {
  const mod = cleanModule(spec);
  const dir = path.join(store.dirs.instance(inst.id), 'config', 'counter', 'custom');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, slug(mod.name) + '.json');
  fs.writeFileSync(file, JSON.stringify(mod, null, 2));
  return path.basename(file);
}
function listModules(inst) {
  const dir = path.join(store.dirs.instance(inst.id), 'config', 'counter', 'custom');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
    try {
      return { file: f, ...JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) };
    } catch {
      return { file: f, broken: true };
    }
  });
}

// ---------------------------------------------------------------- Counter settings of an instance

function counterConfig(inst, changes, running) {
  if (running) throw new Error('Die Instanz läuft gerade – Counter-Einstellungen bitte nach dem Schließen ändern (sonst überschreibt das Spiel sie).');
  const file = path.join(store.dirs.instance(inst.id), 'config', 'counter.json');
  const cfg = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { modules: {}, theme: {} };
  const done = applyConfig(cfg, changes);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak');
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  return done;
}

/** checks the changes without writing anything (throws with a helpful message, so the assistant can correct itself) */
function counterConfigCheck(changes) {
  return applyConfig({ modules: {}, theme: {} }, changes);
}

function applyConfig(cfg, changes) {
  cfg.modules ||= {};
  cfg.theme ||= {};
  const done = [];
  for (const c of (Array.isArray(changes) ? changes : []).slice(0, 30)) {
    if (c.module) {
      if (!DOCS.modules[c.module]) throw new Error(`Modul ${c.module} gibt es nicht`);
      const m = (cfg.modules[c.module] ||= { enabled: !!DOCS.modules[c.module].enabledByDefault, settings: {} });
      m.settings ||= {};
      if (typeof c.enabled === 'boolean') {
        m.enabled = c.enabled;
        done.push(`${c.module} ${c.enabled ? 'an' : 'aus'}`);
      }
      if (c.setting) {
        const known = DOCS.modules[c.module].settings[c.setting];
        if (!known) throw new Error(`Einstellung ${c.setting} gibt es bei ${c.module} nicht. Vorhanden: ${Object.keys(DOCS.modules[c.module].settings).join(', ')}`);
        const isColor = typeof known.example === 'string' && /^#[0-9A-F]{8}$/i.test(known.example);
        if (!isColor && typeof known.example !== typeof c.value) throw new Error(`${c.module}.${c.setting} braucht einen Wert vom Typ ${typeof known.example} (Beispiel ${JSON.stringify(known.example)}), nicht ${JSON.stringify(c.value)}`);
        if (isColor && !/^#[0-9A-F]{6,8}$/i.test(String(c.value))) throw new Error(`${c.module}.${c.setting} braucht eine Farbe wie #FF9D5CFF`);
        m.settings[c.setting] = typeof known.example === 'string' && /^#[0-9A-F]{8}$/i.test(known.example) ? { argb: String(c.value), chroma: false } : c.value;
        done.push(`${c.module}.${c.setting} = ${JSON.stringify(c.value)}`);
      }
      if (c.reset) {
        delete cfg.modules[c.module];
        done.push(`${c.module} zurückgesetzt`);
      }
    } else if (c.theme) {
      if (!(c.theme in DOCS.theme)) throw new Error(`Design-Einstellung ${c.theme} gibt es nicht`);
      cfg.theme[c.theme] = typeof DOCS.theme[c.theme] === 'string' && /^#[0-9A-F]{8}$/i.test(DOCS.theme[c.theme]) ? { argb: String(c.value), chroma: false } : c.value;
      done.push(`Design ${c.theme} = ${JSON.stringify(c.value)}`);
    }
  }
  if (!done.length) throw new Error('Keine gültige Änderung – Format mit get_format("config") holen');
  return done;
}

// ---------------------------------------------------------------- resource packs

function imageUrl(prompt, w = 1024, hgt = 1024) {
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 900))}?width=${w}&height=${hgt}&seed=${Math.floor(Math.random() * 1e9)}&nologo=true&safe=true&model=flux`;
}
async function resourcePack(inst, spec, onStatus) {
  const s = spec || {};
  const name = String(s.name || 'KI Pack').slice(0, 40);
  check(name, s.description, ...(s.splashes || []), ...Object.values(s.lang || {}), ...(s.textures || []).map((t) => t.prompt));
  const zip = new AdmZip();
  zip.addFile('pack.mcmeta', Buffer.from(JSON.stringify({ pack: { description: String(s.description || 'Erstellt vom Counter Assistenten').slice(0, 120), pack_format: 64, supported_formats: { min_inclusive: 1, max_inclusive: 999 }, min_format: 1, max_format: 999 } }, null, 2)));
  const textures = (Array.isArray(s.textures) ? s.textures : []).slice(0, 12);
  let n = 0;
  for (const t of textures) {
    const target = String(t.path || '').replace(/^minecraft:/, '').replace(/\.png$/, '');
    if (!/^(block|item|entity\/[a-z0-9_/]+|painting|particle|gui\/title)\/?[a-z0-9_]*$/.test(target)) continue;
    onStatus(`Textur ${++n}/${textures.length}: ${target}`);
    const res = await fetch(imageUrl(`${t.prompt}, minecraft texture, pixel art, flat, seamless tile, no text, no border`, 512, 512));
    if (!res.ok) continue;
    const img = nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer()));
    if (img.isEmpty()) continue;
    const size = Math.min(64, Math.max(16, Number(t.size) || 16));
    zip.addFile(`assets/minecraft/textures/${target}.png`, img.resize({ width: size, height: size, quality: 'good' }).toPNG());
  }
  if (Array.isArray(s.splashes) && s.splashes.length) zip.addFile('assets/minecraft/texts/splashes.txt', Buffer.from(s.splashes.slice(0, 100).map((x) => String(x).slice(0, 80)).join('\n')));
  if (s.lang && typeof s.lang === 'object') {
    const entries = Object.fromEntries(Object.entries(s.lang).slice(0, 200).filter(([k]) => /^[a-z0-9_.]+$/.test(k)).map(([k, v]) => [k, String(v).slice(0, 200)]));
    for (const l of ['en_us', 'de_de']) zip.addFile(`assets/minecraft/lang/${l}.json`, Buffer.from(JSON.stringify(entries, null, 2)));
  }
  if (s.icon) {
    const res = await fetch(imageUrl(`${s.icon}, minecraft style icon, pixel art`, 256, 256)).catch(() => null);
    if (res && res.ok) zip.addFile('pack.png', nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer())).resize({ width: 128, height: 128 }).toPNG());
  }
  const dir = path.join(store.dirs.instance(inst.id), 'resourcepacks');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, slug(name) + '.zip');
  zip.writeZip(file);
  return path.basename(file);
}

// ---------------------------------------------------------------- launcher design

const DESIGN = {
  accent: 'color', accent2: 'color', solid: 'color',
  bg: ['sky', 'campfire', 'aurora', 'storm', 'end', 'ocean', 'sunset', 'gradient', 'solid', 'image', 'video'],
  layout: ['console', 'classic'], style: ['clean', 'glass', 'flat', 'outline'], skinAnim: ['idle', 'walk', 'run', 'wave', 'fly', 'none'],
  launchStyle: ['gradient', 'solid', 'outline'], cubeColor: ['accent', 'accent2', 'white'], font2: ['system', 'rounded', 'mono', 'serif', 'pixel'],
  glass: [5, 95], blur: [0, 60], radius: [0, 28], font: [11, 17], light: [0, 200], cubeCount: [4, 40], skinSize: [60, 140], gradAngle: [0, 360],
  cubes: 'bool', land: 'bool', stars: 'bool', pixelHeads: 'bool', newsCol: 'bool', serverBox: 'bool', railIcons: 'bool', skinRotate: 'bool', motion: 'bool', compact: 'bool',
  customCss: 'css',
};
function launcherDesign(patch) {
  const theme = { ...(store.get().settings.theme || {}) };
  const out = {};
  let accent;
  for (const [k, v] of Object.entries(patch || {})) {
    const rule = DESIGN[k];
    if (!rule) continue;
    if (rule === 'color') {
      if (!/^#[0-9a-f]{6}$/i.test(v)) continue;
      if (k === 'accent') accent = v;
      else out[k] = v;
    } else if (rule === 'bool') out[k] = !!v;
    else if (rule === 'css') {
      const css = String(v).slice(0, 8000);
      if (/@import|javascript:|expression\(/i.test(css)) throw new Error('Dieses CSS ist nicht erlaubt.');
      out[k] = css;
    } else if (Array.isArray(rule) && typeof rule[0] === 'number') out[k] = Math.max(rule[0], Math.min(rule[1], Number(v) || rule[0]));
    else if (Array.isArray(rule) && rule.includes(v)) out[k] = v;
  }
  store.get().settings.theme = { ...theme, ...out };
  if (accent) store.get().settings.accent = accent;
  store.save();
  return Object.keys(out).concat(accent ? ['accent'] : []);
}

/** path of an own module file (plain names only) */
function moduleFile(inst, file) {
  if (path.basename(file) !== file || !file.endsWith('.json')) throw new Error('Ungültiger Dateiname');
  return path.join(store.dirs.instance(inst.id), 'config', 'counter', 'custom', file);
}
/** share code of an own module: the checked spec, nothing else */
function moduleCode(inst, file) {
  const spec = cleanModule(JSON.parse(fs.readFileSync(moduleFile(inst, file), 'utf8')));
  return 'CNTRM1.' + Buffer.from(JSON.stringify(spec)).toString('base64url');
}
/** a code from somebody else goes through the same filter as the assistant's modules */
function importModuleCode(inst, code) {
  const m = /^\s*CNTRM1\.([\w-]+)\s*$/.exec(code || '');
  if (!m) throw new Error('Das ist kein Modul-Code (beginnt mit CNTRM1.)');
  return createModule(inst, JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')));
}

module.exports = { OPTIONS, moduleFile, moduleCode, importModuleCode, check, docs, cleanModule, createModule, listModules, counterConfig, counterConfigCheck, resourcePack, launcherDesign, imageUrl };
