import Foundation
import AppKit
import UniformTypeIdentifiers
import SwiftUI

/// Verbindungen und Ladezustand eines Kontos
final class AccountSession {
    let account: Account
    let service: IMAPService
    /// Zweite Verbindung für Hintergrundarbeit (Vorausladen, Ordnerzähler) –
    /// so wartet das Öffnen einer Mail nicht, bis das Vorausladen fertig ist
    let background: IMAPService
    let idle: IdleWatcher
    /// Niedrigste geladene Sequenznummer pro Ordner (für „Ältere laden“)
    var lowestSeq: [String: Int] = [:]
    /// UIDVALIDITY je Ordner (für Regeln)
    var uidValidity: [String: String] = [:]

    init(account: Account, password: String) {
        self.account = account
        service = IMAPService(account: account, password: password)
        background = IMAPService(account: account, password: password)
        idle = IdleWatcher(account: account, password: password)
    }
}

@MainActor
final class MailStore: ObservableObject {
    // Konten & Inhalte
    @Published var accounts: [Account] = []
    @Published var inbox: [UUID: [MailMessage]] = [:] { didSet { dataGen &+= 1; updateBadge() } }
    @Published var folderMessages: [MailMessage] = [] { didSet { dataGen &+= 1 } }
    @Published var searchResults: [MailMessage]? = nil { didSet { dataGen &+= 1 } }
    /// Ordnerbaum je Konto – wird gespeichert, damit die Seitenleiste beim Start sofort vollständig aufgeklappt ist
    @Published var folders: [UUID: [MailFolder]] = [:] { didSet { saveFolderCache() } }
    /// Hierarchie-Trennzeichen je Konto (für Ordner anlegen/umbenennen/löschen)
    var folderDelimiters: [UUID: String] = [:]
    @Published var pushActive: [UUID: Bool] = [:]
    @Published var bodies: [MessageKey: MessageBody] = [:]

    // Ansicht
    @Published var sidebar: SidebarItem? = .smart { didSet { dataGen &+= 1; sidebarChanged(from: oldValue) } }
    @Published var selectedID: MessageKey? {
        didSet {
            // Einzelauswahl aus dem Code (z. B. nächste Mail nach dem Löschen) → Listenauswahl angleichen
            let want: Set<MessageKey> = selectedID.map { [$0] } ?? []
            if selection.count <= 1 && selection != want { selection = want }
            // Im Ordner „Ungelesen“ bleibt die geöffnete Mail sichtbar, bis man den Ordner verlässt
            if sidebar == .unread, let k = selectedID, !unreadKeep.contains(k) { unreadKeep.insert(k) }
        }
    }
    /// Mails, die im Ordner „Ungelesen“ gerade gelesen wurden und bis zum Verlassen stehen bleiben
    @Published var unreadKeep: Set<MessageKey> = [] { didSet { dataGen &+= 1 } }
    /// Auswahl in der Liste (Mehrfachauswahl mit ⌘- bzw. ⇧-Klick)
    @Published var selection: Set<MessageKey> = [] {
        didSet {
            let single = selection.count == 1 ? selection.first : nil
            if selectedID != single { selectedID = single }
        }
    }
    @Published var isLoading = false
    @Published var isSearching = false
    @Published var errorMessage: String?
    @Published var composeDraft: Draft?
    @Published var snoozeTarget: MailMessage?
    @Published var searchText = "" { didSet { dataGen &+= 1; if searchText.isEmpty { searchResults = nil } } }

    // Zusatzfunktionen
    @Published var snoozes: [SnoozeEntry] = [] {
        didSet { snoozeIndex = nil; dataGen &+= 1; Storage.save(snoozes, key: "snoozes"); updateBadge(); scheduleSync() }
    }
    /// Schneller Zugriff auf „Später“-Einträge (wird bei Änderungen neu aufgebaut)
    private var snoozeIndex: SnoozeIndex?
    /// Ordner, deren gespeicherte Vorschauen schon geladen sind
    private var previewsLoaded: Set<String> = []
    @Published var scheduled: [ScheduledMail] = [] { didSet { Storage.saveOutbox(scheduled) } }
    @Published var snippets: [Snippet] = [] { didSet { Storage.save(snippets, key: "snippets"); scheduleSync() } }
    @Published var rules: [MailRule] = [] { didSet { Storage.save(rules, key: "rules"); scheduleSync() } }
    @Published var blockRemoteImages = true {
        didSet { UserDefaults.standard.set(blockRemoteImages, forKey: "blockRemoteImages") }
    }
    /// Programm je Anhangsart („doc“, „pdf“) → word / libreoffice / wordcraft / preview / default
    @Published var openWith: [String: String] = (UserDefaults.standard.dictionary(forKey: "openWith") as? [String: String]) ?? [:] {
        didSet { UserDefaults.standard.set(openWith, forKey: "openWith") }
    }
    /// Automatischer Spamfilter (Standard: an, Stufe „medium“); wird als prefs.spamFilter synchronisiert
    @Published var spamFilterEnabled: Bool = (UserDefaults.standard.object(forKey: "spamFilterEnabled") as? Bool) ?? true {
        didSet { UserDefaults.standard.set(spamFilterEnabled, forKey: "spamFilterEnabled") }
    }
    @Published var spamFilterLevel: String = UserDefaults.standard.string(forKey: "spamFilterLevel") ?? "medium" {
        didSet { UserDefaults.standard.set(spamFilterLevel, forKey: "spamFilterLevel") }
    }
    /// Feste Online-Meeting-Links (teams, zoom, webex, meet) + „default“ = Standard-Anbieter; wird als prefs.meetingLinks synchronisiert
    @Published var meetingLinks: [String: String] = (UserDefaults.standard.dictionary(forKey: "meetingLinks") as? [String: String]) ?? [:] {
        didSet { UserDefaults.standard.set(meetingLinks, forKey: "meetingLinks") }
    }
    @Published var trusted: [String: TrustEntry] = [:] { didSet { Storage.save(trusted, key: "trusted"); scheduleSync() } }
    @Published var blocked: [String: TrustEntry] = [:] { didSet { Storage.save(blocked, key: "blocked"); scheduleSync() } }
    /// 2.40: Kategorie je Absender (Mail auf „Persönlich“/„Benachrichtigungen“/„Newsletter“ gezogen)
    @Published var senderCats: [String: SenderCategory] = [:] { didSet { Storage.save(senderCats, key: "senderCats"); scheduleSync() } }
    /// 2.43: Schriftfarbe je Ordner (Rechtsklick → Schriftfarbe)
    @Published var folderColors: [String: FolderColor] = [:] { didSet { Storage.save(folderColors, key: "folderColors"); scheduleSync() } }
    /// Adressbuch (Kontakte-Ordner)
    @Published var addressBook: [AddressCard] = [] {
        didSet { Storage.save(addressBook, key: "addressBook"); scheduleSync(); rebuildContacts(); rebuildContactColors() }
    }
    /// Schriftfarbe je Absenderadresse (aus dem Adressbuch)
    private(set) var contactColors: [String: Color] = [:]
    private func rebuildContactColors() {
        var map: [String: Color] = [:]
        for c in addressBook where !c.deleted {
            guard let hex = ColorChoices.valid(c.color) else { continue }
            let col = ColorChoices.color(hex: hex)
            for e in c.emails { map[e.lowercased()] = col }
        }
        contactColors = map
    }
    func contactColor(_ address: String) -> Color? {
        contactColors.isEmpty ? nil : contactColors[address.lowercased()]
    }
    func accountColor(_ id: UUID) -> Color? {
        account(id)?.displayColor
    }
    /// Nur die Kontofarbe ändern – ohne Neuverbindung
    func setAccountColor(_ id: UUID, _ hex: String) {
        guard let i = accounts.firstIndex(where: { $0.id == id }) else { return }
        accounts[i].color = ColorChoices.valid(hex) ?? ""
        accounts[i].colorUpdatedAt = nowMillis()
        persistAccounts()
        scheduleSync()
    }
    @Published var selectedCard: String?
    /// Hinweis nach „Kontakt aus Mail übernehmen“
    @Published var contactNotice: String?
    @Published var imagesAllowed: Set<MessageKey> = []

    /// Oben in der Seitenleiste gewähltes Konto (nil = alle Konten)
    @Published var accountFilter: UUID? = nil {
        didSet {
            dataGen &+= 1
            UserDefaults.standard.set(accountFilter?.uuidString, forKey: "accountFilter")
            accountFilterChanged()
        }
    }
    /// In der Seitenleiste eingeklappte Konten – beim Start immer alle aufgeklappt (Ortie-Wunsch 2.26)
    @Published var collapsedAccounts: Set<UUID> = [] {
        didSet { UserDefaults.standard.set(collapsedAccounts.map(\.uuidString), forKey: "collapsedAccounts") }
    }

    // Darstellung der Liste: 1, 2 oder 3 Zeilen je E-Mail
    @Published var listLines = 2 { didSet { UserDefaults.standard.set(listLines, forKey: "listLines") } }
    /// Sortierung der Liste nach Datum: false = neueste oben (Standard), true = älteste oben
    /// 2.38: Smart Inbox wie Spark – Benachrichtigungen und Newsletter oben als einklappbare Zeile.
    /// Aufgeklappte Gruppen (nur auf diesem Mac, nicht synchronisiert)
    @Published var expandedGroups: Set<MailCategory> =
        Set((UserDefaults.standard.stringArray(forKey: "expandedGroups") ?? []).compactMap { MailCategory(rawValue: $0) }) {
        didSet { UserDefaults.standard.set(expandedGroups.map(\.rawValue), forKey: "expandedGroups") }
    }
    /// Reihenfolge in der Smart Inbox: einklappbare Gruppen oben, dann Persönlich
    static let collapsibleGroups: [MailCategory] = [.notification, .newsletter]
    static let smartOrder: [MailCategory] = [.notification, .newsletter, .personal]

    func toggleGroup(_ c: MailCategory) {
        if expandedGroups.contains(c) { expandedGroups.remove(c) } else { expandedGroups.insert(c) }
    }

    @Published var sortAscending = false { didSet { dataGen &+= 1; UserDefaults.standard.set(sortAscending, forKey: "sortAscending") } }
    /// Textvorschau je Nachricht (aus der Offline-Ablage)
    @Published var previews: [MessageKey: String] = [:]

    // Offline-Ablage
    @Published var isOffline = false
    @Published var offlineEnabled = true {
        didSet {
            UserDefaults.standard.set(offlineEnabled, forKey: "offlineEnabled")
            if !offlineEnabled { OfflineCache.clear() }
        }
    }
    @Published var offlineKeep = 100 { didSet { UserDefaults.standard.set(offlineKeep, forKey: "offlineKeep") } }
    @Published var offlineLimitMB = 1000 { didSet { UserDefaults.standard.set(offlineLimitMB, forKey: "offlineLimitMB") } }

    // Synchronisation (Mac ↔ Windows) über den IMAP-Ordner „SimpleMail-Sync“
    @Published var syncEnabled = false { didSet { UserDefaults.standard.set(syncEnabled, forKey: "syncEnabled") } }
    @Published var syncAccountEmail = "" { didSet { UserDefaults.standard.set(syncAccountEmail, forKey: "syncAccountEmail") } }
    @Published var syncStatus = ""
    @Published var lastSync: Date? = nil
    @Published var isSyncing = false
    /// Ergebnis von „Regeln jetzt anwenden“
    var lastRuleReport = ""
    private var syncAgain = false
    /// Serveränderungen vom anderen Gerät, die auf Bestätigung warten
    var pendingServerChanges: [PendingServerChange] = []
    var hasSyncPassphrase: Bool { SyncCrypto.passphrase != nil }
    private var applyingSync = false
    private var syncTask: Task<Void, Never>?

    var openWithUpdatedAt: Double {
        get { UserDefaults.standard.double(forKey: "openWithUpdatedAt") }
        set { UserDefaults.standard.set(newValue, forKey: "openWithUpdatedAt") }
    }
    var meetingLinksUpdatedAt: Double {
        get { UserDefaults.standard.double(forKey: "meetingLinksUpdatedAt") }
        set { UserDefaults.standard.set(newValue, forKey: "meetingLinksUpdatedAt") }
    }
    var spamFilterUpdatedAt: Double {
        get { UserDefaults.standard.double(forKey: "spamFilterUpdatedAt") }
        set { UserDefaults.standard.set(newValue, forKey: "spamFilterUpdatedAt") }
    }
    var blockImagesUpdatedAt: Double {
        get { UserDefaults.standard.double(forKey: "blockImagesUpdatedAt") }
        set { UserDefaults.standard.set(newValue, forKey: "blockImagesUpdatedAt") }
    }
    var deletedAccounts: [String: Double] {
        get { (UserDefaults.standard.dictionary(forKey: "deletedAccounts") as? [String: Double]) ?? [:] }
        set { UserDefaults.standard.set(newValue, forKey: "deletedAccounts") }
    }
    var trustedSenders: Set<String> { Set(trusted.filter { !$0.value.deleted }.keys) }
    var liveSnippets: [Snippet] { snippets.filter { !$0.deleted } }

    private(set) var contacts: [Contact] = []
    private var systemContacts: [Contact] = []
    private(set) var sessions: [UUID: AccountSession] = [:]
    private var refreshTimer: Timer?
    private var tickTimer: Timer?
    private var wakeObserver: NSObjectProtocol?
    private var pendingRefresh = false
    private var sendingIDs: Set<UUID> = []
    private let pageSize = 200
    /// UIDVALIDITY der gespeicherten Kopfdaten („Konto|Ordner“) – nötig für den schnellen Abgleich nach dem Start
    private var cachedValidity: [String: String] = [:]
    /// 2.30: niedrigste geladene Sequenznummer aus der Offline-Ablage – nach einem Neustart wird wieder
    /// derselbe Bereich abgeglichen (vorher nur die neuesten 200, ältere Mails fehlten in der Smart Inbox)
    private var cachedLow: [String: Int] = [:]
    /// Konten, deren Posteingang gerade in refreshInbox abgerufen wird
    private var inboxBusy: Set<UUID> = []
    private var lastFolderLoad = Date.distantPast
    /// Lokal gelöschte/verschobene Mails. Ein Abruf, der vor dem Löschen auf dem Server begonnen hat,
    /// liefert sie noch mit – ohne diesen Filter tauchten sie kurz wieder auf (Liste „springt“).
    private var recentlyRemoved: [MessageKey: Date] = [:]
    /// 2.29: Aktionen, die ohne Verbindung scheiterten (Löschen, Verschieben, Gelesen …), werden beim nächsten
    /// Abruf nachgeholt – auch nach einem Neustart. Vorher gingen sie verloren, die Mail kam nach 10 Min. zurück.
    private var pendingOps: [PendingOp] = PendingOp.load() {
        didSet { PendingOp.save(pendingOps) }
    }
    private var flushingOps = false
    /// Lokal geänderte Flags (gelesen/markiert). Ein Abruf, der vor dem Speichern auf dem Server begann,
    /// lieferte noch den alten Stand – die Mail sprang zurück auf „ungelesen“ (v. a. bei langsamen Gmail-Abrufen).
    private var pendingFlags: [MessageKey: PendingFlags] = [:]
    private var smartGroupsCache: [MailCategory: [MailMessage]] = [:]
    private var smartGroupsGen = -1
    /// Zählt jede Neuberechnung der sichtbaren Liste
    private var visibleCacheVersion = 0

    // Zwischenspeicher für die Ansicht: SwiftUI wertet die Views bei jeder Änderung am Store neu aus.
    // Liste, Zähler und aufbereitetes HTML werden deshalb nur neu berechnet, wenn sich die Daten ändern.
    /// Wird bei jeder Änderung an Posteingang, Ordner, Suche, Snoozes, Sortierung oder Filter erhöht
    private var dataGen = 0
    private var visibleCache: [MailMessage] = []
    private var messageIndex: [MessageKey: MailMessage] = [:]
    private var messageIndexGen = -1
    private var visibleCacheGen = -1
    private var visibleCacheTime = Date.distantPast
    private var countCache = ViewCounts()
    private var countCacheGen = -1
    private var countCacheTime = Date.distantPast
    private var htmlCache: [MessageKey: PreparedHTML] = [:]
    private var remoteCheckCache: [MessageKey: Bool] = [:]
    private var inviteCache: [MessageKey: InviteCacheEntry] = [:]
    private var linkedTextCache: [MessageKey: LinkedTextEntry] = [:]
    private var contactsTask: Task<Void, Never>?

