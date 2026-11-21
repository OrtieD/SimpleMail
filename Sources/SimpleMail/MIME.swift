import Foundation
import UniformTypeIdentifiers

/// Minimaler MIME-Parser: Header, RFC 2047, Quoted-Printable, Base64, Multipart
enum MIME {
    struct Extracted {
        var text: String?
        var html: String?
        var calendar: String?
        var attachments: [MailAttachment] = []
    }

    // MARK: - Header / Body

    static func splitHeaderAndBody(_ input: Data) -> (header: Data, body: Data) {
        let d = Data(input)
        if d.starts(with: [13, 10]) { return (Data(), d.subdata(in: 2..<d.count)) }
        if d.starts(with: [10]) { return (Data(), d.subdata(in: 1..<d.count)) }
        if let r = d.range(of: Data([13, 10, 13, 10])) {
            return (d.subdata(in: 0..<r.lowerBound), d.subdata(in: r.upperBound..<d.count))
        }
        if let r = d.range(of: Data([10, 10])) {
            return (d.subdata(in: 0..<r.lowerBound), d.subdata(in: r.upperBound..<d.count))
        }
        return (d, Data())
    }

    static func parseHeaders(_ data: Data) -> [String: String] {
        let raw = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) ?? ""
        var result: [String: String] = [:]
        var currentKey: String?
        for line in raw.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n") {
            if line.isEmpty { continue }
            if let first = line.first, first == " " || first == "\t" {
                if let key = currentKey {
                    result[key, default: ""] += " " + line.trimmingCharacters(in: .whitespaces)
                }
            } else if let colon = line.firstIndex(of: ":") {
                let key = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
                let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
                if result[key] == nil {
                    result[key] = value
                    currentKey = key
                } else {
                    currentKey = nil
                }
            }
        }
        return result
    }

    // MARK: - RFC 2047 encoded words

    static func decodeHeader(_ value: String) -> String {
        guard value.contains("=?"),
              let regex = try? NSRegularExpression(pattern: #"=\?([^?]+)\?([BbQq])\?([^?]*)\?="#)
        else { return value }

        let ns = value as NSString
        var result = ""
        var last = 0
        var lastWasEncoded = false
        var pending = Data()
        var pendingCharset: String?

        func flush() {
            if let cs = pendingCharset { result += decodeText(pending, charset: cs) }
            pending = Data()
            pendingCharset = nil
        }

        for m in regex.matches(in: value, range: NSRange(location: 0, length: ns.length)) {
            let gap = ns.substring(with: NSRange(location: last, length: m.range.location - last))
            if !(lastWasEncoded && gap.trimmingCharacters(in: .whitespaces).isEmpty) {
                flush()
                result += gap
            }
            var charset = ns.substring(with: m.range(at: 1))
            if let star = charset.firstIndex(of: "*") { charset = String(charset[..<star]) }
            let enc = ns.substring(with: m.range(at: 2)).uppercased()
            let text = ns.substring(with: m.range(at: 3))
            let bytes: Data = enc == "B"
                ? (Data(base64Encoded: padBase64(text), options: .ignoreUnknownCharacters) ?? Data())
                : decodeQuotedPrintable(Data(text.utf8), header: true)
            if let cs = pendingCharset, cs.lowercased() != charset.lowercased() { flush() }
            pending.append(bytes)
            pendingCharset = charset
            last = m.range.location + m.range.length
            lastWasEncoded = true
        }
        flush()
        result += ns.substring(from: last)
        return result
    }

    private static func padBase64(_ s: String) -> String {
        let rem = s.count % 4
        return rem == 0 ? s : s + String(repeating: "=", count: 4 - rem)
    }

    // MARK: - Zeichensätze & Transfer-Encodings

    static func decodeText(_ data: Data, charset: String?) -> String {
        let cs = (charset ?? "utf-8").trimmingCharacters(in: .whitespaces)
        let cf = CFStringConvertIANACharSetNameToEncoding(cs as CFString)
        if cf != kCFStringEncodingInvalidId {
            let enc = String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(cf))
            if let s = String(data: data, encoding: enc) { return s }
        }
        return String(data: data, encoding: .utf8)
            ?? String(data: data, encoding: .isoLatin1)
            ?? String(decoding: data, as: UTF8.self)
    }

    static func decodeQuotedPrintable(_ data: Data, header: Bool = false) -> Data {
        let b = [UInt8](data)
        var out = Data(capacity: b.count)
        var i = 0
        while i < b.count {
            let c = b[i]
            if c == UInt8(ascii: "=") {
                // Soft line break
                if i + 1 < b.count, b[i + 1] == 13 || b[i + 1] == 10 {
                    i += (i + 2 < b.count && b[i + 1] == 13 && b[i + 2] == 10) ? 3 : 2
                    continue
                }
                if i + 2 < b.count,
                   let hex = String(bytes: b[(i + 1)...(i + 2)], encoding: .ascii),
                   let v = UInt8(hex, radix: 16) {
                    out.append(v)
                    i += 3
                    continue
                }
                out.append(c)
                i += 1
            } else if header && c == UInt8(ascii: "_") {
                out.append(32)
                i += 1
            } else {
                out.append(c)
                i += 1
            }
        }
        return out
    }

    static func decodeTransfer(_ data: Data, encoding: String?) -> Data {
        switch encoding?.lowercased().trimmingCharacters(in: .whitespaces) {
        case "base64":
            return Data(base64Encoded: String(decoding: data, as: UTF8.self),
                        options: .ignoreUnknownCharacters) ?? data
        case "quoted-printable":
            return decodeQuotedPrintable(data)
        default:
            return data
        }
    }

    /// "text/plain; charset=utf-8" → ("text/plain", ["charset": "utf-8"])
    static func parseParams(_ value: String) -> (value: String, params: [String: String]) {
        var parts: [String] = []
        var current = ""
        var inQuotes = false
        for ch in value {
            if ch == "\"" { inQuotes.toggle(); current.append(ch) }
            else if ch == ";" && !inQuotes { parts.append(current); current = "" }
            else { current.append(ch) }
        }
        parts.append(current)

        let main = parts.first?.trimmingCharacters(in: .whitespaces).lowercased() ?? ""
        var params: [String: String] = [:]
        for p in parts.dropFirst() {
            guard let eq = p.firstIndex(of: "=") else { continue }
            var key = p[..<eq].trimmingCharacters(in: .whitespaces).lowercased()
            var val = p[p.index(after: eq)...].trimmingCharacters(in: .whitespaces)
            if val.count >= 2, val.hasPrefix("\""), val.hasSuffix("\"") {
                val = String(val.dropFirst().dropLast())
            }
            if key.hasSuffix("*") {   // RFC 2231: charset''wert%20mit%20encoding
                key.removeLast()
                if let r = val.range(of: "''") { val = String(val[r.upperBound...]) }
                val = val.removingPercentEncoding ?? val
            }
            params[key] = val
        }
        // RFC 2231 Fortsetzungen: filename*0, filename*1, …
        for base in ["filename", "name"] where params[base] == nil {
            var joined = ""
            var i = 0
            while let seg = params["\(base)*\(i)"] {
                joined += seg
                i += 1
            }
            if !joined.isEmpty { params[base] = joined }
        }
        return (main, params)
    }

    // MARK: - Nachricht zerlegen

    static func extract(raw: Data) -> (headers: [String: String], content: Extracted) {
        let (h, b) = splitHeaderAndBody(raw)
        let headers = parseHeaders(h)
        var out = Extracted()
        walk(headers: headers, body: b, into: &out)
        return (headers, out)
    }

    private static func walk(headers: [String: String], body: Data, into out: inout Extracted) {
        let (type, params) = parseParams(headers["content-type"] ?? "text/plain; charset=us-ascii")
        let (disposition, dparams) = parseParams(headers["content-disposition"] ?? "")

        if type.hasPrefix("multipart/"), let boundary = params["boundary"] {
            for part in splitMultipart(body, boundary: boundary) {
                let (ph, pb) = splitHeaderAndBody(part)
                walk(headers: parseHeaders(ph), body: pb, into: &out)
            }
            return
        }
        if type == "message/rfc822" {
            let (ph, pb) = splitHeaderAndBody(decodeTransfer(body, encoding: headers["content-transfer-encoding"]))
            walk(headers: parseHeaders(ph), body: pb, into: &out)
            return
        }

        let filename = dparams["filename"] ?? params["name"]
        // Termin-Einladung (text/calendar bzw. .ics)
        if type == "text/calendar" || type == "application/ics" || (filename ?? "").lowercased().hasSuffix(".ics") {
            let decoded = decodeTransfer(body, encoding: headers["content-transfer-encoding"])
            if out.calendar == nil { out.calendar = decodeText(decoded, charset: params["charset"] ?? "utf-8") }
            return
        }
        let cid = headers["content-id"].map { $0.trimmingCharacters(in: CharacterSet(charactersIn: "<> ")) }
        let isAttachment = disposition == "attachment" || (filename != nil && !type.hasPrefix("text/"))
        let isInlineImage = type.hasPrefix("image/") && cid != nil && disposition != "attachment"
        if isAttachment || isInlineImage {
            let data = decodeTransfer(body, encoding: headers["content-transfer-encoding"])
            out.attachments.append(MailAttachment(
                filename: DangerousFiles.clean(decodeHeader(filename ?? cid ?? "Anhang")),
                mimeType: type,
                data: data,
                contentID: cid,
                isInline: isInlineImage))
            return
        }
        guard type == "text/plain" || type == "text/html" else { return }

        let decoded = decodeTransfer(body, encoding: headers["content-transfer-encoding"])
        let text = decodeText(decoded, charset: params["charset"])
        if type == "text/plain", out.text == nil { out.text = text }
        if type == "text/html", out.html == nil { out.html = text }
    }

    private static func splitMultipart(_ input: Data, boundary: String) -> [Data] {
        let body = Data(input)
        let delim = Data(("--" + boundary).utf8)
        var positions: [Range<Int>] = []
        var searchStart = 0
        while searchStart < body.count,
              let r = body.range(of: delim, in: searchStart..<body.count) {
            if r.lowerBound == 0 || body[r.lowerBound - 1] == 10 { positions.append(r) }
            searchStart = r.upperBound
        }

        var parts: [Data] = []
        for (i, r) in positions.enumerated() {
            // Schlussgrenze "--boundary--"
            if r.upperBound + 1 < body.count, body[r.upperBound] == 45, body[r.upperBound + 1] == 45 { break }
            guard i + 1 < positions.count else { break }
            var start = r.upperBound
            while start < body.count && body[start] != 10 { start += 1 }
            start = min(start + 1, body.count)
            var end = positions[i + 1].lowerBound
            if end > start, body[end - 1] == 10 { end -= 1 }
            if end > start, body[end - 1] == 13 { end -= 1 }
            if end > start { parts.append(body.subdata(in: start..<end)) }
        }
        return parts
    }

    // MARK: - Adressen & Datum

    static func parseAddress(_ value: String) -> (name: String, address: String) {
        let decoded = decodeHeader(value)
        if let lt = decoded.lastIndex(of: "<"), let gt = decoded.lastIndex(of: ">"), lt < gt {
            let addr = String(decoded[decoded.index(after: lt)..<gt]).trimmingCharacters(in: .whitespaces)
            let name = decoded[..<lt]
                .trimmingCharacters(in: .whitespaces)
                .trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
            return (name, addr)
        }
        return ("", decoded.trimmingCharacters(in: .whitespaces))
    }

    private static let dateFormatters: [DateFormatter] = [
        "EEE, d MMM yyyy HH:mm:ss Z", "d MMM yyyy HH:mm:ss Z",
        "EEE, d MMM yyyy HH:mm:ss zzz", "d MMM yyyy HH:mm:ss zzz",
        "EEE, d MMM yyyy HH:mm Z", "d MMM yyyy HH:mm Z"
    ].map { format in
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = format
        return f
    }

    static func parseDate(_ value: String?) -> Date? {
        guard var v = value else { return nil }
        if let paren = v.firstIndex(of: "(") { v = String(v[..<paren]) }
        v = v.components(separatedBy: .whitespaces).filter { !$0.isEmpty }.joined(separator: " ")
        for f in dateFormatters {
            if let d = f.date(from: v) { return d }
        }
        return nil
    }
}

