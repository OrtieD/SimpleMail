import SwiftUI
import AppKit

// MARK: - Regeln (automatisch einsortieren)
// Gleiches Format wie die Windows-Version, damit Regeln per Sync übertragen werden.

struct RuleCondition: Codable, Hashable {
    var field = "from"      // from | to | subject | any
    var op = "contains"     // contains | notContains | equals | startsWith | endsWith
    var value = ""
}

struct RuleActions: Codable, Hashable {
    var moveTo = ""         // Ordnerpfad (Unicode), leer = nicht verschieben
    var markRead = false
    var flag = false
    var forwardTo = ""      // 2.44: Weiterleiten an (Adressen mit Komma), leer = nicht weiterleiten
    var copyAccount = ""    // 2.45: Kopie ablegen – Zielkonto (E-Mail, klein), leer = keine Kopie
    var copyTo = ""         // 2.45: Kopie ablegen – Ordnerpfad (Unicode) im Zielkonto; Original bleibt
}

struct MailRule: Codable, Identifiable, Hashable {
    var id = UUID().uuidString.lowercased()
    var name = "Neue Regel"
    var enabled = true
    var accountEmail = ""
    var match = "all"       // all | any
    var conditions: [RuleCondition] = [RuleCondition()]
    var actions = RuleActions()
    var order: Double = 0
    var updatedAt: Double = 0
    var deleted = false

    static let fields: [(String, String)] = [
        ("from", "Absender"), ("to", "Empfänger (An, Kopie, Verteiler)"), ("subject", "Betreff"), ("any", "Absender, Empfänger oder Betreff"),
    ]
    static let ops: [(String, String)] = [
        ("contains", "enthält"), ("notContains", "enthält nicht"), ("equals", "ist gleich"),
        ("startsWith", "beginnt mit"), ("endsWith", "endet mit"),
    ]

    func matches(_ m: MailMessage) -> Bool {
        let conds = conditions.filter { !$0.value.trimmingCharacters(in: .whitespaces).isEmpty }
        guard !conds.isEmpty else { return false }
        func test(_ c: RuleCondition) -> Bool {
            // Mehrere Begriffe mit Komma oder Semikolon: einer davon muss passen („enthält nicht“: keiner)
            let terms = c.value.lowercased().split(whereSeparator: { $0 == "," || $0 == ";" })
                .map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            if terms.count > 1 {
                var single = c
                if c.op == "notContains" {
                    return terms.allSatisfy { t in single.value = t; return test(single) }
                }
                return terms.contains { t in single.value = t; return test(single) }
            }
            let v = c.value.trimmingCharacters(in: .whitespaces).lowercased()
            let hay: String
            switch c.field {
            case "from": hay = "\(m.fromName) <\(m.fromAddress)>"
            case "to": hay = m.recipients ?? m.to
            case "subject": hay = m.subject
            default: hay = "\(m.fromName) \(m.fromAddress) \(m.recipients ?? m.to) \(m.subject)"
            }
            let h = hay.lowercased()
            let whole = c.field == "from" ? [m.fromAddress.lowercased(), m.fromName.lowercased()] : [h]
            switch c.op {
            case "equals": return whole.contains(v)
            case "startsWith": return whole.contains { $0.hasPrefix(v) }
            case "endsWith": return whole.contains { $0.hasSuffix(v) }
            case "notContains": return !h.contains(v)
            default: return h.contains(v)
            }
        }
        return match == "any" ? conds.contains(where: test) : conds.allSatisfy(test)
    }
}

extension MailRule {
    /// Tolerant gegenüber fehlenden Feldern (ältere Versionen, andere Plattform)
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString.lowercased()
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        enabled = try c.decodeIfPresent(Bool.self, forKey: .enabled) ?? true
        accountEmail = try c.decodeIfPresent(String.self, forKey: .accountEmail) ?? ""
        match = try c.decodeIfPresent(String.self, forKey: .match) ?? "all"
        conditions = (try? c.decodeIfPresent([RuleCondition].self, forKey: .conditions)) ?? []
        actions = (try? c.decodeIfPresent(RuleActions.self, forKey: .actions)) ?? RuleActions()
        order = (try? c.decodeIfPresent(Double.self, forKey: .order)) ?? 0
        updatedAt = (try? c.decodeIfPresent(Double.self, forKey: .updatedAt)) ?? 1
        deleted = (try? c.decodeIfPresent(Bool.self, forKey: .deleted)) ?? false
    }

    var dictionary: [String: Any] {
        guard let data = try? JSONEncoder().encode(self),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return obj
    }

    static func from(_ value: Any) -> MailRule? {
        guard JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value) else { return nil }
        return try? JSONDecoder().decode(MailRule.self, from: data)
    }
}

