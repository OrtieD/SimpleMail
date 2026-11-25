import SwiftUI
import UniformTypeIdentifiers
import WebKit

// Hinweis: Statt @State werden durchgehend ObservableObject-Modelle verwendet.
// Die macOS-27-SDK implementiert @State als Makro, dessen Plugin den Command Line Tools fehlt.

// MARK: - Hauptfenster

struct ContentView: View {
    @EnvironmentObject var store: MailStore
    @EnvironmentObject var calendar: CalendarService

    var body: some View {
        NavigationSplitView {
            SidebarView()
                .navigationSplitViewColumnWidth(min: 200, ideal: 240)
        } content: {
            Group {
                if store.sidebar == .scheduled {
                    ScheduledListView()
                } else if store.sidebar == .contacts {
                    ContactsListView()
                } else {
                    MessageListView()
                }
            }
            .navigationSplitViewColumnWidth(min: 300, ideal: 380)
        } detail: {
            HSplitView {
                Group {
                    if store.sidebar == .contacts {
                        if let id = store.selectedCard {
                            ContactDetailView(id: id).id(id)
                        } else {
                            VStack(spacing: 8) {
                                Image(systemName: "person.crop.circle").font(.system(size: 44)).ink(.tertiary)
                                Text("\(store.liveAddressBook.count) Kontakt(e)").ink(.secondary)
                            }
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                        }
                    } else if store.selection.count > 1 {
                        BulkPanel()
                    } else if let m = store.selectedMessage {
                        MessageDetailView(message: m).id(m.key)
                    } else {
                        VStack(spacing: 8) {
                            Image(systemName: "envelope").font(.system(size: 44)).ink(.tertiary)
                            Text("Keine E-Mail ausgewählt").ink(.secondary)
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
                .frame(minWidth: 360, maxWidth: .infinity, maxHeight: .infinity)
                if calendar.paneOpen {
                    CalendarPane()
                        .frame(minWidth: 220, idealWidth: 290, maxWidth: 520, maxHeight: .infinity)
                }
            }
        }
        .toolbar {
            ToolbarItemGroup(placement: .navigation) {
                if store.isLoading || store.isSearching { ProgressView().controlSize(.small) }
                Button { Task { await store.refresh() } } label: {
                    Label("Abrufen", systemImage: "arrow.clockwise")
                }
                Button { store.composeDraft = store.newDraft() } label: {
                    Label("Neue E-Mail", systemImage: "square.and.pencil")
                }
                .disabled(store.accounts.isEmpty)
            }
            ToolbarItem(placement: .navigation) {
                Button { store.sortAscending.toggle() } label: {
                    Label(store.sortAscending ? "Älteste oben" : "Neueste oben",
                          systemImage: store.sortAscending ? "arrow.up" : "arrow.down")
                }
                .help(store.sortAscending
                      ? "Sortierung: älteste oben – klicken für neueste oben"
                      : "Sortierung: neueste oben – klicken für älteste oben")
            }
            ToolbarItem(placement: .primaryAction) {
                Button { calendar.paneOpen.toggle() } label: {
                    Label("Termine", systemImage: "calendar")
                }
                .help("Terminspalte ein-/ausblenden (⌘⇧K)")
                .keyboardShortcut("k", modifiers: [.command, .shift])
            }
        }
        .background(MainWindowFinder())
        .sheet(item: $store.composeDraft) { draft in
            ComposeView(draft: draft).environmentObject(store)
        }
        .sheet(item: $store.snoozeTarget) { m in
            SnoozeSheet(message: m).environmentObject(store)
        }
        .sheet(isPresented: $calendar.newMeetingOpen) {
            NewEventSheet(message: nil)
                .environmentObject(store)
                .environmentObject(calendar)
        }
        .overlay {
            if store.accounts.isEmpty { OnboardingView() }
        }
    }
}

// MARK: - Schriftfarben (2.39)

/// Kräftigere Schriftfarben als die System-Stufen (.primary/.secondary/.tertiary sind auf dem Mac
/// halbtransparent und wirken blass – Ortie-Wunsch: „schwärzer wie unter Windows“).
enum InkLevel { case primary, secondary, tertiary }

extension Color {
    private static func ink(light: CGFloat, dark: CGFloat) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.darkAqua, .vibrantDark, .aqua, .vibrantLight]).map {
                $0 == .darkAqua || $0 == .vibrantDark } ?? false
            let v = isDark ? dark : light
            return NSColor(srgbRed: v, green: v, blue: v, alpha: 1)
        })
    }
    static let inkPrimary = ink(light: 0.06, dark: 0.96)    // ~#0f0f0f / #f5f5f5
    static let inkSecondary = ink(light: 0.26, dark: 0.80)  // ~#424242 / #cccccc (System: 50 % Grau)
    static let inkTertiary = ink(light: 0.40, dark: 0.66)   // ~#666666 / #a8a8a8 (System: 26 % Grau)

    static func ink(_ level: InkLevel) -> Color {
        switch level {
        case .primary: return inkPrimary
        case .secondary: return inkSecondary
        case .tertiary: return inkTertiary
        }
    }
}

/// Setzt die kräftige Schriftfarbe; in ausgewählten (blau hinterlegten) Listenzeilen bleibt die
/// System-Farbe, damit die Schrift dort weiß wird.
struct InkModifier: ViewModifier {
    let level: InkLevel
    let custom: Color?

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(macOS 14.0, *) {
            content.modifier(InkProminenceModifier(level: level, custom: custom))
        } else {
            content.foregroundStyle(custom ?? Color.ink(level))
        }
    }
}

@available(macOS 14.0, *)
struct InkProminenceModifier: ViewModifier {
    let level: InkLevel
    let custom: Color?
    @Environment(\.backgroundProminence) private var prominence

    @ViewBuilder
    func body(content: Content) -> some View {
        if prominence == .increased {
            switch level {
            case .primary: content.foregroundStyle(HierarchicalShapeStyle.primary)
            case .secondary: content.foregroundStyle(HierarchicalShapeStyle.secondary)
            case .tertiary: content.foregroundStyle(HierarchicalShapeStyle.tertiary)
            }
        } else {
            content.foregroundStyle(custom ?? Color.ink(level))
        }
    }
}

extension View {
    func ink(_ level: InkLevel, custom: Color? = nil) -> some View {
        modifier(InkModifier(level: level, custom: custom))
    }
}

/// Gelber Punkt für ungelesene Mails (mit dunklerem Rand, damit er auch auf hellem Grund auffällt)
extension Color {
    static let unreadMarker = Color(red: 1.0, green: 0.80, blue: 0.0)
    static let unreadMarkerEdge = Color(red: 0.80, green: 0.58, blue: 0.0)
}

// MARK: - Seitenleiste

extension Section where Parent: View, Content: View, Footer: View {
    /// Abschnitte der Seitenleiste ohne System-Ausklappen
    @ViewBuilder
    func fixedSection() -> some View {
        if #available(macOS 14.0, *) {
            self.collapsible(false)
        } else {
            self
        }
    }
}

struct SidebarView: View {
    @EnvironmentObject var store: MailStore

