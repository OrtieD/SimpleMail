import Foundation
import AppKit

// MARK: - Entwürfe (2.49)
// Als Entwurf speichern (Knopf, ⌘S, Nachfrage beim Schließen), im Ordner „Entwürfe“ ablegen (Flag \Draft),
// später wieder öffnen und weiterschreiben; beim Senden wird der Entwurf gelöscht. Gleiches Verhalten wie Windows 3.2.44.

/// Stelle eines gespeicherten Entwurfs auf dem Server
struct DraftRef: Hashable {
    var accountID: UUID
    var folder: String
    var uid: UInt32?
    var messageID: String
}

extension Notification.Name {
    /// Menü „Als Entwurf speichern“ (⌘S) → offenes Verfassen-Fenster
    static let simpleMailSaveDraft = Notification.Name("SimpleMailSaveDraft")
}

/// Ergebnis des Ablegens (eigener Typ statt Tupel)
struct DraftAppendResult {
    var folder: String
    var uid: UInt32?
    var created: Bool
}

extension MailStore {
    /// Liegt die Mail in einem Entwürfe-Ordner?
    func isDraft(_ m: MailMessage) -> Bool {
        folderInfo(m.accountID, m.folder)?.role == .drafts
    }

    /// Entwurf im Entwürfe-Ordner ablegen (fehlt er, wird „Drafts“ angelegt); der vorige Stand wird danach gelöscht
    func saveDraft(_ draft: Draft) async throws -> DraftRef {
        guard let acc = account(draft.accountID) ?? accounts.first else { throw MailError.noAccount }
        guard let s = sessions[acc.id] else { throw MailError.server("Konto ist nicht verbunden") }
        let built = try MessageBuilder.build(draft, account: acc)
        let data = built.data
        let messageID = SendLog.messageID(data)
        let result = try await s.service.perform { (c: IMAPClient, f: SpecialFolders) async throws -> DraftAppendResult in
            var folder = f.drafts
            var created = false
            if folder == nil {
                folder = try await c.detectSpecialFolders().drafts
            }
            if folder == nil {
                _ = try? await c.command("CREATE \(IMAPClient.quote("Drafts"))")
                created = true
                folder = try await c.detectSpecialFolders().drafts
            }
            guard let target = folder else {
                throw MailError.server("Kein Entwürfe-Ordner vorhanden und keiner anlegbar")
            }
            var uid = try await c.append(data, to: target, flags: "\\Seen \\Draft")
            if uid == nil && !messageID.isEmpty {
                // Server ohne UIDPLUS: über die Message-ID suchen
                _ = try await c.select(target)
                uid = try await c.searchMessageID(messageID).last
            }
            return DraftAppendResult(folder: target, uid: uid, created: created)
        }
        let ref = DraftRef(accountID: acc.id, folder: result.folder, uid: result.uid, messageID: messageID)
        if let old = draft.draftRef, old != ref { await deleteDraft(old) }
        if result.created { await loadFolders() }
        if sidebar == .drafts {
            await refresh()
        } else if case .folder(let a, let p) = sidebar, a == acc.id, p == result.folder {
            await refresh()
        }
        return ref
    }

    /// Entwurf endgültig löschen (nicht in den Papierkorb)
    func deleteDraft(_ ref: DraftRef) async {
        guard let s = sessions[ref.accountID] else { return }
        let done = (try? await s.service.perform { (c: IMAPClient, _: SpecialFolders) async throws -> Bool in
            _ = try await c.select(ref.folder)
            var uids: [UInt32] = []
            if let u = ref.uid {
                uids = [u]
            } else if !ref.messageID.isEmpty {
                uids = try await c.searchMessageID(ref.messageID)
            }
            guard !uids.isEmpty else { return false }
            try await c.expungeUIDs(uids)
            return true
        }) ?? false
        if done, let u = ref.uid {
            let before = folderMessages.count
            let rest = folderMessages.filter { !($0.accountID == ref.accountID && $0.folder == ref.folder && $0.uid == u) }
            if rest.count != before { folderMessages = rest }
        }
    }