extension RuleCondition {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        field = try c.decodeIfPresent(String.self, forKey: .field) ?? "from"
        op = try c.decodeIfPresent(String.self, forKey: .op) ?? "contains"
        value = try c.decodeIfPresent(String.self, forKey: .value) ?? ""
    }
}

extension RuleActions {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        moveTo = try c.decodeIfPresent(String.self, forKey: .moveTo) ?? ""
        markRead = try c.decodeIfPresent(Bool.self, forKey: .markRead) ?? false
        flag = try c.decodeIfPresent(Bool.self, forKey: .flag) ?? false
        forwardTo = (try? c.decodeIfPresent(String.self, forKey: .forwardTo)) ?? ""
        copyAccount = (try? c.decodeIfPresent(String.self, forKey: .copyAccount)) ?? ""
        copyTo = (try? c.decodeIfPresent(String.self, forKey: .copyTo)) ?? ""
    }
}

// MARK: - Regel-Aktion „Weiterleiten“ (2.44, gleich wie Windows 3.2.39)
// Schleifenschutz: eigene Weiterleitungen tragen X-SimpleMail-Forwarded und werden nie erneut weitergeleitet;
// keine Weiterleitung von Mails eigener Konten, Zieladressen oder Mailer-Daemons; eigene Adresse ist kein Ziel.
// Doppelt-Schutz (Mac + Windows gleichzeitig): IMAP-Schlüsselwort $SMForwarded am Original + lokale Liste.
// „Regeln jetzt anwenden“ leitet nie weiter (sonst gingen hunderte alte Mails raus).

struct ForwardJob: Sendable {
    var uid: UInt32
    var messageID: String
    var targets: [String]
    var ruleID: String
    var raw = Data()
}

struct CopyJob: Sendable {
    var uid: UInt32
    var messageID: String
    var accountEmail: String
    var path: String
    var seen: Bool
    var raw = Data()
}

struct RuleRunResult: Sendable {
    var done = Set<UInt32>()
    var failed: [String] = []
    var forwards: [ForwardJob] = []
    var copies: [CopyJob] = []
}

// MARK: - Regel-Aktion „Kopie ablegen in“ (2.45, gleich wie Windows 3.2.40)
// Kopiert die Mail (APPEND) in einen Ordner eines beliebigen Kontos – das Original bleibt, wo es ist.
// Doppelt-Schutz: IMAP-Schlüsselwort $SMCopied am Original + lokale Liste (Mac + Windows → nur eine Kopie).
enum RuleCopy {
    static let keyword = "$SMCopied"
    static let maxPerRun = 500

    static var remembered: [String] { UserDefaults.standard.stringArray(forKey: "copiedIDs") ?? [] }

    static func remember(_ id: String) {
        guard !id.isEmpty else { return }
        var list = remembered.filter { $0 != id }
        list.append(id)
        UserDefaults.standard.set(Array(list.suffix(5000)), forKey: "copiedIDs")
    }
}

enum RuleForward {
    static let keyword = "$SMForwarded"
    static let header = "X-SimpleMail-Forwarded"
    static let maxPerRun = 20