    var body: some View {
        List(selection: $store.sidebar) {
            if !store.accounts.isEmpty {
                Section("Konten") {
                    accountRow(nil, title: "Alle Konten", count: store.totalUnread)
                    ForEach(store.accounts) { acc in
                        accountRow(acc.id, title: acc.email, count: store.unreadCount(for: acc.id), account: acc)
                    }
                }
                .fixedSection()
            }
            Section(store.activeFilter.flatMap { store.account($0)?.email } ?? "Posteingang") {
                row("Smart Inbox", "tray.full", .smart, store.unreadCount())
                row("Ungelesen", "envelope.badge", .unread, store.unreadCount())
                row("Markiert", "star", .flagged, 0)
                row("Später", "clock", .snoozed, store.snoozedCount)
                row("Geplant", "paperplane.circle", .scheduled, store.scheduled.count)
                // 2.42: gemeinsame Ordner aller Konten (nehmen gezogene Mails an)
                row("Gesendet", "paperplane", .sent, 0)
                row("Papierkorb", "trash", .trash, 0)
                row("Kontakte", "person.crop.circle", .contacts, 0)
            }
            .fixedSection()
            Section("Kategorien") {
                ForEach(MailCategory.allCases) { c in
                    row(c.title, c.icon, .category(c), store.unreadCount(c))
                }
                row("Spam", "xmark.bin", .spam, 0)
            }
            .fixedSection()

            ForEach(store.accounts.filter { store.activeFilter == nil || $0.id == store.activeFilter }) { acc in
                let collapsed = store.collapsedAccounts.contains(acc.id)
                Section {
                    if !collapsed {
                        // Eindeutige IDs über alle Konten: jedes Konto hat „INBOX“ usw. – gleiche IDs in einer Liste
                        // ließen die Seitenleiste beim Ausklappen hängen bzw. abstürzen
                        ForEach((store.folders[acc.id] ?? []).map { FolderEntry(account: acc.id, folder: $0) }) { e in
                            folderRow(e.folder, account: e.account)
                        }
                    }
                } header: {
                    HStack(spacing: 4) {
                        // eigenes Ein-/Ausklappen (das System-Ausklappen der Seitenleiste ließ die App abstürzen)
                        Button {
                            var t = Transaction()
                            t.disablesAnimations = true
                            withTransaction(t) {
                                if collapsed { store.collapsedAccounts.remove(acc.id) } else { store.collapsedAccounts.insert(acc.id) }
                                if collapsed == false, case .folder(let id, _) = store.sidebar, id == acc.id { store.sidebar = .smart }
                            }
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: collapsed ? "chevron.right" : "chevron.down")
                                    .font(.caption2.weight(.semibold))
                                    .frame(width: 10)
                                Circle().fill(acc.displayColor).frame(width: 8, height: 8)
                                Text(acc.email).lineLimit(1)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .help(collapsed ? "Ordner einblenden" : "Ordner ausblenden")
                        Spacer()
                        Image(systemName: store.pushActive[acc.id] == true ? "bolt.fill" : "clock")
                            .ink(.secondary, custom: store.pushActive[acc.id] == true ? Color.green : nil)
                            .help(store.pushActive[acc.id] == true ? "Push aktiv (IMAP IDLE)" : "Abruf alle 5 Minuten")
                    }
                    .contextMenu { accountMenu(acc) }
                    // 2.40: beim Ziehen mitscrollen; eingeklapptes Konto klappt nach kurzem Verweilen auf
                    .background(SidebarScrollTarget(onLinger: expandOnHover(acc.id, collapsed: collapsed)))
                }
                .fixedSection()
            }
            // 2.40: etwas Platz unter dem letzten Ordner, damit er beim Ziehen nicht am Rand (Scrollbereich) klebt
            Color.clear.frame(height: 44)
                .background(SidebarScrollTarget())
        }
        .listStyle(.sidebar)
    }

    /// 2.40: eingeklapptes Konto klappt beim Ziehen nach kurzem Verweilen auf
    func expandOnHover(_ id: UUID, collapsed: Bool) -> (@MainActor () -> Void)? {
        guard collapsed else { return nil }
        let target = store
        return {
            var t = Transaction()
            t.disablesAnimations = true
            withTransaction(t) { _ = target.collapsedAccounts.remove(id) }
        }
    }

    /// Eintrag der Kontenübersicht oben in der Seitenleiste
    func accountRow(_ id: UUID?, title: String, count: Int, account: Account? = nil) -> some View {
        let active = store.activeFilter == id
        return Button {
            store.accountFilter = id
        } label: {
            HStack(spacing: 8) {
                if let account {
                    Avatar(name: account.displayName.isEmpty ? account.email : account.displayName, size: 20,
                           fixedColor: account.displayColor)
                } else {
                    Image(systemName: "tray.2").frame(width: 20)
                }
                VStack(alignment: .leading, spacing: 0) {
                    Text(title).lineLimit(1).ink(.primary)
                    if let account, !store.hasPassword(account.id) {
                        Text("Passwort fehlt").font(.caption2).foregroundStyle(.red)
                    }
                }
                Spacer(minLength: 4)
                if let account {
                    Circle()
                        .fill(store.pushActive[account.id] == true ? Color.green : Color.secondary.opacity(0.3))
                        .frame(width: 6, height: 6)
                        .help(store.pushActive[account.id] == true ? "Push aktiv" : "Abruf alle 5 Minuten")
                }
                if count > 0 {
                    Text("\(count)").font(.caption).ink(.secondary)
                }
            }
            .padding(.vertical, 3)
            .padding(.horizontal, 5)
            .background(active ? Color.accentColor.opacity(0.18) : Color.clear,
                        in: RoundedRectangle(cornerRadius: 5))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        // 2.40: beim Ziehen über die Kontenliste oben ebenfalls mitscrollen
        .background(SidebarScrollTarget())
        .contextMenu { accountMenu(account) }
    }

    @ViewBuilder
    func folderRow(_ f: MailFolder, account: UUID) -> some View {
        // 2.43: eigene Schriftfarbe (Rechtsklick → Schriftfarbe), farbige Ordner halbfett
        let colorHex = store.folderColorHex(account: account, path: f.path)
        let label = Label {
            Text(f.name)
                .fontWeight(colorHex.isEmpty ? .regular : .semibold)
                .ink(f.selectable ? .primary : .secondary, custom: colorHex.isEmpty ? nil : ColorChoices.color(hex: colorHex))
        } icon: { Image(systemName: f.icon) }
            .padding(.leading, CGFloat(f.depth) * 14)
        if f.selectable {
            label
                // 2.34: Ablegen über eine AppKit-Fläche (FolderDropTarget) – SwiftUIs dropDestination/onDrop
                // kamen in der Seitenleisten-Liste nie an (kein grünes Plus, Ziehen in Ordner ging in keiner Ansicht)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(FolderDropTarget { text in
                    store.handleDrop([text], account: account, folder: f.path)
                })
                .badge(f.role == .trash || f.role == .junk || f.role == .sent ? 0 : f.unread)
                .tag(SidebarItem.folder(account, f.path))
                .contextMenu { folderMenu(f, account: account) }
        } else {
            label
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(SidebarScrollTarget())
                .contextMenu { folderMenu(f, account: account) }
        }
    }

    func row(_ title: String, _ icon: String, _ item: SidebarItem, _ count: Int) -> some View {
        Label { Text(title).ink(.primary) } icon: { Image(systemName: icon) }
            // 2.35: „Spam“ unter Kategorien nimmt gezogene Mails an (→ Spam-Ordner ihres Kontos)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(FolderDropTarget(enabled: item.acceptsDrop) { text in
                // 2.40: auch auf Kategorien – Absender landet künftig in dieser Kategorie
                if case .category(let c) = item { return store.handleCategoryDrop([text], category: c) }
                if item == .sent { return store.handleRoleDrop([text], role: .sent) }
                if item == .trash { return store.handleRoleDrop([text], role: .trash) }
                return store.handleSpamDrop([text])
            })
            .badge(count)
            .tag(item)
            .contextMenu { itemMenu(item) }
    }
}

/// Zeile der Smart Inbox: Kategorie-Überschrift oder Mail
enum SmartRowID: Hashable {
    case header(MailCategory)
    case mail(MessageKey)
}

struct SmartListRow: Identifiable {
    let id: SmartRowID
    let category: MailCategory
    let message: MailMessage?
    let count: Int
    let unread: Int
    let collapsible: Bool
    let expanded: Bool
}

/// Ordner-Eintrag der Seitenleiste mit kontoübergreifend eindeutiger ID
struct FolderEntry: Identifiable {
    let account: UUID
    let folder: MailFolder
    var id: String { "\(account.uuidString)|\(folder.path)" }
}

// MARK: - Nachrichtenliste

