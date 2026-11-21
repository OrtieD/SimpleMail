import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: - Adressbuch (gleiches Format wie die Windows-Version, wird per Sync übertragen)

struct AddressCard: Codable, Identifiable, Hashable {
    var id = UUID().uuidString.lowercased()
    var name = ""
    var company = ""
    var emails: [String] = []
    var phones: [String] = []
    var street = ""
    var zip = ""
    var city = ""
    var country = ""
    var notes = ""
    /// Schriftfarbe in der Mailliste ("#rrggbb", leer = keine)
    var color = ""
    var updatedAt: Double = 0
    var deleted = false

    var title: String {
        if !name.isEmpty { return name }
        if !company.isEmpty { return company }
        return emails.first ?? "(ohne Namen)"
    }

    func matches(_ q: String) -> Bool {
        guard !q.isEmpty else { return true }
        return ([name, company, city, notes] + emails + phones).contains { $0.lowercased().contains(q) }
    }

    var dictionary: [String: Any] {
        guard let data = try? JSONEncoder().encode(self),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return obj
    }

    static func from(_ value: Any) -> AddressCard? {
        guard JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value) else { return nil }
        return try? JSONDecoder().decode(AddressCard.self, from: data)
    }
}

extension AddressCard {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func s(_ k: CodingKeys) -> String { (try? c.decodeIfPresent(String.self, forKey: k)) ?? "" }
        id = (try? c.decodeIfPresent(String.self, forKey: .id)) ?? UUID().uuidString.lowercased()
        name = s(.name); company = s(.company); street = s(.street); zip = s(.zip)
        city = s(.city); country = s(.country); notes = s(.notes); color = s(.color)
        emails = (try? c.decodeIfPresent([String].self, forKey: .emails)) ?? []
        phones = (try? c.decodeIfPresent([String].self, forKey: .phones)) ?? []
        updatedAt = (try? c.decodeIfPresent(Double.self, forKey: .updatedAt)) ?? 1
        deleted = (try? c.decodeIfPresent(Bool.self, forKey: .deleted)) ?? false
    }
}

// MARK: - vCard

enum VCard {
    static func escape(_ v: String) -> String {
        v.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\n", with: "\\n")
            .replacingOccurrences(of: ",", with: "\\,").replacingOccurrences(of: ";", with: "\\;")
    }

    static func unescape(_ v: String) -> String {
        var out = ""
        var esc = false
        for ch in v {
            if esc { out.append(ch == "n" || ch == "N" ? "\n" : ch); esc = false } else if ch == "\\" { esc = true } else { out.append(ch) }
        }
        return out
    }

    /// Teilt an „;“, aber nicht an „\;“
    static func split(_ v: String) -> [String] {
        var parts: [String] = []
        var cur = ""
        var esc = false
        for ch in v {
            if esc { cur.append("\\"); cur.append(ch); esc = false } else if ch == "\\" { esc = true } else if ch == ";" { parts.append(unescape(cur)); cur = "" } else { cur.append(ch) }
        }
        parts.append(unescape(cur))
        return parts
    }

    static func decodeQP(_ v: String, charset: String?) -> String {
        var bytes: [UInt8] = []
        let chars = Array(v.utf8)
        var i = 0
        while i < chars.count {
            if chars[i] == UInt8(ascii: "="), i + 2 < chars.count,
               let b = UInt8(String(bytes: chars[(i + 1)...(i + 2)], encoding: .ascii) ?? "", radix: 16) {
                bytes.append(b)
                i += 3
            } else {
                bytes.append(chars[i])
                i += 1
            }
        }
        let enc: String.Encoding = (charset ?? "").lowercased().contains("8859") ? .isoLatin1 : .utf8
        return String(bytes: bytes, encoding: enc) ?? v
    }

