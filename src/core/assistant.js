// Counter assistant: answers questions about the Counter client, the launcher, Minecraft and mods, and can act:
// search Modrinth and the web, generate images, ask back, change mods / Counter settings / launcher design, build
// modules and resource packs, manage instances and worlds, remember things about the user.
// Runs on Groq (own key of the user, or the shared Counter AI worker). Thinking levels:
//   fast  – low reasoning, few tool rounds
//   deep  – medium reasoning
//   max   – high reasoning, more tool rounds and a second "review" pass that checks the draft before it is shown
// Everything about tone, length, name, permissions and memory comes from the user's assistant settings (prefs).
const modrinth = require('./modrinth');
const studio = require('./studio');

// own key of the user: straight to Groq; without one: the Counter AI worker (Cloudflare), which holds the shared key
// as a secret so it never ships with the launcher
const PROXY = require('./ai-proxy');
const PROXY_KEY = 'proxy';
const PROXY_OPENROUTER_KEY = 'proxy:openrouter';
const isProxyKey = (key) => key === PROXY_KEY || key === PROXY_OPENROUTER_KEY;
let turnId = '';

/**
 * AI providers with a free key (all speak the OpenAI chat format). "tpm" is the cautious tokens-per-minute budget
 * one request may use; "prefer" ranks the models (first match wins) so the strongest usable model is taken.
 * Live behaviour of the non-Groq providers could only be checked with a local mock server, not with real keys.
 */
const PROVIDERS = {
  proxy: { name: 'Counter (geteilt, kostenlos)', note: 'Läuft ohne eigenen Schlüssel über den Counter-Server – kleine Modelle, Limit für alle zusammen.', tpm: 7000 },
  gemini: {
    name: 'Google Gemini', note: 'Stärkstes Gratis-Modell, versteht auch Bilder, großes Limit pro Nutzer. Google darf kostenlose Anfragen zum Verbessern nutzen.',
    chat: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', list: 'https://generativelanguage.googleapis.com/v1beta/openai/models',
    keyUrl: 'https://aistudio.google.com/apikey', hint: 'AIza…', tpm: 200000, vision: true,
  },
  openrouter: {
    name: 'OpenRouter', note: 'Viele kostenlose Modelle über einen Schlüssel (nur die mit „:free“ und Werkzeug-Unterstützung). Wenig Anfragen pro Tag.',
    chat: 'https://openrouter.ai/api/v1/chat/completions', list: 'https://openrouter.ai/api/v1/models', keyUrl: 'https://openrouter.ai/keys', hint: 'sk-or-…', tpm: 30000,
    extraHeaders: { 'HTTP-Referer': 'https://github.com/HckrJT/counter-launcher', 'X-Title': 'Counter Launcher' },
    prefer: [/kimi/i, /glm/i, /deepseek/i, /qwen3.*(235|max|plus|next)/i, /gpt-oss-120b/i, /llama-3\.3-70b/i, /nemotron.*(super|ultra)/i, /qwen/i, /gemma/i, /mistral/i],
  },
  // the shared OpenRouter key in the Counter AI worker: same free-model filter and ranking as an own OpenRouter key
  'proxy-openrouter': {
    name: 'Counter AI · OpenRouter (geteilt)', note: 'Geteilter Counter-Server mit dem Cloudflare-OpenRouter-Schlüssel.', tpm: 30000,
    prefer: [/kimi/i, /glm/i, /deepseek/i, /qwen3.*(235|max|plus|next)/i, /gpt-oss-120b/i, /llama-3\.3-70b/i, /nemotron.*(super|ultra)/i, /qwen/i, /gemma/i, /mistral/i],
  },
  cerebras: {
    name: 'Cerebras', note: 'Sehr schnell, großes Token-Kontingent pro Tag. Neue Konten brauchen oft eine hinterlegte Zahlungsmethode für das Testguthaben.',
    chat: 'https://api.cerebras.ai/v1/chat/completions', list: 'https://api.cerebras.ai/v1/models', keyUrl: 'https://cloud.cerebras.ai/platform/', hint: 'csk-…', tpm: 28000,
    prefer: [/qwen-?3.*(235|max)/i, /glm/i, /gpt-oss-120b/i, /qwen/i, /llama-?3\.3-70b/i, /llama/i],
  },
  mistral: {
    name: 'Mistral', note: 'Europäischer Anbieter, gutes Deutsch. Der Gratis-Tarif verlangt, dass Anfragen zum Training genutzt werden dürfen.',
    chat: 'https://api.mistral.ai/v1/chat/completions', list: 'https://api.mistral.ai/v1/models', keyUrl: 'https://console.mistral.ai/api-keys', hint: '32 Zeichen', tpm: 50000,
    prefer: [/large/i, /medium/i, /small/i, /ministral/i],
  },
  nvidia: {
    name: 'NVIDIA NIM', note: 'Viele große Modelle zum Ausprobieren, rund 1000 Anfragen pro Tag. Bekommt man mit einem NVIDIA-Entwicklerkonto.',
    chat: 'https://integrate.api.nvidia.com/v1/chat/completions', list: 'https://integrate.api.nvidia.com/v1/models', keyUrl: 'https://build.nvidia.com/settings/api-keys', hint: 'nvapi-…', tpm: 30000,
    prefer: [/kimi/i, /deepseek/i, /qwen3.*(235|coder)/i, /gpt-oss-120b/i, /llama-3\.3-70b/i, /nemotron.*(super|ultra)/i, /llama/i],
  },
  ollama: {
    name: 'Ollama (lokal)', note: 'Läuft auf deinem eigenen PC: kostenlos, ohne Limit und ohne Konto. Ollama von ollama.com installieren und ein Modell laden (z. B. "ollama pull qwen3:14b"), dann hier „ollama“ eintragen (oder die Adresse, falls es auf einem anderen Rechner läuft). Die Qualität hängt von deinem PC ab.',
    local: true, keyUrl: 'https://ollama.com/download', hint: 'ollama  oder  http://localhost:11434', tpm: 40000,
    prefer: [/qwen3.*(235|122|72|32|30)/i, /gpt-oss.*(120|20)/i, /llama-?3\.3/i, /qwen3/i, /mistral-small|mistral-nemo/i, /gemma3?/i, /llama/i, /qwen/i],
  },
  groq: {
    name: 'Groq (eigener Schlüssel)', note: 'Sehr schnell, aber nur kleine Modelle und ein knappes Minuten-Limit.',
    chat: 'https://api.groq.com/openai/v1/chat/completions', list: 'https://api.groq.com/openai/v1/models', keyUrl: 'https://console.groq.com/keys', hint: 'gsk_…', tpm: 7000,
  },
};
if (process.env.CL_AI_TEST_URL) {
  // tests only: a local mock server that speaks the OpenAI format
  PROVIDERS.mock = { name: 'Mock', note: '', chat: process.env.CL_AI_TEST_URL + '/chat/completions', list: process.env.CL_AI_TEST_URL + '/models', tpm: 50000, prefer: [/big/i, /small/i] };
}
/** the provider this request goes to (set at the start of every question) */
let CUR = 'groq';
/** another provider is waiting in the chain: do not wait for a limit to reset, switch right away */
let QUICK = false;
const provider = () => PROVIDERS[CUR] || PROVIDERS.groq;

function endpoint(key, pathPart) {
  if (isProxyKey(key)) {
    const sharedProvider = key === PROXY_OPENROUTER_KEY ? 'openrouter' : 'groq';
    return { url: PROXY.url.replace(/\/$/, '') + pathPart, headers: { 'X-Counter-Client': PROXY.client, 'X-Counter-User': PROXY.user(), 'X-Counter-Provider': sharedProvider, ...(turnId ? { 'X-Counter-Turn': turnId } : {}) } };
  }
  const P = provider();
  if (P.local) {
    const base = /^https?:\/\//i.test(key) ? key.replace(/\/+$/, '').replace(/\/v1$/, '') : 'http://localhost:11434';
    return { url: base + (pathPart.endsWith('/models') ? '/v1/models' : '/v1/chat/completions'), headers: { Authorization: 'Bearer ollama' } };
  }
  return { url: pathPart.endsWith('/models') ? P.list : P.chat, headers: { Authorization: `Bearer ${key}`, ...(P.extraHeaders || {}) } };
}
const errorOf = (data) => (Array.isArray(data) ? data[0] && data[0].error : data && data.error) || {};

const LAUNCHER = 'Launcher: Instanzen aller MC-Versionen (Vanilla/Fabric/Quilt/NeoForge/Forge), Modrinth/CurseForge, Import von NoRisk/Modrinth App/CurseForge/Prism/Lunar/Feather, .mrpack, Konten (Microsoft, über Minecraft Launcher, Offline), Skins, Server-Favoriten, Backups, Mod-Updates, viele Design-Optionen, Shader-Hintergründe. Counter wird beim Erstellen einer Instanz per Häkchen installiert (Fabric, 26.1.x und 26.2).';