struct MessageListView: View {
    @EnvironmentObject var store: MailStore
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        List(selection: $store.selection) {
            if let results = store.searchResults {
                Section {
                    ForEach(store.visibleMessages) { rowView($0) }
                } header: {
                    Label("\(store.isSearching ? "Suche" : "Suchergebnisse") \(store.currentFolderInfo == nil ? "in allen Ordnern" : "in diesem Ordner")\(store.isSearching ? " …" : "") (\(results.count))",
                          systemImage: "magnifyingglass")
                }
            } else if let f = store.currentFolderInfo {
                Section {
                    ForEach(store.visibleMessages) { rowView($0) }
                } header: {
                    Label(f.name, systemImage: f.icon)
                }
                loadMoreRow
            } else if store.showsSmartGroups {
                // 2.38: wie Spark – Benachrichtigungen und Newsletter oben als einklappbare Zeile mit Anzahl,
                // darunter Persönlich. Flache Zeilenliste (mit Sections fehlten Zeilen, siehe 2.37)
                ForEach(smartRows) { row in
                    if let m = row.message {
                        rowView(m)
                    } else if row.collapsible {
                        groupToggleRow(row)
                    } else {
                        Label("\(row.category.title) (\(row.count))", systemImage: row.category.icon)
                            .font(.subheadline.weight(.semibold))
                            .ink(.secondary)
                            .padding(.top, 6)
                    }
                }
                loadMoreRow
            } else {
                ForEach(store.visibleMessages) { rowView($0) }
                if store.sidebar != .snoozed { loadMoreRow }
            }
        }
        .listStyle(.inset)
        // Bei Konto- oder Ordnerwechsel die Liste neu aufbauen statt Tausende Zeilen einzeln abzugleichen
        // (der Abgleich verursachte die Verzögerung beim Kontowechsel)
        .id(listIdentity)
        // Rechtsklick-Menü und Doppelklick (bzw. ↩) zum Öffnen in eigenem Fenster
        .contextMenu(forSelectionType: MessageKey.self, menu: listMenu, primaryAction: openInWindows)
        .overlay {
            if store.visibleMessages.isEmpty && !store.isLoading && !store.isSearching && !store.accounts.isEmpty {
                Text(store.sidebar == .snoozed ? "Keine zurückgestellten E-Mails" : "Keine E-Mails")
                    .ink(.secondary)
            }
        }
        .onDeleteCommand {
            if store.selection.count > 1 {
                Task { await store.bulk(.delete) }
            } else if let m = store.selectedMessage {
                Task { await store.delete(m) }
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            MailSearchBar()
        }
        .safeAreaInset(edge: .bottom) {
          VStack(spacing: 0) {
            if store.isOffline && !store.isLoading {
                Label("Offline – gespeicherte E-Mails werden angezeigt", systemImage: "wifi.slash")
                    .font(.caption)
                    .ink(.secondary)
                    .frame(maxWidth: .infinity)
                    .padding(8)
                    .background(.bar)
            }
            if let err = store.errorMessage {
                HStack(alignment: .top) {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                    Text(err).font(.caption).lineLimit(3)
                    Spacer()
                    Button { store.errorMessage = nil } label: { Image(systemName: "xmark") }
                        .buttonStyle(.plain)
                }
                .padding(10)
                .background(.bar)
            }
          }
        }
    }

    /// Smart Inbox als eine Liste: einklappbare Zeilen (Benachrichtigungen, Newsletter), dann Persönlich
    private var smartRows: [SmartListRow] {
        let groups = store.smartGroups
        var out: [SmartListRow] = []
        for cat in MailStore.smartOrder {
            let items = groups[cat] ?? []
            if items.isEmpty { continue }
            let collapsible = MailStore.collapsibleGroups.contains(cat)
            let open = !collapsible || store.expandedGroups.contains(cat)
            out.append(SmartListRow(id: .header(cat), category: cat, message: nil, count: items.count,
                                    unread: items.filter { !$0.isRead }.count, collapsible: collapsible, expanded: open))
            if open {
                for m in items {
                    out.append(SmartListRow(id: .mail(m.key), category: cat, message: m, count: 0,
                                            unread: 0, collapsible: false, expanded: false))
                }
            }
        }
        return out
    }

    /// Zeile „Benachrichtigungen 12 · 3 neu“ – Klick klappt auf/zu
    private func groupToggleRow(_ row: SmartListRow) -> some View {
        Button {
            var t = Transaction()
            t.disablesAnimations = true
            withTransaction(t) { store.toggleGroup(row.category) }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: row.expanded ? "chevron.down" : "chevron.right")
                    .font(.caption.weight(.semibold))
                    .ink(.secondary)
                    .frame(width: 12)
                Image(systemName: row.category.icon)
                    .ink(.secondary)
                    .frame(width: 18)
                Text(row.category.title)
                    .fontWeight(.semibold)
                Spacer()
                if row.unread > 0 {
                    Text("\(row.unread) neu")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.accentColor)
                }
                Text("\(row.count)")
                    .font(.caption)
                    .ink(.secondary)
            }
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(row.expanded ? "Einklappen" : "Aufklappen")
    }

    private var listIdentity: String {
        // Wechsel zwischen gruppierter Smart Inbox, flacher Liste und Suchergebnissen ebenfalls neu aufbauen:
        // das Abgleichen von Tausenden Zeilen zwischen den Darstellungen ließ den ersten Tastendruck der Suche stocken
        let mode = store.searchResults != nil ? "suche" : (store.showsSmartGroups ? "gruppen" : "liste")
        return "\(store.activeFilter?.uuidString ?? "alle")|\(String(describing: store.sidebar))|\(mode)"
    }

    @ViewBuilder
    private func listMenu(_ keys: Set<MessageKey>) -> some View {
        if keys.count > 1 {
            BulkMenuItems()
        } else if let k = keys.first, let m = store.message(for: k) {
            Button("In eigenem Fenster öffnen") { openWindow(value: m) }
            Divider()
            singleMenu(m)
        }
    }

    /// Doppelklick / ↩: ausgewählte Mails in eigenen Fenstern öffnen
    private func openInWindows(_ keys: Set<MessageKey>) {
        for k in keys.prefix(10) {
            if let m = store.message(for: k) { openWindow(value: m) }
        }
    }

    @ViewBuilder
    private var loadMoreRow: some View {
        if store.canLoadMore && store.searchText.isEmpty {
            HStack {
                Spacer()
                Button {
                    Task { await store.loadMore() }
                } label: {
                    Label("Ältere E-Mails laden", systemImage: "arrow.down.circle")
                }
                .disabled(store.isLoading)
                Spacer()
            }
            .padding(.vertical, 6)
        }
    }

    func rowView(_ m: MailMessage) -> some View {
        MessageRow(message: m,
                   accountLabel: store.accounts.count > 1 ? store.accountLabel(m.accountID) : nil,
                   snoozedUntil: store.snoozeDate(m),
                   lines: store.listLines,
                   preview: store.previews[m.key],
                   accountColor: store.accounts.count > 1 ? store.accountColor(m.accountID) : nil,
                   senderColor: store.isSentFolder(m) ? nil : store.contactColor(m.fromAddress),
                   folderLabel: store.searchResults != nil ? store.folderLabel(m) : nil,
                   showRecipients: store.isSentFolder(m))
            // Unveränderte Zeilen nicht neu zeichnen (jede Änderung am Store wertet sonst alle Zeilen neu aus)
            .equatable()
            .tag(m.key)
            // (2.33 hatte onDrag – das schluckte die Klicks, Mails ließen sich nicht mehr auswählen)
            .draggable(store.dragPayload(m))
            .swipeActions(edge: .trailing) {
                Button { Task { await store.archive(m) } } label: {
                    Label("Archivieren", systemImage: "archivebox")
                }
                .tint(.green)
                Button(role: .destructive) { Task { await store.delete(m) } } label: {
                    Label("Löschen", systemImage: "trash")
                }
            }
            .swipeActions(edge: .leading) {
                Button { Task { await store.setRead(m, !m.isRead) } } label: {
                    Label(m.isRead ? "Ungelesen" : "Gelesen",
                          systemImage: m.isRead ? "envelope.badge" : "envelope.open")
                }
                .tint(.blue)
                if m.folder == "INBOX" {
                    Button { store.snooze(m, until: TimeOptions.snooze()[0].date) } label: {
                        Label("Später", systemImage: "clock")
                    }
                    .tint(.purple)
                }
            }
    }

    @ViewBuilder
    func singleMenu(_ m: MailMessage) -> some View {
                Button("Antworten") { store.composeDraft = store.replyDraft(m, all: false) }
                Button("Weiterleiten") { store.composeDraft = store.forwardDraft(m) }
                Divider()
                Button(m.isRead ? "Als ungelesen markieren" : "Als gelesen markieren") {
                    Task { await store.setRead(m, !m.isRead) }
                }
                Button(m.isFlagged ? "Markierung entfernen" : "Markieren") {
                    Task { await store.toggleFlag(m) }
                }
                if m.folder == "INBOX" {
                    SnoozeMenu(message: m)
                }
                Divider()
                if let known = store.card(forEmail: m.fromAddress) {
                    Button("Kontakt aus dieser Mail ergänzen") { store.addSenderToContacts(m) }
                    Button("Kontakt anzeigen") { store.selectedCard = known.id; store.sidebar = .contacts }
                } else {
                    Button("Absender zu Kontakten hinzufügen") { store.addSenderToContacts(m) }
                }
                Menu("Verschieben nach") { MoveMenuItems(message: m) }
                Divider()
                if store.isJunkFolder(m) {
                    Button("Kein Spam") { Task { await store.markNotSpam(m) } }
                } else {
                    SpamMenuItems(message: m)
                }
                Divider()
                Button("Drucken …") { MailPrinter.print(m, store: store) }
                Divider()
                Button("Archivieren") { Task { await store.archive(m) } }
                Button("Löschen", role: .destructive) { Task { await store.delete(m) } }
    }
}

