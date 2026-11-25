import SwiftUI
import AppKit

// MARK: - mailto: Klick auf eine E-Mail-Adresse öffnet den eigenen Editor (gleiches Verhalten wie Windows 3.2.17)

enum Mailto {
    struct Parts {
        var to: [String] = []
        var cc: [String] = []
        var subject = ""
        var body = ""
    }

    /// mailto:-Link zerlegen (RFC 6068): An, cc/bcc, subject, body
    static func parse(_ url: URL) -> Parts {
        var p = Parts()
        let raw = url.absoluteString
        guard raw.lowercased().hasPrefix("mailto:") else { return p }
        let rest = String(raw.dropFirst(7))
        let qMark = rest.firstIndex(of: "?")
        let addrPart = qMark.map { String(rest[..<$0]) } ?? rest
        p.to = list(decode(addrPart))
        if let qi = qMark {
            let query = String(rest[rest.index(after: qi)...])
            for item in query.split(separator: "&", omittingEmptySubsequences: true) {
                let s = String(item)
                let eq = s.firstIndex(of: "=")
                let key = (eq.map { String(s[..<$0]) } ?? s).lowercased()
                let value = eq.map { decode(String(s[s.index(after: $0)...])) } ?? ""
                switch key {
                case "to": p.to += list(value)
                case "cc", "bcc": p.cc += list(value)   // kein Bcc-Feld → in Cc, damit nichts verloren geht
                case "subject": p.subject = value
                case "body": p.body = value.replacingOccurrences(of: "\r\n", with: "\n")
                default: break
                }
            }
        }
        return p
    }

    private static func decode(_ s: String) -> String {
        s.removingPercentEncoding ?? s
    }

    private static func list(_ s: String) -> [String] {
        s.split(whereSeparator: { $0 == "," || $0 == ";" })
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    static func isMailto(_ url: URL) -> Bool { url.scheme?.lowercased() == "mailto" }

    /// Text mit anklickbaren Web-Links und E-Mail-Adressen (für Text-Mails)
    static func linkified(_ text: String) -> AttributedString {
        var out = AttributedString(text)
        guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else { return out }
        let ns = text as NSString
        for match in detector.matches(in: text, options: [], range: NSRange(location: 0, length: ns.length)) {
            guard let url = match.url, let r = Range(match.range, in: text) else { continue }
            let startOffset = text.distance(from: text.startIndex, to: r.lowerBound)
            let length = text.distance(from: r.lowerBound, to: r.upperBound)
            let lo = out.characters.index(out.startIndex, offsetBy: startOffset)
            let hi = out.characters.index(lo, offsetBy: length)
            out[lo..<hi].link = url
        }
        return out
    }

    /// Kopfzeile (An/Cc) mit anklickbaren Adressen
    static func addressLine(_ prefix: String, _ text: String) -> AttributedString {
        var out = AttributedString(prefix)
        out.append(linkified(text))
        return out
    }
}

/// Hauptfenster merken, damit der Editor auch aus einem eigenen Mail-Fenster dort erscheint
final class MainWindowRef {
    static weak var window: NSWindow?
}

struct MainWindowFinder: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        let v = NSView()
        DispatchQueue.main.async { MainWindowRef.window = v.window }
        return v
    }
    func updateNSView(_ nsView: NSView, context: Context) {
        if MainWindowRef.window == nil { DispatchQueue.main.async { MainWindowRef.window = nsView.window } }
    }
}

extension MailStore {
    func mailtoDraft(_ url: URL, accountID: UUID?) -> Draft {
        let parts = Mailto.parse(url)
        var d = Draft()
        if let a = accountID, account(a) != nil { d.accountID = a } else { d.accountID = newDraft().accountID }
        let show: (String) -> String = { addr in
            if let c = self.card(forEmail: addr), !c.name.isEmpty, !addr.contains("<") { return "\(c.name) <\(addr)>" }
            return addr
        }
        d.to = parts.to.map(show).joined(separator: ", ")
        d.cc = parts.cc.map(show).joined(separator: ", ")
        d.subject = parts.subject
        d.body = parts.body + signatureBlock(account(d.accountID))
        return d
    }

    /// mailto: → Verfassen-Fenster im Hauptfenster
    func composeMailto(_ url: URL, accountID: UUID?) {
        guard !accounts.isEmpty else { return }
        guard composeDraft == nil else { NSSound.beep(); return }
        composeDraft = mailtoDraft(url, accountID: accountID)
        NSApp.activate(ignoringOtherApps: true)
        if let w = MainWindowRef.window {
            if w.isMiniaturized { w.deminiaturize(nil) }
            w.makeKeyAndOrderFront(nil)
        }
    }

    /// Link-Klick in einer Mail: mailto → eigener Editor, alles andere → Standard-App
    func openLink(_ url: URL, accountID: UUID?) {
        if Mailto.isMailto(url) { composeMailto(url, accountID: accountID) }
        else { SafeLink.open(url) }
    }
}

// MARK: - Sichere Links (Sicherheit 2.25)

/// Links aus Mails öffnen nur Webseiten und Telefonnummern. file://, smb://, afp://, vnc://, ssh:// und
/// fremde App-Schemata würden sonst Programme starten oder Netzlaufwerke einbinden (wie Windows: nur http/https/mailto).
enum SafeLink {
    static let allowedSchemes: Set<String> = ["http", "https", "tel"]

    static func isAllowed(_ url: URL) -> Bool {
        allowedSchemes.contains((url.scheme ?? "").lowercased())
    }

    static func open(_ url: URL) {
        if isAllowed(url) {
            NSWorkspace.shared.open(Privacy.cleanLink(url))   // ohne utm_* & Co. (2.47)
            return
        }
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "Link aus Sicherheitsgründen nicht geöffnet"
        let shown = url.absoluteString.count > 200 ? String(url.absoluteString.prefix(200)) + "…" : url.absoluteString
        alert.informativeText = "SimpleMail öffnet aus E-Mails nur Webseiten (http/https) und E-Mail-Adressen.\n\n\(shown)"
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }
}