    /// Entwurf aus dem Entwürfe-Ordner zum Weiterschreiben öffnen
    func openDraft(_ m: MailMessage) async {
        guard composeDraft == nil else { NSSound.beep(); return }
        guard let s = sessions[m.accountID] else { return }
        let key = m.key
        do {
            let raw = try await s.service.perform { (c: IMAPClient, _: SpecialFolders) async throws -> Data in
                try await c.ensureSelected(key.folder)
                return try await c.fetchRaw(uid: key.uid)
            }
            let extracted = MIME.extract(raw: raw)
            let headers = extracted.headers
            let content = extracted.content
            var d = Draft()
            d.accountID = m.accountID
            d.to = MIME.decodeHeader(headers["to"] ?? "")
            d.cc = MIME.decodeHeader(headers["cc"] ?? "")
            d.subject = MIME.decodeHeader(headers["subject"] ?? "")
            d.body = content.text ?? ""
            if let irt = headers["in-reply-to"], !irt.isEmpty { d.inReplyTo = irt }
            if let refs = headers["references"], !refs.isEmpty { d.references = refs }
            var html = content.html
            var files: [URL] = []
            let dir = FileManager.default.temporaryDirectory
                .appendingPathComponent("SimpleMail-Entwurf", isDirectory: true)
                .appendingPathComponent(UUID().uuidString, isDirectory: true)
            for a in content.attachments {
                if let cid = a.contentID, a.mimeType.hasPrefix("image/"), let h = html, h.contains("cid:\(cid)") {
                    html = h.replacingOccurrences(of: "cid:\(cid)",
                                                  with: "data:\(a.mimeType);base64,\(a.data.base64EncodedString())")
                    continue
                }
                try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                let name = a.filename.isEmpty ? "Anhang" : a.filename.replacingOccurrences(of: "/", with: "_")
                let url = dir.appendingPathComponent(name)
                if (try? a.data.write(to: url)) != nil { files.append(url) }
            }
            d.attachments = files
            if let h = html { d.bodyHtml = Self.draftEditorHTML(h) }
            d.draftRef = DraftRef(accountID: m.accountID, folder: m.folder, uid: m.uid,
                                  messageID: MIME.decodeHeader(headers["message-id"] ?? ""))
            composeDraft = d
        } catch {
            errorMessage = "Entwurf konnte nicht geöffnet werden: \(error.localizedDescription)"
        }
    }

    /// HTML eines gespeicherten Entwurfs → Editor-Inhalt (Hülle der Mail entfernen, Signatur wieder erkennen)
    static func draftEditorHTML(_ html: String) -> String {
        var s = html
        if let r = s.range(of: "<body[^>]*>", options: [.regularExpression, .caseInsensitive]) {
            s = String(s[r.upperBound...])
        }
        if let r = s.range(of: "</body>", options: [.caseInsensitive, .backwards]) {
            s = String(s[..<r.lowerBound])
        }
        s = s.replacingOccurrences(of: "<script[\\s\\S]*?</script>", with: "", options: [.regularExpression, .caseInsensitive])
        s = s.replacingOccurrences(of: "<style[\\s\\S]*?</style>", with: "", options: [.regularExpression, .caseInsensitive])
        s = s.trimmingCharacters(in: .whitespacesAndNewlines)
        // Hülle aus MessageBuilder.composedHtml (Mac) bzw. composedHtml (Windows): <div style="font-family:…">…</div>
        if s.lowercased().hasPrefix("<div style=\"font-family"), s.lowercased().hasSuffix("</div>"),
           let open = s.firstIndex(of: ">") {
            s = String(s[s.index(after: open)..<s.index(s.endIndex, offsetBy: -6)])
        }
        s = s.replacingOccurrences(of: "class=\"simplemail-signature\"", with: "class=\"sm-sig\"")
        s = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return s.isEmpty ? "<div><br></div>" : s
    }
}
