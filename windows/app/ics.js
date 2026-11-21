'use strict';
// iCalendar (RFC 5545) – Einladungen lesen, Antworten erzeugen, Termine eines Kalender-Abos aufbereiten.
// Bewusst ohne Fremdbibliothek; deckt die üblichen Fälle von Google, Apple und Outlook ab.

// Windows-Zeitzonennamen (Outlook) → IANA
const WIN_TZ = {
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'Romance Standard Time': 'Europe/Paris',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Kiev',
  'GTB Standard Time': 'Europe/Bucharest',
  'Russian Standard Time': 'Europe/Moscow',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  'China Standard Time': 'Asia/Shanghai',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'India Standard Time': 'Asia/Kolkata',
  'UTC': 'UTC',
  'Coordinated Universal Time': 'UTC',
};

function validZone(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

function resolveZone(tzid) {
  if (!tzid) return null;
  let tz = String(tzid).replace(/^"|"$/g, '').replace(/^\/+/, '');
  if (WIN_TZ[tz]) return WIN_TZ[tz];
  if (validZone(tz)) return tz;
  // z. B. „(UTC+01:00) Amsterdam, Berlin, Bern, Rom, Stockholm, Wien“
  if (/berlin|amsterdam|wien|vienna|zurich|zürich/i.test(tz)) return 'Europe/Berlin';
  if (/london|dublin|lisbon|lissabon/i.test(tz)) return 'Europe/London';
  if (/paris|brussels|brüssel|madrid|kopenhagen|copenhagen/i.test(tz)) return 'Europe/Paris';
  return null;   // unbekannt → als lokale Zeit behandeln
}

/** Versatz einer Zeitzone zu UTC (ms) zum Zeitpunkt ts */
function zoneOffset(tz, ts) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ts));
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(+v.year, +v.month - 1, +v.day, +v.hour % 24, +v.minute, +v.second);
  return asUTC - ts;
}

function zonedTime(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo, d, h, mi, s);
  let ts = guess - zoneOffset(tz, guess);
  ts = guess - zoneOffset(tz, ts);   // Sommerzeit-Grenzen
  return new Date(ts);
}

/** ICS-Datum → { date, allDay } */
function parseDate(value, params = {}) {
  const v = String(value || '').trim();
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (m || params.VALUE === 'DATE') {
    m = m || /^(\d{4})(\d{2})(\d{2})/.exec(v);
    if (!m) return null;
    return { date: new Date(+m[1], +m[2] - 1, +m[3]), allDay: true };
  }
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)];
  if (m[7]) return { date: new Date(Date.UTC(y, mo, d, h, mi, s)), allDay: false };
  const tz = resolveZone(params.TZID);
  if (tz) return { date: zonedTime(y, mo, d, h, mi, s, tz), allDay: false };
  return { date: new Date(y, mo, d, h, mi, s), allDay: false };
}

function parseDuration(v) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(v || '').trim());
  if (!m) return null;
  const ms = ((+m[2] || 0) * 7 * 86400 + (+m[3] || 0) * 86400 + (+m[4] || 0) * 3600 + (+m[5] || 0) * 60 + (+m[6] || 0)) * 1000;
  return m[1] === '-' ? -ms : ms;
}

function unescapeText(v) {
  return String(v || '').replace(/\\([nN,;\\])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));
}

function escapeText(v) {
  return String(v || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Eine Inhaltszeile: NAME;PARAM=WERT:WERT */
function parseLine(line) {
  let i = 0;
  let quoted = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ':' && !quoted) break;
  }
  const head = line.slice(0, i);
  const value = line.slice(i + 1);
  const segs = [];
  let cur = '';
  quoted = false;
  for (const c of head) {
    if (c === '"') quoted = !quoted;
    if (c === ';' && !quoted) { segs.push(cur); cur = ''; } else cur += c;
  }
  segs.push(cur);
  const params = {};
  for (const p of segs.slice(1)) {
    const k = p.indexOf('=');
    if (k > 0) params[p.slice(0, k).toUpperCase()] = p.slice(k + 1).replace(/^"|"$/g, '');
  }
  return { name: segs[0].toUpperCase(), params, value };
}