struct MessageRow: View, Equatable {
    let message: MailMessage
    let accountLabel: String?
    let snoozedUntil: Date?
    var lines: Int = 2
    var preview: String? = nil
    /// Kontofarbe (nur bei mehreren Konten) und Schriftfarbe des Absenders (Kontakt)
    var accountColor: Color? = nil
    var senderColor: Color? = nil
    /// Ordnername bei Suchtreffern außerhalb des Posteingangs
    var folderLabel: String? = nil
    /// 2.42: in „Gesendet“ die Empfänger statt des eigenen Namens zeigen
    var showRecipients: Bool = false

    private var recipients: String? {
        guard showRecipients, !message.to.isEmpty else { return nil }
        let names = MessageRow.recipientNames(message.to)
        return names.isEmpty ? nil : names
    }

    private var nameText: String {
        if let r = recipients { return "An: " + r }
        return message.senderDisplay
    }

    /// „Max Muster <max@x.de>, b@y.de“ → „Max Muster, b@y.de“
    static func recipientNames(_ to: String) -> String {
        let trim = CharacterSet(charactersIn: "\"'<> ").union(.whitespacesAndNewlines)
        var out: [String] = []
        for part in to.split(separator: ",") {
            let p = part.trimmingCharacters(in: .whitespacesAndNewlines)
            if let lt = p.firstIndex(of: "<") {
                let name = String(p[..<lt]).trimmingCharacters(in: trim)
                let addr = String(p[lt...]).trimmingCharacters(in: trim)
                out.append(name.isEmpty ? addr : name)
            } else if !p.isEmpty {
                out.append(p)
            }
        }
        return out.joined(separator: ", ")
    }

    var body: some View {
        Group {
            if lines == 1 { compactRow } else { fullRow }
        }
        .ink(.primary)
        .padding(.leading, accountColor == nil ? 0 : 7)
        .overlay(alignment: .leading) {
            if let c = accountColor {
                RoundedRectangle(cornerRadius: 1.5).fill(c).frame(width: 3)
            }
        }
    }

    /// 1 Zeile: Absender · Betreff · Datum
    private var compactRow: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(message.isRead ? Color.clear : Color.unreadMarker)
                .overlay(Circle().stroke(message.isRead ? Color.clear : Color.unreadMarkerEdge, lineWidth: 1))
                .frame(width: 10, height: 10)
            Text(nameText)
                .fontWeight(message.isRead ? .regular : .semibold)
                .ink(.primary, custom: senderColor)
                .lineLimit(1)
                .frame(width: 140, alignment: .leading)
            Text(message.subject.isEmpty ? "(Kein Betreff)" : message.subject)
                .ink(message.isRead ? .secondary : .primary)
                .lineLimit(1)
            Spacer(minLength: 4)
            if message.hasAttachment {
                Image(systemName: "paperclip").font(.caption2).ink(.secondary)
            }
            if message.isFlagged {
                Image(systemName: "star.fill").font(.caption2).foregroundStyle(.orange)
            }
            if snoozedUntil != nil {
                Image(systemName: "clock").font(.caption2).foregroundStyle(.purple)
            }
            if let f = folderLabel {
                Label(f, systemImage: "folder").font(.caption2).ink(.secondary).lineLimit(1)
            }
            Text(Formatters.listDate(message.date))
                .font(.caption)
                .ink(.secondary)
        }
        .font(.callout)
        .padding(.vertical, 1)
    }

    /// 2 Zeilen (Absender, Betreff) bzw. 3 Zeilen (zusätzlich Textvorschau)
    private var fullRow: some View {
        HStack(alignment: .top, spacing: 10) {
            ZStack(alignment: .topLeading) {
                Avatar(name: recipients ?? message.senderDisplay, size: 34)
                if !message.isRead {
                    Circle().fill(Color.unreadMarker)
                        .frame(width: 13, height: 13)
                        .overlay(Circle().stroke(Color.unreadMarkerEdge, lineWidth: 1))
                        .overlay(Circle().stroke(Color(nsColor: .windowBackgroundColor), lineWidth: 2).padding(-2))
                        .offset(x: -3, y: -3)
                        .help("Ungelesen")
                }
            }
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(nameText)
                        .fontWeight(message.isRead ? .regular : .semibold)
                        .ink(.primary, custom: senderColor)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    if message.hasAttachment {
                        Image(systemName: "paperclip").font(.caption2).ink(.secondary)
                    }
                    if message.isFlagged {
                        Image(systemName: "star.fill").font(.caption2).foregroundStyle(.orange)
                    }
                    Text(Formatters.listDate(message.date))
                        .font(.caption)
                        .ink(.secondary)
                }
                Text(message.subject.isEmpty ? "(Kein Betreff)" : message.subject)
                    .font(.system(size: 13, weight: message.isRead ? .regular : .semibold))
                    .ink(.primary)
                    .lineLimit(1)
                if lines >= 3 {
                    Text((preview ?? "").isEmpty ? " " : (preview ?? ""))
                        .font(.system(size: 13))
                        .ink(.secondary)
                        .lineLimit(1)
                }
                if accountLabel != nil || snoozedUntil != nil || folderLabel != nil {
                    HStack(spacing: 8) {
                        if let f = folderLabel {
                            Label(f, systemImage: "folder").ink(.secondary)
                        }
                        if let until = snoozedUntil {
                            Label(Formatters.weekdayTime.string(from: until), systemImage: "clock")
                                .foregroundStyle(.purple)
                        }
                        if let label = accountLabel {
                            HStack(spacing: 3) {
                                if let c = accountColor { Circle().fill(c).frame(width: 6, height: 6) }
                                Text(label).ink(.tertiary)
                            }
                        }
                    }
                    .font(.caption2)
                }
            }
        }
        .padding(.vertical, 5)
    }
}

struct Avatar: View {
    let name: String
    var size: CGFloat = 36
    var fixedColor: Color? = nil

    private var initials: String {
        let letters = name.split(separator: " ").prefix(2).compactMap { $0.first }.map(String.init).joined()
        return letters.isEmpty ? "?" : letters.uppercased()
    }

    private var color: Color {
        if let fixedColor { return fixedColor }
        let palette: [Color] = [.blue, .purple, .pink, .orange, .teal, .green, .indigo, .red]
        let hash = name.unicodeScalars.reduce(0) { $0 &* 31 &+ Int($1.value) }
        return palette[Int(UInt(bitPattern: hash) % UInt(palette.count))]
    }

    var body: some View {
        Circle()
            .fill(color.gradient)
            .frame(width: size, height: size)
            .overlay(
                Text(initials)
                    .font(.system(size: size * 0.38, weight: .semibold))
                    .foregroundStyle(.white))
    }
}

// MARK: - Später erinnern

struct SnoozeMenu: View {
    @EnvironmentObject var store: MailStore
    let message: MailMessage

