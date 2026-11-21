import SwiftUI
import AppKit

/// Ordner eines Kontos (für Sammelaktionen wie „Spam leeren“)
struct MailFolderRef: Hashable {
    let account: UUID
    let path: String
}

extension MUTF7 {
    /// String → Modified UTF-7 (RFC 3501) für neue Ordnernamen, z. B. "Entwürfe" → "Entw&APw-rfe"
    static func encode(_ s: String) -> String {
        var out = ""
        var pending: [UInt16] = []
        func flush() {
            guard !pending.isEmpty else { return }
            var bytes: [UInt8] = []
            for u in pending {
                bytes.append(UInt8(u >> 8))
                bytes.append(UInt8(u & 0xff))
            }
            let b64 = Data(bytes).base64EncodedString()
                .replacingOccurrences(of: "=", with: "")
                .replacingOccurrences(of: "/", with: ",")
            out += "&" + b64 + "-"
            pending = []
        }
        for ch in s.unicodeScalars {
            if ch.value >= 0x20 && ch.value <= 0x7e {
                flush()
                out += ch == "&" ? "&-" : String(ch)
            } else {
                pending.append(contentsOf: Array(String(ch).utf16))
            }
        }
        flush()
        return out
    }
}

extension IMAPClient {
    /// Hierarchie-Trennzeichen des Servers (meist "/" oder "."), leer = flach
    func hierarchyDelimiter() async throws -> String {
        let rs = try await command("LIST \"\" \"\"")
        for r in rs where r.text.hasPrefix("* LIST ") {
            guard let g = Pattern.groups(#"^\* LIST \(([^)]*)\) (NIL|"(?:[^"\\]|\\.)*"|\S+) (.*)$"#, in: r.text),
                  g.count == 3 else { continue }
            if g[1].uppercased() == "NIL" { return "" }
            return Self.unquote(g[1])
        }
        return "/"
    }
}

/// Rückfragen und Eingaben für das Kontextmenü der Seitenleiste
@MainActor
enum SidebarDialogs {
    static func confirm(_ title: String, _ text: String, ok: String) -> Bool {
        let a = NSAlert()
        a.messageText = title
        a.informativeText = text
        a.alertStyle = .warning
        a.addButton(withTitle: ok)
        a.addButton(withTitle: "Abbrechen")
        a.buttons.first?.hasDestructiveAction = true
        return a.runModal() == .alertFirstButtonReturn
    }

    /// Farbiger Punkt für Menüeinträge (kein Template-Bild, damit die Farbe im Menü sichtbar bleibt)
    static func colorDot(_ hex: String) -> NSImage {
        let v = UInt32((ColorChoices.valid(hex) ?? "#8e8e93").dropFirst(), radix: 16) ?? 0
        let c = NSColor(srgbRed: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255,
                        blue: CGFloat(v & 0xff) / 255, alpha: 1)
        let img = NSImage(size: NSSize(width: 12, height: 12), flipped: false) { r in
            c.setFill()
            NSBezierPath(ovalIn: r.insetBy(dx: 1, dy: 1)).fill()
            return true
        }
        img.isTemplate = false
        return img
    }

    static func ask(_ title: String, _ text: String, value: String, ok: String) -> String? {
        let a = NSAlert()
        a.messageText = title
        a.informativeText = text
        a.addButton(withTitle: ok)
        a.addButton(withTitle: "Abbrechen")
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 280, height: 24))
        field.stringValue = value
        a.accessoryView = field
        a.window.initialFirstResponder = field
        guard a.runModal() == .alertFirstButtonReturn else { return nil }
        let v = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        return v.isEmpty ? nil : v
    }
}

// MARK: - Kontextmenüs der Seitenleiste

