import Foundation

/// Diagnose-Protokoll (2.36/2.37 für die Smart-Inbox-Suche) – seit 2.38 abgeschaltet, bei Bedarf wieder Diag.log(...) aufrufen.
/// Schreibt nur, wenn ~/Desktop/SimpleMail/diagnose.log schon existiert.
enum Diag {
    private static let queue = DispatchQueue(label: "simplemail.diagnose")
    private static let url = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Desktop/SimpleMail/diagnose.log")

    static func log(_ text: String) {
        let target = url
        queue.async {
            guard let h = try? FileHandle(forWritingTo: target) else { return }
            _ = try? h.seekToEnd()
            try? h.write(contentsOf: Data("\(Date())  \(text)\n".utf8))
            try? h.close()
        }
    }
}
