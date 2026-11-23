SimpleMail 2.1 für Windows 10/11
================================

Installation (ab 3.2.40 besser: SimpleMail-Setup-<Version>.exe ausführen – siehe „Neu in 3.2.40“)
1. ZIP-Datei entpacken, z. B. nach  C:\Programme\SimpleMail  oder  %LOCALAPPDATA%\SimpleMail
   (der Ordner muss dauerhaft bleiben).
2. SimpleMail.exe starten. Beim ersten Start legt SimpleMail einen Eintrag im Startmenü an –
   danach lässt es sich über Start → „SimpleMail“ öffnen und an die Taskleiste anheften.
3. Windows SmartScreen meldet evtl. „Unbekannter Herausgeber“ (die App ist nicht signiert):
   „Weitere Informationen“ → „Trotzdem ausführen“.

Konto einrichten
- Gmail/Googlemail: 2-Faktor aktivieren, App-Passwort erzeugen, Vorlage „Gmail“ wählen.
- WEB.DE/GMX: IMAP im Webmailer unter Einstellungen → POP3/IMAP freischalten.
- Outlook.com/Microsoft 365 verlangen meist OAuth und funktionieren daher oft nicht.

Funktionen
Mehrere Konten mit Smart Inbox, Ordner, Push (IMAP IDLE), Mitteilungen, Taskleisten-Badge,
Später erinnern, Später senden, Textbausteine, Adressvorschläge, Signatur je Konto,
Anhänge (öffnen, sichern, Drag & Drop), Suche im Postfach, externe Bilder blockiert.

Neu in 2.1
- Formatierte HTML-Signatur je Konto (Logo, Farben, Links; Signaturen aus Outlook/Word einfach hineinkopieren)
- Offline-Ablage: schneller Start, die neuesten Mails sind auch ohne Internet lesbar
  (Einstellungen → Offline & Sync)
- Synchronisation mit SimpleMail auf dem Mac: Konten (ohne Passwörter), Signaturen, Textbausteine,
  Erinnerungen und Bild-Freigaben – über den versteckten Ordner „SimpleMail-Sync“ im eigenen Postfach.
  Auf allen Geräten unter Einstellungen → Offline & Sync dasselbe Konto wählen.

Neu in 3.2.41
- Konto oben in der Seitenleiste wählen zeigt jetzt immer den ganzen Posteingang dieses Kontos (Smart Inbox).
  Vorher blieb eine gefilterte Ansicht wie „Benachrichtigungen“, „Ungelesen“ oder „Markiert“ stehen – dadurch
  fehlten scheinbar Mails, z. B. die unter „Persönlich“. „Persönlich“ ist nur eine Ansicht, die Mails bleiben im Posteingang.

Neu in 3.2.40
- Zwei Varianten zum Herunterladen:
  • SimpleMail-Setup-<Version>.exe – Installer ohne Administratorrechte (nach %LOCALAPPDATA%\Programs\SimpleMail),
    mit Startmenü- und auf Wunsch Desktop-Verknüpfung, Deinstallation über „Apps & Features“. Updates einfach
    drüberinstallieren; Konten und Einstellungen (%APPDATA%) bleiben erhalten – auch bei einer Deinstallation.
  • SimpleMail-Windows-portable.zip – entpacken und SimpleMail.exe starten. Solange portable.txt neben der EXE
    liegt, stehen alle Daten im Unterordner „Daten“ (z. B. für USB-Stick). Kein Startmenü-Eintrag, keine
    automatische Anmeldung als Mailprogramm. Passwörter gelten nur für das Windows-Konto, unter dem sie
    eingegeben wurden. Wer bisher die Zip-Version benutzt hat und seine Daten behalten will: Installer nehmen.
- Regeln können eine Kopie ablegen: Einstellungen → Regeln → „Kopie ablegen in“ – Konto und Ordner wählen
  (auch ein anderes Konto). Das Original bleibt im Posteingang bzw. wird wie eingestellt verschoben.
  Beispiel: Mails an vorstand@… bleiben im Vorstand-Konto und landen zusätzlich im web.de-Ordner „PWFN Fernwärme“.
  Jede Mail wird nur einmal kopiert (auch wenn Mac und Windows gleichzeitig laufen); „Regeln jetzt anwenden“
  kopiert auch bereits vorhandene passende Mails. Wird mit dem Mac synchronisiert.

