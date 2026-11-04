# Sicherheit

## Schwachstelle melden

Bitte melde Sicherheitslücken **nicht** als öffentliches Issue.
Nutze stattdessen auf GitHub **Security → Report a vulnerability** (privater Bericht an die Maintainer).

Beschreibe kurz, was passiert, wie man es nachstellt und welche Version betroffen ist.
Du bekommst eine Antwort, sobald es geht – und wir melden uns, wenn es behoben ist.

## Unterstützte Versionen

Nur der jeweils **neueste Release** bekommt Sicherheitskorrekturen. Der Launcher aktualisiert sich selbst.

## Was Counter schützt

- Microsoft-Tokens werden mit dem Windows-Schutz (DPAPI) verschlüsselt gespeichert.
- Das Oberflächenfenster läuft im Sandbox-Modus ohne Node-Zugriff und mit Content-Security-Policy.
- Dateien in Modpacks und Exporten werden nie außerhalb des Instanz-Ordners geschrieben.
- KI-Zugangsschlüssel liegen nur auf dem Counter-Server, nie im Launcher oder in diesem Repository.

Counter fragt dich nie nach deinem Microsoft-Passwort. Die Anmeldung läuft ausschließlich im Browser auf `login.microsoftonline.com`.
