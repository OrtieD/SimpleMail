import Foundation
#if canImport(WebKit)
import WebKit
#endif

// MARK: - Tracking-Schutz (2.47) – gleiche Listen und Regeln wie Windows security.js / app.js scanTracking

enum Privacy {
    /// Reine Tracking-Dienste: Bilder von dort werden immer entfernt bzw. gar nicht abgerufen
    static let trackerHosts: [String] = [
        "list-manage.com", "mandrillapp.com", "mcsv.net", "sendgrid.net", "mailgun.org", "hubspotemail.net", "hubspotlinks.com",
        "hs-analytics.net", "track.hubspot.com", "awstrack.me", "mjt.lu", "sendibt2.com", "sendibt3.com", "sendibw.com",
        "klclick.com", "klclick1.com", "cmail19.com", "cmail20.com", "rs6.net", "exct.net", "customeriomail.com",
        "track.customer.io", "pstmrk.it", "via.intercom.io", "mailtrack.io", "t.yesware.com", "mailfoogae.appspot.com",
        "getnotify.com", "bananatag.com", "track.mixmax.com", "r.superhuman.com", "sidekickopen01.com", "acemlna.com",
        "acemlnb.com", "acemlnc.com", "acemlnd.com", "crsend.com", "mlsend.com", "zcsend.net", "dripemail2.com",
        "doubleclick.net", "google-analytics.com", "googletagmanager.com", "pixel.wp.com", "mathtag.com", "emltrk.com",
        "returnpath.net", "nl-tracking.com", "pippio.com", "liadm.com", "mi-msg.com", "eccmp.com", "emailopen.net",
    ]
    /// Typische Pfade von Öffnungs-Pixeln
    static let trackerPath = #"(?i)(/track(ing)?/(open|o)\b|/open\.(php|aspx|gif|jsp)|/wf/open|/e/o/|/oo/|/o\.gif|/on\.jsp|/trk/|/pixel(\.gif|\.png|/|\?|$)|/beacon\b|/openrate|/imp\?|/t\.gif|/tr\?|/mpss/o/|/ss/o/)"#

    /// Tracking-Parameter, die beim Öffnen eines Links entfernt werden
    static let trackingParams: Set<String> = [
        "fbclid", "gclid", "gclsrc", "dclid", "gbraid", "wbraid", "msclkid", "yclid", "twclid", "ttclid", "li_fat_id",
        "mc_cid", "mc_eid", "_hsenc", "_hsmi", "__hssc", "__hstc", "__hsfp", "hsctatracking", "mkt_tok", "oly_anon_id", "oly_enc_id",
        "vero_conv", "vero_id", "wickedid", "igshid", "_ke", "ck_subscriber_id", "ml_subscriber", "ml_subscriber_hash", "sc_cid", "s_cid",
        "ecid", "ncid", "trk_contact", "trk_msg", "trk_module", "trk_sid", "sfmc_id", "sfmc_activityid", "et_rid", "et_cid", "cmpid", "mbid",
    ]

    /// Allgemeine Browser-Kennung statt „SimpleMail“/WebKit-App-Name
    static let userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"

    struct Stripped {
        let html: String
        let count: Int
        let hosts: [String]
    }

    // MARK: Adressen

