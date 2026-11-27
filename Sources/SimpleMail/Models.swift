import Foundation
import Security
import SwiftUI

// MARK: - Farben für Konten und Kontakte (identische Liste in der Windows-Version)

enum ColorChoices {
    static let all: [(hex: String, name: String)] = [
        ("#0a84ff", "Blau"), ("#ff3b30", "Rot"), ("#34c759", "Grün"), ("#ff9500", "Orange"), ("#af52de", "Lila"),
        ("#ff2d55", "Pink"), ("#30b0c7", "Türkis"), ("#5856d6", "Indigo"), ("#a2845e", "Braun"), ("#8e8e93", "Grau"),
    ]

    /// "#rrggbb" in Kleinbuchstaben oder nil
    static func valid(_ s: String) -> String? {
        let t = s.trimmingCharacters(in: .whitespaces).lowercased()
        guard t.count == 7, t.hasPrefix("#"), UInt32(t.dropFirst(), radix: 16) != nil else { return nil }
        return t
    }

    /// Automatische Farbe aus der Adresse: h = h*31 + Zeichen (32 Bit), wie unter Windows
    static func autoHex(for email: String) -> String {
        var h: UInt32 = 0
        for u in email.lowercased().unicodeScalars { h = h &* 31 &+ u.value }
        return all[Int(h % UInt32(all.count))].hex
    }

    static func color(hex: String) -> Color {
        let v = UInt32(hex.dropFirst(), radix: 16) ?? 0
        return Color(red: Double((v >> 16) & 0xff) / 255, green: Double((v >> 8) & 0xff) / 255, blue: Double(v & 0xff) / 255)
    }
}

/// Reihe von Farbkreisen; der erste Kreis steht für „keine“ bzw. „automatisch“
struct ColorSwatches: View {
    let selected: String
    let emptyLabel: String
    let onPick: (String) -> Void

    var body: some View {
        let cur = ColorChoices.valid(selected) ?? ""
        HStack(spacing: 6) {
            Button { onPick("") } label: {
                ZStack {
                    Circle().strokeBorder(Color.secondary.opacity(0.6), style: StrokeStyle(lineWidth: 1, dash: [2, 2]))
                    Text(emptyLabel == "Keine" ? "∅" : "A").font(.system(size: 9, weight: .semibold)).foregroundStyle(.secondary)
                }
                .frame(width: 18, height: 18)
                .padding(2)
                .overlay(Circle().stroke(cur.isEmpty ? Color.primary : Color.clear, lineWidth: 2))
            }
            .buttonStyle(.plain)
            .help(emptyLabel)
            ForEach(ColorChoices.all.map { $0.hex }, id: \.self) { hex in
                Button { onPick(hex) } label: {
                    Circle().fill(ColorChoices.color(hex: hex))
                        .frame(width: 18, height: 18)
                        .padding(2)
                        .overlay(Circle().stroke(cur == hex ? Color.primary : Color.clear, lineWidth: 2))
                }
                .buttonStyle(.plain)
                .help(ColorChoices.all.first(where: { $0.hex == hex })?.name ?? hex)
            }
        }
    }
}

struct Account: Codable, Equatable, Hashable, Identifiable {
    var id = UUID()
    var displayName = ""
    var email = ""
    var username = ""
    var imapHost = ""
    var imapPort = 993
    var smtpHost = ""
    var smtpPort = 465
    /// Text-Signatur (bei HTML-Signatur automatisch daraus abgeleitet)
    var signature = ""
    /// Formatierte Signatur (HTML, Bilder als data:-URL); leer = nur Text
    var signatureHtml = ""
    /// Zeitstempel für die Synchronisation (Millisekunden seit 1970, wie in der Windows-Version)
    var updatedAt: Double = 0
    var sigUpdatedAt: Double = 0
    /// Kontofarbe als "#rrggbb"; leer = automatisch aus der Adresse
    var color = ""
    var colorUpdatedAt: Double = 0
    /// Über die Synchronisation angelegt: Serverdaten vor dem ersten Passwort bestätigen lassen
    var fromSync = false

    init() {}

