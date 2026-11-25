import SwiftUI
import WebKit
import AppKit

// MARK: - Drucken
//
// Baut aus einer E-Mail ein druckfertiges HTML-Dokument (Kopfzeilen + Inhalt + Anhangsliste),
// lädt es in eine unsichtbare WKWebView und öffnet den macOS-Druckdialog.
// „Als PDF sichern“ steht dort wie gewohnt unten links zur Verfügung.

@MainActor
enum MailPrinter {
    /// Laufende Druckaufträge festhalten, bis WebKit fertig geladen und gedruckt hat
    private static var jobs: [PrintJob] = []

    static func print(_ message: MailMessage, store: MailStore) {
        Task { @MainActor in
            if store.bodies[message.key] == nil {
                await store.loadBody(for: message)
            }
            guard let body = store.bodies[message.key] else {
                NSSound.beep()
                return
            }
            let html = document(for: message, body: body, store: store)
            let job = PrintJob(html: html, title: message.subject.isEmpty ? "E-Mail" : message.subject)
            job.onFinish = { finished in MailPrinter.jobs.removeAll { $0 === finished } }
            MailPrinter.jobs.append(job)
            job.start()
        }
    }

    // MARK: Dokument

    static func document(for m: MailMessage, body mb: MessageBody, store: MailStore) -> String {
        let e = HTMLTools.escape
        let allowRemote = store.remoteImagesAllowed(m)
        let csp = allowRemote
            ? "default-src 'none'; img-src * data:; style-src * 'unsafe-inline'; font-src * data:"
            : "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"

        var rows = "<tr><th>Von:</th><td>\(e(m.fromName.isEmpty ? m.fromAddress : "\(m.fromName) <\(m.fromAddress)>"))</td></tr>"
        if !m.to.isEmpty { rows += "<tr><th>An:</th><td>\(e(m.to))</td></tr>" }
        if !mb.cc.isEmpty { rows += "<tr><th>Cc:</th><td>\(e(mb.cc))</td></tr>" }
        rows += "<tr><th>Datum:</th><td>\(e(Formatters.full.string(from: m.date)))</td></tr>"
        let files = store.visibleAttachments(mb)
        if !files.isEmpty {
            let list = files.map { "\(e($0.filename)) (\(e($0.sizeText)))" }.joined(separator: ", ")
            rows += "<tr><th>Anhänge:</th><td>\(list)</td></tr>"
        }

        let content: String
        if let html = mb.html {
            content = store.preparedHTML(html, for: m, body: mb)
        } else {
            content = "<div class=\"sm-plain\">\(e(mb.text ?? ""))</div>"
        }

        return """
        <!DOCTYPE html>
        <html><head>
        <meta charset="utf-8">
        <meta http-equiv="Content-Security-Policy" content="\(csp)">
        <title>\(e(m.subject))</title>
        <style>
          body { font-family: -apple-system, Helvetica, sans-serif; font-size: 11pt; margin: 0; color: #000;
                 word-wrap: break-word; -webkit-print-color-adjust: exact; }
          .sm-head { border-bottom: 1px solid #999; padding-bottom: 8pt; margin-bottom: 12pt; }
          .sm-head h1 { font-size: 15pt; margin: 0 0 6pt 0; }
          .sm-head table { border-collapse: collapse; font-size: 9.5pt; }
          .sm-head th { text-align: left; vertical-align: top; color: #555; font-weight: 600;
                        padding: 1pt 8pt 1pt 0; white-space: nowrap; }
          .sm-head td { padding: 1pt 0; }
          .sm-plain { white-space: pre-wrap; font-family: -apple-system, Helvetica, sans-serif; }
          img { max-width: 100% !important; height: auto; }
          table { max-width: 100% !important; }
        </style>
        </head><body>
        <div class="sm-head">
          <h1>\(e(m.subject.isEmpty ? "(Kein Betreff)" : m.subject))</h1>
          <table>\(rows)</table>
        </div>
        \(content)
        </body></html>
        """
    }
}

/// Ein einzelner Druckvorgang mit eigener, unsichtbarer WebView
@MainActor
final class PrintJob: NSObject, WKNavigationDelegate {
    private let html: String
    private let title: String
    private var webView: WKWebView!
    private var window: NSWindow!
    var onFinish: ((PrintJob) -> Void)?

    init(html: String, title: String) {
        self.html = html
        self.title = title
        super.init()
    }

    func start() {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = false
        PrivacyRules.configure(config)
        let info = NSPrintInfo.shared
        let width = info.paperSize.width - info.leftMargin - info.rightMargin
        let frame = NSRect(x: 0, y: 0, width: max(width, 400), height: 800)
        webView = WKWebView(frame: frame, configuration: config)
        webView.customUserAgent = Privacy.userAgent
        webView.navigationDelegate = self
        // WebKit druckt zuverlässig nur, wenn die View in einem Fenster hängt – das Fenster bleibt unsichtbar
        window = NSWindow(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = webView
        window.setFrameOrigin(NSPoint(x: -20_000, y: -20_000))   // außerhalb des Bildschirms
        window.orderBack(nil)
        webView.loadHTMLString(html, baseURL: nil)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Kurz warten, damit eingebettete Bilder fertig dekodiert sind
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in self?.runPrint() }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { finish() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { finish() }

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        // Nur der eigene Inhalt (about:blank) – keine Weiterleitung per <meta refresh> auf fremde Seiten
        let own = navigationAction.navigationType == .other && navigationAction.request.url?.scheme?.lowercased() == "about"
        decisionHandler(own ? .allow : .cancel)
    }

    private func runPrint() {
        let info = (NSPrintInfo.shared.copy() as? NSPrintInfo) ?? NSPrintInfo()
        info.horizontalPagination = .fit
        info.verticalPagination = .automatic
        info.isHorizontallyCentered = false
        info.isVerticallyCentered = false
        info.topMargin = 36; info.bottomMargin = 36
        info.leftMargin = 40; info.rightMargin = 40
        info.jobDisposition = .spool

        let op = webView.printOperation(with: info)
        op.jobTitle = title
        op.showsPrintPanel = true
        op.showsProgressPanel = true
        op.printPanel.options.formUnion([.showsCopies, .showsPageRange, .showsPaperSize,
                                         .showsOrientation, .showsScaling, .showsPreview])
        op.view?.frame = webView.bounds

        if let host = NSApp.keyWindow ?? NSApp.mainWindow {
            op.runModal(for: host, delegate: self,
                        didRun: #selector(printOperationDidRun(_:success:contextInfo:)),
                        contextInfo: nil)
        } else {
            op.run()
            finish()
        }
    }

    @objc private func printOperationDidRun(_ op: NSPrintOperation, success: Bool,
                                            contextInfo: UnsafeMutableRawPointer?) {
        finish()
    }

    private func finish() {
        window?.contentView = nil
        window?.close()
        webView = nil
        window = nil
        onFinish?(self)
        onFinish = nil
    }
}
