import SwiftUI
import AppKit

// MARK: - Spam & Phishing (gleiche Prüfungen wie die Windows-Version, security.js)

struct UnsubscribeInfo: Hashable {
    var url: String?
    var mailto: String?
    var oneClick: Bool
}

enum MailSecurity {
    struct Brand {
        let name: String
        let words: [String]
        let domains: [String]
        var ownWord = false   // echt, wenn der Markenname in der Domain steht (regionale Banken)
    }

    static let brands: [Brand] = [
        Brand(name: "PayPal", words: ["paypal"], domains: ["paypal.com", "paypal.de", "paypal-communication.com", "paypal.co.uk"]),
        Brand(name: "Amazon", words: ["amazon"], domains: ["amazon.de", "amazon.com", "amazon.co.uk", "amazonses.com", "amazon.fr", "amazon.it", "amazon.es", "amazon.nl", "amazon.at", "amazonaws.com"]),
        Brand(name: "Apple", words: ["apple", "icloud", "itunes"], domains: ["apple.com", "icloud.com", "me.com", "mac.com", "itunes.com"]),
        Brand(name: "Microsoft", words: ["microsoft", "outlook", "office 365", "office365", "onedrive"], domains: ["microsoft.com", "outlook.com", "office.com", "live.com", "hotmail.com", "microsoftonline.com", "onedrive.com", "sharepoint.com"]),
        Brand(name: "Google", words: ["google", "gmail"], domains: ["google.com", "gmail.com", "googlemail.com", "youtube.com"]),
        Brand(name: "DHL", words: ["dhl"], domains: ["dhl.de", "dhl.com", "deutschepost.de", "dpdhl.com"]),
        Brand(name: "Deutsche Post", words: ["deutsche post"], domains: ["deutschepost.de", "dhl.de", "dpdhl.com"]),
        Brand(name: "DPD", words: ["dpd"], domains: ["dpd.de", "dpd.com"]),
        Brand(name: "Hermes", words: ["hermes"], domains: ["myhermes.de", "hermesworld.com", "hermes-europe.eu"]),
        Brand(name: "UPS", words: ["ups"], domains: ["ups.com"]),
        Brand(name: "Netflix", words: ["netflix"], domains: ["netflix.com"]),
        Brand(name: "eBay", words: ["ebay"], domains: ["ebay.de", "ebay.com", "ebay.co.uk"]),
        Brand(name: "Telekom", words: ["telekom"], domains: ["telekom.de", "t-online.de", "telekom.com"]),
        Brand(name: "Vodafone", words: ["vodafone"], domains: ["vodafone.de", "vodafone.com", "kabeldeutschland.de"]),
        Brand(name: "WEB.DE", words: ["web.de"], domains: ["web.de", "webde.de"]),
        Brand(name: "GMX", words: ["gmx"], domains: ["gmx.de", "gmx.net", "gmx.at", "gmx.ch"]),
        Brand(name: "Elster/Finanzamt", words: ["elster", "finanzamt", "bundeszentralamt"], domains: ["elster.de", "bzst.de", "bund.de"]),
        Brand(name: "Sparkasse", words: ["sparkasse"], domains: [], ownWord: true),
        Brand(name: "Volksbank", words: ["volksbank", "raiffeisenbank"], domains: [], ownWord: true),
        Brand(name: "Commerzbank", words: ["commerzbank"], domains: ["commerzbank.de", "commerzbank.com", "comdirect.de"]),
        Brand(name: "Deutsche Bank", words: ["deutsche bank"], domains: ["db.com", "deutsche-bank.de", "deutschebank.de"]),
        Brand(name: "Postbank", words: ["postbank"], domains: ["postbank.de"]),
        Brand(name: "ING", words: ["ing-diba", "ing diba"], domains: ["ing.de", "ing-diba.de", "ing.com"]),
        Brand(name: "DKB", words: ["dkb"], domains: ["dkb.de"]),
        Brand(name: "N26", words: ["n26"], domains: ["n26.com"]),
    ]

    static func domain(of address: String) -> String {
        String(address.lowercased().split(separator: "@").last ?? "").trimmingCharacters(in: .whitespaces)
    }