Neu in 3.2.39
- Regeln können E-Mails weiterleiten: Einstellungen → Regeln → „Weiterleiten an“ (mehrere Adressen mit Komma).
  Die Mail geht als „WG: …“ über das Konto der Regel hinaus, das Original mit allen Anhängen hängt als .eml an.
  Gilt nur für neu eingehende Mails. Schutz vor Schleifen: Weiterleitungen von SimpleMail, Mails eigener Konten und
  Fehlermeldungen (Mailer-Daemon) werden nie weitergeleitet; läuft SimpleMail auf Mac und Windows gleichzeitig,
  wird trotzdem nur einmal weitergeleitet. Wird mit dem Mac synchronisiert.

Neu in 3.2.38
- Wichtige Ordner farbig: Rechtsklick auf einen Ordner in der linken Spalte → „Schriftfarbe …“
  (10 Farben oder „Keine Farbe“). Die Farbe wird mit dem Mac synchronisiert und bleibt beim Umbenennen erhalten.

Neu in 3.2.37
- SimpleMail als Standard-Mailprogramm: Einstellungen → Darstellung & Datenschutz → „Als Standard-Mailprogramm
  festlegen …“. SimpleMail meldet sich bei Windows an und öffnet „Standard-Apps“; dort bei SimpleMail
  „Als Standard festlegen“ klicken (Windows erlaubt das nur per Klick). E-Mail-Links aus Browser und anderen
  Programmen öffnen dann den SimpleMail-Editor. Die Anmeldung wird bei jedem Start erneuert, falls der
  Ordner verschoben oder ersetzt wurde.

Neu in 3.2.36
- Gemeinsame Ordner „Gesendet“ und „Papierkorb“ in der Seitenleiste: zeigen die Gesendet- bzw. Papierkorb-Ordner
  aller Konten zusammen (nach Datum, mit Kontofarbe; mit Kontofilter nur dieses Konto). In „Gesendet“ steht der
  Empfänger statt des Absenders. Mails lassen sich darauf ziehen (landen im Ordner ihres Kontos),
  Rechtsklick auf „Papierkorb“ → „Papierkorb aller Konten leeren …“. Ansicht → Strg+6 / Strg+7.

Neu in 3.2.35
- Menüleiste nochmals deutlich größer (18 px); rechts in der Leiste steht die laufende Version.

Neu in 3.2.34
- Erinnerung an die Google-Neuanmeldung (Google-Testmodus: Anmeldung gilt 7 Tage): ab Tag 6 gelber Hinweis
  oben im Fenster mit „Jetzt neu anmelden“ (Client-ID und Schlüssel bleiben gespeichert), zusätzlich eine
  Windows-Benachrichtigung. Ist die Anmeldung abgelaufen, wird der Hinweis rot. „Später“ blendet 4 Stunden aus.
- Auch unter Datei → „Google Kalender neu anmelden“ und Einstellungen → Kalender (dort abschaltbar).

Neu in 3.2.33
- Menüleiste (Datei, Bearbeiten, E-Mail, Ansicht, Hilfe) mit größerer Schrift. Bedienung wie gewohnt:
  Maus, Alt bzw. F10, Alt+Buchstabe (z. B. Alt+D = Datei), Pfeiltasten, Enter, Esc.

Neu in 3.2.32
- Einstellungen → Kalender zeigt Client-ID und Clientschlüssel (verdeckt) auch bei bestehender Google-Verbindung.

Neu in 3.2.31
- Google Kalender: Client-ID und Clientschlüssel werden mit der Synchronisation an deine anderen
  Windows-PCs übertragen. Auf einem neuen PC nur noch Einstellungen → Kalender → „Mit Google verbinden“
  klicken und im Browser anmelden (die Anmeldung selbst gilt je PC und wird nicht übertragen).

