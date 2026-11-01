// Counter Launcher – skill library of the assistant: ready-made tasks (cards) in groups. A card sends a prepared
// request; "{input}" is asked from the user first. Own skills can be added and are kept in localStorage.
// Every skill uses the real tools of the assistant (Modrinth, Minecraft Wiki, calculator, game files …).

const SKILL_GROUPS = [
  ['Mein Spiel', '🛠', [
    ['Crash analysieren', 'Neuesten Absturz lesen und die Ursache finden', 'Lies den neuesten Crash-Report (read_game_file "crash") und prüf die Mods mit check_instance. Finde die Ursache und sag mir konkret, wie ich es behebe.'],
    ['Mods prüfen', 'Fehlende, doppelte oder falsche Mods finden', 'Prüf meine Instanz mit check_instance und erklär mir jedes Problem einfach mit der Lösung.'],
    ['Mods sicher?', 'Dateien gegen Modrinth abgleichen', 'Mach einen security_check meiner Mods und erklär mir, was die unbekannten Dateien bedeuten und ob ich mir Sorgen machen muss.'],
    ['Auf FPS optimieren', 'Mods, RAM und Einstellungen für mehr FPS', 'Optimiere meine Instanz auf maximale FPS: list_instance_mods, java_advice, options.txt lesen, passende Performance-Mods mit search_mods vorschlagen. Erklär kurz warum.'],
    ['Log zusammenfassen', 'Langes Log in 5 Sätzen', 'Lies logs/latest.log (read_game_file) und fass es in höchstens 5 Sätzen zusammen: Was lief gut, welche Warnungen und Fehler sind wichtig?'],
    ['Fehlermeldung übersetzen', 'Java-Fehler in einfachen Worten', 'Erklär mir diese Fehlermeldung in einfachen Worten und sag, was ich tun kann:\n{input}'],
    ['Updates-Wochenübersicht', 'Was ist neu und lohnt sich', 'Gib mir eine kurze Wochenübersicht mit update_overview: Welche Updates sind wichtig, was ändert sich, was kann ich bedenkenlos installieren?'],
    ['Speicherplatz & RAM', 'Was braucht Platz, wie viel RAM passt', 'Nutz disk_usage und java_advice und sag mir, was ich aufräumen kann und welche RAM-Einstellung ich nehmen sollte.'],
  ]],
  ['Mods & Modpacks', '📦', [
    ['Modpack bauen', 'Beschreibung → fertige Instanz', 'Bau mir ein Modpack: {input}. Such die Mods mit search_mods, prüf Abhängigkeiten mit mod_details und leg es dann mit build_modpack an.'],
    ['Zwei Mods vergleichen', 'Vor- und Nachteile nebeneinander', 'Vergleich diese Mods mit search_mods und mod_details (Version, Client/Server-Seite, Downloads, Abhängigkeiten) und sag, welche ich nehmen soll: {input}'],
    ['Changelog erklären', 'Was ändert ein Update für mich', 'Such mit web_search den Changelog dieser Mod bzw. dieses Updates und erklär in einfachen Worten, was es für mich ändert: {input}'],
    ['Mod konfigurieren', 'Config einer Mod erklären und einstellen', 'Lies die Config (read_game_file config/…) dieser Mod, erklär die wichtigsten Einstellungen und schlag gute Werte für meinen PC vor: {input}'],
    ['Shader-Tuner', 'Shader nach FPS-Ziel einstellen', 'Berate mich bei Shader-Einstellungen für ungefähr {input} FPS. Schau dir meine Mods und meinen PC an (java_advice).'],
    ['Alternative finden', 'Gleiche Mod, neuere/leichtere Variante', 'Finde mit search_mods Alternativen zu dieser Mod, die zu meiner Version passen: {input}'],
  ]],
  ['Minecraft-Wissen', '📚', [
    ['Rezept', 'Crafting und Brau-Rezepte', 'Sag mir das Rezept für {input} (minecraft_wiki) mit Zutaten als Checkliste.'],
    ['Brau-Assistent', 'Tränke und Zutaten', 'Erkläre mir, wie ich {input} braue: Schritt für Schritt mit Zutaten-Checkliste (minecraft_wiki).'],
    ['Verzauberungsplaner', 'Billigste Reihenfolge am Amboss', 'Plan die beste Reihenfolge am Amboss mit den niedrigsten Level-Kosten für: {input}. Rechne mit calculate nach.'],
    ['Farm-Berater', 'Welche Farm passt zu mir', 'Welche Farm lohnt sich als Nächstes für mich? Mein Stand: {input}. Gib einen Bauplan aus dem Wiki mit Materialliste.'],
    ['Handel-Rechner', 'Dorfbewohner und Smaragde', 'Hilf mir bei Dorfbewohner-Handel: {input}. Rechne Kosten mit calculate und nenne die besten Trades.'],
    ['Biom-Guide', 'Wo finde ich was', 'Wo finde ich {input}? Nenn Biome, Höhen und Tipps (minecraft_wiki).'],
    ['Ore-Höhen', 'Beste Y-Höhe zum Graben', 'Auf welcher Höhe finde ich {input} am besten in meiner Minecraft-Version? (minecraft_wiki)'],
    ['Mob-Lexikon', 'Verhalten, Drops und Kampftipps', 'Erklär mir den Mob {input}: Verhalten, Drops, Schwächen und Kampftipps (minecraft_wiki).'],
    ['Nether-Koordinaten', 'Oberwelt ↔ Nether rechnen', 'Rechne diese Koordinaten mit calculate um und sag, wo ich das Portal bauen soll: {input}'],
    ['Befehl bauen', '/execute, /give & Co. erzeugen', 'Baue mir den passenden Minecraft-Befehl für meine Version und erklär jeden Teil: {input}'],
    ['Datapack schreiben', 'Rezepte, Loot-Tabellen, Funktionen', 'Schreib mir ein Datapack (pack.mcmeta und alle Dateien mit Pfaden, jede in einem Codeblock) für meine Version: {input}'],
    ['Redstone erklären', 'Schaltung verstehen oder reparieren', 'Erklär mir diese Redstone-Schaltung bzw. such den Fehler (Wiki prüfen): {input}'],
  ]],
  ['Bauen & Design', '🎨', [
    ['Build-Planer', 'Materialliste und Bauplan', 'Plan diesen Bau mit Maßen, Ebenen und einer Materialliste (in Stacks gerechnet mit calculate): {input}'],
    ['Pixel-Art planen', 'Motiv als Blockplan', 'Plan ein Pixel-Art-Motiv aus Blöcken: {input}. Gib Größe, Palette (Blöcke mit Farbe) und eine Zeile-für-Zeile-Anleitung.'],
    ['Farbpalette', 'Passende Blöcke kombinieren', 'Schlag mir eine harmonische Block-Farbpalette (Hauptblock, Akzent, Dach, Boden, Licht) vor für: {input}'],
    ['Ressourcenpaket bauen', 'KI-Texturen, Splash-Texte, Namen', 'Bau mir ein Ressourcenpaket: {input}. Hol dir erst das Format (get_format) und nutz create_resourcepack.'],
    ['Splash-Texte', 'Neue Sprüche fürs Titelmenü', 'Schreib 20 witzige, jugendfreie Splash-Texte für mein Minecraft-Titelmenü zum Thema {input} und bau sie mit create_resourcepack in ein Paket.'],
    ['Skin-Idee', 'Skin-Konzept und Bild', 'Entwirf einen Minecraft-Skin zu: {input}. Erzeuge mit generate_image ein Konzeptbild (Vorderansicht, Pixel-Look) und beschreib die Farben pro Körperteil, damit ich ihn im Skin-Editor nachbauen kann.'],
    ['Wallpaper', 'Hintergrund für den Launcher', 'Erzeuge mit generate_image ein Wallpaper (wide) zu: {input}.'],
    ['Launcher-Design', 'Farben, Stil, Hintergrund', 'Ändere das Launcher-Design: {input}. Hol dir das Format mit get_format und nutz launcher_design.'],
    ['Namen finden', 'Welt, Server, Clan', 'Gib mir 15 kreative Namen für {input}, sortiert nach Stil.'],
  ]],
  ['Eigene Counter-Module', '🧩', [
    ['Modul bauen', 'HUD, Trigger und Tasten', 'Bau mir ein Counter-Modul: {input}. Hol erst das Format (get_format module) und die echten Modul-IDs (counter_docs).'],
    ['Counter einstellen', 'Counter-Einstellungen ändern', 'Stell Counter für mich ein: {input}. Schlag die Module und Werte mit counter_docs nach und nutz counter_config.'],
    ['Counter-Tour', 'Was kann der Client alles', 'Gib mir eine kurze Tour durch die wichtigsten Counter-Module für meinen Spielstil: {input}. Nutz counter_docs.'],
  ]],
  ['Lernen & Spaß', '🎲', [
    ['Anfänger-Lernpfad', 'Die ersten 10 Stunden geführt', 'Erstell mir einen Lernpfad für die ersten 10 Stunden Minecraft in 8 Schritten mit je einem Ziel und Tipp. Mein Stand: {input}'],
    ['Quiz', 'Minecraft-Wissen testen', 'Stell mir ein Minecraft-Quiz mit 5 Fragen (Schwierigkeit: {input}). Eine Frage nach der anderen, du wertest meine Antworten aus und zählst die Punkte.'],
    ['Achievement-Coach', 'Was ich als Nächstes holen kann', 'Welche Erfolge/Fortschritte kann ich als Nächstes leicht holen? Mein Stand: {input}'],
    ['Speedrun-Trainer', 'Legale Routen und Tipps', 'Erklär mir eine legale Speedrun-Strategie (Any% Glitchless) mit Zeitzielen und Übungsplan. Mein Stand: {input}'],
    ['Hardcore-Coach', 'Überleben ohne zweite Chance', 'Gib mir Hardcore-Tipps für die ersten 3 Tage und die gefährlichsten Situationen. Mein Stand: {input}'],
    ['Wochenplan', 'Was ich diese Woche schaffen kann', 'Mach mir einen realistischen Wochenplan für meine Welt mit 7 Zielen. Mein Stand: {input}'],
    ['Geschichte zur Welt', 'Abenteuer-Story', 'Erzähl eine spannende Abenteuer-Geschichte (ca. 250 Wörter) für meine Welt: {input}'],
    ['Bauwettbewerb', 'Thema und Bewertungskriterien', 'Gib mir ein Bauwettbewerb-Thema und ein faires Bewertungsschema (Punkte). Gruppengröße: {input}'],
    ['Turnier planen', 'Bracket, Regeln, Zeitplan', 'Plan ein Turnier für {input} Spieler: Format, Bracket, Regeln und Zeitplan.'],
    ['Tagebuch', 'Meine Session aufschreiben', 'Schreib aus diesen Stichpunkten einen kurzen Tagebucheintrag über meine Minecraft-Session im Stil eines Abenteurers: {input}'],
  ]],
  ['Eigener Server', '🌐', [
    ['Server-Config erklären', 'server.properties, Paper, Spigot', 'Erklär mir diese Server-Einstellungen und schlag Verbesserungen für Leistung und Sicherheit vor: {input}'],
    ['Plugin-Finder', 'Passende Plugins für deine Idee', 'Welche Paper/Spigot-Plugins passen für diesen Server? Erkläre kurz, wofür jedes ist (web_search zum Prüfen): {input}'],
    ['Server-Regeln', 'Regeln und Moderation', 'Schreib klare, faire Serverregeln und eine Strafen-Staffel für: {input}'],
    ['NPC-Dialoge', 'Texte für Quests und Händler', 'Schreib kurze Dialoge (max. 3 Sätze je NPC) für Quest-NPCs auf meinem Server: {input}'],
    ['Server-Empfehlung', 'Welcher Server passt zu mir', 'Empfiehl mir 5 Minecraft-Servertypen/-Netzwerke passend zu meinem Spielstil und prüf einen mit server_status: {input}'],
    ['Server prüfen', 'Online? Spieler? Ping?', 'Prüf mit server_status, ob dieser Server online ist, und sag Version und Spielerzahl: {input}'],
  ]],
];