/** formats the model fetches on demand (keeps every request small for the free token limit) */
const SPECS = {
  module: 'Counter-Modul (create_module spec): {name, description, hud:{text, x 0-1, y 0-1, scale 0.5-3, color "#RRGGBB", background bool}, triggers:[{when: health_below|food_below|armor_below|join|interval, value, cooldown (Sek.), do:[Aktion]}], keys:[{key: "g"|"f6"|"left.alt"..., do:[Aktion]}]}. features:[{module:"blockoutline", settings:{color:"#FFFF0000", thickness:4}}] (schaltet ECHTE eingebaute Counter-Module mit Einstellungen ein, solange dein Modul an ist – Modul-IDs und Einstellungsnamen vorher mit counter_docs nachschlagen), options:{chatOpacity:0.5, fov:90, gamma:1 …} (setzt echte Spiel-Optionen, beim Ausschalten wird alles zurückgesetzt; erlaubt: fov gamma sensitivity renderDistance simulationDistance entityDistanceScaling framerateLimit guiScale chatOpacity chatScale chatWidth chatHeightFocused chatHeightUnfocused chatLineSpacing chatDelay textBackgroundOpacity backgroundForChatOnly chatColors chatLinks autoSuggestions showSubtitles bobView autoJump toggleSprint toggleCrouch toggleAttack toggleUse sprintWindow entityShadows vignette ambientOcclusion biomeBlendRadius cloudRange weatherRadius screenEffectScale fovEffectScale darknessEffectScale damageTiltStrength glintSpeed glintStrength mouseWheelSensitivity reducedDebugInfo hideLightningFlash highContrastBlockOutline menuBackgroundBlurriness invertMouseX invertMouseY directionalAudio notificationDisplayTime showAutosaveIndicator rotateWithMinecart mipmapLevels; Werte: Zahlen/Bool im passenden Bereich, Anteile 0-1). Aktion: {action: chat|command|title|actionbar|sound|toggle_module, text, id (Sound-ID z.B. minecraft:block.note_block.bell oder Modul-ID)}. Leben in halben Herzen: Wert = Herzen mal 2 (20 = 10 Herzen). Der Trigger health_below feuert, wenn das Leben UNTER dem Wert liegt, also „unter 4 Herzen“ = 8. Platzhalter im Text: {fps} {cps} {ping} {time} {player} {server} {players} {x} {y} {z} {health} {max_health} {food} {armor} {level} {speed} {facing} {held} {biome} {day} {light}; Zeilenumbruch \\n. Keine Cheats; Chat/Befehle sind gedrosselt (interval mind. 30 s). Erscheint im Spiel im Rechts-Shift-Menü, Tab "Eigene".',
  resourcepack: 'Ressourcenpaket (create_resourcepack spec): {name, description, icon (Bildidee), textures:[{path "block/diamond_ore" | "item/diamond_sword" ..., prompt (englisch), size 16|32}] (max 12), splashes:[Titelmenü-Sprüche], lang:{"übersetzungs.schlüssel": "Text"}}.',
  design: 'Launcher-Design (launcher_design patch): accent/accent2/solid "#RRGGBB", bg sky|campfire|aurora|storm|end|ocean|sunset|gradient|solid, layout console|classic, style clean|glass|flat|outline, glass 5-95, blur 0-60, radius 0-28, font 11-17, light 0-200, cubes/land/stars/pixelHeads/newsCol/serverBox/railIcons/skinRotate/motion/compact bool, cubeCount 4-40, skinSize 60-140, skinAnim idle|walk|run|wave|fly|none, launchStyle gradient|solid|outline, cubeColor accent|accent2|white, font2 system|rounded|mono|serif|pixel, customCss.',
  config: 'counter_config changes: [{module:"id", enabled:bool} | {module:"id", setting:"key", value} | {module:"id", reset:true} | {theme:"key", value}]. Modul-IDs und Einstellungen mit counter_docs nachschlagen. Farben als "#AARRGGBB". Werte müssen den Typ des Beispielwerts haben.',
  instance: 'create_instance: {name, mcVersion (z.B. "26.1.2", "1.21.11"), loader: vanilla|fabric|quilt|neoforge|forge, counter: bool (nur Fabric 26.1.x/26.2)}.',
};

const TONES = {
  friendly: 'freundlich, warm und motivierend',
  cool: 'lässig, selbstbewusst und knapp, etwas trocken-witzig',
  pro: 'sachlich, präzise und professionell, ohne Smalltalk',
  funny: 'witzig und verspielt, mit Gaming-Humor, aber trotzdem hilfreich',
  teacher: 'geduldig erklärend wie ein guter Lehrer, Schritt für Schritt',
};
const LENGTHS = { short: 'Antworte sehr kurz (1-4 Sätze), außer es wird mehr gebraucht.', normal: 'Antworte kompakt, aber vollständig.', long: 'Antworte ausführlich mit Erklärungen, Beispielen und Hintergründen.' };

function systemPrompt(ctx, p) {
  const style = [
    `Ton: ${TONES[p.tone] || TONES.friendly}.`,
    LENGTHS[p.length] || LENGTHS.normal,
    p.emojis === false ? 'Keine Emojis.' : 'Emojis sparsam und passend.',
    p.formal ? 'Sieze den Nutzer.' : 'Duze den Nutzer.',
    p.kidSafe ? 'KINDERMODUS: Der Nutzer ist ein Kind. Einfache, kurze Sprache, freundlich, nichts Gruseliges oder Gewalttätiges, keine Links zu fremden Seiten, bei Unsicherheit auf Eltern verweisen. Keine Server-Abfragen.' : '',
    p.language && p.language !== 'auto' ? `Antworte immer auf ${p.language === 'en' ? 'Englisch' : 'Deutsch'}.` : 'Antworte in der Sprache des Nutzers.',
  ].join(' ');
  return `${p.persona || ''}
Du bist ${p.name || 'der Counter Assistent'}, der KI-Assistent im Counter Launcher. ${style} Nutze Markdown (Listen, **fett**, Tabellen wenn sinnvoll).
Minecraft-Versionen: seit 2026 heißen sie 26.x (26.1, 26.1.2, 26.2, 26.3 – neueste), davor 1.21.x usw. 26.1.2 ist Minecraft, keine Counter-Version.
Themen: Counter Client (Fabric-PvP/HUD-Mod, ~100 Module, Menü Rechts-Shift), Counter Launcher, Minecraft, Mods, Modpacks, Shader, Server, Crashes, Builds, Redstone.

Arbeitsweise:
- Denk zuerst nach: Was will der Nutzer wirklich? Welche Infos fehlen? Welche Werkzeuge brauche ich? Erst dann handeln.
- Unklar? Erst ask_user mit 2-5 Optionen – aber nur bei echten Richtungsentscheidungen. Details (Ton, Farbe, Position, Abklingzeit) wählst du selbst passend und nennst sie in der Antwort.
- Fakten mit Werkzeugen prüfen statt raten. Plane die Werkzeuge vorher, rufe unabhängige parallel auf und nie zweimal dasselbe; sobald du genug weißt, antworte. Ergebnisse von calculate, minecraft_wiki und counter_docs sind verbindlich – übernimm sie exakt statt Varianten anzubieten. Erfinde NIE Mods, Module, Einstellungen, Befehle oder Ergebnisse.
- Mods/Modpacks/Shader nur aus search_mods empfehlen; Version/Loader der Instanz beachten; bei Bedarf mod_details für Abhängigkeiten/Versionen.
${p.allowWeb === false ? '- Websuche ist vom Nutzer deaktiviert.' : '- Aktuelles (Versionen, News, Anleitungen, Fehlermeldungen) mit web_search prüfen.'}
${p.allowImages === false ? '- Bilder erzeugen ist vom Nutzer deaktiviert.' : '- Bilder: generate_image (englischer, detaillierter Prompt).'}
- Counter-Module/Einstellungen nur aus counter_docs. Nie Quellcode von Counter oder Launcher herausgeben.
- Beantworte immer direkt die Frage des Nutzers. Stell dich nur beim allerersten „Hallo“ ohne Frage kurz vor, niemals vor einer echten Frage.
- Modpacks: „viele“/„ultra viele“/„mehr“ heißt wirklich viele – mindestens 30 Mods (ultra: 60 und mehr), gesucht in mehreren parallelen search_mods-Aufrufen pro Kategorie (Inhalt, Magie/Technik/Kampf, Welt, Performance, Qualität-des-Lebens, Bibliotheken). Passe das Spielverhalten nie nachträglich per Rückfrage an („Was möchtest du erstellen?“): „mehr Mods in das Modpack“ bedeutet, das letzte Modpack zu erweitern. Nur Mods nehmen, die zur Version und zum Loader passen.
- Wünscht der Nutzer ein „Modul“ (oder etwas, das dauerhaft an/aus schaltbar sein soll), nutze IMMER create_module, nicht counter_config. counter_config ist nur für „stell Einstellung X um“. Farben sind #AARRGGBB (Alpha zuerst!): Rot #FFFF0000, Grün #FF00FF00, Blau #FF0000FF, Gelb #FFFFFF00, Weiß #FFFFFFFF, Lila #FF9D5CFF. „Dick“ beim Umriss = thickness 6-10.
- Eigene Module (create_module) VERÄNDERN das Spiel wirklich, wenn du features (eingebaute Counter-Module samt Einstellungen, z. B. blockoutline, fullbright, hitcolor, chattweaks, timechanger, fpsboost, zoom …) und options (Spiel-Optionen wie chatOpacity, fov, gamma, bobView) nutzt – dazu counter_docs für die passenden Modul-IDs und Einstellungen abfragen. Schreibe NIE nur einen HUD-Text, wenn der Nutzer eine Spielwirkung will (Blockumriss, Chat, Sicht, FPS, Farben …). hud/triggers/keys sind nur Zusatz. Gibt es dafür kein eingebautes Counter-Modul und keine passende Option (z. B. eine völlig neue Animation), sag das ehrlich, baue die nächstbeste Annäherung mit features/options und erkläre, was fehlt – gib nie einen Text-Platzhalter als „Modul“ aus.
- Client-Bugs: Java-Code kannst du nicht ändern; mit counter_config umgehen und sagen, dass der Entwickler fixen muss.
- Antwortet ein Werkzeug mit „Fehler:“, korrigiere den Aufruf und versuch es erneut. Gelingt es nicht, sag das ehrlich – behaupte nie, etwas sei gebaut oder erledigt, wenn kein Werkzeug es bestätigt hat.
- Bei Bau-Aufträgen (Modpack, Modul, Pack, Design) nicht um Erlaubnis bitten, sondern direkt das Werkzeug aufrufen – die Bestätigung kommt als Knopf. Bauen/Ändern: vorher get_format holen. ${ctx.auto ? 'Du darfst Änderungen direkt ausführen.' : 'Änderungen werden dem Nutzer zur Bestätigung angezeigt – sag "wartet auf Bestätigung", nicht "erledigt".'}
- Schreib NIE JSON/Änderungen in den Text, um sie auszuführen – ruf immer das Werkzeug auf. Nenne Werkzeug- oder Funktionsnamen (remove_mod, search_mods …) und Code dafür nie im Antworttext; sag stattdessen in Worten, was du tust. Wenn Mods entfernt/installiert/umgeschaltet werden sollen, ruf die Werkzeuge direkt auf (der Nutzer bestätigt dann per Knopf).
- Tasten (keybind) sind Tastencodes (Zahlen); Kombinationen wie "RSHIFT+F" gibt es nicht.
- Logs/Crashes: read_game_file (logs/latest.log, crash-reports) lesen, Ursache finden, konkrete Lösung vorschlagen.
- Wenn der Nutzer etwas Persönliches/Dauerhaftes erzählt (Lieblingsserver, PC-Leistung, Spielstil, Vorlieben) oder "merk dir" sagt: remember benutzen.
- Keine Cheats/Hacks (Aim-Assist, Killaura, X-Ray, Autoclicker, Fly ...). Unangemessenes ablehnen.
${p.instructions ? `\nEigene Anweisungen des Nutzers (immer befolgen, solange sie den Regeln oben nicht widersprechen):\n${p.instructions}\n` : ''}${p.memory && p.memory.length ? `\nDas weißt du über den Nutzer (Gedächtnis):\n${p.memory.map((m, i) => `${i + 1}. ${m}`).join('\n')}\n` : ''}
${LAUNCHER}
${ctx.goal ? `ZIEL (/goal): ${ctx.goal} – arbeite aktiv darauf hin und sag am Ende kurz den Stand.\n` : ''}Instanzen: ${ctx.instances || '-'}
Ausgewählt: ${ctx.selected || '-'}`;
}