Neu in 3.2.30
- Suchfeld über der Mailliste größer, mit größerer Schrift und gelb hervorgehoben (auch im dunklen Modus).

Neu in 3.2.29
- Mails auf „Persönlich“, „Benachrichtigungen“ oder „Newsletter“ ziehen: der Absender landet ab sofort immer
  in dieser Kategorie (auch künftige Mails, wird mit dem Mac synchronisiert). Liegt die Mail in einem anderen
  Ordner, kommt sie zurück in den Posteingang. Aufheben unter Einstellungen → „Absender mit fester Kategorie“.
- Beim Ziehen einer Mail scrollt die linke Spalte automatisch, wenn die Maus am oberen oder unteren Rand ist.

Neu in 3.2.28
- Smart Inbox wie bei Spark: Benachrichtigungen und Newsletter stehen oben als einklappbare Zeile mit Anzahl
  („3 neu“), darunter die persönlichen Mails. Klick auf die Zeile klappt auf bzw. zu; der Zustand bleibt erhalten.

Neu in 3.2.27
- Mails lassen sich auf „Spam“ unter Kategorien ziehen – sie landen im Spam-Ordner ihres Kontos
  (vorher nahm dieser Eintrag nichts an).

Neu in 3.2.26
- Nach dem Start zeigen Smart Inbox und Kontoansicht wieder alle Mails: jedes Konto erscheint, sobald es
  abgerufen ist. Vorher hielt ein langsames oder hängendes Konto (z. B. iCloud) die Anzeige aller Konten auf –
  vollständig war nur der direkt angeklickte Posteingang.
- Direkt angeklickter Posteingang und Smart Inbox zeigen immer dieselben Mails.
- Start ohne Netz: SimpleMail versucht es nach 5, 15, 30 und 60 Sekunden erneut statt erst nach 5 Minuten.

Neu in 3.2.25 (aus dem Alltagstest)
- Ohne Verbindung (WLAN weg, Laptop zugeklappt) gelöschte, verschobene, archivierte oder als gelesen/markiert
  gesetzte Mails gehen nicht mehr verloren: SimpleMail merkt sich die Aktion und holt sie beim nächsten Abruf
  nach – auch nach einem Neustart. Vorher tauchte die Mail nach 10 Minuten wieder auf.
- Nach einem Verbindungsabbruch verbindet sich Push neu und holt verpasste Mails sofort ab
  (vorher erst beim nächsten 5-Minuten-Abruf). Abgerissene Verbindungen zeigen „offline“ statt einer
  Fehlermeldung, die auch nach der Wiederverbindung stehen blieb.
- Tastenkürzel: Strg+Umschalt+F leitet wieder weiter (sprang ins Suchfeld), Strg+Umschalt+N ruft ab
  (öffnete eine neue Mail).
- Für Entwickler: winapp-test/test-alltag.js spielt einen ganzen Arbeitstag mit zwei Konten (eins Gmail-artig)
  durch, winapp-test/run-all.js führt alle Tests aus.

Neu in 3.2.24
- Gesendete Mails werden wieder zuverlässig in „Gesendet“ abgelegt, auch bei Konten mit Gmail als
  IMAP-Server und einem anderen SMTP-Server. Klappt das Ablegen nicht, erscheint eine Meldung.
- Versandprotokoll „versand.log“ im Datenordner (Hilfe → Über zeigt ihn): Zeit, Konto, Empfänger und
  Antwort des Mailservers – ohne Mailinhalt. Hilft, wenn eine Mail nicht ankommt.

Neu in 3.2.23
- Der Ordnerbaum aller Konten wird gespeichert und steht beim Start sofort aufgeklappt da.
  Die Ordner werden parallel zum Posteingang aktualisiert, die Zähler danach nachgetragen.

Neu in 3.2.22
- Beim Start ist immer die Smart Inbox über alle Konten ausgewählt (kein Kontofilter aus der letzten Sitzung);
  alle Konten werden mit ihren Unterordnern in der Seitenleiste angezeigt.

