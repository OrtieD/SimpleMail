import Foundation
import CoreServices
import AppKit
import UserNotifications
import Contacts
import CryptoKit
import CommonCrypto

/// Millisekunden seit 1970 – gleiches Format wie die Windows-Version (für die Synchronisation)
func nowMillis() -> Double { (Date().timeIntervalSince1970 * 1000).rounded() }

// MARK: - Datentypen der Zusatzfunktionen

/// Zurückgestellte Mail (Snooze) – lokal gespeichert, die Mail bleibt im Posteingang auf dem Server
struct SnoozeEntry: Codable, Identifiable, Hashable {
    var id = UUID()
    var accountID: UUID
    var accountEmail = ""
    var messageID: String
    var uid: UInt32
    var until: Date
    var subject: String
    var sender: String
    var notified = false
    var deleted = false
    var updatedAt: Double = 0

    init(accountID: UUID, accountEmail: String, messageID: String, uid: UInt32, until: Date,
         subject: String, sender: String) {
        self.accountID = accountID
        self.accountEmail = accountEmail
        self.messageID = messageID
        self.uid = uid
        self.until = until
        self.subject = subject
        self.sender = sender
        self.updatedAt = nowMillis()
    }

    /// Tolerant gegenüber älteren gespeicherten Einträgen
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        accountID = try c.decode(UUID.self, forKey: .accountID)
        accountEmail = try c.decodeIfPresent(String.self, forKey: .accountEmail) ?? ""
        messageID = try c.decodeIfPresent(String.self, forKey: .messageID) ?? ""
        uid = try c.decodeIfPresent(UInt32.self, forKey: .uid) ?? 0
        until = try c.decode(Date.self, forKey: .until)
        subject = try c.decodeIfPresent(String.self, forKey: .subject) ?? ""
        sender = try c.decodeIfPresent(String.self, forKey: .sender) ?? ""
        notified = try c.decodeIfPresent(Bool.self, forKey: .notified) ?? false
        deleted = try c.decodeIfPresent(Bool.self, forKey: .deleted) ?? false
        updatedAt = try c.decodeIfPresent(Double.self, forKey: .updatedAt) ?? 1
    }

    /// Schlüssel im Sync-Dokument (identisch zur Windows-Version)
    var syncKey: String { "\(accountEmail.lowercased())|\(messageID.isEmpty ? String(uid) : messageID)" }

    func matches(_ m: MailMessage) -> Bool {
        guard accountID == m.accountID else { return false }
        return messageID.isEmpty || m.messageID.isEmpty ? uid == m.uid : messageID == m.messageID
    }
}

/// Fertig aufgebaute Mail, die zu einem späteren Zeitpunkt gesendet wird
struct ScheduledMail: Codable, Identifiable, Hashable {
    var id = UUID()
    var accountID: UUID
    var sendAt: Date
    var subject: String
    var toDisplay: String
    var recipients: [String]
    var data: Data
    var lastError: String? = nil
}

struct Snippet: Codable, Identifiable, Hashable {
    var id = UUID()
    var title: String
    var text: String
    var deleted = false
    var updatedAt: Double = 0

    init(title: String, text: String) {
        self.title = title
        self.text = text
        self.updatedAt = nowMillis()
    }

    init(id: UUID, title: String, text: String, deleted: Bool, updatedAt: Double) {
        self.id = id
        self.title = title
        self.text = text
        self.deleted = deleted
        self.updatedAt = updatedAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        text = try c.decodeIfPresent(String.self, forKey: .text) ?? ""
        deleted = try c.decodeIfPresent(Bool.self, forKey: .deleted) ?? false
        updatedAt = try c.decodeIfPresent(Double.self, forKey: .updatedAt) ?? 1
    }
}

/// Vertrauenswürdiger Absender (Bilder immer laden); gelöschte bleiben für den Abgleich als „deleted“ stehen
struct TrustEntry: Codable, Hashable {
    var deleted = false
    var updatedAt: Double = 0
}