    var body: some View {
        Menu {
            ForEach(TimeOptions.snooze()) { o in
                Button("\(o.title) – \(Formatters.weekdayTime.string(from: o.date))") {
                    store.snooze(message, until: o.date)
                }
            }
            Divider()
            Button("Eigener Zeitpunkt …") { store.snoozeTarget = message }
            if store.isSnoozed(message) {
                Divider()
                Button("Zurück in den Posteingang") { store.unsnooze(message) }
            }
        } label: {
            Label("Später erinnern", systemImage: "clock")
        }
    }
}

final class DateChoiceModel: ObservableObject {
    @Published var date: Date
    init(date: Date) { self.date = date }
}

struct SnoozeSheet: View {
    @EnvironmentObject var store: MailStore
    @Environment(\.dismiss) var dismiss
    @StateObject private var m = DateChoiceModel(
        date: Calendar.current.date(byAdding: .day, value: 1, to: Date()) ?? Date())
    let message: MailMessage

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Erinnern am …").font(.headline)
            Text(message.subject.isEmpty ? "(Kein Betreff)" : message.subject)
                .ink(.secondary)
                .lineLimit(2)
            DatePicker("", selection: $m.date, in: Date()...)
                .datePickerStyle(.graphical)
                .labelsHidden()
            HStack {
                Spacer()
                Button("Abbrechen") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Zurückstellen") {
                    store.snooze(message, until: m.date)
                    dismiss()
                }
                .keyboardShortcut(.defaultAction)
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(20)
        .frame(width: 340)
    }
}

// MARK: - Geplante Mails

struct ScheduledListView: View {
    @EnvironmentObject var store: MailStore