/// Baut eine ausgehende Nachricht (UTF-8, Base64, optional multipart/mixed mit Anhängen)
enum MessageBuilder {
    static let maxAttachmentBytes = 20 * 1024 * 1024

    static func build(_ d: Draft, account: Account) throws -> (data: Data, recipients: [String]) {
        let to = addresses(d.to)
        let cc = addresses(d.cc)
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.dateFormat = "EEE, dd MMM yyyy HH:mm:ss Z"
        let domain = account.email.split(separator: "@").last.map(String.init) ?? "localhost"

        var h: [String] = []
        let name = account.displayName.isEmpty ? "" : encodeWord(account.displayName) + " "
        h.append("From: \(name)<\(account.email)>")
        h.append("To: \(to.joined(separator: ", "))")
        if !cc.isEmpty { h.append("Cc: \(cc.joined(separator: ", "))") }
        h.append("Subject: \(encodeWord(d.subject))")
        h.append("Date: \(df.string(from: Date()))")
        h.append("Message-ID: <\(UUID().uuidString)@\(domain)>")
        if let irt = d.inReplyTo, !irt.isEmpty { h.append("In-Reply-To: \(irt)") }
        if let refs = d.references, !refs.isEmpty { h.append("References: \(refs)") }
        h.append("MIME-Version: 1.0")

        h.append("User-Agent: SimpleMail/2.6")

        let normalized = d.body
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\n", with: "\r\n")
        let textPart = Part(headers: ["Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64"],
                            body: base64(Data(normalized.utf8)))

        // Text oder (bei formatierter Signatur) Text + HTML
        var main = textPart
        let richPart: (String, [Part])?
        if let edited = d.bodyHtml, !edited.isEmpty {
            richPart = composedHtml(edited)
        } else {
            richPart = htmlBody(d.body, account: account)
        }
        if let rich = richPart {
            let (html, images) = rich
            let htmlPart = Part(headers: ["Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: base64"],
                                body: base64(Data(html.utf8)))
            let htmlWithImages = images.isEmpty ? htmlPart : multipart("related", [htmlPart] + images)
            main = multipart("alternative", [textPart, htmlWithImages])
        }

        // Antwort auf eine Einladung (iMIP): Text + text/calendar
        // Eigene Einladung (REQUEST): Text + HTML + text/calendar, dazu einladung.ics als Datei
        var icsFile: Part? = nil
        if let cal = d.calendarReply {
            let method = d.calendarMethod == "REQUEST" ? "REQUEST" : "REPLY"
            let calPart = Part(headers: ["Content-Type: text/calendar; charset=utf-8; method=\(method)",
                                         "Content-Transfer-Encoding: base64"],
                               body: base64(Data(cal.utf8)))
            if method == "REQUEST" {
                var alts = [textPart]
                if let rich = richPart {
                    let htmlPart = Part(headers: ["Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: base64"],
                                        body: base64(Data(rich.0.utf8)))
                    alts.append(rich.1.isEmpty ? htmlPart : multipart("related", [htmlPart] + rich.1))
                }
                alts.append(calPart)
                main = multipart("alternative", alts)
                icsFile = Part(headers: ["Content-Type: application/ics; name=\"einladung.ics\"",
                                         "Content-Disposition: attachment; filename=\"einladung.ics\"",
                                         "Content-Transfer-Encoding: base64"],
                               body: base64(Data(cal.utf8)))
            } else {
                main = multipart("alternative", [textPart, calPart])
            }
        }
        if let f = icsFile, d.attachments.isEmpty {
            main = multipart("mixed", [main, f])
        }

        if !d.attachments.isEmpty {
            var parts = [main]
            if let f = icsFile { parts.append(f) }
            var total = 0
            for url in d.attachments {
                let data: Data
                do {
                    data = try Data(contentsOf: url)
                } catch {
                    throw MailError.invalidResponse("Anhang konnte nicht gelesen werden: \(url.lastPathComponent)")
                }
                total += data.count
                if total > maxAttachmentBytes {
                    throw MailError.invalidResponse("Anhänge zu groß (max. ca. 20 MB insgesamt).")
                }
                let fname = url.lastPathComponent
                let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType
                    ?? "application/octet-stream"
                parts.append(Part(headers: [
                    "Content-Type: \(mime); name=\"\(quotedName(fname))\"",
                    "Content-Disposition: attachment; \(filenameParam(fname))",
                    "Content-Transfer-Encoding: base64",
                ], body: base64(data)))
            }
            main = multipart("mixed", parts)
        }

        h += main.headers
        let raw = h.joined(separator: "\r\n") + "\r\n\r\n" + main.body + "\r\n"
        return (Data(raw.utf8), to + cc)
    }