Neu in 3.2.21 (Sicherheit)
- Drucken: Bilder aus Mails dürfen keine Dateien von fremden Netzlaufwerken mehr laden
  (sonst hätte Windows dabei Anmeldedaten an einen fremden Server geschickt).
- Gefälschte Absender: Schlägt die Absenderprüfung (DMARC/SPF) fehl, gilt eine Mail „von dir selbst“,
  von Kontakten oder vertrauenswürdigen Absendern nicht mehr als sicher – sie kann im Spam landen
  und lädt keine externen Bilder.
- Synchronisation: Es werden nur Sync-Daten übernommen, die SimpleMail selbst im eigenen Postfach
  abgelegt hat – keine von außen zugestellten.
- Electron 45.3.2.

Neu in 3.2.20
- Gelesen bleibt gelesen: Eine geöffnete oder markierte Mail springt nicht mehr durch einen
  gerade laufenden Abruf auf „ungelesen“ zurück (blieb vorher v. a. bei Gmail lange in „Ungelesen“).
  Der Gelesen-Status geht sofort an den Server, nicht erst nach dem Laden des Textes.
- Ordner öffnen schneller: Der Posteingang eines Kontos erscheint sofort, andere Ordner zeigen
  zuerst den gespeicherten Stand und warten nicht mehr auf den Abruf aller Konten.
- Bessere Einordnung in Persönlich / Benachrichtigungen / Newsletter: Absender aus dem Adressbuch
  und eigene Adressen immer „Persönlich“, Bestell-/Versand-/Kontomails mit Abmelde-Link als
  Benachrichtigung, „noreply“ usw. nur im Teil vor dem @. Vorhandene Mails im Posteingang
  werden einmal neu eingeordnet.
- Gmail/Googlemail: Gmails eigene Kategorien (Allgemein, Updates, Werbung, Soziale Netzwerke, Foren)
  werden übernommen. Suche nur in Posteingang + „Alle Nachrichten“ (statt jedes Label einzeln),
  keine Zähler für „Alle Nachrichten“/„Wichtig“/„Markiert“ (schnelleres Laden).
  App-Passwort darf mit Leerzeichen eingegeben werden. gmail.com = googlemail.com bei Spam/Kontakten.
- Spamfilter: DMARC-Fehler ohne Sperr-Richtlinie (p=none, z. B. Weiterleitungen) zählt nur 2 statt 4 Punkte.

Neu in 3.2.19
- Spürbar flüssiger: Beim Öffnen, Auswählen oder Markieren einer Mail werden nur noch die
  geänderten Zeilen der Liste neu gezeichnet statt der ganzen Liste (bei 200 Mails rund 7-mal
  schneller, bei mehr Mails noch deutlicher). Nicht sichtbare Zeilen werden nicht gezeichnet.
- Zähler der Seitenleiste in einem Durchgang, „Später“-Einträge über einen Index.
- Suche filtert nach einer kurzen Tipp-Pause statt bei jedem Buchstaben.
- Sync-Verschlüsselung blockiert das Programm nicht mehr kurz bei jedem Abgleich.

Neu in 3.2.18
- Suche: Strg+F springt ins Suchfeld über der Mailliste. Beim Tippen wird die Liste gefiltert,
  Enter durchsucht auf dem Server Betreff, Absender und Text in allen Ordnern aller Konten
  (inkl. Gesendet, Entwürfe und eigene Ordner; ohne Papierkorb und Spam). Treffer erscheinen
  sofort nach jedem Ordner und zeigen ihren Ordnernamen. In einer Ordneransicht wird nur
  dieser Ordner durchsucht. Esc leert die Suche.

Neu in 3.2.17
- Klick auf eine E-Mail-Adresse in einer erhaltenen Mail öffnet jetzt den SimpleMail-Editor
  mit dieser Adresse (auch Links mit Betreff/Cc/Text, auch im eigenen Mail-Fenster).
  Absender, An und Cc im Mailkopf sind ebenfalls anklickbar.