    var body: some View {
        List {
            ForEach(store.scheduled) { s in
                VStack(alignment: .leading, spacing: 4) {
                    Text(s.subject.isEmpty ? "(Kein Betreff)" : s.subject)
                        .fontWeight(.semibold)
                        .lineLimit(1)
                    Text("An: \(s.toDisplay)")
                        .font(.caption)
                        .ink(.secondary)
                        .lineLimit(1)
                    HStack(spacing: 8) {
                        Label(Formatters.weekdayTime.string(from: s.sendAt), systemImage: "clock")
                        Text(store.accountLabel(s.accountID)).ink(.tertiary)
                    }
                    .font(.caption)
                    if let err = s.lastError {
                        Text("Fehler: \(err)").font(.caption).foregroundStyle(.red).lineLimit(2)
                    }
                }
                .padding(.vertical, 4)
                .contextMenu {
                    Button("Jetzt senden") { Task { await store.sendScheduled(s) } }
                    Button("Löschen", role: .destructive) { store.cancelScheduled(s) }
                }
                .swipeActions {
                    Button(role: .destructive) { store.cancelScheduled(s) } label: {
                        Label("Löschen", systemImage: "trash")
                    }
                    Button { Task { await store.sendScheduled(s) } } label: {
                        Label("Jetzt senden", systemImage: "paperplane")
                    }
                    .tint(.blue)
                }
            }
        }
        .listStyle(.inset)
        .overlay {
            if store.scheduled.isEmpty {
                VStack(spacing: 6) {
                    Text("Keine geplanten E-Mails").ink(.secondary)
                    Text("Beim Verfassen über „Später senden“ planen.")
                        .font(.caption)
                        .ink(.tertiary)
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            if !store.scheduled.isEmpty {
                Text("SimpleMail muss zum Sendezeitpunkt geöffnet sein.")
                    .font(.caption)
                    .ink(.secondary)
                    .padding(8)
                    .frame(maxWidth: .infinity)
                    .background(.bar)
            }
        }
    }
}

// MARK: - Detailansicht

struct MessageDetailView: View {
    @EnvironmentObject var store: MailStore
    let message: MailMessage

    @EnvironmentObject var calendar: CalendarService

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header.padding(20).ink(.primary)
            Divider()
            content
        }
        // Links in Kopf und Text-Mails: mailto → eigener Editor
        .environment(\.openURL, OpenURLAction { url in
            store.openLink(url, accountID: message.accountID)
            return .handled
        })
        .task(id: message.key) { await store.loadBody(for: message) }
        .sheet(item: $calendar.newEventFor) { m in
            NewEventSheet(message: m)
                .environmentObject(store)
                .environmentObject(calendar)
        }
        .toolbar {
            ToolbarItemGroup {
                Button { store.composeDraft = store.replyDraft(message, all: false) } label: {
                    Label("Antworten", systemImage: "arrowshape.turn.up.left")
                }
                .keyboardShortcut("r")
                Button { store.composeDraft = store.replyDraft(message, all: true) } label: {
                    Label("Allen antworten", systemImage: "arrowshape.turn.up.left.2")
                }
                .keyboardShortcut("r", modifiers: [.command, .shift])
                Button { store.composeDraft = store.forwardDraft(message) } label: {
                    Label("Weiterleiten", systemImage: "arrowshape.turn.up.right")
                }
                .keyboardShortcut("f", modifiers: [.command, .shift])
                if message.folder == "INBOX" {
                    SnoozeMenu(message: message)
                }
                Button { Task { await store.toggleFlag(message) } } label: {
                    Label("Markieren", systemImage: message.isFlagged ? "star.fill" : "star")
                }
                .keyboardShortcut("l", modifiers: [.command, .shift])
                Button { Task { await store.archive(message) } } label: {
                    Label("Archivieren", systemImage: "archivebox")
                }
                .keyboardShortcut("a", modifiers: [.command, .control])
                Button { Task { await store.delete(message) } } label: {
                    Label("Löschen", systemImage: "trash")
                }
                .keyboardShortcut(.delete, modifiers: .command)
                Menu {
                    MoveMenuItems(message: message)
                } label: {
                    Label("Verschieben", systemImage: "folder")
                }
                .help("In einen Ordner verschieben – oder die Mail links auf einen Ordner ziehen")
                SpamMenu(message: message)
                Button { calendar.newEventFor = message } label: {
                    Label("Termin", systemImage: "calendar.badge.plus")
                }
                .help("Termin aus dieser E-Mail anlegen")
                Button { MailPrinter.print(message, store: store) } label: {
                    Label("Drucken", systemImage: "printer")
                }
                .help("E-Mail drucken oder als PDF sichern (⌘P)")
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(message.subject.isEmpty ? "(Kein Betreff)" : message.subject)
                .font(.title2.weight(.semibold))
                .textSelection(.enabled)
            HStack(alignment: .top, spacing: 12) {
                Avatar(name: message.senderDisplay, size: 40)
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text(message.senderDisplay).fontWeight(.semibold)
                            .ink(.primary, custom: store.contactColor(message.fromAddress))
                        Text(Mailto.addressLine("<", message.fromAddress + ">")).ink(.secondary)
                            .help("Klick auf die Adresse: neue E-Mail an \(message.fromAddress)")
                    }
                    if !message.to.isEmpty {
                        Text(Mailto.addressLine("An: ", message.to)).font(.caption).ink(.secondary).lineLimit(2)
                    }
                    if let cc = store.bodies[message.key]?.cc, !cc.isEmpty {
                        Text(Mailto.addressLine("Cc: ", cc)).font(.caption).ink(.secondary).lineLimit(2)
                    }
                    if store.accounts.count > 1 {
                        HStack(spacing: 4) {
                            Text("Konto:")
                            if let c = store.accountColor(message.accountID) { Circle().fill(c).frame(width: 7, height: 7) }
                            Text(store.account(message.accountID)?.email ?? "")
                        }
                        .font(.caption)
                        .ink(.tertiary)
                    }
                }
                .textSelection(.enabled)
                Spacer()
                VStack(alignment: .trailing, spacing: 4) {
                    Text(Formatters.full.string(from: message.date))
                        .font(.caption)
                        .ink(.secondary)
                    if let until = store.snoozeDate(message) {
                        Label("Erinnerung \(Formatters.weekdayTime.string(from: until))", systemImage: "clock")
                            .font(.caption)
                            .foregroundStyle(.purple)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        if let mb = store.bodies[message.key] {
            SecurityBanners(message: message, body_: mb)
            if let invite = store.invite(for: message.key, mb) {
                InviteCard(message: message, invite: invite)
                    .padding(.horizontal, 16)
                    .padding(.top, 12)
            } else if let meet = Meeting.forBody(message.key, mb) {
                MeetingBanner(meeting: meet, message: message)
                    .padding(.horizontal, 16)
                    .padding(.top, 12)
            }
            if let html = mb.html {
                privacyBanner(html)
                HTMLView(html: store.preparedHTML(html, for: message, body: mb),
                         onLink: { url in store.openLink(url, accountID: message.accountID) })
            } else {
                ScrollView {
                    Text(store.linkedText(for: message.key, mb.text ?? ""))
                        .ink(.primary)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(20)
                }
            }
            attachmentSection(store.visibleAttachments(mb))
        } else {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    @ViewBuilder
    private func attachmentSection(_ files: [MailAttachment]) -> some View {
        if !files.isEmpty {
            Divider()
            HStack(spacing: 8) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack {
                        ForEach(files) { a in
                            AttachmentChip(attachment: a)
                        }
                    }
                    .padding(.vertical, 10)
                }
                Button {
                    store.saveAllAttachments(files)
                } label: {
                    Label(files.count > 1 ? "Alle sichern" : "Sichern",
                          systemImage: "square.and.arrow.down")
                }
                .controlSize(.small)
            }
            .padding(.horizontal, 12)
        }
    }

    /// Hinweis „Externe Inhalte blockiert“ bzw. „X Tracker blockiert“ (2.47, deutlicher seit 2.48)
    @ViewBuilder
    private func privacyBanner(_ html: String) -> some View {
        let info = store.trackerInfo(html, for: message.key)
        let blocked = !store.remoteImagesAllowed(message) && store.hasRemoteContent(html, for: message.key)
        let tr = info.count > 0 ? (info.count == 1 ? "1 Tracker blockiert" : "\(info.count) Tracker blockiert") : ""
        let names = info.hosts.prefix(3).joined(separator: ", ") + (info.hosts.count > 3 ? " …" : "")
        if blocked {
            HStack(spacing: 10) {
                Image(systemName: "hand.raised.fill")
                    .font(.title3)
                    .foregroundColor(.orange)
                VStack(alignment: .leading, spacing: 2) {
                    Text(tr.isEmpty ? "Externe Inhalte blockiert" : "Externe Inhalte blockiert · " + tr)
                        .font(.callout.weight(.semibold))
                    Text(names.isEmpty ? "Der Absender erfährt nicht, ob und wo du die Mail öffnest."
                                       : "Zählpixel von \(names) entfernt. Der Absender erfährt nicht, ob und wo du die Mail öffnest.")
                        .font(.caption).ink(.secondary)
                        .help(info.hosts.joined(separator: ", "))
                }
                Spacer()
                Button("Bilder laden") { store.allowImagesOnce(message) }
                Button("Absender immer vertrauen") { store.trustSender(message) }
            }
            .controlSize(.small)
            .padding(.horizontal, 16)
            .padding(.vertical, 9)
            .background(Color.orange.opacity(0.16))
            .overlay(Rectangle().fill(Color.orange).frame(width: 4), alignment: .leading)
        } else if !tr.isEmpty {
            HStack(spacing: 10) {
                Image(systemName: "checkmark.shield.fill")
                    .font(.title3)
                    .foregroundColor(.green)
                VStack(alignment: .leading, spacing: 2) {
                    Text(tr).font(.callout.weight(.semibold))
                    Text(names.isEmpty ? "Bilder werden ohne Zählpixel, Cookies und Referrer geladen."
                                       : "Entfernt: \(names). Bilder werden ohne Cookies und Referrer geladen.")
                        .font(.caption).ink(.secondary)
                        .help(info.hosts.joined(separator: ", "))
                }
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 9)
            .background(Color.green.opacity(0.16))
            .overlay(Rectangle().fill(Color.green).frame(width: 4), alignment: .leading)
        }
    }
}

struct AttachmentChip: View {
    @EnvironmentObject var store: MailStore
    let attachment: MailAttachment

    var body: some View {
        Button {
            store.openAttachment(attachment)
        } label: {
            HStack(spacing: 6) {
                Image(systemName: icon)
                Text(attachment.filename).lineLimit(1)
                Text(attachment.sizeText).ink(.secondary)
            }
            .font(.caption)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(.quaternary, in: Capsule())
        }
        .buttonStyle(.plain)
        .help(helpText)
        .contextMenu {
            Button("Öffnen") { store.openAttachment(attachment) }
            Menu("Öffnen mit") {
                ForEach(AttachmentApps.installed(for: kind), id: \.self) { id in
                    Button(AttachmentApps.label(id)) { store.openAttachment(attachment, with: id) }
                }
                Button("Standard-App") { store.openAttachment(attachment, with: "default") }
                Divider()
                Button("Andere App …") { store.openAttachmentChoosingApp(attachment) }
            }
            Button("Sichern unter …") { store.saveAttachment(attachment) }
        }
    }

    private var kind: AttachmentKind { AttachmentApps.kind(of: attachment.filename) }

    private var helpText: String {
        let id = store.openWithChoice(kind)
        let app = id != "default" && AttachmentApps.appURL(id) != nil ? AttachmentApps.label(id) : "der Standard-App"
        return "Klicken öffnet mit \(app) – Rechtsklick: Öffnen mit … / Sichern"
    }

    private var icon: String {
        let t = attachment.mimeType
        if t.hasPrefix("image/") { return "photo" }
        if t == "application/pdf" { return "doc.richtext" }
        if t.contains("zip") || t.contains("compressed") { return "doc.zipper" }
        if t.contains("sheet") || t.contains("excel") { return "tablecells" }
        return "paperclip"
    }
}

struct HTMLView: NSViewRepresentable {
    let html: String
    /// Klick auf einen Link (mailto → eigener Editor); nil = Standard-App
    var onLink: ((URL) -> Void)? = nil

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = false
        PrivacyRules.configure(config)   // keine Cookies/Speicher, Tracker-Adressen gesperrt (2.47)
        let view = WKWebView(frame: .zero, configuration: config)
        view.customUserAgent = Privacy.userAgent
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        context.coordinator.onLink = onLink
        return view
    }

    func updateNSView(_ view: WKWebView, context: Context) {
        context.coordinator.onLink = onLink
        guard context.coordinator.loaded != html else { return }
        context.coordinator.loaded = html
        let style = """
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, Helvetica, sans-serif; font-size: 14px; color: #000;
                 margin: 16px; word-wrap: break-word; }
          img { max-width: 100%; height: auto; }
        </style>
        """
        view.loadHTMLString(style + html, baseURL: nil)
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        var loaded: String?
        var onLink: ((URL) -> Void)?

        private func open(_ url: URL) {
            if let onLink = onLink { onLink(url) } else if Mailto.isMailto(url) { NSWorkspace.shared.open(url) } else { SafeLink.open(url) }
        }

        func webView(_ webView: WKWebView,
                     decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            // Links: mailto → eigener Editor, sonst Standardbrowser; nie in der Mail-Ansicht selbst.
            // Geladen wird nur der eigene Inhalt (about:blank) – <meta http-equiv="refresh">, Formulare und
            // andere selbsttätige Navigationen würden sonst trotz Bildsperre fremde Server aufrufen (Tracking).
            guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
            if navigationAction.navigationType == .linkActivated || url.scheme?.lowercased() == "mailto" {
                open(url)
                decisionHandler(.cancel)
            } else if url.scheme?.lowercased() == "about" {
                decisionHandler(.allow)
            } else {
                decisionHandler(.cancel)
            }
        }

        // Links mit target="_blank"
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = navigationAction.request.url { open(url) }
            return nil
        }
    }
}

// MARK: - Verfassen

final class ComposeModel: ObservableObject {
    @Published var draft: Draft
    @Published var isSending = false
    @Published var sendError: String? = nil
    @Published var showSchedule = false
    @Published var scheduleDate: Date = Date().addingTimeInterval(3600)
    var lastAccountID: UUID?
    let editor = EditorBridge()
    var initialHTML: String? = nil

