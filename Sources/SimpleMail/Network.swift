import Foundation

/// Zeilenbasierte TCP-Verbindung mit TLS / STARTTLS (URLSessionStreamTask)
final class LineConnection {
    private let task: URLSessionStreamTask
    private var buffer = Data()
    /// Lese-Position im Puffer. Gelesenes wird nicht sofort entfernt (das kopierte bei jeder Zeile
    /// den ganzen restlichen Puffer), sondern erst gesammelt verworfen.
    private var pos = 0

    init(host: String, port: Int, tls: Bool) {
        task = URLSession.shared.streamTask(withHostName: host, port: port)
        task.resume()
        if tls { task.startSecureConnection() }
    }

    func startTLS() { task.startSecureConnection() }
    func close() { task.cancel() }

    func send(_ string: String) async throws {
        try await send(Data(string.utf8))
    }

    func send(_ data: Data) async throws {
        try await task.write(data, timeout: 60)
    }

    private func receiveMore(timeout: TimeInterval = 60) async throws {
        let (data, eof) = try await task.readData(ofMinLength: 1, maxLength: 1_048_576, timeout: timeout)
        if let data, !data.isEmpty {
            if pos > 0 && pos >= buffer.count {
                buffer.removeAll(keepingCapacity: true)
                pos = 0
            } else if pos > 262_144 {
                buffer = buffer.subdata(in: pos..<buffer.count)
                pos = 0
            }
            buffer.append(data)
        } else if eof {
            throw MailError.connectionClosed
        }
    }

    /// Liest bis CRLF (ohne CRLF)
    func readLine(timeout: TimeInterval = 60) async throws -> Data {
        let crlf = Data([13, 10])
        while true {
            if let r = buffer.range(of: crlf, in: pos..<buffer.count) {
                let line = buffer.subdata(in: pos..<r.lowerBound)
                pos = r.upperBound
                return line
            }
            try await receiveMore(timeout: timeout)
        }
    }

    func readBytes(_ count: Int) async throws -> Data {
        while buffer.count - pos < count { try await receiveMore() }
        let chunk = buffer.subdata(in: pos..<(pos + count))
        pos += count
        return chunk
    }
}

// MARK: - IMAP

struct IMAPResponse {
    var text: String        // Literale sind durch "{}" ersetzt
    var literals: [Data]
}

struct SpecialFolders {
    var archive: String?
    var trash: String?
    var sent: String?
    var junk: String? = nil
}

final class IMAPClient {
    private let conn: LineConnection
    private var tagCounter = 0
    private(set) var selectedMailbox: String?
    private(set) var uidValidity = ""

    static let headerFields = "FROM TO CC SUBJECT DATE MESSAGE-ID REFERENCES CONTENT-TYPE LIST-UNSUBSCRIBE LIST-ID PRECEDENCE AUTO-SUBMITTED DELIVERED-TO X-ORIGINAL-TO ENVELOPE-TO X-ENVELOPE-TO RESENT-TO LIST-POST AUTHENTICATION-RESULTS X-SPAM-FLAG X-SPAM-STATUS X-SPAM"

    private let host: String

    init(host: String, port: Int) {
        self.host = host
        conn = LineConnection(host: host, port: port, tls: true)
    }

    func connect() async throws {
        let greeting = try await readResponse()
        guard greeting.text.hasPrefix("* OK") || greeting.text.hasPrefix("* PREAUTH") else {
            throw MailError.server(greeting.text)
        }
    }

    func close() { conn.close() }

    func login(user: String, password: String) async throws {
        do {
            try await command("LOGIN \(Self.quote(user)) \(Self.quote(Gmail.cleanPassword(password, host: host)))")
        } catch MailError.server(let msg) where Gmail.isGmailHost(host) {
            throw MailError.server(Gmail.loginHint + " – " + msg)
        }
    }

