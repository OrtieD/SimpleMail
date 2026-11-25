import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: - Einstellungsfenster

struct SettingsView: View {
    var body: some View {
        TabView {
            AccountsSettingsView()
                .tabItem { Label("Konten", systemImage: "person.2") }
            SnippetsSettingsView()
                .tabItem { Label("Textbausteine", systemImage: "text.badge.plus") }
            RulesSettingsView()
                .tabItem { Label("Regeln", systemImage: "line.3.horizontal.decrease.circle") }
            PrivacySettingsView()
                .tabItem { Label("Darstellung & Datenschutz", systemImage: "hand.raised") }
            MeetingSettingsView()
                .tabItem { Label("Online-Meetings", systemImage: "video") }
            OfflineSyncSettingsView()
                .tabItem { Label("Offline & Sync", systemImage: "arrow.triangle.2.circlepath") }
        }
        .frame(width: 820, height: 640)
    }
}

// MARK: - Willkommen (noch kein Konto)

struct OnboardingView: View {
    var body: some View {
        ZStack {
            Rectangle().fill(.background)
            ScrollView {
                VStack(spacing: 14) {
                    Image(systemName: "envelope.open.fill")
                        .font(.system(size: 44))
                        .foregroundStyle(Color.accentColor)
                    Text("Willkommen bei SimpleMail").font(.title.weight(.semibold))
                    Text("Richte dein erstes IMAP/SMTP-Konto ein. Weitere Konten folgen in den Einstellungen (⌘,).")
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                    AccountEditorView(account: nil, onSaved: { _ in })
                        .frame(width: 520)
                }
                .padding(30)
                .frame(maxWidth: .infinity)
            }
        }
    }
}

// MARK: - Konten

final class AccountsSettingsModel: ObservableObject {
    @Published var selection: UUID?
    @Published var editingNew = false
    @Published var confirmDelete = false
}

struct AccountsSettingsView: View {
    @EnvironmentObject var store: MailStore
    @StateObject private var m = AccountsSettingsModel()

    var body: some View {
        HStack(spacing: 0) {
            VStack(spacing: 0) {
                List(selection: $m.selection) {
                    ForEach(store.accounts) { acc in
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 5) {
                                Circle().fill(acc.displayColor).frame(width: 9, height: 9)
                                Text(acc.email).lineLimit(1)
                            }
                            if !store.hasPassword(acc.id) {
                                Text("Passwort fehlt").font(.caption).foregroundStyle(.red)
                            } else {
                                Text(acc.imapHost).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            }
                        }
                        .tag(Optional(acc.id))
                    }
                }
                Divider()
                HStack(spacing: 4) {
                    Button {
                        m.selection = nil
                        m.editingNew = true
                    } label: { Image(systemName: "plus") }
                    .help("Konto hinzufügen")
                    Button {
                        m.confirmDelete = true
                    } label: { Image(systemName: "minus") }
                    .disabled(m.selection == nil)
                    .help("Konto entfernen")
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
            if m.selection == nil, !m.editingNew { m.selection = store.accounts.first?.id }
        }
        .onChange(of: m.selection) { newValue in
            if newValue != nil { m.editingNew = false }
        }
        .confirmationDialog("Konto entfernen?", isPresented: $m.confirmDelete) {
            Button("Entfernen", role: .destructive) {
                if let id = m.selection {
                    store.removeAccount(id)
                    m.selection = store.accounts.first?.id
                }
            }
        } message: {
            Text("Die E-Mails bleiben auf dem Server erhalten. Nur SimpleMail vergisst das Konto.")
        }
    }

    @ViewBuilder
    private var editor: some View {
        if m.editingNew || store.accounts.isEmpty {
            AccountEditorView(account: nil) { id in
                m.selection = id
                m.editingNew = false
            }
            .id("new")
        } else if let id = m.selection, let acc = store.account(id) {
            AccountEditorView(account: acc) { _ in }
                .id(acc.id)
        } else {
            Text("Konto auswählen oder mit + hinzufügen")
                .foregroundStyle(.secondary)
        }
    }
}

final class AccountFormModel: ObservableObject {
    @Published var acc: Account
    @Published var password = ""
    @Published var status: String? = nil
    @Published var testing = false
    let isNew: Bool

    init(account: Account?) {
        acc = account ?? Account()
        isNew = account == nil
    }
}

struct AccountEditorView: View {
    @EnvironmentObject var store: MailStore
    @StateObject private var m: AccountFormModel
    let onSaved: (UUID) -> Void