    static func build(_ list: [AddressCard]) -> String {
        list.map { c -> String in
            var parts = c.name.split(separator: " ").map(String.init)
            let last = parts.count > 1 ? parts.removeLast() : (parts.first ?? "")
            let first = parts.count > 0 && !(parts.count == 1 && parts[0] == last) ? parts.joined(separator: " ") : ""
            var out = ["BEGIN:VCARD", "VERSION:3.0", "FN:\(escape(c.title))", "N:\(escape(last));\(escape(first));;;"]
            if !c.company.isEmpty { out.append("ORG:\(escape(c.company))") }
            out += c.emails.map { "EMAIL;TYPE=INTERNET:\($0)" }
            out += c.phones.map { "TEL:\(escape($0))" }
            if !(c.street + c.zip + c.city + c.country).isEmpty {
                out.append("ADR:;;\(escape(c.street));\(escape(c.city));;\(escape(c.zip));\(escape(c.country))")
            }
            if !c.notes.isEmpty { out.append("NOTE:\(escape(c.notes))") }
            out.append("END:VCARD")
            return out.joined(separator: "\r\n")
        }.joined(separator: "\r\n") + "\r\n"
    }

    static func parse(_ text: String) -> [AddressCard] {
        let unfolded = text.replacingOccurrences(of: "\r\n ", with: "").replacingOccurrences(of: "\r\n\t", with: "")
            .replacingOccurrences(of: "\n ", with: "").replacingOccurrences(of: "\n\t", with: "")
        var out: [AddressCard] = []
        var c: AddressCard?
        for rawLine in unfolded.components(separatedBy: "\n") {
            let line = rawLine.trimmingCharacters(in: CharacterSet(charactersIn: "\r"))
            guard let colon = line.firstIndex(of: ":") else { continue }
            let head = String(line[..<colon])
            var value = String(line[line.index(after: colon)...])
            let headParts = head.split(separator: ";").map(String.init)
            var name = (headParts.first ?? "").uppercased()
            if let dot = name.firstIndex(of: "."), name.hasPrefix("ITEM") { name = String(name[name.index(after: dot)...]) }
            let params = headParts.dropFirst().joined(separator: ";")
            if params.uppercased().contains("QUOTED-PRINTABLE") {
                let charset = params.range(of: #"(?i)CHARSET=([^;:]+)"#, options: .regularExpression)
                    .map { String(params[$0]).components(separatedBy: "=").last ?? "" }
                value = decodeQP(value, charset: charset)
            }
            if name == "BEGIN" && value.uppercased().contains("VCARD") { c = AddressCard(); continue }
            guard var card = c else { continue }
            switch name {
            case "END":
                if !card.name.isEmpty || !card.company.isEmpty || !card.emails.isEmpty { out.append(card) }
                c = nil
                continue
            case "FN":
                card.name = unescape(value).trimmingCharacters(in: .whitespaces)
            case "N" where card.name.isEmpty:
                let n = split(value) + Array(repeating: "", count: 5)
                card.name = [n[3], n[1], n[2], n[0], n[4]].filter { !$0.isEmpty }.joined(separator: " ")
            case "ORG":
                card.company = split(value).filter { !$0.isEmpty }.joined(separator: ", ")
            case "EMAIL":
                let e = value.trimmingCharacters(in: .whitespaces)
                if !e.isEmpty && !card.emails.contains(e) { card.emails.append(e) }
            case "TEL":
                var t = unescape(value).trimmingCharacters(in: .whitespaces)
                if t.lowercased().hasPrefix("tel:") { t = String(t.dropFirst(4)) }
                if !t.isEmpty { card.phones.append(t) }
            case "ADR" where card.street.isEmpty && card.city.isEmpty:
                let a = split(value) + Array(repeating: "", count: 7)
                card.street = a[2]; card.city = a[3]; card.zip = a[5]; card.country = a[6]
            case "NOTE":
                card.notes = unescape(value)
            default:
                break
            }
            c = card
        }
        return out
    }
}

// MARK: - Store

extension MailStore {
    var liveAddressBook: [AddressCard] {
        addressBook.filter { !$0.deleted }
            .sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
    }

    func card(_ id: String?) -> AddressCard? {
        guard let id else { return nil }
        return addressBook.first { $0.id == id && !$0.deleted }
    }

    func card(forEmail address: String) -> AddressCard? {
        let a = address.lowercased()
        return liveAddressBook.first { $0.emails.contains { $0.lowercased() == a } }
    }