    /// Tolerant gegenüber älteren gespeicherten Daten (fehlende Felder)
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        displayName = try c.decodeIfPresent(String.self, forKey: .displayName) ?? ""
        email = try c.decodeIfPresent(String.self, forKey: .email) ?? ""
        username = try c.decodeIfPresent(String.self, forKey: .username) ?? ""
        imapHost = try c.decodeIfPresent(String.self, forKey: .imapHost) ?? ""
        imapPort = try c.decodeIfPresent(Int.self, forKey: .imapPort) ?? 993
        smtpHost = try c.decodeIfPresent(String.self, forKey: .smtpHost) ?? ""
        smtpPort = try c.decodeIfPresent(Int.self, forKey: .smtpPort) ?? 465
        signature = try c.decodeIfPresent(String.self, forKey: .signature) ?? ""
        signatureHtml = try c.decodeIfPresent(String.self, forKey: .signatureHtml) ?? ""
        updatedAt = try c.decodeIfPresent(Double.self, forKey: .updatedAt) ?? 0
        sigUpdatedAt = try c.decodeIfPresent(Double.self, forKey: .sigUpdatedAt) ?? 0
        color = try c.decodeIfPresent(String.self, forKey: .color) ?? ""
        colorUpdatedAt = try c.decodeIfPresent(Double.self, forKey: .colorUpdatedAt) ?? 0
        fromSync = try c.decodeIfPresent(Bool.self, forKey: .fromSync) ?? false
    }

    /// Angezeigte Kontofarbe (gewählt oder automatisch – gleiche Berechnung wie unter Windows)
    var displayColor: Color { ColorChoices.color(hex: ColorChoices.valid(color) ?? ColorChoices.autoHex(for: email)) }

    /// Hat die Signatur echte Formatierung (Logo, Link, Farbe …)?
    var hasRichSignature: Bool { HTMLTools.isRich(signatureHtml) }

    var keychainKey: String { "\(username)@\(imapHost)" }
    var isComplete: Bool {
        !email.isEmpty && !username.isEmpty && !imapHost.isEmpty && !smtpHost.isEmpty
    }
    /// Kurzbezeichnung für Listen, z. B. "web.de"
    var shortName: String {
        email.split(separator: "@").last.map(String.init) ?? email
    }
}

/// Eindeutige Adresse einer Nachricht über alle Konten und Ordner
struct MessageKey: Hashable {
    let account: UUID
    let folder: String
    let uid: UInt32
}

enum MailCategory: String, CaseIterable, Identifiable, Codable {
    case personal, notification, newsletter

    var id: String { rawValue }
    var title: String {
        switch self {
        case .personal: return "Persönlich"
        case .notification: return "Benachrichtigungen"
        case .newsletter: return "Newsletter"
        }
    }
    var icon: String {
        switch self {
        case .personal: return "person"
        case .notification: return "bell"
        case .newsletter: return "newspaper"
        }
    }
}

enum SidebarItem: Hashable {
    case smart, unread, flagged, snoozed, scheduled, contacts
    /// Spam-Ordner aller Konten zusammen (unter „Kategorien“)
    case spam
    /// 2.42: Gesendet- bzw. Papierkorb-Ordner aller Konten zusammen
    case sent, trash
    /// 2.49: Entwürfe aller Konten zusammen
    case drafts
    case category(MailCategory)
    case folder(UUID, String)

    /// Alle Einträge außer Ordnern zeigen die gemeinsame Inbox aller Konten
    var isUnified: Bool {
        if case .folder = self { return false }
        return true
    }

    /// 2.46: gefilterte Ansichten des Posteingangs – beim Kontowechsel zurück auf die Smart Inbox
    var isFilteredInbox: Bool {
        switch self {
        case .category, .unread, .flagged: return true
        default: return false
        }
    }

    /// Gemeinsame Ordner über alle Konten: Rolle der zugehörigen Kontoordner
    var roleFolder: FolderRole? {
        switch self {
        case .spam: return .junk
        case .sent: return .sent
        case .trash: return .trash
        case .drafts: return .drafts
        default: return nil
        }
    }
}

enum FolderRole: Int, Codable {
    case inbox = 0, drafts, sent, archive, junk, trash, other
}

