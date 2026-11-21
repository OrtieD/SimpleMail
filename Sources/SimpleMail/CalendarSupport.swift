import SwiftUI
import AppKit
import EventKit

// MARK: - iCalendar (Einladungen lesen, Antworten erzeugen)

struct CalPerson: Hashable {
    var email: String
    var name: String
    var partstat: String
}

struct CalEvent: Hashable {
    var uid = ""
    var summary = ""
    var description = ""
    var location = ""
    var status = ""
    var sequence = 0
    var start: Date?
    var end: Date?
    var allDay = false
    var organizer: CalPerson?
    var attendees: [CalPerson] = []
    var recurrenceID: Date?
    /// URL-Feld und Konferenz-Link (X-MICROSOFT-SKYPETEAMSMEETINGURL, X-GOOGLE-CONFERENCE, CONFERENCE)
    var url = ""
    var conference = ""

    /// Online-Meeting (Teams, Zoom, Meet …) aus Konferenzfeld, URL, Ort oder Beschreibung
    var meeting: MeetingLink? { Meeting.find([conference, url, location, description]) }
}

struct CalInvite: Hashable {
    var method: String
    var event: CalEvent
}

enum ICS {
    /// Windows-Zeitzonennamen (Outlook) → IANA
    static let windowsZones: [String: String] = [
        "W. Europe Standard Time": "Europe/Berlin", "Central Europe Standard Time": "Europe/Budapest",
        "Central European Standard Time": "Europe/Warsaw", "Romance Standard Time": "Europe/Paris",
        "GMT Standard Time": "Europe/London", "E. Europe Standard Time": "Europe/Chisinau",
        "FLE Standard Time": "Europe/Kiev", "GTB Standard Time": "Europe/Bucharest",
        "Russian Standard Time": "Europe/Moscow", "Turkey Standard Time": "Europe/Istanbul",
        "Eastern Standard Time": "America/New_York", "Central Standard Time": "America/Chicago",
        "Mountain Standard Time": "America/Denver", "Pacific Standard Time": "America/Los_Angeles",
        "China Standard Time": "Asia/Shanghai", "Tokyo Standard Time": "Asia/Tokyo",
        "India Standard Time": "Asia/Kolkata", "UTC": "UTC", "Coordinated Universal Time": "UTC",
    ]

    static func zone(_ tzid: String?) -> TimeZone? {
        guard var tz = tzid, !tz.isEmpty else { return nil }
        tz = tz.trimmingCharacters(in: CharacterSet(charactersIn: "\"/ "))
        if let mapped = windowsZones[tz] { return TimeZone(identifier: mapped) }
        if let z = TimeZone(identifier: tz) { return z }
        let lower = tz.lowercased()
        if ["berlin", "amsterdam", "wien", "vienna", "zurich", "zürich"].contains(where: lower.contains) {
            return TimeZone(identifier: "Europe/Berlin")
        }
        if ["london", "dublin", "lisbon"].contains(where: lower.contains) { return TimeZone(identifier: "Europe/London") }
        return nil
    }

    /// NAME;PARAM=WERT:WERT
    static func parseLine(_ line: String) -> (name: String, params: [String: String], value: String) {
        var quoted = false
        var split = line.endIndex
        for i in line.indices {
            let c = line[i]
            if c == "\"" { quoted.toggle() } else if c == ":" && !quoted { split = i; break }
        }
        let head = String(line[..<split])
        let value = split < line.endIndex ? String(line[line.index(after: split)...]) : ""
        var segs: [String] = []
        var cur = ""
        quoted = false
        for c in head {
            if c == "\"" { quoted.toggle() }
            if c == ";" && !quoted { segs.append(cur); cur = "" } else { cur.append(c) }
        }
        segs.append(cur)
        var params: [String: String] = [:]
        for p in segs.dropFirst() {
            if let eq = p.firstIndex(of: "=") {
                params[p[..<eq].uppercased()] = String(p[p.index(after: eq)...])
                    .trimmingCharacters(in: CharacterSet(charactersIn: "\""))
            }
        }
        return (segs[0].uppercased(), params, value)
    }

    static func parseDate(_ value: String, _ params: [String: String]) -> (Date, Bool)? {
        let v = value.trimmingCharacters(in: .whitespaces)
        let digits = v.filter(\.isNumber)
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = .current
        func num(_ from: Int, _ len: Int) -> Int? {
            guard digits.count >= from + len else { return nil }
            let s = digits.index(digits.startIndex, offsetBy: from)
            return Int(digits[s..<digits.index(s, offsetBy: len)])
        }
        guard let y = num(0, 4), let mo = num(4, 2), let d = num(6, 2) else { return nil }
        if params["VALUE"] == "DATE" || !v.contains("T") {
            return cal.date(from: DateComponents(year: y, month: mo, day: d)).map { ($0, true) }
        }
        guard let h = num(8, 2), let mi = num(10, 2) else { return nil }
        let s = num(12, 2) ?? 0
        if v.hasSuffix("Z") {
            cal.timeZone = TimeZone(identifier: "UTC")!
        } else if let z = zone(params["TZID"]) {
            cal.timeZone = z
        }
        return cal.date(from: DateComponents(year: y, month: mo, day: d, hour: h, minute: mi, second: s)).map { ($0, false) }
    }

    static func duration(_ v: String) -> TimeInterval? {
        guard let re = try? NSRegularExpression(pattern: #"^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$"#),
              let m = re.firstMatch(in: v, range: NSRange(v.startIndex..., in: v)) else { return nil }
        func g(_ i: Int) -> Double {
            guard let r = Range(m.range(at: i), in: v) else { return 0 }
            return Double(v[r]) ?? 0
        }
        let secs = g(2) * 7 * 86400 + g(3) * 86400 + g(4) * 3600 + g(5) * 60 + g(6)
        if let r = Range(m.range(at: 1), in: v), v[r] == "-" { return -secs }
        return secs
    }

    static func unescape(_ v: String) -> String {
        var out = ""
        var esc = false
        for c in v {
            if esc {
                out.append(c == "n" || c == "N" ? "\n" : c)
                esc = false
            } else if c == "\\" {
                esc = true
            } else {
                out.append(c)
            }
        }
        return out
    }

    static func escape(_ v: String) -> String {
        v.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: ";", with: "\\;")
            .replacingOccurrences(of: ",", with: "\\,")
            .replacingOccurrences(of: "\r\n", with: "\\n")
            .replacingOccurrences(of: "\n", with: "\\n")
    }

    private static func person(_ p: (name: String, params: [String: String], value: String)) -> CalPerson {
        var email = p.value.trimmingCharacters(in: .whitespaces)
        if email.lowercased().hasPrefix("mailto:") { email = String(email.dropFirst(7)) }
        return CalPerson(email: email, name: p.params["CN"] ?? "",
                         partstat: (p.params["PARTSTAT"] ?? "NEEDS-ACTION").uppercased())
    }