    init(account: Account?, onSaved: @escaping (UUID) -> Void) {
        _m = StateObject(wrappedValue: AccountFormModel(account: account))
        self.onSaved = onSaved
    }

    var body: some View {
        Form {
            Section("Absender") {
                TextField("Name", text: $m.acc.displayName)
                TextField("E-Mail", text: $m.acc.email)
                HStack(alignment: .center) {
                    Text("Farbe")
                    Spacer()
                    ColorSwatches(selected: m.acc.color, emptyLabel: "Automatisch") { hex in
                        m.acc.color = hex
                        // bestehendes Konto: sofort übernehmen, ohne Neuverbindung
                        if !m.isNew { store.setAccountColor(m.acc.id, hex) }
                    }
                }
                .help("Kennzeichnet Mails dieses Kontos in Liste und Seitenleiste")
            }
            if !m.isNew && Keychain.get(m.acc.keychainKey) == nil {
                Text("⚠ Dieses Konto kam per Synchronisation von einem anderen Gerät. Prüfe IMAP- und SMTP-Server unten, bevor du das Passwort eingibst.")
                    .font(.caption)
                    .foregroundStyle(.red)
            }
            Section("Anmeldung") {
                TextField("Benutzername", text: $m.acc.username)
                SecureField(m.isNew ? "Passwort / App-Passwort" : "Passwort (leer = unverändert)",
                            text: $m.password)
            }
            Section("Server") {
                TextField("IMAP-Server", text: $m.acc.imapHost)
                TextField("IMAP-Port (SSL)", value: $m.acc.imapPort, format: .number.grouping(.never))
                TextField("SMTP-Server", text: $m.acc.smtpHost)
                TextField("SMTP-Port (465 SSL / 587 STARTTLS)", value: $m.acc.smtpPort, format: .number.grouping(.never))
            }
            Section("Signatur") {
                if m.acc.signatureHtml.isEmpty {
                    TextEditor(text: $m.acc.signature)
                        .font(.body)
                        .frame(minHeight: 70)
                    HStack {
                        Button("Formatierte Signatur (HTML) …") {
                            m.acc.signatureHtml = HTMLTools.textToHtml(m.acc.signature)
                        }
                        Button("Aus Zwischenablage einfügen") { pasteSignature() }
                            .help("Eine fertige Signatur aus Outlook, Word, Pages oder einer Webseite kopieren und hier einfügen")
                        Button("HTML-Datei laden …") { loadSignatureFile() }
                    }
                } else {
                    HTMLView(html: HTMLTools.prepare(m.acc.signatureHtml, attachments: [], allowRemote: true))
                        .frame(height: 130)
                    TextEditor(text: $m.acc.signatureHtml)
                        .font(.system(.caption, design: .monospaced))
                        .frame(minHeight: 90)
                    HStack {
                        Button("Aus Zwischenablage einfügen") { pasteSignature() }
                        Button("HTML-Datei laden …") { loadSignatureFile() }
                        Button("Bild/Logo einfügen …") { insertImage() }
                        Spacer()
                        Button("Nur Text verwenden") {
                            m.acc.signature = HTMLTools.htmlToText(m.acc.signatureHtml)
                            m.acc.signatureHtml = ""
                        }
                    }
                }
                Text(m.acc.signatureHtml.isEmpty
                     ? "Wird automatisch in neue Mails, Antworten und Weiterleitungen dieses Kontos eingefügt."
                     : "Oben die Vorschau, darunter der HTML-Code. Beim Senden wird die formatierte Signatur eingesetzt; im Verfassen-Fenster steht ihre Text-Fassung.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Section {
                HStack {
                    Menu("Vorlage") {
                        Button("Gmail / Googlemail") { preset("imap.gmail.com", "smtp.gmail.com", 465) }
                        Button("WEB.DE") { preset("imap.web.de", "smtp.web.de", 587) }
                        Button("GMX") { preset("imap.gmx.net", "mail.gmx.net", 465) }
                        Button("iCloud") { preset("imap.mail.me.com", "smtp.mail.me.com", 587) }
                        Button("IONOS") { preset("imap.ionos.de", "smtp.ionos.de", 465) }
                        Button("T-Online") { preset("secureimap.t-online.de", "securesmtp.t-online.de", 465) }
                        Button("Strato") { preset("imap.strato.de", "smtp.strato.de", 465) }
                    }
                    .fixedSize()
                    Spacer()
                    if m.testing { ProgressView().controlSize(.small) }
                    Button("Verbindung testen") { test() }
                        .disabled(!m.acc.isComplete || m.testing)
                    Button(m.isNew ? "Konto hinzufügen" : "Speichern") { save() }
                        .buttonStyle(.borderedProminent)
                        .disabled(!m.acc.isComplete || (m.isNew && m.password.isEmpty))
                }
                if let status = m.status {
                    Text(status).font(.caption).foregroundStyle(.secondary)
                }
                Text("Gmail und iCloud: 2-Faktor aktivieren und ein App-Passwort verwenden. WEB.DE/GMX: IMAP im Webmailer unter Einstellungen → POP3/IMAP freischalten.")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
        .formStyle(.grouped)
    }

    func preset(_ imap: String, _ smtp: String, _ smtpPort: Int) {
        m.acc.imapHost = imap
        m.acc.imapPort = 993
        m.acc.smtpHost = smtp
        m.acc.smtpPort = smtpPort
        if m.acc.username.isEmpty { m.acc.username = m.acc.email }
    }

    /// Signatur aus der Zwischenablage (HTML bevorzugt, sonst RTF oder Text)
    func pasteSignature() {
        let pb = NSPasteboard.general
        if let html = pb.string(forType: .html), !html.isEmpty {
            m.acc.signatureHtml = HTMLTools.clean(html)
        } else if let rtf = pb.data(forType: .rtf),
                  let attr = NSAttributedString(rtf: rtf, documentAttributes: nil),
                  let data = try? attr.data(from: NSRange(location: 0, length: attr.length),
                                            documentAttributes: [.documentType: NSAttributedString.DocumentType.html]),
                  let html = String(data: data, encoding: .utf8) {
            m.acc.signatureHtml = HTMLTools.clean(html, keepStyleBlocks: true)
        } else if let text = pb.string(forType: .string), !text.isEmpty {
            m.acc.signatureHtml = HTMLTools.textToHtml(text)
        } else {
            m.status = "Die Zwischenablage enthält keinen Text."
        }
    }

    /// Signatur aus einer HTML-Datei (z. B. von einem Signatur-Generator)
    func loadSignatureFile() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.html]
        panel.prompt = "Laden"
        guard panel.runModal() == .OK, let url = panel.url, let data = try? Data(contentsOf: url) else { return }
        guard let html = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) else { return }
        let cleaned = HTMLTools.clean(html)
        guard !cleaned.isEmpty else {
            m.status = "In der Datei wurde keine Signatur gefunden."
            return
        }
        m.acc.signatureHtml = cleaned
        m.status = "Signatur geladen – bitte „Speichern“ klicken."
    }