/// IMAP-Ordner; `path` ist der Rohname für den Server (modified UTF-7), `name` der Anzeigename
struct MailFolder: Identifiable, Hashable, Codable {
    var path: String
    var name: String
    var depth: Int
    var selectable: Bool
    var role: FolderRole
    var unread: Int = 0
    /// Gmail: „Alle Nachrichten“ (\\All) bzw. virtuelle Ordner „Wichtig“/„Markiert“ (keine eigenen Mails)
    var isAllMail: Bool = false
    var isVirtual: Bool = false
    var id: String { path }

    var icon: String {
        switch role {
        case .inbox: return "tray"
        case .drafts: return "doc"
        case .sent: return "paperplane"
        case .archive: return "archivebox"
        case .junk: return "xmark.bin"
        case .trash: return "trash"
        case .other: return "folder"
        }
    }

    /// Ordnet anhand von RFC-6154-Attributen bzw. üblichen Namen (auch deutsch) eine Rolle zu
    static func role(path: String, leaf: String, attributes a: String) -> FolderRole {
        if path.uppercased() == "INBOX" { return .inbox }
        if a.contains("\\drafts") { return .drafts }
        if a.contains("\\sent") { return .sent }
        if a.contains("\\archive") || a.contains("\\all") { return .archive }
        if a.contains("\\junk") { return .junk }
        if a.contains("\\trash") { return .trash }
        switch leaf.lowercased() {
        case "drafts", "entwürfe", "entwurf": return .drafts
        case "sent", "gesendet", "sent items", "sent messages", "gesendete objekte", "postausgang": return .sent
        case "archive", "archiv": return .archive
        case "spam", "junk", "junk-e-mail", "unerwünscht", "junk e-mail": return .junk
        case "trash", "papierkorb", "gelöscht", "deleted", "deleted items", "deleted messages", "gelöschte objekte": return .trash
        default: return .other
        }
    }
}

/// Modified UTF-7 (RFC 3501, Ordnernamen) → String, z. B. "Entw&APw-rfe" → "Entwürfe"
enum MUTF7 {
    static func decode(_ s: String) -> String {
        var out = ""
        var i = s.startIndex
        while i < s.endIndex {
            let ch = s[i]
            guard ch == "&" else {
                out.append(ch)
                i = s.index(after: i)
                continue
            }
            guard let end = s[i...].firstIndex(of: "-") else {
                out += String(s[i...])
                break
            }
            let chunk = String(s[s.index(after: i)..<end])
            if chunk.isEmpty {
                out += "&"
            } else {
                var b64 = chunk.replacingOccurrences(of: ",", with: "/")
                while b64.count % 4 != 0 { b64 += "=" }
                if let data = Data(base64Encoded: b64),
                   let str = String(data: data, encoding: .utf16BigEndian) {
                    out += str
                } else {
                    out += String(s[i...end])
                }
            }
            i = s.index(after: end)
        }
        return out
    }
}

struct MailMessage: Identifiable, Hashable, Codable {
    let accountID: UUID
    let folder: String
    let uid: UInt32
    var key: MessageKey { MessageKey(account: accountID, folder: folder, uid: uid) }
    var id: MessageKey { key }
    var fromName: String
    var fromAddress: String
    var to: String
    var subject: String
    var date: Date
    var messageID: String
    var references: String
    var isRead: Bool
    var isFlagged: Bool
    var hasAttachment: Bool
    var category: MailCategory
    /// An, Kopie und Verteileradressen (für Regeln); fehlt bei älteren gespeicherten Kopfdaten
    var recipients: String? = nil
    /// Punkte des automatischen Spamfilters (fehlt bei älteren gespeicherten Kopfdaten)
    var spamScore: Int? = nil
    /// Version der Kategorie-Einteilung (fehlt bei älteren gespeicherten Kopfdaten)
    var catVersion: Int? = nil
    /// Absenderprüfung (DMARC/SPF) fehlgeschlagen – Absender ist dann evtl. gefälscht (fehlt bei älteren Kopfdaten)
    var authFailed: Bool? = nil

    var senderDisplay: String { fromName.isEmpty ? fromAddress : fromName }
}