Neu in 3.2.16
- Rechtsklick in der linken Seitenleiste:
  Ordner: Alle als gelesen, Neuer Unterordner, Umbenennen, Ordner löschen (mit Rückfrage;
  Posteingang, Gesendet, Entwürfe, Archiv, Spam und Papierkorb sind geschützt),
  Papierkorb/Spam: „leeren“ (endgültig, mit Rückfrage).
  Konten: Alle als gelesen, Neuer Ordner, Konto bearbeiten, Konto entfernen (mit Rückfrage).
  Smart Inbox, Ungelesen, Kategorien: Alle als gelesen; Markiert: Markierungen entfernen;
  Später: alle zurückholen; Geplant: alle verwerfen; Spam: Spam aller Konten leeren;
  Kontakte: Neu, Importieren, Exportieren.
  Regeln, die in einen umbenannten Ordner verschieben, werden automatisch angepasst.

Neu in 3.2.15
- Online-Meetings: „Neuer Termin / Online-Meeting“ (Terminspalte ＋, Datei-Menü, Strg+Umschalt+M)
  mit Microsoft Teams, Zoom, Google Meet, Webex, Jitsi oder eigenem Link. Teilnehmer bekommen eine
  echte Kalender-Einladung (.ics), die Outlook, Apple Kalender und Google annehmen können.
  Google Meet: bei verbundenem Google Kalender wird automatisch ein neuer Meet-Link angelegt;
  Jitsi erzeugt einen Raum ohne Konto; Teams/Zoom/Webex über den eigenen Link (fest hinterlegbar
  unter Einstellungen → Kalender → Online-Meetings, wird mit dem Mac synchronisiert).
- Einladungen: Meeting-Link wird erkannt (Teams, Zoom, Meet, Webex, GoTo, Jitsi, Whereby, Skype),
  „Beitreten“ und „Link kopieren“ direkt in der Einladung; Zusagen/Vielleicht/Absagen wie bisher
  mit Antwort an den Organisator. Auch Mails ohne Einladung mit Meeting-Link zeigen „Beitreten“.
- Terminspalte: „Beitreten“ an Terminen mit Meeting-Link (ab 15 Minuten vor Beginn hervorgehoben)

Neu in 3.2.14
- Seitenleiste → Kategorien → „Spam“: zeigt den Spam aller Postfächer zusammen
  (mit Konto-Filter nur den des gewählten Kontos); „Kein Spam“ holt Mails zurück

Neu in 3.2.13
- Spam-Ordner wird bei eingeschaltetem Spamfilter sofort angelegt (nicht erst beim ersten Spam)
  und steht in der Seitenleiste unter dem Konto

Neu in 3.2.12
- Automatischer Spamfilter: neue Mails im Posteingang werden geprüft (Spam-Kennzeichnung des Servers,
  SPF/DKIM/DMARC, nachgeahmte Firmen, typische Spam-Betreffs) und in den Spam-Ordner verschoben.
  Fehlt der Ordner, wird „Spam“ angelegt. Ein/aus und Empfindlichkeit unter Einstellungen → Datenschutz;
  wird mit dem Mac synchronisiert. Kontakte und vertrauenswürdige Absender werden nie aussortiert.
- „Kein Spam“ verschiebt zurück in den Posteingang und merkt den Absender als vertrauenswürdig

Neu in 3.2.11
- Kontakte: Bearbeiten nach „Zu Kontakten“ / „Kontakt ergänzen“ funktioniert zuverlässig.
  Ein Sync-Abgleich oder Mail-Abruf baut das Formular beim Tippen nicht mehr neu auf
  (Cursor sprang heraus, gerade Getipptes ging verloren)

Neu in 3.2.10 (Sicherheit)
- Programme und Skripte im Anhang (.exe, .bat, .js, .lnk …) werden nicht mehr direkt geöffnet, nur gesichert.
  Getarnte Namen wie „rechnung.exe “ oder „rechnung.exe.“ werden erkannt
