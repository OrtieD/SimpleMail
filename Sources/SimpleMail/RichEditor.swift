import SwiftUI
import WebKit

// MARK: - Formatierter Editor zum Verfassen (WKWebView mit contenteditable)

/// Verbindung zwischen SwiftUI und dem Editor im WebView
final class EditorBridge: NSObject, WKScriptMessageHandler {
    weak var webView: WKWebView?
    var onChange: ((_ html: String, _ text: String) -> Void)?

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let d = message.body as? [String: Any] else { return }
        onChange?(d["html"] as? String ?? "", d["text"] as? String ?? "")
    }

    /// Swift-String sicher als JavaScript-String-Literal
    static func js(_ s: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: [s]),
              let arr = String(data: data, encoding: .utf8) else { return "\"\"" }
        return String(arr.dropFirst().dropLast())
    }

    func run(_ script: String) {
        webView?.evaluateJavaScript(script, completionHandler: nil)
    }

    func command(_ name: String, _ value: String? = nil) {
        run("SM.cmd(\(Self.js(name)), \(value.map { Self.js($0) } ?? "null"))")
    }

    func setSignature(_ html: String) { run("SM.setSignature(\(Self.js(html)))") }
    func insertText(_ text: String) { run("SM.insertText(\(Self.js(text)))") }
    func addLink(_ url: String) { run("SM.addLink(\(Self.js(url)))") }
    func focus() { run("SM.focus()") }
}

/// WebView, das ins Fenster gezogene Dateien als Anhänge weiterreicht statt sie zu öffnen
final class ComposeWebView: WKWebView {
    var onFiles: (([URL]) -> Void)?

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        let urls = sender.draggingPasteboard.readObjects(
            forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL] ?? []
        if !urls.isEmpty {
            onFiles?(urls)
            return true
        }
        return super.performDragOperation(sender)
    }
}

struct RichEditor: NSViewRepresentable {
    let initialHTML: String
    let bridge: EditorBridge
    var onFiles: ([URL]) -> Void

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> ComposeWebView {
        let config = WKWebViewConfiguration()
        config.userContentController.add(bridge, name: "sm")
        let view = ComposeWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.onFiles = onFiles
        bridge.webView = view
        view.loadHTMLString(Self.page(initialHTML), baseURL: nil)
        return view
    }

    func updateNSView(_ view: ComposeWebView, context: Context) {
        view.onFiles = onFiles
    }

    static func dismantleNSView(_ view: ComposeWebView, coordinator: Coordinator) {
        view.configuration.userContentController.removeScriptMessageHandler(forName: "sm")
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        func webView(_ webView: WKWebView,
                     decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            // Nur die eigene Seite laden – Links und Dateien öffnen nie im Editor
            if navigationAction.navigationType == .other, navigationAction.request.url?.absoluteString == "about:blank" {
                decisionHandler(.allow)
            } else {
                decisionHandler(.cancel)
            }
        }
    }

    static func page(_ content: String) -> String {
        // Nur das eigene Skript darf laufen (Nonce) – eingeschleuste Event-Handler (onerror …) in Signatur/Entwurf nicht
        let nonce = UUID().uuidString.replacingOccurrences(of: "-", with: "")
        return """
        <!DOCTYPE html><html><head><meta charset="utf-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: cid: https: http:; style-src 'unsafe-inline'; script-src 'nonce-\(nonce)'">
        <style>
          html, body { margin: 0; height: 100%; }
          body { font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 14px; color: #1b1b1b; background: #fff; }
          #ed { min-height: 100%; box-sizing: border-box; padding: 10px 14px 24px; outline: none; word-wrap: break-word; line-height: 1.45; }
          #ed img { max-width: 100%; height: auto; }
          #ed blockquote { margin: 4px 0 4px 2px; padding-left: 10px; border-left: 2px solid #b8b8b8; color: #555; }
          #ed a { color: #0f6cbd; }
          @media (prefers-color-scheme: dark) {
            body { background: #1e1e1e; color: #ececec; }
            #ed blockquote { color: #aaa; border-color: #555; }
            #ed a { color: #5aa9ff; }
          }
        </style></head>
        <body><div id="ed" contenteditable="true">\(content)</div>
        <script nonce="\(nonce)">
        (function () {
          const ed = document.getElementById('ed');
          let saved = null;
          document.execCommand('styleWithCSS', false, true);
          document.execCommand('defaultParagraphSeparator', false, 'div');
          function post() {
            window.webkit.messageHandlers.sm.postMessage({ html: ed.innerHTML, text: ed.innerText });
          }
          function inside(node) { return node && (node === ed || ed.contains(node)); }
          document.addEventListener('selectionchange', function () {
            const s = window.getSelection();
            if (s.rangeCount && inside(s.anchorNode)) saved = s.getRangeAt(0).cloneRange();
          });
          function restore() {
            ed.focus();
            if (saved) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(saved); }
          }
          function caretBeforeSignature() {
            const sig = ed.querySelector('.sm-sig');
            const r = document.createRange();
            if (sig) {
              let prev = sig.previousSibling;
              if (prev) { r.selectNodeContents(prev); r.collapse(false); } else { r.setStartBefore(sig); r.collapse(true); }
            } else { r.selectNodeContents(ed); r.collapse(false); }
            const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
          }
          function esc(t) { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
          window.SM = {
            focus: function () { ed.focus(); if (!saved) { const r = document.createRange(); r.setStart(ed, 0); r.collapse(true); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); } },
            cmd: function (name, value) { restore(); document.execCommand(name, false, value); post(); },
            insertText: function (t) {
              if (saved) restore(); else { ed.focus(); caretBeforeSignature(); }
              document.execCommand('insertText', false, t); post();
            },
            addLink: function (url) {
              restore();
              const s = window.getSelection();
              if (!s.rangeCount || s.isCollapsed) {
                document.execCommand('insertHTML', false, '<a href="' + esc(url) + '">' + esc(url.replace(/^mailto:|^tel:/i, '')) + '</a>&nbsp;');
              } else {
                document.execCommand('createLink', false, url);
              }
              post();
            },
            setSignature: function (html) {
              let sig = ed.querySelector('.sm-sig');
              if (!html) { if (sig) sig.remove(); post(); return; }
              if (!sig) {
                sig = document.createElement('div');
                sig.className = 'sm-sig';
                const quote = ed.querySelector('.sm-quote');
                if (quote) ed.insertBefore(sig, quote); else ed.appendChild(sig);
                const gap = document.createElement('div'); gap.innerHTML = '<br>';
                ed.insertBefore(gap, sig);
              }
              sig.innerHTML = html;
              post();
            }
          };
          ed.addEventListener('input', post);
          ed.addEventListener('keydown', function (e) {
            if (!e.metaKey || e.altKey || e.ctrlKey) return;
            const k = e.key.toLowerCase();
            const map = { b: 'bold', i: 'italic', u: 'underline' };
            if (!e.shiftKey && map[k]) { e.preventDefault(); document.execCommand(map[k]); post(); }
          });
          ed.addEventListener('dragover', function (e) { if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault(); });
          ed.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files.length) e.preventDefault(); });
          post();
        })();
        </script></body></html>
        """
    }
}