    /// Erste VEVENT-Komponente einer Einladung
    static func parse(_ text: String) -> CalInvite? {
        let unfolded = text
            .replacingOccurrences(of: "\r\n ", with: "").replacingOccurrences(of: "\r\n\t", with: "")
            .replacingOccurrences(of: "\n ", with: "").replacingOccurrences(of: "\n\t", with: "")
        var method = ""
        var props: [String: (name: String, params: [String: String], value: String)] = [:]
        var attendees: [CalPerson] = []
        var inEvent = false
        var depth = 0
        var found = false
        for rawLine in unfolded.components(separatedBy: "\n") {
            let line = rawLine.trimmingCharacters(in: CharacterSet(charactersIn: "\r"))
            if line.isEmpty { continue }
            let p = parseLine(line)
            if p.name == "BEGIN" && p.value.uppercased() == "VEVENT" && !found { inEvent = true; depth = 0; continue }
            if inEvent && p.name == "BEGIN" { depth += 1; continue }
            if inEvent && p.name == "END" && p.value.uppercased() != "VEVENT" { depth -= 1; continue }
            if inEvent && p.name == "END" { inEvent = false; found = true; continue }
            if !inEvent {
                if p.name == "METHOD" { method = p.value.trimmingCharacters(in: .whitespaces).uppercased() }
                continue
            }
            if depth > 0 { continue }
            if p.name == "ATTENDEE" { attendees.append(person(p)) } else { props[p.name] = p }
        }
        guard found, let dtstart = props["DTSTART"], let parsedStart = parseDate(dtstart.value, dtstart.params) else {
            return nil
        }
        let start = parsedStart.0
        let allDay = parsedStart.1
        var ev = CalEvent()
        ev.uid = props["UID"]?.value ?? ""
        ev.summary = unescape(props["SUMMARY"]?.value ?? "")
        if ev.summary.isEmpty { ev.summary = "(ohne Titel)" }
        ev.description = unescape(props["DESCRIPTION"]?.value ?? "")
        ev.location = unescape(props["LOCATION"]?.value ?? "")
        ev.status = (props["STATUS"]?.value ?? "").uppercased()
        ev.sequence = Int(props["SEQUENCE"]?.value ?? "") ?? 0
        ev.start = start
        ev.allDay = allDay
        if let e = props["DTEND"], let parsedEnd = parseDate(e.value, e.params) {
            ev.end = parsedEnd.0
        } else if let d = props["DURATION"], let secs = duration(d.value) {
            ev.end = start.addingTimeInterval(secs)
        } else {
            ev.end = start.addingTimeInterval(allDay ? 86400 : 3600)
        }
        ev.organizer = props["ORGANIZER"].map(person)
        ev.attendees = attendees
        if let r = props["RECURRENCE-ID"] { ev.recurrenceID = parseDate(r.value, r.params)?.0 }
        ev.url = (props["URL"]?.value ?? "").trimmingCharacters(in: .whitespaces)
        for name in ["X-MICROSOFT-SKYPETEAMSMEETINGURL", "X-MICROSOFT-ONLINEMEETINGCONFLINK", "X-GOOGLE-CONFERENCE", "CONFERENCE"] {
            let v = (props[name]?.value ?? "").trimmingCharacters(in: .whitespaces)
            if v.lowercased().hasPrefix("https://") {
                ev.conference = v
                break
            }
        }
        return CalInvite(method: method.isEmpty ? "PUBLISH" : method, event: ev)
    }

    // ---- Antwort (iMIP REPLY)

    private static func fold(_ line: String) -> String {
        var out: [String] = []
        var cur = ""
        var bytes = 0
        for c in line {
            let n = String(c).utf8.count
            if bytes + n > 74 {
                out.append(cur)
                cur = " "
                bytes = 1
            }
            cur.append(c)
            bytes += n
        }
        out.append(cur)
        return out.joined(separator: "\r\n")
    }

    static func utcStamp(_ d: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyyMMdd'T'HHmmss'Z'"
        return f.string(from: d)
    }

    static func dateStamp(_ d: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        f.dateFormat = "yyyyMMdd"
        return f.string(from: d)
    }

    /// partstat: ACCEPTED | TENTATIVE | DECLINED
    static func reply(_ ev: CalEvent, me: CalPerson, partstat: String) -> String {
        let start = ev.start ?? Date()
        let end = ev.end ?? start.addingTimeInterval(3600)
        let org = ev.organizer ?? CalPerson(email: "", name: "", partstat: "")
        func cn(_ name: String) -> String {
            name.isEmpty ? "" : ";CN=\"\(name.replacingOccurrences(of: "\"", with: ""))\""
        }
        var lines = [
            "BEGIN:VCALENDAR", "PRODID:-//SimpleMail//DE", "VERSION:2.0", "METHOD:REPLY", "BEGIN:VEVENT",
            "UID:\(ev.uid)", "SEQUENCE:\(ev.sequence)", "DTSTAMP:\(utcStamp(Date()))",
            ev.allDay ? "DTSTART;VALUE=DATE:\(dateStamp(start))" : "DTSTART:\(utcStamp(start))",
            ev.allDay ? "DTEND;VALUE=DATE:\(dateStamp(end))" : "DTEND:\(utcStamp(end))",
            "SUMMARY:\(escape(ev.summary))",
            "ORGANIZER\(cn(org.name)):mailto:\(org.email)",
            "ATTENDEE;PARTSTAT=\(partstat)\(cn(me.name)):mailto:\(me.email)",
        ]
        if let rid = ev.recurrenceID { lines.append("RECURRENCE-ID:\(utcStamp(rid))") }
        lines += ["END:VEVENT", "END:VCALENDAR"]
        return lines.map(fold).joined(separator: "\r\n") + "\r\n"
    }

    /// „Donnerstag, 12. November 2026, 10:00–11:00 Uhr“
    static func when(start: Date, end: Date, allDay: Bool) -> String {
        let day = DateFormatter()
        day.locale = Locale(identifier: "de_DE")
        day.dateFormat = "EEEE, d. MMMM yyyy"
        let time = DateFormatter()
        time.locale = Locale(identifier: "de_DE")
        time.dateFormat = "HH:mm"
        if allDay {
            let last = end.addingTimeInterval(-1)
            return Calendar.current.isDate(last, inSameDayAs: start)
                ? "\(day.string(from: start)), ganztägig"
                : "\(day.string(from: start)) – \(day.string(from: last))"
        }
        if Calendar.current.isDate(end, inSameDayAs: start) {
            return "\(day.string(from: start)), \(time.string(from: start))–\(time.string(from: end)) Uhr"
        }
        return "\(day.string(from: start)), \(time.string(from: start)) – \(day.string(from: end)), \(time.string(from: end)) Uhr"
    }
}

// MARK: - Einladung beantworten (Store)

extension MailStore {
    func sendInviteReply(_ m: MailMessage, _ ev: CalEvent, partstat: String) async throws {
        guard let org = ev.organizer, !org.email.isEmpty else {
            throw MailError.invalidResponse("Die Einladung enthält keinen Organisator.")
        }
        guard let acc = account(m.accountID) ?? accounts.first else { throw MailError.noAccount }
        let mine = Set(accounts.map { $0.email.lowercased() })
        let att = ev.attendees.first { mine.contains($0.email.lowercased()) }
        let me = CalPerson(email: att?.email ?? acc.email, name: acc.displayName, partstat: partstat)
        let word = ["ACCEPTED": "Zugesagt", "TENTATIVE": "Mit Vorbehalt", "DECLINED": "Abgelehnt"][partstat] ?? "Antwort"
        let when = ICS.when(start: ev.start ?? Date(), end: ev.end ?? Date(), allDay: ev.allDay)
        var d = Draft()
        d.accountID = acc.id
        d.to = org.name.isEmpty ? org.email : "\"\(org.name.replacingOccurrences(of: "\"", with: ""))\" <\(org.email)>"
        d.subject = "\(word): \(ev.summary)"
        d.body = "\(me.name.isEmpty ? me.email : me.name) hat die Einladung „\(ev.summary)“ (\(when)) beantwortet: \(word)."
        d.calendarReply = ICS.reply(ev, me: me, partstat: partstat)
        try await send(d)
    }
}