    init(draft: Draft) {
        self.draft = draft
        lastAccountID = draft.accountID
        editor.onChange = { [weak self] html, text in
            guard let self else { return }
            self.draft.bodyHtml = html
            self.draft.body = text
        }
    }
}

struct ComposeView: View {
    @EnvironmentObject var store: MailStore
    @Environment(\.dismiss) var dismiss
    @StateObject private var m: ComposeModel

    init(draft: Draft) {
        _m = StateObject(wrappedValue: ComposeModel(draft: draft))
    }

    var body: some View {
        VStack(spacing: 0) {
            if store.accounts.count > 1 {
                fromRow
                Divider()
            }
            addressField("An:", $m.draft.to)
            Divider()
            addressField("Cc:", $m.draft.cc)
            Divider()
            field("Betreff:", $m.draft.subject)
            Divider()
            formatBar
            Divider()
            RichEditor(initialHTML: startHTML, bridge: m.editor) { urls in
                let files = urls.filter { $0.isFileURL && !m.draft.attachments.contains($0) }
                m.draft.attachments.append(contentsOf: files)
            }
            if !m.draft.attachments.isEmpty {
                Divider()
                attachmentBar
            }
            if m.showSchedule {
                Divider()
                scheduleRow
            }
            if let err = m.sendError {
                Text(err)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 12)
            }
            Divider()
            bottomBar
        }
        .frame(minWidth: 680, minHeight: 500)
        .dropDestination(for: URL.self) { urls, _ in
            let files = urls.filter { $0.isFileURL && !m.draft.attachments.contains($0) }
            m.draft.attachments.append(contentsOf: files)
            return !files.isEmpty
        }
        .onChange(of: m.draft.accountID) { newValue in
            if newValue != m.lastAccountID {
                m.editor.setSignature(store.editorSignature(store.account(newValue)))
            }
            m.lastAccountID = newValue
        }
    }

    /// Editor-Inhalt wird nur einmal beim Öffnen berechnet
    private var startHTML: String {
        if let h = m.initialHTML { return h }
        let h = store.editorHTML(for: m.draft)
        m.initialHTML = h
        return h
    }

    // MARK: Formatleiste

    private var formatBar: some View {
        HStack(spacing: 2) {
            fmt("bold", "Fett (⌘B)") { m.editor.command("bold") }
            fmt("italic", "Kursiv (⌘I)") { m.editor.command("italic") }
            fmt("underline", "Unterstrichen (⌘U)") { m.editor.command("underline") }
            fmt("strikethrough", "Durchgestrichen") { m.editor.command("strikeThrough") }
            Divider().frame(height: 16).padding(.horizontal, 4)
            Menu {
                Button("Klein") { m.editor.command("fontSize", "2") }
                Button("Normal") { m.editor.command("fontSize", "3") }
                Button("Groß") { m.editor.command("fontSize", "5") }
                Button("Sehr groß") { m.editor.command("fontSize", "6") }
            } label: {
                Image(systemName: "textformat.size")
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
            .help("Schriftgröße")
            Menu {
                ForEach(0..<Self.colors.count, id: \.self) { i in
                    Button(Self.colors[i].0) { m.editor.command("foreColor", Self.colors[i].1) }
                }
            } label: {
                Image(systemName: "paintpalette")
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
            .help("Schriftfarbe")
            Divider().frame(height: 16).padding(.horizontal, 4)
            fmt("list.bullet", "Aufzählung") { m.editor.command("insertUnorderedList") }
            fmt("list.number", "Nummerierung") { m.editor.command("insertOrderedList") }
            fmt("decrease.indent", "Einzug verkleinern") { m.editor.command("outdent") }
            fmt("increase.indent", "Einzug vergrößern") { m.editor.command("indent") }
            Divider().frame(height: 16).padding(.horizontal, 4)
            fmt("link", "Link einfügen") { addLink() }
            fmt("eraser", "Formatierung entfernen") { m.editor.command("removeFormat") }
            Spacer()
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
    }

    static let colors: [(String, String)] = [
        ("Schwarz", "#1b1b1b"), ("Grau", "#666666"), ("Rot", "#c42b1c"), ("Orange", "#d35400"),
        ("Grün", "#107c10"), ("Blau", "#0f6cbd"), ("Lila", "#8764b8"),
    ]

    private func fmt(_ symbol: String, _ help: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).frame(width: 22, height: 20)
        }
        .buttonStyle(.borderless)
        .help(help)
    }

    private func addLink() {
        let alert = NSAlert()
        alert.messageText = "Link einfügen"
        alert.informativeText = "Webadresse oder E-Mail-Adresse. Markierter Text wird zum Link."
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24))
        field.placeholderString = "https://…"
        alert.accessoryView = field
        alert.addButton(withTitle: "Einfügen")
        alert.addButton(withTitle: "Abbrechen")
        alert.window.initialFirstResponder = field
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        var url = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !url.isEmpty else { return }
        if !url.contains(":") { url = url.contains("@") ? "mailto:" + url : "https://" + url }
        let lower = url.lowercased()
        guard ["http://", "https://", "mailto:", "tel:"].contains(where: { lower.hasPrefix($0) }) else { return }
        m.editor.addLink(url)
    }

    private var fromRow: some View {
        HStack {
            Text("Von:").ink(.secondary).frame(width: 64, alignment: .trailing)
            Picker("", selection: $m.draft.accountID) {
                ForEach(store.accounts) { acc in
                    Text(acc.displayName.isEmpty ? acc.email : "\(acc.displayName) <\(acc.email)>")
                        .tag(Optional(acc.id))
                }
            }
            .labelsHidden()
            .fixedSize()
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
    }

    private var scheduleRow: some View {
        HStack {
            DatePicker("Senden am", selection: $m.scheduleDate, in: Date()...)
            Spacer()
            Button("Abbrechen") { m.showSchedule = false }
            Button("Planen") { schedule(at: m.scheduleDate) }
                .buttonStyle(.borderedProminent)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    private var bottomBar: some View {
        HStack {
            Button("Abbrechen", role: .cancel) { dismiss() }
                .keyboardShortcut(.cancelAction)
            Button { addAttachments() } label: {
                Label("Anhang", systemImage: "paperclip")
            }
            .keyboardShortcut("a", modifiers: [.command, .shift])
            .help("Dateien anhängen (oder ins Fenster ziehen)")
            Menu {
                if store.liveSnippets.isEmpty {
                    Text("Noch keine Textbausteine – in den Einstellungen anlegen")
                }
                ForEach(store.liveSnippets) { s in
                    Button(s.title.isEmpty ? "(ohne Titel)" : s.title) {
                        m.editor.insertText(s.text)
                    }
                }
            } label: {
                Label("Textbaustein", systemImage: "text.badge.plus")
            }
            .fixedSize()
            Spacer()
            if m.isSending { ProgressView().controlSize(.small) }
            Menu {
                ForEach(TimeOptions.sendLater()) { o in
                    Button("\(o.title) – \(Formatters.weekdayTime.string(from: o.date))") {
                        schedule(at: o.date)
                    }
                }
                Divider()
                Button("Eigener Zeitpunkt …") { m.showSchedule = true }
            } label: {
                Label("Später senden", systemImage: "clock")
            }
            .fixedSize()
            .disabled(!canSend)
            Button { send() } label: { Label("Senden", systemImage: "paperplane.fill") }
                .keyboardShortcut(.return, modifiers: .command)
                .buttonStyle(.borderedProminent)
                .disabled(!canSend)
        }
        .padding(12)
    }

    private var canSend: Bool {
        !m.isSending && !store.accounts.isEmpty && !m.draft.to.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private var attachmentBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack {
                ForEach(m.draft.attachments, id: \.self) { url in
                    HStack(spacing: 5) {
                        Image(systemName: "paperclip")
                        Text(url.lastPathComponent).lineLimit(1)
                        Text(Self.fileSize(url)).ink(.secondary)
                        Button {
                            m.draft.attachments.removeAll { $0 == url }
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                        }
                        .buttonStyle(.plain)
                        .ink(.secondary)
                    }
                    .font(.caption)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(.quaternary, in: Capsule())
                }
            }
            .padding(10)
        }
    }

    /// Adressfeld mit Vorschlägen aus bisherigen Mails und dem macOS-Adressbuch
    private func addressField(_ label: String, _ text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            field(label, text)
            SuggestionRow(hits: store.suggestions(for: text.wrappedValue)) { c in
                text.wrappedValue = store.completing(text.wrappedValue, with: c)
            }
        }
    }

    func addAttachments() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.prompt = "Anhängen"
        guard panel.runModal() == .OK else { return }
        let files = panel.urls.filter { !m.draft.attachments.contains($0) }
        m.draft.attachments.append(contentsOf: files)
    }

    static func fileSize(_ url: URL) -> String {
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        return ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file)
    }

    func field(_ label: String, _ text: Binding<String>) -> some View {
        HStack {
            Text(label).ink(.secondary).frame(width: 64, alignment: .trailing)
            TextField("", text: text).textFieldStyle(.plain)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
    }

    func send() {
        let model = m
        let draft = model.draft
        model.isSending = true
        model.sendError = nil
        Task { @MainActor in
            do {
                try await store.send(draft)
                dismiss()
            } catch {
                model.sendError = error.localizedDescription
            }
            model.isSending = false
        }
    }

    func schedule(at date: Date) {
        do {
            try store.schedule(m.draft, at: date)
            dismiss()
        } catch {
            m.sendError = error.localizedDescription
        }
    }
}