const ownSkills = () => lsGet('cl.aiOwnSkills', []);
const bookmarks = () => lsGet('cl.aiBookmarks', []);

/** the skill window; send(text) puts the request into the current chat */
function skillsPanel(send, onClose) {
  const search = h('input', { placeholder: 'Fähigkeiten suchen …', style: 'width:100%' });
  const tabs = ['Alle', ...SKILL_GROUPS.map((g) => g[0]), 'Eigene', 'Lesezeichen'];
  let tab = 'Alle';
  const body = h('div', { class: 'skill-body' });
  const run = (title, prompt) => {
    const send_ = (t) => { onClose(); send(t); };
    if (!prompt.includes('{input}')) return send_(prompt);
    const inp = h('textarea', { rows: 3, placeholder: 'Deine Angabe …', style: 'width:100%' });
    modal(h('div', {}, h('h2', {}, title), inp, h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:14px' },
      h('button', { class: 'btn ghost', onclick: closeModal }, 'Abbrechen'),
      h('button', { class: 'btn primary', onclick: () => { const v = inp.value.trim(); if (!v) return toast('Bitte etwas eintragen', true); closeModal(); send_(prompt.replace(/\{input\}/g, v)); } }, 'Los'))));
    setTimeout(() => inp.focus(), 50);
  };
  const card = ([title, desc, prompt], icon, own, idx) => h('button', { class: 'skill-card', onclick: () => run(title, prompt) },
    h('span', { class: 'skill-ico' }, icon), h('span', { class: 'skill-t' }, title), h('span', { class: 'skill-d' }, desc),
    own ? h('i', { class: 'skill-x', title: 'Löschen', onclick: (e) => { e.stopPropagation(); const l = ownSkills(); l.splice(idx, 1); lsSet('cl.aiOwnSkills', l); draw(); } }, '×') : null);
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const match = (s) => !q || s.join(' ').toLowerCase().includes(q);
    const parts = [];
    if (tab === 'Lesezeichen') {
      const list = bookmarks();
      parts.push(list.length ? h('div', { class: 'bm-list' }, list.map((b, i) => h('div', { class: 'bm' }, h('div', { class: 'bm-q' }, b.q), markdown(b.a),
        h('div', { class: 'row' }, h('button', { class: 'btn sm ghost', onclick: () => { navigator.clipboard.writeText(b.a); toast('Kopiert'); } }, 'Kopieren'),
          h('button', { class: 'btn sm ghost danger', onclick: () => { const l = bookmarks(); l.splice(i, 1); lsSet('cl.aiBookmarks', l); draw(); } }, 'Löschen'))))) : h('div', { class: 'empty' }, h('b', {}, 'Noch keine Lesezeichen'), 'Klick bei einer Antwort auf ☆, um sie hier zu speichern.'));
    } else {
      for (const [name, icon, skills] of SKILL_GROUPS) {
        if (tab !== 'Alle' && tab !== name) continue;
        const list = skills.filter(match);
        if (list.length) parts.push(h('h3', {}, `${icon} ${name}`), h('div', { class: 'skill-grid' }, list.map((s) => card(s, icon))));
      }
      if (tab === 'Alle' || tab === 'Eigene') {
        const mine = ownSkills();
        parts.push(h('h3', {}, '⭐ Eigene'), h('div', { class: 'skill-grid' }, mine.filter(match).map((s, i) => card(s, '⭐', true, i)),
          h('button', { class: 'skill-card add', onclick: () => {
            const t = h('input', { placeholder: 'Name (z. B. „Bedwars-Tipps“)', style: 'width:100%' });
            const d = h('input', { placeholder: 'Kurzbeschreibung', style: 'width:100%' });
            const p = h('textarea', { rows: 4, placeholder: 'Was soll die KI tun? Mit {input} fragt die Fähigkeit vorher nach einer Angabe.', style: 'width:100%' });
            modal(h('div', {}, h('h2', {}, 'Eigene Fähigkeit'), h('div', { class: 'form' }, h('label', {}, 'Name'), t, h('label', {}, 'Beschreibung'), d, h('label', {}, 'Auftrag'), p),
              h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:14px' }, h('button', { class: 'btn ghost', onclick: closeModal }, 'Abbrechen'),
                h('button', { class: 'btn primary', onclick: () => { if (!t.value.trim() || !p.value.trim()) return toast('Name und Auftrag fehlen', true); const l = ownSkills(); l.push([t.value.trim().slice(0, 40), d.value.trim().slice(0, 80), p.value.trim().slice(0, 1200)]); lsSet('cl.aiOwnSkills', l); closeModal(); draw(); } }, 'Speichern'))));
          } }, h('span', { class: 'skill-ico' }, '+'), h('span', { class: 'skill-t' }, 'Neue Fähigkeit'), h('span', { class: 'skill-d' }, 'Eigener Auftrag als Knopf'))));
      }
    }
    body.replaceChildren(...parts);
  };
  search.addEventListener('input', draw);
  const tabRow = h('div', { class: 'skill-tabs' });
  const drawTabs = () => tabRow.replaceChildren(...tabs.map((t) => h('button', { class: t === tab ? 'on' : '', onclick: () => { tab = t; drawTabs(); draw(); } }, t)));
  drawTabs();
  draw();
  const count = SKILL_GROUPS.reduce((n, g) => n + g[2].length, 0);
  return h('div', { class: 'ai-studio panel skills-panel' },
    h('div', { class: 'row ai-studio-head' }, h('div', { class: 'grow' }, h('h2', {}, 'Fähigkeiten'), h('p', { class: 'sub' }, `${count} fertige Aufgaben – ein Klick, die KI macht es mit ihren Werkzeugen`)),
      h('button', { class: 'btn sm primary', onclick: onClose }, 'Schließen')),
    h('div', { style: 'padding:10px 18px 0' }, search, tabRow),
    h('div', { class: 'ai-studio-body' }, body));
}