// MARK: - Apple Kalender (EventKit)

struct UpcomingEvent: Identifiable, Equatable {
    let id: String
    let title: String
    let start: Date
    let end: Date
    let allDay: Bool
    let location: String
    let color: Color
    var meeting: MeetingLink? = nil

    var label: String {
        let cal = Calendar.current
        let day: String
        if cal.isDateInToday(start) || start < Date() {
            day = "Heute"
        } else if cal.isDateInTomorrow(start) {
            day = "Morgen"
        } else {
            let f = DateFormatter()
            f.locale = Locale(identifier: "de_DE")
            f.dateFormat = "EE, d.M."
            day = f.string(from: start)
        }
        if allDay { return "\(day) · ganztägig" }
        let t = DateFormatter()
        t.dateFormat = "HH:mm"
        return "\(day) · \(t.string(from: start))"
    }
}

struct CalendarError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

@MainActor
final class CalendarService: ObservableObject {
    let eventStore = EKEventStore()
    @Published var status: EKAuthorizationStatus = EKEventStore.authorizationStatus(for: .event)
    @Published var upcoming: [UpcomingEvent] = []
    @Published var newEventFor: MailMessage?
    /// „Neuer Termin / Online-Meeting“ ohne Bezug zu einer Mail
    @Published var newMeetingOpen = false
    /// Terminspalte rechts ein-/ausgeblendet
    @Published var paneOpen: Bool = UserDefaults.standard.object(forKey: "calendarPaneOpen") as? Bool ?? true {
        didSet { UserDefaults.standard.set(paneOpen, forKey: "calendarPaneOpen") }
    }
    /// Antworten auf Einladungen in dieser Sitzung
    @Published var answers: [MessageKey: String] = [:]
    private var observer: NSObjectProtocol?
    private var timer: Timer?

    init() {
        observer = NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: eventStore, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.reload() }
        }
        timer = Timer.scheduledTimer(withTimeInterval: 600, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.reload() }
        }
        reload()
    }

    var hasAccess: Bool {
        if #available(macOS 14.0, *) {
            return status == .fullAccess || status == .authorized
        }
        return status == .authorized
    }

    func requestAccess() async {
        do {
            if #available(macOS 14.0, *) {
                _ = try await eventStore.requestFullAccessToEvents()
            } else {
                _ = try await eventStore.requestAccess(to: .event)
            }
        } catch {
            // Zugriff verweigert – Status unten zeigt das an
        }
        status = EKEventStore.authorizationStatus(for: .event)
        reload()
    }

    func openPrivacySettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars") {
            NSWorkspace.shared.open(url)
        }
    }

    func openCalendarApp() {
        NSWorkspace.shared.open(URL(fileURLWithPath: "/System/Applications/Calendar.app"))
    }

    func reload() {
        // Nur bei Änderungen veröffentlichen: Kalender-Benachrichtigungen kommen oft (iCloud) und
        // zeichneten sonst jedes Mal das ganze Fenster samt Mailliste neu
        let st = EKEventStore.authorizationStatus(for: .event)
        if st != status { status = st }
        guard hasAccess else {
            if !upcoming.isEmpty { upcoming = [] }
            return
        }
        let start = Calendar.current.startOfDay(for: Date())
        guard let end = Calendar.current.date(byAdding: .day, value: 14, to: start) else { return }
        let pred = eventStore.predicateForEvents(withStart: start, end: end, calendars: nil)
        let list = eventStore.events(matching: pred)
            .filter { $0.status != .canceled }
            .sorted { $0.startDate < $1.startDate }
            .map { e in
                UpcomingEvent(
                    id: "\(e.eventIdentifier ?? UUID().uuidString)|\(e.startDate.timeIntervalSince1970)",
                    title: e.title ?? "(ohne Titel)", start: e.startDate, end: e.endDate,
                    allDay: e.isAllDay, location: e.location ?? "",
                    color: Color(cgColor: e.calendar.cgColor),
                    meeting: Meeting.find([e.url?.absoluteString ?? "", e.location ?? "", e.notes ?? ""]))
            }
        if list != upcoming { upcoming = list }
    }

    var writableCalendars: [EKCalendar] {
        eventStore.calendars(for: .event).filter(\.allowsContentModifications)
            .sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
    }

    var defaultCalendarID: String {
        eventStore.defaultCalendarForNewEvents?.calendarIdentifier ?? writableCalendars.first?.calendarIdentifier ?? ""
    }

    /// Gibt es schon einen Termin mit gleichem Titel zur gleichen Zeit?
    func exists(title: String, start: Date) -> Bool {
        guard hasAccess else { return false }
        let pred = eventStore.predicateForEvents(withStart: start.addingTimeInterval(-60),
                                                 end: start.addingTimeInterval(60), calendars: nil)
        return eventStore.events(matching: pred).contains { $0.title == title && abs($0.startDate.timeIntervalSince(start)) < 60 }
    }

    func add(title: String, start: Date, end: Date, allDay: Bool, location: String, notes: String,
             calendarID: String?, url: String = "") throws {
        guard hasAccess else { throw CalendarError(message: "Kein Zugriff auf Apple Kalender.") }
        let ev = EKEvent(eventStore: eventStore)
        ev.title = title.isEmpty ? "(ohne Titel)" : title
        ev.startDate = start
        ev.endDate = max(end, start.addingTimeInterval(allDay ? 86400 : 60))
        ev.isAllDay = allDay
        if !location.isEmpty { ev.location = location }
        if !notes.isEmpty { ev.notes = notes }
        if url.lowercased().hasPrefix("https://"), let u = URL(string: url) { ev.url = u }
        ev.calendar = calendarID.flatMap { eventStore.calendar(withIdentifier: $0) } ?? eventStore.defaultCalendarForNewEvents
        guard ev.calendar != nil else { throw CalendarError(message: "Kein beschreibbarer Kalender gefunden.") }
        try eventStore.save(ev, span: .thisEvent, commit: true)
        reload()
    }

    func add(_ invite: CalEvent) throws {
        guard let start = invite.start else { return }
        if exists(title: invite.summary, start: start) { return }
        var notes = invite.description
        if let org = invite.organizer, !org.email.isEmpty {
            notes = "Organisator: \(org.name.isEmpty ? org.email : "\(org.name) <\(org.email)>")" + (notes.isEmpty ? "" : "\n\n\(notes)")
        }
        let meet = invite.meeting
        var location = invite.location
        if let mt = meet {
            if !notes.contains(mt.url) { notes += (notes.isEmpty ? "" : "\n\n") + "\(mt.name) beitreten: \(mt.url)" }
            if location.isEmpty { location = mt.url }
        }
        try add(title: invite.summary, start: start, end: invite.end ?? start.addingTimeInterval(3600),
                allDay: invite.allDay, location: location, notes: notes, calendarID: nil, url: meet?.url ?? "")
    }
}

// MARK: - Seitenleiste: Termine

struct EventsSidebarSection: View {
    @EnvironmentObject var calendar: CalendarService