    func insertImage() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.image]
        panel.prompt = "Einfügen"
        guard panel.runModal() == .OK, let url = panel.url, let data = try? Data(contentsOf: url) else { return }
        guard data.count <= 400 * 1024 else {
            m.status = "Bild zu groß (max. 400 KB) – bitte vorher verkleinern."
            return
        }
        let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "image/png"
        m.acc.signatureHtml += "<br><img src=\"data:\(mime);base64,\(data.base64EncodedString())\" alt=\"Logo\" style=\"max-width:240px;height:auto\">"
    }

    func save() {
        if !m.acc.signatureHtml.isEmpty {
            m.acc.signatureHtml = HTMLTools.clean(m.acc.signatureHtml)
            m.acc.signature = HTMLTools.htmlToText(m.acc.signatureHtml)
        }
        let acc = m.acc
        store.saveAccount(acc, password: m.password)
        m.password = ""
        m.status = "Gespeichert ✓"
        onSaved(acc.id)
    }

    func test() {
        let model = m
        let acc = model.acc
        let pw = model.password.isEmpty ? (Keychain.get(acc.keychainKey) ?? "") : model.password
        model.testing = true
        model.status = nil
        Task { @MainActor in
            do {
                try await store.testConnection(acc, password: pw)
                model.status = "IMAP-Verbindung erfolgreich ✓"
            } catch {
                model.status = "Fehler: \(error.localizedDescription)"
            }
            model.testing = false
        }
    }
}

// MARK: - Textbausteine

final class SnippetsSettingsModel: ObservableObject {
    @Published var selection: UUID?
}

struct SnippetsSettingsView: View {
    @EnvironmentObject var store: MailStore
    @StateObject private var m = SnippetsSettingsModel()