    /// Gmail: Einteilung nach Gmails eigenen Kategorien (X-GM-RAW) für die angegebenen UIDs
    func gmailCategories(_ uids: [UInt32]) async throws -> [UInt32: MailCategory] {
        guard !uids.isEmpty else { return [:] }
        let set = Self.uidSet(uids)
        var out: [UInt32: MailCategory] = [:]
        let queries: [(String, MailCategory)] = [
            ("category:primary", .personal),
            ("category:updates", .notification),
            ("category:promotions OR category:social OR category:forums", .newsletter),
        ]
        for q in queries {
            let rs = try await command("UID SEARCH UID \(set) X-GM-RAW \(Self.quote(q.0))")
            for r in rs where r.text.hasPrefix("* SEARCH") {
                for u in r.text.dropFirst(8).split(separator: " ").compactMap({ UInt32($0) }) { out[u] = q.1 }
            }
        }
        return out
    }

    func logout() async {
        _ = try? await command("LOGOUT")
        close()
    }

    @discardableResult
    func command(_ cmd: String) async throws -> [IMAPResponse] {
        let tag = nextTag()
        try await conn.send("\(tag) \(cmd)\r\n")
        return try await collect(until: tag)
    }

    /// Wählt einen Ordner und liefert die Anzahl Nachrichten
    func select(_ mailbox: String) async throws -> Int {
        selectedMailbox = nil
        uidValidity = ""
        let rs = try await command("SELECT \(Self.quote(mailbox))")
        selectedMailbox = mailbox
        var exists = 0
        for r in rs {
            let parts = r.text.split(separator: " ")
            if parts.count >= 3, parts[0] == "*", parts[2] == "EXISTS", let n = Int(parts[1]) { exists = n }
            if let v = Pattern.first(#"UIDVALIDITY (\d+)"#, in: r.text) { uidValidity = v }
        }
        return exists
    }

    static let syncFolderName = "SimpleMail-Sync"

    /// Sucht den Sync-Ordner (auch als Unterordner von INBOX) und legt ihn bei Bedarf an
    func ensureSyncFolder() async throws -> String {
        let rs = try await command("LIST \"\" \"*\"")
        var inboxDelimiter = ""
        for r in rs where r.text.hasPrefix("* LIST ") {
            guard let g = Pattern.groups(#"^\* LIST \(([^)]*)\) (NIL|"(?:[^"\\]|\\.)*"|\S+) (.*)$"#, in: r.text),
                  g.count == 3 else { continue }
            let path = g[2] == "{}"
                ? String(decoding: r.literals.first ?? Data(), as: UTF8.self)
                : Self.unquote(g[2])
            let delim = Self.unquote(g[1])
            if path.uppercased() == "INBOX", delim.count == 1 { inboxDelimiter = delim }
            let leaf = delim.count == 1 ? String(path.split(separator: Character(delim)).last ?? Substring(path)) : path
            if leaf == Self.syncFolderName { return path }
        }
        var candidates = [Self.syncFolderName]
        if !inboxDelimiter.isEmpty { candidates.append("INBOX\(inboxDelimiter)\(Self.syncFolderName)") }
        var lastError: Error?
        for c in candidates {
            do {
                try await command("CREATE \(Self.quote(c))")
                return c
            } catch {
                lastError = error
            }
        }
        throw MailError.invalidResponse("Sync-Ordner konnte nicht angelegt werden: \(lastError?.localizedDescription ?? "")")
    }

    /// Alle UIDs des gewählten Ordners
    func allUIDs() async throws -> [UInt32] {
        let rs = try await command("UID SEARCH ALL")
        var uids: [UInt32] = []
        for r in rs where r.text.hasPrefix("* SEARCH") {
            uids += r.text.dropFirst(8).split(separator: " ").compactMap { UInt32($0) }
        }
        return uids
    }

    /// Mehrere Nachrichten vollständig laden (für die Offline-Ablage)
    func fetchRawMany(_ uids: [UInt32]) async throws -> [(UInt32, Data)] {
        guard !uids.isEmpty else { return [] }
        let set = Self.uidSet(uids)
        let rs = try await command("UID FETCH \(set) (UID BODY.PEEK[])")
        var out: [(UInt32, Data)] = []
        for r in rs where r.text.contains("FETCH") {
            if let u = Pattern.first(#"UID (\d+)"#, in: r.text), let uid = UInt32(u), let data = r.literals.first {
                out.append((uid, data))
            }
        }
        return out
    }

    /// Nachrichten endgültig entfernen
    func expungeUIDs(_ uids: [UInt32]) async throws {
        guard !uids.isEmpty else { return }
        let set = uids.map(String.init).joined(separator: ",")
        try await command("UID STORE \(set) +FLAGS.SILENT (\\Deleted)")
        try await command("EXPUNGE")
    }

    /// Wählt den Ordner nur, wenn er nicht schon aktiv ist
    func ensureSelected(_ mailbox: String) async throws {
        if selectedMailbox != mailbox { _ = try await select(mailbox) }
    }

    /// Header der Nachrichten mit Sequenznummern from...to
    func fetchRange(from: Int, to: Int, account: UUID, folder: String) async throws -> [MailMessage] {
        guard to >= from, to > 0 else { return [] }
        let rs = try await command(
            "FETCH \(max(1, from)):\(to) (UID FLAGS BODY.PEEK[HEADER.FIELDS (\(Self.headerFields))])")
        return rs.compactMap { Self.parseFetch($0, account: account, folder: folder) }
    }

    /// Header bestimmter UIDs (z. B. Suchergebnisse)
    func fetchUIDs(_ uids: [UInt32], account: UUID, folder: String) async throws -> [MailMessage] {
        guard !uids.isEmpty else { return [] }
        let set = Self.uidSet(uids)
        let rs = try await command(
            "UID FETCH \(set) (UID FLAGS BODY.PEEK[HEADER.FIELDS (\(Self.headerFields))])")
        return rs.compactMap { Self.parseFetch($0, account: account, folder: folder) }
    }

    /// Gelesen-/Markiert-Status einer Nachricht (ohne Kopfzeilen)
    struct FlagState {
        let uid: UInt32
        let isRead: Bool
        let isFlagged: Bool
    }

    /// Nur UID und Flags der Nachrichten from...to – wenige Bytes je Mail statt kompletter Kopfzeilen
    func fetchFlags(from: Int, to: Int) async throws -> [FlagState] {
        guard to >= from, to > 0 else { return [] }
        let rs = try await command("FETCH \(max(1, from)):\(to) (UID FLAGS)")
        var out: [FlagState] = []
        out.reserveCapacity(to - from + 1)
        for r in rs where r.text.hasPrefix("* ") && r.text.contains(" FETCH ") {
            guard let u = Pattern.first(#"UID (\d+)"#, in: r.text), let uid = UInt32(u) else { continue }
            let flags = Pattern.first(#"FLAGS \(([^)]*)\)"#, in: r.text) ?? ""
            out.append(FlagState(uid: uid, isRead: flags.contains("\\Seen"), isFlagged: flags.contains("\\Flagged")))
        }
        return out
    }

    /// UID-Liste kompakt als Bereiche („1:50,60,70:80“) – kurze Befehlszeile auch bei vielen UIDs
    static func uidSet(_ uids: [UInt32]) -> String {
        let sorted = Array(Set(uids)).sorted()
        var parts: [String] = []
        var i = 0
        while i < sorted.count {
            var j = i
            while j + 1 < sorted.count && sorted[j + 1] == sorted[j] + 1 { j += 1 }
            parts.append(i == j ? "\(sorted[i])" : "\(sorted[i]):\(sorted[j])")
            i = j + 1
        }
        return parts.joined(separator: ",")
    }

    /// Volltextsuche im gewählten Ordner (Betreff, Absender, Text). Liefert UIDs.
    func search(_ text: String) async throws -> [UInt32] {
        let tag = nextTag()
        let bytes = Data(text.utf8)
        if text.allSatisfy({ $0.isASCII }) {
            try await conn.send("\(tag) UID SEARCH TEXT \(Self.quote(text))\r\n")
        } else {
            // Nicht-ASCII muss als Literal gesendet werden (RFC 3501)
            try await conn.send("\(tag) UID SEARCH CHARSET UTF-8 TEXT {\(bytes.count)}\r\n")
            while true {
                let r = try await readResponse()
                if r.text.hasPrefix("+") { break }
                if r.text.hasPrefix(tag + " ") { throw MailError.server(r.text) }
            }
            try await conn.send(bytes + Data([13, 10]))
        }
        let rs = try await collect(until: tag)
        var uids: [UInt32] = []
        for r in rs where r.text.hasPrefix("* SEARCH") {
            uids += r.text.dropFirst(8).split(separator: " ").compactMap { UInt32($0) }
        }
        return uids
    }

    func fetchRaw(uid: UInt32) async throws -> Data {
        let rs = try await command("UID FETCH \(uid) (UID BODY.PEEK[])")
        for r in rs where r.text.contains("FETCH") && r.text.contains("UID \(uid)") {
            if let data = r.literals.first { return data }
        }
        throw MailError.invalidResponse("Nachricht wurde nicht gefunden (evtl. bereits verschoben).")
    }

    func setFlag(_ flag: String, _ on: Bool, uid: UInt32) async throws {
        try await command("UID STORE \(uid) \(on ? "+" : "-")FLAGS.SILENT (\(flag))")
    }

    func move(uid: UInt32, to folder: String) async throws {
        do {
            try await command("UID MOVE \(uid) \(Self.quote(folder))")
        } catch MailError.server(_) {
            // Fallback für Server ohne MOVE-Erweiterung
            try await command("UID COPY \(uid) \(Self.quote(folder))")
            try await setFlag("\\Deleted", true, uid: uid)
            try await command("EXPUNGE")
        }
    }

    func append(_ message: Data, to folder: String, flags: String = "\\Seen") async throws {
        let tag = nextTag()
        try await conn.send("\(tag) APPEND \(Self.quote(folder)) (\(flags)) {\(message.count)}\r\n")
        while true {
            let r = try await readResponse()
            if r.text.hasPrefix("+") { break }
            if r.text.hasPrefix(tag + " ") { throw MailError.server(r.text) }
        }
        try await conn.send(message + Data([13, 10]))
        _ = try await collect(until: tag)
    }

    /// Alle Ordner (LIST), sortiert: Posteingang, Spezialordner, Rest alphabetisch
    func listFolders() async throws -> [MailFolder] {
        let rs = try await command("LIST \"\" \"*\"")
        var result: [MailFolder] = []
        for r in rs where r.text.hasPrefix("* LIST ") {
            guard let g = Pattern.groups(#"^\* LIST \(([^)]*)\) (NIL|"(?:[^"\\]|\\.)*"|\S+) (.*)$"#, in: r.text),
                  g.count == 3 else { continue }
            let attrs = g[0].lowercased()
            let path = g[2] == "{}"
                ? String(decoding: r.literals.first ?? Data(), as: UTF8.self)
                : Self.unquote(g[2])
            let delim = Self.unquote(g[1])
            let parts: [String] = delim.count == 1
                ? path.split(separator: Character(delim)).map(String.init)
                : [path]
            let leaf = MUTF7.decode(parts.last ?? path)
            if leaf == Self.syncFolderName { continue }   // versteckter Sync-Ordner
            let isInbox = path.uppercased() == "INBOX"
            result.append(MailFolder(
                path: path,
                name: isInbox ? "Posteingang" : leaf,
                depth: max(0, parts.count - 1),
                selectable: !attrs.contains("\\noselect") && !attrs.contains("\\nonexistent"),
                role: MailFolder.role(path: path, leaf: leaf, attributes: attrs),
                isAllMail: attrs.contains("\\all"),
                isVirtual: attrs.contains("\\important") || attrs.contains("\\flagged")))
        }
        // Hierarchie bleibt erhalten, weil nach vollem Pfad sortiert wird
        return result.sorted { a, b in
            let ra = a.depth == 0 ? a.role.rawValue : FolderRole.other.rawValue
            let rb = b.depth == 0 ? b.role.rawValue : FolderRole.other.rawValue
            if ra != rb { return ra < rb }
            return MUTF7.decode(a.path).localizedStandardCompare(MUTF7.decode(b.path)) == .orderedAscending
        }
    }

    /// Anzahl ungelesener Nachrichten eines Ordners
    func unseenCount(_ mailbox: String) async throws -> Int {
        let rs = try await command("STATUS \(Self.quote(mailbox)) (UNSEEN)")
        for r in rs where r.text.hasPrefix("* STATUS") {
            if let n = Pattern.first(#"UNSEEN (\d+)"#, in: r.text) { return Int(n) ?? 0 }
        }
        return 0
    }

    /// Erkennt Archiv-, Papierkorb- und Gesendet-Ordner (RFC 6154 + Namens-Fallback)
    func detectSpecialFolders() async throws -> SpecialFolders {
        let all = try await listFolders()
        func first(_ role: FolderRole) -> String? {
            all.first { $0.role == role && $0.selectable && $0.depth == 0 }?.path
                ?? all.first { $0.role == role && $0.selectable }?.path
        }
        return SpecialFolders(archive: first(.archive), trash: first(.trash), sent: first(.sent), junk: first(.junk))
    }

    func capabilities() async throws -> String {
        let rs = try await command("CAPABILITY")
        return rs.map(\.text).joined(separator: " ").uppercased()
    }

    /// IMAP IDLE (RFC 2177): wartet auf Änderungen im gewählten Ordner.
    /// Gibt true zurück, wenn sich etwas geändert hat, false nach Ablauf von maxDuration.
    func idle(maxDuration: TimeInterval) async throws -> Bool {
        let tag = nextTag()
        try await conn.send("\(tag) IDLE\r\n")
        while true {
            let r = try await readResponse()
            if r.text.hasPrefix("+") { break }
            if r.text.hasPrefix(tag + " ") { throw MailError.server(r.text) }
        }

        let link = conn
        let done = OnceFlag()
        let timer = Task {
            try await Task.sleep(nanoseconds: UInt64(maxDuration * 1_000_000_000))
            if done.trySet() { try await link.send("DONE\r\n") }
        }
        defer { timer.cancel() }

        var changed = false
        while true {
            let r = try await readResponse(timeout: maxDuration + 120)
            let t = r.text.uppercased()
            if t.hasPrefix(tag + " ") {
                if t.hasPrefix(tag + " OK") { return changed }
                throw MailError.server(r.text)
            }
            if t.hasPrefix("* BYE") { throw MailError.connectionClosed }
            if t.hasSuffix(" EXISTS") || t.hasSuffix(" EXPUNGE") || t.contains(" FETCH ") {
                changed = true
                if done.trySet() { try await link.send("DONE\r\n") }
            }
        }
    }

    // MARK: Intern

    private func nextTag() -> String {
        tagCounter += 1
        return "A\(tagCounter)"
    }

    private func collect(until tag: String) async throws -> [IMAPResponse] {
        var out: [IMAPResponse] = []
        while true {
            let r = try await readResponse()
            if r.text.hasPrefix(tag + " ") {
                let status = String(r.text.dropFirst(tag.count + 1))
                if status.hasPrefix("OK") { return out }
                throw MailError.server(status)
            }
            out.append(r)
        }
    }

    private func readResponse(timeout: TimeInterval = 60) async throws -> IMAPResponse {
        var text = ""
        var literals: [Data] = []
        while true {
            let lineData = try await conn.readLine(timeout: timeout)
            let line = String(decoding: lineData, as: UTF8.self)
            // Regex nur prüfen, wenn die Zeile überhaupt mit „}“ endet (spart sie bei fast allen Zeilen)
            if lineData.last == 125, let m = line.range(of: #"\{(\d+)\}$"#, options: .regularExpression),
               let n = Int(line[m].dropFirst().dropLast()) {
                text += String(line[..<m.lowerBound]) + "{}"
                literals.append(try await conn.readBytes(n))
            } else {
                text += line
                return IMAPResponse(text: text, literals: literals)
            }
        }
    }

    static func parseFetch(_ r: IMAPResponse, account: UUID, folder: String) -> MailMessage? {
        guard r.text.range(of: #"^\* \d+ FETCH"#, options: .regularExpression) != nil,
              let uidStr = Pattern.first(#"UID (\d+)"#, in: r.text),
              let uid = UInt32(uidStr),
              let headerData = r.literals.first else { return nil }

        let flags = Pattern.first(#"FLAGS \(([^)]*)\)"#, in: r.text) ?? ""
        let h = MIME.parseHeaders(headerData)
        let (name, addr) = MIME.parseAddress(h["from"] ?? "")
        return MailMessage(
            accountID: account,
            folder: folder,
            uid: uid,
            fromName: name,
            fromAddress: addr,
            to: MIME.decodeHeader(h["to"] ?? ""),
            subject: MIME.decodeHeader(h["subject"] ?? ""),
            date: MIME.parseDate(h["date"]) ?? .distantPast,
            messageID: h["message-id"] ?? "",
            references: h["references"] ?? "",
            isRead: flags.contains("\\Seen"),
            isFlagged: flags.contains("\\Flagged"),
            hasAttachment: (h["content-type"]?.lowercased() ?? "").hasPrefix("multipart/mixed"),
            category: Categorizer.categorize(headers: h, address: addr, subject: MIME.decodeHeader(h["subject"] ?? "")),
            // Alle Empfänger-Angaben (für Regeln): An, Kopie, Verteiler- und Weiterleitungsadressen
            recipients: ["to", "cc", "delivered-to", "x-original-to", "envelope-to", "x-envelope-to",
                         "resent-to", "list-post", "list-id"]
                .compactMap { h[$0] }.map(MIME.decodeHeader).joined(separator: " "),
            // Punkte für den automatischen Spamfilter (nur aus den Kopfzeilen)
            spamScore: SpamFilter.score(fromName: name, fromAddress: addr,
                                        subject: MIME.decodeHeader(h["subject"] ?? ""), headers: h).score,
            catVersion: Categorizer.version,
            authFailed: SpamFilter.authFailed(headers: h))
    }

    static func quote(_ s: String) -> String {
        // Zeilenumbrüche/NUL würden einen weiteren IMAP-Befehl anhängen (z. B. Ordnername aus Sync-Regeln)
        let clean = s.replacingOccurrences(of: "\r", with: "").replacingOccurrences(of: "\n", with: "")
            .replacingOccurrences(of: "\0", with: "")
        return "\"" + clean.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\""
    }

    static func unquote(_ s: String) -> String {
        guard s.count >= 2, s.hasPrefix("\""), s.hasSuffix("\"") else { return s }
        return String(s.dropFirst().dropLast())
            .replacingOccurrences(of: "\\\"", with: "\"")
            .replacingOccurrences(of: "\\\\", with: "\\")
    }
}

/// Serialisiert Zugriffe auf die eine IMAP-Verbindung
actor AsyncLock {
    private var locked = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func lock() async {
        if !locked { locked = true; return }
        await withCheckedContinuation { waiters.append($0) }
    }

    func unlock() {
        if waiters.isEmpty { locked = false } else { waiters.removeFirst().resume() }
    }
}

/// Hält eine IMAP-Verbindung offen, verbindet bei Abbruch automatisch neu
final class IMAPService {
    private let account: Account
    private let password: String
    private var client: IMAPClient?
    private var folders = SpecialFolders()
    private let lock = AsyncLock()

    init(account: Account, password: String) {
        self.account = account
        self.password = password
    }

    func perform<T>(_ op: (IMAPClient, SpecialFolders) async throws -> T) async throws -> T {
        let lock = self.lock
        await lock.lock()
        defer { Task { await lock.unlock() } }
        do {
            let c = try await connectedClient()
            return try await op(c, folders)
        } catch let e as MailError where e.isServerReply {
            throw e
        } catch {
            // Verbindungsfehler → einmal neu verbinden
            client?.close()
            client = nil
            let c = try await connectedClient()
            return try await op(c, folders)
        }
    }

    private func connectedClient() async throws -> IMAPClient {
        if let client { return client }
        let c = IMAPClient(host: account.imapHost, port: account.imapPort)
        do {
            try await c.connect()
            try await c.login(user: account.username, password: password)
            folders = (try? await c.detectSpecialFolders()) ?? SpecialFolders()
        } catch {
            c.close()
            throw error
        }
        client = c
        return c
    }
}

// MARK: - SMTP

final class SMTPClient {
    private let account: Account
    private let password: String

    init(account: Account, password: String) {
        self.account = account
        self.password = password
    }

    /// Port 465 = implizites TLS, sonst STARTTLS. Liefert die Schlussantwort des Servers (z. B. „250 … queued as …“)
    @discardableResult
    func send(_ message: Data, from: String, to recipients: [String]) async throws -> String {
        let implicitTLS = account.smtpPort == 465
        let conn = LineConnection(host: account.smtpHost, port: account.smtpPort, tls: implicitTLS)
        defer { conn.close() }

        try await expect(conn, [220])
        var caps = try await ehlo(conn)
        if !implicitTLS {
            guard caps.contains("STARTTLS") else {
                throw MailError.server("SMTP-Server bietet kein STARTTLS an")
            }
            try await command(conn, "STARTTLS", [220])
            conn.startTLS()
            caps = try await ehlo(conn)
        }

        do {
            let smtpPassword = Gmail.cleanPassword(password, host: account.smtpHost)
            let token = Data("\0\(account.username)\0\(smtpPassword)".utf8).base64EncodedString()
            try await command(conn, "AUTH PLAIN \(token)", [235])
        } catch MailError.server(_) {
            try await command(conn, "AUTH LOGIN", [334])
            try await command(conn, Data(account.username.utf8).base64EncodedString(), [334])
            try await command(conn, Data(Gmail.cleanPassword(password, host: account.smtpHost).utf8).base64EncodedString(), [235])
        }

        try await command(conn, "MAIL FROM:<\(from)>", [250])
        for r in recipients { try await command(conn, "RCPT TO:<\(r)>", [250, 251]) }
        try await command(conn, "DATA", [354])

        var payload = String(decoding: message, as: UTF8.self)
        payload = payload.replacingOccurrences(of: "\r\n.", with: "\r\n..")  // Dot-Stuffing
        if !payload.hasSuffix("\r\n") { payload += "\r\n" }
        try await conn.send(payload + ".\r\n")
        let reply = try await expect(conn, [250]).joined(separator: " ")
        _ = try? await command(conn, "QUIT", [221])
        return reply
    }

    private func ehlo(_ conn: LineConnection) async throws -> String {
        try await command(conn, "EHLO localhost", [250]).joined(separator: "\n").uppercased()
    }

    @discardableResult
    private func command(_ conn: LineConnection, _ cmd: String, _ ok: [Int]) async throws -> [String] {
        try await conn.send(cmd + "\r\n")
        return try await expect(conn, ok)
    }

    @discardableResult
    private func expect(_ conn: LineConnection, _ ok: [Int]) async throws -> [String] {
        var lines: [String] = []
        while true {
            let line = String(decoding: try await conn.readLine(), as: UTF8.self)
            lines.append(line)
            let chars = Array(line)
            if chars.count < 4 || chars[3] != "-" { break }
        }
        let code = Int(lines.last?.prefix(3) ?? "") ?? 0
        guard ok.contains(code) else { throw MailError.server(lines.joined(separator: " ")) }
        return lines
    }
}

// MARK: - Push (IMAP IDLE)

/// Setzt einen Wert genau einmal (thread-sicher)
final class OnceFlag {
    private let lock = NSLock()
    private var isSet = false

    func trySet() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if isSet { return false }
        isSet = true
        return true
    }
}

/// Hält die aktuelle IDLE-Verbindung, damit stop() sie sofort schließen kann
final class ClientBox {
    private let lock = NSLock()
    private var client: IMAPClient?

    func set(_ c: IMAPClient?) {
        lock.lock()
        client = c
        lock.unlock()
    }

    func close() {
        lock.lock()
        let c = client
        client = nil
        lock.unlock()
        c?.close()
    }
}

/// Eigene IMAP-Verbindung, die per IDLE auf neue Mails im Posteingang wartet
final class IdleWatcher {
    private let account: Account
    private let password: String
    private let box = ClientBox()
    private var task: Task<Void, Never>?

    init(account: Account, password: String) {
        self.account = account
        self.password = password
    }

    func start(onStatus: @escaping @Sendable (Bool) async -> Void,
               onChange: @escaping @Sendable () async -> Void) {
        stop()
        let account = self.account
        let password = self.password
        let box = self.box
        task = Task.detached(priority: .utility) {
            var backoff: UInt64 = 5
            var reconnect = false
            while !Task.isCancelled {
                let c = IMAPClient(host: account.imapHost, port: account.imapPort)
                box.set(c)
                do {
                    try await c.connect()
                    try await c.login(user: account.username, password: password)
                    let caps = try await c.capabilities()
                    guard caps.contains("IDLE") else {
                        // Server kann kein Push – es bleibt beim regelmäßigen Abruf
                        box.close()
                        await onStatus(false)
                        return
                    }
                    _ = try await c.select("INBOX")
                    await onStatus(true)
                    backoff = 5
                    // 2.29: nach Wiederverbindung (WLAN, Ruhezustand) verpasste Mails sofort abholen –
                    // vorher kamen sie erst mit dem nächsten regelmäßigen Abruf
                    if reconnect { await onChange() }
                    reconnect = true
                    while !Task.isCancelled {
                        // Gmail & Co. trennen nach ~29 min – daher alle 25 min neu starten
                        if try await c.idle(maxDuration: 25 * 60) {
                            await onChange()
                        }
                    }
                } catch {
                    await onStatus(false)
                }
                box.close()
                if Task.isCancelled { return }
                try? await Task.sleep(nanoseconds: backoff * 1_000_000_000)
                backoff = min(backoff * 2, 300)
            }
        }
    }

    func stop() {
        task?.cancel()
        task = nil
        box.close()
    }
}

// MARK: - Gmail / Googlemail

enum Gmail {
    static let loginHint = "Gmail/Googlemail lehnt die Anmeldung ab. Benutzername = volle E-Mail-Adresse, Passwort = App-Passwort (myaccount.google.com/apppasswords, 2-Faktor muss an sein)"

    /// Läuft das Konto über Google (gmail.com, googlemail.com, Google Workspace über imap.gmail.com)?
    static func isGmail(_ a: Account) -> Bool {
        isGmailHost(a.imapHost) || isGmailHost(a.smtpHost)
    }

    static func isGmailHost(_ host: String) -> Bool {
        let h = host.lowercased().trimmingCharacters(in: .whitespaces)
        return h.hasSuffix("gmail.com") || h.hasSuffix("googlemail.com")
    }

    /// App-Passwörter werden mit Leerzeichen angezeigt („abcd efgh ijkl mnop“) – Google erwartet sie ohne
    static func cleanPassword(_ pw: String, host: String) -> String {
        guard isGmailHost(host) else { return pw }
        let t = pw.trimmingCharacters(in: .whitespaces)
        if t.range(of: #"^[a-zA-Z]{4}( [a-zA-Z]{4}){3}$"#, options: .regularExpression) != nil {
            return t.replacingOccurrences(of: " ", with: "")
        }
        return pw
    }
}
