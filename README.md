# SimpleMail

Schlanker E-Mail-Client im Stil von Spark – für **macOS** (Swift/SwiftUI, keine Fremdbibliotheken)
und **Windows** (Electron). Beide Versionen gleichen Einstellungen über das eigene Postfach ab.

**Downloads:** fertige Programme gibt es unter [Releases](../../releases)
(`SimpleMail-Windows-x64.zip`, `SimpleMail-Mac.zip`).

## Funktionen
- **Mehrere IMAP-Konten** mit Smart Inbox (Persönlich / Benachrichtigungen / Newsletter), Ordnerbaum je Konto,
  Konto- und Ordnerfarben
- **Push per IMAP IDLE**, Offline-Ablage, Offline-Warteschlange
- **Später erinnern** (Snooze) und **später senden**
- **Suche** lokal beim Tippen, ↩ durchsucht alle Ordner aller Konten auf dem Server
- **Regeln** (Absender/Empfänger/Betreff), Verschieben per Drag & Drop, Mehrfachauswahl
- **Spam- und Phishing-Schutz**: SPF/DKIM/DMARC, Markenimitate, irreführende Links, Sperrliste,
  automatischer Spamfilter, externe Bilder blockiert
- **Kalender**: Einladungen annehmen, Online-Meetings (Teams, Zoom, Meet, Webex, Jitsi …) erkennen und beitreten,
  Terminspalte (Mac: macOS-Kalender, Windows: Google-Kalender oder iCal-Link)
- **Kontakte** mit vCard-Import/-Export, Daten aus Signaturen übernehmen
- Signaturen (auch HTML), Textbausteine, formatierter Editor, Drucken/PDF, Anhänge mit Wunschprogramm öffnen
- **Synchronisation Mac ↔ Windows** über den versteckten IMAP-Ordner „SimpleMail-Sync“
  (Konten ohne Passwörter, Signaturen, Textbausteine, Regeln, Kontakte, Einstellungen – verschlüsselt)

## Aufbau
| Ordner | Inhalt |
|---|---|
| `Package.swift`, `Sources/SimpleMail/` | Mac-App (Swift Package) |
| `Assets/` | App-Symbol |
| `make_app.sh` | baut `build/SimpleMail.app` |
| `setup_signing.sh` | legt einmalig ein lokales Signatur-Zertifikat an (optional) |
| `windows/app/` | Windows-App (Electron: `main.js`, `preload.js`, `renderer/` …) |
| `windows/test/` | Playwright-Tests mit lokalem IMAP/SMTP-Testserver, `pack.js` zum Verpacken |

## Mac bauen
Voraussetzung: macOS 13+, Xcode Command Line Tools (`xcode-select --install`).
```bash
bash setup_signing.sh     # optional, einmalig
bash make_app.sh          # → build/SimpleMail.app
```

## Windows bauen und testen
Voraussetzung: Node.js 20+.
```bash
cd windows/app  && npm install
cd ../test      && npm install
node server.js &          # Testserver: IMAP 1143 / SMTP 2525, Benutzer ortie@test.local / geheim (nur lokal)
node run-all.js           # alle Tests (unter Linux: xvfb-run node run-all.js)
node pack.js              # → windows/dist/SimpleMail-win32-x64
```
Der Ordner `SimpleMail-win32-x64` wird gezippt und als `SimpleMail-Windows-x64.zip` veröffentlicht.

## Hinweise
- **Gmail, iCloud**: App-Passwort nötig (2-Faktor aktivieren). **WEB.DE / GMX**: IMAP im Webmailer freischalten.
- Outlook/Microsoft 365 verlangt OAuth und wird nicht unterstützt.
- Passwörter liegen im macOS-Schlüsselbund bzw. verschlüsselt per Windows-Datenschutz (safeStorage) – nie im Repo
  und nie im Sync-Dokument.
- **Google-Kalender (Windows)**: Jede Installation braucht eine eigene OAuth-Client-ID aus der Google Cloud Console
  (Einstellungen → Kalender). Im Code sind keine Schlüssel enthalten.
- Die Programme sind nicht von Apple bzw. Microsoft signiert: Mac → Rechtsklick → „Öffnen“,
  Windows SmartScreen → „Weitere Informationen“ → „Trotzdem ausführen“.

## Lizenz
MIT – siehe [LICENSE](LICENSE).