    var body: some View {
        Section("Termine") {
            if calendar.hasAccess {
                if calendar.upcoming.isEmpty {
                    Text("Keine Termine in den nächsten 7 Tagen")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                ForEach(calendar.upcoming) { ev in
                    Button {
                        calendar.openCalendarApp()
                    } label: {
                        HStack(alignment: .top, spacing: 8) {
                            Circle().fill(ev.color).frame(width: 8, height: 8).padding(.top, 5)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(ev.title).lineLimit(1)
                                Text(ev.label).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 0)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .help(ICS.when(start: ev.start, end: ev.end, allDay: ev.allDay) + (ev.location.isEmpty ? "" : "\n\(ev.location)"))
                }
            } else if calendar.status == .notDetermined {
                Button {
                    Task { await calendar.requestAccess() }
                } label: {
                    Label("Apple Kalender verbinden …", systemImage: "calendar.badge.plus")
                }
                .buttonStyle(.plain)
            } else {
                Button {
                    calendar.openPrivacySettings()
                } label: {
                    Label("Kalenderzugriff erlauben …", systemImage: "lock")
                }
                .buttonStyle(.plain)
                .help("Systemeinstellungen → Datenschutz & Sicherheit → Kalender → SimpleMail einschalten")
            }
        }
    }
}

// MARK: - Einladungskarte in der Leseansicht

final class InviteCardModel: ObservableObject {
    @Published var busy = false
    @Published var info = ""
}

struct InviteCard: View {
    @EnvironmentObject var store: MailStore
    @EnvironmentObject var calendar: CalendarService
    @StateObject private var m = InviteCardModel()
    let message: MailMessage
    let invite: CalInvite

    private static let word = ["ACCEPTED": "zugesagt", "TENTATIVE": "mit Vorbehalt zugesagt", "DECLINED": "abgelehnt"]

    private var ev: CalEvent { invite.event }
    private var meet: MeetingLink? { invite.event.meeting }
    /// Ort nicht doppelt zeigen, wenn er nur der Meeting-Link ist
    private var showLocation: Bool {
        if ev.location.isEmpty { return false }
        if let mt = meet, ev.location.contains(mt.url) { return false }
        return true
    }

    private var myAnswer: String {
        if let a = calendar.answers[message.key] { return a }
        let mine = Set(store.accounts.map { $0.email.lowercased() })
        if let me = ev.attendees.first(where: { mine.contains($0.email.lowercased()) }), me.partstat != "NEEDS-ACTION" {
            return me.partstat
        }
        return ""
    }

    private var kind: String {
        switch invite.method {
        case "CANCEL": return "Termin abgesagt"
        case "REPLY":
            if let a = ev.attendees.first {
                return "\(a.name.isEmpty ? a.email : a.name) hat \(Self.word[a.partstat] ?? "geantwortet")"
            }
            return "Antwort auf Einladung"
        case "REQUEST": return "Einladung"
        default: return "Termin"
        }
    }

    var body: some View {
        let start = ev.start ?? Date()
        let end = ev.end ?? start
        HStack(alignment: .top, spacing: 14) {
            VStack(spacing: 0) {
                Text(Self.month(start)).font(.caption2.weight(.semibold)).textCase(.uppercase)
                Text("\(Calendar.current.component(.day, from: start))").font(.title2.weight(.semibold))
            }
            .foregroundStyle(.white)
            .frame(width: 52, height: 56)
            .background(invite.method == "CANCEL" ? Color.red : Color.accentColor, in: RoundedRectangle(cornerRadius: 8))

            VStack(alignment: .leading, spacing: 3) {
                Text(kind).font(.caption).foregroundStyle(.secondary).textCase(.uppercase)
                Text(ev.summary).font(.headline).strikethrough(invite.method == "CANCEL")
                Text(ICS.when(start: start, end: end, allDay: ev.allDay)).font(.callout)
                if showLocation {
                    Text("📍 \(ev.location)").font(.callout)
                }
                if let mt = meet, invite.method != "CANCEL" {
                    MeetingJoinRow(meeting: mt).padding(.vertical, 2)
                }
                if let org = ev.organizer, !org.email.isEmpty {
                    Text("Organisator: \(org.name.isEmpty ? org.email : org.name)").font(.callout)
                }
                if !ev.attendees.isEmpty {
                    Text("Teilnehmer: " + ev.attendees.prefix(8).map { $0.name.isEmpty ? $0.email : $0.name }.joined(separator: ", "))
                        .font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
                actions.padding(.top, 6)
                if !m.info.isEmpty {
                    Text(m.info).font(.caption).foregroundStyle(.secondary)
                } else if !myAnswer.isEmpty {
                    Text("Du hast \(Self.word[myAnswer] ?? myAnswer).").font(.caption).foregroundStyle(.secondary)
                }
            }
            .textSelection(.enabled)
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color(nsColor: .controlBackgroundColor)))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.secondary.opacity(0.25)))
    }

    @ViewBuilder
    private var actions: some View {
        HStack(spacing: 6) {
            if invite.method == "REQUEST", ev.organizer?.email.isEmpty == false {
                answerButton("Zusagen", "checkmark", "ACCEPTED")
                answerButton("Vielleicht", "questionmark", "TENTATIVE")
                answerButton("Absagen", "xmark", "DECLINED")
                Divider().frame(height: 16)
            }
            if invite.method != "CANCEL" && invite.method != "REPLY" {
                if calendar.hasAccess {
                    Button {
                        do {
                            if calendar.exists(title: ev.summary, start: ev.start ?? Date()) {
                                m.info = "Der Termin steht bereits in deinem Kalender."
                            } else {
                                try calendar.add(ev)
                                m.info = "In Apple Kalender eingetragen."
                            }
                        } catch {
                            m.info = error.localizedDescription
                        }
                    } label: { Label("In Kalender", systemImage: "calendar.badge.plus") }
                } else {
                    Button {
                        Task { await calendar.requestAccess() }
                    } label: { Label("Kalender verbinden", systemImage: "calendar") }
                }
            }
        }
        .controlSize(.small)
        .disabled(m.busy)
    }

    private func answerButton(_ title: String, _ symbol: String, _ ps: String) -> some View {
        Button {
            m.busy = true
            m.info = "Antwort wird gesendet …"
            Task { @MainActor in
                do {
                    try await store.sendInviteReply(message, ev, partstat: ps)
                    calendar.answers[message.key] = ps
                    var info = "Antwort gesendet."
                    if ps != "DECLINED" && calendar.hasAccess {
                        if !calendar.exists(title: ev.summary, start: ev.start ?? Date()) {
                            try calendar.add(ev)
                            info = "Antwort gesendet und in Apple Kalender eingetragen."
                        }
                    }
                    m.info = info
                } catch {
                    m.info = "Fehler: \(error.localizedDescription)"
                }
                m.busy = false
            }
        } label: {
            Label(title, systemImage: symbol)
        }
        .buttonStyle(.bordered)
        .tint(myAnswer == ps ? .accentColor : nil)
    }

    private static func month(_ d: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "de_DE")
        f.dateFormat = "MMM"
        return f.string(from: d)
    }
}

// MARK: - Termin / Online-Meeting anlegen (aus E-Mail oder neu)

final class NewEventModel: ObservableObject {
    @Published var title: String
    @Published var start: Date
    @Published var minutes = 60
    @Published var allDay = false
    @Published var location = ""
    @Published var notes: String
    @Published var calendarID = ""
    @Published var error = ""
    /// none / teams / zoom / meet / webex / jitsi / other
    @Published var provider = "none"
    @Published var link = ""
    @Published var to = ""
    @Published var accountID: UUID? = nil
    @Published var saveToCalendar = true
    @Published var busy = false
    var prepared = false

    init(title: String, notes: String) {
        self.title = title
        self.notes = notes
        var c = Calendar.current.dateComponents([.year, .month, .day], from: Date().addingTimeInterval(86400))
        c.hour = 10
        start = Calendar.current.date(from: c) ?? Date()
    }
}