/// 2.40: selbst gewählte Kategorie je Absender (Mail auf Kategorie gezogen), synchronisiert als senderCats
struct SenderCategory: Codable, Hashable {
    var category = ""
    var deleted = false
    var updatedAt: Double = 0
}

/// 2.43: Schriftfarbe eines Ordners in der Seitenleiste, synchronisiert als folderColors
/// (Schlüssel „adresse|lesbarer Pfad“, wie unter Windows)
struct FolderColor: Codable, Hashable {
    var color = ""
    var deleted = false
    var updatedAt: Double = 0
}

struct Contact: Hashable {
    var name: String
    var email: String

    var display: String {
        // Namen mit Komma würden die Adressliste zerlegen → dann nur die Adresse
        name.isEmpty || name.contains(",") || name.contains("\"") ? email : "\(name) <\(email)>"
    }
}

struct TimeOption: Identifiable {
    let id: String
    let title: String
    let date: Date
}

enum TimeOptions {
    private static var cal: Calendar { Calendar.current }

    private static func at(hour: Int, daysFromNow: Int, from now: Date) -> Date {
        let day = cal.date(byAdding: .day, value: daysFromNow, to: now) ?? now
        return cal.date(bySettingHour: hour, minute: 0, second: 0, of: day) ?? day
    }

    private static func next(weekday: Int, hour: Int, from now: Date) -> Date {
        cal.nextDate(after: now,
                     matching: DateComponents(hour: hour, minute: 0, weekday: weekday),
                     matchingPolicy: .nextTime) ?? now.addingTimeInterval(7 * 86_400)
    }

    static func snooze(now: Date = Date()) -> [TimeOption] {
        var list = [TimeOption(id: "3h", title: "In 3 Stunden", date: now.addingTimeInterval(3 * 3600))]
        if cal.component(.hour, from: now) < 17 {
            list.append(TimeOption(id: "evening", title: "Heute Abend (18:00)", date: at(hour: 18, daysFromNow: 0, from: now)))
        }
        list.append(TimeOption(id: "tomorrow", title: "Morgen früh (8:00)", date: at(hour: 8, daysFromNow: 1, from: now)))
        let weekday = cal.component(.weekday, from: now)   // 1 = So, 7 = Sa
        if weekday != 1 && weekday != 7 {
            list.append(TimeOption(id: "weekend", title: "Am Wochenende (Sa 9:00)", date: next(weekday: 7, hour: 9, from: now)))
        }
        list.append(TimeOption(id: "nextweek", title: "Nächste Woche (Mo 8:00)", date: next(weekday: 2, hour: 8, from: now)))
        return list
    }

    static func sendLater(now: Date = Date()) -> [TimeOption] {
        [
            TimeOption(id: "1h", title: "In 1 Stunde", date: now.addingTimeInterval(3600)),
            TimeOption(id: "tomorrow", title: "Morgen früh (8:00)", date: at(hour: 8, daysFromNow: 1, from: now)),
            TimeOption(id: "monday", title: "Montag (8:00)", date: next(weekday: 2, hour: 8, from: now))
        ]
    }
}

// MARK: - Speicher

enum Storage {
    static func load<T: Decodable>(_ type: T.Type, key: String) -> T? {
        guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    static func save<T: Encodable>(_ value: T, key: String) {
        UserDefaults.standard.set(try? JSONEncoder().encode(value), forKey: key)
    }

    /// Geplante Mails können groß sein (Anhänge) → eigene Datei statt UserDefaults
    static var outboxURL: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        let dir = base.appendingPathComponent("SimpleMail", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("outbox.json")
    }

    static func loadOutbox() -> [ScheduledMail] {
        guard let data = try? Data(contentsOf: outboxURL) else { return [] }
        return (try? JSONDecoder().decode([ScheduledMail].self, from: data)) ?? []
    }

    static func saveOutbox(_ list: [ScheduledMail]) {
        if let data = try? JSONEncoder().encode(list) {
            try? data.write(to: outboxURL, options: .atomic)
        }
    }
}

// MARK: - Mitteilungen

enum Notifier {
    /// Mitteilungen und Kontakte gehen nur aus einem echten .app-Bundle (nicht bei `swift run`)
    static var available: Bool {
        Bundle.main.bundleIdentifier != nil && Bundle.main.bundleURL.pathExtension == "app"
    }