    /// MIME-Teil: eigene Kopfzeilen + Inhalt
    struct Part {
        var headers: [String]
        var body: String
    }

    static func multipart(_ subtype: String, _ parts: [Part]) -> Part {
        let boundary = "SimpleMail-\(UUID().uuidString)"
        var body = ""
        for p in parts {
            body += "--\(boundary)\r\n" + p.headers.joined(separator: "\r\n") + "\r\n\r\n" + p.body + "\r\n"
        }
        body += "--\(boundary)--"
        return Part(headers: ["Content-Type: multipart/\(subtype); boundary=\"\(boundary)\""], body: body)
    }

    /// Text-Platzhalter der Signatur im Mailtext (identisch zur Erzeugung beim Verfassen)
    static func plainSignatureBlock(_ account: Account) -> String {
        let sig = account.signature.trimmingCharacters(in: .whitespacesAndNewlines)
        return sig.isEmpty ? "" : "\n\n-- \n" + sig
    }

    /// Findet die Text-Signatur auch dann, wenn Leerzeichen/Zeilenumbrüche im Verfassen-Fenster verändert wurden
    /// (macOS-Textfeld, Kopieren & Einfügen, geschützte Leerzeichen). Liefert den Bereich inkl. Trenner „-- “.
    static func looseSignatureRange(in body: String, signature: String) -> Range<String.Index>? {
        let sig = Array(signature.filter { !$0.isWhitespace })
        guard let first = sig.first else { return nil }
        var start = body.startIndex
        while start < body.endIndex {
            guard let hit = body[start...].firstIndex(of: first) else { return nil }
            var i = hit
            var k = 0
            while i < body.endIndex && k < sig.count {
                let c = body[i]
                if c.isWhitespace { i = body.index(after: i); continue }
                if c != sig[k] { break }
                k += 1
                i = body.index(after: i)
            }
            if k == sig.count {
                // Rückwärts: Leerraum und Trenner „--“ bzw. „—“ mitnehmen
                var lo = hit
                func skipSpace() { while lo > body.startIndex && body[body.index(before: lo)].isWhitespace { lo = body.index(before: lo) } }
                skipSpace()
                let head = body[..<lo]
                if head.hasSuffix("--") { lo = body.index(lo, offsetBy: -2); skipSpace() }
                else if head.hasSuffix("—") || head.hasSuffix("–") { lo = body.index(before: lo); skipSpace() }
                return lo..<i
            }
            start = body.index(after: hit)
        }
        return nil
    }