struct MailAttachment: Identifiable, Hashable {
    let id = UUID()
    var filename: String
    var mimeType: String
    var data: Data
    var contentID: String? = nil
    var isInline: Bool = false

    var sizeText: String {
        ByteCountFormatter.string(fromByteCount: Int64(data.count), countStyle: .file)
    }
}

struct MessageBody {
    var text: String?
    var html: String?
    var attachments: [MailAttachment]
    var cc: String
    var calendar: String? = nil
    /// Phishing-Hinweise und Newsletter-Abmeldung
    var warnings: [String] = []
    var unsubscribe: UnsubscribeInfo? = nil
}

struct Draft: Identifiable {
    let id = UUID()
    var accountID: UUID? = nil
    var to = ""
    var cc = ""
    var subject = ""
    var body = ""
    /// Formatierter Text aus dem Editor (nil = reiner Text)
    var bodyHtml: String? = nil
    /// iCalendar-Teil: Antwort (METHOD:REPLY) auf eine Einladung oder eigene Einladung (METHOD:REQUEST)
    var calendarReply: String? = nil
    /// „REPLY“ oder „REQUEST“ (Einladung: HTML bleibt erhalten, zusätzlich einladung.ics als Anhang)
    var calendarMethod = "REPLY"
    var attachments: [URL] = []
    var inReplyTo: String? = nil
    var references: String? = nil
    /// 2.49: zuletzt gespeicherter Stand im Entwürfe-Ordner (wird beim Senden bzw. erneuten Speichern gelöscht)
    var draftRef: DraftRef? = nil
}

enum MailError: LocalizedError {
    case connectionClosed
    case noAccount
    case server(String)
    case invalidResponse(String)

    var errorDescription: String? {
        switch self {
        case .connectionClosed: return "Verbindung zum Server wurde getrennt."
        case .noAccount: return "Kein Konto eingerichtet oder Passwort fehlt."
        case .server(let msg): return "Server: \(msg)"
        case .invalidResponse(let msg): return msg
        }
    }

    var isServerReply: Bool {
        if case .server = self { return true }
        return false
    }
}

/// Smart-Inbox-Einteilung anhand von Headern und Absender (gleiche Logik wie categorize() in main.js)
enum Categorizer {
    /// Erhöhen, wenn sich die Einteilung ändert – gespeicherte Kopfzeilen im Posteingang werden dann einmal neu geholt
    static let version = 2

    /// Automatische Absender (nur im Teil vor dem @, als eigenes Wort)
    private static let automatedPattern =
        #"(^|[._+-])(no[_-]?reply|do[_-]?not[_-]?reply|notifications?|notify|mailer-daemon|postmaster|alerts?|automated|bounces?|system|service|support|billing|invoice|rechnung|accounts?|security|versand|shipping|orders?|bestellung|calendar|kalender)([._+-]|\d|$)"#
    /// Newsletter-Absender (ganze Adresse)
    private static let newsletterPattern = #"newsletter|(^|[._+-])(news|marketing|promo|angebote?|aktionen?|mailing)([._+-]|@)"#
    /// Betreffe von Bestell-, Versand-, Konto- und Terminmails (zählen nur bei Massenversand)
    private static let transactionalPattern =
        #"bestell|auftrag|rechnung|lieferung|versand|versendet|zustellung|sendung|paket|zahlung|kontoauszug|passwort|kennwort|anmeldung|sicherheitscode|bestätigungscode|verifizier|termin|erinnerung|buchung|reservierung|ticket|order|invoice|receipt|shipped|shipping|delivery|payment|password|sign-in|sign in|login|verification|security alert|your account|ihr konto|dein konto|reminder|booking|reservation"#