    static func requestAuthorization() {
        guard available else { return }
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
    }

    static func post(title: String, body: String, id: String = UUID().uuidString) {
        guard available else { return }
        let c = UNMutableNotificationContent()
        c.title = title
        c.body = body
        c.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: c, trigger: nil))
    }

    static func notify(_ messages: [MailMessage]) {
        guard !messages.isEmpty else { return }
        for m in messages.prefix(3) {
            post(title: m.senderDisplay,
                 body: m.subject.isEmpty ? "(Kein Betreff)" : m.subject,
                 id: "mail-\(m.accountID)-\(m.uid)")
        }
        if messages.count > 3 {
            post(title: "SimpleMail", body: "\(messages.count - 3) weitere neue E-Mails")
        }
    }
}

// MARK: - macOS-Kontakte

enum SystemContacts {
    static func load() async -> [Contact] {
        guard Notifier.available else { return [] }
        let store = CNContactStore()
        let granted = (try? await store.requestAccess(for: .contacts)) ?? false
        guard granted else { return [] }
        return await Task.detached(priority: .utility) { () -> [Contact] in
            var out: [Contact] = []
            let keys = [CNContactGivenNameKey, CNContactFamilyNameKey,
                        CNContactOrganizationNameKey, CNContactEmailAddressesKey] as [CNKeyDescriptor]
            let request = CNContactFetchRequest(keysToFetch: keys)
            try? store.enumerateContacts(with: request) { c, _ in
                let person = [c.givenName, c.familyName].filter { !$0.isEmpty }.joined(separator: " ")
                let name = person.isEmpty ? c.organizationName : person
                for e in c.emailAddresses {
                    out.append(Contact(name: name, email: e.value as String))
                }
            }
            return out
        }.value
    }
}

// MARK: - Formatierung

enum Formatters {
    static let time: DateFormatter = {
        let f = DateFormatter(); f.dateStyle = .none; f.timeStyle = .short; return f
    }()
    static let dayMonth: DateFormatter = {
        let f = DateFormatter(); f.setLocalizedDateFormatFromTemplate("dMMM"); return f
    }()
    static let short: DateFormatter = {
        let f = DateFormatter(); f.dateStyle = .short; f.timeStyle = .none; return f
    }()
    static let full: DateFormatter = {
        let f = DateFormatter(); f.dateStyle = .medium; f.timeStyle = .short; return f
    }()
    static let weekdayTime: DateFormatter = {
        let f = DateFormatter(); f.setLocalizedDateFormatFromTemplate("EEEdMMMHHmm"); return f
    }()

    static func listDate(_ d: Date) -> String {
        let cal = Calendar.current
        if cal.isDateInToday(d) { return time.string(from: d) }
        if cal.isDateInYesterday(d) { return "Gestern" }
        if cal.isDate(d, equalTo: Date(), toGranularity: .year) { return dayMonth.string(from: d) }
        return short.string(from: d)
    }
}

// MARK: - HTML / externe Bilder

enum HTMLTools {
    private static let remotePattern =
        #"(?i)((src|srcset|background)\s*=\s*["']?\s*(https?:)?//|url\(\s*["']?\s*(https?:)?//)"#

    static func hasRemoteContent(_ html: String) -> Bool {
        html.range(of: remotePattern, options: .regularExpression) != nil
    }

    /// Ersetzt cid:-Verweise durch eingebettete Bilder und setzt eine Content-Security-Policy
    static func prepare(_ html: String, attachments: [MailAttachment], allowRemote: Bool) -> String {
        var h = html
        for a in attachments {
            guard let cid = a.contentID, !cid.isEmpty else { continue }
            h = h.replacingOccurrences(of: "cid:\(cid)",
                                       with: "data:\(a.mimeType);base64,\(a.data.base64EncodedString())")
        }
        let csp = allowRemote
            ? "default-src 'none'; img-src * data:; style-src * 'unsafe-inline'; font-src * data:; media-src *"
            : "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"
        return "<meta http-equiv=\"Content-Security-Policy\" content=\"\(csp)\">" + h
    }