function person(prop) {
  if (!prop) return null;
  return {
    email: String(prop.value || '').replace(/^mailto:/i, '').trim(),
    name: prop.params.CN || '',
    partstat: (prop.params.PARTSTAT || 'NEEDS-ACTION').toUpperCase(),
    role: prop.params.ROLE || '',
  };
}

/** Liest einen Kalender: { method, events: [...] } */
function parseICS(text) {
  const lines = String(text || '').replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const out = { method: '', events: [] };
  let ev = null;
  let depth = 0;   // verschachtelte Blöcke (VALARM) im VEVENT überspringen
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const p = parseLine(raw);
    if (p.name === 'BEGIN' && p.value.toUpperCase() === 'VEVENT') { ev = { props: {}, multi: {} }; depth = 0; continue; }
    if (ev && p.name === 'BEGIN') { depth++; continue; }
    if (ev && p.name === 'END' && p.value.toUpperCase() !== 'VEVENT') { depth--; continue; }
    if (ev && p.name === 'END') { out.events.push(buildEvent(ev)); ev = null; continue; }
    if (!ev) { if (p.name === 'METHOD') out.method = p.value.trim().toUpperCase(); continue; }
    if (depth > 0) continue;
    if (p.name === 'ATTENDEE' || p.name === 'EXDATE') (ev.multi[p.name] = ev.multi[p.name] || []).push(p);
    else ev.props[p.name] = p;
  }
  return out;
}

function buildEvent({ props, multi }) {
  const val = (n) => (props[n] ? props[n].value : '');
  const s = props.DTSTART ? parseDate(props.DTSTART.value, props.DTSTART.params) : null;
  let e = props.DTEND ? parseDate(props.DTEND.value, props.DTEND.params) : null;
  if (!e && s && props.DURATION) {
    const d = parseDuration(props.DURATION.value);
    if (d != null) e = { date: new Date(s.date.getTime() + d), allDay: s.allDay };
  }
  if (!e && s) e = { date: new Date(s.date.getTime() + (s.allDay ? 86400e3 : 3600e3)), allDay: s.allDay };
  const exdates = [];
  for (const x of multi.EXDATE || []) {
    for (const part of x.value.split(',')) {
      const d = parseDate(part, x.params);
      if (d) exdates.push(d.date.getTime());
    }
  }
  const rid = props['RECURRENCE-ID'] ? parseDate(props['RECURRENCE-ID'].value, props['RECURRENCE-ID'].params) : null;
  const ev = {
    uid: val('UID'),
    summary: unescapeText(val('SUMMARY')) || '(ohne Titel)',
    description: unescapeText(val('DESCRIPTION')),
    location: unescapeText(val('LOCATION')),
    url: val('URL'),
    status: val('STATUS').toUpperCase(),
    sequence: parseInt(val('SEQUENCE'), 10) || 0,
    start: s ? s.date.toISOString() : null,
    end: e ? e.date.toISOString() : null,
    allDay: !!(s && s.allDay),
    organizer: person(props.ORGANIZER),
    attendees: (multi.ATTENDEE || []).map(person),
    conference: confUrl(props),
    rrule: val('RRULE'),
    exdates,
    recurrenceId: rid ? rid.date.getTime() : null,
  };
  ev.meeting = eventMeeting(ev);
  return ev;
}

