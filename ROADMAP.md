# Counter Roadmap

Gewählt am 30.10.2026: Nr. 1, 2, 4–311, 350 aus der großen Ideenliste (nicht gewählt: 3, 312–349).
Reihenfolge: erst Launcher und KI (als Update zum Download), danach der Counter-Mod. Abhaken mit [x].

## Phase 1 – Launcher und KI (Update 1.12.0, Installer lokal gebaut, Release steht aus)
- [x] 4 Crash-Autodoktor (Knopf im Absturz-Fenster)
- [x] 5 Modpack-Generator (KI-Aktion build_modpack, Vorlagen)
- [x] 6 Konflikt-Scanner (Gesundheitscheck im Tab Werkzeuge)
- [x] 7 Wochenübersicht der Mod-Updates (Startseite + KI)
- [x] 8 Reserve-Anbieter im Worker-Code (Workers AI; aktiv erst mit Binding `AI` im Cloudflare-Dashboard, mit echter Antwort noch ungetestet)
- [x] 9 Eigene Module: Vorschau, Verwaltung · 10 Teilen per Code (zentrale Galerie braucht einen Server)
- [x] 11–36, 39–65 KI-Fähigkeiten (54 Karten), Lesezeichen, Gedächtnis-Export, Kindermodus, Offline-Hilfe, Sicherheitscheck
- [ ] 37 Chat-Übersetzung im Spiel (Mod) · 38 Persönlichkeiten-Marktplatz (Server nötig)
- [x] 185 Mod-Backup vor Updates · 186 Instanz-Code · 187 Mod-Profile · 189 RAM/Java · 192 Design-Codes
- [x] 188 Start- und Absturz-Statistik (Karte „Start & Stabilität“)
- [x] 195 Spielzeit-Statistik (bestand) · 200 Startassistent · 204 Speicherplatz · 206 Vorlagen · 208 Versionswechsel
- [x] 210 Mod-Sperre · 211/212 Notizen und Tags · 213 Massenaktionen · 224 Startoptionen (bestand) · 237 Einstellungen ex/import
- [x] 240 Gesundheitscheck · 245/246 Spielzeit-Limit mit PIN
- [x] 252/257 animierte Akzentfarbe, Nachtmodus · 269 Akzentfarbe aus Skin
- [x] 274 Wochen-Challenges · 275 Erfolge · 279 Neuigkeiten-Popup · 281 Snake · 283 „Dein Counter-Jahr“
- [x] 286 Tests (`npm test`)
- [x] Launcher 1.13.0/1.14.0: 202 PC-Check, 205 doppelte Mods (Hardlinks), 209 Abhängigkeitsbaum, 216 Sammlungen, 217 Welt kopieren, 225 Desktop-Verknüpfung, 258 Klick-Töne, 265 Hochkontrast, 288 Fehlerprotokoll, 300 Datenschutz-Seite, 304 Beta-Kanal, 309 Spieldateien reparieren, Modul-Katalog (14 fertige Module, Teil von 71–164)
- [x] 190/191 Discord-Status (Einstellungen → Discord-Anwendungs-ID aus discord.com/developers; per Mock-Pipe getestet, mit echtem Discord ungetestet)
- [ ] [x] 193 fünf neue Szenen (Schneenacht, Datenregen, Nebel, Retro-Gitter, Kirschblüten; `renderer/scenes2.js`) · [x] 194 Skin-Posen (Jubeln, Denken, Sitzen, Dab, Schleichen) · 196–199 · 201–203 · 205 · 207 · 209 · 214–223 · 225–236 · 238–244 · 247–250
- [ ] 253–256, 258–268, 270–273, 276–278, 280, 282, 284–285
- [ ] 287 KI-Benchmark · 288–310 (Crash-Reporting, Delta-Updates, Signierung, Worker-Dashboard …)

## Phase 2 – Counter-Mod (Versionen)
- [x] 66 26.3 (Counter 1.15.0-mc26.3 am Release v1.15.0, im Spiel getestet: Menü, Schrift, KI)
- [ ] 67 1.21.x · 69 1.20.x · 68 1.8.9 · 70 Forge/NeoForge