const fn = (name, description, properties, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });
const TOOLS = [
  fn('search_mods', 'Sucht auf Modrinth nach Mods, Modpacks, Shadern oder Ressourcenpaketen passend zu Version und Loader.', {
    query: { type: 'string', description: 'Suchbegriff auf Englisch, z. B. "minimap", "performance"' },
    type: { type: 'string', enum: ['mod', 'modpack', 'shader', 'resourcepack'] },
    mcVersion: { type: 'string', description: 'Minecraft-Version, Standard: ausgewählte Instanz' },
    loader: { type: 'string', enum: ['fabric', 'quilt', 'neoforge', 'forge'] },
  }, ['query', 'type']),
  fn('mod_details', 'Details zu einem Modrinth-Projekt: Beschreibung, Client/Server-Seite, passende Versionen und Abhängigkeiten für eine Minecraft-Version.', {
    project_id: { type: 'string' }, mcVersion: { type: 'string' }, loader: { type: 'string' },
  }, ['project_id']),
  fn('web_search', 'Sucht live im Internet nach aktuellen Informationen und gibt Ergebnisse mit Quellen zurück.', { query: { type: 'string' } }, ['query']),
  fn('read_webpage', 'Liest den Text einer Webseite (z. B. aus web_search), um Details nachzulesen.', { url: { type: 'string' } }, ['url']),
  fn('check_instance', 'Prüft alle Mods der ausgewählten Instanz ohne Spielstart: fehlende/doppelte Abhängigkeiten, falsche Minecraft-Version, falscher Loader, kaputte Jars. Immer benutzen bei Crashes, Konflikten und „passt das zusammen?“.', {}),
  fn('security_check', 'Prüft die Mod-Dateien der Instanz gegen Modrinth: bekannte Dateien vs. unbekannte (mit Warnzeichen). Für „sind meine Mods sicher?“.', {}),
  fn('update_overview', 'Zeigt für alle Instanzen, welche Mod-Updates bereitliegen (Wochenübersicht).', {}),
  fn('java_advice', 'RAM- und Java-Empfehlung für die ausgewählte Instanz passend zu PC und Modanzahl.', {}),
  fn('disk_usage', 'Zeigt, was in der ausgewählten Instanz am meisten Platz braucht.', {}),
  fn('build_modpack', 'Baut eine neue Instanz und installiert die Modrinth-Projekte (IDs aus search_mods!). Abhängigkeiten kommen automatisch dazu. Höchstens 6 Suchen, dann SOFORT diese Aktion aufrufen – nicht erst nach Bestätigung fragen (der Nutzer bestätigt ohnehin per Knopf). Nur Mods mit echter project_id aus search_mods aufnehmen; Fabric API kommt als Abhängigkeit automatisch.', {
    name: { type: 'string' }, mcVersion: { type: 'string' }, loader: { type: 'string' }, counter: { type: 'boolean' },
    projects: { type: 'array', items: { type: 'string' }, description: 'Modrinth project_ids, max. 60' },
  }, ['name', 'mcVersion', 'loader', 'projects']),
  fn('minecraft_wiki', 'Liest eine Seite des offiziellen Minecraft Wiki als Text (Rezepte, Mobs, Blöcke, Redstone, Versionen, Befehle). Genauer als die Websuche.', {
    title: { type: 'string', description: 'Seitentitel auf Englisch, z. B. "Beacon", "Java Edition 26.1", "Commands/execute"' },
  }, ['title']),
  fn('calculate', 'Rechnet exakt: math (Ausdruck mit + - * / % ^ sqrt round floor ceil min max abs) oder nether (Koordinaten Oberwelt<->Nether umrechnen).', {
    math: { type: 'string' }, nether: { type: 'object', properties: { x: { type: 'number' }, z: { type: 'number' }, from: { type: 'string', enum: ['overworld', 'nether'] } } },
  }),
  fn('server_status', 'Prüft einen Minecraft-Server live: online, Version, Spielerzahl, Ping, MOTD.', { address: { type: 'string', description: 'z. B. "hypixel.net"' } }, ['address']),
  fn('list_instance_content', 'Listet Ressourcenpakete oder Shader der ausgewählten Instanz.', { type: { type: 'string', enum: ['resourcepack', 'shader'] } }, ['type']),
  fn('generate_image','Erzeugt ein Bild aus einer Beschreibung und zeigt es dem Nutzer.', {
    prompt: { type: 'string', description: 'Detaillierte Bildbeschreibung auf Englisch' },
    wide: { type: 'boolean', description: 'Querformat (z. B. Wallpaper)' },
  }, ['prompt']),
  fn('ask_user', 'Stellt dem Nutzer eine Rückfrage mit Antwortmöglichkeiten, wenn die Anfrage nicht eindeutig ist.', {
    question: { type: 'string' }, options: { type: 'array', items: { type: 'string' }, description: '2-5 kurze Antwortmöglichkeiten' },
  }, ['question', 'options']),
  fn('remember', 'Speichert eine dauerhafte Info über den Nutzer im Gedächtnis: kurzer Satz auf Deutsch in der dritten Person, z. B. "Spielt Bedwars auf Hypixel".', { fact: { type: 'string' } }, ['fact']),
  fn('forget', 'Löscht einen Eintrag aus dem Gedächtnis (Nummer aus der Liste oder Text).', { item: { type: 'string' } }, ['item']),
  fn('list_instances', 'Listet alle Instanzen (Name, ID, Version, Loader, Counter, zuletzt gespielt).', {}),
  fn('list_instance_mods', 'Listet die installierten Mods der ausgewählten Instanz (Dateiname, Name, an/aus).', {}),
  fn('list_worlds', 'Listet die Welten der ausgewählten Instanz.', {}),
  fn('read_game_file', 'Liest eine Datei der ausgewählten Instanz (nur Text): options.txt, servers.dat-Liste, config/..., logs/latest.log, crash-reports/<neueste>. "crash" liest den neuesten Crash-Report.', {
    path: { type: 'string', description: 'z. B. "logs/latest.log", "crash", "options.txt", "config/sodium-options.json"' },
  }, ['path']),
  fn('install_mod', 'Installiert ein Modrinth-Projekt (mit Abhängigkeiten) in die ausgewählte Instanz.', {
    project_id: { type: 'string' }, title: { type: 'string' }, type: { type: 'string', enum: ['mod', 'shader', 'resourcepack'] },
  }, ['project_id', 'title']),
  fn('remove_mod', 'Entfernt eine Mod-Datei aus der ausgewählten Instanz (kommt in den Papierkorb).', { file: { type: 'string' }, title: { type: 'string' } }, ['file']),
  fn('toggle_mod', 'Schaltet eine Mod an oder aus.', { file: { type: 'string' }, enabled: { type: 'boolean' }, title: { type: 'string' } }, ['file', 'enabled']),
  fn('get_format', 'Holt das genaue Format für module, resourcepack, design, config oder instance, bevor du etwas baust.', {
    kind: { type: 'string', enum: ['module', 'resourcepack', 'design', 'config', 'instance'] },
  }, ['kind']),
  fn('counter_docs', 'Schlägt Counter-Module mit ihren Einstellungen nach.', { query: { type: 'string' } }, ['query']),
  fn('counter_config', 'Ändert die Counter-Einstellungen der ausgewählten Instanz.', {
    changes: { type: 'array', items: { type: 'object', properties: { module: { type: 'string' }, enabled: { type: 'boolean' }, setting: { type: 'string' }, value: {}, reset: { type: 'boolean' }, theme: { type: 'string' } } } },
    summary: { type: 'string' },
  }, ['changes', 'summary']),
  fn('create_module', 'Erstellt ein eigenes Counter-Modul in der ausgewählten Instanz.', { spec: { type: 'object' } }, ['spec']),
  fn('list_custom_modules', 'Listet die eigenen Counter-Module der ausgewählten Instanz.', {}),
  fn('create_resourcepack', 'Baut ein Ressourcenpaket (KI-Texturen, Titelmenü-Sprüche, Texte) für die ausgewählte Instanz.', { spec: { type: 'object' } }, ['spec']),
  fn('launcher_design', 'Ändert das Design des Counter Launchers.', { patch: { type: 'object' }, summary: { type: 'string' } }, ['patch', 'summary']),
  fn('create_instance', 'Legt eine neue Instanz an.', { name: { type: 'string' }, mcVersion: { type: 'string' }, loader: { type: 'string' }, counter: { type: 'boolean' } }, ['name', 'mcVersion', 'loader']),
  fn('launch_instance', 'Startet Minecraft mit einer Instanz (optional direkt auf einen Server).', { id: { type: 'string' }, server: { type: 'string' } }, ['id']),
  fn('update_counter', 'Lädt die neueste Counter-Mod-Version in eine Instanz (oder in alle Fabric-Instanzen mit all=true) und schaltet Counter dort ein.', { id: { type: 'string' }, all: { type: 'boolean' } }, []),
  fn('backup_world', 'Erstellt ein Backup einer Welt der ausgewählten Instanz.', { world: { type: 'string' } }, ['world']),
];
// tools that change something: proposed to the user unless auto mode is on
const ACTIONS = new Set(['install_mod', 'remove_mod', 'toggle_mod', 'counter_config', 'create_module', 'create_resourcepack', 'launcher_design', 'create_instance', 'launch_instance', 'update_counter', 'backup_world', 'build_modpack']);

