# Alltagstest SimpleMail für den Mac (ab 2.29)

Dauer etwa 15 Minuten. Du brauchst zwei Konten in SimpleMail (z. B. Büro + Gmail) und dein Handy als
„Zweitgerät“ (Mail-App oder Gmail-App mit denselben Konten). Hake ab, was passt. Notiere bei ✗ kurz, was passiert ist.
Die Windows-Version prüft genau diese Abläufe automatisch (`winapp-test/test-alltag.js`).

## 1. Start
- [ ] App starten: Smart Inbox über alle Konten ist ausgewählt, alle Konten mit Unterordnern aufgeklappt
- [ ] Liste ist in unter 1 Sekunde da (aus dem Zwischenspeicher), Ordnerbaum sofort sichtbar
- [ ] Gmail: Ordner unter „[Gmail]“ heißen richtig (Entwürfe mit ü, Gesendet, Papierkorb, Spam);
      es gibt **keinen** zusätzlichen Ordner „Spam“ neben „[Gmail]/Spam“
- [ ] Newsletter und Benachrichtigungen stehen in ihren Gruppen, nicht unter „Persönlich“

## 2. Lesen und Antworten
- [ ] Ungelesene Mail anklicken: Text sofort da, gelber Punkt weg, Zähler links sinkt
- [ ] Handy: dieselbe Mail ist dort auch gelesen
- [ ] ⌘R antworten, kurz tippen, senden: Fenster schließt, Mail liegt in „Gesendet“ (auch bei Gmail genau einmal)
- [ ] ⌘N, oben das andere Konto als Absender wählen, senden: Empfänger sieht die richtige Absenderadresse

## 3. Neue Mails im Laufe des Tages
- [ ] Vom Handy eine Mail an dich schicken: erscheint ohne Klick in wenigen Sekunden (Push ⚡ in der Seitenleiste)
- [ ] Am Handy eine Mail als gelesen markieren → in SimpleMail nach wenigen Sekunden gelesen
- [ ] Am Handy eine Mail löschen → verschwindet in SimpleMail

## 4. Regeln und Spam
- [ ] Regel anlegen: Betreff enthält „Rechnung, Invoice“ → Ordner „Projekte“, als gelesen.
      Testmail mit „Rechnung 123“ schicken: landet direkt in „Projekte“, gelesen
- [ ] Eine Newsletter-Mail „Als Spam markieren“: liegt im Spam-Ordner; dort „Kein Spam“: wieder im Posteingang
- [ ] „Spam“ unter Kategorien zeigt den Spam beider Konten

## 5. Aufräumen
- [ ] Mail mit ⌫ löschen: nächste Mail ist ausgewählt, keine springende Liste; Mail liegt im Papierkorb
- [ ] Gmail-Mail archivieren (E): raus aus dem Posteingang, in „Alle Nachrichten“ noch da
- [ ] Mail per Ziehen in einen Ordner des **anderen** Kontos: dort vorhanden, im Quellkonto weg
- [ ] Drei Mails mit ⌘-Klick wählen und löschen: alle drei im Papierkorb

## 6. Suchen, Später, Kontowechsel
- [ ] ⌘F, Wort aus einem Betreff tippen: Liste filtert sofort
- [ ] Wort aus dem Text einer Mail in einem Unterordner + Enter: Treffer mit Ordnername, keine Dubletten
      (bei Gmail auch Mails mit Label)
- [ ] Mail „Später“ → in 1 Stunde (oder eigene Zeit in 2 Minuten): verschwindet, steht unter „Später“,
      kommt danach ungelesen zurück
- [ ] Oben ein Konto anklicken: nur dessen Mails, Wechsel ohne spürbare Pause; ⌘N nimmt dieses Konto als Absender

## 7. Verbindungsabbruch (neu in 2.29)
- [ ] WLAN aus. Eine Mail löschen, eine als gelesen markieren. Keine rote Fehlermeldung, nur „offline“
- [ ] WLAN wieder an, ⌘⇧N (Abrufen) oder warten: Löschen und Gelesen kommen auf dem Server an (Handy prüfen),
      die gelöschte Mail taucht nicht wieder auf
- [ ] Nach WLAN an: Mail vom Handy schicken → kommt ohne Klick (Push hat sich neu verbunden)
- [ ] WLAN aus, Mail löschen, **App beenden**, WLAN an, App starten: Mail bleibt weg und ist auch am Handy gelöscht
- [ ] Deckel zu (5 Min.), wieder auf: neue Mails kommen, keine hängende Fehlermeldung

## 8. Neustart und Last
- [ ] App beenden und neu starten: Liste sofort da, Regel und „Später“-Einträge noch vorhanden
- [ ] Großer Ordner (z. B. Gmail „Alle Nachrichten“) öffnen und mit ↓ schnell durchblättern: flüssig
- [ ] Aktivitätsanzeige: SimpleMail nach 10 Minuten Nutzung unter etwa 500 MB Speicher

**Ergebnis zurückmelden:** einfach die Nummern mit ✗ nennen (z. B. „3.2 ✗, Mail kam erst nach 5 Min.“).