    /// „Chef <chef@firma.de>, buero@firma.de“ → [chef@firma.de, buero@firma.de]
    static func targets(_ value: String) -> [String] {
        var out: [String] = []
        for part in value.split(whereSeparator: { $0 == "," || $0 == ";" }) {
            let a = MIME.parseAddress(String(part)).address.trimmingCharacters(in: .whitespaces).lowercased()
            let valid = a.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) != nil
            if valid && !out.contains(a) { out.append(a) }
        }
        return out
    }

    static var remembered: [String] { UserDefaults.standard.stringArray(forKey: "forwardedIDs") ?? [] }

    static func remember(_ id: String) {
        guard !id.isEmpty else { return }
        var list = remembered.filter { $0 != id }
        list.append(id)
        UserDefaults.standard.set(Array(list.suffix(2000)), forKey: "forwardedIDs")
    }

    /// Verbleibende Ziele (leer = nicht weiterleiten)
    static func plan(_ m: MailMessage, targets: [String], account: Account, own: [String]) -> [String] {
        let from = m.fromAddress.lowercased()
        if from.isEmpty || own.contains(from) || targets.contains(from) { return [] }
        if from.hasPrefix("mailer-daemon@") || from.hasPrefix("postmaster@") { return [] }
        if !m.messageID.isEmpty && remembered.contains(m.messageID) { return [] }
        let me = account.email.lowercased()
        return targets.filter { $0 != me }
    }

    /// Von SimpleMail (Mac oder Windows) weitergeleitet → nie erneut
    static func isOwnForward(_ raw: Data) -> Bool {
        let h = MIME.parseHeaders(MIME.splitHeaderAndBody(raw).header)
        return h[header.lowercased()] != nil
    }

    private static func germanDate(_ d: Date?) -> String {
        guard let d else { return "" }
        let f = DateFormatter()
        f.locale = Locale(identifier: "de_DE")
        f.dateFormat = "dd.MM.yyyy, HH:mm"
        return f.string(from: d)
    }

    private static func escapeHTML(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
    }

    private static func b64(_ data: Data) -> String {
        data.base64EncodedString(options: [.lineLength76Characters, .endLineWithCarriageReturn, .endLineWithLineFeed])
    }

    /// Weiterleitung: Kopfblock + Originaltext, dazu das Original vollständig als .eml (mit allen Anhängen)
    static func build(raw: Data, account: Account, targets: [String], ruleID: String) -> Data {
        let parsed = MIME.extract(raw: raw)
        let oh = parsed.headers
        let subject = MIME.decodeHeader(oh["subject"] ?? "")
        var lines = [
            "---------- Weitergeleitete Nachricht ----------",
            "Von: " + MIME.decodeHeader(oh["from"] ?? ""),
            "Datum: " + germanDate(MIME.parseDate(oh["date"])),
            "Betreff: " + subject,
            "An: " + MIME.decodeHeader(oh["to"] ?? ""),
        ]
        if let cc = oh["cc"], !cc.isEmpty { lines.append("Kopie: " + MIME.decodeHeader(cc)) }
        let text = (lines.joined(separator: "\n") + "\n\n" + (parsed.content.text ?? ""))
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\n", with: "\r\n")
        let textPart = MessageBuilder.Part(headers: ["Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64"],
                                           body: b64(Data(text.utf8)))
        var main = textPart
        if let html = parsed.content.html, !html.isEmpty {
            let block = lines.map(escapeHTML).joined(separator: "<br>")
            let doc = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head><body>"
                + "<div style=\"font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:14px;color:#444\">\(block)</div><br>"
                + "<div>\(html)</div></body></html>"
            let htmlPart = MessageBuilder.Part(headers: ["Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: base64"],
                                               body: b64(Data(doc.utf8)))
            main = MessageBuilder.multipart("alternative", [textPart, htmlPart])
        }
        // Original: reines ASCII unverändert, sonst Base64 (der SMTP-Versand arbeitet mit UTF-8-Text)
        let ascii = !raw.contains(where: { $0 >= 0x80 })
        var original = ascii ? String(decoding: raw, as: UTF8.self) : b64(raw)
        while original.hasSuffix("\r\n") { original.removeLast() }
        let eml = MessageBuilder.Part(headers: [
            "Content-Type: message/rfc822; name=\"Originalnachricht.eml\"",
            "Content-Disposition: attachment; filename=\"Originalnachricht.eml\"",
            "Content-Transfer-Encoding: " + (ascii ? "7bit" : "base64"),
        ], body: original)
        main = MessageBuilder.multipart("mixed", [main, eml])

        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.dateFormat = "EEE, dd MMM yyyy HH:mm:ss Z"
        let domain = account.email.split(separator: "@").last.map(String.init) ?? "localhost"
        let name = account.displayName.isEmpty ? "" : MessageBuilder.encodeWord(account.displayName) + " "
        let lower = subject.lowercased()
        let newSubject = (lower.hasPrefix("wg:") || lower.hasPrefix("fwd:") || lower.hasPrefix("fw:") || lower.hasPrefix("aw:"))
            ? subject : "WG: " + subject
        var h: [String] = []
        h.append("From: \(name)<\(account.email)>")
        h.append("To: " + targets.joined(separator: ", "))
        h.append("Subject: " + MessageBuilder.encodeWord(newSubject))
        h.append("Date: " + df.string(from: Date()))
        h.append("Message-ID: <\(UUID().uuidString)@\(domain)>")
        h.append("MIME-Version: 1.0")
        h.append("User-Agent: SimpleMail/2.44")
        h.append("\(header): \(ruleID.isEmpty ? "1" : ruleID)")
        h.append("Auto-Submitted: auto-generated")
        h += main.headers
        return Data((h.joined(separator: "\r\n") + "\r\n\r\n" + main.body + "\r\n").utf8)
    }
}