    static func belongs(_ domain: String, _ list: [String]) -> Bool {
        list.contains { domain == $0 || domain.hasSuffix("." + $0) }
    }

    static func flat(_ s: String) -> String {
        s.lowercased().filter { $0.isLetter || $0.isNumber }
    }

    /// Wort mit Grenzen (kein Teil eines längeren Worts)
    static func containsWord(_ text: String, _ word: String) -> Bool {
        let escaped = NSRegularExpression.escapedPattern(for: word)
        return text.range(of: "(^|[^a-z0-9])\(escaped)($|[^a-z0-9])", options: [.regularExpression, .caseInsensitive]) != nil
    }

    static func baseDomain(_ host: String) -> String {
        var h = host.lowercased()
        if h.hasPrefix("www.") { h = String(h.dropFirst(4)) }
        let parts = h.split(separator: ".").map(String.init)
        guard parts.count > 2 else { return parts.joined(separator: ".") }
        let two = parts.suffix(2).joined(separator: ".")
        if two.range(of: #"^(co|com|org|net|gov|ac)\.[a-z]{2}$"#, options: .regularExpression) != nil {
            return parts.suffix(3).joined(separator: ".")
        }
        return two
    }

    static func unsubscribe(_ headers: [String: String]) -> UnsubscribeInfo? {
        guard let value = headers["list-unsubscribe"] else { return nil }
        var items: [String] = []
        var rest = Substring(value)
        while let open = rest.firstIndex(of: "<"), let close = rest[open...].firstIndex(of: ">") {
            items.append(rest[rest.index(after: open)..<close].trimmingCharacters(in: .whitespaces))
            rest = rest[rest.index(after: close)...]
        }
        let url = items.first { $0.lowercased().hasPrefix("https://") }
        let mailto = items.first { $0.lowercased().hasPrefix("mailto:") }
        guard url != nil || mailto != nil else { return nil }
        let oneClick = url != nil && (headers["list-unsubscribe-post"] ?? "").lowercased().contains("one-click")
        return UnsubscribeInfo(url: url, mailto: mailto, oneClick: oneClick)
    }