/** local answers for the most common questions when the AI cannot be reached (offline / limit) */
const OFFLINE_FAQ = [
  [/crash|absturz|startet nicht|stürzt/i, 'Die KI ist gerade nicht erreichbar. Offline-Tipp: Instanz → Tab „Werkzeuge“ → „Gesundheitscheck“ findet fehlende Mods und falsche Versionen. Im Tab „Logs“ steht der letzte Absturz.'],
  [/fps|ruckel|lag|langsam/i, 'Die KI ist gerade nicht erreichbar. Offline-Tipp: Instanz → „Werkzeuge“ → „RAM und Java“ übernehmen, und die Mods Sodium, Lithium und Entity Culling installieren.'],
  [/ram|speicher/i, 'Die KI ist gerade nicht erreichbar. Faustregel: 3 GB Vanilla, 4–6 GB mit 40–100 Mods, 8 GB ab 200 Mods – nie mehr als die Hälfte vom PC-RAM. Unter „Werkzeuge“ → „RAM und Java“ wird es für dich berechnet.'],
  [/mod.*(installier|finden|suche)|shader/i, 'Die KI ist gerade nicht erreichbar. Offline-Tipp: Über „Entdecken“ kannst du Mods, Shader und Packs direkt auf Modrinth suchen und installieren.'],
  [/backup|sicher|welt/i, 'Die KI ist gerade nicht erreichbar. Backups findest du in der Instanz im Tab „Welten“; Mod-Backups unter „Werkzeuge“.'],
];
const offlineAnswer = (q) => (OFFLINE_FAQ.find(([re]) => re.test(q)) || [])[1] || null;
