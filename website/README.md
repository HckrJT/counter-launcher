# Counter Website

Die Website ist eine statische, dependency-freie Landingpage im Verzeichnis
`website` dieses Counter-Launcher-Repositories.
Sie nutzt das vorhandene Counter-Icon sowie die vorhandene Silkscreen-Schrift aus
`renderer/` und behauptet keine Features, Links oder Serveradressen, die noch nicht
veröffentlicht sind.

## Lokal ansehen

Aus `CounterLauncher` heraus genügt ein beliebiger statischer Server, zum Beispiel:

```powershell
python -m http.server 4173 --directory website
```

Danach `http://localhost:4173` öffnen. Alternativ kann `website/index.html` direkt
geöffnet werden; ein statischer Server ist für das Verhalten der Links aber näher an
einem echten Hosting.

## Vor dem öffentlichen Start

In `website/app.js` können die Community-Werte in `COUNTER_CONFIG` ergänzt
oder angepasst werden:

- `download`: echte GitHub-Release- oder Installer-URL (aktuell auf Release 1.20.8 gesetzt)
- `repo`: echtes öffentliches Counter-Repository (aktuell gesetzt)
- `discord`: echte Discord-Community-URL
- `server`: echte Minecraft-Serveradresse

Keine Tokens, Client-Secrets oder privaten Zugangsdaten in diese Datei eintragen.
Die sichtbare Launch-Checkliste auf der Website hält zusätzlich fest:

- Azure/Minecraft-App-ID und Minecraft-Services-Freigabe prüfen
- Launcher-Login-Commit im gemeinsamen Stand behalten
- Windows-Release bauen, signieren und auf GitHub veröffentlichen
- Hosting, Domain und DNS verbinden
- verfügbare GitHub Student Benefits für Hosting, Domain und CI/CD nutzen

Die komplette Release- und GitHub-Pages-Anleitung steht in
[`RELEASE.md`](../RELEASE.md). Der Launcher-Update-Knopf bezieht seine
Metadaten nicht von dieser Website, sondern aus GitHub Releases:
`latest.yml`, Installer und Blockmap werden automatisch durch den Release-
Workflow erzeugt.
