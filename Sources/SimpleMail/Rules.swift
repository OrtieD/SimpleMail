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
    func applyRules(_ s: AccountSession, to list: inout [MailMessage], only: Set<UInt32>?) async -> Int {
        let acc = s.account
        let active = liveRules.filter { $0.enabled && $0.accountEmail.lowercased() == acc.email.lowercased() }
        guard !active.isEmpty, !list.isEmpty else { return 0 }
        if only?.isEmpty == true { return 0 }
        if folders[acc.id] == nil, active.contains(where: { !$0.actions.moveTo.isEmpty }) {
            await loadFolders()
        }
        let folderList = folders[acc.id] ?? []
        var seen: [UInt32] = []
        var flag: [UInt32] = []
        var moves: [String: [UInt32]] = [:]
        var hits = 0
        for i in list.indices {
            let m = list[i]
            if let only, !only.contains(m.uid) { continue }
            guard let r = active.first(where: { $0.matches(m) }) else { continue }
            hits += 1
            if r.actions.markRead && !m.isRead { seen.append(m.uid); list[i].isRead = true }
            if r.actions.flag && !m.isFlagged { flag.append(m.uid); list[i].isFlagged = true }
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
        do {
            let moved = try await s.service.perform {
                (c: IMAPClient, _: SpecialFolders) async throws -> (Set<UInt32>, [String]) in
                try await c.ensureSelected("INBOX")
                for u in seenUIDs { try await c.setFlag("\\Seen", true, uid: u) }
                for u in flagUIDs { try await c.setFlag("\\Flagged", true, uid: u) }
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
                return (done, failed)
            }
            list.removeAll { moved.0.contains($0.uid) }
            if let first = moved.1.first {
                errorMessage = "Regel: Verschieben nach \(first) fehlgeschlagen."
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
                hits += await applyRules(s, to: &msgs, only: nil)
                total += hits
                report.append("\(acc.email): \(scanned) Mails im Posteingang geprüft, \(hits) passend"
                              + (spamCount > 0 ? ", davon \(spamCount) als Spam aussortiert" : ""))
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
                    Toggle("Als gelesen markieren", isOn: binding(id, \.actions.markRead, false))
                    Toggle("Markieren (Stern)", isOn: binding(id, \.actions.flag, false))
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