- Geöffnete und gesicherte Anhänge sind als „aus dem Internet“ markiert: Word/Excel nutzen die
  geschützte Ansicht, Windows SmartScreen warnt vor Programmen
- Temporäre Kopien geöffneter Anhänge werden nach 24 Stunden gelöscht
- Aktuelle Electron-Version (45) mit allen Sicherheitsupdates
- Verbindungen über Port 143 (IMAP) bzw. 25/587 (SMTP) nur noch verschlüsselt (STARTTLS Pflicht)
- Mit Sync-Passwort werden nur noch verschlüsselte Sync-Daten übernommen
- Konten vom anderen Gerät: Serverdaten werden vor dem ersten Passwort angezeigt und bestätigt

Neu in 3.2.9
- Rechtsklick auf einen Anhang zeigt immer Word, LibreOffice und Wordcraft. Wird ein Programm nicht
  automatisch gefunden, kann man es mit „Programm suchen …“ selbst auswählen (wird gemerkt)
- Auch im eigenen Mail-Fenster: Rechtsklick auf einen Anhang → „Öffnen mit …“
- Einstellungen → Darstellung & Datenschutz → Anhänge öffnen: Knöpfe zum Suchen der Programme

Neu in 3.2.8
- Anhänge öffnen mit dem passenden Programm: Word-Dokumente (.docx, .doc, .odt, .rtf) wahlweise mit
  Microsoft Word, LibreOffice oder Wordcraft (Einstellungen → Darstellung & Datenschutz → Anhänge öffnen),
  PDF mit dem Standard-PDF-Reader von Windows
- Rechtsklick auf einen Anhang: „Öffnen mit …“ (installierte Programme, Standard-App oder Windows-Auswahl)
- Die Wahl wird mit SimpleMail auf dem Mac synchronisiert

Neu in 3.2.5
- Ungelesene E-Mails tragen einen deutlich sichtbaren gelben Punkt
- Ordner „Ungelesen“ (Seitenleiste, Taste 2) listet alle ungelesenen Mails aller Konten und zeigt
  ihre Anzahl; eine geöffnete Mail bleibt dort stehen, bis man den Ordner verlässt

Neu in 3.2.4
- Doppelklick auf eine E-Mail öffnet das eigene Fenster jetzt zuverlässig im Vordergrund
  (vorher blieb es unter Windows oft hinter dem Hauptfenster versteckt)
- Enthält wieder die Kontofarben/Kontaktfarben (3.2.0) und das schnellere Laden (3.2.1)

Neu in 3.2.3
- Drucken (Strg+P, Drucker-Knopf oder Rechtsklick): Druckvorschau mit Seitenansicht,
  Hoch-/Querformat, „PDF speichern …“ und Druckermenü (Drucker, Kopien, Seiten, Farbe, beidseitig);
  Ausdruck mit Kopfzeilen Von/An/Cc/Datum/Anhänge
- Doppelklick (oder Enter) auf eine E-Mail öffnet sie in einem eigenen Fenster
- Verschieben in ein anderes Konto: per Ziehen auf einen Ordner des anderen Kontos oder
  Rechtsklick → Verschieben nach … → „In Konto: …“ (gelesen/markiert bleibt erhalten)
- Sortierung nach Datum auf- oder absteigend (Pfeil-Knopf über der Liste oder Ansicht → Sortierung)

Kalender (Google)
Direkte Verbindung (lesen und eintragen): Einstellungen → Kalender → Client-ID und
Clientschlüssel eintragen → „Mit Google verbinden“. Einmalig in der Google Cloud Console:
  1. console.cloud.google.com/projectcreate → Projekt „SimpleMail“
  2. console.cloud.google.com/apis/library/calendar-json.googleapis.com → Aktivieren
  3. console.cloud.google.com/auth/overview → Jetzt starten → App-Name, Support-E-Mail,
     Zielgruppe „Extern“ → Erstellen (NICHT veröffentlichen, Testmodus genügt)
  4. console.cloud.google.com/auth/clients → Client erstellen → Desktop-App →
     Client-ID und Clientschlüssel sofort kopieren
  5. In SimpleMail „Mit Google verbinden“ → im Browser anmelden →
     „Erweitert → Weiter zu SimpleMail (unsicher)“ → Zugriff erlauben
  Bei „Zugriff blockiert / Error 403“: console.cloud.google.com/auth/audience →
  Testnutzer → eigene Adresse mit @gmail.com eintragen.
  Alle 7 Tage: In der Terminspalte „Neu anmelden“ klicken.
  Neuer PC: mit Synchronisation kommen Client-ID und Schlüssel automatisch – nur „Mit Google verbinden“.
  Ohne Sync: Client-ID unter …/auth/clients; Schlüssel ggf. per „Secret hinzufügen“ neu erzeugen.