    @discardableResult
    func addCard(_ c: AddressCard = AddressCard()) -> String {
        var c = c
        c.updatedAt = nowMillis()
        addressBook.append(c)
        return c.id
    }

    func updateCard(_ id: String, _ change: (inout AddressCard) -> Void) {
        guard let i = addressBook.firstIndex(where: { $0.id == id }) else { return }
        var c = addressBook[i]
        change(&c)
        c.updatedAt = nowMillis()
        addressBook[i] = c
    }

    func deleteCard(_ id: String) {
        updateCard(id) { $0.deleted = true }
        if selectedCard == id { selectedCard = nil }
    }

    /// Absender einer Mail übernehmen (oder vorhandenen Kontakt öffnen)
    /// Absender übernehmen – Telefon, Adresse, Firma und Webseite aus der Signatur der Mail; vorhandenen Kontakt ergänzen
    func addSenderToContacts(_ m: MailMessage) {
        Task { @MainActor in
            if bodies[m.key] == nil { await loadBody(for: m) }
            var text = ""
            if let b = bodies[m.key] {
                if let h = b.html, !h.isEmpty { text = ContactExtractor.htmlToLines(h) } else { text = b.text ?? "" }
            }
            let info = ContactExtractor.extract(text)
            var id = card(forEmail: m.fromAddress)?.id ?? ""
            let isNew = id.isEmpty
            if isNew {
                var c = AddressCard()
                c.name = m.fromName
                c.emails = [m.fromAddress]
                id = addCard(c)
            }
            var found: [String] = []
            updateCard(id) { c in
                if !info.company.isEmpty && c.company.isEmpty { c.company = info.company; found.append("Firma") }
                if !info.street.isEmpty && c.street.isEmpty { c.street = info.street; found.append("Straße") }
                if !info.zip.isEmpty && c.zip.isEmpty { c.zip = info.zip }
                if !info.city.isEmpty && c.city.isEmpty { c.city = info.city; found.append("Ort") }
                if !info.country.isEmpty && c.country.isEmpty { c.country = info.country; found.append("Land") }
                let known = Set(c.phones.map { ContactExtractor.digits($0) })
                let fresh = info.phones.filter { !known.contains(ContactExtractor.digits($0)) }
                if !fresh.isEmpty { c.phones.append(contentsOf: fresh); found.insert(fresh.count > 1 ? "Telefonnummern" : "Telefon", at: 0) }
                if !info.website.isEmpty && !c.notes.contains(info.website) {
                    c.notes = c.notes.isEmpty ? "Web: \(info.website)" : c.notes + "\nWeb: \(info.website)"
                    found.append("Webseite")
                }
            }
            if found.isEmpty {
                contactNotice = isNew ? "Zu Kontakten hinzugefügt." : "Keine neuen Angaben in dieser Mail gefunden."
            } else {
                contactNotice = (isNew ? "Kontakt angelegt" : "Kontakt ergänzt") + " – aus der Mail übernommen: " + found.joined(separator: ", ") + ". Bitte prüfen."
            }
            selectedCard = id
            sidebar = .contacts
        }
    }

    /// vCard-Import: neue Kontakte anlegen, vorhandene (gleiche E-Mail oder Name) ergänzen
    func importCards(_ cards: [AddressCard]) -> (added: Int, merged: Int) {
        var added = 0, merged = 0
        for card in cards {
            let existing = card.emails.lazy.compactMap { self.card(forEmail: $0) }.first
                ?? liveAddressBook.first { !$0.name.isEmpty && $0.name.lowercased() == card.name.lowercased() }
            if let ex = existing {
                updateCard(ex.id) { e in
                    if e.name.isEmpty { e.name = card.name }
                    if e.company.isEmpty { e.company = card.company }
                    if e.street.isEmpty { e.street = card.street }
                    if e.zip.isEmpty { e.zip = card.zip }
                    if e.city.isEmpty { e.city = card.city }
                    if e.country.isEmpty { e.country = card.country }
                    if e.notes.isEmpty { e.notes = card.notes }
                    for x in card.emails where !e.emails.contains(where: { $0.lowercased() == x.lowercased() }) { e.emails.append(x) }
                    for p in card.phones where !e.phones.contains(p) { e.phones.append(p) }
                }
                merged += 1
            } else {
                addCard(card)
                added += 1
            }
        }
        return (added, merged)
    }
}

// MARK: - Ansichten

final class ContactsListModel: ObservableObject {
    @Published var query = ""
    @Published var status = ""
}

struct ContactsListView: View {
    @EnvironmentObject var store: MailStore
    @StateObject private var m = ContactsListModel()