extension SidebarView {
    /// Rechtsklick auf einen Ordner
    @ViewBuilder
    func folderMenu(_ f: MailFolder, account: UUID) -> some View {
        let store = self.store
        let system = f.role != .other
        if f.selectable {
            Button("Alle als gelesen markieren") {
                Task { @MainActor in await store.markFolderRead(account: account, path: f.path) }
            }
        }
        // 2.43: Schriftfarbe des Ordners (synchronisiert)
        let currentHex = store.folderColorHex(account: account, path: f.path)
        Menu("Schriftfarbe") {
            Button(currentHex.isEmpty ? "✓ Keine Farbe" : "Keine Farbe") {
                store.setFolderColor(account: account, path: f.path, hex: "")
            }
            Divider()
            ForEach(0..<ColorChoices.all.count, id: \.self) { i in
                let choiceHex = ColorChoices.all[i].hex
                let choiceName = ColorChoices.all[i].name
                Button {
                    store.setFolderColor(account: account, path: f.path, hex: choiceHex)
                } label: {
                    Label { Text(currentHex == choiceHex ? "✓ " + choiceName : choiceName) } icon: {
                        Image(nsImage: SidebarDialogs.colorDot(choiceHex))
                    }
                }
            }
        }
        if f.role == .trash || f.role == .junk {
            Button(f.role == .trash ? "Papierkorb leeren …" : "Spam-Ordner leeren …", role: .destructive) {
                Task { @MainActor in
                    guard SidebarDialogs.confirm("„\(f.name)“ leeren?",
                                                 "Alle E-Mails in diesem Ordner werden auf dem Server gelöscht. Das kann nicht rückgängig gemacht werden.",
                                                 ok: "Endgültig löschen") else { return }
                    await store.emptyFolder(account: account, path: f.path)
                }
            }
        }
        Divider()
        Button("Neuer Unterordner …") {
            Task { @MainActor in
                guard let name = SidebarDialogs.ask("Neuer Unterordner", "in „\(f.name)“", value: "", ok: "Anlegen") else { return }
                await store.createFolder(account: account, parent: f.path, name: name)
            }
        }
        Button("Umbenennen …") {
            Task { @MainActor in
                guard let name = SidebarDialogs.ask("Ordner umbenennen", "", value: f.name, ok: "Umbenennen") else { return }
                await store.renameFolder(account: account, path: f.path, to: name)
            }
        }
        .disabled(system)
        Divider()
        Button(system ? "Ordner löschen (Systemordner)" : "Ordner löschen …", role: .destructive) {
            Task { @MainActor in
                guard SidebarDialogs.confirm("Ordner „\(f.name)“ löschen?",
                                             "Der Ordner, seine Unterordner und alle darin enthaltenen E-Mails werden auf dem Server gelöscht. Das kann nicht rückgängig gemacht werden.",
                                             ok: "Endgültig löschen") else { return }
                await store.deleteFolder(account: account, path: f.path)
            }
        }
        .disabled(system)
    }

    /// Rechtsklick auf ein Konto (oder „Alle Konten“ bei nil)
    @ViewBuilder
    func accountMenu(_ account: Account?) -> some View {
        let store = self.store
        if let account {
            Button("Alle als gelesen markieren") {
                Task { @MainActor in await store.markFolderRead(account: account.id, path: "INBOX") }
            }
            Button("Neuer Ordner …") {
                Task { @MainActor in
                    guard let name = SidebarDialogs.ask("Neuer Ordner", account.email, value: "", ok: "Anlegen") else { return }
                    await store.createFolder(account: account.id, parent: nil, name: name)
                }
            }
            Divider()
            Button("Konto entfernen …", role: .destructive) {
                Task { @MainActor in
                    guard SidebarDialogs.confirm("Konto \(account.email) entfernen?",
                                                 "Das Konto wird aus SimpleMail (und über die Synchronisation auch auf deinen anderen Geräten) entfernt. Die E-Mails bleiben auf dem Server erhalten.",
                                                 ok: "Entfernen") else { return }
                    store.removeAccount(account.id)
                }
            }
        } else {
            Button("Alle als gelesen markieren") {
                Task { @MainActor in
                    let all = store.everyInboxMessage.filter { !store.isSnoozed($0) }
                    await store.setFlagForList(all, flag: "\\Seen", on: true)
                }
            }
        }
    }