// MARK: - Regeln im Store

extension MailStore {
    var liveRules: [MailRule] {
        rules.filter { !$0.deleted }.sorted { $0.order < $1.order }
    }

    @discardableResult
    func addRule() -> String {
        var r = MailRule()
        r.accountEmail = accounts.first?.email.lowercased() ?? ""
        r.order = (liveRules.map(\.order).max() ?? 0) + 1
        r.updatedAt = nowMillis()
        rules.append(r)
        return r.id
    }

    func updateRule(_ id: String, _ change: (inout MailRule) -> Void) {
        guard let i = rules.firstIndex(where: { $0.id == id }) else { return }
        var r = rules[i]
        change(&r)
        r.updatedAt = nowMillis()
        rules[i] = r
    }

    func deleteRule(_ id: String) {
        updateRule(id) { $0.deleted = true }
    }

    func moveRule(_ id: String, up: Bool) {
        var list = liveRules
        guard let i = list.firstIndex(where: { $0.id == id }) else { return }
        let j = up ? i - 1 : i + 1
        guard j >= 0, j < list.count else { return }
        list.swapAt(i, j)
        var all = rules
        for (k, r) in list.enumerated() {
            if let x = all.firstIndex(where: { $0.id == r.id }) {
                all[x].order = Double(k)
                all[x].updatedAt = nowMillis()
            }
        }
        rules = all
    }

    /// Nur E-Mails, die seit dem letzten Abruf neu sind (beim ersten Mal: keine)
    func newSinceLastRuleCheck(_ id: UUID, uidValidity: String, _ msgs: [MailMessage]) -> Set<UInt32> {
        var state = UserDefaults.standard.dictionary(forKey: "ruleState") as? [String: [String: Any]] ?? [:]
        let key = "\(id.uuidString)|INBOX"
        let maxUid = msgs.map { Int($0.uid) }.max() ?? 0
        let prev = state[key]
        let same = (prev?["uidValidity"] as? String) == uidValidity
        let prevLast = (prev?["lastUid"] as? NSNumber)?.intValue ?? 0
        state[key] = ["uidValidity": uidValidity, "lastUid": max(maxUid, same ? prevLast : 0)]
        UserDefaults.standard.set(state, forKey: "ruleState")
        guard prev != nil, same else { return [] }
        return Set(msgs.filter { Int($0.uid) > prevLast }.map(\.uid))
    }

