<div align="center">

# Counter Launcher

**Minecraft, sauber gestartet.**
Instanzen, Mods, Microsoft-Login und ein KI-Assistent in einem Launcher – für Windows.

[**Download**](https://github.com/HckrJT/counter-launcher/releases/latest) · [Website](https://hckrjt.github.io/counter-launcher/) · [Probleme melden](https://github.com/HckrJT/counter-launcher/issues)

</div>

---

## Was Counter kann

| | |
|---|---|
| **Instanzen** | Beliebig viele Minecraft-Installationen mit eigenem Loader (Fabric, Quilt, NeoForge, Forge), RAM, Java und Icon. Dieselbe Instanz lässt sich mehrfach starten. |
| **Mods & Co.** | Mods, Ressourcenpakete und Shader direkt von Modrinth (und CurseForge) installieren, Abhängigkeiten kommen automatisch dazu. Updates mit Fortschrittsbalken und Backup davor. |
| **Import** | Profile aus NoRiskClient, Modrinth App, CurseForge, Prism/MultiMC, Lunar, Feather und dem offiziellen Launcher übernehmen – samt Einstellungen, Serverliste, Ressourcenpaketen und Shadern. |
| **Counti, der KI-Assistent** | Beantwortet Fragen, sucht Mods, baut Modpacks, liest Logs und hilft bei Abstürzen. Änderungen schlägt er vor, du bestätigst. |
| **Counter-Mod** | Der Fabric-Client-Mod mit HUD-Modulen und Menü – per Knopfdruck in jede Instanz. |
| **Laufende Spiele** | Eigenes Fenster mit allen laufenden Spielen, Live-Log und Beenden-Knopf. |
| **Microsoft-Login** | Anmeldung im normalen Browser, Tokens werden mit dem Windows-Schutz (DPAPI) gespeichert. |
| **Design** | Viele Hintergründe, Akzentfarben und Layouts. |

## Installation

1. Auf der [Release-Seite](https://github.com/HckrJT/counter-launcher/releases/latest) die Datei **`Counter-Launcher-Setup-<Version>.exe`** laden.
2. Ausführen. Windows zeigt eventuell eine SmartScreen-Warnung, weil der Installer noch nicht signiert ist („Weitere Informationen“ → „Trotzdem ausführen“).
3. Unter **Konten** auf **Mit Microsoft anmelden** klicken.

Updates kommen danach von selbst über den Launcher („Nach Updates suchen“).

**Prüfsumme:** Zu jedem Release gehört eine `latest.yml` mit dem SHA-512-Wert (Base64) des Installers. Zum Vergleichen:

```powershell
$h = (Get-FileHash .\Counter-Launcher-Setup-<Version>.exe -Algorithm SHA512).Hash
[Convert]::ToBase64String([byte[]]($h -split '(..)' -ne '' | ForEach-Object { [Convert]::ToByte($_, 16) }))
```

## Datenschutz

- Deine Microsoft-Tokens bleiben **lokal** auf deinem PC, verschlüsselt mit dem Windows-Schutz.
- Fragen an Counti (samt angehängten Dateien und Infos zur gewählten Instanz) gehen an den Counter-Server und von dort an einen KI-Anbieter (Groq oder OpenRouter), dazu ein anonymer Hash als Nutzerkennung für das Limit. Dein Microsoft-Konto und deine Tokens werden dabei nie mitgeschickt.

## Sicherheit

Schwachstellen bitte **nicht** öffentlich melden, sondern wie in [SECURITY.md](SECURITY.md) beschrieben.

## Entwicklung

```powershell
npm ci
npm start      # Launcher im Entwicklungsmodus
npm test       # Tests
```

Releases entstehen automatisch, wenn ein Tag `v*` gepusht wird (GitHub Actions baut den Installer).

---

<sub>Counter ist kein offizielles Minecraft-Produkt und nicht mit Mojang oder Microsoft verbunden. © Counter</sub>
