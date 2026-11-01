# Counter Launcher veröffentlichen

Der Launcher nutzt `electron-updater` und erwartet GitHub Releases im
Repository `HckrJT/counter-launcher`. Diese Zieladresse ist in
`src/publish.js` und im `build.publish`-Block von `package.json` absichtlich
identisch gehalten. Der Update-Knopf im Launcher funktioniert erst in einer
installierten, signierten oder unsignierten Windows-App; `npm start` ist eine
Entwicklerversion und meldet deshalb keine automatischen Updates.

## Einmalige GitHub-Einstellungen

1. Das Verzeichnis `CounterLauncher` als Inhalt des öffentlichen Repositories
   `HckrJT/counter-launcher` veröffentlichen.
2. Unter **Settings → Pages** als Quelle **GitHub Actions** auswählen.
3. Unter **Settings → Actions → General** Workflows und den Schreibzugriff auf
   Repository-Inhalte erlauben, falls die Organisation das standardmäßig
   blockiert.
4. Optional ein Code-Signing-Zertifikat als Repository-Secret konfigurieren.
   Ohne dieses Secret baut die Pipeline weiterhin einen unsignierten Installer.

## Release auslösen

Die Release-Pipeline läuft bei einem Tag wie `v1.20.1`:

```powershell
npm version patch --no-git-tag-version
git add package.json package-lock.json
git commit -m "Release Counter Launcher 1.20.1"
git tag v1.20.1
git push origin main --follow-tags
```

GitHub Actions führt danach Tests aus, baut `Counter Launcher Setup
1.20.1.exe` und lädt den Installer samt `latest.yml` und Blockmap als Release
Asset hoch. Genau diese `latest.yml` liest `electron-updater`, wenn der Nutzer
im Launcher auf **Nach Updates suchen** klickt.

## Website-Links nach dem ersten Release

`website/app.js` enthält die vier bewusst leeren Werte `download`, `repo`,
`discord` und `server`. Nach der Veröffentlichung können dort ausschließlich
die echten URLs eingetragen werden. Die Website behauptet bis dahin keinen
Download und zeigt keine erfundene Serveradresse.

## Prüfung vor dem Tag

- `npm ci --ignore-scripts`
- `npm test`
- `npm run dist`
- `git diff --check`
- Release-Tag und `package.json`-Version stimmen überein
- Azure/Minecraft-App-ID ist für Minecraft Services freigegeben
- Installer startet und der Login öffnet den Microsoft-Gerätecode-Flow