    /// Wendet die Regeln eines Kontos auf Posteingangs-Mails an. Liefert die Zahl der Treffer.
    @discardableResult
    /// forward: false bei „jetzt anwenden“ – Weiterleiten gilt nur für neu eingehende Mails
    func applyRules(_ s: AccountSession, to list: inout [MailMessage], only: Set<UInt32>?, forward: Bool = true) async -> Int {
        let acc = s.account
        let active = liveRules.filter { $0.enabled && $0.accountEmail.lowercased() == acc.email.lowercased() }
        guard !active.isEmpty, !list.isEmpty else { return 0 }
        if only?.isEmpty == true { return 0 }
        let needsFolders = active.contains(where: { !$0.actions.moveTo.isEmpty || !$0.actions.copyTo.isEmpty })
        if folders[acc.id] == nil, needsFolders {
            await loadFolders()
        }
        let folderList = folders[acc.id] ?? []
        var seen: [UInt32] = []
        var flag: [UInt32] = []
        var moves: [String: [UInt32]] = [:]
        var forwards: [ForwardJob] = []
        var copies: [CopyJob] = []
        let copiedBefore = Set(RuleCopy.remembered)
        let own = accounts.map { $0.email.lowercased() }
        var hits = 0
        for i in list.indices {
            let m = list[i]
            if let only, !only.contains(m.uid) { continue }
            guard let r = active.first(where: { $0.matches(m) }) else { continue }
            hits += 1
            if r.actions.markRead && !m.isRead { seen.append(m.uid); list[i].isRead = true }
            if r.actions.flag && !m.isFlagged { flag.append(m.uid); list[i].isFlagged = true }
            if !r.actions.copyTo.isEmpty && !r.actions.copyAccount.isEmpty {
                let ce = r.actions.copyAccount.lowercased()
                let sameSpot = ce == acc.email.lowercased() && r.actions.copyTo.uppercased() == "INBOX"
                let already = !m.messageID.isEmpty && copiedBefore.contains(m.messageID)
                if !sameSpot && !already {
                    copies.append(CopyJob(uid: m.uid, messageID: m.messageID, accountEmail: ce, path: r.actions.copyTo,
                                          seen: m.isRead || r.actions.markRead))
                }
            }
            if forward && !r.actions.forwardTo.isEmpty {
                let t = RuleForward.plan(m, targets: RuleForward.targets(r.actions.forwardTo), account: acc, own: own)
                if !t.isEmpty { forwards.append(ForwardJob(uid: m.uid, messageID: m.messageID, targets: t, ruleID: r.id)) }
            }
            let target = r.actions.moveTo
            if !target.isEmpty && target.uppercased() != "INBOX" {
                let raw = folderList.first { MUTF7.decode($0.path) == target || $0.path == target }?.path ?? target
                moves[raw, default: []].append(m.uid)
            }
        }
        guard hits > 0 else { return 0 }
        let seenUIDs = seen
        let flagUIDs = flag
        let moveMap = moves
        let forwardJobs = Array(forwards.prefix(RuleForward.maxPerRun))
        let copyJobs = Array(copies.prefix(RuleCopy.maxPerRun))
        do {
            let moved = try await s.service.perform {
                (c: IMAPClient, _: SpecialFolders) async throws -> RuleRunResult in
                try await c.ensureSelected("INBOX")
                for u in seenUIDs { try await c.setFlag("\\Seen", true, uid: u) }
                for u in flagUIDs { try await c.setFlag("\\Flagged", true, uid: u) }
                var result = RuleRunResult()
                // Kopie ablegen: Original holen, solange es noch im Posteingang liegt
                for job in copyJobs {
                    do {
                        let flagLines = try await c.command("UID FETCH \(job.uid) (FLAGS)")
                        if flagLines.contains(where: { $0.text.contains(RuleCopy.keyword) }) { continue }   // schon kopiert
                        let raw = try await c.fetchRaw(uid: job.uid)
                        try? await c.setFlag(RuleCopy.keyword, true, uid: job.uid)
                        var filled = job
                        filled.raw = raw
                        result.copies.append(filled)
                    } catch {
                        continue
                    }
                }
                // Weiterleiten: Original holen, solange es noch im Posteingang liegt
                for job in forwardJobs {
                    do {
                        let flagLines = try await c.command("UID FETCH \(job.uid) (FLAGS)")
                        if flagLines.contains(where: { $0.text.contains(RuleForward.keyword) }) { continue }   // anderes Gerät war schneller
                        let raw = try await c.fetchRaw(uid: job.uid)
                        if RuleForward.isOwnForward(raw) { continue }
                        // Server ohne Schlüsselwörter: lokale Liste genügt
                        try? await c.setFlag(RuleForward.keyword, true, uid: job.uid)
                        var filled = job
                        filled.raw = raw
                        result.forwards.append(filled)
                    } catch {
                        continue
                    }
                }
                var done = Set<UInt32>()
                var failed: [String] = []
                for (target, uids) in moveMap {
                    for u in uids {
                        do {
                            try await c.move(uid: u, to: target)
                            done.insert(u)
                        } catch MailError.server(let text) {
                            // Zielordner fehlt o. Ä. – Mail bleibt im Posteingang, Fehler wird angezeigt
                            failed.append("„\(MUTF7.decode(target))“: \(text)")
                        }
                    }
                }
                result.done = done
                result.failed = failed
                return result
            }
            list.removeAll { moved.done.contains($0.uid) }
            if let first = moved.failed.first {
                errorMessage = "Regel: Verschieben nach \(first) fehlgeschlagen."
            }
            for job in moved.copies {
                RuleCopy.remember(job.messageID)
                guard let target = accounts.first(where: { $0.email.lowercased() == job.accountEmail }),
                      let ts = sessions[target.id] else {
                    errorMessage = "Regel: Konto \(job.accountEmail) für die Kopie ist nicht verbunden."
                    continue
                }
                let rawPath = (folders[target.id] ?? []).first { MUTF7.decode($0.path) == job.path || $0.path == job.path }?.path
                    ?? MUTF7.encode(job.path)
                let data = job.raw
                let flags = job.seen ? "\\Seen" : ""
                do {
                    _ = try await ts.service.perform { (c: IMAPClient, _: SpecialFolders) async throws -> Bool in
                        try await c.append(data, to: rawPath, flags: flags)
                        return true
                    }
                } catch {
                    errorMessage = "Regel: Kopie nach „\(job.path)“ (\(job.accountEmail)) fehlgeschlagen – \(error.localizedDescription)"
                }
            }
            for job in moved.forwards {
                RuleForward.remember(job.messageID)
                let data = RuleForward.build(raw: job.raw, account: acc, targets: job.targets, ruleID: job.ruleID)
                do {
                    try await deliver(data, to: job.targets, account: acc)
                } catch {
                    errorMessage = "Regel: Weiterleiten an \(job.targets.joined(separator: ", ")) fehlgeschlagen – \(error.localizedDescription)"
                }
            }
            if forwards.count > RuleForward.maxPerRun {
                errorMessage = "Regel „Weiterleiten“: nur \(RuleForward.maxPerRun) von \(forwards.count) Mails auf einmal weitergeleitet."
            }
        } catch {
            errorMessage = "Regeln: \(error.localizedDescription)"
        }
        return hits
    }

