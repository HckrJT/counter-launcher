# Counter Website

Die Website ist eine statische, dependency-freie Landingpage in `CounterLauncher/website`.
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

In `website/app.js` die leeren Werte in `COUNTER_CONFIG` ersetzen:

- `download`: echte GitHub-Release- oder Installer-URL
- `repo`: echtes öffentliches Counter-Repository
- `discord`: echte Discord-Community-URL
- `server`: echte Minecraft-Serveradresse

Keine Tokens, Client-Secrets oder privaten Zugangsdaten in diese Datei eintragen.
Die sichtbare Launch-Checkliste auf der Website hält zusätzlich fest:

- Azure/Minecraft-App-ID und Minecraft-Services-Freigabe prüfen
- Launcher-Login-Commit im gemeinsamen Stand behalten
- Windows-Release bauen, signieren und auf GitHub veröffentlichen
- Hosting, Domain und DNS verbinden
- verfügbare GitHub Student Benefits für Hosting, Domain und CI/CD nutzen
- danach den echten Download-Link eintragen