/// Vorschlagsleiste unter einem Adressfeld
struct SuggestionRow: View {
    let hits: [Contact]
    let pick: (Contact) -> Void

    var body: some View {
        if !hits.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(hits, id: \.self) { c in
                        Button {
                            pick(c)
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "person.crop.circle")
                                if !c.name.isEmpty { Text(c.name).fontWeight(.medium) }
                                Text(c.email).ink(.secondary)
                            }
                            .font(.caption)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Color.accentColor.opacity(0.12), in: Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.leading, 88)
                .padding(.trailing, 12)
                .padding(.bottom, 8)
            }
        }
    }
}


// MARK: - Verschieben in Ordner

struct MoveMenuItems: View {
    @EnvironmentObject var store: MailStore
    let message: MailMessage

    var body: some View {
        let list = (store.folders[message.accountID] ?? []).filter { $0.selectable && $0.path != message.folder }
        if list.isEmpty {
            Text("Ordnerliste wird geladen …")
        }
        ForEach(list) { f in
            Button(String(repeating: "   ", count: f.depth) + f.name) {
                Task { await store.move(message, to: f.path) }
            }
        }
        let others = store.accounts.filter { $0.id != message.accountID }
        if !others.isEmpty {
            Divider()
            ForEach(others) { acc in
                Menu("In Konto: \(acc.email)") {
                    AccountFolderItems(account: acc.id) { path in
                        Task { await store.move(message, toAccount: acc.id, folder: path) }
                    }
                }
            }
        }
    }
}

/// Ordnerliste eines Kontos als Menüeinträge
struct AccountFolderItems: View {
    @EnvironmentObject var store: MailStore
    let account: UUID
    let action: (String) -> Void

    var body: some View {
        let list = (store.folders[account] ?? []).filter(\.selectable)
        if list.isEmpty { Text("Ordnerliste wird geladen …") }
        ForEach(list) { f in
            Button(String(repeating: "   ", count: f.depth) + f.name) { action(f.path) }
        }
    }
}


// MARK: - Mehrfachauswahl

struct BulkMenuItems: View {
    @EnvironmentObject var store: MailStore

    var body: some View {
        let list = store.selectedMessages
        let anyUnread = list.contains { !$0.isRead }
        let anyUnflagged = list.contains { !$0.isFlagged }
        Button(anyUnread ? "Als gelesen markieren" : "Als ungelesen markieren") { Task { await store.bulk(.read(anyUnread)) } }
        Button(anyUnflagged ? "Markieren" : "Markierung entfernen") { Task { await store.bulk(.flag(anyUnflagged)) } }
        Divider()
        Menu("Verschieben nach") { BulkMoveItems() }
        Button("Archivieren") { Task { await store.bulk(.archive) } }
        Button("Als Spam markieren") { Task { await store.bulk(.spam) } }
        Divider()
        Button("\(list.count) E-Mails löschen", role: .destructive) { Task { await store.bulk(.delete) } }
    }
}

struct BulkMoveItems: View {
    @EnvironmentObject var store: MailStore

    var body: some View {
        let list = store.selectedMessages
        let accounts = Set(list.map(\.accountID))
        if accounts.count == 1, let acc = accounts.first {
            ForEach((store.folders[acc] ?? []).filter(\.selectable)) { f in
                Button(String(repeating: "   ", count: f.depth) + f.name) { Task { await store.bulk(.move(f.path)) } }
            }
        }
        let others = store.accounts.filter { !(accounts.count == 1 && accounts.contains($0.id)) }
        if !others.isEmpty {
            if accounts.count == 1 { Divider() }
            ForEach(others) { a in
                Menu("In Konto: \(a.email)") {
                    AccountFolderItems(account: a.id) { path in
                        Task { await store.bulk(.moveTo(a.id, path)) }
                    }
                }
            }
        }
    }
}

struct BulkPanel: View {
    @EnvironmentObject var store: MailStore

    var body: some View {
        let list = store.selectedMessages
        let anyUnread = list.contains { !$0.isRead }
        let anyUnflagged = list.contains { !$0.isFlagged }
        VStack(spacing: 14) {
            Text("\(list.count)")
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 72, height: 72)
                .background(Circle().fill(Color.accentColor))
            Text("E-Mails ausgewählt").font(.title3.weight(.semibold))
            HStack(spacing: 8) {
                Button(role: .destructive) { Task { await store.bulk(.delete) } } label: { Label("Löschen", systemImage: "trash") }
                Button { Task { await store.bulk(.archive) } } label: { Label("Archivieren", systemImage: "archivebox") }
                Menu { BulkMoveItems() } label: { Label("Verschieben", systemImage: "folder") }
                    .fixedSize()
            }
            HStack(spacing: 8) {
                Button { Task { await store.bulk(.read(anyUnread)) } } label: {
                    Label(anyUnread ? "Als gelesen" : "Als ungelesen", systemImage: anyUnread ? "envelope.open" : "envelope.badge")
                }
                Button { Task { await store.bulk(.flag(anyUnflagged)) } } label: {
                    Label(anyUnflagged ? "Markieren" : "Markierung entfernen", systemImage: "flag")
                }
                Button { Task { await store.bulk(.spam) } } label: { Label("Spam", systemImage: "xmark.shield") }
            }
            Button("Auswahl aufheben") { store.selection = [] }
                .buttonStyle(.link)
                .keyboardShortcut(.cancelAction)
            Text("⌘-Klick: einzelne hinzufügen · ⇧-Klick: Bereich · ⌘A: alle")
                .font(.caption)
                .ink(.secondary)
        }
        .controlSize(.large)
        .padding(30)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}


// MARK: - E-Mail in eigenem Fenster (Doppelklick)

final class MessageWindowModel: ObservableObject {
    var wasPresent = false
}

struct MessageWindowView: View {
    @EnvironmentObject var store: MailStore
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model = MessageWindowModel()
    let message: MailMessage?

    var body: some View {
        Group {
            if let original = message {
                // aktuellen Stand (gelesen/markiert) aus dem Store, sonst die übergebene Fassung
                let current = store.message(for: original.key)
                MessageDetailView(message: current ?? original)
                    .id(original.key)
                    .navigationTitle(original.subject.isEmpty ? "(Kein Betreff)" : original.subject)
                    .onAppear { if current != nil { model.wasPresent = true } }
                    .onChange(of: current == nil) { gone in
                        // nach Archivieren/Löschen/Verschieben Fenster schließen
                        if gone && model.wasPresent { dismiss() }
                        if !gone { model.wasPresent = true }
                    }
                    .task(id: original.key) {
                        if !original.isRead { await store.setRead(original, true) }
                    }
            } else {
                Text("E-Mail nicht gefunden").ink(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(minWidth: 520, minHeight: 400)
    }
}


extension SidebarItem {
    /// Einträge, auf die man Mails ziehen kann: Spam und die drei Kategorien
    var acceptsDrop: Bool {
        if self == .spam || self == .sent || self == .trash { return true }
        if case .category = self { return true }
        return false
    }
}