    var body: some View {
        HStack(spacing: 0) {
            VStack(spacing: 0) {
                List(selection: $m.selection) {
                    ForEach(store.liveSnippets) { s in
                        Text(s.title.isEmpty ? "(ohne Titel)" : s.title)
                            .lineLimit(1)
                            .tag(Optional(s.id))
                    }
                }
                Divider()
                HStack(spacing: 4) {
                    Button {
                        m.selection = store.addSnippet()
                    } label: { Image(systemName: "plus") }
                    .help("Textbaustein hinzufügen")
                    Button {
                        if let id = m.selection {
                            m.selection = nil
                            store.deleteSnippet(id)
                        }
                    } label: { Image(systemName: "minus") }
                    .disabled(m.selection == nil)
                    .help("Textbaustein löschen")
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
    }

    @ViewBuilder
    private var editor: some View {
        if let id = m.selection, let i = store.snippets.firstIndex(where: { $0.id == id && !$0.deleted }) {
            Form {
                TextField("Titel", text: Binding(get: { store.snippets[i].title },
                                                 set: { store.updateSnippet(id, title: $0) }))
                Section("Text") {
                    TextEditor(text: Binding(get: { store.snippets[i].text },
                                             set: { store.updateSnippet(id, text: $0) }))
                        .font(.body)
                        .frame(minHeight: 260)
                }
                Text("Im Verfassen-Fenster über „Textbaustein“ einfügen – er landet vor Signatur bzw. Zitat.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .formStyle(.grouped)
        } else {
            VStack(spacing: 8) {
                Text("Textbausteine für wiederkehrende Antworten")
                    .foregroundStyle(.secondary)
                Text("z. B. Angebotsanfrage, Lieferzeit, Rückrufbitte")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
    }
}

// MARK: - Online-Meetings

struct MeetingSettingsView: View {
    @EnvironmentObject var store: MailStore

    private func linkField(_ label: String, _ key: String) -> some View {
        let value = store.meetingLinks[key] ?? ""
        let bad = !value.isEmpty && !value.lowercased().hasPrefix("https://")
        return VStack(alignment: .leading, spacing: 2) {
            TextField(label, text: Binding(get: { store.meetingLinks[key] ?? "" }, set: { store.setMeetingLink(key, $0) }),
                      prompt: Text("https://…"))
            if bad {
                Text("Der Link muss mit https:// beginnen.").font(.caption).foregroundStyle(.red)
            }
        }
    }

    var body: some View {
        Form {
            Section("Online-Meetings") {
                Picker("Standard bei neuen Terminen",
                       selection: Binding(get: { store.meetingLinks["default"] ?? "none" },
                                          set: { store.setMeetingLink("default", $0) })) {
                    ForEach(Meeting.choices) { c in Text(c.label).tag(c.id) }
                }
                linkField("Mein Teams-Link", "teams")
                linkField("Mein Zoom-Raum", "zoom")
                linkField("Mein Webex-Raum", "webex")
                linkField("Mein Meet-Link", "meet")
                Text("Feste Links (z. B. persönlicher Zoom-Meetingraum, Webex-Raum oder ein wiederverwendbarer Teams-Link) werden bei „Neuer Termin / Online-Meeting“ (Terminspalte +, Ablage-Menü oder ⌘⇧M) automatisch eingesetzt. Jitsi erzeugt einen Raum ohne Konto. Teilnehmer erhalten eine Einladung (.ics), die Outlook, Apple Kalender und Google direkt annehmen können; ihre Zu- oder Absagen kommen als E-Mail zurück. Die Links werden mit Windows synchronisiert.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
    }
}

// MARK: - Datenschutz

struct PrivacySettingsView: View {
    @EnvironmentObject var store: MailStore

    var body: some View {
        Form {
            Section("Darstellung") {
                Picker("Zeilen je E-Mail", selection: $store.listLines) {
                    Text("1 Zeile – kompakt (Absender · Betreff)").tag(1)
                    Text("2 Zeilen – Absender, Betreff").tag(2)
                    Text("3 Zeilen – mit Textvorschau").tag(3)
                }
                Text("Die Textvorschau steht für alle Mails bereit, die in der Offline-Ablage liegen (standardmäßig die neuesten 100 je Posteingang) oder schon geöffnet wurden. Auch über das Menü Darstellung → Zeilen je E-Mail.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Section("Anhänge öffnen") {
                Picker("Word-Dokumente (.docx, .doc, .odt, .rtf)",
                       selection: Binding(get: { store.openWithChoice(.doc) }, set: { store.setOpenWith(.doc, $0) })) {
                    Text("Standard-App des Systems").tag("default")
                    ForEach(AttachmentApps.candidates(for: .doc), id: \.self) { id in
                        Text(AttachmentApps.appURL(id) != nil ? AttachmentApps.label(id) : "\(AttachmentApps.label(id)) (nicht installiert)").tag(id)
                    }
                }
                Picker("PDF",
                       selection: Binding(get: { store.openWithChoice(.pdf) }, set: { store.setOpenWith(.pdf, $0) })) {
                    Text("Vorschau").tag("preview")
                    Text("Standard-App des Systems").tag("default")
                }
                Text("Ein Klick auf den Anhang öffnet ihn mit diesem Programm. Ist es nicht installiert, wird die Standard-App genommen. Rechtsklick → „Öffnen mit“ für ein anderes Programm. Die Wahl wird mit Windows synchronisiert.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Section("Datenschutz") {
                Toggle("Externe Inhalte in HTML-Mails blockieren (empfohlen)",
                       isOn: Binding(get: { store.blockRemoteImages }, set: { store.setBlockImages($0) }))
                Text("Bilder, Schriften und Stile von fremden Servern werden erst nach „Bilder laden“ oder für vertraute Absender geladen. Immer aktiv: Zählpixel und bekannte Tracking-Dienste werden entfernt, Bilder ohne Cookies, Referrer und Programmkennung geladen, Tracking-Parameter (utm_* usw.) beim Öffnen von Links gelöscht.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Section("Spamfilter") {
                Toggle("Erkannten Spam automatisch in den Spam-Ordner verschieben",
                       isOn: Binding(get: { store.spamFilterEnabled },
                                     set: { store.setSpamFilter(enabled: $0, level: store.spamFilterLevel) }))
                Picker("Empfindlichkeit",
                       selection: Binding(get: { store.spamFilterLevel },
                                          set: { store.setSpamFilter(enabled: store.spamFilterEnabled, level: $0) })) {
                    ForEach(SpamLevel.allCases, id: \.rawValue) { level in
                        Text(level.label).tag(level.rawValue)
                    }
                }
                .disabled(!store.spamFilterEnabled)
                Text("Neue E-Mails im Posteingang werden geprüft: Spam-Kennzeichnung des Mailservers, fehlgeschlagene Absenderprüfung (SPF/DKIM/DMARC), nachgeahmte Firmen und typische Spam-Betreffs. Fehlt ein Spam-Ordner, wird „Spam“ angelegt. Kontakte, eigene Adressen und vertrauenswürdige Absender werden nie aussortiert. Irrtum? Im Spam-Ordner „Kein Spam“ wählen – der Absender wird dann vertrauenswürdig. Die Einstellung wird mit Windows synchronisiert.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Section("Absender mit fester Kategorie") {
                if store.fixedCategorySenders.isEmpty {
                    Text("Noch keine – eine Mail auf „Persönlich“, „Benachrichtigungen“ oder „Newsletter“ ziehen.")
                        .foregroundStyle(.secondary)
                }
                ForEach(store.fixedCategorySenders, id: \.self) { addr in
                    HStack {
                        Text("\(addr) → \(store.senderCategoryTitle(addr))")
                        Spacer()
                        Button {
                            store.removeSenderCategory(addr)
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(.secondary)
                        .help("Wieder automatisch einsortieren (ab dem nächsten Abruf)")
                    }
                }
            }
            Section("Vertrauenswürdige Absender (Bilder laden, nie Spam)") {
                if store.trustedSenders.isEmpty {
                    Text("Noch keine – in einer Mail „Immer für diesen Absender“ wählen.")
                        .foregroundStyle(.secondary)
                }
                ForEach(Array(store.trustedSenders).sorted(), id: \.self) { sender in
                    HStack {
                        Text(sender)
                        Spacer()
                        Button {
                            store.untrust(sender)
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(.secondary)
                    }
                }
            }
            BlockedSendersSection()
        }
        .formStyle(.grouped)
    }
}

// MARK: - Offline & Synchronisation

final class OfflineSyncModel: ObservableObject {
    @Published var cacheBytes = 0
    @Published var passphrase = ""
    @Published var confirmClear = false
}

struct OfflineSyncSettingsView: View {
    @EnvironmentObject var store: MailStore
    @StateObject private var m = OfflineSyncModel()

    var body: some View {
        Form {
            Section("Offline-Ablage") {
                Toggle("E-Mails lokal speichern (schneller Start, Lesen ohne Internet)", isOn: $store.offlineEnabled)
                Picker("Offline lesbar", selection: $store.offlineKeep) {
                    ForEach([50, 100, 250, 500, 1000], id: \.self) { Text("neueste \($0) Mails je Posteingang").tag($0) }
                }
                .disabled(!store.offlineEnabled)
                Picker("Speichergrenze", selection: $store.offlineLimitMB) {
                    ForEach([250, 500, 1000, 2000, 5000], id: \.self) { v in
                        Text(v >= 1000 ? "\(v / 1000) GB" : "\(v) MB").tag(v)
                    }
                }
                .disabled(!store.offlineEnabled)
                HStack {
                    Text("Belegt: \(ByteCountFormatter.string(fromByteCount: Int64(m.cacheBytes), countStyle: .file))")
                    Spacer()
                    Button("Ablage leeren") {
                        OfflineCache.clear()
                        m.cacheBytes = 0
                    }
                }
                Text("Ordnerlisten und geöffnete Mails werden immer gespeichert, die neuesten Mails des Posteingangs zusätzlich im Hintergrund. Ohne Verbindung zeigt SimpleMail den gespeicherten Stand.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Section("Synchronisation zwischen Geräten (Mac ↔ Windows)") {
                Toggle("Einstellungen mit meinen anderen Geräten abgleichen", isOn: Binding(
                    get: { store.syncEnabled },
                    set: { on in
                        store.syncEnabled = on
                        if on && store.syncAccountEmail.isEmpty {
                            store.syncAccountEmail = store.accounts.first?.email.lowercased() ?? ""
                        }
                        if on { Task { await store.syncNow() } }
                    }))
                Picker("Über Konto", selection: $store.syncAccountEmail) {
                    Text("– Konto wählen –").tag("")
                    ForEach(store.accounts) { a in Text(a.email).tag(a.email.lowercased()) }
                }
                .disabled(!store.syncEnabled)
                HStack {
                    if store.isSyncing {
                        ProgressView().controlSize(.small)
                        Text("Synchronisiere …")
                    } else if !store.syncStatus.isEmpty {
                        Text("⚠ \(store.syncStatus)").foregroundStyle(.orange)
                    } else if let last = store.lastSync {
                        Text("Zuletzt: \(Formatters.full.string(from: last))")
                    } else {
                        Text("Noch nicht synchronisiert").foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Jetzt synchronisieren") { Task { await store.syncNow() } }
                        .disabled(!store.syncEnabled || store.isSyncing)
                }
                HStack {
                    SecureField(store.hasSyncPassphrase ? "🔒 Sync-Passwort ist gesetzt" : "Sync-Passwort (optional)",
                                text: $m.passphrase)
                    Button(store.hasSyncPassphrase ? "Ändern" : "Setzen") {
                        guard m.passphrase.count >= 8 else {
                            store.syncStatus = "Sync-Passwort: mindestens 8 Zeichen."
                            return
                        }
                        store.setSyncPassphrase(m.passphrase)
                        m.passphrase = ""
                    }
                    if store.hasSyncPassphrase {
                        Button("Entfernen", role: .destructive) { m.confirmClear = true }
                    }
                }
                .confirmationDialog("Sync-Passwort entfernen?", isPresented: $m.confirmClear) {
                    Button("Entfernen", role: .destructive) { store.setSyncPassphrase("") }
                } message: {
                    Text("Der Abgleich wird dann wieder unverschlüsselt im Postfach gespeichert. Entferne das Passwort auf allen Geräten.")
                }
                Text("Mit Sync-Passwort wird der Abgleich mit AES-256 verschlüsselt im Postfach abgelegt – wer dein Postfach einsehen kann, liest dann nichts mit. Auf allen Geräten dasselbe Sync-Passwort eintragen; es ist nicht wiederherstellbar.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text("Abgeglichen werden Konten (ohne Passwörter), Signaturen, Textbausteine, Erinnerungen und Bild-Freigaben – über einen versteckten Ordner „SimpleMail-Sync“ in deinem eigenen Postfach, ohne fremde Cloud. Auf allen Geräten dasselbe Konto wählen. Passwörter gibst du auf jedem Gerät einmal selbst ein. Geänderte Serverdaten vom anderen Gerät werden erst nach deiner Bestätigung übernommen. Tipp: FileVault einschalten, damit auch die Offline-Ablage verschlüsselt ist.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .onAppear {
            let model = m
            DispatchQueue.global(qos: .utility).async {
                let bytes = OfflineCache.totalBytes()
                DispatchQueue.main.async { model.cacheBytes = bytes }
            }
        }
    }
}