Alternativ nur lesen: „Privatadresse im iCal-Format“ aus Google Kalender einfügen.
- Termine der nächsten 14 Tage rechts in der Terminspalte (Strg+Umschalt+K)
- Einladungen: Zusagen / Vielleicht / Absagen (mit Verbindung: Termin wird gleich eingetragen)
- „Termin“ in einer E-Mail: direkt eintragen bzw. ohne Verbindung im Browser vorausgefüllt

Kontakte
- Links „Kontakte“: Adressbuch mit Name, Firma, E-Mail, Telefon, Adresse, Notiz
- Rechtsklick auf eine Mail → „Absender zu Kontakten hinzufügen“ (oder Knopf „Zu Kontakten“):
  Telefon, Fax, Mobil, Firma, Straße, PLZ/Ort, Land und Webseite werden soweit möglich
  aus der Signatur übernommen – bitte kurz prüfen
- Ist der Absender schon gespeichert: „Kontakt aus dieser Mail ergänzen“ füllt leere Felder
  und fügt neue Telefonnummern hinzu
- Importieren/Exportieren als vCard (.vcf), z. B. aus Apple Kontakte, Google oder Outlook
- Kontakte werden beim Schreiben vorgeschlagen und mit dem Mac synchronisiert

Verschieben
- Mail aus der Liste links auf einen Ordner ziehen, oder „Verschieben“ in der Mail,
  Rechtsklick → „Verschieben nach …“ bzw. Taste V

Spam & Phishing
- „Spam“ in der Mail oder per Rechtsklick: in den Spam-Ordner verschieben, optional Absender
  oder ganze Domain sperren (gesperrte Absender landen künftig automatisch im Spam)
- Im Spam-Ordner: „Kein Spam“ holt die Mail zurück und hebt die Sperre auf
- Rotes Warnbanner bei Verdacht auf Phishing (falscher Absendername, nachgeahmte Marke,
  fehlgeschlagene Absenderprüfung SPF/DKIM/DMARC, irreführende Links)
- Newsletter: „Abmelden“ mit einem Klick
- Gesperrte Absender verwalten: Einstellungen → Darstellung & Datenschutz

Tastenkürzel
Strg+N Neue E-Mail · F5 Abrufen · Strg+R Antworten · Strg+Umschalt+R Allen antworten ·
Strg+Umschalt+F Weiterleiten · E Archivieren · Entf Löschen · S Markieren · Strg+U gelesen/ungelesen ·
↑/↓ Navigieren · Strg+F Suchen · Strg+Enter Senden · Strg+, Einstellungen

Daten
Einstellungen und geplante Mails: %APPDATA%\SimpleMail
Passwörter werden mit Windows-Datenschutz (DPAPI) verschlüsselt gespeichert.

Sicherheit
- Passwörter verschlüsselt (Windows DPAPI), Verbindungen per SSL/TLS mit Zertifikatsprüfung
- HTML-Mails ohne Skripte, externe Bilder blockiert, Links öffnen im Browser
- Warnung vor gefährlichen Anhängen (.exe, .js, Makro-Dokumente …)
- Synchronisation: geänderte Serverdaten vom anderen Gerät nur nach Bestätigung,
  optional mit Sync-Passwort verschlüsselt (AES-256)
- Empfehlung: Laufwerksverschlüsselung (BitLocker/Geräteverschlüsselung) einschalten