    var body: some View {
        let q = m.query.trimmingCharacters(in: .whitespaces).lowercased()
        let list = store.liveAddressBook.filter { $0.matches(q) }
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                Button { store.selectedCard = store.addCard() } label: { Label("Neuer Kontakt", systemImage: "person.badge.plus") }
                Button("Importieren …") { importVcf() }
                    .help("Kontakte aus einer vCard-Datei (.vcf) übernehmen – z. B. aus Apple Kontakte: alle markieren → Ablage → Exportieren → vCard")
                Button("Exportieren …") { exportVcf() }
                    .help("Alle Kontakte als vCard-Datei speichern")
                Spacer()
            }
            .controlSize(.small)
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            TextField("Kontakte durchsuchen", text: $m.query)
                .textFieldStyle(.roundedBorder)
                .padding(.horizontal, 10)
                .padding(.bottom, 6)
            if !m.status.isEmpty {
                Text(m.status).font(.caption).foregroundStyle(.secondary).padding(.bottom, 4)
            }
            Divider()
            if list.isEmpty {
                VStack(spacing: 6) {
                    Text(q.isEmpty ? "Noch keine Kontakte" : "Kein Kontakt gefunden").foregroundStyle(.secondary)
                    Text("Mit „Neuer Kontakt“ anlegen, per Rechtsklick auf eine Mail den Absender übernehmen oder eine vCard-Datei importieren.")
                        .font(.caption).foregroundStyle(.tertiary).multilineTextAlignment(.center)
                }
                .padding()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(selection: $store.selectedCard) {
                    ForEach(list) { c in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(c.title).fontWeight(.medium)
                                .foregroundStyle(ColorChoices.valid(c.color).map { ColorChoices.color(hex: $0) } ?? Color.primary)
                            let sub = [c.name.isEmpty ? "" : c.company, c.emails.first ?? c.phones.first ?? ""]
                                .filter { !$0.isEmpty }.joined(separator: " · ")
                            if !sub.isEmpty { Text(sub).font(.callout).foregroundStyle(.secondary).lineLimit(1) }
                        }
                        .padding(.vertical, 2)
                        .tag(Optional(c.id))
                    }
                }
                .listStyle(.inset)
            }
        }
    }

    private func importVcf() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.vCard]
        panel.allowsMultipleSelection = true
        guard panel.runModal() == .OK else { return }
        var cards: [AddressCard] = []
        for url in panel.urls {
            if let data = try? Data(contentsOf: url) {
                let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) ?? ""
                cards += VCard.parse(text)
            }
        }
        let r = store.importCards(cards)
        m.status = cards.isEmpty ? "Keine Kontakte in der Datei gefunden." : "\(r.added) Kontakt(e) neu, \(r.merged) ergänzt."
    }

    private func exportVcf() {
        let list = store.liveAddressBook
        guard !list.isEmpty else { m.status = "Keine Kontakte vorhanden."; return }
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.vCard]
        panel.nameFieldStringValue = "SimpleMail-Kontakte.vcf"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            try VCard.build(list).write(to: url, atomically: true, encoding: .utf8)
            m.status = "\(list.count) Kontakt(e) exportiert."
        } catch {
            m.status = error.localizedDescription
        }
    }
}

/// Eingaben im Kontaktformular: Text bleibt beim Tippen unverändert (Leerzeichen, neue Zeilen)
/// und wird erst nach einer kurzen Pause gespeichert. Änderungen von außen (Sync, Übernahme aus einer Mail)
/// werden nur übernommen, solange keine eigene Eingabe offen ist – so geht beim Bearbeiten nichts verloren.
@MainActor
final class ContactEditModel: ObservableObject {
    @Published var name = "" { didSet { changed() } }
    @Published var company = "" { didSet { changed() } }
    @Published var emailsText = "" { didSet { changed() } }
    @Published var phonesText = "" { didSet { changed() } }
    @Published var street = "" { didSet { changed() } }
    @Published var zip = "" { didSet { changed() } }
    @Published var city = "" { didSet { changed() } }
    @Published var country = "" { didSet { changed() } }
    @Published var notes = "" { didSet { changed() } }