    /// „Jetzt anwenden“: Regeln auf die letzten 2000 Mails im Posteingang
    func runRulesNow() async -> Int {
        var total = 0
        var report: [String] = []
        for s in sessions.values {
            let acc = s.account
            let hasRules = liveRules.contains(where: { $0.enabled && $0.accountEmail.lowercased() == acc.email.lowercased() })
            let hasBlocked = blocked.contains(where: { !$0.value.deleted })
            guard hasRules || hasBlocked || spamFilterEnabled else { continue }
            do {
                var msgs = try await s.service.perform {
                    (c: IMAPClient, _: SpecialFolders) async throws -> [MailMessage] in
                    let exists = try await c.select("INBOX")
                    guard exists > 0 else { return [] }
                    return try await c.fetchRange(from: max(1, exists - 1999), to: exists, account: acc.id, folder: "INBOX")
                }
                let scanned = msgs.count
                await moveBlocked(s, &msgs, only: Set(msgs.map(\.uid)))
                let spamCount = await moveSpam(s, &msgs, only: Set(msgs.map(\.uid)))
                var hits = scanned - msgs.count
                hits += await applyRules(s, to: &msgs, only: nil, forward: false)
                total += hits
                let forwarding = liveRules.contains(where: {
                    $0.enabled && !$0.actions.forwardTo.isEmpty && $0.accountEmail.lowercased() == acc.email.lowercased()
                })
                let spamNote = spamCount > 0 ? ", davon \(spamCount) als Spam aussortiert" : ""
                let forwardNote = forwarding ? " (Weiterleiten gilt nur für neu eingehende Mails)" : ""
                report.append("\(acc.email): \(scanned) Mails im Posteingang geprüft, \(hits) passend\(spamNote)\(forwardNote)")
            } catch {
                errorMessage = "\(acc.email): \(error.localizedDescription)"
            }
        }
        await refresh()
        lastRuleReport = report.isEmpty ? "Für keines der verbundenen Konten gibt es eine aktive Regel." : report.joined(separator: "\n")
        return total
    }
}

// MARK: - Einstellungen → Regeln

final class RulesSettingsModel: ObservableObject {
    @Published var selection: String?
    @Published var status = ""
    @Published var running = false
}

struct RulesSettingsView: View {
    @EnvironmentObject var store: MailStore
    @StateObject private var m = RulesSettingsModel()

