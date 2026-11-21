import AppKit
import UniformTypeIdentifiers

/// Dateiart eines Anhangs, für die „Öffnen mit“ eingestellt werden kann
enum AttachmentKind: String {
    case doc, pdf, other
}

/// Programme, mit denen Anhänge geöffnet werden können.
/// Die Kennungen (word, libreoffice, wordcraft, preview, default) sind auf Mac und Windows gleich,
/// damit die Einstellung über die Synchronisation passt.
enum AttachmentApps {
    static let docExtensions: Set<String> = ["doc", "docx", "dot", "dotx", "odt", "ott", "rtf"]

    static func kind(of filename: String) -> AttachmentKind {
        let ext = (filename as NSString).pathExtension.lowercased()
        if ext == "pdf" { return .pdf }
        if docExtensions.contains(ext) { return .doc }
        return .other
    }

    /// Mögliche Programme je Dateiart (Reihenfolge = Anzeige)
    static func candidates(for kind: AttachmentKind) -> [String] {
        switch kind {
        case .doc: return ["word", "libreoffice", "wordcraft"]
        case .pdf: return ["preview"]
        case .other: return []
        }
    }

    /// Voreinstellung, solange nichts gewählt wurde
    static func defaultChoice(for kind: AttachmentKind) -> String {
        kind == .pdf ? "preview" : "default"
    }

    static func label(_ id: String) -> String {
        switch id {
        case "word": return "Microsoft Word"
        case "libreoffice": return "LibreOffice"
        case "wordcraft":
            if let url = appURL("wordcraft") { return FileManager.default.displayName(atPath: url.path) }
            return "Wordcraft"
        case "preview": return "Vorschau"
        default: return "Standard-App"
        }
    }

    /// Installierte Programme dieser Dateiart
    static func installed(for kind: AttachmentKind) -> [String] {
        candidates(for: kind).filter { appURL($0) != nil }
    }

    private static var found: [String: URL] = [:]
    private static var notFound: [String: Date] = [:]

    static func appURL(_ id: String) -> URL? {
        if let url = found[id], FileManager.default.fileExists(atPath: url.path) { return url }
        // Nicht gefundene Programme höchstens jede Minute neu suchen (falls inzwischen installiert)
        if let t = notFound[id], Date().timeIntervalSince(t) < 60 { return nil }
        let ws = NSWorkspace.shared
        var url: URL?
        switch id {
        case "word": url = ws.urlForApplication(withBundleIdentifier: "com.microsoft.Word")
        case "libreoffice": url = ws.urlForApplication(withBundleIdentifier: "org.libreoffice.script")
        case "preview": url = ws.urlForApplication(withBundleIdentifier: "com.apple.Preview")
        case "wordcraft": url = findApp(named: "wordcraft")
        default: url = nil
        }
        if let url {
            found[id] = url
            notFound[id] = nil
        } else {
            notFound[id] = Date()
        }
        return url
    }

    /// Sucht ein Programm über den Namen: erst unter den Apps, die Textdokumente öffnen können,
    /// dann in /Programme und ~/Programme
    private static func findApp(named part: String) -> URL? {
        var apps: [URL] = []
        for ext in ["docx", "doc", "rtf", "odt"] {
            if let t = UTType(filenameExtension: ext) {
                apps.append(contentsOf: NSWorkspace.shared.urlsForApplications(toOpen: t))
            }
        }
        if let hit = apps.first(where: { $0.lastPathComponent.lowercased().contains(part) }) { return hit }
        let dirs = ["/Applications", NSHomeDirectory() + "/Applications"]
        for dir in dirs {
            guard let items = try? FileManager.default.contentsOfDirectory(atPath: dir) else { continue }
            if let name = items.first(where: { $0.lowercased().contains(part) && $0.lowercased().hasSuffix(".app") }) {
                return URL(fileURLWithPath: dir).appendingPathComponent(name)
            }
        }
        return nil
    }
}