    private weak var store: MailStore?
    private var cardID = ""
    private var loadedAt: Double = -1
    private var loading = false
    private var committing = false
    private var dirty = false
    private var saveTask: Task<Void, Never>?

    func attach(_ store: MailStore, id: String) {
        self.store = store
        cardID = id
        if let c = store.card(id) { load(c) }
    }

    private func load(_ c: AddressCard) {
        loading = true
        if name != c.name { name = c.name }
        if company != c.company { company = c.company }
        let e = c.emails.joined(separator: "\n")
        if ContactEditModel.split(emailsText) != c.emails { emailsText = e }
        let p = c.phones.joined(separator: "\n")
        if ContactEditModel.split(phonesText) != c.phones { phonesText = p }
        if street != c.street { street = c.street }
        if zip != c.zip { zip = c.zip }
        if city != c.city { city = c.city }
        if country != c.country { country = c.country }
        if notes != c.notes { notes = c.notes }
        loadedAt = c.updatedAt
        loading = false
        dirty = false
    }

    private func changed() {
        guard !loading else { return }
        dirty = true
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 500_000_000)
            guard !Task.isCancelled else { return }
            self?.commit()
        }
    }

    /// Offene Eingaben jetzt speichern
    func commit() {
        saveTask?.cancel()
        saveTask = nil
        guard dirty, let store, !cardID.isEmpty, store.card(cardID) != nil else { return }
        dirty = false
        let n = name, co = company, st = street, z = zip, ci = city, cn = country, no = notes
        let em = ContactEditModel.split(emailsText)
        let ph = ContactEditModel.split(phonesText)
        committing = true
        store.updateCard(cardID) { c in
            c.name = n; c.company = co; c.emails = em; c.phones = ph
            c.street = st; c.zip = z; c.city = ci; c.country = cn; c.notes = no
        }
        committing = false
        loadedAt = store.card(cardID)?.updatedAt ?? loadedAt
    }

    /// Adressbuch wurde geändert (Sync, Übernahme aus Mail, Farbe …)
    func external(_ book: [AddressCard]) {
        guard !committing, !dirty else { return }
        guard let c = book.first(where: { $0.id == cardID && !$0.deleted }) else { return }
        if c.updatedAt != loadedAt { load(c) }
    }

    static func split(_ text: String) -> [String] {
        text.components(separatedBy: CharacterSet(charactersIn: "\n,;"))
            .map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }
}

struct ContactDetailView: View {
    @EnvironmentObject var store: MailStore
    @StateObject private var edit = ContactEditModel()
    let id: String