    init() {
        loadSettings()
        DispatchQueue.global(qos: .utility).async { DangerousFiles.cleanTemp() }
        // Offline-Ablage: zuletzt gespeicherten Posteingang sofort anzeigen
        for a in accounts {
            if let cached = OfflineCache.readHeaders(a.id, "INBOX") {
                var cachedMsgs = withoutRemoved(cached.messages)
                applyCategories(&cachedMsgs)
                inbox[a.id] = cachedMsgs
                cachedValidity["\(a.id)|INBOX"] = cached.uidValidity
                cachedLow["\(a.id)|INBOX"] = cached.low
            }
            previewsLoaded.insert("\(a.id)|INBOX")
            let id = a.id
            Task { await loadPreviews(id, "INBOX") }
        }
        // Gespeicherten Ordnerbaum sofort zeigen (vorher erst nach Abruf + Zählern aller Ordner)
        if let saved = Storage.load([String: [MailFolder]].self, key: "folderCache") {
            var map: [UUID: [MailFolder]] = [:]
            for a in accounts {
                if let list = saved[a.id.uuidString] { map[a.id] = list }
            }
            folders = map
        }
        configureSessions()
        if !sessions.isEmpty {
            Task {
                await refresh()
                await syncNow()
                await retryStartupRefresh()
            }
            // Ordner parallel zum Posteingang aktualisieren, nicht erst danach
            Task { await self.loadFolders() }
        }

        // Fallback-Abruf, falls ein Server kein IDLE kann oder eine Verbindung hängt
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
            Task { @MainActor in
                await self?.refresh()
                await self?.syncNow()
            }
        }
        // Beim Zurückkehren in die App Einstellungen abgleichen (höchstens einmal pro Minute)
        NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                if Date().timeIntervalSince(self.lastSync ?? .distantPast) > 60 { await self.syncNow() }
            }
        }
        // Snooze-Wecker und geplante Mails
        tickTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.tick() }
        }
        // Nach dem Ruhezustand sind alle Verbindungen tot → neu aufbauen
        wakeObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didWakeNotification, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.configureSessions()
                await self?.refresh()
            }
        }
        Notifier.requestAuthorization()
        Task {
            systemContacts = await SystemContacts.load()
            rebuildContacts()
        }
    }

    private func loadSettings() {
        if let list = Storage.load([Account].self, key: "accounts") {
            accounts = list
        } else if var old = Storage.load(Account.self, key: "account") {
            // Migration von Version 1 (ein Konto, globale Signatur)
            old.signature = UserDefaults.standard.string(forKey: "signature") ?? ""
            accounts = [old]
            persistAccounts()
            UserDefaults.standard.removeObject(forKey: "account")
        }
        applyingSync = true   // beim Laden keine Synchronisation anstoßen
        defer { applyingSync = false }
        snoozes = Storage.load([SnoozeEntry].self, key: "snoozes") ?? []
        snippets = Storage.load([Snippet].self, key: "snippets") ?? []
        rules = Storage.load([MailRule].self, key: "rules") ?? []
        blocked = Storage.load([String: TrustEntry].self, key: "blocked") ?? [:]
        senderCats = Storage.load([String: SenderCategory].self, key: "senderCats") ?? [:]
        folderColors = Storage.load([String: FolderColor].self, key: "folderColors") ?? [:]
        addressBook = Storage.load([AddressCard].self, key: "addressBook") ?? []
        scheduled = Storage.loadOutbox()
        if UserDefaults.standard.object(forKey: "blockRemoteImages") != nil {
            blockRemoteImages = UserDefaults.standard.bool(forKey: "blockRemoteImages")
        }
        if let t = Storage.load([String: TrustEntry].self, key: "trusted") {
            trusted = t
        } else {
            // Migration: frühere einfache Liste
            var t: [String: TrustEntry] = [:]
            for a in UserDefaults.standard.stringArray(forKey: "trustedSenders") ?? [] {
                t[a] = TrustEntry(deleted: false, updatedAt: 1)
            }
            trusted = t
        }
        // Snoozes älterer Version kennen die Konto-Adresse noch nicht
        if snoozes.contains(where: { $0.accountEmail.isEmpty }) {
            var list = snoozes
            for i in list.indices where list[i].accountEmail.isEmpty {
                list[i].accountEmail = account(list[i].accountID)?.email.lowercased() ?? ""
            }
            snoozes = list
        }
        if UserDefaults.standard.object(forKey: "offlineEnabled") != nil {
            offlineEnabled = UserDefaults.standard.bool(forKey: "offlineEnabled")
        }
        offlineKeep = OfflineCache.keep
        offlineLimitMB = OfflineCache.limitMB
        // Start immer mit Smart Inbox über alle Konten (kein Kontofilter aus der letzten Sitzung)
        accountFilter = nil
        let lines = UserDefaults.standard.integer(forKey: "listLines")
        listLines = (1...3).contains(lines) ? lines : 2
        sortAscending = UserDefaults.standard.bool(forKey: "sortAscending")
        syncEnabled = UserDefaults.standard.bool(forKey: "syncEnabled")
        syncAccountEmail = UserDefaults.standard.string(forKey: "syncAccountEmail") ?? ""
        lastSync = UserDefaults.standard.object(forKey: "lastSync") as? Date
    }

    private func persistAccounts() {
        Storage.save(accounts, key: "accounts")
    }

    // MARK: - Konten

    func account(_ id: UUID?) -> Account? {
        guard let id else { return nil }
        return accounts.first { $0.id == id }
    }

    func accountLabel(_ id: UUID) -> String {
        guard let a = account(id) else { return "" }
        return a.displayName.isEmpty ? a.email : a.displayName
    }

    /// Gültiger Konto-Filter (nil, wenn „Alle Konten“ oder das Konto nicht mehr existiert)
    var activeFilter: UUID? {
        guard let f = accountFilter, account(f) != nil else { return nil }
        return f
    }

    private func accountFilterChanged() {
        if let f = activeFilter, case .folder(let a, _) = sidebar, a != f { sidebar = .smart }
        // 2.46: Konto wählen zeigt den ganzen Posteingang – vorher blieb eine gefilterte Ansicht
        // (Kategorie, Ungelesen, Markiert) stehen, Persönlich-Mails des Kontos fehlten scheinbar
        if let item = sidebar, item.isFilteredInbox { sidebar = .smart }
        if searchResults != nil { searchResults = nil }
        if let f = activeFilter, let sel = selectedID, sel.account != f { selectedID = nil }
    }

    func unreadCount(for account: UUID) -> Int {
        counts.unreadByAccount[account] ?? 0
    }

    var totalUnread: Int { counts.totalUnread }

    /// Alle Zähler der Seitenleiste in einem Durchlauf (statt einmal pro Zeile über alle Mails)
    private var counts: ViewCounts {
        if countCacheGen == dataGen && Date().timeIntervalSince(countCacheTime) < 30 { return countCache }
        var c = ViewCounts()
        let filter = activeFilter
        for acc in inbox.keys {
            let inView = filter == nil || filter == acc
            for m in inbox[acc] ?? [] {
                if isSnoozed(m) {
                    if inView { c.snoozed += 1 }
                    continue
                }
                if m.isRead { continue }
                c.totalUnread += 1
                c.unreadByAccount[acc, default: 0] += 1
                if m.category == .personal { c.personalUnread += 1 }
                if inView {
                    c.unreadInView += 1
                    c.unreadByCategory[m.category, default: 0] += 1
                }
            }
        }
        countCache = c
        countCacheGen = dataGen
        countCacheTime = Date()
        return c
    }

    func saveAccount(_ input: Account, password: String) {
        var acc = input
        let prev = accounts.first { $0.id == acc.id }
        if let p = prev, p.fromSync, !password.isEmpty {
            // Konto kam über die Synchronisation: Passwort nur an bestätigte Server schicken
            let alert = NSAlert()
            alert.messageText = "Serverdaten vom anderen Gerät prüfen"
            alert.informativeText = "Dieses Konto wurde über die Synchronisation angelegt. Dein Passwort wird an diese Server geschickt:\n\n"
                + "IMAP: \(acc.imapHost):\(acc.imapPort)\nSMTP: \(acc.smtpHost):\(acc.smtpPort)\n\n"
                + "Nur speichern, wenn das deine Server sind."
            alert.addButton(withTitle: "Abbrechen")
            alert.addButton(withTitle: "Stimmt, speichern")
            guard alert.runModal() == .alertSecondButtonReturn else { return }
        }
        if !password.isEmpty { acc.fromSync = false }
        acc.updatedAt = nowMillis()
        let sigChanged = prev == nil || prev?.signature != acc.signature || prev?.signatureHtml != acc.signatureHtml
        if sigChanged {
            // Neues Konto ohne Signatur überschreibt keine synchronisierte Signatur
            acc.sigUpdatedAt = (acc.signature.isEmpty && acc.signatureHtml.isEmpty) ? 0 : nowMillis()
        }
        // Farbe hat eigenen Zeitstempel (wird im Editor sofort per setAccountColor gespeichert)
        if let p = prev, p.color == acc.color {
            acc.colorUpdatedAt = p.colorUpdatedAt
        } else if (prev?.color ?? "") != acc.color {
            acc.colorUpdatedAt = nowMillis()
        }
        var deleted = deletedAccounts
        deleted[acc.email.lowercased()] = nil
        deletedAccounts = deleted
        if !password.isEmpty { Keychain.set(password, for: acc.keychainKey) }
        if let i = accounts.firstIndex(where: { $0.id == acc.id }) {
            accounts[i] = acc
        } else {
            accounts.append(acc)
        }
        persistAccounts()
        inbox[acc.id] = nil
        folders[acc.id] = nil
        startSession(for: acc)
        Task { await refresh() }
        scheduleSync()
    }

    func removeAccount(_ id: UUID) {
        if let gone = account(id) {
            var deleted = deletedAccounts
            deleted[gone.email.lowercased()] = nowMillis()
            deletedAccounts = deleted
        }
        sessions[id]?.idle.stop()
        sessions[id] = nil
        inbox[id] = nil
        folders[id] = nil
        pushActive[id] = nil
        snoozes.removeAll { $0.accountID == id }
        scheduled.removeAll { $0.accountID == id }
        accounts.removeAll { $0.id == id }
        persistAccounts()
        if case .folder(let a, _) = sidebar, a == id { sidebar = .smart }
        if selectedID?.account == id { selectedID = nil }
        searchResults = nil
        scheduleSync()
    }

    func testConnection(_ acc: Account, password: String) async throws {
        let c = IMAPClient(host: acc.imapHost, port: acc.imapPort)
        do {
            try await c.connect()
            try await c.login(user: acc.username, password: password)
            await c.logout()
        } catch {
            c.close()
            throw error
        }
    }

    private func configureSessions() {
        for s in sessions.values { s.idle.stop() }
        sessions = [:]
        pushActive = [:]
        for acc in accounts { startSession(for: acc) }
    }

    private func startSession(for acc: Account) {
        sessions[acc.id]?.idle.stop()
        sessions[acc.id] = nil
        pushActive[acc.id] = false
        guard let pw = Keychain.get(acc.keychainKey) else { return }
        let s = AccountSession(account: acc, password: pw)
        sessions[acc.id] = s
        let id = acc.id
        s.idle.start(
            onStatus: { [weak self] active in await self?.setPush(id, active) },
            onChange: { [weak self] in await self?.refresh() })
    }

    private func setPush(_ id: UUID, _ active: Bool) {
        if pushActive[id] != active { pushActive[id] = active }
    }

    /// Ist ein Passwort hinterlegt? (Eine Sitzung gibt es nur mit Passwort – ohne Schlüsselbund-Abfrage
    /// bei jedem Neuzeichnen der Seitenleiste)
    func hasPassword(_ id: UUID) -> Bool { sessions[id] != nil }

    // MARK: - Ansicht

    /// Posteingänge aller Konten
    var everyInboxMessage: [MailMessage] { inbox.values.flatMap { $0 } }

    /// Posteingänge für die Ansicht – alle Konten oder nur das ausgewählte
    var allInboxMessages: [MailMessage] {
        if let f = activeFilter { return inbox[f] ?? [] }
        return everyInboxMessage
    }

    var currentFolderInfo: MailFolder? {
        guard case .folder(let a, let p) = sidebar else { return nil }
        return folders[a]?.first { $0.path == p }
    }

    var visibleMessages: [MailMessage] {
        // Snoozes laufen zeitabhängig ab → spätestens alle 30 s neu berechnen
        if visibleCacheGen == dataGen && Date().timeIntervalSince(visibleCacheTime) < 30 { return visibleCache }
        let result = computeVisibleMessages()
        visibleCache = result
        visibleCacheVersion &+= 1
        visibleCacheGen = dataGen
        visibleCacheTime = Date()
        return result
    }

    private func computeVisibleMessages() -> [MailMessage] {
        if let r = searchResults { return ordered(r) }
        var list: [MailMessage]
        switch sidebar ?? .smart {
        case .folder:
            list = folderMessages
        case .spam, .sent, .trash:
            // Spam/Gesendet/Papierkorb aller Konten (bzw. des gewählten Kontos)
            let onlyAccount = activeFilter
            list = folderMessages.filter { onlyAccount == nil || $0.accountID == onlyAccount }
        case .snoozed:
            list = allInboxMessages.filter { isSnoozed($0) }
        case .scheduled, .contacts:
            list = []
        case .smart:
            list = allInboxMessages.filter { !isSnoozed($0) }
        case .unread:
            let keep = unreadKeep
            list = allInboxMessages.filter { !isSnoozed($0) && (!$0.isRead || keep.contains($0.key)) }
        case .flagged:
            list = allInboxMessages.filter { !isSnoozed($0) && $0.isFlagged }
        case .category(let c):
            list = allInboxMessages.filter { !isSnoozed($0) && $0.category == c }
        }
        let q = searchText.trimmingCharacters(in: .whitespaces)
        if !q.isEmpty {
            // Ohne lowercased()-Kopien je Mail und Tastendruck
            let opts: String.CompareOptions = [.caseInsensitive, .diacriticInsensitive]
            list = list.filter {
                $0.subject.range(of: q, options: opts) != nil
                    || $0.fromName.range(of: q, options: opts) != nil
                    || $0.fromAddress.range(of: q, options: opts) != nil
            }
        }
        return ordered(list)
    }

    /// Smart Inbox nach Kategorien gruppiert (einmal je Datenstand statt bei jedem Neuzeichnen)
    var smartGroups: [MailCategory: [MailMessage]] {
        let all = visibleMessages
        if smartGroupsGen == visibleCacheVersion { return smartGroupsCache }
        var g: [MailCategory: [MailMessage]] = [:]
        for m in all { g[m.category, default: []].append(m) }
        smartGroupsCache = g
        smartGroupsGen = visibleCacheVersion
        return g
    }

    /// Wird die Smart Inbox gerade nach Kategorien gruppiert angezeigt?
    var showsSmartGroups: Bool { searchResults == nil && sidebar == .smart && searchText.isEmpty }

    /// Mails in der Reihenfolge, in der die Liste sie zeigt (Smart Inbox: Kategorie für Kategorie)
    var displayedMessages: [MailMessage] {
        guard showsSmartGroups else { return visibleMessages }
        let g = smartGroups
        // eingeklappte Gruppen auslassen (Pfeiltasten, nächste Mail nach Löschen)
        return Self.smartOrder.filter { $0 == .personal || expandedGroups.contains($0) }.flatMap { g[$0] ?? [] }
    }

    private func withoutRemoved(_ list: [MailMessage]) -> [MailMessage] {
        let queued = pendingOps.isEmpty ? Set<MessageKey>() : Set(pendingOps.filter { $0.removes }.map { $0.key })
        guard !recentlyRemoved.isEmpty || !queued.isEmpty else { return list }
        return list.filter { recentlyRemoved[$0.key] == nil && !queued.contains($0.key) }
    }

    private func notePending(_ key: MessageKey, read: Bool? = nil, flagged: Bool? = nil) {
        var p = pendingFlags[key] ?? PendingFlags()
        if let read { p.read = read }
        if let flagged { p.flagged = flagged }
        p.at = Date()
        pendingFlags[key] = p
    }

    /// Abgerufene Liste mit dem lokalen Stand abgleichen: gelöschte/verschobene Mails ausblenden,
    /// gerade geänderte Flags (2 Minuten) beibehalten
    private func withLocalState(_ list: [MailMessage]) -> [MailMessage] {
        var out = withoutRemoved(list)
        guard !pendingFlags.isEmpty else { return out }
        let now = Date()
        pendingFlags = pendingFlags.filter { now.timeIntervalSince($0.value.at) < 120 }
        guard !pendingFlags.isEmpty else { return out }
        for i in out.indices {
            guard let p = pendingFlags[out[i].key] else { continue }
            if let r = p.read { out[i].isRead = r }
            if let f = p.flagged { out[i].isFlagged = f }
        }
        return out
    }

    /// Persönlich für Kontakte/eigene Konten, danach die selbst gewählte Kategorie je Absender (2.40)
    func applyCategories(_ msgs: inout [MailMessage]) {
        let personal = personalSenders
        var chosen: [String: MailCategory] = [:]
        for (addr, e) in senderCats where !e.deleted {
            if let c = MailCategory(rawValue: e.category) { chosen[addr] = c }
        }
        for i in msgs.indices {
            let addr = Categorizer.normalized(msgs[i].fromAddress)
            var cat = msgs[i].category
            if personal.contains(addr) { cat = .personal }
            if let c = chosen[addr] { cat = c }
            if msgs[i].category != cat { msgs[i].category = cat }
        }
    }

    /// Kategorien in allen geladenen Posteingängen neu anwenden (nach Ziehen oder Sync)
    func recategorizeAll() {
        for id in Array(inbox.keys) {
            guard var list = inbox[id] else { continue }
            let before = list
            applyCategories(&list)
            if list != before { inbox[id] = list }
        }
        if case .folder(_, let p) = sidebar, p == "INBOX" {
            var list = folderMessages
            applyCategories(&list)
            if list != folderMessages { folderMessages = list }
        }
    }

    /// 2.40: Mails auf eine Kategorie gezogen → Absender landet künftig dort; Mails aus anderen Ordnern
    /// kommen zurück in den Posteingang
    @discardableResult
    func handleCategoryDrop(_ tokens: [String], category: MailCategory) -> Bool {
        var found: [MailMessage] = []
        for t in tokens.flatMap({ $0.components(separatedBy: "\n") }) {
            let parts = t.components(separatedBy: "|")
            guard parts.count >= 4, parts[0] == "simplemail-move", let srcAccount = UUID(uuidString: parts[1]),
                  let uid = UInt32(parts[2]) else { continue }
            let src = parts[3...].joined(separator: "|")
            let key = MessageKey(account: srcAccount, folder: src, uid: uid)
            guard let m = message(for: key) else { continue }
            found.append(m)
        }
        if found.isEmpty { return false }
        var cats = senderCats
        let stamp = nowMillis()
        for m in found {
            let addr = Categorizer.normalized(m.fromAddress)
            if addr.contains("@") { cats[addr] = SenderCategory(category: category.rawValue, deleted: false, updatedAt: stamp) }
        }
        if cats != senderCats { senderCats = cats }
        for m in found where m.folder != "INBOX" {
            Task { await self.move(m, toAccount: m.accountID, folder: "INBOX") }
        }
        recategorizeAll()
        return true
    }

    /// Absender mit fester Kategorie (Einstellungen), sortiert
    var fixedCategorySenders: [String] {
        senderCats.filter { !$0.value.deleted }.map { $0.key }.sorted()
    }

    func senderCategoryTitle(_ address: String) -> String {
        guard let e = senderCats[address] else { return "" }
        return MailCategory(rawValue: e.category)?.title ?? e.category
    }

    /// Feste Kategorie eines Absenders wieder aufheben (Einstellungen)
    func removeSenderCategory(_ address: String) {
        senderCats[address] = SenderCategory(category: "", deleted: true, updatedAt: nowMillis())
    }

    /// Absender aus dem Adressbuch und eigene Konten landen immer in „Persönlich“
    private var personalSenders: Set<String> {
        var set = Set(accounts.map { Categorizer.normalized($0.email) })
        for card in addressBook where !card.deleted {
            for e in card.emails {
                let v = Categorizer.normalized(e)
                if v.contains("@") { set.insert(v) }
            }
        }
        return set
    }

    /// Nach Datum sortieren – Richtung gemäß Einstellung
    func ordered(_ list: [MailMessage]) -> [MailMessage] {
        // Sortierdatum nur einmal je Mail bestimmen (statt bei jedem Vergleich erneut nachzuschlagen)
        let dates = list.map { sortDate($0) }
        let asc = sortAscending
        let order = list.indices.sorted { asc ? dates[$0] < dates[$1] : dates[$0] > dates[$1] }
        return order.map { list[$0] }
    }

    var selectedMessage: MailMessage? {
        guard let key = selectedID else { return nil }
        return message(for: key)
    }

    func message(for key: MessageKey) -> MailMessage? {
        // Nachschlagen über einen Index je Datenstand (vorher bei jedem Neuzeichnen lineare Suche)
        if messageIndexGen != dataGen {
            var idx: [MessageKey: MailMessage] = [:]
            for list in inbox.values { for m in list { idx[m.key] = m } }
            for m in folderMessages where idx[m.key] == nil { idx[m.key] = m }
            for m in searchResults ?? [] where idx[m.key] == nil { idx[m.key] = m }
            messageIndex = idx
            messageIndexGen = dataGen
        }
        return messageIndex[key]
    }

    func unreadCount(_ category: MailCategory? = nil) -> Int {
        guard let category else { return counts.unreadInView }
        return counts.unreadByCategory[category] ?? 0
    }

    var snoozedCount: Int { counts.snoozed }

    var canLoadMore: Bool {
        if let role = sidebar?.roleFolder {
            return roleTargets(role).contains { (sessions[$0.account]?.lowestSeq[$0.path] ?? 1) > 1 }
        }
        if case .folder(let a, let p) = sidebar { return (sessions[a]?.lowestSeq[p] ?? 1) > 1 }
        return sessions.values.contains { ($0.lowestSeq["INBOX"] ?? 1) > 1 }
    }

    private func updateBadge() {
        let n = counts.personalUnread
        let label: String? = n > 0 ? "\(n)" : nil
        if NSApp?.dockTile.badgeLabel != label { NSApp?.dockTile.badgeLabel = label }
    }

    private func sidebarChanged(from old: SidebarItem?) {
        guard old != sidebar else { return }
        searchResults = nil
        if !unreadKeep.isEmpty { unreadKeep = [] }
        if let role = sidebar?.roleFolder {
            // Spam/Gesendet/Papierkorb aller Konten: Ordnerliste ggf. erst laden, damit die Ordner bekannt sind,
            // dann gespeicherte Kopfzeilen sofort zeigen und nur diese Ordner abgleichen
            folderMessages = []
            selectedID = nil
            let target = sidebar
            Task {
                if self.folders.count < self.sessions.count { await self.loadFolders() }
                var shown: [MailMessage] = []
                for t in self.roleTargets(role) {
                    let acc = t.account
                    let path = t.path
                    let cached = await Task.detached(priority: .userInitiated) { OfflineCache.readHeaders(acc, path) }.value
                    if let cached {
                        self.cachedValidity["\(acc)|\(path)"] = cached.uidValidity
                        self.cachedLow["\(acc)|\(path)"] = cached.low
                        shown += cached.messages
                    }
                }
                if self.sidebar == target, self.folderMessages.isEmpty, !shown.isEmpty {
                    self.folderMessages = self.withLocalState(shown)
                }
                await self.refreshRoleView()
            }
        } else if case .folder(let a, let p) = sidebar {
            selectedID = nil
            if p == "INBOX" {
                // Posteingang eines Kontos: schon geladene Mails sofort zeigen
                folderMessages = inbox[a] ?? []
                Task { await self.refreshSelectedFolder() }
            } else {
                folderMessages = []
                // Gespeicherte Kopfzeilen im Hintergrund lesen, dann nur diesen Ordner abgleichen.
                // Vorher lief der Abruf parallel ohne die gespeicherten Kopfzeilen (alles neu geladen)
                // und wartete auf einen laufenden Gesamtabruf aller Konten.
                let target = sidebar
                Task {
                    let cached = await Task.detached(priority: .userInitiated) { OfflineCache.readHeaders(a, p) }.value
                    if let cached, self.sidebar == target, self.folderMessages.isEmpty {
                        self.cachedValidity["\(a)|\(p)"] = cached.uidValidity
                        self.cachedLow["\(a)|\(p)"] = cached.low
                        self.folderMessages = cached.messages
                    }
                    await self.refreshSelectedFolder()
                }
            }
        } else if case .folder = old {
            folderMessages = []
            selectedID = nil
        } else if old?.roleFolder != nil {
            folderMessages = []
            selectedID = nil
        }
    }

    // MARK: - Abrufen

    func refresh() async {
        guard !sessions.isEmpty else { return }
        if isLoading {
            pendingRefresh = true
            return
        }
        isLoading = true
        isOffline = false
        // 0. Ohne Verbindung liegengebliebene Aktionen zuerst nachholen (sonst käme z. B. Gelöschtes zurück)
        await flushPendingOps()

        // Posteingänge aller Konten gleichzeitig abrufen. 2.30: jedes Konto wird übernommen, sobald es fertig ist –
        // vorher wartete die Übernahme in fester Reihenfolge, ein langsames Konto hielt alle anderen auf
        // (Smart Inbox/Kontoansicht unvollständig, nur der direkt gewählte Posteingang war aktuell)
        var inboxJobs: [Task<Void, Never>] = []
        for s in sessions.values {
            let existing = inbox[s.account.id] ?? []
            let firstLoad = inbox[s.account.id] == nil
            inboxJobs.append(Task { await self.refreshInbox(s, existing: existing, firstLoad: firstLoad) })
        }

        // 1. Gewählter Ordner (sichtbar) zuerst
        await refreshSelectedFolder()

        // 1b. Gemeinsame Ordner „Spam“, „Gesendet“, „Papierkorb“: die Ordner dieser Rolle aller Konten zusammen
        if sidebar?.roleFolder != nil {
            await refreshRoleView()
        }

        // 2. Posteingänge aller Konten (Smart Inbox, Zähler, Mitteilungen)
        for job in inboxJobs { await job.value }
        rebuildContacts()

        isLoading = false
        if pendingRefresh {
            pendingRefresh = false
            await refresh()
        } else {
            await loadFoldersIfDue()
            await prefetchBodies()
        }
    }

    /// 2.42: gemeinsamen Ordner (Spam/Gesendet/Papierkorb) abgleichen – jedes Konto erscheint, sobald es fertig ist
    func refreshRoleView() async {
        guard let item = sidebar, let role = item.roleFolder else { return }
        var collected: [MailMessage] = []
        var done = Set<UUID>()
        for t in roleTargets(role) {
            guard let s = sessions[t.account] else { continue }
            let before = folderMessages.filter { $0.accountID == t.account && $0.folder == t.path }
            do {
                collected += try await fetchFolder(s, t.path, existing: before)
            } catch {
                collected += before
                report(error, account: s.account)
            }
            done.insert(t.account)
            guard sidebar == item else { return }
            // Mails der noch nicht abgeglichenen Konten (z. B. aus dem Zwischenspeicher) stehen lassen
            let waiting = folderMessages.filter { !done.contains($0.accountID) }
            let shown = withLocalState(waiting + collected)
            if folderMessages != shown { folderMessages = shown }
        }
    }

    /// Ordner einer Rolle in den sichtbaren Konten (alle bzw. das gefilterte)
    func roleTargets(_ role: FolderRole) -> [MailFolderRef] {
        accounts.filter { activeFilter == nil || $0.id == activeFilter }.compactMap { a in
            rolePath(a.id, role).map { MailFolderRef(account: a.id, path: $0) }
        }
    }

    /// Posteingang eines Kontos abrufen und sofort übernehmen (Regeln, Spam, Kategorien, Mitteilungen)
    private func refreshInbox(_ s: AccountSession, existing: [MailMessage], firstLoad: Bool) async {
        let id = s.account.id
        let known = existing.map(\.uid).max() ?? 0
        inboxBusy.insert(id)
        defer { inboxBusy.remove(id) }
        do {
            var msgs = try await fetchFolder(s, "INBOX", existing: existing)
            // Regeln auf neu eingegangene E-Mails anwenden
            let fresh = newSinceLastRuleCheck(id, uidValidity: s.uidValidity["INBOX"] ?? "", msgs)
            if !fresh.isEmpty {
                await moveBlocked(s, &msgs, only: fresh)
                await moveSpam(s, &msgs, only: fresh)
                await applyRules(s, to: &msgs, only: fresh)
            }
            // Absender aus dem Adressbuch / eigene Konten → Persönlich; selbst gewählte Kategorie hat Vorrang
            applyCategories(&msgs)
            // Nur bei echten Änderungen veröffentlichen – sonst zeichnet jeder Abruf/Push alles neu
            msgs = withLocalState(msgs)
            if inbox[id] != msgs { inbox[id] = msgs }
            if !firstLoad {
                let fresh = msgs.filter {
                    $0.uid > known && !$0.isRead && $0.category == .personal && !isSnoozed($0)
                }
                Notifier.notify(fresh)
            }
        } catch {
            report(error, account: s.account)
        }
    }

    /// Start ohne Netz (WLAN noch nicht da, Anmeldung beim Server scheitert): nicht 5 Minuten auf den
    /// nächsten regelmäßigen Abruf warten, sondern bald erneut versuchen
    private func retryStartupRefresh() async {
        for delay in [5, 15, 30, 60] {
            guard isOffline else { return }
            try? await Task.sleep(nanoseconds: UInt64(delay) * 1_000_000_000)
            await refresh()
        }
    }

    /// Nur den gewählten Ordner abgleichen – wartet nicht auf einen laufenden Gesamtabruf
    func refreshSelectedFolder() async {
        guard case .folder(let a, let p) = sidebar, let s = sessions[a] else { return }
        do {
            var msgs = try await fetchFolder(s, p, existing: folderMessages)
            if case .folder(let a2, let p2) = sidebar, a2 == a, p2 == p {
                if p == "INBOX" { applyCategories(&msgs) }
                let shown = withLocalState(msgs)
                if folderMessages != shown { folderMessages = shown }
                // 2.30: Posteingang eines Kontos = dieselben Mails wie in Smart Inbox/Kontoansicht
                // (läuft für dieses Konto gerade refreshInbox, übernimmt das – dort laufen auch Regeln und Spamfilter;
                // ein hängendes anderes Konto hält die Übernahme nicht mehr auf)
                if p == "INBOX", !inboxBusy.contains(a), inbox[a] != shown { inbox[a] = shown }
                if let sel = selectedID, sel.account == a, sel.folder == p, !msgs.contains(where: { $0.key == sel }) {
                    selectedID = nil
                }
            }
        } catch {
            report(error, account: s.account)
        }
    }

    /// Lädt die neuesten Posteingangs-Mails im Hintergrund in die Offline-Ablage
    private func prefetchBodies() async {
        guard offlineEnabled, !isOffline else { return }
        for s in sessions.values {
            let id = s.account.id
            let newestKeys = (inbox[id] ?? []).sorted { $0.date > $1.date }.prefix(offlineKeep).map(\.key)
            let withoutPreview = Set(newestKeys.filter { previews[$0] == nil })
            // Dateizugriffe und Vorschauen komplett im Hintergrund (vorher im Hauptthread → Ruckler nach jedem Abruf)
            let scan = await Task.detached(priority: .utility) { () -> PrefetchScan in
                var out = PrefetchScan()
                for key in newestKeys {
                    if OfflineCache.hasBody(key) {
                        if withoutPreview.contains(key), let raw = OfflineCache.readBody(key) {
                            out.found[key.uid] = OfflineCache.makePreview(raw: raw)
                        }
                    } else {
                        out.missing.append(key.uid)
                    }
                }
                return out
            }.value
            var found = scan.found
            let missing = scan.missing
            var start = 0
            while start < missing.count {
                let chunk = Array(missing[start..<min(start + 25, missing.count)])
                start += 25
                do {
                    let got = try await s.background.perform {
                        (c: IMAPClient, _: SpecialFolders) async throws -> [(UInt32, Data)] in
                        try await c.ensureSelected("INBOX")
                        return try await c.fetchRawMany(chunk)
                    }
                    let previewsOfChunk = await Task.detached(priority: .utility) { () -> [UInt32: String] in
                        var out: [UInt32: String] = [:]
                        for (uid, data) in got {
                            OfflineCache.writeBody(MessageKey(account: id, folder: "INBOX", uid: uid), data)
                            out[uid] = OfflineCache.makePreview(raw: data)
                        }
                        return out
                    }.value
                    found.merge(previewsOfChunk) { a, _ in a }
                } catch {
                    break
                }
            }
            if !found.isEmpty {
                OfflineCache.savePreviews(id, "INBOX", found)
                var all = previews
                for (uid, text) in found { all[MessageKey(account: id, folder: "INBOX", uid: uid)] = text }
                previews = all
            }
        }
        OfflineCache.enforceLimit()
    }

    private func isConnectionError(_ error: Error) -> Bool {
        if let m = error as? MailError {
            if case .connectionClosed = m { return true }
            return false
        }
        let domain = (error as NSError).domain
        return domain == NSURLErrorDomain || domain == NSPOSIXErrorDomain || domain == "kCFErrorDomainCFNetwork"
    }

    private func report(_ error: Error, account: Account) {
        if isConnectionError(error) {
            isOffline = true
            return
        }
        errorMessage = accounts.count > 1
            ? "\(account.email): \(error.localizedDescription)"
            : error.localizedDescription
    }

    /// Lädt die Kopfdaten eines Ordners. Sind schon Mails bekannt (Speicher oder Offline-Ablage),
    /// werden nur UID + Flags abgeglichen und ausschließlich neue Kopfzeilen geholt.
    private func fetchFolder(_ s: AccountSession, _ path: String, existing: [MailMessage]) async throws -> [MailMessage] {
        let page = pageSize
        let id = s.account.id
        let low = s.lowestSeq[path] ?? cachedLow["\(id)|\(path)"]
        let knownValidity = s.uidValidity[path] ?? cachedValidity["\(id)|\(path)"] ?? ""
        let isInbox = path == "INBOX"
        let gmail = Gmail.isGmail(s.account)
        let result = try await s.service.perform {
            (c: IMAPClient, _: SpecialFolders) async throws -> FolderFetch in
            let exists = try await c.select(path)
            guard exists > 0 else { return FolderFetch(messages: [], low: 1, validity: c.uidValidity) }
            var from = max(1, exists - page + 1)
            if let low { from = min(from, max(1, low)) }
            from = max(from, exists - 2000 + 1)   // Obergrenze: 2000 Mails pro Ordner
            if !existing.isEmpty, !knownValidity.isEmpty, knownValidity == c.uidValidity {
                let states = try await c.fetchFlags(from: from, to: exists)
                var byUID: [UInt32: MailMessage] = [:]
                for m in existing { byUID[m.uid] = m }
                // Posteingang: Mails mit älterer Kategorie-Einteilung einmal neu einordnen
                let missing = states.filter {
                    guard let old = byUID[$0.uid] else { return true }
                    return isInbox && old.catVersion != Categorizer.version
                }.map(\.uid)
                if !missing.isEmpty {
                    var fetched = try await c.fetchUIDs(missing, account: id, folder: path)
                    if isInbox && gmail { await Self.applyGmailCategories(c, &fetched) }
                    for m in fetched { byUID[m.uid] = m }
                }
                var out: [MailMessage] = []
                out.reserveCapacity(states.count)
                for st in states {
                    guard var m = byUID[st.uid] else { continue }
                    m.isRead = st.isRead
                    m.isFlagged = st.isFlagged
                    out.append(m)
                }
                return FolderFetch(messages: out, low: from, validity: c.uidValidity)
            }
            var msgs = try await c.fetchRange(from: from, to: exists, account: id, folder: path)
            if isInbox && gmail { await Self.applyGmailCategories(c, &msgs) }
            return FolderFetch(messages: msgs, low: from, validity: c.uidValidity)
        }
        s.lowestSeq[path] = result.low
        s.uidValidity[path] = result.validity
        cachedValidity["\(id)|\(path)"] = result.validity
        // Offline-Ablage im Hintergrund schreiben – nur wenn sich etwas geändert hat
        let msgs = result.messages, validity = result.validity, lowest = result.low
        if msgs != existing || validity != knownValidity {
            Task.detached(priority: .utility) {
                OfflineCache.writeHeaders(id, path, uidValidity: validity, low: lowest, messages: msgs)
            }
        }
        if !previewsLoaded.contains("\(id)|\(path)") {
            previewsLoaded.insert("\(id)|\(path)")
            await loadPreviews(id, path)
        }
        return result.messages
    }

    /// Gmail ordnet selbst ein (Allgemein/Updates/Werbung/Soziale Netzwerke/Foren) – diese Einteilung übernehmen
    static func applyGmailCategories(_ c: IMAPClient, _ list: inout [MailMessage]) async {
        guard !list.isEmpty, let cats = try? await c.gmailCategories(list.map(\.uid)), !cats.isEmpty else { return }
        for i in list.indices {
            if let cat = cats[list[i].uid] { list[i].category = cat }
        }
    }

    private func loadPreviews(_ account: UUID, _ folder: String) async {
        let stored = await Task.detached(priority: .utility) { OfflineCache.readPreviews(account, folder) }.value
        guard !stored.isEmpty else { return }
        var all = previews
        for (k, v) in stored {
            if let uid = UInt32(k) { all[MessageKey(account: account, folder: folder, uid: uid)] = v }
        }
        previews = all
    }

    private func storePreview(_ key: MessageKey, raw: Data) {
        let text = OfflineCache.makePreview(raw: raw)
        previews[key] = text
        OfflineCache.savePreviews(key.account, key.folder, [key.uid: text])
    }

    func loadMore() async {
        if let role = sidebar?.roleFolder {
            for t in roleTargets(role) {
                if let s = sessions[t.account], let low = s.lowestSeq[t.path] { s.lowestSeq[t.path] = max(1, low - pageSize) }
            }
        } else if case .folder(let a, let p) = sidebar, let s = sessions[a] {
            s.lowestSeq[p] = max(1, (s.lowestSeq[p] ?? 1) - pageSize)
        } else {
            for s in sessions.values {
                if let low = s.lowestSeq["INBOX"] { s.lowestSeq["INBOX"] = max(1, low - pageSize) }
            }
        }
        await refresh()
    }

    /// Ordnerliste und -zähler nach einem Abruf höchstens alle 3 Minuten neu laden
    /// (vorher nach jedem Abruf und jedem Push: ein STATUS-Befehl pro Ordner)
    private func loadFoldersIfDue() async {
        if !folders.isEmpty && Date().timeIntervalSince(lastFolderLoad) < 180 { return }
        await loadFolders()
    }

    func loadFolders() async {
        lastFolderLoad = Date()
        let wantJunk = spamFilterEnabled
        // Konten parallel; je Konto erst die Liste (sofort in der Seitenleiste), dann die Zähler
        let jobs = sessions.values.map { s in Task { await self.loadFolders(s, wantJunk: wantJunk) } }
        for job in jobs { await job.value }
    }

    private func loadFolders(_ s: AccountSession, wantJunk: Bool) async {
        let accID = s.account.id
        do {
            let fresh = try await s.background.perform {
                (c: IMAPClient, _: SpecialFolders) async throws -> [MailFolder] in
                var all = try await c.listFolders()
                // Spamfilter an, aber kein Spam-Ordner: gleich anlegen, damit er in der Seitenleiste steht
                if wantJunk && !all.contains(where: { $0.role == .junk }) {
                    if let made = try? await c.ensureJunkFolder(), made.created {
                        all = try await c.listFolders()
                    }
                }
                return all
            }
            // bisherige Zähler behalten, bis die neuen da sind
            let old = folders[accID] ?? []
            var list = fresh
            for i in list.indices {
                let p = list[i].path
                list[i].unread = old.first(where: { $0.path == p })?.unread ?? 0
            }
            if folders[accID] != list { folders[accID] = list }

            let paths = list.filter { f in
                f.selectable && f.role != .trash && f.role != .junk && f.role != .sent && !f.isAllMail && !f.isVirtual
            }.map(\.path)
            let counts = try await s.background.perform {
                (c: IMAPClient, _: SpecialFolders) async throws -> [String: Int] in
                var out: [String: Int] = [:]
                for p in paths { out[p] = (try? await c.unseenCount(p)) ?? 0 }
                return out
            }
            guard var now = folders[accID] else { return }
            for i in now.indices {
                if let n = counts[now[i].path] { now[i].unread = n }
            }
            if folders[accID] != now { folders[accID] = now }
        } catch {
            report(error, account: s.account)
        }
    }

    private func saveFolderCache() {
        var map: [String: [MailFolder]] = [:]
        for (k, v) in folders { map[k.uuidString] = v }
        Storage.save(map, key: "folderCache")
    }

    func loadBody(for message: MailMessage) async {
        let key = message.key
        // Sofort als gelesen anzeigen – Zähler warten nicht mehr, bis der Text geladen ist
        let wasUnread = !message.isRead
        if wasUnread {
            markReadLocally(key, true)
            // Sofort auch auf dem Server speichern (vorher erst nach dem Laden des Textes – bei langsamen
            // Konten oder einem Ladefehler blieb die Mail auf dem Server ungelesen)
            Task { await self.setRead(message, true) }
        }
        if bodies[key] == nil, let s = sessions[message.accountID] {
            do {
                let raw: Data
                if let cached = await Task.detached(priority: .userInitiated, operation: { OfflineCache.readBody(key) }).value {
                    raw = cached
                } else {
                    raw = try await s.service.perform {
                        (c: IMAPClient, _: SpecialFolders) async throws -> Data in
                        try await c.ensureSelected(key.folder)
                        return try await c.fetchRaw(uid: key.uid)
                    }
                    Task.detached(priority: .utility) { OfflineCache.writeBody(key, raw) }
                }
                // Zerlegen, Vorschau und Phishing-Prüfung im Hintergrund (große Anhänge blockieren sonst die Oberfläche)
                let own = accounts.map(\.email)
                let fromName = message.fromName, fromAddress = message.fromAddress
                let needPreview = previews[key] == nil
                let allowRemote = remoteImagesAllowed(message)
                let parsed = await Task.detached(priority: .userInitiated) {
                    () -> (headers: [String: String], content: MIME.Extracted, warnings: [String], unsub: UnsubscribeInfo?, preview: String?, prepared: String?, remote: Bool) in
                    let (headers, content) = MIME.extract(raw: raw)
                    let check = MailSecurity.analyze(fromName: fromName, fromAddress: fromAddress,
                                                     html: content.html, headers: headers, own: own)
                    let preview = needPreview ? OfflineCache.makePreview(raw: raw) : nil
                    // HTML (eingebettete Bilder als base64) und Prüfung auf externe Inhalte gleich hier
                    // aufbereiten – vorher lief beides beim ersten Anzeigen im Hauptthread
                    var prepared: String? = nil
                    var remote = false
                    if let html = content.html {
                        remote = HTMLTools.hasRemoteContent(html)
                        prepared = HTMLTools.prepare(html, attachments: content.attachments, allowRemote: allowRemote)
                    }
                    return (headers, content, check.warnings, check.unsubscribe, preview, prepared, remote)
                }.value
                if let html = parsed.content.html, let prepared = parsed.prepared {
                    if htmlCache.count > 20 { htmlCache.removeAll() }
                    htmlCache[key] = PreparedHTML(allowRemote: allowRemote, sourceLength: html.utf8.count, html: prepared)
                    if remoteCheckCache.count > 200 { remoteCheckCache.removeAll() }
                    remoteCheckCache[key] = parsed.remote
                }
                if let p = parsed.preview {
                    previews[key] = p
                    OfflineCache.savePreviews(key.account, key.folder, [key.uid: p])
                }
                let headers = parsed.headers
                let content = parsed.content
                let check = (warnings: parsed.warnings, unsubscribe: parsed.unsub)
                bodies[key] = MessageBody(
                    text: content.text,
                    html: content.html,
                    attachments: content.attachments,
                    cc: MIME.decodeHeader(headers["cc"] ?? ""),
                    calendar: content.calendar,
                    warnings: check.warnings,
                    unsubscribe: check.unsubscribe)
            } catch {
                report(error, account: s.account)
                return
            }
        }
    }

    // MARK: - Suche auf dem Server

    /// Erhöht sich bei jeder neuen Suche – ältere, noch laufende Suchen brechen dann ab
    private var searchGen = 0

    func serverSearch() async {
        let q = searchText.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return }
        searchGen &+= 1
        let gen = searchGen
        isSearching = true
        defer { if gen == searchGen { isSearching = false } }

        // Ordneransicht: nur dieser Ordner; sonst alle Ordner aller Konten (inkl. Gesendet),
        // ohne Papierkorb und Spam. Posteingang zuerst, damit die wichtigsten Treffer sofort da sind.
        var targets: [(AccountSession, String)] = []
        if case .folder(let a, let p) = sidebar, let s = sessions[a] {
            targets = [(s, p)]
        } else {
            for s in sessions.values {
                let list = (folders[s.account.id] ?? [])
                    .filter { $0.selectable && $0.role != .junk && $0.role != .trash }
                    .sorted { $0.role.rawValue < $1.role.rawValue }
                if list.isEmpty {
                    targets.append((s, "INBOX"))
                } else if let allMail = list.first(where: { $0.isAllMail }) {
                    // Gmail: „Alle Nachrichten“ enthält jede Mail (außer Papierkorb/Spam) – Labels einzeln
                    // zu durchsuchen dauerte lange und lieferte nur Dubletten
                    targets.append((s, "INBOX"))
                    targets.append((s, allMail.path))
                } else {
                    for f in list where !f.isVirtual { targets.append((s, f.path)) }
                }
            }
        }

        var results: [MailMessage] = []
        var seen = Set<String>()
        searchResults = []
        selectedID = nil
        for (s, path) in targets {
            if gen != searchGen || searchText.trimmingCharacters(in: .whitespaces) != q { return }
            let id = s.account.id
            do {
                let found = try await s.service.perform {
                    (c: IMAPClient, _: SpecialFolders) async throws -> [MailMessage] in
                    try await c.ensureSelected(path)
                    let uids = try await c.search(q)
                    // Die neuesten 150 Treffer pro Ordner
                    return try await c.fetchUIDs(Array(uids.sorted().suffix(150)), account: id, folder: path)
                }
                // Gmail: „Alle Nachrichten“ enthält auch Posteingang/Gesendet → Dubletten entfernen
                for m in found {
                    let k = "\(m.accountID)|\(m.messageID.isEmpty ? "\(m.folder)/\(m.uid)" : m.messageID)"
                    if seen.insert(k).inserted { results.append(m) }
                }
            } catch {
                report(error, account: s.account)
            }
            // Zwischenstand sofort anzeigen
            if gen == searchGen && searchText.trimmingCharacters(in: .whitespaces) == q {
                searchResults = results.sorted { $0.date > $1.date }
            }
        }
    }

    /// Ordnername für Suchtreffer außerhalb des Posteingangs (nil = Posteingang)
    func folderLabel(_ m: MailMessage) -> String? {
        if m.folder == "INBOX" { return nil }
        return folders[m.accountID]?.first { $0.path == m.folder }?.name ?? m.folder
    }

    // MARK: - Aktionen

    func setRead(_ m: MailMessage, _ read: Bool) async {
        markReadLocally(m.key, read)
        await run(PendingOp(m.key, .seen, on: read))
    }

    func toggleFlag(_ m: MailMessage) async {
        let flagged = !m.isFlagged
        notePending(m.key, flagged: flagged)
        updateLocally(m.key) { $0.isFlagged = flagged }
        await run(PendingOp(m.key, .flagged, on: flagged))
    }

    // MARK: Mehrfachauswahl

    var selectedMessages: [MailMessage] {
        selection.compactMap { message(for: $0) }
    }

    enum BulkAction { case delete, archive, read(Bool), flag(Bool), move(String), moveTo(UUID, String), spam }

    func bulk(_ action: BulkAction) async {
        var list = selectedMessages
        guard !list.isEmpty else { return }
        if case .move = action, Set(list.map(\.accountID)).count > 1 {
            errorMessage = "Bitte ein Zielkonto wählen – die Auswahl enthält Mails mehrerer Konten."
            return
        }
        if case .archive = action {
            list = list.filter { m in folders[m.accountID]?.first(where: { f in f.path == m.folder })?.role != .archive }
        }
        selection = []
        for m in list {
            switch action {
            case .delete: await delete(m)
            case .archive: await archive(m)
            case .read(let on): if m.isRead != on { await setRead(m, on) }
            case .flag(let on): if m.isFlagged != on { await toggleFlag(m) }
            case .move(let target): await move(m, to: target)
            case .moveTo(let acc, let target): await move(m, toAccount: acc, folder: target, refreshAfter: false)
            case .spam: await markSpam(m, block: nil)
            }
        }
        if case .moveTo = action { await refresh() }
    }

    func archive(_ m: MailMessage) async {
        let role = folders[m.accountID]?.first { $0.path == m.folder }?.role
        if role == .archive {
            errorMessage = "Die E-Mail liegt bereits im Archiv."
            return
        }
        removeLocally(m)
        await run(PendingOp(m.key, .archive))
    }

    /// In einen anderen Ordner desselben Kontos verschieben (Ziehen & Ablegen, Menü)
    func move(_ m: MailMessage, to target: String) async {
        guard target != m.folder else { return }
        removeLocally(m)
        await run(PendingOp(m.key, .move, target: target))
    }

    /// In einen Ordner eines beliebigen Kontos verschieben.
    /// Anderes Konto: Nachricht vollständig laden, im Zielkonto ablegen (APPEND), erst danach im Quellkonto löschen.
    func move(_ m: MailMessage, toAccount target: UUID, folder: String, refreshAfter: Bool = true) async {
        if target == m.accountID {
            await move(m, to: folder)
            return
        }
        guard let src = sessions[m.accountID], let dst = sessions[target] else { return }
        let key = m.key
        var flags = [String]()
        if m.isRead { flags.append("\\Seen") }
        if m.isFlagged { flags.append("\\Flagged") }
        let flagList = flags.joined(separator: " ")

        // 1. Originalnachricht holen (Offline-Ablage, sonst Server)
        let raw: Data
        do {
            if let cached = await Task.detached(priority: .userInitiated, operation: { OfflineCache.readBody(key) }).value {
                raw = cached
            } else {
                raw = try await src.service.perform { (c: IMAPClient, _: SpecialFolders) async throws -> Data in
                    try await c.ensureSelected(key.folder)
                    return try await c.fetchRaw(uid: key.uid)
                }
            }
        } catch {
            report(error, account: src.account)
            return
        }

        // 2. Im Zielkonto ablegen
        do {
            try await dst.service.perform { (c: IMAPClient, _: SpecialFolders) async throws -> Void in
                try await c.append(raw, to: folder, flags: flagList)
            }
        } catch {
            report(error, account: dst.account)
            return   // Original bleibt unangetastet
        }

        // 3. Erst jetzt im Quellkonto entfernen
        removeLocally(m)
        do {
            try await src.service.perform { (c: IMAPClient, _: SpecialFolders) async throws -> Void in
                try await c.ensureSelected(key.folder)
                try await c.expungeUIDs([key.uid])
            }
        } catch {
            errorMessage = "Die E-Mail wurde kopiert, konnte im Quellkonto aber nicht gelöscht werden: \(error.localizedDescription)"
        }
        if refreshAfter { await refresh() }
    }

    /// Kennung einer Mail für Ziehen & Ablegen
    static func dragToken(_ m: MailMessage) -> String {
        "simplemail-move|\(m.accountID.uuidString)|\(m.uid)|\(m.folder)"
    }

    /// Ziehen einer ausgewählten Mail nimmt alle ausgewählten mit (eine Zeile je Mail)
    func dragPayload(_ m: MailMessage) -> String {
        guard selection.count > 1, selection.contains(m.key) else { return Self.dragToken(m) }
        return selectedMessages.map(Self.dragToken).joined(separator: "\n")
    }

    /// Abgelegte Mails in einen Ordner verschieben; liefert true, wenn etwas verschoben wurde
    @discardableResult
    func handleDrop(_ tokens: [String], account: UUID, folder: String) -> Bool {
        var moved = false
        for t in tokens.flatMap({ $0.components(separatedBy: "\n") }) {
            let parts = t.components(separatedBy: "|")
            guard parts.count >= 4, parts[0] == "simplemail-move", let srcAccount = UUID(uuidString: parts[1]),
                  let uid = UInt32(parts[2]) else { continue }
            let src = parts[3...].joined(separator: "|")
            let key = MessageKey(account: srcAccount, folder: src, uid: uid)
            guard srcAccount != account || src != folder, let m = message(for: key) else { continue }
            moved = true
            Task { await move(m, toAccount: account, folder: folder) }
        }
        return moved
    }

    /// 2.35: Mails auf „Spam“ (unter Kategorien) abgelegt → in den Spam-Ordner ihres Kontos (ohne Absender zu sperren)
    @discardableResult
    func handleSpamDrop(_ tokens: [String]) -> Bool {
        var found: [MailMessage] = []
        for t in tokens.flatMap({ $0.components(separatedBy: "\n") }) {
            let parts = t.components(separatedBy: "|")
            guard parts.count >= 4, parts[0] == "simplemail-move", let srcAccount = UUID(uuidString: parts[1]),
                  let uid = UInt32(parts[2]) else { continue }
            let src = parts[3...].joined(separator: "|")
            let key = MessageKey(account: srcAccount, folder: src, uid: uid)
            guard let m = message(for: key), !isJunkFolder(m) else { continue }
            found.append(m)
        }
        for m in found {
            Task { await self.markSpam(m, block: nil) }
        }
        return !found.isEmpty
    }

    /// 2.42: Mails auf „Gesendet“/„Papierkorb“ (alle Konten) abgelegt → in den Ordner dieser Rolle ihres Kontos
    /// (Papierkorb = normales Löschen)
    @discardableResult
    func handleRoleDrop(_ tokens: [String], role: FolderRole) -> Bool {
        var found: [MailMessage] = []
        for t in tokens.flatMap({ $0.components(separatedBy: "\n") }) {
            let parts = t.components(separatedBy: "|")
            guard parts.count >= 4, parts[0] == "simplemail-move", let srcAccount = UUID(uuidString: parts[1]),
                  let uid = UInt32(parts[2]) else { continue }
            let src = parts[3...].joined(separator: "|")
            let key = MessageKey(account: srcAccount, folder: src, uid: uid)
            guard let m = message(for: key), folderInfo(m.accountID, m.folder)?.role != role,
                  rolePath(m.accountID, role) != nil else { continue }
            found.append(m)
        }
        for m in found {
            if role == .trash {
                Task { await self.delete(m) }
            } else if let target = rolePath(m.accountID, role) {
                Task { await self.move(m, to: target) }
            }
        }
        return !found.isEmpty
    }

    /// In Gesendet: Empfänger statt Absender in der Liste zeigen
    func isSentFolder(_ m: MailMessage) -> Bool {
        folderInfo(m.accountID, m.folder)?.role == .sent
    }

    func delete(_ m: MailMessage) async {
        removeLocally(m)
        await run(PendingOp(m.key, .delete))
    }

    /// IMAP-Befehle zu einer Aktion (auch für das Nachholen aus der Warteschlange)
    private func action(for op: PendingOp) -> (IMAPClient, SpecialFolders) async throws -> Void {
        let folder = op.folder
        let uid = op.uid
        let on = op.on
        let target = op.target
        switch op.kind {
        case .seen:
            return { c, _ in
                try await c.ensureSelected(folder)
                try await c.setFlag("\\Seen", on, uid: uid)
            }
        case .flagged:
            return { c, _ in
                try await c.ensureSelected(folder)
                try await c.setFlag("\\Flagged", on, uid: uid)
            }
        case .archive:
            return { c, f in
                guard let dest = f.archive else { throw MailError.invalidResponse("Kein Archivordner gefunden.") }
                try await c.ensureSelected(folder)
                try await c.move(uid: uid, to: dest)
            }
        case .move:
            return { c, _ in
                try await c.ensureSelected(folder)
                try await c.move(uid: uid, to: target)
            }
        case .delete:
            return { c, f in
                try await c.ensureSelected(folder)
                if let trash = f.trash, trash != folder {
                    try await c.move(uid: uid, to: trash)
                } else {
                    // Im Papierkorb (oder ohne Papierkorb) endgültig löschen
                    try await c.setFlag("\\Deleted", true, uid: uid)
                    try await c.command("EXPUNGE")
                }
            }
        }
    }

    /// Aktion ausführen; ohne Verbindung in die Warteschlange statt verwerfen
    private func run(_ op: PendingOp) async {
        guard let s = sessions[op.account] else { return }
        do {
            try await s.service.perform(action(for: op))
        } catch {
            if isConnectionError(error) {
                pendingOps.append(op)
                isOffline = true
                return
            }
            report(error, account: s.account)
            await refresh()
        }
    }

    /// Warteschlange abarbeiten; hört beim ersten Verbindungsfehler auf (dann ist man weiter offline)
    private func flushPendingOps() async {
        guard !pendingOps.isEmpty, !flushingOps else { return }
        flushingOps = true
        let batch = pendingOps
        pendingOps = []
        var left: [PendingOp] = []
        var online = true
        let cutoff = Date().timeIntervalSince1970 - 7 * 86400
        for op in batch {
            // Konto entfernt oder älter als 7 Tage → verwerfen
            guard op.at > cutoff, accounts.contains(where: { $0.id == op.account }) else { continue }
            guard online, let s = sessions[op.account] else { left.append(op); continue }
            do {
                try await s.service.perform(action(for: op))
            } catch {
                // anderer Fehler (Mail gibt es nicht mehr …) → verwerfen
                if isConnectionError(error) { online = false; left.append(op) }
            }
        }
        pendingOps = left + pendingOps
        flushingOps = false
    }

    private func run(_ accountID: UUID, _ op: (IMAPClient, SpecialFolders) async throws -> Void) async {
        guard let s = sessions[accountID] else { return }
        do {
            try await s.service.perform(op)
        } catch {
            report(error, account: s.account)
            await refresh()
        }
    }

    private func updateLocally(_ key: MessageKey, _ change: (inout MailMessage) -> Void) {
        // Nur veröffentlichen, wenn sich wirklich etwas ändert – sonst baute z. B. das zweite
        // „gelesen“ beim Öffnen einer Mail die ganze Liste noch einmal neu auf
        if var list = inbox[key.account], let i = list.firstIndex(where: { $0.key == key }) {
            let before = list[i]
            change(&list[i])
            if list[i] != before { inbox[key.account] = list }
        }
        if let i = folderMessages.firstIndex(where: { $0.key == key }) {
            var m = folderMessages[i]
            change(&m)
            if m != folderMessages[i] { folderMessages[i] = m }
        }
        if var r = searchResults, let i = r.firstIndex(where: { $0.key == key }) {
            let before = r[i]
            change(&r[i])
            if r[i] != before { searchResults = r }
        }
    }

    /// Wählt – wie Spark – die nächste Mail der Liste aus
    private func selectNext(after m: MailMessage) {
        let visible = displayedMessages
        guard selectedID == m.key, let i = visible.firstIndex(where: { $0.key == m.key }) else { return }
        let next = i + 1 < visible.count ? visible[i + 1] : (i > 0 ? visible[i - 1] : nil)
        selectedID = next?.key
    }

    /// Gelesen-Status lokal setzen und den Ordnerzähler der Seitenleiste gleich mitführen
    /// (die Ordnerzähler vom Server kommen nur alle paar Minuten)
    private func markReadLocally(_ key: MessageKey, _ read: Bool) {
        notePending(key, read: read)
        if let cur = message(for: key), cur.isRead != read { adjustFolderUnread(key, read ? -1 : 1) }
        updateLocally(key) { $0.isRead = read }
    }

    private func adjustFolderUnread(_ key: MessageKey, _ delta: Int) {
        guard var list = folders[key.account], let i = list.firstIndex(where: { $0.path == key.folder }) else { return }
        list[i].unread = max(0, list[i].unread + delta)
        folders[key.account] = list
    }

    private func removeLocally(_ m: MailMessage) {
        selectNext(after: m)
        let key = m.key
        if let cur = message(for: key), !cur.isRead { adjustFolderUnread(key, -1) }
        let now = Date()
        recentlyRemoved = recentlyRemoved.filter { now.timeIntervalSince($0.value) < 600 }
        recentlyRemoved[key] = now
        inbox[key.account]?.removeAll { $0.key == key }
        folderMessages.removeAll { $0.key == key }
        searchResults?.removeAll { $0.key == key }
        bodies[key] = nil
        if snoozes.contains(where: { !$0.deleted && $0.matches(m) }) {
            var list = snoozes
            for i in list.indices where list[i].matches(m) {
                list[i].deleted = true
                list[i].updatedAt = nowMillis()
            }
            snoozes = list
        }
    }

    // MARK: - Später erinnern (Snooze)

    private func snoozeEntry(for m: MailMessage) -> SnoozeEntry? {
        guard m.folder == "INBOX", !snoozes.isEmpty else { return nil }
        if snoozeIndex == nil {
            // Schlüssel als Struktur statt Text: vorher wurde für jede Mail bei jedem Sortieren/Zählen
            // ein Text aus Konto-UUID und Message-ID gebaut (bei Tausenden Mails spürbar)
            var idx = SnoozeIndex()
            for e in snoozes where !e.deleted {
                if !e.messageID.isEmpty {
                    let k = SnoozeIndex.MidKey(account: e.accountID, mid: e.messageID)
                    if idx.byMid[k] == nil { idx.byMid[k] = e }
                }
                let u = SnoozeIndex.UidKey(account: e.accountID, uid: e.uid)
                if idx.byUid[u] == nil { idx.byUid[u] = e }
            }
            snoozeIndex = idx
        }
        guard let idx = snoozeIndex, !idx.byUid.isEmpty else { return nil }
        if !m.messageID.isEmpty {
            if let e = idx.byMid[SnoozeIndex.MidKey(account: m.accountID, mid: m.messageID)] { return e }
            if let e = idx.byUid[SnoozeIndex.UidKey(account: m.accountID, uid: m.uid)], e.messageID.isEmpty { return e }
            return nil
        }
        return idx.byUid[SnoozeIndex.UidKey(account: m.accountID, uid: m.uid)]
    }

    func isSnoozed(_ m: MailMessage) -> Bool {
        guard let e = snoozeEntry(for: m) else { return false }
        return e.until > Date()
    }

    func snoozeDate(_ m: MailMessage) -> Date? {
        guard let e = snoozeEntry(for: m), e.until > Date() else { return nil }
        return e.until
    }

    /// Wieder aufgetauchte Mails werden nach dem Weckzeitpunkt einsortiert (landen oben)
    private func sortDate(_ m: MailMessage) -> Date {
        if let e = snoozeEntry(for: m), e.until <= Date() { return max(e.until, m.date) }
        return m.date
    }

    func snooze(_ m: MailMessage, until: Date) {
        guard m.folder == "INBOX" else {
            errorMessage = "Zurückstellen ist nur im Posteingang möglich."
            return
        }
        selectNext(after: m)
        var list = snoozes
        list.removeAll { $0.matches(m) }
        list.append(SnoozeEntry(accountID: m.accountID, accountEmail: account(m.accountID)?.email.lowercased() ?? "",
                                messageID: m.messageID, uid: m.uid, until: until,
                                subject: m.subject, sender: m.senderDisplay))
        snoozes = list
    }

    func unsnooze(_ m: MailMessage) {
        var list = snoozes
        for i in list.indices where list[i].matches(m) {
            list[i].deleted = true
            list[i].updatedAt = nowMillis()
        }
        snoozes = list
    }

    private func tick() async {
        let now = Date()

        // Snooze: fällige Mails zurückholen, als ungelesen markieren, melden
        var changed = false
        var woken: [SnoozeEntry] = []
        var list = snoozes
        for i in list.indices where list[i].until <= now && !list[i].notified && !list[i].deleted {
            list[i].notified = true
            list[i].updatedAt = nowMillis()
            woken.append(list[i])
            changed = true
        }
        let expired = list.filter { $0.until < now.addingTimeInterval(-7 * 86_400) }
        if !expired.isEmpty {
            list.removeAll { $0.until < now.addingTimeInterval(-7 * 86_400) }
            changed = true
        }
        if changed { snoozes = list }
        for e in woken {
            Notifier.post(title: "Erinnerung: \(e.sender)", body: e.subject.isEmpty ? "(Kein Betreff)" : e.subject)
            if let m = inbox[e.accountID]?.first(where: { e.matches($0) }), m.isRead {
                await setRead(m, false)
            }
        }

        // Geplante Mails senden
        for item in scheduled where item.sendAt <= now && !sendingIDs.contains(item.id) {
            await sendScheduled(item)
        }
    }

    // MARK: - Senden & später senden

    func send(_ draft: Draft) async throws {
        guard let acc = account(draft.accountID) ?? accounts.first else { throw MailError.noAccount }
        let (data, recipients) = try MessageBuilder.build(draft, account: acc)
        guard !recipients.isEmpty else { throw MailError.invalidResponse("Kein gültiger Empfänger angegeben.") }
        try await deliver(data, to: recipients, account: acc)
    }

    func schedule(_ draft: Draft, at date: Date) throws {
        guard let acc = account(draft.accountID) ?? accounts.first else { throw MailError.noAccount }
        let (data, recipients) = try MessageBuilder.build(draft, account: acc)
        guard !recipients.isEmpty else { throw MailError.invalidResponse("Kein gültiger Empfänger angegeben.") }
        scheduled.append(ScheduledMail(accountID: acc.id, sendAt: date, subject: draft.subject,
                                       toDisplay: draft.to, recipients: recipients, data: data))
        scheduled.sort { $0.sendAt < $1.sendAt }
    }

    func cancelScheduled(_ item: ScheduledMail) {
        scheduled.removeAll { $0.id == item.id }
    }

    // MARK: - Seitenleiste: Ordner verwalten (Rechtsklick)

    func folderInfo(_ account: UUID, _ path: String) -> MailFolder? {
        folders[account]?.first { $0.path == path }
    }

    // MARK: Ordnerfarben (2.43)

    /// Schlüssel „adresse|lesbarer Pfad“ – identisch mit Windows (dort liefert imapflow den lesbaren Pfad)
    func folderColorKey(_ account: UUID, _ path: String) -> String? {
        guard let a = self.account(account) else { return nil }
        return a.email.lowercased() + "|" + MUTF7.decode(path)
    }

    /// Gewählte Schriftfarbe des Ordners ("#rrggbb") oder ""
    func folderColorHex(account: UUID, path: String) -> String {
        guard let key = folderColorKey(account, path), let e = folderColors[key], !e.deleted else { return "" }
        return ColorChoices.valid(e.color) ?? ""
    }

    /// Schriftfarbe setzen; "" = keine Farbe
    func setFolderColor(account: UUID, path: String, hex: String) {
        guard let key = folderColorKey(account, path) else { return }
        let value = ColorChoices.valid(hex) ?? ""
        // „Keine Farbe“ ohne gesetzte Farbe: nichts zu tun
        if value.isEmpty && !(folderColors[key].map { !$0.deleted } ?? false) { return }
        folderColors[key] = FolderColor(color: value, deleted: value.isEmpty, updatedAt: nowMillis())
    }

    /// Farben beim Umbenennen mitnehmen (newName nil = Ordner gelöscht → Farbe entfernen); Pfade lesbar
    private func moveFolderColors(email: String, oldName: String, newName: String?, delimiter d: String) {
        let pre = email.lowercased() + "|"
        let stamp = nowMillis()
        var map = folderColors
        var changed = false
        for (k, e) in folderColors where !e.deleted && k.hasPrefix(pre) {
            let p = String(k.dropFirst(pre.count))
            guard p == oldName || (!d.isEmpty && p.hasPrefix(oldName + d)) else { continue }
            if let n = newName {
                map[pre + n + String(p.dropFirst(oldName.count))] = FolderColor(color: e.color, deleted: false, updatedAt: stamp)
            }
            map[k] = FolderColor(color: "", deleted: true, updatedAt: stamp)
            changed = true
        }
        if changed { folderColors = map }
    }

    /// Prüft einen neuen Ordnernamen; nil = in Ordnung, sonst Fehlermeldung
    private func folderNameProblem(_ name: String) -> String? {
        if name.isEmpty { return "Bitte einen Ordnernamen eingeben." }
        if name.contains("/") || name.contains("\\") || name.contains("*") || name.contains("%") {
            return "Der Name darf keine Zeichen wie / \\ * % enthalten."
        }
        if name == IMAPClient.syncFolderName || name.uppercased() == "INBOX" { return "Dieser Name ist reserviert." }
        return nil
    }

    /// Hierarchie-Trennzeichen des Kontos (je Konto gemerkt)
    private func delimiter(_ s: AccountSession) async throws -> String {
        if let d = folderDelimiters[s.account.id] { return d }
        let d = try await s.service.perform { (c: IMAPClient, _: SpecialFolders) async throws -> String in
            try await c.hierarchyDelimiter()
        }
        folderDelimiters[s.account.id] = d
        return d
    }

    func createFolder(account: UUID, parent: String?, name raw: String) async {
        guard let s = sessions[account] else { return }
        let name = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if let problem = folderNameProblem(name) { errorMessage = problem; return }
        let parentPath = parent
        do {
            let d = try await delimiter(s)
            if !d.isEmpty && name.contains(d) { errorMessage = "Der Name darf kein „\(d)“ enthalten."; return }
            try await s.service.perform { (c: IMAPClient, _: SpecialFolders) async throws -> Void in
                let leaf = MUTF7.encode(name)
                let full = parentPath.map { $0 + d + leaf } ?? leaf
                try await c.command("CREATE \(IMAPClient.quote(full))")
                _ = try? await c.command("SUBSCRIBE \(IMAPClient.quote(full))")
            }
            await loadFolders()
        } catch {
            report(error, account: s.account)
        }
    }

    func renameFolder(account: UUID, path: String, to raw: String) async {
        guard let s = sessions[account], let f = folderInfo(account, path) else { return }
        if f.role != .other { errorMessage = "Systemordner können nicht umbenannt werden."; return }
        let name = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if let problem = folderNameProblem(name) { errorMessage = problem; return }
        if name == f.name { return }
        do {
            let d = try await delimiter(s)
            if !d.isEmpty && name.contains(d) { errorMessage = "Der Name darf kein „\(d)“ enthalten."; return }
            let full = try await s.service.perform { (c: IMAPClient, _: SpecialFolders) async throws -> String in
                var prefix = ""
                if !d.isEmpty, let cut = path.range(of: d, options: .backwards) { prefix = String(path[..<cut.upperBound]) }
                let target = prefix + MUTF7.encode(name)
                if let sel = c.selectedMailbox, sel == path || (!d.isEmpty && sel.hasPrefix(path + d)) {
                    _ = try await c.select("INBOX")
                }
                try await c.command("RENAME \(IMAPClient.quote(path)) \(IMAPClient.quote(target))")
                _ = try? await c.command("UNSUBSCRIBE \(IMAPClient.quote(path))")
                _ = try? await c.command("SUBSCRIBE \(IMAPClient.quote(target))")
                return target
            }
            // Regeln, die in den Ordner verschieben, mitziehen (Regeln speichern den lesbaren Pfad)
            let oldName = MUTF7.decode(path)
            let newName = MUTF7.decode(full)
            let email = s.account.email.lowercased()
            var list = rules
            var changed = false
            for i in list.indices where !list[i].deleted && list[i].accountEmail.lowercased() == email {
                let t = list[i].actions.moveTo
                if t == oldName || (!d.isEmpty && t.hasPrefix(oldName + d)) {
                    list[i].actions.moveTo = newName + String(t.dropFirst(oldName.count))
                    list[i].updatedAt = nowMillis()
                    changed = true
                }
            }
            if changed { rules = list }
            // 2.43: Ordnerfarbe (auch der Unterordner) zieht mit
            moveFolderColors(email: email, oldName: oldName, newName: newName, delimiter: d)
            if case .folder(let a, let p) = sidebar, a == account, p == path || (!d.isEmpty && p.hasPrefix(path + d)) {
                sidebar = .folder(account, full + String(p.dropFirst(path.count)))
            }
            await loadFolders()
        } catch {
            report(error, account: s.account)
        }
    }

    func deleteFolder(account: UUID, path: String) async {
        guard let s = sessions[account], let f = folderInfo(account, path) else { return }
        if f.role != .other {
            errorMessage = "Systemordner (Posteingang, Gesendet, Entwürfe, Archiv, Spam, Papierkorb) können nicht gelöscht werden."
            return
        }
        do {
            let d = try await delimiter(s)
            // Unterordner zuerst (tiefste zuerst), dann der Ordner selbst
            let subs = d.isEmpty ? [] : (folders[account] ?? []).filter { $0.path.hasPrefix(path + d) }
                .sorted { $0.path.count > $1.path.count }
            if subs.contains(where: { $0.role != .other }) {
                errorMessage = "Der Ordner enthält einen Systemordner und kann nicht gelöscht werden."
                return
            }
            let subPaths = subs.map(\.path)
            try await s.service.perform { (c: IMAPClient, _: SpecialFolders) async throws -> Void in
                if let sel = c.selectedMailbox, sel == path || (!d.isEmpty && sel.hasPrefix(path + d)) {
                    _ = try await c.select("INBOX")
                }
                for x in subPaths + [path] {
                    _ = try? await c.command("UNSUBSCRIBE \(IMAPClient.quote(x))")
                    try await c.command("DELETE \(IMAPClient.quote(x))")
                }
            }
            moveFolderColors(email: s.account.email, oldName: MUTF7.decode(path), newName: nil, delimiter: d)
            if case .folder(let a, let p) = sidebar, a == account, p == path || (!d.isEmpty && p.hasPrefix(path + d)) {
                sidebar = .smart
            }
            await loadFolders()
        } catch {
            report(error, account: s.account)
            await loadFolders()
        }
    }

    /// Papierkorb bzw. Spam endgültig leeren
    func emptyFolder(account: UUID, path: String) async {
        guard let s = sessions[account], let f = folderInfo(account, path) else { return }
        guard f.role == .trash || f.role == .junk else {
            errorMessage = "Nur Papierkorb und Spam können geleert werden."
            return
        }
        do {
            try await s.service.perform { (c: IMAPClient, _: SpecialFolders) async throws -> Void in
                let n = try await c.select(path)
                if n > 0 {
                    try await c.command("STORE 1:* +FLAGS.SILENT (\\Deleted)")
                    try await c.command("EXPUNGE")
                }
            }
            folderMessages.removeAll { $0.accountID == account && $0.folder == path }
            if let sel = selectedID, sel.account == account, sel.folder == path { selectedID = nil }
            await loadFolders()
        } catch {
            report(error, account: s.account)
        }
    }

    /// Ganzen Ordner auf dem Server als gelesen markieren
    func markFolderRead(account: UUID, path: String) async {
        guard let s = sessions[account] else { return }
        if var list = inbox[account] {
            var changed = false
            for i in list.indices where list[i].folder == path && !list[i].isRead {
                notePending(list[i].key, read: true)
                list[i].isRead = true
                changed = true
            }
            if changed { inbox[account] = list }
        }
        if folderMessages.contains(where: { $0.accountID == account && $0.folder == path && !$0.isRead }) {
            var fm = folderMessages
            for i in fm.indices where fm[i].accountID == account && fm[i].folder == path {
                if !fm[i].isRead { notePending(fm[i].key, read: true) }
                fm[i].isRead = true
            }
            folderMessages = fm
        }
        if var list = folders[account], let i = list.firstIndex(where: { $0.path == path }) {
            list[i].unread = 0
            folders[account] = list
        }
        do {
            try await s.service.perform { (c: IMAPClient, _: SpecialFolders) async throws -> Void in
                try await c.ensureSelected(path)
                let rs = try await c.command("UID SEARCH UNSEEN")
                var uids: [UInt32] = []
                for r in rs where r.text.hasPrefix("* SEARCH") {
                    uids += r.text.dropFirst(8).split(separator: " ").compactMap { UInt32($0) }
                }
                if !uids.isEmpty {
                    try await c.command("UID STORE \(IMAPClient.uidSet(uids)) +FLAGS.SILENT (\\Seen)")
                }
            }
        } catch {
            report(error, account: s.account)
        }
    }

    /// Mehrere Mails als gelesen markieren bzw. Markierung entfernen – gebündelt je Konto und Ordner
    func setFlagForList(_ list: [MailMessage], flag: String, on: Bool) async {
        let targets = list.filter { flag == "\\Seen" ? $0.isRead != on : $0.isFlagged != on }
        guard !targets.isEmpty else { return }
        for m in targets {
            if flag == "\\Seen" {
                markReadLocally(m.key, on)
            } else {
                updateLocally(m.key) { $0.isFlagged = on }
            }
        }
        let groups = Dictionary(grouping: targets) { "\($0.accountID.uuidString)|\($0.folder)" }
        for group in groups.values {
            guard let first = group.first else { continue }
            let folder = first.folder
            let uids = group.map(\.uid)
            await run(first.accountID) { c, _ in
                try await c.ensureSelected(folder)
                try await c.command("UID STORE \(IMAPClient.uidSet(uids)) \(on ? "+" : "-")FLAGS.SILENT (\(flag))")
            }
        }
    }

    /// Mails einer Ansicht der Seitenleiste (Smart Inbox, Kategorien …)
    func sidebarMessages(_ item: SidebarItem) -> [MailMessage] {
        let all = allInboxMessages.filter { !isSnoozed($0) }
        switch item {
        case .smart, .unread: return all
        case .flagged: return all.filter { $0.isFlagged }
        case .category(let c): return all.filter { $0.category == c }
        case .snoozed: return allInboxMessages.filter { isSnoozed($0) }
        default: return []
        }
    }

    /// Spam-Ordner der sichtbaren Konten
    var junkTargets: [MailFolderRef] { roleTargets(.junk) }

    func sendScheduled(_ item: ScheduledMail) async {
        guard let acc = account(item.accountID) else {
            cancelScheduled(item)
            return
        }
        sendingIDs.insert(item.id)
        defer { sendingIDs.remove(item.id) }
        do {
            try await deliver(Self.updatingDate(item.data), to: item.recipients, account: acc)
            scheduled.removeAll { $0.id == item.id }
            Notifier.post(title: "Geplante E-Mail gesendet",
                          body: item.subject.isEmpty ? "(Kein Betreff)" : item.subject)
        } catch {
            if let i = scheduled.firstIndex(where: { $0.id == item.id }) {
                scheduled[i].lastError = error.localizedDescription
                // Nächster Versuch in 5 Minuten
                scheduled[i].sendAt = Date().addingTimeInterval(300)
            }
        }
    }

    /// Auch für Regel-Weiterleitungen (Rules.swift)
    func deliver(_ data: Data, to recipients: [String], account acc: Account) async throws {
        guard let pw = Keychain.get(acc.keychainKey) else { throw MailError.noAccount }
        let messageID = SendLog.messageID(data)
        let reply: String
        do {
            reply = try await SMTPClient(account: acc, password: pw).send(data, from: acc.email, to: recipients)
        } catch {
            SendLog.write(acc, to: recipients, messageID: messageID, result: "FEHLER SMTP: \(error.localizedDescription)")
            throw error
        }

        // Google legt Mails, die über SEINEN SMTP-Server gehen, selbst in „Gesendet“ ab – entscheidend ist nur
        // der SMTP-Server (2.24–2.27 prüften auch imap.gmail.com: Google-IMAP mit anderem SMTP bekam keine Kopie)
        var sentNote = "Gesendet-Kopie: von Google abgelegt"
        if !Gmail.isGmailHost(acc.smtpHost) {
            do {
                guard let s = sessions[acc.id] else { throw MailError.server("Konto ist nicht verbunden") }
                let folder = try await s.service.perform { (c: IMAPClient, f: SpecialFolders) async throws -> String in
                    guard let sent = f.sent else { throw MailError.server("Kein Gesendet-Ordner gefunden") }
                    try await c.append(data, to: sent)
                    return sent
                }
                sentNote = "Gesendet-Kopie: \(folder)"
            } catch {
                sentNote = "Gesendet-Kopie FEHLGESCHLAGEN: \(error.localizedDescription)"
                errorMessage = "Die Mail an \(recipients.joined(separator: ", ")) wurde gesendet, aber nicht in „Gesendet“ abgelegt: \(error.localizedDescription)"
            }
        }
        SendLog.write(acc, to: recipients, messageID: messageID, result: "OK SMTP: \(reply) | \(sentNote)")
    }

    /// Setzt beim verzögerten Senden das Datum auf den tatsächlichen Sendezeitpunkt
    private static func updatingDate(_ data: Data) -> Data {
        var s = String(decoding: data, as: UTF8.self)
        guard let headerEnd = s.range(of: "\r\n\r\n"),
              let r = s.range(of: #"(?m)^Date: [^\r\n]*"#, options: .regularExpression,
                               range: s.startIndex..<headerEnd.lowerBound) else { return data }
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.dateFormat = "EEE, dd MMM yyyy HH:mm:ss Z"
        s.replaceSubrange(r, with: "Date: \(df.string(from: Date()))")
        return Data(s.utf8)
    }

    // MARK: - Anhänge

    /// Gewähltes Programm für diese Anhangsart
    func openWithChoice(_ kind: AttachmentKind) -> String {
        openWith[kind.rawValue] ?? AttachmentApps.defaultChoice(for: kind)
    }

    func setOpenWith(_ kind: AttachmentKind, _ id: String) {
        guard kind != .other else { return }
        openWith[kind.rawValue] = id
        openWithUpdatedAt = nowMillis()
        scheduleSync()
    }

    /// Öffnet einen Anhang – ohne `appID` mit dem eingestellten Programm (PDF: Vorschau, sonst Standard-App)
    func openAttachment(_ a: MailAttachment, with appID: String? = nil) {
        guard confirmDangerousAttachment(a) else { return }
        do {
            let file = try Self.tempFile(for: a)
            let id = appID ?? openWithChoice(AttachmentApps.kind(of: a.filename))
            if id != "default", let app = AttachmentApps.appURL(id) {
                Self.open(file, withApp: app)
            } else {
                NSWorkspace.shared.open(file)
            }
        } catch {
            errorMessage = "Anhang konnte nicht geöffnet werden: \(error.localizedDescription)"
        }
    }

    /// „Öffnen mit → Andere App …“: Programm im Ordner Programme auswählen
    func openAttachmentChoosingApp(_ a: MailAttachment) {
        guard confirmDangerousAttachment(a) else { return }
        let panel = NSOpenPanel()
        panel.title = "Programm zum Öffnen von „\(a.filename)“ wählen"
        panel.prompt = "Öffnen"
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowedContentTypes = [.application]
        panel.directoryURL = URL(fileURLWithPath: "/Applications")
        guard panel.runModal() == .OK, let app = panel.url else { return }
        do {
            Self.open(try Self.tempFile(for: a), withApp: app)
        } catch {
            errorMessage = "Anhang konnte nicht geöffnet werden: \(error.localizedDescription)"
        }
    }

    private static func open(_ file: URL, withApp app: URL) {
        let config = NSWorkspace.OpenConfiguration()
        config.activates = true
        NSWorkspace.shared.open([file], withApplicationAt: app, configuration: config) { _, error in
            // Programm ließ sich nicht starten → Standard-App
            if error != nil {
                DispatchQueue.main.async { NSWorkspace.shared.open(file) }
            }
        }
    }

    private func confirmDangerousAttachment(_ a: MailAttachment) -> Bool {
        let risk = DangerousFiles.risk(a.filename)
        if risk == .blocked {
            let info = NSAlert()
            info.alertStyle = .critical
            info.messageText = "Programmdatei"
            info.informativeText = "„\(DangerousFiles.clean(a.filename))“ ist ein Programm oder Skript. Solche Anhänge öffnet SimpleMail "
                + "aus Sicherheitsgründen nicht direkt.\n\nRechnungen, Bewerbungen oder Paketmitteilungen kommen fast nie als Programm. "
                + "Wenn du die Datei wirklich erwartest: sichern und vorher prüfen."
            info.addButton(withTitle: "Abbrechen")
            info.addButton(withTitle: "Sichern unter …")
            if info.runModal() == .alertSecondButtonReturn { saveAttachment(a) }
            return false
        }
        guard risk == .dangerous else { return true }
        let alert = NSAlert()
        alert.alertStyle = .critical
        alert.messageText = "Möglicherweise gefährlicher Anhang"
        let from = selectedMessage.map { " \($0.fromAddress)" } ?? ""
        alert.informativeText = "„\(a.filename)“ kann Programme oder Makros ausführen.\n\n"
            + "Öffne solche Dateien nur, wenn du sie erwartet hast und dem Absender\(from) vertraust. "
            + "Rechnungen, Bewerbungen oder Paketmitteilungen kommen fast nie als Programm."
        alert.addButton(withTitle: "Nicht öffnen")
        alert.addButton(withTitle: "Trotzdem öffnen")
        return alert.runModal() == .alertSecondButtonReturn
    }

    func saveAttachment(_ a: MailAttachment) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = Self.safeName(a.filename)
        panel.canCreateDirectories = true
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            try a.data.write(to: url)
            DangerousFiles.markQuarantine(url)
        } catch {
            errorMessage = "Speichern fehlgeschlagen: \(error.localizedDescription)"
        }
    }

    func saveAllAttachments(_ list: [MailAttachment]) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.canCreateDirectories = true
        panel.prompt = "Hier sichern"
        panel.directoryURL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
        guard panel.runModal() == .OK, let dir = panel.url else { return }
        var saved: [URL] = []
        do {
            for a in list {
                let url = Self.uniqueURL(in: dir, name: Self.safeName(a.filename))
                try a.data.write(to: url)
                DangerousFiles.markQuarantine(url)
                saved.append(url)
            }
            NSWorkspace.shared.activateFileViewerSelecting(saved)
        } catch {
            errorMessage = "Speichern fehlgeschlagen: \(error.localizedDescription)"
        }
    }

    /// Anhänge, die nicht schon als Bild im HTML-Text stehen
    func visibleAttachments(_ body: MessageBody) -> [MailAttachment] {
        let html = body.html ?? ""
        return body.attachments.filter { a in
            guard a.isInline, let cid = a.contentID else { return true }
            return !html.contains("cid:\(cid)")
        }
    }

    static func safeName(_ name: String) -> String {
        DangerousFiles.clean(name)
    }

    private static func uniqueURL(in dir: URL, name: String) -> URL {
        var url = dir.appendingPathComponent(name)
        let base = (name as NSString).deletingPathExtension
        let ext = (name as NSString).pathExtension
        var n = 2
        while FileManager.default.fileExists(atPath: url.path) {
            url = dir.appendingPathComponent(ext.isEmpty ? "\(base) \(n)" : "\(base) \(n).\(ext)")
            n += 1
        }
        return url
    }

    private static func tempFile(for a: MailAttachment) throws -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("SimpleMail", isDirectory: true)
            .appendingPathComponent(a.id.uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(safeName(a.filename))
        if !FileManager.default.fileExists(atPath: url.path) {
            try a.data.write(to: url)
            DangerousFiles.markQuarantine(url)
        }
        return url
    }

    // MARK: - Externe Bilder

    func remoteImagesAllowed(_ m: MailMessage) -> Bool {
        if !blockRemoteImages || imagesAllowed.contains(m.key) { return true }
        // Vertrauenswürdiger Absender nur, wenn die Absenderprüfung nicht fehlschlägt (sonst evtl. gefälscht)
        if m.authFailed != true, let t = trusted[m.fromAddress.lowercased()] { return !t.deleted }
        return false
    }

    func allowImagesOnce(_ m: MailMessage) {
        imagesAllowed.insert(m.key)
    }

    func trustSender(_ m: MailMessage) {
        trusted[m.fromAddress.lowercased()] = TrustEntry(deleted: false, updatedAt: nowMillis())
    }

    func untrust(_ address: String) {
        trusted[address] = TrustEntry(deleted: true, updatedAt: nowMillis())
    }

    func setBlockImages(_ on: Bool) {
        blockRemoteImages = on
        blockImagesUpdatedAt = nowMillis()
        scheduleSync()
    }

    // MARK: - Textbausteine

    @discardableResult
    func addSnippet() -> UUID {
        let s = Snippet(title: "Neuer Baustein", text: "")
        snippets.append(s)
        return s.id
    }

    func updateSnippet(_ id: UUID, title: String? = nil, text: String? = nil) {
        guard let i = snippets.firstIndex(where: { $0.id == id }) else { return }
        var s = snippets[i]
        if let title { s.title = title }
        if let text { s.text = text }
        s.updatedAt = nowMillis()
        snippets[i] = s
    }

    func deleteSnippet(_ id: UUID) {
        guard let i = snippets.firstIndex(where: { $0.id == id }) else { return }
        var s = snippets[i]
        s.deleted = true
        s.updatedAt = nowMillis()
        snippets[i] = s
    }

    func preparedHTML(_ html: String, for m: MailMessage, body: MessageBody) -> String {
        // Eingebettete Bilder werden als base64 eingesetzt – teuer, daher nur einmal je Mail
        let allow = remoteImagesAllowed(m)
        if let c = htmlCache[m.key], c.allowRemote == allow, c.sourceLength == html.utf8.count { return c.html }
        if htmlCache.count > 20 { htmlCache.removeAll() }
        let out = HTMLTools.prepare(html, attachments: body.attachments, allowRemote: allow)
        htmlCache[m.key] = PreparedHTML(allowRemote: allow, sourceLength: html.utf8.count, html: out)
        return out
    }

    /// Enthält die Mail externe Inhalte? (Ergebnis je Mail gemerkt – Regex über das ganze HTML)
    func hasRemoteContent(_ html: String, for key: MessageKey) -> Bool {
        if let v = remoteCheckCache[key] { return v }
        if remoteCheckCache.count > 200 { remoteCheckCache.removeAll() }
        let v = HTMLTools.hasRemoteContent(html)
        remoteCheckCache[key] = v
        return v
    }

    /// Einladung einer Mail (einmal je Mail zerlegt statt bei jedem Neuzeichnen)
    func invite(for key: MessageKey, _ mb: MessageBody) -> CalInvite? {
        guard let cal = mb.calendar else { return nil }
        if let hit = inviteCache[key] { return hit.invite }
        if inviteCache.count > 100 { inviteCache.removeAll() }
        let inv = ICS.parse(cal)
        inviteCache[key] = InviteCacheEntry(invite: inv)
        return inv
    }

    /// Text-Mail mit anklickbaren Links (Linkerkennung einmal je Mail statt bei jedem Neuzeichnen)
    func linkedText(for key: MessageKey, _ text: String) -> AttributedString {
        if let hit = linkedTextCache[key], hit.length == text.utf8.count { return hit.text }
        if linkedTextCache.count > 30 { linkedTextCache.removeAll() }
        let out = Mailto.linkified(text)
        linkedTextCache[key] = LinkedTextEntry(length: text.utf8.count, text: out)
        return out
    }

    // MARK: - Kontakte / Adressvorschläge

    private func rebuildContacts() {
        // Adressen aus bis zu 2000 Mails je Konto zerlegen – im Hintergrund statt nach jedem Abruf im Hauptthread
        let book = addressBook.filter { !$0.deleted }
        let system = systemContacts
        let msgs = everyInboxMessage + folderMessages
        let own = Set(accounts.map { $0.email.lowercased() })
        contactsTask?.cancel()
        contactsTask = Task {
            let built = await Task.detached(priority: .utility) {
                MailStore.buildContacts(book: book, system: system, messages: msgs, own: own)
            }.value
            if Task.isCancelled { return }
            self.contacts = built
        }
    }

    nonisolated private static func buildContacts(book: [AddressCard], system: [Contact],
                                                  messages: [MailMessage], own: Set<String>) -> [Contact] {
        var map: [String: Contact] = [:]
        func add(_ name: String, _ email: String) {
            let k = email.lowercased()
            guard k.contains("@") else { return }
            if let existing = map[k], !existing.name.isEmpty { return }
            map[k] = Contact(name: name, email: email)
        }
        for c in book {
            for e in c.emails { add(c.name.isEmpty ? c.company : c.name, e) }
        }
        for c in system { add(c.name, c.email) }
        for m in messages {
            add(m.fromName, m.fromAddress)
            for part in m.to.split(separator: ",") {
                let (n, a) = MIME.parseAddress(String(part))
                add(n, a)
            }
        }
        return map.values
            .filter { !own.contains($0.email.lowercased()) && !$0.email.lowercased().contains("noreply") && !$0.email.lowercased().contains("no-reply") }
            .sorted { $0.email < $1.email }
    }

    /// Vorschläge für das zuletzt getippte Adressfragment eines An-/Cc-Feldes
    func suggestions(for field: String) -> [Contact] {
        let token = (field.components(separatedBy: ",").last ?? "").trimmingCharacters(in: .whitespaces)
        guard token.count >= 2, !token.contains("<") else { return [] }
        let t = token.lowercased()
        let matches = contacts.filter {
            ($0.email.lowercased().contains(t) || $0.name.lowercased().contains(t)) && $0.email.lowercased() != t
        }
        let prefix = matches.filter { $0.email.lowercased().hasPrefix(t) || $0.name.lowercased().hasPrefix(t) }
        let rest = matches.filter { !($0.email.lowercased().hasPrefix(t) || $0.name.lowercased().hasPrefix(t)) }
        return Array((prefix + rest).prefix(6))
    }

    func completing(_ field: String, with c: Contact) -> String {
        var parts = field.components(separatedBy: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        if !parts.isEmpty { parts.removeLast() }
        return (parts.filter { !$0.isEmpty } + [c.display]).joined(separator: ", ") + ", "
    }

    // MARK: - Verfassen / Antworten / Weiterleiten

    func signatureBlock(_ acc: Account?) -> String {
        let sig = (acc?.signature ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return sig.isEmpty ? "" : "\n\n-- \n" + sig
    }

    func swappingSignature(in body: String, from old: UUID?, to new: UUID?) -> String {
        let oldBlock = signatureBlock(account(old))
        let newBlock = signatureBlock(account(new))
        guard oldBlock != newBlock, !oldBlock.isEmpty, let r = body.range(of: oldBlock) else { return body }
        var b = body
        b.replaceSubrange(r, with: newBlock)
        return b
    }

    /// Signatur für den formatierten Editor (inkl. Trenner „-- “)
    func editorSignature(_ acc: Account?) -> String {
        guard let acc else { return "" }
        if acc.hasRichSignature { return "-- <br>" + HTMLTools.clean(acc.signatureHtml, keepStyleBlocks: true) }
        let sig = acc.signature.trimmingCharacters(in: .whitespacesAndNewlines)
        return sig.isEmpty ? "" : "-- <br>" + HTMLTools.textToHtml(sig)
    }

    /// Anfangsinhalt des formatierten Editors aus dem Text-Entwurf
    func editorHTML(for d: Draft) -> String {
        let block = signatureBlock(account(d.accountID))
        var before = d.body
        var after = ""
        var sig = ""
        if !block.isEmpty, let r = d.body.range(of: block) {
            before = String(d.body[..<r.lowerBound])
            after = String(d.body[r.upperBound...])
            sig = editorSignature(account(d.accountID))
        }
        var html = before.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? "<div><br></div>" : HTMLTools.textToHtml(before)
        if !sig.isEmpty { html += "<div><br></div><div class=\"sm-sig\">\(sig)</div>" }
        let rest = after.trimmingCharacters(in: .newlines)
        if !rest.isEmpty { html += "<div><br></div><div class=\"sm-quote\">\(Self.quoteHTML(rest))</div>" }
        return html
    }

    /// Zitat-Zeilen („> …“) als eingerückter Block
    static func quoteHTML(_ text: String) -> String {
        var out = ""
        var quote: [String] = []
        func flush() {
            guard !quote.isEmpty else { return }
            out += "<blockquote>" + HTMLTools.textToHtml(quote.joined(separator: "\n")) + "</blockquote>"
            quote = []
        }
        for line in text.components(separatedBy: "\n") {
            if line.hasPrefix(">") {
                quote.append(line.hasPrefix("> ") ? String(line.dropFirst(2)) : String(line.dropFirst()))
            } else {
                flush()
                out += HTMLTools.textToHtml(line) + "<br>"
            }
        }
        flush()
        return out
    }

    /// Fügt einen Textbaustein vor Signatur bzw. Zitat ein
    func inserting(_ text: String, into body: String) -> String {
        let markers = ["\n\n-- \n", "\n\nAm ", "\n\n---------- Weitergeleitete"]
        guard let idx = markers.compactMap({ body.range(of: $0)?.lowerBound }).min() else {
            return body.isEmpty ? text : body + "\n" + text
        }
        let head = String(body[..<idx])
        let tail = String(body[idx...])
        let trimmed = head.trimmingCharacters(in: .whitespacesAndNewlines)
        return (trimmed.isEmpty ? text : head + "\n" + text) + tail
    }

    func newDraft() -> Draft {
        var d = Draft()
        if case .folder(let a, _) = sidebar { d.accountID = a } else { d.accountID = activeFilter ?? accounts.first?.id }
        d.body = signatureBlock(account(d.accountID))
        return d
    }

    func plainText(_ key: MessageKey) -> String {
        guard let b = bodies[key] else { return "" }
        if let t = b.text { return t }
        if let h = b.html,
           let a = try? NSAttributedString(
               data: Data(h.utf8),
               options: [.documentType: NSAttributedString.DocumentType.html,
                         .characterEncoding: String.Encoding.utf8.rawValue],
               documentAttributes: nil) {
            return a.string
        }
        return ""
    }

    func replyDraft(_ m: MailMessage, all: Bool) -> Draft {
        var d = Draft()
        d.accountID = m.accountID
        d.to = m.fromAddress
        if all {
            let own = account(m.accountID)?.email.lowercased() ?? ""
            let others = MessageBuilder.addresses(m.to) + MessageBuilder.addresses(bodies[m.key]?.cc ?? "")
            d.cc = others
                .filter { $0.lowercased() != own && $0.lowercased() != m.fromAddress.lowercased() }
                .joined(separator: ", ")
        }
        d.subject = m.subject.lowercased().hasPrefix("re:") ? m.subject : "Re: \(m.subject)"
        d.inReplyTo = m.messageID
        d.references = (m.references + " " + m.messageID).trimmingCharacters(in: .whitespaces)
        let quoted = plainText(m.key)
            .components(separatedBy: .newlines)
            .map { "> " + $0 }
            .joined(separator: "\n")
        d.body = signatureBlock(account(m.accountID))
            + "\n\nAm \(Formatters.full.string(from: m.date)) schrieb \(m.senderDisplay):\n\(quoted)"
        return d
    }

    func forwardDraft(_ m: MailMessage) -> Draft {
        var d = Draft()
        d.accountID = m.accountID
        d.subject = m.subject.lowercased().hasPrefix("fwd:") ? m.subject : "Fwd: \(m.subject)"
        d.body = signatureBlock(account(m.accountID)) + """


        ---------- Weitergeleitete Nachricht ----------
        Von: \(m.senderDisplay) <\(m.fromAddress)>
        Datum: \(Formatters.full.string(from: m.date))
        Betreff: \(m.subject)
        An: \(m.to)

        \(plainText(m.key))
        """
        // Originalanhänge mitschicken (eingebettete Bilder nicht)
        d.attachments = (bodies[m.key]?.attachments ?? [])
            .filter { !$0.isInline }
            .compactMap { try? Self.tempFile(for: $0) }
        return d
    }
}

// MARK: - Synchronisation Mac ↔ Windows
// Ein JSON-Dokument liegt als Mail im versteckten IMAP-Ordner „SimpleMail-Sync“ eines eigenen Kontos.
// Format und Abgleichsregeln sind identisch zur Windows-Version: jeder Eintrag trägt updatedAt
// (Millisekunden), der neuere gewinnt, Löschungen bleiben als „deleted“ erhalten.

extension MailStore {
    nonisolated private static let syncSubject = "SimpleMail Sync – bitte nicht löschen"

    private static let isoFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let isoPlain = ISO8601DateFormatter()

    private static func parseISO(_ s: String) -> Date? {
        isoFractional.date(from: s) ?? isoPlain.date(from: s)
    }

    func scheduleSync() {
        guard syncEnabled, !applyingSync else { return }
        syncTask?.cancel()
        syncTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard !Task.isCancelled else { return }
            await self?.syncNow()
        }
    }

    // ---- Zusammenführen (generisch auf JSON-Dictionaries)

    private func ts(_ value: Any?) -> Double {
        guard let d = value as? [String: Any] else { return 0 }
        return (d["updatedAt"] as? NSNumber)?.doubleValue ?? 0
    }

    private func isDeleted(_ d: [String: Any]) -> Bool {
        (d["deleted"] as? NSNumber)?.boolValue ?? false
    }

    private func sub(_ d: [String: Any], _ key: String) -> [String: Any] {
        d[key] as? [String: Any] ?? [:]
    }

    private func mergeMaps(_ a: [String: Any], _ b: [String: Any]) -> [String: Any] {
        var out = a
        for (k, v) in b where out[k] == nil || ts(v) > ts(out[k]) {
            out[k] = v
        }
        return out
    }

    private func mergeAccounts(_ a: [String: Any], _ b: [String: Any]) -> [String: Any] {
        var out = a
        for (k, v) in b {
            guard let theirs = v as? [String: Any] else { continue }
            guard let mine = out[k] as? [String: Any] else {
                out[k] = theirs
                continue
            }
            var base = ts(theirs) > ts(mine) ? theirs : mine
            if !isDeleted(base) && !isDeleted(mine) && !isDeleted(theirs) {
                let theirSig = (theirs["sigUpdatedAt"] as? NSNumber)?.doubleValue ?? 0
                let mySig = (mine["sigUpdatedAt"] as? NSNumber)?.doubleValue ?? 0
                let src = theirSig > mySig ? theirs : mine
                base["signature"] = src["signature"] ?? ""
                base["signatureHtml"] = src["signatureHtml"] ?? ""
                base["sigUpdatedAt"] = src["sigUpdatedAt"] ?? 0
                let theirCol = (theirs["colorUpdatedAt"] as? NSNumber)?.doubleValue ?? 0
                let myCol = (mine["colorUpdatedAt"] as? NSNumber)?.doubleValue ?? 0
                let colSrc = theirCol > myCol ? theirs : mine
                base["color"] = colSrc["color"] as? String ?? ""
                base["colorUpdatedAt"] = colSrc["colorUpdatedAt"] ?? 0
            }
            out[k] = base
        }
        return out
    }

    private func mergeDocs(_ local: [String: Any], _ remote: [String: Any]?) -> [String: Any] {
        guard let remote else { return local }
        var prefs = sub(local, "prefs")
        for (k, v) in sub(remote, "prefs") where prefs[k] == nil || ts(v) > ts(prefs[k]) {
            prefs[k] = v
        }
        return [
            "format": 1,
            "accounts": mergeAccounts(sub(local, "accounts"), sub(remote, "accounts")),
            "snippets": mergeMaps(sub(local, "snippets"), sub(remote, "snippets")),
            "rules": mergeMaps(sub(local, "rules"), sub(remote, "rules")),
            "contacts": mergeMaps(sub(local, "contacts"), sub(remote, "contacts")),
            "snoozes": mergeMaps(sub(local, "snoozes"), sub(remote, "snoozes")),
            "trusted": mergeMaps(sub(local, "trusted"), sub(remote, "trusted")),
            "blocked": mergeMaps(sub(local, "blocked"), sub(remote, "blocked")),
            "senderCats": mergeMaps(sub(local, "senderCats"), sub(remote, "senderCats")),
            "folderColors": mergeMaps(sub(local, "folderColors"), sub(remote, "folderColors")),
            "prefs": prefs,
        ]
    }

    // ---- Lokalen Stand als Dokument

    private func buildLocalDoc() -> [String: Any] {
        var accs: [String: Any] = [:]
        for a in accounts {
            let e: [String: Any] = [
                "displayName": a.displayName, "email": a.email, "username": a.username,
                "imapHost": a.imapHost, "imapPort": a.imapPort, "smtpHost": a.smtpHost, "smtpPort": a.smtpPort,
                "signature": a.signature, "signatureHtml": a.signatureHtml,
                "updatedAt": a.updatedAt > 0 ? a.updatedAt : 1, "sigUpdatedAt": a.sigUpdatedAt,
                "color": a.color, "colorUpdatedAt": a.colorUpdatedAt,
            ]
            accs[a.email.lowercased()] = e
        }
        for (email, t) in deletedAccounts where accs[email] == nil || t > ts(accs[email]) {
            accs[email] = ["email": email, "deleted": true, "updatedAt": t] as [String: Any]
        }

        var snips: [String: Any] = [:]
        for s in snippets {
            let id = s.id.uuidString.lowercased()
            snips[id] = ["id": id, "title": s.title, "text": s.text, "deleted": s.deleted,
                         "updatedAt": s.updatedAt > 0 ? s.updatedAt : 1] as [String: Any]
        }

        var snz: [String: Any] = [:]
        for z in snoozes {
            let email = z.accountEmail.isEmpty ? (account(z.accountID)?.email.lowercased() ?? "") : z.accountEmail.lowercased()
            guard !email.isEmpty else { continue }
            var entry = z
            entry.accountEmail = email
            snz[entry.syncKey] = [
                "id": z.id.uuidString.lowercased(), "accountEmail": email, "messageId": z.messageID,
                "uid": Int(z.uid), "until": Self.isoFractional.string(from: z.until),
                "subject": z.subject, "sender": z.sender, "notified": z.notified, "deleted": z.deleted,
                "updatedAt": z.updatedAt > 0 ? z.updatedAt : 1,
            ] as [String: Any]
        }

        var tr: [String: Any] = [:]
        for (addr, e) in trusted {
            tr[addr] = ["deleted": e.deleted, "updatedAt": e.updatedAt > 0 ? e.updatedAt : 1] as [String: Any]
        }
        var cts: [String: Any] = [:]
        for c in addressBook {
            var d = c.dictionary
            if c.updatedAt <= 0 { d["updatedAt"] = 1 }
            cts[c.id] = d
        }
        var bl: [String: Any] = [:]
        for (addr, e) in blocked {
            bl[addr] = ["deleted": e.deleted, "updatedAt": e.updatedAt > 0 ? e.updatedAt : 1] as [String: Any]
        }

        var prefs: [String: Any] = [
            "blockImages": ["value": blockRemoteImages,
                            "updatedAt": blockImagesUpdatedAt > 0 ? blockImagesUpdatedAt : 1] as [String: Any],
        ]
        if openWithUpdatedAt > 0 {
            prefs["openWith"] = ["value": openWith, "updatedAt": openWithUpdatedAt] as [String: Any]
        }
        if meetingLinksUpdatedAt > 0 {
            prefs["meetingLinks"] = ["value": Meeting.cleanLinks(meetingLinks), "updatedAt": meetingLinksUpdatedAt] as [String: Any]
        }
        if spamFilterUpdatedAt > 0 {
            prefs["spamFilter"] = ["value": ["enabled": spamFilterEnabled, "level": spamFilterLevel] as [String: Any],
                                   "updatedAt": spamFilterUpdatedAt] as [String: Any]
        }
        var rls: [String: Any] = [:]
        for r in rules {
            var d = r.dictionary
            if r.updatedAt <= 0 { d["updatedAt"] = 1 }
            rls[r.id] = d
        }
        var sc: [String: Any] = [:]
        for (addr, e) in senderCats {
            sc[addr] = ["category": e.category, "deleted": e.deleted, "updatedAt": e.updatedAt > 0 ? e.updatedAt : 1] as [String: Any]
        }
        var fcs: [String: Any] = [:]
        for (key, e) in folderColors {
            fcs[key] = ["color": e.color, "deleted": e.deleted, "updatedAt": e.updatedAt > 0 ? e.updatedAt : 1] as [String: Any]
        }
        return ["format": 1, "accounts": accs, "snippets": snips, "rules": rls, "contacts": cts, "snoozes": snz, "trusted": tr, "blocked": bl, "senderCats": sc, "folderColors": fcs, "prefs": prefs]
    }

    // ---- Abgeglichenes Dokument übernehmen

    private func applyFields(_ e: [String: Any], to a: inout Account) {
        func port(_ v: Any?) -> Int? {
            if let n = v as? NSNumber { return n.intValue }
            if let s = v as? String { return Int(s.trimmingCharacters(in: .whitespaces)) }
            return nil
        }
        if let v = e["displayName"] as? String { a.displayName = v }
        if let v = e["email"] as? String { a.email = v }
        if let v = e["username"] as? String { a.username = v }
        if let v = e["imapHost"] as? String { a.imapHost = v }
        if let v = port(e["imapPort"]) { a.imapPort = v }
        if let v = e["smtpHost"] as? String { a.smtpHost = v }
        if let v = port(e["smtpPort"]) { a.smtpPort = v }
    }

    /// Liefert true, wenn sich Konten geändert haben
    private func applyDoc(_ doc: [String: Any]) -> Bool {
        applyingSync = true
        defer { applyingSync = false }
        pendingServerChanges = []
        var accountsChanged = false
        var restart: [Account] = []

        for (email, value) in sub(doc, "accounts") {
            guard let e = value as? [String: Any] else { continue }
            let idx = accounts.firstIndex { $0.email.lowercased() == email }
            if isDeleted(e) {
                if let i = idx, ts(e) > accounts[i].updatedAt {
                    let id = accounts[i].id
                    sessions[id]?.idle.stop()
                    sessions[id] = nil
                    inbox[id] = nil
                    folders[id] = nil
                    pushActive[id] = nil
                    accounts.remove(at: i)
                    accountsChanged = true
                }
                continue
            }
            let sigTs = (e["sigUpdatedAt"] as? NSNumber)?.doubleValue ?? 0
            let colTs = (e["colorUpdatedAt"] as? NSNumber)?.doubleValue ?? 0
            if let i = idx {
                var a = accounts[i]
                if ts(e) > a.updatedAt {
                    var probe = a
                    applyFields(e, to: &probe)
                    let fields = ["username", "imapHost", "imapPort", "smtpHost", "smtpPort"]
                    // Vergleich unempfindlich gegen Groß-/Kleinschreibung, Leerzeichen und „Benutzername leer = E-Mail-Adresse“
                    func norm(_ x: Account) -> [String] {
                        let user = x.username.trimmingCharacters(in: .whitespaces).lowercased()
                        return [user.isEmpty ? x.email.lowercased() : user,
                                x.imapHost.trimmingCharacters(in: .whitespaces).lowercased(), String(x.imapPort),
                                x.smtpHost.trimmingCharacters(in: .whitespaces).lowercased(), String(x.smtpPort)]
                    }
                    let before = norm(a)
                    let after = norm(probe)
                    if before != after {
                        // Sicherheit: geänderte Serverdaten nie automatisch übernehmen – sonst könnte jemand mit Zugriff
                        // auf das Sync-Postfach Passwörter auf einen fremden Server umleiten. Der Nutzer entscheidet.
                        var change = PendingServerChange(email: email, proposed: probe)
                        for (k, f) in fields.enumerated() where before[k] != after[k] {
                            change.rows.append((f, before[k], after[k]))
                        }
                        pendingServerChanges.append(change)
                    } else {
                        a = probe
                        a.updatedAt = ts(e)
                        accountsChanged = true
                    }
                }
                if sigTs > a.sigUpdatedAt {
                    a.signature = e["signature"] as? String ?? ""
                    a.signatureHtml = HTMLTools.clean(e["signatureHtml"] as? String ?? "", keepStyleBlocks: true)
                    a.sigUpdatedAt = sigTs
                    accountsChanged = true
                }
                if colTs > a.colorUpdatedAt {
                    a.color = e["color"] as? String ?? ""
                    a.colorUpdatedAt = colTs
                    accountsChanged = true
                }
                accounts[i] = a
            } else {
                // Konto vom anderen Gerät – das Passwort wird hier einmal eingegeben
                var a = Account()
                applyFields(e, to: &a)
                a.fromSync = true
                a.signature = e["signature"] as? String ?? ""
                a.signatureHtml = HTMLTools.clean(e["signatureHtml"] as? String ?? "", keepStyleBlocks: true)
                a.updatedAt = ts(e)
                a.sigUpdatedAt = sigTs
                a.color = e["color"] as? String ?? ""
                a.colorUpdatedAt = colTs
                accounts.append(a)
                restart.append(a)
                accountsChanged = true
            }
        }
        if accountsChanged { persistAccounts() }
        for a in restart { startSession(for: a) }

        // Nur bei echten Änderungen übernehmen: jede Zuweisung speichert, synchronisiert und
        // zeichnet Liste/Seitenleiste neu (vorher bei jedem Abgleich alles)
        let newSnippets = sub(doc, "snippets").values.compactMap { value -> Snippet? in
            guard let d = value as? [String: Any], let idStr = d["id"] as? String,
                  let id = UUID(uuidString: idStr) else { return nil }
            return Snippet(id: id, title: d["title"] as? String ?? "", text: d["text"] as? String ?? "",
                           deleted: isDeleted(d), updatedAt: ts(d))
        }.sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
        if Set(newSnippets) != Set(snippets) { snippets = newSnippets }

        let newSnoozes = sub(doc, "snoozes").values.compactMap { value -> SnoozeEntry? in
            guard let d = value as? [String: Any], let email = d["accountEmail"] as? String,
                  let untilText = d["until"] as? String, let until = Self.parseISO(untilText) else { return nil }
            let accID = accounts.first { $0.email.lowercased() == email.lowercased() }?.id ?? UUID()
            let uid = UInt32(clamping: (d["uid"] as? NSNumber)?.intValue ?? 0)
            var z = SnoozeEntry(accountID: accID, accountEmail: email.lowercased(),
                                messageID: d["messageId"] as? String ?? "", uid: uid, until: until,
                                subject: d["subject"] as? String ?? "", sender: d["sender"] as? String ?? "")
            if let idStr = d["id"] as? String, let id = UUID(uuidString: idStr) { z.id = id }
            z.notified = (d["notified"] as? NSNumber)?.boolValue ?? false
            z.deleted = isDeleted(d)
            z.updatedAt = ts(d)
            return z
        }
        if Set(newSnoozes) != Set(snoozes) { snoozes = newSnoozes }

        if let ct = doc["contacts"] as? [String: Any] {
            let book = ct.values.compactMap { AddressCard.from($0) }
            if Set(book) != Set(addressBook) { addressBook = book }
        }
        if let rl = doc["rules"] as? [String: Any] {
            let list = rl.values.compactMap { MailRule.from($0) }.sorted { $0.order < $1.order }
            if Set(list) != Set(rules) { rules = list }
        }

        var t: [String: TrustEntry] = [:]
        for (addr, value) in sub(doc, "trusted") {
            if let d = value as? [String: Any] {
                t[addr] = TrustEntry(deleted: isDeleted(d), updatedAt: ts(d))
            }
        }
        if t != trusted { trusted = t }

        if let bd = doc["blocked"] as? [String: Any] {
            var b: [String: TrustEntry] = [:]
            for (addr, value) in bd {
                if let d = value as? [String: Any] { b[addr] = TrustEntry(deleted: isDeleted(d), updatedAt: ts(d)) }
            }
            if b != blocked { blocked = b }
        }

        if let sd = doc["senderCats"] as? [String: Any] {
            var c: [String: SenderCategory] = [:]
            for (addr, value) in sd {
                if let d = value as? [String: Any] {
                    c[addr] = SenderCategory(category: (d["category"] as? String) ?? "", deleted: isDeleted(d), updatedAt: ts(d))
                }
            }
            if c != senderCats {
                senderCats = c
                recategorizeAll()
            }
        }

        if let fd = doc["folderColors"] as? [String: Any] {
            var fc: [String: FolderColor] = [:]
            for (key, value) in fd {
                if let d = value as? [String: Any] {
                    fc[key] = FolderColor(color: (d["color"] as? String) ?? "", deleted: isDeleted(d), updatedAt: ts(d))
                }
            }
            if fc != folderColors { folderColors = fc }
        }

        if let b = sub(doc, "prefs")["blockImages"] as? [String: Any] {
            let v = (b["value"] as? NSNumber)?.boolValue ?? true
            if v != blockRemoteImages { blockRemoteImages = v }
            blockImagesUpdatedAt = ts(b)
        }
        if let o = sub(doc, "prefs")["openWith"] as? [String: Any], ts(o) > openWithUpdatedAt {
            var choice: [String: String] = [:]
            for (k, v) in (o["value"] as? [String: Any]) ?? [:] {
                if let id = v as? String { choice[k] = id }
            }
            openWith = choice
            openWithUpdatedAt = ts(o)
        }
        if let ml = sub(doc, "prefs")["meetingLinks"] as? [String: Any], ts(ml) > meetingLinksUpdatedAt {
            var links: [String: String] = [:]
            for (k, v) in (ml["value"] as? [String: Any]) ?? [:] {
                if let text = v as? String { links[k] = text }
            }
            meetingLinks = Meeting.cleanLinks(links)
            meetingLinksUpdatedAt = ts(ml)
        }
        if let sf = sub(doc, "prefs")["spamFilter"] as? [String: Any], ts(sf) > spamFilterUpdatedAt {
            let v = (sf["value"] as? [String: Any]) ?? [:]
            spamFilterEnabled = (v["enabled"] as? NSNumber)?.boolValue ?? true
            spamFilterLevel = SpamLevel(rawValue: (v["level"] as? String) ?? "")?.rawValue ?? SpamLevel.medium.rawValue
            spamFilterUpdatedAt = ts(sf)
        }
        return accountsChanged
    }

    // ---- Übertragung über IMAP

    nonisolated private static func syncMessage(from email: String, json: Data) -> Data {
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.dateFormat = "EEE, dd MMM yyyy HH:mm:ss Z"
        let b64opts: Data.Base64EncodingOptions = [.lineLength76Characters, .endLineWithCarriageReturn, .endLineWithLineFeed]
        let boundary = "SimpleMail-\(UUID().uuidString)"
        let text = "Diese Nachricht enthält die Einstellungen von SimpleMail (Konten ohne Passwörter, Signaturen, "
            + "Textbausteine, Erinnerungen).\r\nBitte nicht löschen – sie wird automatisch aktualisiert."
        var s = "From: <\(email)>\r\nTo: <\(email)>\r\n"
        s += "Subject: \(MessageBuilder.encodeWord(syncSubject))\r\n"
        s += "Date: \(df.string(from: Date()))\r\n"
        s += "Message-ID: <\(UUID().uuidString)@simplemail>\r\n"
        s += "MIME-Version: 1.0\r\n"
        s += "Content-Type: multipart/mixed; boundary=\"\(boundary)\"\r\n\r\n"
        s += "--\(boundary)\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n"
        s += Data(text.utf8).base64EncodedString(options: b64opts) + "\r\n"
        s += "--\(boundary)\r\nContent-Type: application/json; name=\"simplemail-sync.json\"\r\n"
        s += "Content-Disposition: attachment; filename=\"simplemail-sync.json\"\r\n"
        s += "Content-Transfer-Encoding: base64\r\n\r\n"
        s += json.base64EncodedString(options: b64opts) + "\r\n"
        s += "--\(boundary)--\r\n"
        return Data(s.utf8)
    }

    /// Nur Sync-Mails, die SimpleMail selbst per APPEND abgelegt hat (kein „Received:“ = nie per SMTP zugestellt)
    /// und die von der eigenen Adresse stammen – sonst ließe sich über „name+Ordner@“ eine Sync-Mail einschleusen
    nonisolated static func isOwnSyncMail(_ raw: Data, email: String) -> Bool {
        let text = String(decoding: raw.prefix(64 * 1024), as: UTF8.self)
        let head: String
        if let r = text.range(of: "\r\n\r\n") ?? text.range(of: "\n\n") { head = String(text[..<r.lowerBound]) } else { head = text }
        if head.range(of: #"(?im)^received:"#, options: .regularExpression) != nil { return false }
        let headers = MIME.parseHeaders(Data(head.utf8))
        let parsed = MIME.parseAddress(headers["from"] ?? "")
        return Categorizer.normalized(parsed.address) == Categorizer.normalized(email)
    }

    private func pullSync(_ s: AccountSession) async throws -> (String, [String: Any]?, Bool) {
        let own = s.account.email
        let (folder, raw) = try await s.service.perform {
            (c: IMAPClient, _: SpecialFolders) async throws -> (String, Data?) in
            let folder = try await c.ensureSyncFolder()
            let exists = try await c.select(folder)
            guard exists > 0 else { return (folder, nil) }
            // Neueste eigene Sync-Mail (höchstens 10 zurück); untergeschobene werden übersprungen
            for uid in try await c.allUIDs().sorted(by: >).prefix(10) {
                let raw = try await c.fetchRaw(uid: uid)
                if MailStore.isOwnSyncMail(raw, email: own) { return (folder, raw) }
            }
            return (folder, nil)
        }
        guard let raw else { return (folder, nil, false) }
        let pass = SyncCrypto.passphrase
        // Zerlegen, JSON und Entschlüsseln (210 000 PBKDF2-Runden) im Hintergrund –
        // vorher ließ jeder Abgleich (alle 5 Min. und beim Zurückkehren in die App) die Oberfläche stocken
        let result = try await Task.detached(priority: .utility) { () throws -> SyncPull in
            let (_, content) = MIME.extract(raw: raw)
            guard let att = content.attachments.first(where: { $0.filename.lowercased().hasSuffix("simplemail-sync.json") }),
                  let obj = try? JSONSerialization.jsonObject(with: att.data) as? [String: Any] else { return SyncPull(doc: nil, encrypted: false) }
            if obj["simplemailEncrypted"] != nil {
                let doc = try SyncCrypto.decrypt(obj, passphrase: pass)
                return SyncPull(doc: doc, encrypted: true)
            }
            // Mit Sync-Passwort nur verschlüsselte Dokumente übernehmen: ein unverschlüsseltes könnte untergeschoben sein
            // (es wird durch den eigenen, verschlüsselten Stand ersetzt)
            if pass != nil { return SyncPull(doc: nil, encrypted: false) }
            return SyncPull(doc: obj, encrypted: false)
        }.value
        return (folder, result.doc, result.encrypted)
    }

    private func pushSync(_ s: AccountSession, folder: String, doc: [String: Any]) async throws {
        let pass = SyncCrypto.passphrase
        let from = s.account.email
        let box = SyncDocBox(doc: doc)
        // Verschlüsseln und JSON im Hintergrund (siehe pullSync)
        let raw = try await Task.detached(priority: .utility) { () throws -> Data in
            let payload = try pass.map { try SyncCrypto.encrypt(box.doc, passphrase: $0) } ?? box.doc
            let json = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
            return MailStore.syncMessage(from: from, json: json)
        }.value
        try await s.service.perform { (c: IMAPClient, _: SpecialFolders) async throws -> Void in
            try await c.append(raw, to: folder)
            _ = try await c.select(folder)
            let uids = try await c.allUIDs()
            if let newest = uids.max() {
                try await c.expungeUIDs(uids.filter { $0 != newest })   // ältere Stände entfernen
            }
        }
    }

    /// Abgleich jetzt ausführen
    func syncNow() async {
        guard syncEnabled else { return }
        if isSyncing {
            syncAgain = true   // nach dem laufenden Abgleich noch einmal
            return
        }
        guard let acc = accounts.first(where: { $0.email.lowercased() == syncAccountEmail.lowercased() }),
              let s = sessions[acc.id] else {
            syncStatus = "Sync-Konto ist nicht verbunden (Passwort eingetragen?)."
            return
        }
        isSyncing = true
        defer {
            isSyncing = false
            if syncAgain {
                syncAgain = false
                Task { [weak self] in
                    try? await Task.sleep(nanoseconds: 500_000_000)
                    await self?.syncNow()
                }
            }
        }
        do {
            let (folder, remote, wasEncrypted) = try await pullSync(s)
            let merged = mergeDocs(buildLocalDoc(), remote)
            let accountsChanged = applyDoc(merged)
            let unchanged = remote.map { NSDictionary(dictionary: $0).isEqual(to: merged) } ?? false
            if !unchanged || wasEncrypted != hasSyncPassphrase {
                try await pushSync(s, folder: folder, doc: merged)
            }
            lastSync = Date()
            UserDefaults.standard.set(lastSync, forKey: "lastSync")
            syncStatus = ""
            if accountsChanged { await loadFolders() }
            askPendingServerChanges()
        } catch {
            syncStatus = error.localizedDescription
        }
    }
}

// MARK: - Sicherheit: Rückfrage bei Serveränderungen, Sync-Passwort

struct PendingServerChange {
    var email: String
    var proposed: Account
    var rows: [(field: String, old: String, new: String)] = []
}

extension MailStore {
    private static let fieldLabels = ["username": "Benutzername", "imapHost": "IMAP-Server", "imapPort": "IMAP-Port",
                                      "smtpHost": "SMTP-Server", "smtpPort": "SMTP-Port"]

    /// Fragt für jede vom anderen Gerät geänderte Serverangabe nach
    func askPendingServerChanges() {
        let list = pendingServerChanges
        pendingServerChanges = []
        for change in list {
            let alert = NSAlert()
            alert.alertStyle = .warning
            alert.messageText = "Geänderte Serverdaten vom anderen Gerät"
            let lines = change.rows.map { "\(Self.fieldLabels[$0.field] ?? $0.field): \($0.old) → \($0.new)" }.joined(separator: "\n")
            alert.informativeText = "Für \(change.email) wurden auf einem anderen Gerät die Serverdaten geändert:\n\n\(lines)\n\n"
                + "Übernimm die Änderung nur, wenn du sie selbst vorgenommen hast. Sonst „Ablehnen“ – dann bleiben die bisherigen "
                + "Daten und werden auch auf den anderen Geräten wiederhergestellt."
            alert.addButton(withTitle: "Ablehnen")
            alert.addButton(withTitle: "Übernehmen")
            let accept = alert.runModal() == .alertSecondButtonReturn
            guard let i = accounts.firstIndex(where: { $0.email.lowercased() == change.email }) else { continue }
            var a = accounts[i]
            if accept {
                a.username = change.proposed.username
                a.imapHost = change.proposed.imapHost
                a.imapPort = change.proposed.imapPort
                a.smtpHost = change.proposed.smtpHost
                a.smtpPort = change.proposed.smtpPort
            }
            a.updatedAt = nowMillis()   // eigene Entscheidung gilt ab jetzt auch für die anderen Geräte
            accounts[i] = a
            Storage.save(accounts, key: "accounts")
            if accept { startSession(for: a) }
        }
        if !list.isEmpty { scheduleSync() }
    }

    func setSyncPassphrase(_ value: String) {
        Keychain.set(value, for: SyncCrypto.keychainKey)
        objectWillChange.send()
        Task { await syncNow() }
    }
}

// MARK: - Zwischenspeicher-Typen (Performance)

/// Zähler der Seitenleiste, einmal je Datenstand berechnet
struct ViewCounts {
    var unreadByAccount: [UUID: Int] = [:]
    var unreadByCategory: [MailCategory: Int] = [:]
    var unreadInView = 0
    var totalUnread = 0
    var personalUnread = 0
    var snoozed = 0
}

/// Schneller Zugriff auf aktive „Später“-Einträge (Schlüssel als Struktur, kein Text)
struct SnoozeIndex {
    struct MidKey: Hashable { let account: UUID; let mid: String }
    struct UidKey: Hashable { let account: UUID; let uid: UInt32 }
    var byMid: [MidKey: SnoozeEntry] = [:]
    var byUid: [UidKey: SnoozeEntry] = [:]
}

/// Ergebnis des Sync-Abrufs (im Hintergrund zerlegt/entschlüsselt)
struct SyncPull: @unchecked Sendable {
    let doc: [String: Any]?
    let encrypted: Bool
}

/// Sync-Dokument für die Übergabe an den Hintergrund
struct SyncDocBox: @unchecked Sendable {
    let doc: [String: Any]
}

/// Zerlegte Einladung (auch „keine Einladung“ wird gemerkt)
struct InviteCacheEntry {
    let invite: CalInvite?
}

/// Text mit erkannten Links
struct LinkedTextEntry {
    let length: Int
    let text: AttributedString
}

/// Fertig aufbereitetes HTML einer Mail
struct PreparedHTML {
    let allowRemote: Bool
    let sourceLength: Int
    let html: String
}

/// Ergebnis der Offline-Prüfung vor dem Vorausladen
struct PrefetchScan {
    var found: [UInt32: String] = [:]
    var missing: [UInt32] = []
}

/// Ergebnis eines Ordnerabrufs
struct FolderFetch {
    let messages: [MailMessage]
    let low: Int
    let validity: String
}

/// Lokal gesetzte Flags, die ein laufender Abruf nicht überschreiben darf
struct PendingFlags {
    var read: Bool? = nil
    var flagged: Bool? = nil
    var at = Date()
}

// MARK: - Versandprotokoll

/// versand.log im Programmordner (~/Library/Application Support/SimpleMail): Zeit, Konto, Empfänger,
/// Message-ID und Antwort des Mailservers – ohne Mailinhalt. Hilft, wenn eine Mail nicht ankommt.
enum SendLog {
    static var url: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        let dir = base.appendingPathComponent("SimpleMail", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("versand.log")
    }

    static func messageID(_ data: Data) -> String {
        let text = String(decoding: data.prefix(16 * 1024), as: UTF8.self)
        let head = text.components(separatedBy: "\r\n\r\n").first ?? text
        for line in head.components(separatedBy: "\r\n") where line.lowercased().hasPrefix("message-id:") {
            return line.dropFirst(11).trimmingCharacters(in: .whitespaces)
        }
        return ""
    }

    static func write(_ acc: Account, to recipients: [String], messageID: String, result: String) {
        let file = url
        if let attrs = try? FileManager.default.attributesOfItem(atPath: file.path),
           let size = attrs[.size] as? Int, size > 512 * 1024 {
            let old = file.appendingPathExtension("1")
            try? FileManager.default.removeItem(at: old)
            try? FileManager.default.moveItem(at: file, to: old)
        }
        let stamp = ISO8601DateFormatter().string(from: Date())
        var line = "\(stamp)  \(acc.email) (\(acc.smtpHost):\(acc.smtpPort))  an: \(recipients.joined(separator: ", "))  \(messageID)  \(result)"
        line = line.replacingOccurrences(of: "\r", with: " ").replacingOccurrences(of: "\n", with: " ") + "\n"
        guard let bytes = line.data(using: .utf8) else { return }
        if let h = try? FileHandle(forWritingTo: file) {
            h.seekToEndOfFile()
            h.write(bytes)
            try? h.close()
        } else {
            try? bytes.write(to: file)
        }
    }
}

/// 2.29: Eine Server-Aktion, die ohne Verbindung nicht ausgeführt werden konnte (gespeichert in UserDefaults „pendingOps“)
struct PendingOp: Codable, Equatable {
    enum Kind: String, Codable { case seen, flagged, archive, move, delete }
    var account: UUID
    var folder: String
    var uid: UInt32
    var kind: Kind
    var on: Bool = false
    var target: String = ""
    var at: Double = Date().timeIntervalSince1970

    init(_ key: MessageKey, _ kind: Kind, on: Bool = false, target: String = "") {
        self.account = key.account
        self.folder = key.folder
        self.uid = key.uid
        self.kind = kind
        self.on = on
        self.target = target
    }

    var key: MessageKey { MessageKey(account: account, folder: folder, uid: uid) }
    /// Mail verschwindet aus dem Ordner (bleibt bis zur Ausführung ausgeblendet)
    var removes: Bool { kind == .archive || kind == .move || kind == .delete }

    static func load() -> [PendingOp] {
        guard let data = UserDefaults.standard.data(forKey: "pendingOps") else { return [] }
        return (try? JSONDecoder().decode([PendingOp].self, from: data)) ?? []
    }

    static func save(_ list: [PendingOp]) {
        if let data = try? JSONEncoder().encode(list) { UserDefaults.standard.set(data, forKey: "pendingOps") }
    }
}