/** Konferenz-Link aus den Spezialfeldern von Teams/Google/RFC 7986 */
function confUrl(props) {
  for (const n of ['X-MICROSOFT-SKYPETEAMSMEETINGURL', 'X-MICROSOFT-ONLINEMEETINGCONFLINK', 'X-GOOGLE-CONFERENCE', 'CONFERENCE']) {
    const v = props[n] && String(props[n].value || '').trim();
    if (v && /^https:\/\//i.test(v)) return v;
  }
  return '';
}

// ---------------------------------------------------------------- Wiederholungen

const DAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function parseRule(text) {
  const r = {};
  for (const part of String(text || '').split(';')) {
    const [k, v] = part.split('=');
    if (k && v) r[k.toUpperCase()] = v;
  }
  return r;
}

/** n-ter Wochentag im Monat (n<0: vom Ende) */
function nthWeekday(year, month, weekday, n) {
  if (n > 0) {
    const first = new Date(year, month, 1).getDay();
    const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
    return day <= new Date(year, month + 1, 0).getDate() ? day : null;
  }
  const lastDate = new Date(year, month + 1, 0).getDate();
  const last = new Date(year, month, lastDate).getDay();
  const day = lastDate - ((last - weekday + 7) % 7) + (n + 1) * 7;
  return day >= 1 ? day : null;
}

/** Alle Vorkommen eines Termins im Zeitraum [from, to) */
function occurrences(ev, from, to) {
  if (!ev.start) return [];
  const start = new Date(ev.start);
  const dur = new Date(ev.end).getTime() - start.getTime();
  const hit = (s) => s.getTime() < to.getTime() && s.getTime() + Math.max(dur, 1) > from.getTime();
  const make = (s) => ({ ...ev, start: s.toISOString(), end: new Date(s.getTime() + dur).toISOString() });
  if (!ev.rrule) return hit(start) ? [make(start)] : [];

  const r = parseRule(ev.rrule);
  const freq = r.FREQ;
  const interval = Math.max(1, parseInt(r.INTERVAL, 10) || 1);
  const count = parseInt(r.COUNT, 10) || Infinity;
  const until = r.UNTIL ? (parseDate(r.UNTIL) || {}).date : null;
  const byday = r.BYDAY ? r.BYDAY.split(',').map((x) => {
    const m = /^([+-]?\d+)?([A-Z]{2})$/.exec(x.trim());
    return m ? { n: m[1] ? parseInt(m[1], 10) : 0, d: DAYS[m[2]] } : null;
  }).filter(Boolean) : [];
  const bymonthday = r.BYMONTHDAY ? r.BYMONTHDAY.split(',').map((x) => parseInt(x, 10)) : [];
  const bymonth = r.BYMONTH ? r.BYMONTH.split(',').map((x) => parseInt(x, 10) - 1) : [];
  const h = start.getHours(); const mi = start.getMinutes(); const se = start.getSeconds();
  const at = (y, mo, d) => new Date(y, mo, d, h, mi, se);
  const ex = new Set(ev.exdates || []);
  const out = [];
  let n = 0;
  const take = (s) => {
    if (s < start) return true;
    if (until && s > until) return false;
    if (n >= count) return false;
    n++;
    if (!ex.has(s.getTime()) && hit(s)) out.push(make(s));
    return s.getTime() < to.getTime();
  };

  // Ohne COUNT kann direkt kurz vor dem Zeitraum begonnen werden
  let k0 = 0;
  if (count === Infinity && (freq === 'DAILY' || freq === 'WEEKLY')) {
    const period = (freq === 'DAILY' ? 1 : 7) * interval * 86400e3;
    k0 = Math.max(0, Math.floor((from.getTime() - start.getTime()) / period) - 1);
  } else if (count === Infinity && freq === 'MONTHLY') {
    const months = (from.getFullYear() - start.getFullYear()) * 12 + from.getMonth() - start.getMonth();
    k0 = Math.max(0, Math.floor(months / interval) - 1);
  }
  for (let k = k0, guard = 0; guard < 20000; k++, guard++) {
    let cands = [];
    if (freq === 'DAILY') {
      cands = [at(start.getFullYear(), start.getMonth(), start.getDate() + k * interval)];
    } else if (freq === 'WEEKLY') {
      const weekStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() - ((start.getDay() + 6) % 7) + k * 7 * interval);
      const days = byday.length ? byday.map((b) => b.d) : [start.getDay()];
      cands = days.map((d) => at(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + ((d + 6) % 7)));
    } else if (freq === 'MONTHLY') {
      const base = new Date(start.getFullYear(), start.getMonth() + k * interval, 1);
      const y = base.getFullYear(); const mo = base.getMonth();
      const dim = new Date(y, mo + 1, 0).getDate();
      if (byday.length) {
        for (const b of byday) {
          if (b.n) { const d = nthWeekday(y, mo, b.d, b.n); if (d) cands.push(at(y, mo, d)); }
          else for (let d = 1; d <= dim; d++) if (new Date(y, mo, d).getDay() === b.d) cands.push(at(y, mo, d));
        }
      } else {
        const days = bymonthday.length ? bymonthday : [start.getDate()];
        for (const d0 of days) { const d = d0 < 0 ? dim + d0 + 1 : d0; if (d >= 1 && d <= dim) cands.push(at(y, mo, d)); }
      }
    } else if (freq === 'YEARLY') {
      const y = start.getFullYear() + k * interval;
      const months = bymonth.length ? bymonth : [start.getMonth()];
      for (const mo of months) {
        if (byday.length && byday[0].n) { const d = nthWeekday(y, mo, byday[0].d, byday[0].n); if (d) cands.push(at(y, mo, d)); }
        else { const d = start.getDate(); if (d <= new Date(y, mo + 1, 0).getDate()) cands.push(at(y, mo, d)); }
      }
    } else {
      return hit(start) ? [make(start)] : [];
    }
    cands.sort((a, b) => a - b);
    let more = true;
    for (const c of cands) { if (!take(c)) { more = false; break; } }
    if (!more) break;
  }
  return out;
}