    /// Rechtsklick auf Smart Inbox, Kategorien, Später, Geplant, Spam …
    @ViewBuilder
    func itemMenu(_ item: SidebarItem) -> some View {
        let store = self.store
        switch item {
        case .smart, .unread, .category:
            Button("Alle als gelesen markieren") {
                Task { @MainActor in await store.setFlagForList(store.sidebarMessages(item), flag: "\\Seen", on: true) }
            }
        case .flagged:
            Button("Alle als gelesen markieren") {
                Task { @MainActor in await store.setFlagForList(store.sidebarMessages(item), flag: "\\Seen", on: true) }
            }
            Button("Alle Markierungen entfernen") {
                Task { @MainActor in await store.setFlagForList(store.sidebarMessages(item), flag: "\\Flagged", on: false) }
            }
        case .snoozed:
            Button("Alle zurück in den Posteingang") {
                for m in store.sidebarMessages(.snoozed) { store.unsnooze(m) }
            }
            .disabled(store.snoozedCount == 0)
        case .scheduled:
            Button("Alle geplanten E-Mails verwerfen …", role: .destructive) {
                Task { @MainActor in
                    let n = store.scheduled.count
                    guard SidebarDialogs.confirm("\(n) geplante E-Mail\(n == 1 ? "" : "s") verwerfen?",
                                                 "Die E-Mails werden nicht gesendet.", ok: "Verwerfen") else { return }
                    for s in store.scheduled { store.cancelScheduled(s) }
                }
            }
            .disabled(store.scheduled.isEmpty)
        case .sent:
            let sentTargets = store.roleTargets(.sent)
            Button("Alle als gelesen markieren") {
                Task { @MainActor in
                    for t in sentTargets { await store.markFolderRead(account: t.account, path: t.path) }
                }
            }
        case .trash:
            let trashTargets = store.roleTargets(.trash)
            Button("Alle als gelesen markieren") {
                Task { @MainActor in
                    for t in trashTargets { await store.markFolderRead(account: t.account, path: t.path) }
                }
            }
            Divider()
            Button(trashTargets.count > 1 ? "Papierkorb aller Konten leeren …" : "Papierkorb leeren …", role: .destructive) {
                Task { @MainActor in
                    guard SidebarDialogs.confirm(trashTargets.count > 1 ? "Papierkorb aller Konten leeren?" : "Papierkorb leeren?",
                                                 "Alle E-Mails in \(trashTargets.count == 1 ? "diesem Ordner" : "\(trashTargets.count) Ordnern") werden auf dem Server gelöscht. Das kann nicht rückgängig gemacht werden.",
                                                 ok: "Endgültig löschen") else { return }
                    for t in trashTargets { await store.emptyFolder(account: t.account, path: t.path) }
                    await store.refresh()
                }
            }
            .disabled(trashTargets.isEmpty)
        case .spam:
            let targets = store.junkTargets
            Button("Alle als gelesen markieren") {
                Task { @MainActor in
                    for t in targets { await store.markFolderRead(account: t.account, path: t.path) }
                }
            }
            Divider()
            Button(targets.count > 1 ? "Spam aller Konten leeren …" : "Spam leeren …", role: .destructive) {
                Task { @MainActor in
                    guard SidebarDialogs.confirm("Spam leeren?",
                                                 "Alle E-Mails in \(targets.count == 1 ? "diesem Ordner" : "\(targets.count) Ordnern") werden auf dem Server gelöscht. Das kann nicht rückgängig gemacht werden.",
                                                 ok: "Endgültig löschen") else { return }
                    for t in targets { await store.emptyFolder(account: t.account, path: t.path) }
                    await store.refresh()
                }
            }
            .disabled(targets.isEmpty)
        default:
            EmptyView()
        }
    }
}