// ---------------------------------------------------------------- Groq

async function groqOnce(key, body) {
  const ep = endpoint(key, '/v1/chat/completions');
  const res = await fetch(ep.url, { method: 'POST', headers: { ...ep.headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  const apiError = errorOf(data);
  if (res.status === 401 || res.status === 403) throw Object.assign(new Error(`Der ${provider().name.replace(/ \(.*\)/, '')}-Schlüssel ist ungültig oder hat keine Rechte – bitte neu eintragen`), { badKey: true });
  // "Limit 8000, Requested 9162": this single request is bigger than the model's free minute budget
  const sizeMsg = /Limit (\d+), Requested (\d+)/.exec(apiError.message || '');
  if (sizeMsg && (res.status === 413 || Number(sizeMsg[2]) > Number(sizeMsg[1]))) {
    const e = new Error('Das war für das Gratis-Limit auf einmal zu viel.');
    e.tooLarge = true;
    e.limitTokens = Number(sizeMsg[1]);
    e.model = body.model;
    throw e;
  }
  if (res.status === 429) {
    const e = new Error('Kurz zu viele Anfragen (Gratis-Limit) – in ein paar Sekunden nochmal');
    e.limit = true;
    e.wait = parseFloat(res.headers.get('retry-after') || '') || 8;
    // the Counter AI worker's own limit per player (not Groq's per model)
    e.proxy = isProxyKey(key) && /kurz warten/i.test(apiError.message || '');
    if (e.proxy && !res.headers.get('retry-after')) e.wait = 12;
    throw e;
  }
  if (!res.ok) {
    const e = new Error(apiError.message || `${provider().name}-Fehler ${res.status}`);
    // the model wrote a broken tool call: worth one more try
    e.parse = /parsing failed|failed_generation|tool_use_failed|output_parse/i.test(e.message + ' ' + ((data.error && data.error.code) || ''));
    // "Insufficient credits" (OpenRouter): this model is not free on the key, the next model may be
    if (res.status === 402) e.retryModel = true;
    throw e;
  }
  if (!data.choices || !data.choices[0]) {
    // some providers (OpenRouter) answer 200 with {"error": {...}} when the model behind them has a problem
    const code = Number(apiError.code) || 0;
    const msg = apiError.message || `${provider().name} hat nicht geantwortet`;
    if (code === 401 || code === 403) throw Object.assign(new Error(`Der ${provider().name}-Schlüssel wurde abgelehnt – bitte prüfen`), { badKey: true });
    const e = new Error(msg);
    if (code === 429) {
      e.limit = true;
      e.wait = 6;
    }
    e.retryModel = true;
    throw e;
  }
  return data.choices[0].message;
}

/** token limit per minute that was learned for a model (from "Limit N" in an error), default is cautious */
const LIMITS = new Map();
const limitOf = (model) => LIMITS.get(CUR + '|' + model) || provider().tpm || 7000;

/**
 * Makes a request fit into the model's free minute budget: input (messages + tool definitions) plus the answer
 * space (max_tokens) are counted together. Shrinks in steps: answer space, old tool results, old chat messages.
 */
function fitBody(body, limit) {
  const b = { ...body, messages: body.messages.map((m) => ({ ...m })) };
  const toolsChars = JSON.stringify(b.tools || []).length;
  const est = () => Math.ceil((JSON.stringify(b.messages).length + toolsChars) / 3);
  const budget = limit - 300;
  const fits = () => est() + (b.max_tokens || 0) <= budget;
  if (fits()) return b;
  const last = b.messages.length - 1;
  const cut = (m, cap) => { if (typeof m.content === 'string' && m.content.length > cap) m.content = m.content.slice(0, cap) + ' …[gekürzt]'; };
  b.max_tokens = Math.max(1000, Math.min(b.max_tokens || 1500, budget - est()));
  for (const cap of [1800, 1000, 600, 350]) {
    if (fits()) return b;
    b.messages.forEach((m, i) => { if (m.role === 'tool' && i < last - 1) cut(m, cap); });
  }
  for (const cap of [1200, 700, 400]) {
    if (fits()) return b;
    b.messages.forEach((m, i) => { if (i > 0 && i < last && m.role !== 'tool' && !m.tool_calls) cut(m, cap); });
  }
  // newest tool results (this round) last
  for (const cap of [1500, 900, 500]) {
    if (fits()) return b;
    b.messages.forEach((m) => { if (m.role === 'tool') cut(m, cap); });
  }
  // drop the oldest plain chat messages
  while (!fits() && b.messages.length > 3 && b.messages[1] && b.messages[1].role !== 'tool' && !b.messages[1].tool_calls) b.messages.splice(1, 1);
  b.max_tokens = Math.max(600, Math.min(b.max_tokens, budget - est()));
  return b;
}

const REASONING = /gpt-oss|qwen3\.8|qwen3-32b/;
function reasoningParams(model, effort) {
  if (CUR === 'gemini') return /gemini-(2\.5|3)/.test(model) ? { reasoning_effort: effort } : {};
  if (CUR !== 'groq' && CUR !== 'proxy') return /gpt-oss/.test(model) && CUR === 'cerebras' ? { reasoning_effort: effort } : {};
  if (/gpt-oss/.test(model)) return { reasoning_effort: effort, include_reasoning: true };
  if (/qwen3/.test(model)) return { reasoning_effort: effort, reasoning_format: 'parsed' };
  return {};
}

/**
 * Every Groq model has its own free token budget per minute: when one is used up, take the next good model.
 * When the Counter AI worker itself says "wait" (limit per player), trying other models would only cost more
 * requests, so just wait. All in all at most ~60 s of waiting, then give up with a friendly message.
 */
async function groq(key, body, effort, onStatus) {
  const fallback = modelCache ? [body.model, ...(modelCache.order || FALLBACK).filter((id) => modelCache.ids.includes(id) && id !== body.model).slice(0, 6)] : [body.model];
  const { reasoning_effort, include_reasoning, reasoning_format, ...rest } = body;
  let waited = 0;
  let lastModelError = null;
  for (;;) {
    let wait = 60;
    for (const model of fallback) {
      try {
        const make = () => ({ ...fitBody({ ...rest, model }, limitOf(model)), ...(effort ? reasoningParams(model, effort) : {}) });
        let msg;
        try {
          msg = await groqOnce(key, make());
        } catch (e) {
          // the model's real limit is smaller than assumed: remember it and send a smaller request once
          if (!e.tooLarge) throw e;
          LIMITS.set(CUR + '|' + model, Math.max(2500, Math.floor(e.limitTokens * 0.85)));
          msg = await groqOnce(key, make());
        }
        msg.usedModel = model;
        return msg;
      } catch (e) {
        if (e.tooLarge) continue;
        if (e.retryModel && !e.limit) {
          lastModelError = e;
          continue;
        }
        if (!e.limit) throw e;
        wait = Math.min(wait, e.wait);
        if (e.proxy) break;
      }
    }
    if (wait === 60 && fallback.length && fallback.every((m) => LIMITS.has(CUR + '|' + m))) throw new Error('Die Anfrage ist für das Gratis-Limit zu groß – stell die Frage kürzer oder wähle die Stufe „Gründlich“.');
    // every model failed with a provider problem (no limit): report that one instead of waiting
    if (lastModelError && wait === 60) throw lastModelError;
    if (QUICK) throw Object.assign(new Error('Anbieter ist gerade voll'), { limit: true });
    if (waited + wait > 60) throw Object.assign(new Error('Kurz zu viele Anfragen (Gratis-Limit) – in ein paar Sekunden nochmal'), { limit: true });
    await new Promise((r) => setTimeout(r, wait * 1000 + 400));
    waited += wait;
  }
}

// models come and go on Groq: ask which ones the key can use and take the best allrounder for tool use
const PREFERRED = ['qwen/qwen3.8-27b', 'moonshotai/kimi-k2-instruct-0905', 'moonshotai/kimi-k2-instruct', 'openai/gpt-oss-120b', 'meta-llama/llama-4-maverick-17b-128e-instruct', 'qwen/qwen3-32b', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile'];
const FALLBACK = ['qwen/qwen3.8-27b', 'moonshotai/kimi-k2-instruct-0905', 'moonshotai/kimi-k2-instruct', 'openai/gpt-oss-120b', 'qwen/qwen3-32b', 'meta-llama/llama-4-maverick-17b-128e-instruct', 'openai/gpt-oss-20b'];
const VISION = ['meta-llama/llama-4-maverick-17b-128e-instruct', 'meta-llama/llama-4-scout-17b-16e-instruct'];
const SEARCH = ['groq/compound', 'groq/compound-mini', 'compound-beta', 'compound-beta-mini'];
let modelCache = null;
async function loadModels(key) {
  const cacheKey = CUR + '|' + key;
  if (modelCache && modelCache.key === cacheKey && Date.now() - modelCache.at < 3600_000) return modelCache;
  const ep = endpoint(key, '/v1/models');
  const res = await fetch(ep.url, { headers: ep.headers });
  if (res.status === 401 || res.status === 403) throw Object.assign(new Error(`Der ${provider().name.replace(/ \(.*\)/, '')}-Schlüssel ist ungültig oder hat keine Rechte – bitte neu eintragen`), { badKey: true });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Google answers a wrong key with 400 "API key not valid", others with 401/403
    const msg = errorOf(data).message || `Fehler ${res.status}`;
    throw Object.assign(new Error(/api key|invalid|unauthor|permission|credential/i.test(msg) || res.status === 400 ? `Der ${provider().name.replace(/ \(.*\)/, '')}-Schlüssel ist ungültig – bitte prüfen` : `${provider().name}: ${msg}`), { badKey: /api key|invalid|unauthor|permission|credential/i.test(msg) || res.status === 400 });
  }
  const list = (data.data || data.models || []).filter((m) => m && m.id);
  let ids;
  if (CUR === 'groq' || CUR === 'proxy') {
    ids = list.filter((m) => m.active !== false && !/whisper|tts|guard|playai|orpheus|distil|prompt|allam/i.test(m.id)).map((m) => m.id);
    const best = PREFERRED.find((id) => ids.includes(id)) || ids.find((id) => /gpt|llama|qwen|kimi/i.test(id) && !/compound/.test(id)) || ids[0];
    if (!best) throw new Error('Groq bietet gerade kein passendes Modell an');
    modelCache = { key: cacheKey, at: Date.now(), ids, best, order: FALLBACK, vision: VISION.find((id) => ids.includes(id)), search: SEARCH.find((id) => ids.includes(id)) };
    return modelCache;
  }
  const P = provider();
  const clean = (id) => String(id).replace(/^models\//, '');
  let usable = list.filter((m) => !/embed|rerank|tts|whisper|speech|audio|image|moderation|guard|ocr|robotics|live|vision-only|safety/i.test(m.id));
  if (CUR === 'openrouter' || CUR === 'proxy-openrouter') usable = usable.filter((m) => /:free$/.test(m.id) && (m.supported_parameters || []).includes('tools'));
  if (CUR === 'mistral') usable = usable.filter((m) => !m.capabilities || (m.capabilities.completion_chat && m.capabilities.function_calling));
  if (CUR === 'gemini') usable = usable.filter((m) => /gemini-/.test(m.id) && !/lite|gemma/.test(m.id) || /flash-lite/.test(m.id));
  ids = usable.map((m) => clean(m.id));
  let order;
  if (CUR === 'gemini') {
    // strongest first: highest version, flash before flash-lite; keep the chat model the user chose when it is in the list
    const score = (id) => { const v = /gemini-(\d+(?:\.\d+)?)/.exec(id); return (v ? parseFloat(v[1]) * 10 : 0) + (/flash-lite/.test(id) ? -5 : 0) + (/preview|exp/.test(id) ? -0.5 : 0); };
    order = [...ids].sort((a, b) => score(b) - score(a));
  } else {
    const rank = (id) => { const i = (P.prefer || []).findIndex((re) => re.test(id)); return i < 0 ? 99 : i; };
    order = [...ids].sort((a, b) => rank(a) - rank(b));
  }
  if ((CUR === 'openrouter' || CUR === 'proxy-openrouter') && !ids.includes('openrouter/free')) { ids.push('openrouter/free'); order.push('openrouter/free'); }
  if (!order.length) throw new Error(`${P.name} bietet mit diesem Schlüssel gerade kein passendes Modell an`);
  modelCache = { key: cacheKey, at: Date.now(), ids, best: order[0], order, vision: P.vision ? order[0] : null, search: null };
  return modelCache;
}
async function models(key, providerId) {
  CUR = providerId || (key === PROXY_OPENROUTER_KEY ? 'proxy-openrouter' : key === PROXY_KEY || !key ? 'proxy' : 'groq');
  const m = await loadModels(key || (PROXY.url ? PROXY_KEY : ''));
  return { ids: m.ids.filter((id) => !/compound/.test(id)), best: m.best, vision: !!m.vision, search: !!m.search, reasoning: m.ids.filter((id) => REASONING.test(id)), provider: CUR };
}

// ---------------------------------------------------------------- web

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CounterLauncher' };
const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
/** small web search: DuckDuckGo results and the Minecraft Wiki as short snippets (cheap on the free token limit) */
async function freeSearch(query) {
  const out = [];
  try {
    const html = await (await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { headers: UA })).text();
    const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(html)) && out.length < 6) {
      let url = m[1];
      const u = /uddg=([^&]+)/.exec(url);
      if (u) url = decodeURIComponent(u[1]);
      if (/duckduckgo\.com\/y\.js|ad_domain/.test(url)) continue;
      out.push(`- ${stripHtml(m[2])} (${url}): ${stripHtml(m[3]).slice(0, 260)}`);
    }
  } catch {}
  try {
    const wiki = await (await fetch(`https://minecraft.wiki/api.php?action=query&list=search&srlimit=3&format=json&srsearch=${encodeURIComponent(query)}`, { headers: UA })).json();
    for (const r of (wiki.query && wiki.query.search) || []) out.push(`- Minecraft Wiki: ${r.title} (https://minecraft.wiki/w/${encodeURIComponent(r.title.replace(/ /g, '_'))}): ${stripHtml(r.snippet).slice(0, 220)}`);
  } catch {}
  return out.length ? `Suchergebnisse (${new Date().toISOString().slice(0, 10)}):\n${out.join('\n')}` : 'Keine Suchergebnisse.';
}
async function webSearch(key, query) {
  const m = await loadModels(key);
  if (!m.search) return freeSearch(query);
  const msg = await groq(key, { model: m.search, messages: [{ role: 'user', content: `Suche im Internet und fasse knapp und faktenbasiert zusammen (mit Quellen-Links): ${query}` }], max_tokens: 900 });
  const sources = ((msg.executed_tools || []).flatMap((t) => (t.search_results && t.search_results.results) || [])).slice(0, 5).map((r) => `- ${r.title}: ${r.url}`);
  return (msg.content || '') + (sources.length ? '\nQuellen:\n' + sources.join('\n') : '');
}
/** reads the main text of a web page (scripts, styles and navigation removed), max ~6000 characters */
async function readWebpage(url) {
  if (!/^https?:\/\//i.test(url) || /localhost|127\.0\.0\.1|\[::1\]|192\.168\.|10\.\d+\./i.test(url)) throw new Error('Nur öffentliche http(s)-Adressen');
  const res = await fetch(url, { headers: UA, redirect: 'follow' });
  if (!res.ok) throw new Error(`Seite antwortet mit ${res.status}`);
  const html = (await res.text()).slice(0, 600_000);
  const body = html.replace(/<(script|style|nav|header|footer|svg|noscript)[\s\S]*?<\/\1>/gi, ' ');
  const title = stripHtml((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || '');
  return `${title}\n${stripHtml(body).slice(0, 6000)}`;
}

/** plain text of a Minecraft Wiki page (MediaWiki API), with a search fallback when the title is not exact */
async function wikiPage(title) {
  const api = 'https://minecraft.wiki/api.php?format=json&formatversion=2&';
  let res = await (await fetch(`${api}action=query&prop=extracts&explaintext=1&redirects=1&titles=${encodeURIComponent(title)}`, { headers: UA })).json();
  let page = res.query && res.query.pages && res.query.pages[0];
  if (!page || page.missing || !page.extract) {
    const s = await (await fetch(`${api}action=query&list=search&srlimit=1&srsearch=${encodeURIComponent(title)}`, { headers: UA })).json();
    const hit = s.query && s.query.search && s.query.search[0];
    if (!hit) return `Keine Wiki-Seite zu „${title}“.`;
    res = await (await fetch(`${api}action=query&prop=extracts&explaintext=1&redirects=1&titles=${encodeURIComponent(hit.title)}`, { headers: UA })).json();
    page = res.query.pages[0];
  }
  const text = String(page.extract || '').replace(/\n{3,}/g, '\n\n');
  return `${page.title} (https://minecraft.wiki/w/${encodeURIComponent(page.title.replace(/ /g, '_'))})\n${text.slice(0, 6000)}`;
}

/** exact maths without eval: only numbers, operators, brackets and a few functions get through */
function calculate(a) {
  if (a.nether) {
    const { x = 0, z = 0, from = 'overworld' } = a.nether;
    const k = from === 'nether' ? 8 : 1 / 8;
    return `${from === 'nether' ? 'Oberwelt' : 'Nether'}: X ${Math.floor(x * k)}, Z ${Math.floor(z * k)} (genau ${x * k} / ${z * k}; Minecraft rundet immer AB, auch bei negativen Zahlen: -42.5 → -43). Diese Werte so übernehmen.`;
  }
  const expr = String(a.math || '').replace(/\s+/g, '').replace(/\^/g, '**');
  if (!expr || !/^([0-9.,+\-*/%()]|\*\*|sqrt|round|floor|ceil|min|max|abs|pi)+$/.test(expr)) return 'Nur Zahlen, + - * / % ^ ( ) und sqrt round floor ceil min max abs pi';
  try {
    const value = Function('sqrt,round,floor,ceil,min,max,abs,pi', `"use strict";return (${expr});`)(Math.sqrt, Math.round, Math.floor, Math.ceil, Math.min, Math.max, Math.abs, Math.PI);
    return `${a.math} = ${Number.isFinite(value) ? +value.toFixed(10) : value}`;
  } catch {
    return 'Ausdruck ungültig';
  }
}

function imageUrl(prompt, wide) {
  studio.check(prompt);
  return wide ? studio.imageUrl(prompt, 1280, 720) : studio.imageUrl(prompt);
}

async function modDetails(a, inst) {
  const p = await modrinth.project(a.project_id);
  const mc = a.mcVersion || (inst && inst.mcVersion);
  const loader = a.loader || (inst && inst.loader) || 'fabric';
  const params = new URLSearchParams();
  if (mc) params.set('game_versions', JSON.stringify([mc]));
  if (p.project_type === 'mod' && loader !== 'vanilla') params.set('loaders', JSON.stringify([loader]));
  let v = null;
  try {
    v = (await (await fetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(a.project_id)}/version?${params}`, { headers: UA })).json())[0];
  } catch {}
  let deps = '';
  const req = v && (v.dependencies || []).filter((d) => d.dependency_type === 'required' && d.project_id).map((d) => d.project_id);
  if (req && req.length) {
    try {
      const list = await (await fetch(`https://api.modrinth.com/v2/projects?ids=${encodeURIComponent(JSON.stringify(req))}`, { headers: UA })).json();
      deps = list.map((d) => `${d.title} [id ${d.id}]`).join(', ');
    } catch {
      deps = req.join(', ');
    }
  }
  return [
    `${p.title}: ${String(p.description || '').slice(0, 300)}`,
    `Client: ${p.client_side}, Server: ${p.server_side}, Downloads: ${p.downloads}, Lizenz: ${p.license && p.license.id}`,
    `Kategorien: ${(p.categories || []).join(', ')}`,
    v ? `Passende Version für ${mc} ${loader}: ${v.version_number} (${String(v.date_published || '').slice(0, 10)})${deps ? `, benötigt: ${deps}` : ', keine Pflicht-Abhängigkeiten'}` : `Keine Version für ${mc} ${loader} gefunden. Unterstützte MC-Versionen: ${(p.game_versions || []).slice(-8).join(', ')}`,
  ].join('\n');
}

// ---------------------------------------------------------------- conversation

const PREF_DEFAULTS = { think: 'deep', tone: 'friendly', length: 'normal', emojis: true, formal: false, language: 'auto', allowWeb: true, allowImages: true, showThoughts: true, instructions: '', name: '', persona: '', memory: [] };

/**
 * history: [{role, content, images?:[dataUrl]}]
 * env: {instance, listMods(), listCustom(), listInstances(), worlds(), readFile(path), memory:{add, remove, list}, apply(action)}
 * prefs: see PREF_DEFAULTS
 * returns {text, mods, images, ask, actions, applied, model, searched, thoughts, reviewed, steps}
 */
/**
 * Asks with the first usable provider of the chain; when one is used up (limit) or its key is wrong, the next one
 * takes over. chain = [{id, key}], default: the shared Counter AI (or the old single Groq key).
 */
async function ask(opts) {
  let chain = opts.chain && opts.chain.length ? opts.chain : [{ id: opts.key && !isProxyKey(opts.key) ? 'groq' : (opts.key === PROXY_OPENROUTER_KEY ? 'proxy-openrouter' : 'proxy'), key: opts.key || PROXY_KEY }];
  if (!PROXY.url) chain = chain.filter((c) => !String(c.id).startsWith('proxy'));
  if (!chain.length) throw new Error('NO_KEY');
  let lastError;
  for (const [i, c] of chain.entries()) {
    CUR = PROVIDERS[c.id] ? c.id : 'groq';
    QUICK = i < chain.length - 1;
    modelCache = modelCache && modelCache.key.startsWith(CUR + '|') ? modelCache : null;
    try {
      const out = await askOnce({ ...opts, key: c.key, model: i === 0 || c.id === chain[0].id ? opts.model : '' });
      out.provider = c.id;
      return out;
    } catch (e) {
      lastError = e;
      if (!(e.limit || e.badKey || e.tooLarge || /nicht geantwortet|kein passendes Modell|Fehler 5\d\d/.test(e.message)) || i === chain.length - 1) throw e;
      if (opts.onStatus) opts.onStatus(`wechselt zu ${PROVIDERS[chain[i + 1].id].name.replace(/ \(.*\)/, '')}`);
    }
  }
  throw lastError;
}

async function askOnce({ key, model, history, ctx, env, auto, goal, prefs = {}, onStatus = () => {} }) {
  const p = { ...PREF_DEFAULTS, ...prefs };
  key = key || (CUR === 'proxy-openrouter' ? PROXY_OPENROUTER_KEY : PROXY.url ? PROXY_KEY : '');
  // all requests of this question count as one for the Counter AI worker's limit
  turnId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  if (!key) throw new Error('NO_KEY');
  const m = await loadModels(key);
  const hasImages = history.some((x) => x.images && x.images.length);
  let use = hasImages && m.vision ? m.vision : model && m.ids.includes(model) ? model : m.best;
  const lastUser = String((history.filter((x) => x.role === 'user').pop() || {}).content || '');
  // thinking level: "deep" decides by itself, building / analysing gets more thought
  const heavy = /modul|bau|mach mir|erstell|code|crash|fehler|log|config|einstell|ressourcen|resource|pack|design|warum|fix|plan|vergleich|optimier|modpack/i.test(lastUser);
  const deepest = p.think === 'max' || p.think === 'ultra';
  const effort = p.think === 'fast' ? 'low' : deepest ? 'high' : heavy ? 'medium' : 'low';
  const rounds = { fast: 5, deep: 8, max: 12, ultra: 18 }[p.think] || 8;
  const tools = TOOLS.filter((t) => !(p.kidSafe && ['server_status', 'read_webpage', 'launch_instance'].includes(t.function.name)) && !(p.allowWeb === false && ['web_search', 'read_webpage', 'minecraft_wiki', 'server_status'].includes(t.function.name)) && !(p.allowImages === false && t.function.name === 'generate_image'));

  const messages = [{ role: 'system', content: systemPrompt({ ...ctx, auto, goal }, p) }];
  const recent = history.slice(p.think === 'ultra' ? -24 : deepest ? -14 : -10);
  for (const [i, x0] of recent.entries()) {
    const old = i < recent.length - (p.think === 'ultra' ? 6 : 3);
    const x = old && x0.content && x0.content.length > 700 ? { ...x0, content: x0.content.slice(0, 600) + ' …[gekürzt]' } : x0;
    if (x.images && x.images.length && use === m.vision) {
      messages.push({ role: x.role, content: [{ type: 'text', text: x.content || 'Was siehst du?' }, ...x.images.slice(0, 3).map((u) => ({ type: 'image_url', image_url: { url: u } }))] });
    } else {
      messages.push({ role: x.role, content: (x.content || '') + (x.images && x.images.length ? '\n[Der Nutzer hat ein Bild angehängt, das dieses Modell nicht sehen kann.]' : '') });
    }
  }
  const out = { text: '', mods: [], images: [], ask: null, actions: [], applied: [], model: use, searched: [], thoughts: [], reviewed: false, steps: [], effort, level: p.think };
  // ultra: first a written plan (no tools), which then guides every tool round
  if (p.think === 'ultra' && lastUser.length > 15) {
    onStatus('plant die Lösung');
    try {
      const plan = await groq(key, {
        model: use, temperature: 0.3, max_tokens: 3000,
        messages: [messages[0], ...messages.slice(-4).filter((x) => x.role !== 'system'), { role: 'user', content: `Erstelle zuerst einen kurzen Arbeitsplan (max. 8 Punkte) für meine letzte Nachricht: Was genau ist das Ziel? Fehlt etwas, ohne das KEINE gute Antwort möglich ist (nur dann nachfragen – sonst sinnvoll annehmen und die Annahme nennen)? Welche Werkzeuge braucht es MINDESTENS (einfache Fragen: 0-2), in welcher Reihenfolge (unabhängige gleichzeitig)? Welche Fallen/Fehlerquellen gibt es? Woran erkennst du, dass die Antwort wirklich gut ist? Nur der Plan, noch keine Antwort.` }],
      }, 'medium', onStatus);
      // when all tokens went into thinking, the thinking itself is the plan
      const planText = String(plan.content || (plan.reasoning ? String(plan.reasoning).slice(-1500) : '')).replace(/<think>[\s\S]*?<\/think>/, '').trim();
      if (planText) {
        out.plan = planText.slice(0, 3000);
        messages.push({ role: 'assistant', content: 'Mein Plan:\n' + out.plan });
        messages.push({ role: 'user', content: 'Gut, arbeite den Plan jetzt mit den Werkzeugen ab und antworte dann vollständig.' });
      }
      if (plan.reasoning) out.thoughts.push('Planung: ' + String(plan.reasoning).slice(0, 3000));
    } catch {}
  }
  let nudged = false;
  let greeted = false;
  const inst = env.instance;
  const toolLog = [];
  const seen = new Set();
  out.log = toolLog;
  for (let round = 0; round < rounds; round++) {
    onStatus(round === 0 ? (effort === 'high' ? 'denkt gründlich nach' : 'denkt nach') : 'arbeitet weiter');
    let msg;
    const body = { model: use, messages, tools, tool_choice: 'auto', temperature: deepest ? 0.3 : 0.4, max_tokens: effort === 'high' ? 4096 : 2400 };
    // tool results of earlier rounds were already used: keep them short, the free limit counts every token again
    for (let i = 1; i < messages.length - 6; i++) if (messages[i].role === 'tool' && messages[i].content.length > 900) messages[i] = { ...messages[i], content: messages[i].content.slice(0, 800) + ' …' };
    try {
      try {
        msg = await groq(key, body, effort, onStatus);
      } catch (e) {
        if (!e.parse) throw e;
        onStatus('versucht es nochmal');
        const other = ((modelCache && modelCache.order) || FALLBACK).find((id) => id !== use && modelCache && modelCache.ids.includes(id));
        msg = await groq(key, { ...body, temperature: 0.2, ...(round > 0 && other ? { model: other } : {}) }, effort, onStatus);
      }
    } catch (e) {
      // limit hit after some work: answer with what was found so far instead of losing it
      if ((e.limit || e.parse) && round > 0) {
        try {
          onStatus('fasst zusammen');
          const summary = `Frage:\n${lastUser.slice(0, 2000)}\n\nBisherige Werkzeug-Ergebnisse:\n${toolLog.join('\n').slice(0, 5000)}\n\nBeantworte die Frage jetzt mit diesen Ergebnissen (ohne weitere Werkzeuge).`;
          msg = await groq(key, { model: use, temperature: 0.4, max_tokens: 1400, messages: [messages[0], { role: 'user', content: summary }] }, null, onStatus);
          msg.tool_calls = null;
        } catch {
          out.text = 'Ich bin gerade ans Gratis-Limit gestoßen. Das habe ich schon herausgefunden:\n\n' + toolLog.map((t) => '- ' + t.slice(0, 300)).join('\n') + '\n\nSchick die Frage in ein paar Sekunden nochmal, dann mache ich weiter.';
          return out;
        }
      } else if (!/does not exist|decommissioned|not have access|tool|function/i.test(e.message) || round > 0) throw e;
      else {
        modelCache = null;
        use = (await loadModels(key)).best;
        msg = await groq(key, { ...body, model: use }, effort, onStatus);
      }
    }
    if (msg.usedModel) out.model = msg.usedModel;
    if (msg.reasoning) out.thoughts.push(String(msg.reasoning).slice(0, 4000));
    if (!msg.tool_calls || !msg.tool_calls.length) {
      let txt = msg.content || '';
      if (!out.thoughts.length || !msg.reasoning) {
        // models that write <think> into the content
        const t = /<think>([\s\S]*?)<\/think>/.exec(txt);
        if (t) {
          out.thoughts.push(t[1].trim().slice(0, 4000));
          txt = txt.replace(t[0], '').trim();
        }
      }
      // empty answer (all tokens went into thinking): write the answer from the results, with little thinking
      if (!txt.trim()) {
        onStatus('schreibt die Antwort');
        try {
          const fin = await groq(key, { model: use, temperature: 0.4, max_tokens: 3000, messages: [messages[0], { role: 'user', content: `Frage:\n${lastUser.slice(0, 2500)}\n\nWerkzeug-Ergebnisse:\n${toolLog.join('\n').slice(0, 8000) || '(keine)'}\n\nSchreib jetzt die vollständige, gut strukturierte Antwort.` }] }, 'low', onStatus);
          txt = String(fin.content || '').replace(/<think>[\s\S]*?<\/think>/, '').trim();
        } catch {}
        if (!txt) txt = 'Da ist beim Formulieren etwas schiefgegangen – klick auf ↻ für einen neuen Versuch.';
      }
      // the model only greeted instead of answering a real question: send it back once
      if (!greeted && lastUser.trim().length > 12 && !/^\s*(hi|hey|hallo|moin|servus|yo)\b[\s!.?]*$/i.test(lastUser)
        && /^\s*(hey|hallo|hi|moin)\b[^\n]{0,40}(ich bin|was kann ich|wie kann ich|womit kann|wobei kann)/i.test(txt) && txt.length < 600) {
        greeted = true;
        messages.push({ role: 'assistant', content: txt.slice(0, 500) });
        messages.push({ role: 'user', content: `Das war nur eine Begrüßung. Beantworte jetzt direkt meine Frage, ohne dich vorzustellen: ${lastUser.slice(0, 1500)}` });
        continue;
      }
      // the model wrote the change into the text instead of calling the tool: send it back once
      if (!nudged && /```json|"changes"\s*:|"spec"\s*:|"patch"\s*:/.test(txt)) {
        nudged = true;
        messages.push({ role: 'assistant', content: txt.slice(0, 1500) });
        messages.push({ role: 'user', content: 'Du hast die Änderung als JSON in den Text geschrieben. Ruf stattdessen jetzt das passende Werkzeug auf und antworte danach kurz ohne JSON.' });
        continue;
      }
      // maximum thinking: a second pass checks the draft against what the tools really returned
      if (deepest && txt.length > 40) {
        onStatus('prüft die Antwort');
        try {
          const review = await groq(key, {
            model: use,
            temperature: 0.2,
            max_tokens: 2400,
            messages: [
              { role: 'system', content: `Du prüfst die Antwort eines Minecraft-/Counter-Assistenten wie ein strenger Experte. Prüfe: Stimmt alles mit den Werkzeug-Ergebnissen überein? Werden Mods/Module/Einstellungen erwähnt, die in den Ergebnissen nicht vorkommen (erfunden)? Beantwortet sie die Frage vollständig? Ist sie klar strukturiert? Behauptet sie "erledigt", obwohl nur vorgeschlagen? Stimmen alle Zahlen exakt mit den Werkzeug-Ergebnissen (Rechner, Wiki) überein? Fehlen wichtige Hinweise (Kompatibilität, Version, Abhängigkeiten, Risiken)? Ist sie unnötig lang oder doppelt? Gib die VERBESSERTE Antwort komplett zurück (gleicher Stil und Ton, Markdown). Wenn alles passt, gib die Antwort unverändert zurück. Kein Kommentar zur Prüfung selbst.` },
              { role: 'user', content: `Frage des Nutzers:\n${lastUser.slice(0, 3000)}\n\nWerkzeug-Ergebnisse:\n${toolLog.join('\n').slice(0, 7000) || '(keine)'}\n\nEntwurf:\n${txt}` },
            ],
          }, p.think === 'ultra' ? 'high' : 'medium', onStatus);
          if (review.content && review.content.trim().length > 20) {
            txt = review.content.replace(/<think>[\s\S]*?<\/think>/, '').trim();
            out.reviewed = true;
            if (review.reasoning) out.thoughts.push('Prüfung: ' + String(review.reasoning).slice(0, 2000));
          }
        } catch {
          // the draft is still fine to show
        }
      }
      out.text = txt;
      // only show the mods the answer actually talks about (or proposes), not every search hit
      const lower = txt.toLowerCase();
      const named = out.mods.filter((x) => lower.includes(String(x.title).toLowerCase()) || out.actions.concat(out.applied).some((a) => a.project_id === x.project_id));
      out.mods = named.length ? named : out.mods.slice(0, 3);
      return out;
    }
    // sent back exactly as received: Gemini 3 needs the thought signatures inside tool_calls (extra_content),
    // OpenRouter needs reasoning_details on the message
    const assistantMsg = { role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls };
    if (msg.reasoning_details) assistantMsg.reasoning_details = msg.reasoning_details;
    messages.push(assistantMsg);
    // lookups run at the same time, changes one after another (in the order the model asked for them)
    const calls = msg.tool_calls.map((call) => {
      let a = {};
      try {
        a = JSON.parse(call.function.arguments || '{}');
      } catch {}
      return { call, a, name: call.function.name };
    });
    const results = new Array(calls.length);
    const lookups = [];
    for (const [i, c] of calls.entries()) {
      const sig = c.name + JSON.stringify(c.a);
      if (!ACTIONS.has(c.name) && seen.has(sig)) {
        results[i] = 'Schon abgefragt – das Ergebnis steht weiter oben. Nicht wiederholen, sondern weiterarbeiten oder antworten.';
        continue;
      }
      seen.add(sig);
      out.steps.push({ tool: c.name, label: stepLabel(c.name, c.a) });
      onStatus(stepLabel(c.name, c.a));
      if (!ACTIONS.has(c.name)) lookups.push(runTool(c.name, c.a).then((r) => (results[i] = r)));
    }
    await Promise.all(lookups);
    for (const [i, c] of calls.entries()) if (results[i] == null) results[i] = await runTool(c.name, c.a);
    for (const [i, c] of calls.entries()) {
      toolLog.push(`[${c.name}] ${String(results[i]).slice(0, 1200)}`);
      messages.push({ role: 'tool', tool_call_id: c.call.id, content: String(results[i]).slice(0, c.name === 'read_webpage' || c.name === 'read_game_file' || c.name === 'minecraft_wiki' ? 6000 : 3500) });
    }
    if (out.ask) {
      out.text = out.ask.question;
      return out;
    }
  }
  out.canContinue = true;
  // all tool rounds used up: answer with what was found
  try {
    onStatus('fasst zusammen');
    const msg = await groq(key, { model: use, temperature: 0.4, max_tokens: 2400, messages: [messages[0], { role: 'user', content: `Frage:\n${lastUser.slice(0, 2000)}\n\nWerkzeug-Ergebnisse:\n${toolLog.join('\n').slice(0, 7000)}\n\nBeantworte die Frage jetzt so vollständig wie möglich mit diesen Ergebnissen. Sag am Ende kurz, was noch offen ist – der Nutzer kann auf „Weitermachen“ klicken.` }] }, null, onStatus);
    out.text = String(msg.content || '').replace(/<think>[\s\S]*?<\/think>/, '').trim();
  } catch {
    out.text = 'Ich habe viel nachgeschaut, aber keine fertige Antwort geschafft – klick auf „Weitermachen“ oder frag genauer.';
  }
  return out;

  /** runs one tool and returns its text result (errors become text, so the model can react) */
  async function runTool(name, a) {
      let result = '';
      try {
        switch (name) {
          case 'search_mods': {
            const target = { mcVersion: a.mcVersion || (inst && inst.mcVersion) || '1.21.1', loader: a.loader || (inst && inst.loader) || 'fabric' };
            const r = await modrinth.search(a.query || '', a.type || 'mod', target, 0);
            const hits = r.hits.slice(0, 6).map((h) => ({ project_id: h.project_id, title: h.title, description: h.description, downloads: h.downloads, icon_url: h.icon_url, type: a.type || 'mod', categories: h.categories }));
            for (const hit of hits) if (!out.mods.some((x) => x.project_id === hit.project_id)) out.mods.push(hit);
            result = hits.map((h) => `${h.title} [id ${h.project_id}] (${Math.round(h.downloads / 1000)}k; ${(h.categories || []).slice(0, 4).join(',')}): ${String(h.description).slice(0, 140)}`).join('\n') || 'Keine Treffer';
            break;
          }
          case 'mod_details':
            result = await modDetails(a, inst);
            break;
          case 'web_search':
            out.searched.push(a.query);
            result = await webSearch(key, a.query || '');
            break;
          case 'read_webpage':
            result = await readWebpage(String(a.url || ''));
            break;
          case 'check_instance':
            result = inst ? JSON.stringify(env.labs.healthCheck(inst)) : 'Keine Instanz ausgewählt';
            break;
          case 'security_check':
            result = inst ? JSON.stringify(await env.labs.securityCheck(inst)).slice(0, 5000) : 'Keine Instanz ausgewählt';
            break;
          case 'update_overview':
            result = JSON.stringify(await env.labs.overview()).slice(0, 5000) || '[]';
            break;
          case 'java_advice':
            result = inst ? JSON.stringify(env.labs.javaAdvice(inst)) : 'Keine Instanz ausgewählt';
            break;
          case 'disk_usage':
            result = inst ? JSON.stringify(env.labs.diskUsage(inst)) : 'Keine Instanz ausgewählt';
            break;
          case 'minecraft_wiki':
            result = await wikiPage(String(a.title || ''));
            break;
          case 'calculate':
            result = calculate(a);
            break;
          case 'server_status':
            result = env.ping ? await env.ping(String(a.address || '')) : 'Nicht verfügbar';
            break;
          case 'list_instance_content':
            result = inst ? env.listContent(a.type || 'resourcepack') : 'Keine Instanz ausgewählt';
            break;
          case 'generate_image': {
            const url = imageUrl(a.prompt || 'minecraft', !!a.wide);
            out.images.push({ url, prompt: a.prompt });
            result = 'Bild wurde erzeugt und wird dem Nutzer angezeigt.';
            break;
          }
          case 'ask_user':
            // shown after the other tools of this round ran (e.g. remember)
            out.ask = { question: a.question || '', options: (a.options || []).slice(0, 5) };
            result = 'Frage wird dem Nutzer gezeigt.';
            break;
          case 'remember':
            studio.check(a.fact);
            env.memory.add(String(a.fact || '').slice(0, 200));
            out.remembered = (out.remembered || []).concat(a.fact);
            result = 'Gespeichert.';
            break;
          case 'forget':
            result = env.memory.remove(String(a.item || '')) ? 'Gelöscht.' : 'Nicht gefunden.';
            break;
          case 'list_instances':
            result = env.listInstances().map((i) => `${i.name} [id ${i.id}] ${i.loader} ${i.mcVersion}${i.counter ? ' +Counter' : ''}, zuletzt ${i.lastPlayed ? new Date(i.lastPlayed).toISOString().slice(0, 10) : 'nie'}`).join('\n') || 'Keine Instanzen';
            break;
          case 'list_instance_mods':
            result = inst ? env.listMods().map((x) => `${x.file} | ${x.name || ''} | ${x.enabled ? 'an' : 'aus'}`).join('\n') || 'Keine Mods' : 'Keine Instanz ausgewählt';
            break;
          case 'list_worlds':
            result = inst ? env.worlds().map((w) => `${w.name} (zuletzt ${new Date(w.modified).toISOString().slice(0, 10)})`).join('\n') || 'Keine Welten' : 'Keine Instanz ausgewählt';
            break;
          case 'read_game_file':
            result = inst ? env.readFile(String(a.path || '')) : 'Keine Instanz ausgewählt';
            break;
          case 'get_format':
            result = SPECS[a.kind] || Object.values(SPECS).join(' | ');
            break;
          case 'counter_docs':
            result = studio.docs(a.query);
            break;
          case 'list_custom_modules':
            result = inst ? JSON.stringify(env.listCustom()).slice(0, 6000) || '[]' : 'Keine Instanz ausgewählt';
            break;
          default:
            if (!ACTIONS.has(name)) {
              result = 'Unbekanntes Werkzeug';
              break;
            }
            // validate (and filter) right away so the model can correct itself before the user sees it
            if (name === 'create_module') a.spec = studio.cleanModule(a.spec);
            if (name === 'create_resourcepack') studio.check(JSON.stringify(a.spec || {}));
            if (name === 'counter_config') studio.counterConfigCheck(a.changes);
            {
              const action = { kind: name, ...a };
              if (auto) {
                const r = await env.apply(action);
                out.applied.push(action);
                result = 'Erledigt.' + (r ? ' ' + String(typeof r === 'object' ? JSON.stringify(r) : r).slice(0, 300) : '');
              } else {
                out.actions.push(action);
                result = 'NOCH NICHT ausgeführt: wird dem Nutzer jetzt zur Bestätigung angezeigt. Sag ihm, dass er unten auf „Ausführen“ klicken kann.';
              }
            }
        }
      } catch (e) {
        result = 'Fehler: ' + e.message;
      }
      return result;
  }
}

function stepLabel(name, a) {
  return ({
    search_mods: `sucht auf Modrinth nach „${a.query || ''}“`,
    mod_details: 'liest Mod-Details',
    web_search: `sucht im Internet nach „${a.query || ''}“`,
    read_webpage: 'liest eine Webseite',
    generate_image: 'malt ein Bild',
    remember: 'merkt sich etwas',
    forget: 'vergisst etwas',
    list_instances: 'schaut deine Instanzen an',
    list_instance_mods: 'schaut deine Mods an',
    list_worlds: 'schaut deine Welten an',
    read_game_file: `liest ${a.path || 'eine Datei'}`,
    get_format: 'holt sich das Bauformat',
    counter_docs: `schlägt Counter-Module nach (${a.query || ''})`,
    list_custom_modules: 'schaut deine eigenen Module an',
    ask_user: 'hat eine Rückfrage',
    check_instance: 'prüft alle Mods auf Probleme',
    security_check: 'prüft die Mod-Dateien auf Sicherheit',
    update_overview: 'schaut nach Updates',
    java_advice: 'berechnet RAM und Java',
    disk_usage: 'misst den Speicherplatz',
    minecraft_wiki: `liest im Minecraft Wiki „${a.title || ''}“`,
    calculate: 'rechnet',
    server_status: `prüft den Server ${a.address || ''}`,
    list_instance_content: 'schaut deine Packs an',
  })[name] || ({ install_mod: 'plant eine Installation', create_module: 'baut ein Modul', create_resourcepack: 'baut ein Ressourcenpaket', counter_config: 'plant Counter-Einstellungen', launcher_design: 'plant ein neues Design', create_instance: 'plant eine neue Instanz', launch_instance: 'plant den Spielstart', backup_world: 'plant ein Backup', build_modpack: 'plant ein Modpack' })[name] || name;
}

/**
 * Checks a key with a one-token request. Some providers list their models without a key (OpenRouter, NVIDIA),
 * so only a real request shows whether the key is accepted. A used-up limit still means "the key is valid".
 */
async function checkKey(id, key) {
  CUR = PROVIDERS[id] ? id : 'groq';
  const m = await loadModels(key);
  try {
    await groqOnce(key, { model: m.best, messages: [{ role: 'user', content: 'Antworte mit ok.' }], max_tokens: 16 });
  } catch (e) {
    if (e.limit || e.tooLarge || e.retryModel) return true;
    if (e.badKey || /unauthor|invalid|credential|not found|user/i.test(e.message)) throw Object.assign(new Error(`Der ${PROVIDERS[CUR].name}-Schlüssel wurde abgelehnt – bitte prüfen`), { badKey: true });
    throw e;
  }
  return true;
}

/** providers for the settings page (no internals) */
const providerList = () => Object.entries(PROVIDERS).filter(([id]) => id !== 'mock' && id !== 'proxy' && id !== 'proxy-openrouter').map(([id, P]) => ({ id, name: P.name, note: P.note, keyUrl: P.keyUrl || '', hint: P.hint || '' }));

module.exports = { ask, models, PREF_DEFAULTS, fitBody, providerList, PROVIDERS, checkKey };