    /// Links, deren sichtbarer Text eine andere Adresse zeigt als das Ziel
    static func linkMismatches(_ html: String) -> [(String, String)] {
        guard let re = try? NSRegularExpression(
            pattern: #"<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)</a>"#, options: .caseInsensitive) else { return [] }
        let ns = html as NSString
        var out: [(String, String)] = []
        for m in re.matches(in: html, range: NSRange(location: 0, length: ns.length)) {
            if out.count >= 3 { break }
            let href = ns.substring(with: m.range(at: 1)).trimmingCharacters(in: .whitespaces)
            guard href.lowercased().hasPrefix("http") else { continue }
            let text = ns.substring(with: m.range(at: 2))
                .replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
                .replacingOccurrences(of: "&nbsp;", with: " ")
                .replacingOccurrences(of: "&amp;", with: "&")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard text.range(of: #"^(https?://)?(www\.)?([a-z0-9-]+\.)+[a-z]{2,}(/\S*)?$"#,
                             options: [.regularExpression, .caseInsensitive]) != nil else { continue }
            let shownURL = text.lowercased().hasPrefix("http") ? text : "https://" + text
            guard let shownHost = URL(string: shownURL)?.host, let realHost = URL(string: href)?.host else { continue }
            if baseDomain(shownHost) != baseDomain(realHost) {
                let shown = text.replacingOccurrences(of: #"^https?://"#, with: "", options: .regularExpression)
                    .split(separator: "/").first.map(String.init) ?? text
                out.append((shown, realHost.lowercased()))
            }
        }
        return out
    }

    static func analyze(fromName: String, fromAddress: String, html: String?, headers: [String: String],
                        own: [String]) -> (warnings: [String], unsubscribe: UnsubscribeInfo?) {
        var warnings: [String] = []
        let dom = domain(of: fromAddress)
        let name = fromName.lowercased()
        let unsub = unsubscribe(headers)

        // 1. Anzeigename enthält eine andere Adresse
        if let r = fromName.range(of: #"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"#, options: .regularExpression) {
            let shown = String(fromName[r])
            // gmail.com und googlemail.com sind dieselbe Adresse
            if Categorizer.normalized(shown) != Categorizer.normalized(fromAddress) {
                warnings.append("Der Absendername zeigt „\(shown)“, die Mail kommt aber von „\(fromAddress)“.")
            }
        }

        // 2. Markenname im Absender, aber fremde Domain
        if !dom.isEmpty && !own.contains(where: { $0.lowercased() == fromAddress.lowercased() }) {
            let tokens = dom.split(whereSeparator: { $0 == "." || $0 == "-" }).map(String.init)
            for b in brands {
                let inName = b.words.contains { containsWord(name, $0) }
                let inDomain = b.words.contains { w in
                    let f = flat(w)
                    return tokens.contains(f) || (f.count >= 6 && flat(dom).contains(f))
                }
                let official = b.ownWord ? inDomain : belongs(dom, b.domains)
                if official { continue }
                if inName {
                    warnings.append("Der Absender nennt sich „\(fromName)“, die Adresse \(dom) gehört aber nicht zu \(b.name).")
                    break
                }
                if inDomain && !b.ownWord {
                    warnings.append("Die Absender-Domain \(dom) ahmt \(b.name) nach – sie gehört nicht zu \(b.name).")
                    break
                }
            }
        }

        // 3. Server-Prüfung (oberste Authentication-Results-Zeile)
        if let auth = headers["authentication-results"]?.lowercased() {
            func get(_ k: String) -> String? {
                guard let r = auth.range(of: "\\b\(k)=([a-z]+)", options: .regularExpression) else { return nil }
                return String(auth[r].split(separator: "=").last ?? "")
            }
            let dmarc = get("dmarc"), spf = get("spf"), dkim = get("dkim")
            if dmarc == "fail" {
                warnings.append("Der Mailserver konnte nicht bestätigen, dass die Mail wirklich von \(dom) stammt (DMARC fehlgeschlagen).")
            } else if dmarc == nil && (spf == "fail" || dkim == "fail") {
                warnings.append("Die Absenderprüfung des Mailservers ist fehlgeschlagen (\(spf == "fail" ? "SPF" : "DKIM")) – Absender evtl. gefälscht.")
            }
        }

        // 4. Irreführende Links (nicht bei Newslettern mit Abmelde-Link)
        if unsub == nil, let html {
            for (shown, real) in linkMismatches(html) {
                warnings.append("Ein Link zeigt „\(shown)“, führt aber zu „\(real)“.")
            }
        }
        return (warnings, unsub)
    }

    /// Einträge: „name@firma.de“ oder „@firma.de“
    static func isBlocked(_ address: String, _ blocked: [String: TrustEntry]) -> Bool {
        let a = address.lowercased()
        let d = "@" + domain(of: a)
        return blocked.contains { entry in
            let k = entry.key
            return !entry.value.deleted && (k == a || k == d || (k.hasPrefix("@") && d.hasSuffix("." + k.dropFirst())))
        }
    }

    static func isFreemail(_ address: String) -> Bool {
        address.lowercased().range(of: #"@(gmail|googlemail|web|gmx|t-online|outlook|hotmail|live|yahoo|icloud|me|aol|freenet|posteo|mailbox)\."#,
                                   options: .regularExpression) != nil
    }
}

// MARK: - Automatischer Spamfilter (gleiche Punkte wie security.js → spamScore)

enum SpamLevel: String, CaseIterable {
    case low, medium, high

    /// Ab so vielen Punkten ist eine Mail Spam
    var threshold: Int {
        switch self {
        case .low: return 6
        case .medium: return 4
        case .high: return 3
        }
    }

    var label: String {
        switch self {
        case .low: return "Niedrig – nur eindeutiger Spam"
        case .medium: return "Mittel (empfohlen)"
        case .high: return "Hoch – sortiert mehr aus"
        }
    }
}

struct SpamScore {
    var score: Int
    var reasons: [String]
}

enum SpamFilter {
    static let words = ["viagra", "cialis", "casino", "lotto", "lottery", "gewinnspiel", "sie haben gewonnen", "you have won",
                        "you won", "erbschaft", "inheritance", "bitcoin", "krypto", "crypto", "abnehmen", "potenz", "sexy", "dating",
                        "konto gesperrt", "konto wurde gesperrt", "account suspended", "verify your account", "bestätigen sie ihr konto",
                        "kredit ohne schufa", "millionen euro", "million dollars", "wire transfer", "rolex", "replica"]

    static let lowerLetters: Set<Character> = Set("abcdefghijklmnopqrstuvwxyzäöüß")
    static let upperLetters: Set<Character> = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ")
    static let digits: Set<Character> = Set("0123456789")

    /// Zeichen, die zu einem Wort gehören (wie [a-z0-9äöüß] in security.js)
    static func isWordChar(_ c: Character) -> Bool {
        lowerLetters.contains(c) || digits.contains(c)
    }

    /// Begriff mit Wortgrenzen im (klein geschriebenen) Text
    static func hasTerm(_ text: String, _ term: String) -> Bool {
        var from = text.startIndex
        while from < text.endIndex, let r = text.range(of: term, range: from..<text.endIndex) {
            let beforeOK = r.lowerBound == text.startIndex || !isWordChar(text[text.index(before: r.lowerBound)])
            let afterOK = r.upperBound == text.endIndex || !isWordChar(text[r.upperBound])
            if beforeOK && afterOK { return true }
            from = text.index(after: r.lowerBound)
        }
        return false
    }

    /// Bewertet eine Mail nur anhand der Kopfzeilen (Schlüssel klein geschrieben)
    static func score(fromName: String, fromAddress: String, subject: String, headers: [String: String]) -> SpamScore {
        var result = SpamScore(score: 0, reasons: [])
        func add(_ n: Int, _ why: String) {
            result.score += n
            result.reasons.append(why)
        }
        // 1. Der Mailserver hat sie schon als Spam markiert
        let flag = (headers["x-spam-flag"] ?? "").trimmingCharacters(in: .whitespaces).lowercased()
        let status = (headers["x-spam-status"] ?? headers["x-spam"] ?? "").trimmingCharacters(in: .whitespaces).lowercased()
        if flag == "yes" || flag == "true" || status.range(of: #"^yes\b"#, options: .regularExpression) != nil {
            add(5, "vom Mailserver als Spam markiert")
        }
        // 2. Absenderprüfung (SPF/DKIM/DMARC)
        if let auth = headers["authentication-results"]?.lowercased(), !auth.isEmpty {
            func get(_ k: String) -> String? {
                guard let r = auth.range(of: "\\b\(k)=([a-z]+)", options: .regularExpression) else { return nil }
                return String(auth[r].split(separator: "=").last ?? "")
            }
            if get("dmarc") == "fail" {
                // Absender verlangt keine Abweisung (p=none) – typisch bei Weiterleitungen und Verteilern
                if auth.range(of: #"\b(p|dis)=none\b"#, options: .regularExpression) != nil {
                    add(2, "DMARC fehlgeschlagen (ohne Sperr-Richtlinie)")
                } else {
                    add(4, "DMARC fehlgeschlagen")
                }
            }
            else if get("spf") == "fail" { add(2, "SPF fehlgeschlagen") }
            else if get("dkim") == "fail" { add(1, "DKIM fehlgeschlagen") }
        }
        // 3. Markenimitat / fremde Adresse im Namen (wie die Warnung in der Leseansicht)
        let warnings = MailSecurity.analyze(fromName: fromName, fromAddress: fromAddress, html: nil, headers: [:], own: []).warnings
        if warnings.contains(where: { $0.contains("gehört aber nicht zu") || $0.contains(" ahmt ") }) {
            add(4, "Absender gibt sich als bekannte Firma aus")
        } else if warnings.contains(where: { $0.contains("Absendername zeigt") }) {
            add(3, "Absendername zeigt eine andere Adresse")
        }
        // 4. Betreff
        let low = subject.lowercased()
        if words.contains(where: { hasTerm(low, $0) }) { add(2, "typische Spam-Wörter im Betreff") }
        let letters = subject.filter { upperLetters.contains($0) || lowerLetters.contains($0) }
        let upper = letters.filter { upperLetters.contains($0) }
        if letters.count >= 10 && Double(upper.count) / Double(letters.count) > 0.7 { add(1, "Betreff in Großbuchstaben") }
        if subject.contains("!!!") || subject.contains("$$$") || subject.contains("€€€") { add(1, "auffällige Zeichen im Betreff") }
        if !fromAddress.contains("@") { add(1, "keine gültige Absenderadresse") }
        return result
    }

    /// DMARC fehlgeschlagen oder (ohne DMARC) SPF fehlgeschlagen – der Absender ist womöglich gefälscht
    static func authFailed(headers: [String: String]) -> Bool {
        guard let auth = headers["authentication-results"]?.lowercased(), !auth.isEmpty else { return false }
        func get(_ k: String) -> String? {
            guard let r = auth.range(of: "\\b\(k)=([a-z]+)", options: .regularExpression) else { return nil }
            return String(auth[r].split(separator: "=").last ?? "")
        }
        let dmarc = get("dmarc")
        return dmarc == "fail" || (dmarc == nil && get("spf") == "fail")
    }

    /// Eigene Adressen und bekannte Absender (Kontakte, vertrauenswürdig) werden nie aussortiert –
    /// außer die Absenderprüfung schlägt fehl (z. B. Erpresser-Mail „von dir selbst“)
    static func isSpam(_ m: MailMessage, level: SpamLevel, known: Set<String>) -> Bool {
        let a = Categorizer.normalized(m.fromAddress)
        if !a.isEmpty && m.authFailed != true && (known.contains(a) || known.contains("@" + MailSecurity.domain(of: a))) { return false }
        let points = m.spamScore ?? score(fromName: m.fromName, fromAddress: m.fromAddress, subject: m.subject, headers: [:]).score
        return points >= level.threshold
    }
}

/// Spam-Ordner eines Kontos; `created`, wenn er gerade angelegt wurde
struct JunkTarget {
    let path: String
    let created: Bool
}

struct SpamMoveResult {
    let moved: Set<UInt32>
    let created: Bool
}

extension IMAPClient {
    /// Liefert den Spam-Ordner; fehlt er, wird „Spam“ angelegt
    func ensureJunkFolder() async throws -> JunkTarget {
        let all = try await listFolders()
        let existing = all.first(where: { $0.role == .junk && $0.selectable && $0.depth == 0 })
            ?? all.first(where: { $0.role == .junk && $0.selectable })
        if let found = existing { return JunkTarget(path: found.path, created: false) }
        var lastError: Error?
        for candidate in ["Spam", "INBOX.Spam", "INBOX/Spam"] {
            do {
                _ = try await command("CREATE \(Self.quote(candidate))")
                _ = try? await command("SUBSCRIBE \(Self.quote(candidate))")
                return JunkTarget(path: candidate, created: true)
            } catch {
                lastError = error
            }
        }
        throw MailError.invalidResponse("Spam-Ordner konnte nicht angelegt werden: \(lastError?.localizedDescription ?? "")")
    }
}

// MARK: - Store: Spam-Ordner, Sperrliste, Abmelden

extension MailStore {
    var blockedList: [String] {
        blocked.filter { !$0.value.deleted }.keys.sorted()
    }

    /// Absender, die der Spamfilter nie aussortiert: eigene Konten, Kontakte, vertrauenswürdige
    var spamSafeSenders: Set<String> {
        var known = Set(trustedSenders.map { Categorizer.normalized($0) })
        for a in accounts { known.insert(Categorizer.normalized(a.email)) }
        for card in addressBook where !card.deleted {
            for e in card.emails {
                let v = Categorizer.normalized(e)
                if !v.isEmpty { known.insert(v) }
            }
        }
        return known
    }

    func setSpamFilter(enabled: Bool, level: String) {
        spamFilterEnabled = enabled
        spamFilterLevel = SpamLevel(rawValue: level)?.rawValue ?? SpamLevel.medium.rawValue
        spamFilterUpdatedAt = nowMillis()
        scheduleSync()
    }

    /// Automatischer Spamfilter: erkannten Spam beim Abruf in den Spam-Ordner verschieben. Liefert die Anzahl.
    @discardableResult
    func moveSpam(_ s: AccountSession, _ list: inout [MailMessage], only: Set<UInt32>) async -> Int {
        guard spamFilterEnabled else { return 0 }
        let level = SpamLevel(rawValue: spamFilterLevel) ?? .medium
        let known = spamSafeSenders
        let spam = list.filter { only.contains($0.uid) && SpamFilter.isSpam($0, level: level, known: known) }.map(\.uid)
        guard !spam.isEmpty else { return 0 }
        do {
            let result = try await s.service.perform { (c: IMAPClient, _: SpecialFolders) async throws -> SpamMoveResult in
                let target = try await c.ensureJunkFolder()
                try await c.ensureSelected("INBOX")
                var done = Set<UInt32>()
                for u in spam {
                    try await c.move(uid: u, to: target.path)
                    done.insert(u)
                }
                return SpamMoveResult(moved: done, created: target.created)
            }
            list.removeAll { result.moved.contains($0.uid) }
            if result.created { await loadFolders() }
            return result.moved.count
        } catch {
            errorMessage = "Spamfilter: \(error.localizedDescription)"
            return 0
        }
    }

    func blockSender(_ key: String) {
        blocked[key.lowercased()] = TrustEntry(deleted: false, updatedAt: nowMillis())
    }

    func unblockSender(_ key: String) {
        blocked[key.lowercased()] = TrustEntry(deleted: true, updatedAt: nowMillis())
    }

    func isJunkFolder(_ m: MailMessage) -> Bool {
        folders[m.accountID]?.first { $0.path == m.folder }?.role == .junk
    }

    func junkPath(_ accountID: UUID) -> String? {
        rolePath(accountID, .junk)
    }

    /// Ordner einer Rolle (Spam, Gesendet, Papierkorb) eines Kontos – zuerst oberste Ebene
    func rolePath(_ accountID: UUID, _ role: FolderRole) -> String? {
        let list = folders[accountID] ?? []
        return list.first { $0.role == role && $0.selectable && $0.depth == 0 }?.path
            ?? list.first { $0.role == role && $0.selectable }?.path
    }

    func markSpam(_ m: MailMessage, block: String?) async {
        if let block { blockSender(block) }
        if folders[m.accountID] == nil { await loadFolders() }
        let knownJunk = junkPath(m.accountID)
        // weitere Mails desselben Absenders bzw. derselben Domain gleich mitnehmen
        var victims = [m]
        if let block {
            let extra = (inbox[m.accountID] ?? []).filter {
                $0.key != m.key && MailSecurity.isBlocked($0.fromAddress, [block.lowercased(): TrustEntry(deleted: false, updatedAt: 1)])
            }
            victims += extra
        }
        for v in victims { removeFromLists(v) }
        guard let s = sessions[m.accountID] else { return }
        let targets = victims.map(\.key)
        do {
            // fehlt der Spam-Ordner, wird „Spam“ angelegt
            let created = try await s.service.perform { (c: IMAPClient, _: SpecialFolders) async throws -> Bool in
                var junk = knownJunk ?? ""
                var made = false
                if junk.isEmpty {
                    let target = try await c.ensureJunkFolder()
                    junk = target.path
                    made = target.created
                }
                for v in targets {
                    try await c.ensureSelected(v.folder)
                    try await c.move(uid: v.uid, to: junk)
                }
                return made
            }
            if created { await loadFolders() }
        } catch {
            errorMessage = error.localizedDescription
            await refresh()
        }
    }

    func markNotSpam(_ m: MailMessage) async {
        let a = m.fromAddress.lowercased()
        for k in [a, "@" + MailSecurity.domain(of: a)] where blocked[k]?.deleted == false {
            unblockSender(k)
        }
        // Absender merken, damit der Spamfilter ihn künftig nicht mehr aussortiert
        if !a.isEmpty && trusted[a]?.deleted != false {
            trusted[a] = TrustEntry(deleted: false, updatedAt: nowMillis())
        }
        removeFromLists(m)
        guard let s = sessions[m.accountID] else { return }
        let key = m.key
        do {
            try await s.service.perform { (c: IMAPClient, _: SpecialFolders) async throws -> Void in
                try await c.ensureSelected(key.folder)
                try await c.move(uid: key.uid, to: "INBOX")
            }
            await refresh()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Entfernt eine Mail aus allen Listen (ohne Serveraktion)
    func removeFromLists(_ m: MailMessage) {
        let key = m.key
        if selectedID == key { selectedID = nil }
        inbox[key.account]?.removeAll { $0.key == key }
        folderMessages.removeAll { $0.key == key }
        searchResults?.removeAll { $0.key == key }
    }

    /// Gesperrte Absender beim Abruf in den Spam-Ordner verschieben
    func moveBlocked(_ s: AccountSession, _ list: inout [MailMessage], only: Set<UInt32>) async {
        guard blocked.contains(where: { !$0.value.deleted }), let junk = junkPath(s.account.id) else { return }
        let spam = list.filter { only.contains($0.uid) && MailSecurity.isBlocked($0.fromAddress, blocked) }.map(\.uid)
        guard !spam.isEmpty else { return }
        do {
            let moved = try await s.service.perform { (c: IMAPClient, _: SpecialFolders) async throws -> Set<UInt32> in
                try await c.ensureSelected("INBOX")
                var done = Set<UInt32>()
                for u in spam {
                    try await c.move(uid: u, to: junk)
                    done.insert(u)
                }
                return done
            }
            list.removeAll { moved.contains($0.uid) }
        } catch {
            errorMessage = "Sperrliste: \(error.localizedDescription)"
        }
    }

    /// Abmelden: One-Click (POST), sonst Abmelde-Mail, sonst Seite im Browser. Liefert eine Rückmeldung.
    func unsubscribe(_ m: MailMessage, _ info: UnsubscribeInfo) async throws -> String {
        if info.oneClick, let u = info.url, let url = URL(string: u), url.scheme == "https" {
            var req = URLRequest(url: url)
            req.httpMethod = "POST"
            req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
            req.httpBody = Data("List-Unsubscribe=One-Click".utf8)
            let (_, res) = try await URLSession.shared.data(for: req)
            if let http = res as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                throw MailError.invalidResponse("Abmelden fehlgeschlagen (HTTP \(http.statusCode)).")
            }
            return "Abmeldung gesendet."
        }
        if let mt = info.mailto, let comps = URLComponents(string: mt) {
            var d = Draft()
            d.accountID = m.accountID
            d.to = comps.path.removingPercentEncoding ?? comps.path
            d.subject = comps.queryItems?.first { $0.name.lowercased() == "subject" }?.value ?? "unsubscribe"
            d.body = comps.queryItems?.first { $0.name.lowercased() == "body" }?.value ?? "unsubscribe"
            try await send(d)
            return "Abmelde-Mail gesendet."
        }
        if let u = info.url, let url = URL(string: u), url.scheme == "https" {
            NSWorkspace.shared.open(url)
            return "Abmelde-Seite im Browser geöffnet."
        }
        throw MailError.invalidResponse("Kein gültiger Abmelde-Link vorhanden.")
    }
}

// MARK: - Ansichten

/// Menü „Spam“ (bzw. Knopf „Kein Spam“ im Spam-Ordner)
struct SpamMenu: View {
    @EnvironmentObject var store: MailStore
    let message: MailMessage

    var body: some View {
        if store.isJunkFolder(message) {
            Button {
                Task { await store.markNotSpam(message) }
            } label: {
                Label("Kein Spam", systemImage: "checkmark.shield")
            }
            .help("Zurück in den Posteingang und Sperre aufheben")
        } else {
            Menu {
                SpamMenuItems(message: message)
            } label: {
                Label("Spam", systemImage: "xmark.shield")
            }
            .help("Als Spam markieren")
        }
    }

}

/// Einträge des Spam-Menüs (auch im Kontextmenü der Liste)
struct SpamMenuItems: View {
    @EnvironmentObject var store: MailStore
    let message: MailMessage

    var body: some View {
        let a = message.fromAddress.lowercased()
        Button("Als Spam markieren") { Task { await store.markSpam(message, block: nil) } }
        Button("Spam + Absender sperren (\(a))") { Task { await store.markSpam(message, block: a) } }
        if !MailSecurity.isFreemail(a) {
            let d = "@" + MailSecurity.domain(of: a)
            Button("Spam + ganze Domain sperren (\(d))") { Task { await store.markSpam(message, block: d) } }
        }
    }
}

final class UnsubscribeModel: ObservableObject {
    @Published var status = ""
    @Published var busy = false
}

/// Phishing-Warnung und Newsletter-Abmeldung über dem Mailtext
struct SecurityBanners: View {
    @EnvironmentObject var store: MailStore
    @StateObject private var u = UnsubscribeModel()
    let message: MailMessage
    let body_: MessageBody

    var body: some View {
        VStack(spacing: 0) {
            if !body_.warnings.isEmpty {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.red)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Vorsicht – möglicher Betrugsversuch (Phishing)").fontWeight(.semibold)
                        ForEach(body_.warnings, id: \.self) { Text($0) }
                        Text("Keine Links anklicken, keine Daten eingeben. Im Zweifel den Absender auf bekanntem Weg kontaktieren.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .font(.callout)
                    .textSelection(.enabled)
                    Spacer(minLength: 0)
                    if !store.isJunkFolder(message) {
                        SpamMenu(message: message).fixedSize()
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(Color.red.opacity(0.12))
                .overlay(alignment: .leading) { Rectangle().fill(Color.red).frame(width: 4) }
            }
            if let info = body_.unsubscribe, !store.isJunkFolder(message) {
                HStack(spacing: 10) {
                    Image(systemName: "newspaper")
                    Text(u.status.isEmpty ? "Newsletter – du kannst dich mit einem Klick abmelden." : u.status)
                        .font(.callout)
                    Spacer()
                    Button("Abmelden") { confirm(info) }
                        .disabled(u.busy)
                }
                .controlSize(.small)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(Color.secondary.opacity(0.08))
            }
        }
    }

    private func confirm(_ info: UnsubscribeInfo) {
        let alert = NSAlert()
        alert.messageText = "Vom Newsletter abmelden?"
        alert.informativeText = "\(message.senderDisplay) <\(message.fromAddress)>\n\n" + (info.oneClick
            ? "Die Abmeldung wird direkt an den Absender geschickt."
            : info.mailto != nil ? "SimpleMail schickt dazu eine Abmelde-Mail an den Absender."
            : "Die Abmelde-Seite des Absenders öffnet sich im Browser.")
        alert.addButton(withTitle: "Abmelden")
        alert.addButton(withTitle: "Abbrechen")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        u.busy = true
        Task { @MainActor in
            do {
                u.status = try await store.unsubscribe(message, info)
            } catch {
                u.status = "Fehler: \(error.localizedDescription)"
            }
            u.busy = false
        }
    }
}

final class BlockAddModel: ObservableObject {
    @Published var entry = ""
}

/// Einstellungen: gesperrte Absender
struct BlockedSendersSection: View {
    @EnvironmentObject var store: MailStore
    @StateObject private var m = BlockAddModel()

    var body: some View {
        Section("Gesperrte Absender (landen automatisch im Spam)") {
            if store.blockedList.isEmpty {
                Text("Noch keine – in einer Mail „Spam“ → „Absender sperren“ wählen.")
                    .foregroundStyle(.secondary)
            }
            ForEach(store.blockedList, id: \.self) { entry in
                HStack {
                    Text(entry)
                    Spacer()
                    Button { store.unblockSender(entry) } label: { Image(systemName: "xmark.circle.fill") }
                        .buttonStyle(.plain)
                        .foregroundStyle(.secondary)
                        .help("Sperre aufheben")
                }
            }
            HStack {
                TextField("name@firma.de oder @firma.de", text: $m.entry)
                    .onSubmit(add)
                Button("Sperren", action: add)
            }
        }
    }

    private func add() {
        var v = m.entry.trimmingCharacters(in: .whitespaces).lowercased()
        guard v.range(of: #"^([^@\s]+@)?@?[a-z0-9.-]+\.[a-z]{2,}$"#, options: .regularExpression) != nil else { return }
        if !v.contains("@") { v = "@" + v }
        store.blockSender(v)
        m.entry = ""
    }
}