    static func categorize(headers h: [String: String], address: String, subject: String = "") -> MailCategory {
        let addr = address.lowercased()
        let local = String(addr.split(separator: "@").first ?? Substring(addr))
        let precedence = (h["precedence"] ?? "").lowercased().trimmingCharacters(in: .whitespaces)
        if let auto = h["auto-submitted"]?.lowercased().trimmingCharacters(in: .whitespaces), !auto.isEmpty, auto != "no" {
            return .notification
        }
        if addr.range(of: newsletterPattern, options: .regularExpression) != nil { return .newsletter }
        if local.range(of: automatedPattern, options: .regularExpression) != nil { return .notification }
        let isList = h["list-id"] != nil || precedence == "list"
        let isBulk = isList || precedence == "bulk" || precedence == "junk" || h["list-unsubscribe"] != nil
        if isBulk {
            // z. B. Versandbestätigung mit Abmelde-Link → Benachrichtigung statt Newsletter
            if !isList && subject.lowercased().range(of: transactionalPattern, options: .regularExpression) != nil {
                return .notification
            }
            return .newsletter
        }
        return .personal
    }

    /// Gmail und Googlemail sind dieselbe Adresse
    static func normalized(_ address: String) -> String {
        let a = address.lowercased().trimmingCharacters(in: .whitespaces)
        if a.hasSuffix("@googlemail.com") { return String(a.dropLast("googlemail.com".count)) + "gmail.com" }
        return a
    }
}

enum Pattern {
    // Übersetzte Ausdrücke merken – vorher wurde jeder Ausdruck bei jedem Aufruf neu übersetzt
    // (beim Abruf mehrfach pro E-Mail).
    private static var compiled: [String: NSRegularExpression] = [:]
    private static let compiledLock = NSLock()

    static func regex(_ pattern: String) -> NSRegularExpression? {
        compiledLock.lock()
        defer { compiledLock.unlock() }
        if let r = compiled[pattern] { return r }
        guard let r = try? NSRegularExpression(pattern: pattern) else { return nil }
        compiled[pattern] = r
        return r
    }

    /// Liefert die Capture-Gruppen des ersten Treffers
    static func groups(_ pattern: String, in s: String) -> [String]? {
        guard let re = regex(pattern),
              let m = re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) else { return nil }
        return (1..<max(1, m.numberOfRanges)).map { i in
            Range(m.range(at: i), in: s).map { String(s[$0]) } ?? ""
        }
    }

    static func first(_ pattern: String, in s: String) -> String? {
        groups(pattern, in: s)?.first
    }
}

enum Keychain {
    // Alle Passwörter liegen in EINEM Schlüsselbund-Eintrag („Tresor“) und werden nach dem ersten Lesen
    // im Speicher gehalten. Nach einem Neubau fragt macOS so höchstens einmal statt einmal pro Konto.
    private static let vaultAccount = "simplemail-vault"
    private static var cache: [String: String]?
    private static var noLegacy: Set<String> = []
    private static let lock = NSLock()

    private static func baseQuery(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "SimpleMail",
         kSecAttrAccount as String: account]
    }

    private static func rawSet(_ value: String, for account: String) {
        let base = baseQuery(account)
        SecItemDelete(base as CFDictionary)
        var add = base
        add[kSecValueData as String] = Data(value.utf8)
        SecItemAdd(add as CFDictionary, nil)
    }

    private static func rawGet(_ account: String) -> String? {
        var q = baseQuery(account)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess,
              let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func vault() -> [String: String] {
        if let c = cache { return c }
        var v: [String: String] = [:]
        if let s = rawGet(vaultAccount), let d = s.data(using: .utf8),
           let dict = try? JSONDecoder().decode([String: String].self, from: d) {
            v = dict
        }
        cache = v
        return v
    }

    private static func store(_ v: [String: String]) {
        cache = v
        if let d = try? JSONEncoder().encode(v), let s = String(data: d, encoding: .utf8) {
            rawSet(s, for: vaultAccount)
        }
    }

    static func set(_ value: String, for account: String) {
        lock.lock()
        defer { lock.unlock() }
        var v = vault()
        v[account] = value
        noLegacy.remove(account)
        store(v)
    }

    static func get(_ account: String) -> String? {
        lock.lock()
        defer { lock.unlock() }
        var v = vault()
        if let x = v[account] { return x.isEmpty ? nil : x }
        if noLegacy.contains(account) { return nil }
        // Einmalige Übernahme aus den früheren Einzel-Einträgen
        if let legacy = rawGet(account) {
            v[account] = legacy
            store(v)
            return legacy.isEmpty ? nil : legacy
        }
        noLegacy.insert(account)
        return nil
    }
}