    var body: some View {
        HStack(spacing: 0) {
            VStack(spacing: 0) {
                List(selection: $m.selection) {
                    ForEach(store.liveRules) { r in
                        Text(r.name.isEmpty ? "(ohne Name)" : r.name)
                            .lineLimit(1)
                            .foregroundStyle(r.enabled ? .primary : .secondary)
                            .tag(Optional(r.id))
                    }
                }
                Divider()
                HStack(spacing: 4) {
                    Button { m.selection = store.addRule() } label: { Image(systemName: "plus") }
                        .help("Regel hinzufügen")
                    Button {
                        if let id = m.selection {
                            m.selection = nil
                            store.deleteRule(id)
                        }
                    } label: { Image(systemName: "minus") }
                        .disabled(m.selection == nil)
                        .help("Regel löschen")
                    Button { if let id = m.selection { store.moveRule(id, up: true) } } label: { Image(systemName: "arrow.up") }
                        .disabled(m.selection == nil)
                        .help("Nach oben (wird früher geprüft)")
                    Button { if let id = m.selection { store.moveRule(id, up: false) } } label: { Image(systemName: "arrow.down") }
                        .disabled(m.selection == nil)
                        .help("Nach unten")
                    Spacer()
                }
                .buttonStyle(.borderless)
                .padding(6)
            }
            .frame(width: 210)
            Divider()
            editor
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .onAppear {
            if m.selection == nil { m.selection = store.liveRules.first?.id }
            if store.folders.isEmpty { Task { await store.loadFolders() } }
        }
    }

    private func binding<T>(_ id: String, _ path: WritableKeyPath<MailRule, T>, _ fallback: T) -> Binding<T> {
        Binding(
            get: { store.rules.first { $0.id == id }?[keyPath: path] ?? fallback },
            set: { v in store.updateRule(id) { $0[keyPath: path] = v } }
        )
    }

    private func condBinding(_ id: String, _ i: Int, _ path: WritableKeyPath<RuleCondition, String>) -> Binding<String> {
        Binding(
            get: {
                guard let r = store.rules.first(where: { $0.id == id }), i < r.conditions.count else { return "" }
                return r.conditions[i][keyPath: path]
            },
            set: { v in store.updateRule(id) { if i < $0.conditions.count { $0.conditions[i][keyPath: path] = v } } }
        )
    }

    /// Ordner des gewählten Kontos (Pfad als Unicode, wie in der Windows-Version)
    private func folderChoices(_ r: MailRule) -> [(String, String)] {
        guard let acc = store.accounts.first(where: { $0.email.lowercased() == r.accountEmail.lowercased() }) else { return [] }
        return (store.folders[acc.id] ?? [])
            .filter { $0.selectable && $0.role != .inbox }
            .map { (MUTF7.decode($0.path), String(repeating: "   ", count: $0.depth) + $0.name) }
    }

    /// Ordner eines beliebigen Kontos für „Kopie ablegen in“ (inkl. Posteingang)
    private func copyFolderChoices(_ email: String) -> [(String, String)] {
        guard let acc = store.accounts.first(where: { $0.email.lowercased() == email.lowercased() }) else { return [] }
        return (store.folders[acc.id] ?? [])
            .filter { $0.selectable }
            .map { (MUTF7.decode($0.path), String(repeating: "   ", count: $0.depth) + $0.name) }
    }

    @ViewBuilder
    private var editor: some View {
        if let id = m.selection, let r = store.rules.first(where: { $0.id == id && !$0.deleted }) {
            Form {
                Section {
                    TextField("Name", text: binding(id, \.name, ""))
                    Toggle("Regel ist aktiv", isOn: binding(id, \.enabled, true))
                    Picker("Konto", selection: Binding(
                        get: { r.accountEmail.lowercased() },
                        set: { v in store.updateRule(id) { $0.accountEmail = v; $0.actions.moveTo = "" } }
                    )) {
                        ForEach(store.accounts) { a in Text(a.email).tag(a.email.lowercased()) }
                    }
                }
                Section("Wenn") {
                    Picker("Zutreffen müssen", selection: binding(id, \.match, "all")) {
                        Text("alle Bedingungen").tag("all")
                        Text("eine der Bedingungen").tag("any")
                    }
                    ForEach(0..<r.conditions.count, id: \.self) { i in
                        HStack {
                            Picker("", selection: condBinding(id, i, \.field)) {
                                ForEach(0..<MailRule.fields.count, id: \.self) { k in
                                    Text(MailRule.fields[k].1).tag(MailRule.fields[k].0)
                                }
                            }
                            .labelsHidden()
                            .frame(width: 170)
                            Picker("", selection: condBinding(id, i, \.op)) {
                                ForEach(0..<MailRule.ops.count, id: \.self) { k in
                                    Text(MailRule.ops[k].1).tag(MailRule.ops[k].0)
                                }
                            }
                            .labelsHidden()
                            .frame(width: 120)
                            TextField("z. B. @lieferant.de", text: condBinding(id, i, \.value))
                                .labelsHidden()
                            Button {
                                store.updateRule(id) { if i < $0.conditions.count { $0.conditions.remove(at: i) } }
                            } label: { Image(systemName: "minus.circle") }
                                .buttonStyle(.borderless)
                                .help("Bedingung entfernen")
                        }
                    }
                    Button("＋ Bedingung") { store.updateRule(id) { $0.conditions.append(RuleCondition()) } }
                }
                Section("Dann") {
                    Picker("Verschieben in", selection: binding(id, \.actions.moveTo, "")) {
                        Text("– nicht verschieben –").tag("")
                        let choices = folderChoices(r)
                        if !r.actions.moveTo.isEmpty && !choices.contains(where: { $0.0 == r.actions.moveTo }) {
                            Text("\(r.actions.moveTo) (nicht gefunden)").tag(r.actions.moveTo)
                        }
                        ForEach(0..<choices.count, id: \.self) { k in
                            Text(choices[k].1).tag(choices[k].0)
                        }
                    }
                    Picker("Kopie ablegen in", selection: Binding(
                        get: { r.actions.copyAccount.lowercased() },
                        set: { v in store.updateRule(id) { $0.actions.copyAccount = v; $0.actions.copyTo = "" } }
                    )) {
                        Text("– keine Kopie –").tag("")
                        ForEach(store.accounts) { a in Text(a.email).tag(a.email.lowercased()) }
                    }
                    if !r.actions.copyAccount.isEmpty {
                        Picker("Ordner für die Kopie", selection: binding(id, \.actions.copyTo, "")) {
                            Text("– Ordner wählen –").tag("")
                            let cchoices = copyFolderChoices(r.actions.copyAccount)
                            if !r.actions.copyTo.isEmpty && !cchoices.contains(where: { $0.0 == r.actions.copyTo }) {
                                Text("\(r.actions.copyTo) (nicht gefunden)").tag(r.actions.copyTo)
                            }
                            ForEach(0..<cchoices.count, id: \.self) { k in
                                Text(cchoices[k].1).tag(cchoices[k].0)
                            }
                        }
                    }
                    Text("Kopie: Die Mail bleibt im Posteingang (bzw. wird wie oben verschoben) und wird zusätzlich in den Ordner eines beliebigen Kontos kopiert – z. B. Mails ans Vorstand-Postfach zusätzlich in einen Ordner deines privaten Kontos.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Toggle("Als gelesen markieren", isOn: binding(id, \.actions.markRead, false))
                    Toggle("Markieren (Stern)", isOn: binding(id, \.actions.flag, false))
                    TextField("Weiterleiten an", text: binding(id, \.actions.forwardTo, ""),
                              prompt: Text("z. B. buero@firma.de (mehrere mit Komma)"))
                    Text("Die Mail wird über dieses Konto als „WG:“ weitergeleitet (Original mit allen Anhängen als .eml dabei). Nur bei neu eingehenden Mails; Weiterleitungen werden nie erneut weitergeleitet.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Section {
                    Text("Mehrere Begriffe in einer Bedingung mit Komma trennen – einer davon muss passen. Regeln gelten für neu eingehende E-Mails im Posteingang. Es greift die erste passende Regel – Reihenfolge mit ↑ ↓ ändern. Regeln werden mit „Offline & Sync“ auf deine anderen Geräte übertragen.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    HStack {
                        Button("Alle Regeln jetzt auf den Posteingang anwenden") {
                            m.running = true
                            m.status = "Wird angewendet …"
                            Task { @MainActor in
                                _ = await store.runRulesNow()
                                m.status = store.lastRuleReport
                                m.running = false
                            }
                        }
                        .disabled(m.running)
                        Text(m.status).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            .formStyle(.grouped)
        } else {
            VStack(spacing: 8) {
                Text("Regeln sortieren E-Mails automatisch ein")
                    .foregroundStyle(.secondary)
                Text("z. B. alles von @lieferant.de in den Ordner „Lieferanten“ – mit ＋ anlegen")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
    }
}
