import SwiftUI
import AppKit

@main
struct SimpleMailApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @StateObject private var store = MailStore()
    @StateObject private var calendar = CalendarService()

    var body: some Scene {
        WindowGroup("SimpleMail") {
            ContentView()
                .environmentObject(store)
                .environmentObject(calendar)
                .frame(minWidth: 1000, minHeight: 600)
        }
        .commands {
            CommandGroup(after: .toolbar) {
                Picker("Zeilen je E-Mail", selection: $store.listLines) {
                    Text("1 Zeile (kompakt)").tag(1)
                    Text("2 Zeilen").tag(2)
                    Text("3 Zeilen (mit Textvorschau)").tag(3)
                }
                Picker("Sortierung nach Datum", selection: $store.sortAscending) {
                    Text("Neueste oben (absteigend)").tag(false)
                    Text("Älteste oben (aufsteigend)").tag(true)
                }
            }
            CommandGroup(replacing: .printItem) { }
            CommandGroup(replacing: .newItem) {
                Button("Neue E-Mail") { store.composeDraft = store.newDraft() }
                    .keyboardShortcut("n")
                    .disabled(store.accounts.isEmpty)
                Button("Neuer Termin / Online-Meeting …") { calendar.newMeetingOpen = true }
                    .keyboardShortcut("m", modifiers: [.command, .shift])
                Button("E-Mails abrufen") { Task { await store.refresh() } }
                    .keyboardShortcut("n", modifiers: [.command, .shift])
                Divider()
                Button("Drucken …") {
                    if let m = store.selectedMessage { MailPrinter.print(m, store: store) }
                }
                .keyboardShortcut("p")
                .disabled(store.selectedMessage == nil || store.selection.count > 1)
            }
            CommandGroup(replacing: .textEditing) {
                // ersetzt „Suchen“ des Textsystems, damit ⌘F immer die Mailsuche öffnet
                Button("E-Mails suchen") { MailSearch.focus(store: store) }
                    .keyboardShortcut("f")
            }
        }

        WindowGroup("E-Mail", for: MailMessage.self) { $message in
            MessageWindowView(message: message)
                .environmentObject(store)
                .environmentObject(calendar)
        }
        .defaultSize(width: 780, height: 820)

        Settings {
            SettingsView()
                .environmentObject(store)
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Nötig, wenn per `swift run` ohne .app-Bundle gestartet wird
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