    /// Echte Formatierung (Bild, Link, Fett, Farbe …) – sonst reicht die Text-Signatur
    static func isRich(_ html: String) -> Bool {
        html.range(of: #"(?i)<(img|a|b|strong|i|em|u|font|table|span[^>]*style|p[^>]*style|div[^>]*style)\b"#,
                   options: .regularExpression) != nil
    }

    static func escape(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
    }

    static func textToHtml(_ s: String) -> String {
        escape(s).replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\n", with: "<br>")
    }

    /// Text-Fassung einer HTML-Signatur (für den Text-Teil der Mail und den Platzhalter im Editor)
    static func htmlToText(_ html: String) -> String {
        guard !html.isEmpty else { return "" }
        var h = html
        h = h.replacingOccurrences(of: #"(?is)<(style|script|head)[^>]*>.*?</\1>"#, with: " ", options: .regularExpression)
        h = h.replacingOccurrences(of: #"(?i)<img[^>]*alt\s*=\s*"([^"]*)"[^>]*>"#, with: "[$1]", options: .regularExpression)
        h = h.replacingOccurrences(of: #"(?i)<img[^>]*>"#, with: "", options: .regularExpression)
        h = h.replacingOccurrences(of: #"(?i)<br\s*/?>"#, with: "\n", options: .regularExpression)
        h = h.replacingOccurrences(of: #"(?i)</(p|div|tr|h[1-6]|li|table)>"#, with: "\n", options: .regularExpression)
        h = h.replacingOccurrences(of: #"<[^>]+>"#, with: "", options: .regularExpression)
        let entities = ["&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'"]
        for (k, v) in entities { h = h.replacingOccurrences(of: k, with: v) }
        h = h.replacingOccurrences(of: #"[ \t]+\n"#, with: "\n", options: .regularExpression)
        h = h.replacingOccurrences(of: #"\n{3,}"#, with: "\n\n", options: .regularExpression)
        return h.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Entfernt Skripte, Event-Handler und Office-Ballast aus eingefügtem HTML
    static func clean(_ html: String, keepStyleBlocks: Bool = false) -> String {
        var h = signatureContainer(in: html) ?? html
        if let r = h.range(of: #"(?is)<body[^>]*>(.*)</body>"#, options: .regularExpression) {
            let inner = String(h[r])
            h = inner.replacingOccurrences(of: #"(?is)^<body[^>]*>|</body>$"#, with: "", options: .regularExpression)
            if keepStyleBlocks, let st = html.range(of: #"(?is)<style[^>]*>.*?</style>"#, options: .regularExpression) {
                h = String(html[st]) + h
            }
        }
        var patterns = [
            #"(?is)<script[^>]*>.*?</script>"#, #"(?is)<button[^>]*>.*?</button>"#, #"(?is)<!--.*?-->"#, #"(?is)<(meta|link|title|iframe|object|embed|form|input|button)[^>]*>"#,
            #"(?is)</(iframe|object|embed|form|button)>"#, #"(?i)</?[a-z]+:[a-z]+[^>]*>"#,
            #"(?i)[\s/]+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)"#, #"(?i)\s+(class|lang)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)"#,
            #"(?i)(href|src)\s*=\s*["']?\s*javascript:[^"'\s>]*["']?"#,
            #"(?is)<(frame|frameset|base|applet|portal|textarea|select|noscript)[^>]*>"#, #"(?is)</(frame|frameset|applet|portal|textarea|select|noscript)>"#,
            #"(?i)\s+(srcdoc|formaction|action)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)"#,
            #"(?i)(href|src)\s*=\s*["']?\s*(vbscript|file|data:text/html)[^"'\s>]*["']?"#,
        ]
        if !keepStyleBlocks { patterns.append(#"(?is)<style[^>]*>.*?</style>"#) }
        for p in patterns { h = h.replacingOccurrences(of: p, with: "", options: .regularExpression) }
        return fixTelLinks(h).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Signatur-Generatoren (z. B. „Email Signature Creator“) liefern eine ganze Webseite mit
    /// Knöpfen, Hilfetext und Fußzeile – nur der Inhalt von `.signature-container` ist die Signatur.
    static func signatureContainer(in html: String) -> String? {
        guard let openTag = html.range(of: #"(?is)<div[^>]*class\s*=\s*["'][^"']*signature-container[^"']*["'][^>]*>"#,
                                    options: .regularExpression) else { return nil }
        guard let tagRe = try? NSRegularExpression(pattern: #"(?i)<(/?)div\b[^>]*>"#) else { return nil }
        let ns = html as NSString
        let start = NSRange(openTag, in: html).upperBound
        var depth = 1
        for m in tagRe.matches(in: html, range: NSRange(location: start, length: ns.length - start)) {
            depth += ns.substring(with: m.range(at: 1)).isEmpty ? 1 : -1
            if depth == 0 {
                return ns.substring(with: NSRange(location: start, length: m.range.location - start))
            }
        }
        return nil
    }

    /// „tel:Mobil: 0172 7855 262“ → „tel:01727855262“ (sonst kann kein Telefon die Nummer wählen)
    static func fixTelLinks(_ html: String) -> String {
        guard let re = try? NSRegularExpression(pattern: #"(?i)href\s*=\s*(["'])tel:([^"']*)\1"#) else { return html }
        let ns = html as NSString
        var out = ""
        var last = 0
        for m in re.matches(in: html, range: NSRange(location: 0, length: ns.length)) {
            out += ns.substring(with: NSRange(location: last, length: m.range.location - last))
            let digits = ns.substring(with: m.range(at: 2)).filter { $0.isNumber || $0 == "+" }
            out += "href=\"tel:\(digits)\""
            last = m.range.location + m.range.length
        }
        out += ns.substring(from: last)
        return out
    }
}

// MARK: - Sicherheit

/// Dateitypen, die Programme ausführen oder Makros enthalten können
enum AttachmentRisk { case none, dangerous, blocked }

/// Gefährliche Anhänge – gleiche Einstufung wie in der Windows-Version (ab 3.2.10)
enum DangerousFiles {
    /// Programme und Skripte: werden nie direkt geöffnet, nur gesichert
    static let blocked: Set<String> = [
        "exe", "msi", "msp", "mst", "msix", "msixbundle", "appx", "appxbundle", "appinstaller", "bat", "cmd",
        "com", "scr", "pif", "cpl", "vb", "vbs", "vbe", "js", "jse", "ws", "wsf", "wsc", "wsh", "sct", "ps1", "ps1xml", "ps2", "psc1",
        "psd1", "psm1", "hta", "chm", "hlp", "jar", "lnk", "url", "website", "scf", "reg", "msc", "inf", "gadget", "application",
        "appref-ms", "xbap", "settingcontent-ms", "library-ms", "search-ms", "searchconnector-ms", "diagcab", "cab", "xll", "shs",
        "app", "pkg", "mpkg", "command", "tool", "sh", "py", "pyw", "pyc", "pl", "rb", "workflow", "action", "terminal",
        "scpt", "scptd", "applescript", "webloc", "inetloc", "fileloc", "prefpane", "kext", "plugin", "osax",
    ]
    /// Können Makros/Programme enthalten: nur nach Rückfrage öffnen
    static let dangerous: Set<String> = [
        "iso", "img", "vhd", "vhdx", "udf", "dmg", "docm", "dotm", "xlsm", "xltm", "xlam", "xla", "xlm",
        "pptm", "potm", "ppam", "ppsm", "sldm", "one", "onepkg", "accde", "accdb", "mdb", "mde", "ade", "adp", "html", "htm", "xhtml",
        "mht", "mhtml", "svg", "shtml",
    ]

    /// Dateiname ohne Steuer-/Richtungszeichen, ohne „/“ und „:“, ohne Punkte/Leerzeichen am Anfang und Ende
    /// („rechnung.exe “ oder „beleg‮fdp.exe“ würden sonst getarnt)
    static func clean(_ name: String) -> String {
        let bad = CharacterSet.controlCharacters
            .union(CharacterSet(charactersIn: "\u{200B}\u{200C}\u{200D}\u{200E}\u{200F}\u{202A}\u{202B}\u{202C}\u{202D}\u{202E}\u{2066}\u{2067}\u{2068}\u{2069}\u{FEFF}"))
        var scalars = String.UnicodeScalarView()
        for u in name.precomposedStringWithCanonicalMapping.unicodeScalars where !bad.contains(u) { scalars.append(u) }
        var s = String(scalars)
        s = s.replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: ":", with: "_")
        s = s.replacingOccurrences(of: "\\", with: "_")
        let trim = CharacterSet(charactersIn: ". \u{00A0}").union(.whitespacesAndNewlines)
        s = s.trimmingCharacters(in: trim)
        if s.count > 180 {
            let ext = String((s as NSString).pathExtension.prefix(20))
            s = String(s.prefix(180 - ext.count - 1)) + (ext.isEmpty ? "" : "." + ext)
        }
        return s.isEmpty ? "Anhang" : s
    }

    static func risk(_ filename: String) -> AttachmentRisk {
        let ext = (clean(filename) as NSString).pathExtension.lowercased()
        if blocked.contains(ext) { return .blocked }
        if dangerous.contains(ext) { return .dangerous }
        return .none
    }

    static func isDangerous(_ filename: String) -> Bool { risk(filename) != .none }

    /// Kennzeichnet eine gespeicherte Datei als „aus dem Internet“ (Quarantäne):
    /// Gatekeeper prüft Programme, Office öffnet Dokumente in der geschützten Ansicht
    static func markQuarantine(_ url: URL) {
        let props: [String: Any] = [
            kLSQuarantineTypeKey as String: kLSQuarantineTypeOtherDownload as String,
            kLSQuarantineAgentNameKey as String: "SimpleMail",
        ]
        try? (url as NSURL).setResourceValue(props as NSDictionary, forKey: .quarantinePropertiesKey)
    }

    /// Temporäre Kopien geöffneter Anhänge aufräumen (älter als `maxAge` Sekunden)
    static func cleanTemp(maxAge: TimeInterval = 24 * 3600) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("SimpleMail", isDirectory: true)
        let fm = FileManager.default
        guard let items = try? fm.contentsOfDirectory(at: root, includingPropertiesForKeys: [.contentModificationDateKey]) else { return }
        let limit = Date().addingTimeInterval(-maxAge)
        for item in items {
            let date = (try? item.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? Date()
            if date < limit { try? fm.removeItem(at: item) }
        }
    }
}

/// Optionale Verschlüsselung des Sync-Dokuments – identisch zur Windows-Version:
/// PBKDF2-HMAC-SHA256 (210 000 Runden, 16 Byte Salt) → AES-256-GCM (12 Byte Nonce, 16 Byte Tag)
enum SyncCrypto {
    static let iterations = 210_000
    static let keychainKey = "simplemail-sync-passphrase"

    static var passphrase: String? {
        guard let p = Keychain.get(keychainKey), !p.isEmpty else { return nil }
        return p
    }

    static func deriveKey(_ pass: String, salt: Data, iterations: Int) -> SymmetricKey? {
        var key = [UInt8](repeating: 0, count: 32)
        let passBytes = Array(pass.utf8)
        guard !passBytes.isEmpty else { return nil }
        let status: Int32 = salt.withUnsafeBytes { saltBuf in
            passBytes.withUnsafeBufferPointer { pw in
                pw.baseAddress!.withMemoryRebound(to: CChar.self, capacity: passBytes.count) { pwChars in
                    CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), pwChars, passBytes.count,
                                         saltBuf.bindMemory(to: UInt8.self).baseAddress, salt.count,
                                         CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), UInt32(iterations),
                                         &key, 32)
                }
            }
        }
        return status == Int32(kCCSuccess) ? SymmetricKey(data: key) : nil
    }

    static func encrypt(_ doc: [String: Any], passphrase: String) throws -> [String: Any] {
        let plain = try JSONSerialization.data(withJSONObject: doc, options: [.sortedKeys])
        var saltBytes = [UInt8](repeating: 0, count: 16)
        guard SecRandomCopyBytes(kSecRandomDefault, 16, &saltBytes) == errSecSuccess,
              let key = deriveKey(passphrase, salt: Data(saltBytes), iterations: iterations) else {
            throw MailError.invalidResponse("Verschlüsselung fehlgeschlagen.")
        }
        let sealed = try AES.GCM.seal(plain, using: key)
        let nonce = sealed.nonce.withUnsafeBytes { Data($0) }
        return [
            "simplemailEncrypted": 1, "kdf": "pbkdf2-sha256", "iterations": iterations,
            "salt": Data(saltBytes).base64EncodedString(), "nonce": nonce.base64EncodedString(),
            "ciphertext": sealed.ciphertext.base64EncodedString(), "tag": sealed.tag.base64EncodedString(),
        ]
    }

    static func decrypt(_ env: [String: Any], passphrase: String?) throws -> [String: Any] {
        guard let passphrase, !passphrase.isEmpty else {
            throw MailError.invalidResponse("Die Synchronisation ist verschlüsselt – bitte unter „Offline & Sync“ das Sync-Passwort eingeben.")
        }
        let wrong = MailError.invalidResponse("Sync-Passwort falsch – die Daten konnten nicht entschlüsselt werden.")
        let iter = (env["iterations"] as? NSNumber)?.intValue ?? iterations
        guard iter >= 100_000, iter <= 5_000_000 else {
            throw MailError.invalidResponse("Sync-Dokument ungültig (Schlüsselparameter).")
        }
        guard let salt = Data(base64Encoded: env["salt"] as? String ?? ""),
              let nonceData = Data(base64Encoded: env["nonce"] as? String ?? ""),
              let ciphertext = Data(base64Encoded: env["ciphertext"] as? String ?? ""),
              let tag = Data(base64Encoded: env["tag"] as? String ?? ""),
              let key = deriveKey(passphrase, salt: salt,
                                  iterations: iter) else { throw wrong }
        do {
            let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: nonceData), ciphertext: ciphertext, tag: tag)
            let plain = try AES.GCM.open(box, using: key)
            guard let obj = try JSONSerialization.jsonObject(with: plain) as? [String: Any] else { throw wrong }
            return obj
        } catch {
            throw wrong
        }
    }
}

// MARK: - Offline-Ablage

/// Speichert Kopfzeilen und Nachrichtentexte je Konto/Ordner unter
/// ~/Library/Application Support/SimpleMail/Cache (gleicher Aufbau wie unter Windows)
enum OfflineCache {
    struct HeaderFile: Codable {
        var uidValidity: String
        var low: Int
        var savedAt: Date
        var messages: [MailMessage]
    }

    static var enabled: Bool {
        UserDefaults.standard.object(forKey: "offlineEnabled") == nil || UserDefaults.standard.bool(forKey: "offlineEnabled")
    }
    static var keep: Int {
        let v = UserDefaults.standard.integer(forKey: "offlineKeep")
        return v > 0 ? v : 100
    }
    static var limitMB: Int {
        let v = UserDefaults.standard.integer(forKey: "offlineLimitMB")
        return v > 0 ? v : 1000
    }

    static var root: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return base.appendingPathComponent("SimpleMail/Cache", isDirectory: true)
    }

    static func dir(_ account: UUID, _ folder: String) -> URL {
        let digest = Insecure.SHA1.hash(data: Data("\(account.uuidString)|\(folder)".utf8))
        let name = digest.map { String(format: "%02x", $0) }.joined().prefix(20)
        return root.appendingPathComponent(String(name), isDirectory: true)
    }

    static func readHeaders(_ account: UUID, _ folder: String) -> HeaderFile? {
        let url = dir(account, folder).appendingPathComponent("headers.json")
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(HeaderFile.self, from: data)
    }

    static func writeHeaders(_ account: UUID, _ folder: String, uidValidity: String, low: Int, messages: [MailMessage]) {
        guard enabled else { return }
        let d = dir(account, folder)
        // UIDVALIDITY geändert → alle gespeicherten UIDs sind ungültig
        if let old = readHeaders(account, folder), old.uidValidity != uidValidity {
            try? FileManager.default.removeItem(at: d)
        }
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        let file = HeaderFile(uidValidity: uidValidity, low: low, savedAt: Date(), messages: messages)
        if let data = try? JSONEncoder().encode(file) {
            try? data.write(to: d.appendingPathComponent("headers.json"), options: .atomic)
        }
    }

    static func bodyURL(_ key: MessageKey) -> URL {
        dir(key.account, key.folder).appendingPathComponent("\(key.uid).eml")
    }

    static func readBody(_ key: MessageKey) -> Data? { try? Data(contentsOf: bodyURL(key)) }

    static func hasBody(_ key: MessageKey) -> Bool { FileManager.default.fileExists(atPath: bodyURL(key).path) }

    static func writeBody(_ key: MessageKey, _ data: Data) {
        guard enabled else { return }
        try? FileManager.default.createDirectory(at: dir(key.account, key.folder), withIntermediateDirectories: true)
        try? data.write(to: bodyURL(key), options: .atomic)
    }

    private static func allFiles() -> [(url: URL, size: Int, date: Date)] {
        guard let e = FileManager.default.enumerator(at: root, includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey]) else { return [] }
        var out: [(url: URL, size: Int, date: Date)] = []
        for case let url as URL in e {
            let v = try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey, .isRegularFileKey])
            if v?.isRegularFile == true {
                out.append((url, v?.fileSize ?? 0, v?.contentModificationDate ?? .distantPast))
            }
        }
        return out
    }

    static func totalBytes() -> Int { allFiles().reduce(0) { $0 + $1.size } }

    /// Hält die Ablage unter der Größengrenze (älteste Nachrichtentexte zuerst)
    static func enforceLimit() {
        let limit = limitMB * 1024 * 1024
        let files = allFiles()
        var total = files.reduce(0) { $0 + $1.size }
        guard total > limit else { return }
        for f in files.filter({ $0.url.pathExtension == "eml" }).sorted(by: { $0.date < $1.date }) {
            try? FileManager.default.removeItem(at: f.url)
            total -= f.size
            if Double(total) <= Double(limit) * 0.8 { break }
        }
    }

    static func clear() { try? FileManager.default.removeItem(at: root) }

    // ---- Textvorschau für die Übersicht

    static func readPreviews(_ account: UUID, _ folder: String) -> [String: String] {
        let url = dir(account, folder).appendingPathComponent("previews.json")
        guard let data = try? Data(contentsOf: url) else { return [:] }
        return (try? JSONDecoder().decode([String: String].self, from: data)) ?? [:]
    }

    static func savePreviews(_ account: UUID, _ folder: String, _ entries: [UInt32: String]) {
        guard enabled, !entries.isEmpty else { return }
        var all = readPreviews(account, folder)
        for (uid, text) in entries { all[String(uid)] = text }
        let d = dir(account, folder)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        if let data = try? JSONEncoder().encode(all) {
            try? data.write(to: d.appendingPathComponent("previews.json"), options: .atomic)
        }
    }

    /// Erste Zeilen des eigentlichen Textes – ohne Zitate und Signatur
    static func makePreview(raw: Data) -> String {
        let (_, content) = MIME.extract(raw: raw)
        let text = content.text ?? HTMLTools.htmlToText(content.html ?? "")
        var lines: [String] = []
        for line in text.components(separatedBy: .newlines) {
            let t = line.trimmingCharacters(in: .whitespaces)
            if line == "-- " || t.range(of: #"^(Am .{4,80} schrieb|On .{4,80} wrote|-{5,} ?(Weitergeleitete|Forwarded|Original))"#,
                                        options: [.regularExpression, .caseInsensitive]) != nil { break }
            if t.hasPrefix(">") { continue }
            lines.append(line)
        }
        let joined = lines.joined(separator: " ")
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
        return String(joined.prefix(240))
    }
}