    var body: some View {
        if let c = store.card(id) {
            contactForm(c)
                .onAppear { edit.attach(store, id: id) }
                .onDisappear { edit.commit() }
                .onReceive(store.$addressBook) { book in edit.external(book) }
        } else {
            Text("Kein Kontakt ausgewählt").foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func label(_ t: String) -> some View {
        Text(t).foregroundStyle(.secondary).frame(width: 90, alignment: .leading)
    }

    /// Mehrzeiliges Feld im gleichen Rahmen wie die einzeiligen Felder
    private func box(_ text: Binding<String>, _ height: CGFloat) -> some View {
        TextEditor(text: text)
            .font(.body)
            .scrollContentBackground(.hidden)
            .padding(.horizontal, 3).padding(.vertical, 4)
            .frame(maxWidth: .infinity, minHeight: height, alignment: .leading)
            .background(Color(nsColor: .textBackgroundColor))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.secondary.opacity(0.35)))
            .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    // Aufbau wie in der Windows-Version: Bezeichnung links, Eingabe linksbündig daneben
    @ViewBuilder
    private func contactForm(_ c: AddressCard) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if let n = store.contactNotice {
                    HStack(alignment: .top) {
                        Image(systemName: "text.badge.checkmark").foregroundStyle(.tint)
                        Text(n).font(.callout).frame(maxWidth: .infinity, alignment: .leading)
                        Button { store.contactNotice = nil } label: { Image(systemName: "xmark") }.buttonStyle(.borderless)
                    }
                    .padding(10)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color.accentColor.opacity(0.1)))
                }
                Text(c.title).font(.title2).fontWeight(.semibold)
                    .foregroundStyle(ColorChoices.valid(c.color).map { ColorChoices.color(hex: $0) } ?? Color.primary)
                Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 10) {
                    GridRow {
                        label("Name")
                        TextField("Vorname Nachname", text: $edit.name).textFieldStyle(.roundedBorder)
                    }
                    GridRow {
                        label("Firma")
                        TextField("", text: $edit.company).textFieldStyle(.roundedBorder)
                    }
                    GridRow(alignment: .top) {
                        label("E-Mail").padding(.top, 4)
                        box($edit.emailsText, 44)
                    }
                    GridRow(alignment: .top) {
                        label("Telefon").padding(.top, 4)
                        box($edit.phonesText, 44)
                    }
                    GridRow {
                        label("Straße")
                        TextField("", text: $edit.street).textFieldStyle(.roundedBorder)
                    }
                    GridRow {
                        label("PLZ / Ort")
                        HStack(spacing: 6) {
                            TextField("", text: $edit.zip).textFieldStyle(.roundedBorder).frame(width: 90)
                            TextField("", text: $edit.city).textFieldStyle(.roundedBorder)
                        }
                    }
                    GridRow {
                        label("Land")
                        TextField("", text: $edit.country).textFieldStyle(.roundedBorder)
                    }
                    GridRow(alignment: .top) {
                        label("Notiz").padding(.top, 4)
                        box($edit.notes, 90)
                    }
                    GridRow(alignment: .top) {
                        label("Schriftfarbe").padding(.top, 2)
                        VStack(alignment: .leading, spacing: 4) {
                            ColorSwatches(selected: c.color, emptyLabel: "Keine") { hex in
                                store.updateCard(id) { $0.color = hex }
                            }
                            Text("Name dieses Kontakts in der Mailliste farbig anzeigen.")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                Text("Änderungen werden automatisch gespeichert und mit deinen anderen Geräten synchronisiert.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 22).padding(.vertical, 18)
            .frame(maxWidth: 640, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
            .toolbar {
                ToolbarItemGroup {
                    if let mail = c.emails.first {
                        Button {
                            edit.commit()
                            var d = store.newDraft()
                            d.to = Contact(name: c.name, email: mail).display
                            store.composeDraft = d
                        } label: { Label("E-Mail schreiben", systemImage: "square.and.pencil") }
                    }
                    Button(role: .destructive) {
                        let alert = NSAlert()
                        alert.messageText = "Kontakt löschen?"
                        alert.informativeText = c.title
                        alert.addButton(withTitle: "Löschen")
                        alert.addButton(withTitle: "Abbrechen")
                        if alert.runModal() == .alertFirstButtonReturn { store.deleteCard(id) }
                    } label: { Label("Löschen", systemImage: "trash") }
                }
            }
    }
}


// MARK: - Kontaktdaten aus einer E-Mail-Signatur herauslesen

struct ExtractedContact {
    var phones: [String] = []
    var street = ""
    var zip = ""
    var city = ""
    var country = ""
    var company = ""
    var website = ""
}

enum ContactExtractor {
    static func digits(_ s: String) -> String { s.filter { $0.isNumber } }

    /// erste Fundstelle eines Musters: Gruppen als Strings ("" wenn leer) und Beginn der Fundstelle
    static func firstMatch(_ pattern: String, _ text: String, _ options: NSRegularExpression.Options = []) -> (groups: [String], start: Int)? {
        guard let re = try? NSRegularExpression(pattern: pattern, options: options) else { return nil }
        let ns = text as NSString
        guard let m = re.firstMatch(in: text, range: NSRange(location: 0, length: ns.length)) else { return nil }
        var g: [String] = []
        for i in 0..<m.numberOfRanges {
            let r = m.range(at: i)
            g.append(r.location == NSNotFound ? "" : ns.substring(with: r))
        }
        return (g, m.range.location)
    }

    static func test(_ pattern: String, _ text: String, caseless: Bool = false) -> Bool {
        firstMatch(pattern, text, caseless ? [.caseInsensitive] : []) != nil
    }

    /// HTML → Text mit Zeilenumbrüchen; Tabellenzellen werden mit „ • “ getrennt
    static func htmlToLines(_ html: String) -> String {
        var h = html.replacingOccurrences(of: #"(?is)<(style|script|head)[^>]*>.*?</\1>"#, with: " ", options: .regularExpression)
        h = h.replacingOccurrences(of: #"(?i)<(br|/p|/div|/tr|/li|/h\d|/table)\b[^>]*>"#, with: "\n", options: .regularExpression)
        h = h.replacingOccurrences(of: #"(?i)</td>"#, with: " • ", options: .regularExpression)
        h = h.replacingOccurrences(of: #"<[^>]+>"#, with: "", options: .regularExpression)
        let entities = ["&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'",
                        "&auml;": "ä", "&ouml;": "ö", "&uuml;": "ü", "&Auml;": "Ä", "&Ouml;": "Ö", "&Uuml;": "Ü", "&szlig;": "ß"]
        for (k, v) in entities { h = h.replacingOccurrences(of: k, with: v) }
        return h
    }

    /// Signaturbereich: nach „-- “, sonst die letzten Zeilen vor einem Zitat
    static func signatureLines(_ text: String) -> [String] {
        var lines = text.replacingOccurrences(of: "\r", with: "").replacingOccurrences(of: "\u{00A0}", with: " ")
            .components(separatedBy: "\n")
        if let cut = lines.firstIndex(where: { l in
            test(#"^\s*>"#, l) || test(#"^\s*(Am .{3,80} schrieb|On .{3,80} wrote|-{2,}\s*(Original|Ursprüngliche)|Von:\s|From:\s)"#, l, caseless: true)
        }), cut > 0 {
            lines = Array(lines[0..<cut])
        }
        let sep = lines.lastIndex { $0.trimmingCharacters(in: .whitespaces) == "--" }
        var sig: [String] = []
        if let sep = sep { sig = Array(lines[(sep + 1)...]) } else { sig = Array(lines.suffix(25)) }
        var parts: [String] = []
        for l in sig {
            let split = l.replacingOccurrences(of: #"\s+[•|·]\s+|\s{3,}|\t"#, with: "\u{1F}", options: .regularExpression)
            for p in split.components(separatedBy: "\u{1F}") {
                let t = p.trimmingCharacters(in: .whitespaces)
                if !t.isEmpty { parts.append(t) }
            }
        }
        return Array(parts.prefix(40))
    }

    static let companyPattern = #"(^|\s)(GmbH|AG|KG|OHG|UG|e\.\s?K\.|e\.\s?V\.|mbH|GbR|Inc\.?|Ltd\.?|LLC|S\.A\.|B\.V\.|SE)(?=[\s,;&)]|$)"#

    static func extract(_ text: String) -> ExtractedContact {
        var out = ExtractedContact()
        let lines = signatureLines(text)
        let phonePattern = #"(?:^|[^\d])(\+?\(?\d[\d\s/().–-]{5,}\d)(?!\d)"#
        let labelPattern = #"^(?:(tel(?:efon)?|fon|phone|mobil(?:e|funk)?|handy|cell|fax|telefax|privat|büro|office|zentrale|direkt(?:wahl)?)\.?\s*[:.]?\s*)"#
        for raw in lines {
            let line = raw.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            // Telefon / Fax
            let lab = firstMatch(labelPattern, line, [.caseInsensitive])
            if let pm = firstMatch(phonePattern, line) {
                let num = pm.groups[1].trimmingCharacters(in: .whitespaces)
                    .replacingOccurrences(of: #"\s{2,}"#, with: " ", options: .regularExpression)
                let d = digits(num)
                let looksDate = test(#"^\d{1,2}[./]\d{1,2}[./]\d{2,4}$"#, num)
                let looksZip = d.count == 5 || d.count == 4
                if d.count >= 6 && d.count <= 16 && !looksDate && !looksZip
                    && !test("iban|bic|ust|steuer|hrb|hra|amtsgericht|konto|blz", line, caseless: true) {
                    var entry = num
                    if let lab = lab, !lab.groups[1].isEmpty {
                        let l = lab.groups[1].lowercased()
                        var label = l.prefix(1).uppercased() + l.dropFirst()
                        if ["tel", "telefon", "fon", "phone"].contains(l) { label = "Telefon" }
                        if ["handy", "cell", "mobile", "mobilfunk"].contains(l) { label = "Mobil" }
                        if l == "telefax" { label = "Fax" }
                        entry = "\(label): \(num)"
                    }
                    if !out.phones.contains(where: { digits($0) == d }) { out.phones.append(entry) }
                    if lab != nil || test(#"^[+\d(]"#, line) { continue }
                }
            }
            // PLZ + Ort
            if out.zip.isEmpty,
               let zm = firstMatch(#"(?:^|[\s,])((?:D-|DE-)?\d{5}|(?:A|AT|CH)-\d{4})\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß.\- ]{1,40}?)(?:\s*[,(]|$)"#, line) {
                let code = zm.groups[1]
                out.zip = code.replacingOccurrences(of: #"^(D|DE|A|AT|CH)-"#, with: "", options: .regularExpression)
                out.city = zm.groups[2].trimmingCharacters(in: .whitespaces)
                if test(#"^(A|AT)-"#, code) { out.country = "Österreich" }
                if code.hasPrefix("CH-") { out.country = "Schweiz" }
                let before = ((line as NSString).substring(to: zm.start) as String)
                    .replacingOccurrences(of: #"[,•|·\s]+$"#, with: "", options: .regularExpression)
                var segs = before.components(separatedBy: CharacterSet(charactersIn: ",•|"))
                    .map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
                if let last = segs.last, test(#"\d+\s*[a-z]?$"#, last, caseless: true), test("[A-Za-zÄÖÜäöüß]{3}", last) {
                    out.street = last
                    segs.removeLast()
                }
                if out.company.isEmpty, let first = segs.first, test(companyPattern, first) { out.company = first }
                continue
            }
            if out.street.isEmpty,
               test(#"^[A-ZÄÖÜ][A-Za-zÄÖÜäöüß.\- ]{2,40}\s\d{1,4}\s*[a-zA-Z]?(?:\s*[-/]\s*\d{1,4}[a-z]?)?$"#, line),
               !test("tel|fax|mobil|handy", line, caseless: true) {
                out.street = line
                continue
            }
            if out.country.isEmpty,
               test("^(Deutschland|Germany|Österreich|Austria|Schweiz|Switzerland|Niederlande|Netherlands|Belgien|Belgium|Frankreich|France|Luxemburg)$", line, caseless: true) {
                out.country = line
                continue
            }
            if out.company.isEmpty, test(companyPattern, line), line.count < 80,
               !test("amtsgericht|registergericht|sitz der", line, caseless: true) {
                out.company = line.replacingOccurrences(of: #"(?i)^(firma|company)\s*:\s*"#, with: "", options: .regularExpression)
                continue
            }
            if out.website.isEmpty,
               let wm = firstMatch(#"\b((?:https?://)?www\.[a-z0-9.-]+\.[a-z]{2,}(?:/\S*)?)"#, line, [.caseInsensitive]) {
                out.website = wm.groups[1]
            }
        }
        // Straße in der Zeile vor der PLZ
        if !out.zip.isEmpty && out.street.isEmpty, let i = lines.firstIndex(where: { $0.contains(out.zip) }), i > 0 {
            let prev = lines[i - 1].trimmingCharacters(in: .whitespaces)
            if test(#"\d+\s*[a-z]?$"#, prev, caseless: true) && test("[A-Za-zÄÖÜäöüß]{3}", prev)
                && !test("tel|fax|mobil", prev, caseless: true) {
                out.street = prev
            }
        }
        return out
    }
}