## Phase 3 – Counter-Mod (KI im Spiel, Module, HUD)
- [x] 1 KI im Spiel (Taste K, Counter 1.14.0, im Spiel auf 26.1.2 getestet)
- [ ] 2 Screenshot-Analyse (braucht ein Modell mit Bilderkennung)
- [x] Counter 1.15.0: neues Einstellungs-Menü (Simple/Advanced, Kosten-Hinweise), flaches ESC-Menü, 21 Schriften (Standard Inter), Kompatibilitäts-Netz für andere Mods (Sodium, Iris, Lithium, FerriteCore, ImmediatelyFast, Entity Culling getestet)
- [~] 71–164 Module und HUD: 155 Module (52 neue Kacheln, alle im Spiel auf 26.1.2 geprüft: Luft, Hand, Chunk, Modus, Dimension, Schwierigkeit, Frame, Leben, Hunger, Haltung, Slots, Zweithand, Ziel, Vertikal, Punkte, Effekte, Werkzeug, Stapel, Angriff, Nächster, Fenster, GUI, Java, CPU, Mods, Name, Online, Datum, Wetter, Sicht, Kamera, Fahrzeug, Block unten, 4× Rüstungs-Haltbarkeit, Max-Leben, Absorption, Feuer, Frost, Tempo, Schaden, Reichweite, Nether-Koordinaten, Gelaufen, Ticks, Ziel-Leben, Empfindlichkeit, FOV, Max-FPS, Sprache)

- [x] KI baut jetzt Module, die das Spiel wirklich verändern (`features` = eingebaute Counter-Module mit Einstellungen, `options` = Spiel-Optionen; wird beim Ausschalten zurückgesetzt; im Spiel geprüft) · Ollama als lokaler Anbieter · Begrüßungs-Antworten werden korrigiert · Modpack-Regeln (viele = 30+/60+ Mods)
- [x] Better Animations (Modul schaltet die Mod Punchy! über den Launcher ein/aus, wirkt nach Neustart) · eigene Linien-Icons für alle Module (`tools/gen_icons.py`) · Modulkarten mit Beschreibung und NEW-Tag
- [x] Neue Module: Uptime, Stapel droppen, rahmenloser Vollbildmodus, Verlassen bestätigen, Tetris, Pong (im Spiel geprüft), Auto-Reconnect (ungetestet)
- [ ] Aus der Bilder-Liste noch offen: Tab-Editor, Hide Armor, Shield Status, Motionblur, Farbsättigung, Glint-Farbe, TNT-Timer, Titles/Action-Bar-Position, 3D-Skin, Wavey Capes, Jump Reset (bewusst nicht)

## Phase 4 – Multiplayer und Freunde (brauchen einen Online-Dienst)
- [ ] 165–184

## Phase 5 – Website und Counter 2.0
- [x] 350 Counter 2.0 Launcher-Design: Aurora-Hintergrund, Gleit-Indikatoren (Leiste, Tabs), Glas-Rahmen, Scroll-Einblendung, Klick-Wellen, Staub-Partikel, Feder-Animationen (Einstellungen → Design → „Counter 2.0“, `renderer/v2.css` + `v2.js`)
- [x] 350 Mod-Menü 2.0: Primär-Buttons atmen, aktive Modulkarten mit fließendem Leucht-Rahmen (im Spiel geprüft) · [ ] 311 Website
- [~] 1.21.11-Port: kompiliert, startet, Welt-Beitritt und KI-Antwort laufen; Sicht-/Mixin-Prüfung steht aus (kommt nach der Liste)

## Braucht etwas von dir
- Release 1.12.0 veröffentlichen (Token nur in deinem Terminal)
- Worker-Code neu einfügen und Binding `AI` hinzufügen (Reserve-Anbieter)
- 198 macOS/Linux: macOS-Build geht nur auf einem Mac
- 291 Code-Signing: kostet ein Zertifikat (ca. 100–400 €/Jahr)
- 177 Minispiel-Statistiken: jeder Nutzer braucht seinen eigenen Hypixel-API-Key
- 168–171, 180–181 Freunde/Chat/Clans: brauchen einen Online-Dienst (Cloudflare Worker + Datenbank, kostenlos möglich)