/** Termine eines Kalenders im Zeitraum, inkl. Wiederholungen und Ausnahmen */
function eventsBetween(cal, from, to) {
  const overrides = new Map();   // uid → Set(recurrenceId)
  for (const ev of cal.events) {
    if (ev.recurrenceId != null) {
      if (!overrides.has(ev.uid)) overrides.set(ev.uid, new Set());
      overrides.get(ev.uid).add(ev.recurrenceId);
    }
  }
  const list = [];
  for (const ev of cal.events) {
    if (ev.status === 'CANCELLED') continue;
    if (ev.recurrenceId != null) { list.push(...occurrences({ ...ev, rrule: '' }, from, to)); continue; }
    const skip = overrides.get(ev.uid);
    const exdates = skip ? [...ev.exdates, ...skip] : ev.exdates;
    list.push(...occurrences({ ...ev, exdates }, from, to));
  }
  return list.sort((a, b) => new Date(a.start) - new Date(b.start));
}

// ---------------------------------------------------------------- Antworten (iMIP REPLY)

function fold(line) {
  const out = [];
  let rest = line;
  while (Buffer.byteLength(rest, 'utf8') > 74) {
    let cut = 74;
    while (Buffer.byteLength(rest.slice(0, cut), 'utf8') > 74) cut--;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}

function utcStamp(d) {
  return new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function dateStamp(d) {
  const x = new Date(d);
  return `${x.getFullYear()}${String(x.getMonth() + 1).padStart(2, '0')}${String(x.getDate()).padStart(2, '0')}`;
}

/** Antwort auf eine Einladung; partstat: ACCEPTED | TENTATIVE | DECLINED */
function buildReply(ev, me, partstat) {
  const org = ev.organizer || {};
  const lines = [
    'BEGIN:VCALENDAR', 'PRODID:-//SimpleMail//DE', 'VERSION:2.0', 'METHOD:REPLY', 'BEGIN:VEVENT',
    `UID:${ev.uid}`, `SEQUENCE:${ev.sequence || 0}`, `DTSTAMP:${utcStamp(Date.now())}`,
    ev.allDay ? `DTSTART;VALUE=DATE:${dateStamp(ev.start)}` : `DTSTART:${utcStamp(ev.start)}`,
    ev.allDay ? `DTEND;VALUE=DATE:${dateStamp(ev.end)}` : `DTEND:${utcStamp(ev.end)}`,
    `SUMMARY:${escapeText(ev.summary)}`,
    `ORGANIZER${org.name ? `;CN="${org.name.replace(/"/g, '')}"` : ''}:mailto:${org.email}`,
    `ATTENDEE;PARTSTAT=${partstat}${me.name ? `;CN="${me.name.replace(/"/g, '')}"` : ''}:mailto:${me.email}`,
  ];
  if (ev.recurrenceId != null) lines.push(`RECURRENCE-ID:${utcStamp(ev.recurrenceId)}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}


// ---------------------------------------------------------------- Online-Meetings (Teams, Zoom, Meet, Webex …)

const MEETING_PROVIDERS = [
  { id: 'teams', name: 'Microsoft Teams', re: /^https:\/\/(teams\.microsoft\.com\/(l\/meetup-join|meet|l\/meet)\/|teams\.live\.com\/meet\/)/i },
  { id: 'zoom', name: 'Zoom', re: /^https:\/\/([a-z0-9-]+\.)*zoom(gov)?\.(us|com|de)\/(j|my|w|s|wc\/join)\//i },
  { id: 'meet', name: 'Google Meet', re: /^https:\/\/meet\.google\.com\/[a-z]{3,4}-[a-z]{4}-[a-z]{3,4}/i },
  { id: 'webex', name: 'Webex', re: /^https:\/\/([a-z0-9-]+\.)*webex\.com\/(meet\/|join\/|wbxmjs\/|[a-z0-9._-]+\/(j|e|m)\.php)/i },
  { id: 'goto', name: 'GoTo Meeting', re: /^https:\/\/(meet\.goto\.com|global\.gotomeeting\.com\/join|app\.gotomeeting\.com)\//i },
  { id: 'jitsi', name: 'Jitsi Meet', re: /^https:\/\/meet\.jit\.si\/[^\s/?#]+/i },
  { id: 'whereby', name: 'Whereby', re: /^https:\/\/whereby\.com\/[^\s/?#]+/i },
  { id: 'skype', name: 'Skype', re: /^https:\/\/join\.skype\.com\//i },
];
const PROVIDER_NAMES = Object.fromEntries(MEETING_PROVIDERS.map((p) => [p.id, p.name]));

/** Weiterleitungen (Outlook Safe Links, Google) auflösen */
function unwrapUrl(u) {
  try {
    const x = new URL(u);
    if (/(^|\.)safelinks\.protection\.outlook\.com$/i.test(x.hostname) && x.searchParams.get('url')) return x.searchParams.get('url');
    if (/^(www\.)?google\.[a-z.]+$/i.test(x.hostname) && x.pathname === '/url' && x.searchParams.get('q')) return x.searchParams.get('q');
  } catch { /* kein gültiger Link */ }
  return u;
}

function urlsIn(text) {
  const t = String(text || '').replace(/&amp;/g, '&').replace(/&#x2F;|&#47;/gi, '/');
  const out = [];
  for (const m of t.matchAll(/https:\/\/[^\s<>"'\]\[{}|\\^`]+/gi)) {
    out.push(unwrapUrl(m[0].replace(/[.,;:!?)]+$/, '')));
  }
  return out;
}