    private static func url(_ s: String) -> URL? {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "&amp;", with: "&")
        if t.hasPrefix("//") { return URL(string: "https:" + t) }
        return URL(string: t)
    }

    static func host(_ s: String) -> String {
        (url(s)?.host ?? "").lowercased()
    }

    static func isRemote(_ s: String) -> Bool {
        s.range(of: #"^\s*(https?:)?//"#, options: [.regularExpression, .caseInsensitive]) != nil
    }

    static func isTrackerURL(_ s: String) -> Bool {
        guard let u = url(s), let h = u.host?.lowercased(), !h.isEmpty else { return false }
        if trackerHosts.contains(where: { h == $0 || h.hasSuffix("." + $0) }) { return true }
        var p = u.path
        if let q = u.query { p += "?" + q }
        return p.range(of: trackerPath, options: .regularExpression) != nil
    }

    /// Link ohne utm_* und bekannte Tracking-Kennungen; andere Parameter bleiben unverändert
    static func cleanLink(_ link: URL) -> URL {
        guard let scheme = link.scheme?.lowercased(), scheme == "http" || scheme == "https",
              var comps = URLComponents(url: link, resolvingAgainstBaseURL: false),
              let items = comps.queryItems, !items.isEmpty else { return link }
        let kept = items.filter { item in
            let k = item.name.lowercased()
            return !k.hasPrefix("utm_") && !trackingParams.contains(k)
        }
        if kept.count == items.count { return link }
        comps.queryItems = kept.isEmpty ? nil : kept
        return comps.url ?? link
    }

    // MARK: HTML

    private static func attr(_ tag: String, _ name: String) -> String? {
        let pattern = #"(?is)(?:^|[\s"'/])"# + name + #"\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))"#
        guard let re = try? NSRegularExpression(pattern: pattern) else { return nil }
        let ns = tag as NSString
        guard let m = re.firstMatch(in: tag, range: NSRange(location: 0, length: ns.length)) else { return nil }
        for i in 2...4 {
            let r = m.range(at: i)
            if r.location != NSNotFound { return ns.substring(with: r) }
        }
        return nil
    }

    private static func number(_ s: String?) -> Double? {
        guard let s else { return nil }
        let digits = s.trimmingCharacters(in: .whitespaces).prefix { $0.isNumber || $0 == "." }
        return Double(digits)
    }

    private static func styleNumber(_ style: String, _ prop: String) -> Double? {
        let pattern = #"(?:^|;)(?:max-)?"# + prop + #":(\d+(?:\.\d+)?)px"#
        guard let re = try? NSRegularExpression(pattern: pattern) else { return nil }
        let ns = style as NSString
        guard let m = re.firstMatch(in: style, range: NSRange(location: 0, length: ns.length)) else { return nil }
        return Double(ns.substring(with: m.range(at: 1)))
    }

    /// Winzig oder unsichtbar: typisches Zählpixel
    private static func isPixel(_ tag: String) -> Bool {
        let style = (attr(tag, "style") ?? "").lowercased().replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: "\n", with: "").replacingOccurrences(of: "\t", with: "")
        let w = number(attr(tag, "width")) ?? styleNumber(style, "width")
        let h = number(attr(tag, "height")) ?? styleNumber(style, "height")
        if let w, w <= 3, (h == nil || h! <= 3) { return true }
        if let h, h <= 3, w == nil { return true }
        return style.range(of: #"display:none|visibility:hidden|opacity:0([;.]|$)"#, options: .regularExpression) != nil
    }

    private static func replace(_ html: String, _ pattern: String, _ transform: (String) -> String?) -> String {
        guard let re = try? NSRegularExpression(pattern: pattern) else { return html }
        let ns = html as NSString
        let matches = re.matches(in: html, range: NSRange(location: 0, length: ns.length))
        if matches.isEmpty { return html }
        let out = NSMutableString(string: html)
        for m in matches.reversed() {
            let whole = ns.substring(with: m.range)
            if let repl = transform(whole) { out.replaceCharacters(in: m.range, with: repl) }
        }
        return out as String
    }

    /// Entfernt Zählpixel, Tracker-Bilder/-Hintergründe/-Stylesheets, ping-Attribute und Vorab-Verbindungen
    static func strip(_ html: String) -> Stripped {
        var count = 0
        var hosts = Set<String>()
        func hit(_ u: String) {
            count += 1
            var h = host(u)
            if h.hasPrefix("www.") { h = String(h.dropFirst(4)) }
            if !h.isEmpty { hosts.insert(h) }
        }
        var h = html
        // Bilder
        h = replace(h, #"(?is)<(img|image|input)\b[^>]*>"#) { tag in
            if tag.lowercased().hasPrefix("<input"), attr(tag, "type")?.lowercased() != "image" { return nil }
            let src = attr(tag, "src") ?? attr(tag, "href") ?? attr(tag, "xlink:href") ?? ""
            let srcset = attr(tag, "srcset") ?? ""
            guard isRemote(src) || srcset.range(of: "//") != nil else { return nil }
            if isTrackerURL(src) || isPixel(tag) { hit(src); return "" }
            return nil
        }
        // background="…" an Tabellen/Zellen
        h = replace(h, #"(?is)\sbackground\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)"#) { a in
            let v = a.replacingOccurrences(of: #"(?is)^\sbackground\s*=\s*["']?|["']$"#, with: "", options: .regularExpression)
            if isRemote(v) && isTrackerURL(v) { hit(v); return "" }
            return nil
        }
        // url(…) in style-Attributen und <style>
        h = replace(h, #"(?i)url\(\s*["']?\s*((?:https?:)?//[^"')\s]+)\s*["']?\s*\)"#) { css in
            let v = css.replacingOccurrences(of: #"(?i)^url\(\s*["']?\s*|\s*["']?\s*\)$"#, with: "", options: .regularExpression)
            if isTrackerURL(v) { hit(v); return "none" }
            return nil
        }
        // <link>: Tracker-Stylesheets und Vorab-Verbindungen
        h = replace(h, #"(?is)<link\b[^>]*>"#) { tag in
            let rel = (attr(tag, "rel") ?? "").lowercased()
            if ["preconnect", "dns-prefetch", "prefetch", "preload"].contains(where: { rel.contains($0) }) { return "" }
            let href = attr(tag, "href") ?? ""
            if isRemote(href) && isTrackerURL(href) { hit(href); return "" }
            return nil
        }
        // Hyperlink-Auditing und automatische Weiterleitung
        h = replace(h, #"(?is)\sping\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)"#) { _ in "" }
        h = replace(h, #"(?is)<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>"#) { _ in "" }
        return Stripped(html: h, count: count, hosts: hosts.sorted())
    }
}

#if canImport(WebKit)
// MARK: - WebKit-Regeln (keine Cookies, Tracker-Adressen und ping gesperrt)

enum PrivacyRules {
    // Nur im Hauptthread benutzt (HTMLView/Druck); WebKit ruft die Übersetzung im Hauptthread zurück
    nonisolated(unsafe) private static var compiled: WKContentRuleList?
    nonisolated(unsafe) private static var compiling = false
    nonisolated(unsafe) private static var waiting: [(WKContentRuleList) -> Void] = []

    static var ruleJSON: String {
        var rules: [[String: Any]] = [
            ["trigger": ["url-filter": ".*"], "action": ["type": "block-cookies"]],
            ["trigger": ["url-filter": ".*", "resource-type": ["ping"]], "action": ["type": "block"]],
        ]
        for d in Privacy.trackerHosts {
            let esc = d.replacingOccurrences(of: ".", with: "\\.")
            rules.append(["trigger": ["url-filter": "^https?://" + esc + "[/:?]"], "action": ["type": "block"]])
            rules.append(["trigger": ["url-filter": "^https?://[^/]*\\." + esc + "[/:?]"], "action": ["type": "block"]])
        }
        let data = (try? JSONSerialization.data(withJSONObject: rules)) ?? Data("[]".utf8)
        return String(data: data, encoding: .utf8) ?? "[]"
    }

    /// Regeln einmal übersetzen und an jede Mail-Ansicht hängen
    static func withRules(_ use: @escaping (WKContentRuleList) -> Void) {
        if let c = compiled { use(c); return }
        waiting.append(use)
        if compiling { return }
        compiling = true
        WKContentRuleListStore.default()?.compileContentRuleList(forIdentifier: "simplemail-privacy-1", encodedContentRuleList: ruleJSON) { list, _ in
            compiling = false
            guard let list else { waiting.removeAll(); return }
            compiled = list
            let all = waiting
            waiting.removeAll()
            for u in all { u(list) }
        }
    }

    /// WebView-Einstellungen für Mail-Inhalte: nichts speichern, keine Cookies, allgemeine Kennung
    static func configure(_ config: WKWebViewConfiguration) {
        config.websiteDataStore = .nonPersistent()
        let ucc = config.userContentController
        withRules { ucc.add($0) }
    }
}
#endif