struct NewEventSheet: View {
    @EnvironmentObject var store: MailStore
    @EnvironmentObject var calendar: CalendarService
    @Environment(\.dismiss) private var dismiss
    @StateObject private var m: NewEventModel
    let message: MailMessage?

    init(message: MailMessage?) {
        self.message = message
        _m = StateObject(wrappedValue: NewEventModel(
            title: message?.subject ?? "",
            notes: message.map { "E-Mail von \($0.senderDisplay) <\($0.fromAddress)>" } ?? ""))
    }

    private var inviting: Bool { !m.to.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    private var linkHint: String {
        switch m.provider {
        case "teams": return "Teams-Link einfügen (Teams → Kalender → „Neue Besprechung“ oder „Jetzt besprechen“ → Link kopieren) oder unter Einstellungen → Online-Meetings fest hinterlegen."
        case "zoom": return "Zoom-Link einfügen – z. B. dein persönlicher Meetingraum (zoom.us/j/…), einstellbar unter Einstellungen → Online-Meetings."
        case "webex": return "Webex-Link einfügen – z. B. dein persönlicher Raum (firma.webex.com/meet/name)."
        case "meet": return "Meet-Link einfügen: „Anlegen …“ öffnet meet.google.com → „Neue Videokonferenz“ → Link kopieren."
        case "jitsi": return "Leer lassen: SimpleMail erzeugt einen Jitsi-Raum (meet.jit.si) – Teilnehmer brauchen kein Konto."
        case "other": return "Beliebiger https-Link zum Meeting."
        default: return ""
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(message == nil ? "Neuer Termin / Online-Meeting" : "Termin aus E-Mail").font(.headline).padding([.horizontal, .top], 20)
            Form {
                TextField("Titel", text: $m.title)
                Toggle("Ganztägig", isOn: $m.allDay)
                DatePicker("Beginn", selection: $m.start,
                           displayedComponents: m.allDay ? [.date] : [.date, .hourAndMinute])
                if !m.allDay {
                    Picker("Dauer", selection: $m.minutes) {
                        Text("15 Minuten").tag(15)
                        Text("30 Minuten").tag(30)
                        Text("45 Minuten").tag(45)
                        Text("1 Stunde").tag(60)
                        Text("1,5 Stunden").tag(90)
                        Text("2 Stunden").tag(120)
                        Text("4 Stunden").tag(240)
                    }
                }
                Section("Online-Meeting") {
                    Picker("Anbieter", selection: $m.provider) {
                        ForEach(Meeting.choices) { c in Text(c.label).tag(c.id) }
                    }
                    if m.provider != "none" {
                        HStack {
                            TextField("Meeting-Link", text: $m.link,
                                      prompt: Text(m.provider == "jitsi" ? "wird automatisch erzeugt" : "https://…"))
                            if let site = Meeting.sites[m.provider] {
                                Button("Anlegen …") { Meeting.open(site) }
                                    .help("Seite des Anbieters öffnen, um ein Meeting anzulegen – Link dann hier einfügen")
                            }
                        }
                        Text(linkHint).font(.caption).foregroundStyle(.secondary)
                    }
                }
                Section("Teilnehmer") {
                    if store.accounts.count > 1 {
                        Picker("Von", selection: $m.accountID) {
                            ForEach(store.accounts) { acc in
                                Text(acc.displayName.isEmpty ? acc.email : "\(acc.displayName) <\(acc.email)>").tag(Optional(acc.id))
                            }
                        }
                    }
                    TextField("An", text: $m.to, prompt: Text("leer = nur in meinen Kalender"))
                    SuggestionRow(hits: store.suggestions(for: m.to)) { c in
                        m.to = store.completing(m.to, with: c)
                    }
                    if let msg = message, !m.to.lowercased().contains(msg.fromAddress.lowercased()) {
                        Button("+ \(msg.senderDisplay) einladen") {
                            let entry = msg.senderDisplay.isEmpty || msg.senderDisplay == msg.fromAddress
                                ? msg.fromAddress : "\"\(msg.senderDisplay.replacingOccurrences(of: "\"", with: ""))\" <\(msg.fromAddress)>"
                            let cur = m.to.trimmingCharacters(in: CharacterSet(charactersIn: ",; ").union(.whitespaces))
                            m.to = cur.isEmpty ? entry : "\(cur), \(entry)"
                        }
                    }
                    if inviting {
                        Text("Die Teilnehmer erhalten eine Kalender-Einladung (.ics), die Outlook, Apple Kalender und Google direkt annehmen können. Zu- und Absagen kommen als E-Mail zurück.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                TextField("Ort", text: $m.location)
                if calendar.hasAccess {
                    Toggle("In Apple Kalender eintragen", isOn: $m.saveToCalendar)
                    if m.saveToCalendar {
                        Picker("Kalender", selection: $m.calendarID) {
                            ForEach(calendar.writableCalendars, id: \.calendarIdentifier) { c in
                                Text(c.title).tag(c.calendarIdentifier)
                            }
                        }
                    }
                } else if calendar.status == .notDetermined {
                    Button("Apple Kalender verbinden …") { Task { await calendar.requestAccess() } }
                } else {
                    Text("Kein Zugriff auf Apple Kalender (Systemeinstellungen → Datenschutz & Sicherheit → Kalender).")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Section("Notiz") {
                    TextEditor(text: $m.notes).frame(minHeight: 70)
                }
            }
            .formStyle(.grouped)
            if !m.error.isEmpty {
                Text(m.error).foregroundStyle(.red).font(.caption).padding(.horizontal, 20)
            }
            HStack {
                if m.busy { ProgressView().controlSize(.small) }
                Spacer()
                Button("Abbrechen") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button { save() } label: { Text(inviting ? "Einladung senden" : "Im Kalender speichern") }
                    .keyboardShortcut(.defaultAction)
                    .disabled(m.busy || m.title.trimmingCharacters(in: .whitespaces).isEmpty
                              || (!inviting && !calendar.hasAccess))
            }
            .padding(20)
        }
        .frame(width: 520, height: 720)
        .onAppear { prepare() }
        .onChange(of: m.provider) { p in
            if m.prepared { m.link = store.meetingLinks[p] ?? "" }
        }
    }

    private func prepare() {
        guard !m.prepared else { return }
        if m.calendarID.isEmpty { m.calendarID = calendar.defaultCalendarID }
        m.accountID = message?.accountID ?? store.accounts.first?.id
        var found: MeetingLink? = nil
        if let msg = message, let mb = store.bodies[msg.key] {
            if let text = mb.text, !text.isEmpty { m.notes += "\n\n" + String(text.prefix(1200)) }
            found = Meeting.forBody(msg.key, mb)
        }
        if let f = found {
            m.provider = Meeting.choices.contains(where: { $0.id == f.provider }) ? f.provider : "other"
            m.link = f.url
        } else {
            let def = store.meetingLinks["default"] ?? "none"
            m.provider = Meeting.choices.contains(where: { $0.id == def }) ? def : "none"
            m.link = store.meetingLinks[m.provider] ?? ""
        }
        DispatchQueue.main.async { m.prepared = true }
    }

    private func save() {
        m.error = ""
        var start = m.start
        if m.allDay { start = Calendar.current.startOfDay(for: start) }
        let end = m.allDay ? start.addingTimeInterval(86400) : start.addingTimeInterval(Double(m.minutes) * 60)
        var link = m.link.trimmingCharacters(in: .whitespacesAndNewlines)
        if m.provider == "none" { link = "" }
        if m.provider == "jitsi" && link.isEmpty { link = Meeting.jitsiLink() }
        if m.provider != "none" && link.isEmpty {
            m.error = "Bitte den Meeting-Link eintragen."
            return
        }
        if !link.isEmpty && !link.lowercased().hasPrefix("https://") {
            m.error = "Der Meeting-Link muss mit https:// beginnen."
            return
        }
        let meet = link.isEmpty ? nil : (Meeting.fromURL(link) ?? MeetingLink(provider: "other", name: "Online-Meeting", url: link))
        var notes = m.notes
        if let mt = meet, !notes.contains(mt.url) {
            notes += (notes.isEmpty ? "" : "\n\n") + "\(mt.name) beitreten: \(mt.url)"
        }
        let location = m.location.isEmpty ? (meet?.url ?? "") : m.location
        let calID = m.calendarID.isEmpty ? nil : m.calendarID
        let wantCalendar = m.saveToCalendar && calendar.hasAccess
        if !inviting {
            do {
                try calendar.add(title: m.title, start: start, end: end, allDay: m.allDay, location: location,
                                 notes: notes, calendarID: calID, url: link)
                dismiss()
            } catch {
                m.error = error.localizedDescription
            }
            return
        }
        let model = m
        model.busy = true
        let title = m.title
        let allDay = m.allDay
        let to = m.to
        let accountID = m.accountID
        let place = m.location
        let description = m.notes
        Task { @MainActor in
            do {
                _ = try await store.sendMeetingInvite(accountID: accountID, to: to, title: title, start: start, end: end,
                                                      allDay: allDay, location: place, description: description, meetingURL: link)
                if wantCalendar {
                    try? calendar.add(title: title, start: start, end: end, allDay: allDay, location: location,
                                      notes: notes, calendarID: calID, url: link)
                }
                model.busy = false
                dismiss()
            } catch {
                model.error = error.localizedDescription
                model.busy = false
            }
        }
    }
}


// MARK: - Terminspalte rechts (14 Tage)

struct CalendarPane: View {
    @EnvironmentObject var calendar: CalendarService

    struct DayGroup: Identifiable {
        let day: Date
        var events: [UpcomingEvent]
        var id: Date { day }
    }

    private var groups: [DayGroup] {
        let cal = Calendar.current
        var out: [DayGroup] = []
        for ev in calendar.upcoming {
            let d = cal.startOfDay(for: max(ev.start, cal.startOfDay(for: Date())))
            if let i = out.firstIndex(where: { $0.day == d }) {
                out[i].events.append(ev)
            } else {
                out.append(DayGroup(day: d, events: [ev]))
            }
        }
        return out
    }

    private static func dayTitle(_ d: Date) -> String {
        let cal = Calendar.current
        let f = DateFormatter()
        f.locale = Locale(identifier: "de_DE")
        f.dateFormat = "d. MMMM"
        if cal.isDateInToday(d) { return "Heute, \(f.string(from: d))" }
        if cal.isDateInTomorrow(d) { return "Morgen, \(f.string(from: d))" }
        f.dateFormat = "EEEE, d. MMMM"
        return f.string(from: d)
    }

    private static let time: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        return f
    }()

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Termine").font(.headline)
                Spacer()
                Button { calendar.newMeetingOpen = true } label: { Image(systemName: "plus") }
                    .buttonStyle(.borderless)
                    .help("Neuer Termin / Online-Meeting (⌘⇧M)")
                Button { calendar.reload() } label: { Image(systemName: "arrow.clockwise") }
                    .buttonStyle(.borderless)
                    .help("Neu laden")
                Button { calendar.paneOpen = false } label: { Image(systemName: "sidebar.right") }
                    .buttonStyle(.borderless)
                    .help("Terminspalte ausblenden")
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            Divider()
            if calendar.hasAccess {
                if calendar.upcoming.isEmpty {
                    Text("Keine Termine in den nächsten 14 Tagen.")
                        .foregroundStyle(.secondary)
                        .padding()
                    Spacer()
                } else {
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                            ForEach(groups) { g in
                                Section {
                                    ForEach(g.events) { ev in row(ev) }
                                } header: {
                                    Text(Self.dayTitle(g.day).uppercased())
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(Calendar.current.isDateInToday(g.day) ? Color.accentColor : .secondary)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .padding(.horizontal, 14)
                                        .padding(.top, 12)
                                        .padding(.bottom, 4)
                                        .background(.bar)
                                }
                            }
                        }
                        .padding(.bottom, 12)
                    }
                }
                Divider()
                Text("Nächste 14 Tage · Apple Kalender")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 6)
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    Text("SimpleMail zeigt hier deine Termine aus Apple Kalender.")
                        .foregroundStyle(.secondary)
                    if calendar.status == .notDetermined {
                        Button("Apple Kalender verbinden …") { Task { await calendar.requestAccess() } }
                    } else {
                        Text("Der Zugriff wurde abgelehnt.").font(.caption).foregroundStyle(.secondary)
                        Button("Systemeinstellungen öffnen") { calendar.openPrivacySettings() }
                    }
                }
                .padding()
                Spacer()
            }
        }
        .background(Color(nsColor: .windowBackgroundColor))
    }

    private func row(_ ev: UpcomingEvent) -> some View {
        HStack(spacing: 0) {
            rowButton(ev)
            if let mt = ev.meeting, ev.end > Date() {
                let soon = ev.start.timeIntervalSinceNow < 15 * 60
                Button { Meeting.open(mt.url) } label: {
                    if soon { Text("Beitreten") } else { Image(systemName: "video") }
                }
                .buttonStyle(.bordered)
                .tint(soon ? .accentColor : nil)
                .controlSize(.small)
                .help("\(mt.name) beitreten")
                .padding(.trailing, 10)
            }
        }
    }

    private func rowButton(_ ev: UpcomingEvent) -> some View {
        let past = ev.end < Date()
        return Button {
            calendar.openCalendarApp()
        } label: {
            HStack(alignment: .top, spacing: 10) {
                Text(ev.allDay ? "ganzt." : Self.time.string(from: ev.start))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .frame(width: 42, alignment: .trailing)
                    .padding(.top, 1)
                RoundedRectangle(cornerRadius: 1.5).fill(ev.color).frame(width: 3)
                VStack(alignment: .leading, spacing: 1) {
                    Text(ev.title).fontWeight(.medium).fixedSize(horizontal: false, vertical: true)
                    let place = ev.meeting.map { ev.location.contains($0.url) ? $0.name : ev.location } ?? ev.location
                    let sub = [ev.allDay ? "" : "bis \(Self.time.string(from: ev.end))", place]
                        .filter { !$0.isEmpty }.joined(separator: " · ")
                    if !sub.isEmpty {
                        Text(sub).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .opacity(past ? 0.5 : 1)
        .help(ICS.when(start: ev.start, end: ev.end, allDay: ev.allDay) + (ev.location.isEmpty ? "" : "\n\(ev.location)"))
    }
}

// MARK: - Online-Meetings (Teams, Zoom, Google Meet, Webex …)

struct MeetingLink: Hashable {
    var provider: String
    var name: String
    var url: String
}

struct MeetingChoice: Identifiable {
    let id: String
    let label: String
}

enum Meeting {
    private struct Provider {
        let id: String
        let name: String
        let regex: NSRegularExpression?
    }

    private static func rx(_ p: String) -> NSRegularExpression? {
        try? NSRegularExpression(pattern: p, options: [.caseInsensitive])
    }

    private static let providers: [Provider] = [
        Provider(id: "teams", name: "Microsoft Teams",
                 regex: rx(#"^https://(teams\.microsoft\.com/(l/meetup-join|meet|l/meet)/|teams\.live\.com/meet/)"#)),
        Provider(id: "zoom", name: "Zoom", regex: rx(#"^https://([a-z0-9-]+\.)*zoom(gov)?\.(us|com|de)/(j|my|w|s|wc/join)/"#)),
        Provider(id: "meet", name: "Google Meet", regex: rx(#"^https://meet\.google\.com/[a-z]{3,4}-[a-z]{4}-[a-z]{3,4}"#)),
        Provider(id: "webex", name: "Webex",
                 regex: rx(#"^https://([a-z0-9-]+\.)*webex\.com/(meet/|join/|wbxmjs/|[a-z0-9._-]+/(j|e|m)\.php)"#)),
        Provider(id: "goto", name: "GoTo Meeting",
                 regex: rx(#"^https://(meet\.goto\.com|global\.gotomeeting\.com/join|app\.gotomeeting\.com)/"#)),
        Provider(id: "jitsi", name: "Jitsi Meet", regex: rx(#"^https://meet\.jit\.si/[^\s/?#]+"#)),
        Provider(id: "whereby", name: "Whereby", regex: rx(#"^https://whereby\.com/[^\s/?#]+"#)),
        Provider(id: "skype", name: "Skype", regex: rx(#"^https://join\.skype\.com/"#)),
    ]

    private static let urlRegex = rx(#"https://[^\s<>"'\]\[{}|\\^`]+"#)

    /// Auswahl beim Anlegen eines Termins
    static let choices: [MeetingChoice] = [
        MeetingChoice(id: "none", label: "Kein Online-Meeting"),
        MeetingChoice(id: "teams", label: "Microsoft Teams"),
        MeetingChoice(id: "zoom", label: "Zoom"),
        MeetingChoice(id: "meet", label: "Google Meet"),
        MeetingChoice(id: "webex", label: "Webex"),
        MeetingChoice(id: "jitsi", label: "Jitsi Meet (Link automatisch, ohne Konto)"),
        MeetingChoice(id: "other", label: "Anderer Link"),
    ]

    /// Seiten zum Anlegen eines Meetings beim Anbieter
    static let sites: [String: String] = [
        "teams": "https://teams.microsoft.com/v2/", "zoom": "https://zoom.us/meeting/schedule",
        "webex": "https://signin.webex.com/", "meet": "https://meet.google.com/",
    ]

    /// Feste Links, die synchronisiert werden
    static let linkKeys = ["teams", "zoom", "webex", "meet"]

    static func fromURL(_ u: String) -> MeetingLink? {
        let range = NSRange(u.startIndex..., in: u)
        for p in providers {
            if let r = p.regex, r.firstMatch(in: u, options: [], range: range) != nil {
                return MeetingLink(provider: p.id, name: p.name, url: u)
            }
        }
        return nil
    }

    /// Outlook Safe Links und Google-Weiterleitungen auflösen
    static func unwrap(_ u: String) -> String {
        guard let c = URLComponents(string: u), let host = c.host?.lowercased() else { return u }
        if host.hasSuffix("safelinks.protection.outlook.com"),
           let v = c.queryItems?.first(where: { $0.name == "url" })?.value, !v.isEmpty {
            return v
        }
        if (host.hasPrefix("google.") || host.hasPrefix("www.google.")) && c.path == "/url",
           let v = c.queryItems?.first(where: { $0.name == "q" })?.value, !v.isEmpty {
            return v
        }
        return u
    }

    static func urls(in text: String) -> [String] {
        guard let r = urlRegex, !text.isEmpty else { return [] }
        let t = text.replacingOccurrences(of: "&amp;", with: "&").replacingOccurrences(of: "&#x2F;", with: "/")
        let ns = t as NSString
        var out: [String] = []
        for match in r.matches(in: t, options: [], range: NSRange(location: 0, length: ns.length)) {
            var u = ns.substring(with: match.range)
            while let last = u.last, ".,;:!?)".contains(last) { u.removeLast() }
            out.append(unwrap(u))
        }
        return out
    }

    /// Erster Meeting-Link in den Texten (Reihenfolge = Vorrang)
    static func find(_ texts: [String]) -> MeetingLink? {
        for t in texts {
            for u in urls(in: t) {
                if let m = fromURL(u) { return m }
            }
        }
        return nil
    }

    /// Meeting-Link einer Mail (Einladung oder Text), je Mail zwischengespeichert
    private static var bodyCache: [MessageKey: MeetingLink?] = [:]
    static func forBody(_ key: MessageKey, _ mb: MessageBody) -> MeetingLink? {
        if let hit = bodyCache[key] { return hit }
        var found: MeetingLink? = nil
        if let cal = mb.calendar, let inv = ICS.parse(cal) { found = inv.event.meeting }
        if found == nil { found = find([mb.text ?? "", mb.html ?? ""]) }
        if bodyCache.count > 500 { bodyCache.removeAll() }
        bodyCache[key] = found
        return found
    }

    /// Zufälliger Jitsi-Raum – funktioniert ohne Konto
    static func jitsiLink() -> String {
        let chars = Array("abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789")
        let rnd = String((0..<10).map { _ in chars[Int.random(in: 0..<chars.count)] })
        return "https://meet.jit.si/SimpleMail-\(rnd)"
    }

    /// Nur https-Links; „default“ = Standard-Anbieter
    static func cleanLinks(_ v: [String: String]) -> [String: String] {
        var out: [String: String] = [:]
        for k in linkKeys {
            let u = (v[k] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            out[k] = u.lowercased().hasPrefix("https://") && !u.contains(" ") ? u : ""
        }
        let def = v["default"] ?? "none"
        out["default"] = choices.contains(where: { $0.id == def }) ? def : "none"
        return out
    }

    static func open(_ url: String) {
        guard url.lowercased().hasPrefix("https://"), let u = URL(string: url) else { return }
        NSWorkspace.shared.open(u)
    }

    static func copy(_ url: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(url, forType: .string)
    }
}

/// „🎥 Microsoft Teams  [Beitreten] [Link kopieren]“
struct MeetingJoinRow: View {
    let meeting: MeetingLink

    var body: some View {
        HStack(spacing: 6) {
            Label(meeting.name, systemImage: "video.fill").font(.callout.weight(.semibold))
            Button("Beitreten") { Meeting.open(meeting.url) }
                .buttonStyle(.borderedProminent)
                .help(meeting.url)
            Button("Link kopieren") { Meeting.copy(meeting.url) }
        }
        .controlSize(.small)
    }
}

/// Mail ohne Einladung, aber mit Meeting-Link im Text
struct MeetingBanner: View {
    @EnvironmentObject var calendar: CalendarService
    let meeting: MeetingLink
    let message: MailMessage

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "video.fill").foregroundStyle(Color.accentColor)
            Text("Online-Meeting-Link (\(meeting.name)) in dieser E-Mail").font(.callout)
            Spacer()
            Button("Beitreten") { Meeting.open(meeting.url) }
                .buttonStyle(.borderedProminent)
                .help(meeting.url)
            Button { calendar.newEventFor = message } label: { Label("Termin anlegen", systemImage: "calendar.badge.plus") }
        }
        .controlSize(.small)
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.accentColor.opacity(0.08)))
    }
}

// MARK: - Einladung erzeugen (iMIP REQUEST)

extension ICS {
    static func request(_ ev: CalEvent, meetingURL: String, organizer: CalPerson, attendees: [CalPerson]) -> String {
        let start = ev.start ?? Date()
        let end = ev.end ?? start.addingTimeInterval(3600)
        func cn(_ name: String) -> String {
            let clean = name.replacingOccurrences(of: "\"", with: "").replacingOccurrences(of: "\n", with: " ")
            return clean.isEmpty ? "" : ";CN=\"\(clean)\""
        }
        let meet = meetingURL.isEmpty ? nil : Meeting.fromURL(meetingURL)
        var desc = ev.description
        if !meetingURL.isEmpty {
            desc += (desc.isEmpty ? "" : "\n\n") + "Online-Meeting" + (meet.map { " (\($0.name))" } ?? "") + " beitreten:\n\(meetingURL)"
        }
        var lines = [
            "BEGIN:VCALENDAR", "PRODID:-//SimpleMail//DE", "VERSION:2.0", "CALSCALE:GREGORIAN", "METHOD:REQUEST", "BEGIN:VEVENT",
            "UID:\(ev.uid)", "SEQUENCE:\(ev.sequence)", "DTSTAMP:\(utcStamp(Date()))",
            ev.allDay ? "DTSTART;VALUE=DATE:\(dateStamp(start))" : "DTSTART:\(utcStamp(start))",
            ev.allDay ? "DTEND;VALUE=DATE:\(dateStamp(end))" : "DTEND:\(utcStamp(end))",
            "SUMMARY:\(escape(ev.summary.isEmpty ? "(ohne Titel)" : ev.summary))",
            "STATUS:CONFIRMED", "TRANSP:OPAQUE",
        ]
        if !desc.isEmpty { lines.append("DESCRIPTION:\(escape(desc))") }
        var loc = ev.location
        if loc.isEmpty && !meetingURL.isEmpty { loc = meet.map { "\($0.name): \(meetingURL)" } ?? meetingURL }
        if !loc.isEmpty { lines.append("LOCATION:\(escape(loc))") }
        if !meetingURL.isEmpty {
            lines.append("URL:\(meetingURL)")
            lines.append("CONFERENCE;VALUE=URI;FEATURE=AUDIO,VIDEO;LABEL=\(escape(meet?.name ?? "Online-Meeting")):\(meetingURL)")
            if meet?.provider == "teams" { lines.append("X-MICROSOFT-SKYPETEAMSMEETINGURL:\(meetingURL)") }
        }
        lines.append("ORGANIZER\(cn(organizer.name)):mailto:\(organizer.email)")
        for a in attendees {
            lines.append("ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE\(cn(a.name)):mailto:\(a.email)")
        }
        if !ev.allDay {
            lines += ["BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Erinnerung", "TRIGGER:-PT10M", "END:VALARM"]
        }
        lines += ["END:VEVENT", "END:VCALENDAR"]
        return lines.map(fold).joined(separator: "\r\n") + "\r\n"
    }
}

// MARK: - Einladung versenden, feste Meeting-Links (Store)

extension MailStore {
    /// Schickt eine Termin-Einladung an alle Adressen in „to“ (ohne eigene). Liefert die Zahl der Teilnehmer.
    func sendMeetingInvite(accountID: UUID?, to: String, title: String, start: Date, end: Date, allDay: Bool,
                           location: String, description: String, meetingURL: String) async throws -> Int {
        guard let acc = account(accountID) ?? accounts.first else { throw MailError.noAccount }
        guard end > start else { throw MailError.invalidResponse("Bitte Beginn und Dauer prüfen.") }
        let mine = Set(accounts.map { $0.email.lowercased() })
        var seen = Set<String>()
        var attendees: [CalPerson] = []
        for part in to.split(whereSeparator: { $0 == "," || $0 == ";" }) {
            let parsed = MIME.parseAddress(String(part))
            let email = parsed.address.trimmingCharacters(in: .whitespaces)
            let key = email.lowercased()
            guard email.contains("@"), !mine.contains(key), !seen.contains(key) else { continue }
            seen.insert(key)
            let name = parsed.name.trimmingCharacters(in: .whitespaces)
            attendees.append(CalPerson(email: email, name: name == email ? "" : name, partstat: "NEEDS-ACTION"))
        }
        guard !attendees.isEmpty else { throw MailError.invalidResponse("Bitte mindestens einen Teilnehmer angeben.") }
        var ev = CalEvent()
        ev.uid = "\(UUID().uuidString.lowercased())@simplemail"
        ev.summary = title.trimmingCharacters(in: .whitespaces).isEmpty ? "(ohne Titel)" : title.trimmingCharacters(in: .whitespaces)
        ev.description = description.trimmingCharacters(in: .whitespacesAndNewlines)
        ev.location = location.trimmingCharacters(in: .whitespaces)
        ev.start = start
        ev.end = end
        ev.allDay = allDay
        let organizer = CalPerson(email: acc.email, name: acc.displayName, partstat: "ACCEPTED")
        let meet = meetingURL.isEmpty ? nil : (Meeting.fromURL(meetingURL) ?? MeetingLink(provider: "other", name: "Online-Meeting", url: meetingURL))
        let when = ICS.when(start: start, end: end, allDay: allDay)
        let names = attendees.map { $0.name.isEmpty ? $0.email : $0.name }.joined(separator: ", ")
        let orgText = acc.displayName.isEmpty ? acc.email : "\(acc.displayName) <\(acc.email)>"

        var text = "Einladung: \(ev.summary)\n\nWann: \(when)\n"
        if !ev.location.isEmpty { text += "Wo: \(ev.location)\n" }
        if let mt = meet { text += "Online-Meeting (\(mt.name)): \(mt.url)\n" }
        text += "Organisator: \(orgText)\nTeilnehmer: \(names)\n"
        if !ev.description.isEmpty { text += "\n\(ev.description)\n" }

        func h(_ s: String) -> String {
            s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
                .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
        }
        var html = "<div style=\"font-size:18px;font-weight:600;margin-bottom:6px\">\(h(ev.summary))</div>"
        html += "<div>🗓 \(h(when))</div>"
        if !ev.location.isEmpty { html += "<div>📍 \(h(ev.location))</div>" }
        if let mt = meet {
            html += "<div style=\"margin:14px 0\"><a href=\"\(h(mt.url))\" style=\"background:#0f6cbd;color:#fff;padding:9px 16px;border-radius:6px;text-decoration:none;font-weight:600\">\(h(mt.name)) – jetzt beitreten</a></div>"
            html += "<div style=\"color:#666;font-size:12px\">Link: <a href=\"\(h(mt.url))\">\(h(mt.url))</a></div>"
        }
        html += "<div style=\"margin-top:10px;color:#444\">Organisator: \(h(acc.displayName.isEmpty ? acc.email : acc.displayName))<br>Teilnehmer: \(h(names))</div>"
        if !ev.description.isEmpty { html += "<div style=\"margin-top:12px;white-space:pre-wrap\">\(h(ev.description))</div>" }

        var d = Draft()
        d.accountID = acc.id
        d.to = to
        d.subject = "Einladung: \(ev.summary) – \(when)"
        d.body = text
        d.bodyHtml = html
        d.calendarReply = ICS.request(ev, meetingURL: meet?.url ?? "", organizer: organizer, attendees: attendees)
        d.calendarMethod = "REQUEST"
        try await send(d)
        return attendees.count
    }

    func setMeetingLink(_ key: String, _ value: String) {
        var links = meetingLinks
        links[key] = value.trimmingCharacters(in: .whitespacesAndNewlines)
        meetingLinks = links
        meetingLinksUpdatedAt = nowMillis()
        scheduleSync()
    }
}