function meetingFromUrl(u) {
  const p = MEETING_PROVIDERS.find((x) => x.re.test(u));
  return p ? { provider: p.id, name: p.name, url: u } : null;
}

/** Erster Meeting-Link in den Texten (Reihenfolge = Vorrang) */
function findMeeting(...texts) {
  for (const t of texts) {
    for (const u of urlsIn(t)) {
      const m = meetingFromUrl(u);
      if (m) return m;
    }
  }
  return null;
}

function eventMeeting(ev) {
  return findMeeting(ev.conference, ev.url, ev.location, ev.description);
}

/** Zufälliger Jitsi-Raum – funktioniert ohne Konto */
function jitsiLink() {
  const rnd = require('crypto').randomBytes(9).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10);
  return `https://meet.jit.si/SimpleMail-${rnd}`;
}

/** Einladung (iMIP REQUEST) */
function buildRequest(ev, organizer, attendees) {
  const cn = (n) => (n ? `;CN="${String(n).replace(/["\r\n]/g, '')}"` : '');
  const meet = ev.meetingUrl ? meetingFromUrl(ev.meetingUrl) : null;
  let desc = ev.description || '';
  if (ev.meetingUrl) desc = `${desc ? `${desc}\n\n` : ''}Online-Meeting${meet ? ` (${meet.name})` : ''} beitreten:\n${ev.meetingUrl}`;
  const lines = [
    'BEGIN:VCALENDAR', 'PRODID:-//SimpleMail//DE', 'VERSION:2.0', 'CALSCALE:GREGORIAN', 'METHOD:REQUEST', 'BEGIN:VEVENT',
    `UID:${ev.uid}`, `SEQUENCE:${ev.sequence || 0}`, `DTSTAMP:${utcStamp(Date.now())}`,
    ev.allDay ? `DTSTART;VALUE=DATE:${dateStamp(ev.start)}` : `DTSTART:${utcStamp(ev.start)}`,
    ev.allDay ? `DTEND;VALUE=DATE:${dateStamp(ev.end)}` : `DTEND:${utcStamp(ev.end)}`,
    `SUMMARY:${escapeText(ev.summary || '(ohne Titel)')}`,
    'STATUS:CONFIRMED', 'TRANSP:OPAQUE',
  ];
  if (desc) lines.push(`DESCRIPTION:${escapeText(desc)}`);
  const loc = ev.location || (ev.meetingUrl ? (meet ? `${meet.name}: ${ev.meetingUrl}` : ev.meetingUrl) : '');
  if (loc) lines.push(`LOCATION:${escapeText(loc)}`);
  if (ev.meetingUrl) {
    lines.push(`URL:${ev.meetingUrl}`);
    lines.push(`CONFERENCE;VALUE=URI;FEATURE=AUDIO,VIDEO;LABEL=${escapeText(meet ? meet.name : 'Online-Meeting')}:${ev.meetingUrl}`);
    if (meet && meet.provider === 'teams') lines.push(`X-MICROSOFT-SKYPETEAMSMEETINGURL:${ev.meetingUrl}`);
  }
  lines.push(`ORGANIZER${cn(organizer.name)}:mailto:${organizer.email}`);
  for (const a of attendees) {
    lines.push(`ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE${cn(a.name)}:mailto:${a.email}`);
  }
  if (!ev.allDay) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Erinnerung', 'TRIGGER:-PT10M', 'END:VALARM');
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

// ---------------------------------------------------------------- Google-Kalender (Vorlage im Browser)

function googleTemplateUrl(ev) {
  const dates = ev.allDay
    ? `${dateStamp(ev.start)}/${dateStamp(ev.end)}`
    : `${utcStamp(ev.start)}/${utcStamp(ev.end)}`;
  const q = new URLSearchParams({ action: 'TEMPLATE', text: ev.summary || '', dates });
  if (ev.description) q.set('details', ev.description.slice(0, 1500));
  if (ev.location) q.set('location', ev.location);
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

module.exports = { parseICS, eventsBetween, occurrences, buildReply, buildRequest, googleTemplateUrl, parseDate, resolveZone,
  findMeeting, meetingFromUrl, eventMeeting, jitsiLink, MEETING_PROVIDERS, PROVIDER_NAMES };