    /// Eingebettete Bilder (data:-URLs) → cid-Anhänge, weil viele Mailprogramme data:-Bilder blockieren
    static func embedImages(_ html: String) -> (String, [Part]) {
        var out = html
        var images: [Part] = []
        let pattern = #"data:(image/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)"#
        while let m = out.range(of: pattern, options: .regularExpression) {
            let match = String(out[m])
            guard let g = Pattern.groups(pattern, in: match), g.count == 2,
                  let data = Data(base64Encoded: g[1], options: .ignoreUnknownCharacters) else { break }
            let n = images.count + 1
            let cid = "img\(n)-\(UUID().uuidString.prefix(8))@simplemail"
            let ext = g[0].split(separator: "/").last.map(String.init) ?? "png"
            images.append(Part(headers: [
                "Content-Type: \(g[0]); name=\"bild\(n).\(ext)\"",
                "Content-Transfer-Encoding: base64",
                "Content-ID: <\(cid)>",
                "Content-Disposition: inline; filename=\"bild\(n).\(ext)\"",
            ], body: base64(data)))
            out.replaceSubrange(m, with: "cid:\(cid)")
        }
        return (out, images)
    }

    /// Formatierter Editor-Inhalt → vollständiger HTML-Teil
    static func composedHtml(_ editorHtml: String) -> (String, [Part]) {
        let cleaned = editorHtml
            .replacingOccurrences(of: #"class="sm-sig""#, with: #"class="simplemail-signature""#)
        let (body, images) = embedImages(cleaned)
        let html = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head><body>"
            + "<div style=\"font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:14px\">"
            + body + "</div></body></html>"
        return (html, images)
    }

    /// Baut den HTML-Teil: Text + formatierte Signatur an Stelle des Text-Platzhalters.
    /// Eingebettete Bilder (data:-URLs) werden zu cid-Anhängen, weil viele Mailprogramme data:-Bilder blockieren.
    static func htmlBody(_ body: String, account: Account) -> (String, [Part])? {
        guard account.hasRichSignature else { return nil }
        let block = plainSignatureBlock(account)
        guard !block.isEmpty, let r = body.range(of: block) ?? looseSignatureRange(in: body, signature: account.signature) else { return nil }
        let before = String(body[..<r.lowerBound])
        let after = String(body[r.upperBound...])

        let (sig, images) = embedImages(account.signatureHtml)

        let html = "<div style=\"font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:14px\">"
            + HTMLTools.textToHtml(before) + "<br><br>"
            + "<div class=\"simplemail-signature\">\(sig)</div>"
            + (after.isEmpty ? "" : "<br>" + HTMLTools.textToHtml(after))
            + "</div>"
        return (html, images)
    }

    private static func base64(_ data: Data) -> String {
        data.base64EncodedString(options: [.lineLength76Characters, .endLineWithCarriageReturn, .endLineWithLineFeed])
    }

    /// name="…" (RFC 2047 für Nicht-ASCII, von fast allen Clients verstanden)
    private static func quotedName(_ s: String) -> String {
        let escaped = s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
        return s.allSatisfy { $0.isASCII } ? escaped : encodeWord(s)
    }

    /// filename="…" bzw. filename*=UTF-8''… (RFC 2231)
    private static func filenameParam(_ s: String) -> String {
        if s.allSatisfy({ $0.isASCII }) {
            return "filename=\"\(quotedName(s))\""
        }
        let allowed = CharacterSet(charactersIn:
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        let enc = s.addingPercentEncoding(withAllowedCharacters: allowed) ?? s
        return "filename*=UTF-8''\(enc)"
    }

    static func addresses(_ s: String) -> [String] {
        s.split(whereSeparator: { $0 == "," || $0 == ";" })
            .map { MIME.parseAddress(String($0)).address }
            .filter { $0.contains("@") }
    }

    static func encodeWord(_ s: String) -> String {
        s.allSatisfy { $0.isASCII } ? s : "=?UTF-8?B?\(Data(s.utf8).base64EncodedString())?="
    }
}
