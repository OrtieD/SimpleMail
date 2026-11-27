'use strict';
/* SimpleMail für Windows – Oberfläche */

// =================================================================== Hilfen

const $ = (sel, root = document) => root.querySelector(sel);
// `api` stellt preload.js global bereit (window.api)

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const keyOf = (m) => `${m.accountId}|${m.folder}|${m.uid}`;
const sender = (m) => m.fromName || m.fromAddress || '(unbekannt)';
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

const ICONS = {
  inbox: 'M4 4h16v10h-4l-2 3h-4l-2-3H4V4zm0 12h3.5l2 3h5l2-3H20v4H4v-4z',
  tray: 'M4 13h4l2 3h4l2-3h4v6H4v-6zm2-9h12l2 7h-5l-2 3h-2l-2-3H4l2-7z',
  unread: 'M4 6h12v2H6v8h12v-5h2v7H4V6zm16-3a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3z',
  clock: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm0 2a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm1 2v5.6l3.7 2.2-1 1.7L11 13.7V7h2z',
  send: 'M3 20l18-8L3 4v6l12 2-12 2v6z',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-4 0-8 2-8 5v1h16v-1c0-3-4-5-8-5z',
  bell: 'M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zm6-6V11a6 6 0 0 0-5-5.9V4h-2v1.1A6 6 0 0 0 6 11v5l-2 2v1h16v-1l-2-2z',
  news: 'M4 5h13v14H5a1 1 0 0 1-1-1V5zm15 3h2v10a2 2 0 0 1-2 2V8zM6 7v4h4V7H6zm6 0v2h3V7h-3zm0 4v2h3v-2h-3zm-6 2v2h9v-2H6z',
  drafts: 'M6 2h9l5 5v15H6V2zm8 1.5V8h4.5L14 3.5zM8 12v2h8v-2H8zm0 4v2h8v-2H8z',
  sent: 'M3 20l18-8L3 4v6l12 2-12 2v6z',
  archive: 'M3 4h18v4H3V4zm1 5h16v11H4V9zm5 3v2h6v-2H9z',
  junk: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm-5.6 5.8A7.9 7.9 0 0 0 4 12a8 8 0 0 0 12.2 6.8L6.4 7.8zm11.2 8.4A8 8 0 0 0 7.8 5.4l9.8 10.8z',
  trash: 'M9 3h6l1 2h4v2H4V5h4l1-2zM5 8h14l-1 13H6L5 8zm4 2v9h2v-9H9zm4 0v9h2v-9h-2z',
  folder: 'M3 5h7l2 2h9v12H3V5z',
  reply: 'M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z',
  replyAll: 'M7 8V5l-7 7 7 7v-3l-4-4 4-4zm6 1V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z',
  forward: 'M14 9V5l7 7-7 7v-4.1c-5 0-8.5 1.6-11 5.1 1-5 4-10 11-11z',
  flag: 'M5 3h2v18H5V3zm3 1h11l-3 5 3 5H8V4z',
  read: 'M12 3l9 6v12H3V9l9-6zm0 2.4L5.5 9.7 12 14l6.5-4.3L12 5.4z',
  clip: 'M16.5 6.5v10a4.5 4.5 0 0 1-9 0V5a3 3 0 0 1 6 0v10.5a1.5 1.5 0 0 1-3 0V6.5H9v9a3 3 0 0 0 6 0V5a4.5 4.5 0 0 0-9 0v11.5a6 6 0 0 0 12 0v-10h-1.5z',
  download: 'M11 3h2v10l3.5-3.5 1.4 1.4L12 16.8l-5.9-5.9 1.4-1.4L11 13V3zM4 18h16v2H4v-2z',
  mail: 'M3 5h18v14H3V5zm2 2v.5l7 4.5 7-4.5V7H5zm0 2.9V17h14V9.9l-7 4.5-7-4.5z',
  eye: 'M12 5c5 0 9 4.5 10 7-1 2.5-5 7-10 7S3 14.5 2 12c1-2.5 5-7 10-7zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  gear: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8.9 5-.1-2 2-1.6-2-3.4-2.4.8a8 8 0 0 0-1.7-1L16.2 3h-4l-.5 2.8a8 8 0 0 0-1.7 1l-2.4-.8-2 3.4 2 1.6-.1 1 .1 1-2 1.6 2 3.4 2.4-.8a8 8 0 0 0 1.7 1l.5 2.8h4l.5-2.8a8 8 0 0 0 1.7-1l2.4.8 2-3.4-2-1.6z',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7l1-8z',
  more: 'M5 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  snippet: 'M4 4h16v2H4V4zm0 4h10v2H4V8zm0 4h16v2H4v-2zm0 4h10v2H4v-2zm14-1h2v3h3v2h-3v3h-2v-3h-3v-2h3v-3z',
  calendar: 'M7 2h2v2h6V2h2v2h3v17H4V4h3V2zM6 9v10h12V9H6zm2 2h3v3H8v-3z',
  refresh: 'M12 5a7 7 0 1 0 6.7 9h-2.1A5 5 0 1 1 12 7c1.4 0 2.6.6 3.5 1.5L13 11h7V4l-2.6 2.6A7 7 0 0 0 12 5z',
};
ICONS.sortDesc = 'M11 4h2v12.2l4.6-4.6 1.4 1.4-7 7-7-7 1.4-1.4 4.6 4.6V4z';
ICONS.sortAsc = 'M13 20h-2V7.8l-4.6 4.6L5 11l7-7 7 7-1.4 1.4L13 7.8V20z';
ICONS.print = 'M7 3h10v4H7V3zM5 8h14a2 2 0 0 1 2 2v6h-4v4H7v-4H3v-6a2 2 0 0 1 2-2zm4 7v3h6v-3H9zm8-5a1 1 0 1 0 0 2 1 1 0 0 0 0-2z';
ICONS.window = 'M4 4h16v16H4V4zm2 4v10h12V8H6z';
const icon = (name, cls = 'ico') => `<svg viewBox="0 0 24 24" class="${cls}"><path d="${ICONS[name] || ICONS.folder}"/></svg>`;

const CATEGORIES = [
  { id: 'personal', title: 'Persönlich', icon: 'person' },
  { id: 'notification', title: 'Benachrichtigungen', icon: 'bell' },
  { id: 'newsletter', title: 'Newsletter', icon: 'news' },
];

const ROLE_ICON = { inbox: 'tray', drafts: 'drafts', sent: 'sent', archive: 'archive', junk: 'junk', trash: 'trash', other: 'folder' };

const fmtTime = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const fmtDay = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' });
const fmtShort = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
const fmtFull = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
const fmtWeekday = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function listDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  if (sameDay(d, now)) return fmtTime.format(d);
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return 'Gestern';
  if (d.getFullYear() === now.getFullYear()) return fmtDay.format(d);
  return fmtShort.format(d);
}

const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

const PALETTE = ['#0f6cbd', '#8764b8', '#c239b3', '#da3b01', '#038387', '#107c10', '#5c2e91', '#c50f1f'];
function avatar(name, big = false) {
  const letters = String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return `<div class="avatar${big ? ' big' : ''}" style="background:${PALETTE[h % PALETTE.length]}">${esc(letters)}</div>`;
}

// ---- Farben für Konten und Kontakte (gleiche Liste wie in der Mac-Version)
const COLOR_CHOICES = [
  ['#0a84ff', 'Blau'], ['#ff3b30', 'Rot'], ['#34c759', 'Grün'], ['#ff9500', 'Orange'], ['#af52de', 'Lila'],
  ['#ff2d55', 'Pink'], ['#30b0c7', 'Türkis'], ['#5856d6', 'Indigo'], ['#a2845e', 'Braun'], ['#8e8e93', 'Grau'],
];
const validColor = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c.toLowerCase() : '');
/** Kontofarbe: gewählt oder automatisch aus der Adresse (auf Mac und Windows gleich) */
function accountColor(a) {
  if (!a) return COLOR_CHOICES[9][0];
  if (validColor(a.color)) return validColor(a.color);
  let h = 0;
  for (const ch of String(a.email || '').toLowerCase()) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return COLOR_CHOICES[h % COLOR_CHOICES.length][0];
}
/** Farbauswahl (Kreise); data-x bzw. data-act wird vom Aufrufer gesetzt */
function swatchesHtml(attr, current, autoLabel) {
  const cur = validColor(current);
  return `<div class="swatches">
    <button type="button" class="swatch none${cur ? '' : ' active'}" ${attr} data-color="" title="${esc(autoLabel)}">${autoLabel === 'Keine' ? '∅' : 'A'}</button>
    ${COLOR_CHOICES.map(([c, n]) => `<button type="button" class="swatch${cur === c ? ' active' : ''}" ${attr} data-color="${c}" title="${n}" style="background:${c}"></button>`).join('')}
  </div>`;
}
/** Schriftfarbe eines Kontakts zur Absenderadresse ('' = keine) */
const contactColor = (addr) => (S.contactColors && S.contactColors.get(String(addr || '').toLowerCase())) || '';

// 3.2.38: Schriftfarbe für einzelne Ordner der Seitenleiste – synchronisiert als folderColors
// Schlüssel „adresse|lesbarer Pfad“ (auf Mac und Windows gleich), Wert { color, deleted, updatedAt }
const folderColorKey = (accId, path) => { const a = findAccount(accId); return a ? `${a.email.toLowerCase()}|${path}` : ''; };
function folderColor(accId, path) {
  const e = (S.settings.folderColors || {})[folderColorKey(accId, path)];
  return e && !e.deleted ? validColor(e.color) : '';
}
function setFolderColor(accId, path, color) {
  const key = folderColorKey(accId, path);
  if (!key) return;
  const c = validColor(color);
  S.settings.folderColors = S.settings.folderColors || {};
  const cur = S.settings.folderColors[key];
  if (!c && (!cur || cur.deleted)) return;
  S.settings.folderColors[key] = { color: c, deleted: !c, updatedAt: now() };
  saveSettings();
  renderSidebar();
}
/** Ordnerfarben beim Umbenennen (auch Unterordner) mitnehmen bzw. beim Löschen entfernen; to = null → löschen */
function moveFolderColors(accId, from, to, delim) {
  const a = findAccount(accId);
  const map = S.settings.folderColors || {};
  if (!a) return false;
  const pre = `${a.email.toLowerCase()}|`;
  const t = now();
  let changed = false;
  for (const [k, v] of Object.entries({ ...map })) {
    if (!k.startsWith(pre) || !v || v.deleted) continue;
    const p = k.slice(pre.length);
    if (p !== from && !(delim && p.startsWith(from + delim))) continue;
    if (to !== null) map[pre + to + p.slice(from.length)] = { color: v.color, deleted: false, updatedAt: t };
    map[k] = { color: '', deleted: true, updatedAt: t };
    changed = true;
  }
  S.settings.folderColors = map;
  return changed;
}
function folderColorMenu(accId, path, x, y) {
  const cur = folderColor(accId, path);
  showMenu(x, y, [
    { label: 'Keine Farbe', check: !cur, action: () => setFolderColor(accId, path, '') },
    '-',
    ...COLOR_CHOICES.map(([c, n]) => ({ label: n, color: c, check: cur === c, action: () => setFolderColor(accId, path, c) })),
  ]);
}
const colorStyle = (c) => (c ? ` style="color:${c}"` : '');

// ---- HTML-Signatur
const textToHtml = (t) => esc(t).replace(/\r?\n/g, '<br>');

function htmlToText(html) {
  if (!html) return '';
  const prepared = String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|h[1-6]|li|table)>/gi, '\n');
  const doc = new DOMParser().parseFromString(prepared, 'text/html');
  doc.querySelectorAll('img').forEach((img) => img.replaceWith(img.getAttribute('alt') ? `[${img.getAttribute('alt')}]` : ''));
  doc.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') || '';
    if (/^https?:/i.test(href) && !/maps\.(apple|google)\.|goo\.gl\/maps/i.test(href) && !a.textContent.includes(href.replace(/^https?:\/\//i, '').replace(/\/$/, ''))) a.append(` <${href}>`);
  });
  return (doc.body.textContent || '').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

const isRichHtml = (h) => /<(img|a|b|strong|i|em|u|font|table|span[^>]*style|p[^>]*style|div[^>]*style)\b/i.test(h || '');

/** Entfernt Skripte, Event-Handler und Office-Ballast aus eingefügtem HTML */
function cleanSignatureHtml(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  // Signatur-Generatoren liefern eine ganze Webseite – nur der Signatur-Teil zählt
  const container = doc.querySelector('.signature-container');
  if (container) doc.body.innerHTML = container.innerHTML;
  doc.querySelectorAll('a[href^="tel:" i]').forEach((a) => {
    a.setAttribute('href', 'tel:' + a.getAttribute('href').slice(4).replace(/[^\d+]/g, ''));
  });
  doc.querySelectorAll('script,style,iframe,frame,frameset,object,embed,applet,portal,base,meta,link,title,form,input,button,textarea,select,noscript,template').forEach((n) => n.remove());
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT);
  const drop = [];
  let n = walker.nextNode();
  while (n) {
    if (n.nodeType === 8 || n.nodeName.includes(':')) drop.push(n);
    else {
      for (const attr of [...n.attributes]) {
        const v = attr.value.trim().toLowerCase();
        if (attr.name.startsWith('on') || attr.name === 'class' || attr.name === 'lang' || attr.name === 'srcdoc' ||
            attr.name === 'formaction' || attr.name === 'action' ||
            (['href', 'src', 'xlink:href', 'background', 'srcset'].includes(attr.name) &&
              /^(javascript|vbscript|file|data:text\/html)/.test(v.replace(/[\s\u0000-\u001f]/g, '')))) n.removeAttribute(attr.name);
      }
    }
    n = walker.nextNode();
  }
  for (const d of drop) { if (d.nodeType === 8) d.remove(); else d.replaceWith(...d.childNodes); }
  return doc.body.innerHTML.trim();
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), 2500);
}

// Zeitvorschläge
function atHour(hour, daysFromNow) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, 0, 0, 0);
  return d;
}
function nextWeekday(weekday, hour) { // 0 = So … 6 = Sa
  const d = new Date();
  let diff = (weekday - d.getDay() + 7) % 7;
  if (diff === 0) diff = 7;
  d.setDate(d.getDate() + diff);
  d.setHours(hour, 0, 0, 0);
  return d;
}
function snoozeOptions() {
  const now = new Date();
  const list = [{ title: 'In 3 Stunden', date: new Date(Date.now() + 3 * 3600e3) }];
  if (now.getHours() < 17) list.push({ title: 'Heute Abend (18:00)', date: atHour(18, 0) });
  list.push({ title: 'Morgen früh (8:00)', date: atHour(8, 1) });
  if (now.getDay() !== 0 && now.getDay() !== 6) list.push({ title: 'Am Wochenende (Sa 9:00)', date: nextWeekday(6, 9) });
  list.push({ title: 'Nächste Woche (Mo 8:00)', date: nextWeekday(1, 8) });
  return list;
}
function sendLaterOptions() {
  return [
    { title: 'In 1 Stunde', date: new Date(Date.now() + 3600e3) },
    { title: 'Morgen früh (8:00)', date: atHour(8, 1) },
    { title: 'Montag (8:00)', date: nextWeekday(1, 8) },
  ];
}
function toLocalInput(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// =================================================================== Zustand

const S = {
  selContact: null,     // ausgewählter Kontakt (id)
  google: { connected: false, email: '', clientId: '' },   // direkte Google-Kalender-Verbindung
  multi: new Set(),     // Mehrfachauswahl (Schlüssel); ab 2 Einträgen aktiv
  events: null,         // Termine der nächsten Tage (Google iCal) oder null
  eventsError: '',
  inviteAnswers: {},    // messageKey → PARTSTAT (diese Sitzung)
  accounts: [],
  folders: {},          // accountId → [folder]
  push: {},             // accountId → bool
  inbox: {},            // accountId → [message]
  low: {},              // "acc|path" → niedrigste geladene Sequenznummer
  folderMsgs: [],
  searchResults: null,
  view: { type: 'smart' },
  selected: null,
  bodies: {},
  loading: false,
  searching: false,
  error: null,
  search: '',
  outbox: [],
  settings: { snoozes: [], snippets: [], blockImages: true, trusted: {}, offline: { enabled: true, keep: 100, limitMB: 1000 },
    sync: { enabled: false, accountEmail: '' } },
  offline: false,
  syncStatus: {},
  imagesAllowed: new Set(),
  contacts: [],
  pending: false,
};

const findAccount = (id) => S.accounts.find((a) => a.id === id);
const accountLabel = (id) => { const a = findAccount(id); return a ? (a.displayName || a.email) : ''; };
/** Posteingänge aller Konten – oder nur des oben ausgewählten Kontos */
const everyInbox = () => Object.values(S.inbox).flat();
/** Gefilterte Ansichten des Posteingangs – beim Kontowechsel zurück auf die Smart Inbox (3.2.41) */
const FILTERED_INBOX_VIEWS = ['category', 'unread', 'flagged'];
const accountFilter = () => (S.settings.accountFilter && findAccount(S.settings.accountFilter) ? S.settings.accountFilter : null);
const allInbox = () => {
  const f = accountFilter();
  return f ? (S.inbox[f] || []) : everyInbox();
};

async function saveSettings({ sync = true } = {}) {
  try { await api.call('settings:set', S.settings); } catch (e) { showError(e.message); }
  if (sync) scheduleSync();
}

// ---- Synchronisation (die eigentliche Arbeit macht der Hauptprozess)
let syncTimer = null;
function scheduleSync(delay = 3000) {
  if (!S.settings.sync || !S.settings.sync.enabled) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(runSync, delay);
}
async function runSync() {
  if (!S.settings.sync || !S.settings.sync.enabled) return null;
  try {
    const r = await api.call('sync:now');
    S.syncStatus = { ...(await api.call('sync:status')), message: r.message, ok: r.ok };
    if (!r.ok) S.syncStatus.lastError = r.message;
    return r;
  } catch (e) {
    S.syncStatus = { lastError: e.message };
    return null;
  }
}
async function reloadFromDisk() {
  // Kontakte, die hier gerade bearbeitet und noch nicht gespeichert wurden, nicht mit dem älteren Stand überschreiben
  const localContacts = new Map((S.settings.contacts || []).map((c) => [c.id, c]));
  S.settings = Object.assign(S.settings, await api.call('settings:get'));
  let keptLocal = false;
  S.settings.contacts = (S.settings.contacts || []).map((c) => {
    const mine = localContacts.get(c.id);
    if (mine && (mine.updatedAt || 0) > (c.updatedAt || 0)) { keptLocal = true; return mine; }
    return c;
  });
  migrateSettings();
  if (keptLocal) saveSettings();
  S.accounts = await api.call('accounts:list');
  rebuildContacts();   // Kontaktfarben nach Synchronisation aktualisieren
}
const now = () => Date.now();
const liveSnippets = () => S.settings.snippets.filter((x) => !x.deleted);
const liveRules = () => (S.settings.rules || []).filter((x) => !x.deleted).sort((a, b) => (a.order || 0) - (b.order || 0));
const isTrusted = (addr) => { const t = S.settings.trusted[addr]; return !!t && !t.deleted; };

/** Ältere Einstellungsformate angleichen */
function migrateSettings() {
  const st = S.settings;
  if (Array.isArray(st.trusted)) {
    const map = {};
    for (const a of st.trusted) map[a] = { updatedAt: now(), deleted: false };
    st.trusted = map;
  }
  st.trusted = st.trusted || {};
  st.blocked = st.blocked || {};
  st.folderColors = st.folderColors || {};
  st.contacts = (st.contacts || []).map((c) => ({ emails: [], phones: [], updatedAt: 1, ...c }));
  st.offline = Object.assign({ enabled: true, keep: 100, limitMB: 1000 }, st.offline || {});
  st.sync = Object.assign({ enabled: false, accountEmail: '' }, st.sync || {});
  st.calendar = Object.assign({ icsUrl: '' }, st.calendar || {});
  st.layout = Object.assign({ side: 250, list: 400, cal: 300, calOpen: true }, st.layout || {});
  st.listLines = [1, 2, 3].includes(Number(st.listLines)) ? Number(st.listLines) : 2;
  st.accountFilter = st.accountFilter || null;
  st.snippets = (st.snippets || []).map((x) => ({ updatedAt: 1, ...x }));
  st.rules = (st.rules || []).map((r, i) => ({ updatedAt: 1, order: i, enabled: true, match: 'all', conditions: [], actions: {}, ...r }));
  st.snoozes = (st.snoozes || []).map((z) => {
    const a = findAccount(z.accountId);
    return { updatedAt: 1, ...z, accountEmail: z.accountEmail || (a ? a.email.toLowerCase() : '') };
  });
}

// ---- Snooze
const snoozeMatches = (e, m) => e.accountId === m.accountId &&
  (e.messageId && m.messageId ? e.messageId === m.messageId : e.uid === m.uid);
// Index über die „Später“-Einträge: vorher wurde für jede Mail bei jedem Sortieren/Zählen die ganze Liste
// (inkl. gelöschter Einträge) durchsucht. Neu aufgebaut, wenn die Liste ersetzt wird oder wächst;
// „deleted“ wird beim Nachschlagen geprüft (wird direkt am Eintrag gesetzt).
let snoozeIdx = { ref: null, len: -1, any: false, byMid: new Map(), byUid: new Map() };
function snoozeIndex() {
  const list = S.settings.snoozes || [];
  if (snoozeIdx.ref === list && snoozeIdx.len === list.length) return snoozeIdx;
  const byMid = new Map();
  const byUid = new Map();
  let any = false;
  list.forEach((e, i) => {
    if (e.deleted) return;
    any = true;
    const item = { e, i };
    if (e.messageId) {
      const k = `${e.accountId}|${e.messageId}`;
      if (!byMid.has(k)) byMid.set(k, []);
      byMid.get(k).push(item);
    }
    const u = `${e.accountId}|${e.uid}`;
    if (!byUid.has(u)) byUid.set(u, []);
    byUid.get(u).push(item);
  });
  snoozeIdx = { ref: list, len: list.length, any, byMid, byUid };
  return snoozeIdx;
}
function snoozeEntry(m) {
  if (m.folder !== 'INBOX') return null;
  const idx = snoozeIndex();
  if (!idx.any) return null;
  // gleiche Regel wie snoozeMatches; bei mehreren Treffern gewinnt der erste in der Liste
  let best = null;
  const take = (arr, cond) => {
    for (const it of arr || []) {
      if (it.e.deleted || !cond(it.e)) continue;
      if (!best || it.i < best.i) best = it;
    }
  };
  if (m.messageId) {
    take(idx.byMid.get(`${m.accountId}|${m.messageId}`), () => true);
    take(idx.byUid.get(`${m.accountId}|${m.uid}`), (e) => !e.messageId);
  } else {
    take(idx.byUid.get(`${m.accountId}|${m.uid}`), () => true);
  }
  return best ? best.e : null;
}
const isSnoozed = (m) => { const e = snoozeEntry(m); return !!e && new Date(e.until) > new Date(); };
const snoozeUntil = (m) => { const e = snoozeEntry(m); return e && new Date(e.until) > new Date() ? new Date(e.until) : null; };
function sortDate(m) {
  const e = snoozeEntry(m);
  const d = new Date(m.date);
  if (e && new Date(e.until) <= new Date()) return Math.max(new Date(e.until).getTime(), d.getTime());
  return d.getTime();
}

/** Nach Datum sortieren – Richtung gemäß Einstellung (Standard: neueste oben) */
function sortByDate(list) {
  const asc = !!S.settings.sortAsc;
  // Sortierdatum nur einmal je Mail bestimmen (vorher bei jedem Vergleich zweimal, inkl. Datum parsen)
  const keyed = list.map((m) => ({ m, t: sortDate(m) }));
  keyed.sort((a, b) => (asc ? a.t - b.t : b.t - a.t));
  return keyed.map((x) => x.m);
}

function setSortOrder(asc) {
  S.settings.sortAsc = !!asc;
  saveSettings({ sync: false });
  api.call('app:setSort', !!asc).catch(() => {});
  renderList();
}

function visibleMessages() {
  if (S.searchResults) return sortByDate(S.searchResults);
  let list;
  const v = S.view;
  switch (v.type) {
    case 'folder': list = S.folderMsgs; break;
    case 'spam': case 'sent': case 'trash': case 'drafts': {
      // Spam/Gesendet/Papierkorb aller Konten (bzw. des gewählten Kontos), 3.2.36: auch Gesendet + Papierkorb
      const f = accountFilter();
      list = S.folderMsgs.filter((m) => !f || m.accountId === f);
      break;
    }
    case 'snoozed': list = allInbox().filter(isSnoozed); break;
    case 'scheduled': list = []; break;
    case 'contacts': list = []; break;
    case 'unread': {
      // Geöffnete Mails bleiben im Ordner „Ungelesen“ stehen, bis man ihn verlässt
      // (eine schon vorher ausgewählte, gelesene Mail zählt nicht dazu)
      if (S.unreadKeepView !== v) { S.unreadKeepView = v; S.unreadKeep = new Set(); S.unreadKeepBase = S.selected; }
      if (S.selected && S.selected === S.unreadKeepBase && !findMessage(S.selected)?.isRead) S.unreadKeepBase = null;
      if (S.selected && S.selected !== S.unreadKeepBase) S.unreadKeep.add(S.selected);
      list = allInbox().filter((m) => !isSnoozed(m) && (!m.isRead || S.unreadKeep.has(keyOf(m))));
      break;
    }
    case 'flagged': list = allInbox().filter((m) => !isSnoozed(m) && m.isFlagged); break;
    case 'category': list = allInbox().filter((m) => !isSnoozed(m) && m.category === v.cat); break;
    default: list = allInbox().filter((m) => !isSnoozed(m));
  }
  const q = S.search.trim().toLowerCase();
  if (q) {
    list = list.filter((m) => m.subject.toLowerCase().includes(q) || m.fromName.toLowerCase().includes(q) ||
      m.fromAddress.toLowerCase().includes(q));
  }
  return sortByDate(list);
}

function findMessage(key) {
  if (!key) return null;
  const [acc] = key.split('|');
  return (S.inbox[acc] || []).find((m) => keyOf(m) === key) ||
    S.folderMsgs.find((m) => keyOf(m) === key) ||
    (S.searchResults || []).find((m) => keyOf(m) === key) || null;
}

const unreadCount = (cat) => allInbox().filter((m) => !m.isRead && !isSnoozed(m) && (!cat || m.category === cat)).length;

// =================================================================== Laden

function showError(msg) {
  S.error = msg;
  renderStatus();
}

async function init() {
  try {
    S.accounts = await api.call('accounts:list');
    S.settings = Object.assign(S.settings, await api.call('settings:get'));
    migrateSettings();
    // Start immer mit Smart Inbox über alle Konten (kein Kontofilter aus der letzten Sitzung), alle Konten mit Ordnern sichtbar
    S.view = { type: 'smart' };
    if (S.settings.accountFilter) { S.settings.accountFilter = null; saveSettings({ sync: false }).catch(() => {}); }
    S.outbox = await api.call('outbox:list');
    S.syncStatus = await api.call('sync:status');
    api.call('app:setListLines', S.settings.listLines).catch(() => {});
    api.call('app:setSort', !!S.settings.sortAsc).catch(() => {});
    // Offline-Ablage: zuletzt gespeicherten Stand sofort anzeigen
    for (const a of S.accounts) {
      const c = await api.call('cache:headers', a.id, 'INBOX');
      if (c) { S.inbox[a.id] = personalize(withoutRemoved(c.messages)); S.low[`${a.id}|INBOX`] = c.low; }
    }
    loadFolderCache();
    rebuildContacts();
  } catch (e) { showError(e.message); }
  api.on('settings-changed', async () => {
    // nur die im Hauptprozess gewählten Programmpfade übernehmen – offene Eingaben (z. B. Kontakt) bleiben erhalten
    const st = await api.call('settings:get');
    S.settings.appPaths = st.appPaths || {};
  });
  api.on('sync-applied', async (info) => {
    await reloadFromDisk();
    // 3.2.31: Google-Zugangsschlüssel können vom anderen PC gekommen sein
    try { S.google = await api.call('google:status'); } catch { /* ohne Google weiter */ }
    renderGoogleBanner();
    recategorizeAll();
    renderAll(); updateBadge();
    if (info && info.accountsChanged) { loadFolders(); refresh(); }
    if (info && info.pending && info.pending.length) askPendingServerChanges(info.pending);
  });
  if (S.syncStatus && S.syncStatus.pending && S.syncStatus.pending.length) askPendingServerChanges(S.syncStatus.pending);
  api.on('mail-changed', () => refresh());
  api.on('folders-changed', () => loadFolders());
  api.on('spam-filtered', (id, n) => toast(n === 1 ? '1 E-Mail als Spam aussortiert' : `${n} E-Mails als Spam aussortiert`));
  api.on('app-error', (msg) => showError(msg));
  api.on('push-status', (id, on) => { S.push[id] = on; renderSidebar(); });
  api.on('outbox-changed', (list) => { S.outbox = list; renderSidebar(); if (S.view.type === 'scheduled') renderList(); });
  renderAll();
  if (!S.accounts.length) openSettings({ welcome: true });
  else {
    refresh().then(() => runSync()).then(retryStartupRefresh);
    loadFolders(); // parallel zum Posteingang, nicht erst danach
  }
  initSplitters();
  // 3.2.37: SimpleMail wurde über einen mailto-Link gestartet (Standard-Mailprogramm)
  api.call('app:takePendingMailto').then((u) => { if (u) composeMailto(u); }).catch(() => {});
  try { S.google = await api.call('google:status'); } catch { /* ohne Google weiter */ }
  renderCalendar();
  renderGoogleBanner();
  loadEvents();
  // 3.2.34: Ablauf der Google-Anmeldung im Blick behalten (Hinweis ab Tag 6, Prüfung des Zugangs alle 30 Min.)
  setInterval(renderGoogleBanner, 60 * 1000);
  setInterval(() => { if (S.google.connected && !S.google.expired) refreshGoogleStatus(true).then(() => { if (S.google.expired) loadEvents(true); }); }, 30 * 60 * 1000);
  setTimeout(() => { if (S.google.connected && !S.google.expired) refreshGoogleStatus(true).then(() => { if (S.google.expired) { renderCalendar(); } }); }, 20 * 1000);
  setInterval(refresh, 5 * 60 * 1000);
  // Einstellungen regelmäßig und beim Zurückkehren ins Fenster abgleichen
  setInterval(() => runSync(), 5 * 60 * 1000);
  let lastFocusSync = Date.now();
  window.addEventListener('focus', () => {
    renderGoogleBanner();
    if (Date.now() - lastFocusSync > 60 * 1000) { lastFocusSync = Date.now(); runSync(); }
  });
  // Netz wieder da (WLAN) → gleich abrufen und Liegengebliebenes nachholen
  window.addEventListener('online', () => refresh());
  setInterval(() => loadEvents(), 10 * 60 * 1000);
  setInterval(tick, 30 * 1000);
}

/** Start ohne Netz (WLAN noch nicht da): bald erneut versuchen statt 5 Minuten auf den nächsten Abruf zu warten */
async function retryStartupRefresh() {
  for (const sec of [5, 15, 30, 60]) {
    if (!S.offline) return;
    await new Promise((res) => setTimeout(res, sec * 1000));
    await refresh();
  }
}

async function refresh() {
  if (!S.accounts.length) return;
  if (S.loading) { S.pending = true; return; }
  S.loading = true;
  S.offline = false;
  renderStatus();
  // 0. Ohne Verbindung liegengebliebene Aktionen zuerst nachholen (sonst käme z. B. Gelöschtes zurück)
  await flushPendingOps();

  // 1. Gewählter Ordner
  await refreshFolder();
  // 1b. Gemeinsame Ordner „Spam“, „Gesendet“, „Papierkorb“: die Ordner dieser Rolle aller Konten zusammen
  if (isRoleView(S.view)) await refreshRoleView();

  // 2. Posteingänge aller Konten – gleichzeitig abrufen. 3.2.26: jedes Konto wird übernommen und angezeigt,
  // sobald es fertig ist (vorher in fester Reihenfolge – ein langsames Konto hielt Smart Inbox und Kontoansicht auf)
  let open = S.accounts.length;
  await Promise.all(S.accounts.map(async (a) => {
    const known = (S.inbox[a.id] || []).reduce((mx, m) => Math.max(mx, m.uid), 0);
    const first = !S.inbox[a.id];
    try {
      const r = await api.call('mail:fetch', a.id, 'INBOX', S.low[`${a.id}|INBOX`]);
      r.messages = withLocalState(personalize(r.messages));
      S.inbox[a.id] = r.messages;
      S.low[`${a.id}|INBOX`] = r.low;
      if (!first) {
        const fresh = r.messages.filter((m) => m.uid > known && !m.isRead && m.category === 'personal' && !isSnoozed(m));
        for (const m of fresh.slice(0, 3)) api.call('app:notify', sender(m), m.subject || '(Kein Betreff)');
        if (fresh.length > 3) api.call('app:notify', 'SimpleMail', `${fresh.length - 3} weitere neue E-Mails`);
      }
    } catch (e) { reportError(a.id, e); }
    if (--open > 0) { renderList(); renderSidebar(); }
  }));
  rebuildContacts();
  S.loading = false;
  // Wieder verbunden: alte Verbindungsfehler-Meldung entfernen
  if (!S.offline && S.error && OFFLINE_RE.test(S.error)) S.error = null;
  renderAll();
  updateBadge();

  if (S.pending) { S.pending = false; refresh(); return; }
  // Ordnerliste und -zähler höchstens alle 3 Minuten (vorher nach jedem Abruf und jedem Push)
  if (!S.lastFolderLoad || Date.now() - S.lastFolderLoad > 3 * 60 * 1000 ||
      S.accounts.some((a) => !S.folders[a.id])) await loadFolders();
  prefetchBodies();
}

/** Nur den gewählten Ordner abgleichen – wartet nicht auf einen laufenden Gesamtabruf */
async function refreshFolder() {
  if (S.view.type !== 'folder') return;
  const view = S.view;
  const { acc, path } = view;
  try {
    const r = await api.call('mail:fetch', acc, path, S.low[`${acc}|${path}`]);
    if (S.view === view) {
      S.folderMsgs = withLocalState(path === 'INBOX' ? personalize(r.messages) : r.messages);
      S.low[`${acc}|${path}`] = r.low;
      // 3.2.26: Posteingang eines Kontos = dieselben Mails wie in Smart Inbox/Kontoansicht
      // (Regeln/Spamfilter laufen schon im Hauptprozess – gilt für beide Wege gleich)
      if (path === 'INBOX') S.inbox[acc] = S.folderMsgs.map((m) => ({ ...m }));
      if (S.selected && S.selected.startsWith(`${acc}|${path}|`) && !S.folderMsgs.some((m) => keyOf(m) === S.selected)) S.selected = null;
      if (!S.loading) { renderList(); renderSidebar(); }
    }
  } catch (e) { reportError(acc, e); renderStatus(); }
}

// Ordnerbaum je Konto wird gespeichert, damit die Seitenleiste beim Start sofort vollständig dasteht
const FOLDER_CACHE_KEY = 'simplemail.folderCache';
function loadFolderCache() {
  try {
    const saved = JSON.parse(localStorage.getItem(FOLDER_CACHE_KEY) || '{}');
    for (const a of S.accounts) if (Array.isArray(saved[a.id])) S.folders[a.id] = saved[a.id];
  } catch { /* ohne Zwischenspeicher weiter */ }
}
function saveFolderCache() {
  try {
    const out = {};
    for (const a of S.accounts) if (S.folders[a.id]) out[a.id] = S.folders[a.id];
    localStorage.setItem(FOLDER_CACHE_KEY, JSON.stringify(out));
  } catch { /* egal */ }
}

async function loadFolders() {
  S.lastFolderLoad = Date.now();
  await Promise.all(S.accounts.map(async (a) => {
    try {
      // erst nur die Liste (schnell, bisherige Zähler bleiben stehen), dann die Zähler aller Ordner
      const old = new Map((S.folders[a.id] || []).map((f) => [f.path, f.unread || 0]));
      const list = await api.call('mail:folders', a.id, false);
      S.folders[a.id] = list.map((f) => ({ ...f, unread: old.get(f.path) || 0 }));
      renderSidebar();
      S.folders[a.id] = await api.call('mail:folders', a.id, true);
      renderSidebar();
    } catch (e) { reportError(a.id, e); }
  }));
  saveFolderCache();
  renderSidebar();
}

// 3.2.25: auch abgerissene Verbindungen (WLAN weg, Ruhezustand) zählen als „offline“ statt als Fehlermeldung
const OFFLINE_RE = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|ECONNRESET|ECONNABORTED|EPIPE|getaddrinfo|Connection not available|Connection closed|Unexpected close|socket hang up|Socket timeout|nicht verbunden/i;

function reportError(accId, e) {
  if (OFFLINE_RE.test(e.message)) { S.offline = true; return; }
  const a = findAccount(accId);
  S.error = S.accounts.length > 1 && a ? `${a.email}: ${e.message}` : e.message;
}

/** Lädt die neuesten Nachrichten im Hintergrund in die Offline-Ablage */
async function prefetchBodies() {
  const off = S.settings.offline;
  if (!off.enabled || S.offline) return;
  for (const a of S.accounts) {
    const uids = [...(S.inbox[a.id] || [])]
      .sort((x, y) => new Date(y.date) - new Date(x.date))
      .slice(0, off.keep)
      .filter((m) => !m.size || m.size < 8 * 1024 * 1024)
      .map((m) => m.uid);
    try {
      const fresh = await api.call('cache:prefetch', a.id, 'INBOX', uids);
      let changed = false;
      for (const m of S.inbox[a.id] || []) {
        if (fresh[m.uid] !== undefined) { m.preview = fresh[m.uid]; changed = true; }
      }
      if (changed && S.settings.listLines === 3) renderList();
    } catch { /* später */ }
  }
}

/** Ordner einer Rolle (junk/sent/trash) eines Kontos (wie im Hauptprozess: zuerst oberste Ebene) */
function roleFolderOf(accId, role) {
  const list = (S.folders[accId] || []).filter((f) => f.role === role && f.selectable);
  // 3.2.45: vom Server markierter Ordner zuerst (wie bestRoleFolder im Hauptprozess)
  return ((list.find((f) => f.specialUse && f.depth === 0) || list.find((f) => f.specialUse)
    || list.find((f) => f.depth === 0) || list[0]) || {}).path || null;
}
const junkFolderOf = (accId) => roleFolderOf(accId, 'junk');

// 3.2.36: gemeinsame Ordner über alle Konten – Ansicht → Ordnerrolle
const ROLE_VIEWS = { spam: 'junk', sent: 'sent', trash: 'trash', drafts: 'drafts' };   // 3.2.44: Entwürfe
const isRoleView = (v) => !!(v && ROLE_VIEWS[v.type]);
/** Ordner der gemeinsamen Ansicht: [{ acc, path }] für alle (bzw. das gefilterte) Konten */
function roleTargets(type) {
  const f = accountFilter();
  return S.accounts.filter((a) => !f || a.id === f)
    .map((a) => ({ acc: a.id, path: roleFolderOf(a.id, ROLE_VIEWS[type]) })).filter((t) => t.path);
}

/** Gemeinsamen Ordner abgleichen: alle Konten gleichzeitig, jedes Konto erscheint, sobald es fertig ist */
async function refreshRoleView() {
  const view = S.view;
  const got = new Map();
  await Promise.all(roleTargets(view.type).map(async (t) => {
    try {
      const r = await api.call('mail:fetch', t.acc, t.path, S.low[`${t.acc}|${t.path}`]);
      S.low[`${t.acc}|${t.path}`] = r.low;
      got.set(`${t.acc}|${t.path}`, r.messages);
    } catch (e) { reportError(t.acc, e); return; }
    if (S.view !== view) return;
    // vorhandene Mails der anderen Konten (z. B. aus dem Zwischenspeicher) stehen lassen, bis sie selbst fertig sind
    const others = S.folderMsgs.filter((m) => !got.has(`${m.accountId}|${m.folder}`));
    S.folderMsgs = withLocalState(others.concat(...got.values()));
    if (S.selected && !findMessage(S.selected)) S.selected = null;
    if (!S.loading) { renderList(); renderSidebar(); }
  }));
}

/** Beim Öffnen: gespeicherte Kopfzeilen aller Konten sofort zeigen, dann abgleichen */
async function openRoleView(view) {
  if (S.accounts.some((a) => !S.folders[a.id])) await loadFolders();
  if (S.view !== view) return;
  const cached = await Promise.all(roleTargets(view.type).map((t) =>
    api.call('cache:headers', t.acc, t.path).then((c) => (c && c.messages) || []).catch(() => [])));
  if (S.view === view && !S.folderMsgs.length) { S.folderMsgs = withLocalState([].concat(...cached)); renderList(); }
  if (S.view === view) { await refreshRoleView(); if (!S.loading) renderAll(); }
}

const canLoadMore = () => {
  if (S.searchResults || S.search) return false;
  if (isRoleView(S.view)) return roleTargets(S.view.type).some((t) => (S.low[`${t.acc}|${t.path}`] || 1) > 1);
  if (S.view.type === 'folder') return (S.low[`${S.view.acc}|${S.view.path}`] || 1) > 1;
  if (S.view.type === 'snoozed' || S.view.type === 'scheduled') return false;
  return S.accounts.some((a) => (S.low[`${a.id}|INBOX`] || 1) > 1);
};

function loadMore() {
  if (isRoleView(S.view)) {
    for (const t of roleTargets(S.view.type)) {
      const k = `${t.acc}|${t.path}`;
      if (S.low[k]) S.low[k] = Math.max(1, S.low[k] - 200);
    }
  } else if (S.view.type === 'folder') {
    const k = `${S.view.acc}|${S.view.path}`;
    S.low[k] = Math.max(1, (S.low[k] || 1) - 200);
  } else {
    for (const a of S.accounts) {
      const k = `${a.id}|INBOX`;
      if (S.low[k]) S.low[k] = Math.max(1, S.low[k] - 200);
    }
  }
  refresh();
}

let searchGen = 0;
async function serverSearch() {
  const q = S.search.trim();
  if (!q) return;
  const gen = ++searchGen;
  S.searching = true;
  renderStatus();
  // Ordneransicht: nur dieser Ordner; sonst alle Ordner aller Konten (inkl. Gesendet),
  // ohne Papierkorb und Spam. Posteingang zuerst, damit die wichtigsten Treffer sofort da sind.
  const ROLE_ORDER = { inbox: 0, drafts: 1, sent: 2, archive: 3 };
  const targets = [];
  if (S.view.type === 'folder') targets.push([S.view.acc, S.view.path]);
  else {
    for (const a of S.accounts) {
      const list = (S.folders[a.id] || []).filter((f) => f.selectable && f.role !== 'junk' && f.role !== 'trash')
        .sort((x, y) => (ROLE_ORDER[x.role] ?? 9) - (ROLE_ORDER[y.role] ?? 9));
      const allMail = list.find((f) => f.allMail);
      if (!list.length) targets.push([a.id, 'INBOX']);
      else if (allMail) {
        // Gmail: „Alle Nachrichten“ enthält jede Mail (außer Papierkorb/Spam) – Labels einzeln
        // zu durchsuchen dauerte lange und lieferte nur Dubletten
        targets.push([a.id, 'INBOX'], [a.id, allMail.path]);
      } else for (const f of list) if (!f.virtual) targets.push([a.id, f.path]);
    }
  }
  const results = [];
  const seen = new Set();
  S.searchResults = [];
  S.selected = null;
  renderAll();
  // Konten parallel, Ordner je Konto nacheinander (eine IMAP-Verbindung je Konto)
  const accs = [...new Set(targets.map((t) => t[0]))];
  await Promise.all(accs.map(async (acc) => {
    for (const [a, path] of targets) {
      if (a !== acc) continue;
      if (gen !== searchGen || S.search.trim() !== q) return;
      try {
        for (const m of await api.call('mail:search', acc, path, q)) {
          // Gmail: „Alle Nachrichten“ enthält auch Posteingang/Gesendet → Dubletten entfernen
          const k = `${m.accountId}|${m.messageId || keyOf(m)}`;
          if (seen.has(k)) continue;
          seen.add(k);
          results.push(m);
        }
      } catch (e) { reportError(acc, e); }
      // Zwischenstand sofort anzeigen
      if (gen === searchGen && S.search.trim() === q) {
        S.searchResults = results.slice().sort((x, y) => new Date(y.date) - new Date(x.date));
        renderList();
      }
    }
  }));
  if (gen !== searchGen) return;
  S.searching = false;
  renderAll();
}

/** Ordnername eines Suchtreffers außerhalb des Posteingangs */
function folderLabelOf(m) {
  if (!m.folder || m.folder === 'INBOX') return '';
  const f = (S.folders[m.accountId] || []).find((x) => x.path === m.folder);
  return f ? f.name : m.folder;
}

async function loadBody(m) {
  const k = keyOf(m);
  // Sofort als gelesen anzeigen – Zähler warten nicht mehr, bis der Text geladen ist
  const wasUnread = !m.isRead;
  // Sofort auch auf dem Server speichern (vorher erst nach dem Laden des Textes – bei langsamen
  // Konten oder einem Ladefehler blieb die Mail auf dem Server ungelesen)
  if (wasUnread) setRead(m, true);
  if (!S.bodies[k]) {
    try {
      S.bodies[k] = await api.call('mail:body', m.accountId, m.folder, m.uid);
      updateLocal(k, (x) => { x.preview = S.bodies[k].preview; });
    } catch (e) {
      if (OFFLINE_RE.test(e.message)) { S.offline = true; renderStatus(); } else showError(e.message);
      return;
    }
    if (S.selected === k) renderDetail(true);
  }
}

// =================================================================== Aktionen

function updateLocal(key, fn) {
  const m1 = findMessage(key);
  for (const list of [S.inbox[key.split('|')[0]] || [], S.folderMsgs, S.searchResults || []]) {
    const m = list.find((x) => keyOf(x) === key);
    if (m) fn(m);
  }
  return m1;
}

// Lokal gelöschte/verschobene Mails: Ein Abruf, der vor dem Löschen auf dem Server begann,
// liefert sie noch mit – ohne Filter tauchten sie kurz wieder auf (Liste „springt“)
const recentlyRemoved = new Map();
function withoutRemoved(list) {
  const queued = pendingOps.length ? pendingRemoved() : null;
  if (!recentlyRemoved.size && !(queued && queued.size)) return list;
  return list.filter((m) => !recentlyRemoved.has(keyOf(m)) && !(queued && queued.has(keyOf(m))));
}

// Lokal geänderte Flags (gelesen/markiert): Ein Abruf, der vor dem Speichern auf dem Server begann,
// lieferte noch den alten Stand – die Mail sprang zurück auf „ungelesen“ (v. a. bei langsamen Gmail-Abrufen)
const pendingFlags = new Map();
function notePending(m, change) {
  const k = keyOf(m);
  pendingFlags.set(k, { ...(pendingFlags.get(k) || {}), ...change, at: Date.now() });
}
/** Abgerufene Liste mit dem lokalen Stand abgleichen: Gelöschtes ausblenden, gerade geänderte Flags (2 Min.) behalten */
function withLocalState(list) {
  const out = withoutRemoved(list);
  if (!pendingFlags.size) return out;
  const t = Date.now();
  for (const [k, p] of pendingFlags) if (t - p.at > 120 * 1000) pendingFlags.delete(k);
  for (const m of out) {
    const p = pendingFlags.get(keyOf(m));
    if (!p) continue;
    if (p.read !== undefined) m.isRead = p.read;
    if (p.flagged !== undefined) m.isFlagged = p.flagged;
  }
  return out;
}

/** Gmail und Googlemail sind dieselbe Adresse */
const normAddr = (a) => {
  const x = String(a || '').trim().toLowerCase();
  return x.endsWith('@googlemail.com') ? `${x.slice(0, -'googlemail.com'.length)}gmail.com` : x;
};
/** Absender aus dem Adressbuch und eigene Konten landen immer in „Persönlich“ */
function personalize(list) {
  const set = new Set(S.accounts.map((a) => normAddr(a.email)));
  for (const c of liveContacts()) for (const e of c.emails || []) { const v = normAddr(e); if (v.includes('@')) set.add(v); }
  for (const m of list) if (m.category !== 'personal' && set.has(normAddr(m.fromAddress))) m.category = 'personal';
  // 3.2.29: selbst gewählte Kategorie je Absender (Mail auf Kategorie gezogen) hat Vorrang
  const cats = S.settings.senderCats || {};
  for (const m of list) {
    const c = cats[normAddr(m.fromAddress)];
    if (c && !c.deleted && CATEGORIES.some((x) => x.id === c.category)) m.category = c.category;
  }
  return list;
}
/** Kategorien in allen geladenen Posteingängen neu anwenden (nach Ziehen oder Sync) */
function recategorizeAll() {
  for (const id of Object.keys(S.inbox)) personalize(S.inbox[id]);
  if (S.view.type === 'folder' && S.view.path === 'INBOX') personalize(S.folderMsgs);
}
/** Absender immer in dieser Kategorie einsortieren (synchronisiert) */
function setSenderCategory(msgs, cat) {
  const c = CATEGORIES.find((x) => x.id === cat);
  if (!c) return;
  S.settings.senderCats = S.settings.senderCats || {};
  const addrs = [...new Set(msgs.map((m) => normAddr(m.fromAddress)).filter((a) => a.includes('@')))];
  for (const a of addrs) S.settings.senderCats[a] = { category: cat, updatedAt: now(), deleted: false };
  saveSettings();
  // Mails aus anderen Ordnern zurück in den Posteingang, damit sie in der Kategorie erscheinen
  for (const m of msgs) if (m.folder && m.folder !== 'INBOX') moveTo(m, 'INBOX', m.accountId);
  recategorizeAll();
  renderAll();
  toast(addrs.length === 1 ? `${addrs[0]} landet jetzt immer in „${c.title}“` : `${addrs.length} Absender landen jetzt immer in „${c.title}“`);
}

// 3.2.28: Smart Inbox wie Spark – Benachrichtigungen und Newsletter oben als einklappbare Zeile mit Anzahl,
// darunter die persönlichen Mails. Aufgeklappt-Zustand nur auf diesem Gerät.
const COLLAPSIBLE = ['notification', 'newsletter'];
const GROUPS_KEY = 'simplemail.expandedGroups';
function loadExpanded() {
  try { return new Set(JSON.parse(localStorage.getItem(GROUPS_KEY) || '[]')); } catch { return new Set(); }
}
S.expandedGroups = loadExpanded();
function toggleGroup(cat) {
  if (S.expandedGroups.has(cat)) S.expandedGroups.delete(cat); else S.expandedGroups.add(cat);
  try { localStorage.setItem(GROUPS_KEY, JSON.stringify([...S.expandedGroups])); } catch { /* egal */ }
  renderList();
}
/** Reihenfolge der Kategorien in der Smart Inbox: einklappbare zuerst, dann Persönlich */
const SMART_ORDER = [...COLLAPSIBLE, 'personal'];

/** Mails in der Reihenfolge der Anzeige (Smart Inbox: Kategorie für Kategorie, eingeklappte ausgelassen) */
function displayedMessages() {
  const vis = visibleMessages();
  if (S.searchResults || S.view.type !== 'smart' || S.search) return vis;
  return SMART_ORDER.filter((c) => c === 'personal' || S.expandedGroups.has(c))
    .flatMap((c) => vis.filter((m) => m.category === c));
}

function selectNext(m) {
  const k = keyOf(m);
  if (S.selected !== k) return;
  const vis = displayedMessages();
  const i = vis.findIndex((x) => keyOf(x) === k);
  const next = vis[i + 1] || vis[i - 1];
  S.selected = next ? keyOf(next) : null;
}

function removeLocal(m) {
  selectNext(m);
  const k = keyOf(m);
  const cur = findMessage(k);
  if (cur && !cur.isRead) adjustFolderUnread(m, -1);
  const t = Date.now();
  for (const [key, at] of recentlyRemoved) if (t - at > 10 * 60 * 1000) recentlyRemoved.delete(key);
  recentlyRemoved.set(k, t);
  const acc = m.accountId;
  if (S.inbox[acc]) S.inbox[acc] = S.inbox[acc].filter((x) => keyOf(x) !== k);
  S.folderMsgs = S.folderMsgs.filter((x) => keyOf(x) !== k);
  if (S.searchResults) S.searchResults = S.searchResults.filter((x) => keyOf(x) !== k);
  delete S.bodies[k];
  let changed = false;
  for (const e of S.settings.snoozes) {
    if (!e.deleted && snoozeMatches(e, m)) { e.deleted = true; e.updatedAt = now(); changed = true; }
  }
  if (changed) saveSettings();
}

// 3.2.25: Aktionen ohne Verbindung (Löschen, Verschieben, Gelesen …) gingen verloren – die Mail tauchte
// nach 10 Minuten wieder auf. Jetzt in einer Warteschlange (auch über Neustart), nachgeholt beim nächsten Abruf.
const PENDING_OPS_KEY = 'simplemail.pendingOps';
const REMOVING_OPS = ['mail:delete', 'mail:archive', 'mail:move', 'mail:moveAcross', 'mail:spam'];
let pendingOps = (() => { try { const v = JSON.parse(localStorage.getItem(PENDING_OPS_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } })();
let flushingOps = false;
function savePendingOps() { try { localStorage.setItem(PENDING_OPS_KEY, JSON.stringify(pendingOps)); } catch { /* egal */ } }
/** Mails mit noch nicht ausgeführtem Löschen/Verschieben bleiben ausgeblendet */
const pendingRemoved = () => new Set(pendingOps.filter((o) => REMOVING_OPS.includes(o.channel)).map((o) => o.key));

async function serverOp(m, channel, ...args) {
  try {
    await api.call(channel, m.accountId, m.folder, m.uid, ...args);
  } catch (e) {
    if (OFFLINE_RE.test(e.message)) {
      pendingOps.push({ acc: m.accountId, folder: m.folder, uid: m.uid, key: keyOf(m), channel, args, at: Date.now() });
      savePendingOps();
      S.offline = true; renderStatus(); return;
    }
    showError(e.message);
    refresh();
  }
}

/** Warteschlange abarbeiten; hört beim ersten Verbindungsfehler auf (dann ist man weiter offline) */
async function flushPendingOps() {
  if (!pendingOps.length || flushingOps) return;
  flushingOps = true;
  const batch = pendingOps; pendingOps = [];
  const left = [];
  let online = true;
  for (const op of batch) {
    if (!findAccount(op.acc) || Date.now() - op.at > 7 * 86400e3) continue;   // Konto weg oder zu alt → verwerfen
    if (!online) { left.push(op); continue; }
    try { await api.call(op.channel, op.acc, op.folder, op.uid, ...(op.args || [])); }
    catch (e) { if (OFFLINE_RE.test(e.message)) { online = false; left.push(op); } /* sonst (Mail gibt es nicht mehr …) verwerfen */ }
  }
  pendingOps = left.concat(pendingOps);
  savePendingOps();
  flushingOps = false;
}

/** Gelesen-Status lokal setzen und den Ordnerzähler gleich mitführen (Serverzähler kommen nur alle paar Minuten) */
function markReadLocally(m, read) {
  notePending(m, { read });
  const cur = findMessage(keyOf(m));
  if (cur && cur.isRead !== read) adjustFolderUnread(m, read ? -1 : 1);
  updateLocal(keyOf(m), (x) => { x.isRead = read; });
}

function adjustFolderUnread(m, delta) {
  const f = (S.folders[m.accountId] || []).find((x) => x.path === m.folder);
  if (f) f.unread = Math.max(0, (f.unread || 0) + delta);
}

async function setRead(m, read) {
  markReadLocally(m, read);
  renderList(); renderSidebar(); updateBadge();
  await serverOp(m, 'mail:flag', '\\Seen', read);
}

async function toggleFlag(m) {
  const on = !m.isFlagged;
  notePending(m, { flagged: on });
  updateLocal(keyOf(m), (x) => { x.isFlagged = on; });
  renderList(); renderDetail();
  await serverOp(m, 'mail:flag', '\\Flagged', on);
}

async function archive(m) {
  const role = ((S.folders[m.accountId] || []).find((f) => f.path === m.folder) || {}).role;
  if (role === 'archive') { showError('Die E-Mail liegt bereits im Archiv.'); return; }
  removeLocal(m);
  renderAll(); updateBadge();
  await serverOp(m, 'mail:archive');
}

// ---- Mehrfachauswahl (Strg+Klick, Umschalt+Klick, Strg+A)
const multiActive = () => S.multi.size > 1;
const selectedMessages = () => [...S.multi].map(findMessage).filter(Boolean);

function handleRowClick(key, e) {
  if (e.ctrlKey || e.metaKey) {
    if (!S.multi.size && S.selected) S.multi.add(S.selected);
    if (S.multi.has(key)) S.multi.delete(key); else S.multi.add(key);
    S.selected = key;
    if (S.multi.size <= 1) {
      const only = [...S.multi][0];
      S.multi.clear();
      if (only) { selectMessage(only); return; }
      S.selected = null;
    }
    renderList(); renderDetail();
    return;
  }
  if (e.shiftKey && S.selected) {
    const vis = visibleMessages();
    const a = vis.findIndex((x) => keyOf(x) === S.selected);
    const b = vis.findIndex((x) => keyOf(x) === key);
    if (a >= 0 && b >= 0 && a !== b) {
      S.multi = new Set(vis.slice(Math.min(a, b), Math.max(a, b) + 1).map(keyOf));
      renderList(); renderDetail();
      return;
    }
  }
  S.multi.clear();
  selectMessage(key);
}

function selectAll() {
  const vis = visibleMessages();
  if (vis.length < 2) return;
  S.multi = new Set(vis.map(keyOf));
  renderList(); renderDetail();
}

function clearMulti() {
  if (!S.multi.size) return;
  S.multi.clear();
  renderList(); renderDetail();
}

/** Aktion auf alle ausgewählten Mails */
async function bulk(kind, arg) {
  let list = selectedMessages();
  if (!list.length) return;
  if (kind === 'move' && list.some((m) => m.accountId !== list[0].accountId)) {
    showError('Die Auswahl enthält Mails mehrerer Konten – bitte unter „Verschieben nach …“ ein Zielkonto wählen.');
    return;
  }
  if (kind === 'archive') list = list.filter((m) => folderRole(m) !== 'archive');
  if (kind === 'delete' && list.length >= 10) {
    const ok = await confirmDialog({ title: `${list.length} E-Mails löschen?`, text: 'Die E-Mails werden in den Papierkorb verschoben.', ok: 'Löschen', cancel: 'Abbrechen' });
    if (!ok) return;
  }
  const removes = ['delete', 'archive', 'move', 'moveAcc', 'spam'].includes(kind);
  S.multi.clear();
  if (removes) {
    S.selected = null;
    for (const m of list) removeLocal(m);
  } else {
    for (const m of list) {
      updateLocal(keyOf(m), (x) => { if (kind === 'read') x.isRead = arg; else x.isFlagged = arg; });
    }
  }
  renderAll(); updateBadge();
  const n = list.length;
  const what = { delete: 'gelöscht', archive: 'archiviert', move: 'verschoben', moveAcc: 'verschoben', spam: 'als Spam markiert',
    read: arg ? 'als gelesen markiert' : 'als ungelesen markiert', flag: arg ? 'markiert' : 'Markierung entfernt' }[kind];
  toast(`${n} E-Mail${n === 1 ? '' : 's'} ${what}`);
  for (const m of list) {
    if (kind === 'delete') await serverOp(m, 'mail:delete');
    else if (kind === 'archive') await serverOp(m, 'mail:archive');
    else if (kind === 'move') await serverOp(m, 'mail:move', arg);
    else if (kind === 'moveAcc') {
      if (m.accountId === arg.acc) await serverOp(m, 'mail:move', arg.path);
      else await serverOp(m, 'mail:moveAcross', arg.acc, arg.path, msgFlags(m));
    }
    else if (kind === 'spam') await serverOp(m, 'mail:spam', true);
    else if (kind === 'read') await serverOp(m, 'mail:flag', '\\Seen', arg);
    else if (kind === 'flag') await serverOp(m, 'mail:flag', '\\Flagged', arg);
  }
  if (kind === 'moveAcc') refresh();
}

function bulkMoveItems(x = 400, y = 200) {
  const list = selectedMessages();
  if (!list.length) return [];
  const acc = list[0].accountId;
  const single = !list.some((m) => m.accountId !== acc);
  const items = single ? folderItems(acc, (path) => bulk('move', path)) : [];
  const others = otherAccountItems(single ? acc : null, x, y, (a, path) => bulk('moveAcc', { acc: a, path }));
  if (items.length && others.length) items.push('-');
  return items.concat(others);
}

function bulkMenuItems(x, y) {
  const list = selectedMessages();
  const anyUnread = list.some((m) => !m.isRead);
  const anyUnflagged = list.some((m) => !m.isFlagged);
  return [
    { label: anyUnread ? 'Als gelesen markieren' : 'Als ungelesen markieren', action: () => bulk('read', anyUnread) },
    { label: anyUnflagged ? 'Markieren' : 'Markierung entfernen', action: () => bulk('flag', anyUnflagged) },
    '-',
    { label: 'Verschieben nach …', action: () => showMenu(x, y, bulkMoveItems(x, y)) },
    { label: 'Archivieren', hint: 'E', action: () => bulk('archive') },
    { label: 'Als Spam markieren', action: () => bulk('spam') },
    '-',
    { label: `${list.length} E-Mails löschen`, hint: 'Entf', danger: true, action: () => bulk('delete') },
  ];
}

function bulkPanel() {
  const list = selectedMessages();
  const anyUnread = list.some((m) => !m.isRead);
  const anyUnflagged = list.some((m) => !m.isFlagged);
  return `<div class="bulk-panel">
    <div class="bulk-count">${list.length}</div>
    <h2>E-Mails ausgewählt</h2>
    <div class="bulk-actions">
      <button class="btn danger" data-act="bulk" data-kind="delete">${icon('trash')} Löschen</button>
      <button class="btn" data-act="bulk" data-kind="archive">${icon('archive')} Archivieren</button>
      <button class="btn" data-act="bulk-move">${icon('folder')} Verschieben …</button>
      <button class="btn" data-act="bulk" data-kind="read" data-arg="${anyUnread ? '1' : ''}">${icon('read')} ${anyUnread ? 'Als gelesen' : 'Als ungelesen'}</button>
      <button class="btn" data-act="bulk" data-kind="flag" data-arg="${anyUnflagged ? '1' : ''}">${icon('flag')} ${anyUnflagged ? 'Markieren' : 'Markierung entfernen'}</button>
      <button class="btn" data-act="bulk" data-kind="spam">${icon('junk')} Spam</button>
    </div>
    <button class="link-btn" data-act="bulk-clear">Auswahl aufheben (Esc)</button>
    <div class="hint-text">Strg+Klick: einzelne hinzufügen · Umschalt+Klick: Bereich · Strg+A: alle</div>
  </div>`;
}

// ---- Verschieben in Ordner
const msgFlags = (m) => [...(m.isRead ? ['\\Seen'] : []), ...(m.isFlagged ? ['\\Flagged'] : [])];

async function moveTo(m, target, accountId = m.accountId) {
  if (!target || (target === m.folder && accountId === m.accountId)) return;
  const f = (S.folders[accountId] || []).find((x) => x.path === target);
  const other = accountId !== m.accountId;
  removeLocal(m);
  renderAll(); updateBadge();
  if (!other) {
    toast(`Verschoben nach „${f ? f.name : target}“`);
    await serverOp(m, 'mail:move', target);
    return;
  }
  const acc = findAccount(accountId);
  toast(`Wird nach „${f ? f.name : target}“ (${acc ? acc.email : 'anderes Konto'}) verschoben …`);
  await serverOp(m, 'mail:moveAcross', accountId, target, msgFlags(m));
  refresh();
}

/** Ordner eines Kontos als Menüeinträge */
function folderItems(accountId, action, exclude) {
  return (S.folders[accountId] || [])
    .filter((f) => f.selectable && f.path !== exclude)
    .map((f) => ({ label: `${'\u00a0\u00a0\u00a0'.repeat(f.depth || 0)}${f.name}`, action: () => action(f.path) }));
}

/** Einträge „In Konto: …“ für alle übrigen Konten */
function otherAccountItems(exceptId, x, y, action) {
  return S.accounts.filter((a) => a.id !== exceptId).map((a) => ({
    label: `In Konto: ${a.email} …`,
    action: () => {
      const items = folderItems(a.id, (path) => action(a.id, path));
      if (!items.length) { showError('Ordnerliste wird noch geladen – bitte gleich noch einmal.'); loadFolders(); return; }
      showMenu(x, y, items);
    },
  }));
}

function moveMenuItems(m, x = 300, y = 200) {
  const items = folderItems(m.accountId, (path) => moveTo(m, path), m.folder);
  const others = otherAccountItems(m.accountId, x, y, (acc, path) => moveTo(m, path, acc));
  if (items.length && others.length) items.push('-');
  return items.concat(others);
}

function showMoveMenu(m, x, y) {
  const items = moveMenuItems(m, x, y);
  if (!items.length) { showError('Ordnerliste wird noch geladen – bitte gleich noch einmal.'); loadFolders(); return; }
  showMenu(x, y, items);
}

// Ziehen & Ablegen: Mail aus der Liste auf einen Ordner links ziehen
let dragKey = null;
document.addEventListener('dragstart', (e) => {
  const row = e.target.closest && e.target.closest('.row[data-key]');
  if (!row) return;
  dragKey = row.dataset.key;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('application/x-simplemail', dragKey);
  if (multiActive() && S.multi.has(dragKey)) document.querySelectorAll('.row.selected').forEach((r) => r.classList.add('dragging'));
  else row.classList.add('dragging');
});
document.addEventListener('dragend', () => {
  dragKey = null;
  document.querySelectorAll('.row.dragging, .side-item.drop-ok').forEach((x) => x.classList.remove('dragging', 'drop-ok'));
});
const dropTarget = (e) => {
  if (!dragKey) return null;
  const item = e.target.closest && e.target.closest('.side-item[data-drop-path], .side-item[data-drop-spam], .side-item[data-drop-cat], .side-item[data-drop-role]');
  if (!item) return null;
  const m = findMessage(dragKey);
  if (!m) return null;
  if (item.dataset.dropCat) {
    const msgs = multiActive() && S.multi.has(dragKey) ? selectedMessages() : [m];
    if (msgs.every((x) => x.folder === 'INBOX' && x.category === item.dataset.dropCat)) return null;
    return { item, m, msgs, cat: item.dataset.dropCat };
  }
  if (item.dataset.dropRole) {
    // 3.2.36: auf gemeinsamen „Gesendet“/„Papierkorb“ ziehen → in den Ordner dieser Rolle des jeweiligen Kontos
    const role = item.dataset.dropRole;
    const msgs = (multiActive() && S.multi.has(dragKey) ? selectedMessages() : [m])
      .filter((x) => folderRole(x) !== role && roleFolderOf(x.accountId, role));
    return msgs.length ? { item, m, msgs, role } : null;
  }
  if (item.dataset.dropSpam) {
    if (multiActive() && S.multi.has(dragKey)) return { item, m, all: true, spam: true };
    return folderRole(m) === 'junk' ? null : { item, m, spam: true };
  }
  const acc = item.dataset.dropAcc;
  if (multiActive() && S.multi.has(dragKey)) return { item, m, all: true, acc };
  if (acc === m.accountId && item.dataset.dropPath === m.folder) return null;
  return { item, m, acc };
};
// 3.2.29: beim Ziehen am oberen/unteren Rand der Seitenleiste mitscrollen (dragover kommt auch ohne Mausbewegung laufend)
function sidebarAutoscroll(e) {
  if (!dragKey) return;
  const side = $('#sidebar');
  if (!side || side.scrollHeight <= side.clientHeight) return;
  const r = side.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right) return;
  const edge = 48;
  const fromTop = e.clientY - r.top;
  const fromBottom = r.bottom - e.clientY;
  if (fromBottom < edge && fromBottom > -20) side.scrollTop += Math.max(4, (edge - fromBottom) / 2);
  else if (fromTop < edge && fromTop > -20) side.scrollTop -= Math.max(4, (edge - fromTop) / 2);
}
document.addEventListener('dragover', (e) => {
  sidebarAutoscroll(e);
  const t = dropTarget(e);
  document.querySelectorAll('.side-item.drop-ok').forEach((x) => { if (!t || x !== t.item) x.classList.remove('drop-ok'); });
  if (!t) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  t.item.classList.add('drop-ok');
});
window.addEventListener('dragover', (e) => { if (!e.defaultPrevented) { e.preventDefault(); e.dataTransfer.dropEffect = 'none'; } });
window.addEventListener('drop', (e) => { if (!e.defaultPrevented) e.preventDefault(); });
document.addEventListener('drop', (e) => {
  const t = dropTarget(e);
  if (!t) return;
  e.preventDefault();
  t.item.classList.remove('drop-ok');
  if (t.spam) { if (t.all) bulk('spam'); else markSpam(t.m, null); return; }
  if (t.cat) { setSenderCategory(t.msgs, t.cat); return; }
  if (t.role) { moveToRole(t.msgs, t.role); return; }
  if (t.all) bulk('moveAcc', { acc: t.acc, path: t.item.dataset.dropPath });
  else moveTo(t.m, t.item.dataset.dropPath, t.acc);
});

/** Mails in den Gesendet-/Papierkorb-Ordner ihres jeweiligen Kontos (Papierkorb = Löschen) */
async function moveToRole(msgs, role) {
  const list = msgs.filter((m) => folderRole(m) !== role && roleFolderOf(m.accountId, role));
  if (!list.length) return;
  S.multi.clear();
  for (const m of list) removeLocal(m);
  S.selected = null;
  renderAll(); updateBadge();
  const n = list.length;
  toast(role === 'trash' ? `${n} E-Mail${n === 1 ? '' : 's'} gelöscht` : `${n} E-Mail${n === 1 ? '' : 's'} nach „Gesendet“ verschoben`);
  for (const m of list) {
    if (role === 'trash') await serverOp(m, 'mail:delete');
    else await serverOp(m, 'mail:move', roleFolderOf(m.accountId, role));
  }
}

// ---- Spam
const folderRole = (m) => ((S.folders[m.accountId] || []).find((f) => f.path === m.folder) || {}).role;
const spamFilter = () => ({ enabled: (S.settings.spamFilter || {}).enabled !== false,
  level: ['low', 'medium', 'high'].includes((S.settings.spamFilter || {}).level) ? S.settings.spamFilter.level : 'medium' });
const isBlockedAddr = (k) => S.settings.blocked[k] && !S.settings.blocked[k].deleted;

function blockSender(key) {
  S.settings.blocked[key.toLowerCase()] = { deleted: false, updatedAt: now() };
  saveSettings();
}

function unblockSender(key) {
  S.settings.blocked[key.toLowerCase()] = { deleted: true, updatedAt: now() };
  saveSettings();
}

async function markSpam(m, block) {
  if (block) blockSender(block);
  removeLocal(m);
  renderAll(); updateBadge();
  toast(block ? `Als Spam markiert – ${block} gesperrt` : 'Als Spam markiert');
  await serverOp(m, 'mail:spam', true);
  // weitere Mails desselben Absenders im Posteingang gleich mit verschieben
  if (block) {
    const k = block.toLowerCase();
    for (const x of allInbox()) {
      const a = x.fromAddress.toLowerCase();
      if (x.accountId && (a === k || (k.startsWith('@') && (a.endsWith(k) || a.split('@')[1].endsWith(`.${k.slice(1)}`))))) {
        removeLocal(x);
        serverOp(x, 'mail:spam', true);
      }
    }
    renderAll(); updateBadge();
  }
}

async function markNotSpam(m) {
  const a = m.fromAddress.toLowerCase();
  const d = `@${a.split('@')[1] || ''}`;
  for (const k of [a, d]) if (isBlockedAddr(k)) unblockSender(k);
  // Absender merken, damit der Spamfilter ihn künftig nicht mehr aussortiert
  if (a && !isTrusted(a)) { S.settings.trusted[a] = { updatedAt: now(), deleted: false }; saveSettings(); }
  removeLocal(m);
  renderAll(); updateBadge();
  toast('In den Posteingang verschoben – Absender wird nicht mehr als Spam aussortiert');
  await serverOp(m, 'mail:spam', false);
}

function spamMenuItems(m) {
  const a = m.fromAddress.toLowerCase();
  const d = `@${a.split('@')[1] || ''}`;
  const freemail = /@(gmail|googlemail|web|gmx|t-online|outlook|hotmail|live|yahoo|icloud|me|aol|freenet|posteo|mailbox)\./.test(a);
  const items = [
    { label: 'Als Spam markieren', action: () => markSpam(m, null) },
    { label: `Spam + Absender sperren (${a})`, action: () => markSpam(m, a) },
  ];
  if (!freemail) items.push({ label: `Spam + ganze Domain sperren (${d})`, action: () => markSpam(m, d) });
  return items;
}

async function unsubscribe(m) {
  const b = S.bodies[keyOf(m)];
  if (!b || !b.unsubscribe) return;
  const u = b.unsubscribe;
  const how = u.oneClick ? 'Die Abmeldung wird direkt an den Absender geschickt.'
    : u.mailto ? 'SimpleMail schickt dazu eine Abmelde-Mail an den Absender.' : 'Die Abmelde-Seite des Absenders öffnet sich im Browser.';
  const ok = await confirmDialog({ title: 'Vom Newsletter abmelden?', text: `<b>${esc(sender(m))}</b> &lt;${esc(m.fromAddress)}&gt;<br><br>${how}`, ok: 'Abmelden', cancel: 'Abbrechen' });
  if (!ok) return;
  try {
    const r = await api.call('mail:unsubscribe', m.accountId, u);
    toast(r === 'browser' ? 'Abmelde-Seite geöffnet' : 'Abmeldung gesendet');
  } catch (e) { showError(e.message); }
}

async function remove(m) {
  removeLocal(m);
  renderAll(); updateBadge();
  await serverOp(m, 'mail:delete');
}

function snooze(m, until) {
  if (m.folder !== 'INBOX') { showError('Zurückstellen ist nur im Posteingang möglich.'); return; }
  selectNext(m);
  const acc = findAccount(m.accountId);
  S.settings.snoozes = S.settings.snoozes.filter((e) => !snoozeMatches(e, m));
  S.settings.snoozes.push({ id: uuid(), accountId: m.accountId, accountEmail: acc ? acc.email.toLowerCase() : '',
    messageId: m.messageId, uid: m.uid, until: until.toISOString(), subject: m.subject, sender: sender(m),
    notified: false, deleted: false, updatedAt: now() });
  saveSettings();
  renderAll(); updateBadge();
  toast(`Erinnerung am ${fmtWeekday.format(until)}`);
}

function unsnooze(m) {
  for (const e of S.settings.snoozes) if (snoozeMatches(e, m)) { e.deleted = true; e.updatedAt = now(); }
  saveSettings();
  renderAll();
}

async function tick() {
  const now = new Date();
  let changed = false;
  for (const e of S.settings.snoozes) {
    if (!e.deleted && !e.notified && new Date(e.until) <= now) {
      e.notified = true;
      e.updatedAt = Date.now();
      changed = true;
      api.call('app:notify', `Erinnerung: ${e.sender}`, e.subject || '(Kein Betreff)');
      const m = (S.inbox[e.accountId] || []).find((x) => snoozeMatches(e, x));
      if (m && m.isRead) setRead(m, false);
    }
  }
  const cutoff = Date.now() - 7 * 86400e3;
  const kept = S.settings.snoozes.filter((e) => new Date(e.until).getTime() >= cutoff);
  if (kept.length !== S.settings.snoozes.length) { S.settings.snoozes = kept; changed = true; }
  if (changed) { saveSettings(); renderAll(); updateBadge(); }
}

let lastBadge = -1;
function updateBadge() {
  const n = everyInbox().filter((m) => !m.isRead && !isSnoozed(m) && m.category === 'personal').length;
  // Symbol nur neu zeichnen und senden, wenn sich die Zahl ändert
  if (n === lastBadge) return;
  lastBadge = n;
  let dataUrl = null;
  if (n > 0) {
    const c = document.createElement('canvas');
    c.width = 32; c.height = 32;
    const g = c.getContext('2d');
    g.fillStyle = '#c42b1c';
    g.beginPath(); g.arc(16, 16, 16, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff';
    g.font = `bold ${n > 99 ? 13 : 18}px Segoe UI, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(n > 99 ? '99+' : String(n), 16, 17);
    dataUrl = c.toDataURL();
  }
  api.call('app:badge', n, dataUrl).catch(() => {});
  document.title = n > 0 ? `SimpleMail (${n})` : 'SimpleMail';
}

// =================================================================== Kontakte (Adressbuch)
// Kontakt: { id, name, company, emails: [], phones: [], street, zip, city, country, notes, updatedAt, deleted }

const liveContacts = () => (S.settings.contacts || []).filter((c) => !c.deleted)
  .sort((a, b) => (a.name || a.company || a.emails[0] || '').localeCompare(b.name || b.company || b.emails[0] || '', 'de', { sensitivity: 'base' }));
const contactTitle = (c) => c.name || c.company || c.emails[0] || '(ohne Namen)';
const findContact = (id) => (S.settings.contacts || []).find((c) => c.id === id && !c.deleted);
const contactByEmail = (addr) => {
  const a = String(addr || '').toLowerCase();
  return liveContacts().find((c) => c.emails.some((e) => e.toLowerCase() === a));
};

function contactMatches(c, q) {
  if (!q) return true;
  return [c.name, c.company, c.city, c.notes, ...c.emails, ...c.phones].some((x) => String(x || '').toLowerCase().includes(q));
}

function contactsListHtml() {
  const q = S.search.trim().toLowerCase();
  const list = liveContacts().filter((c) => contactMatches(c, q));
  let html = `<div class="contacts-bar">
    <button class="btn primary" data-act="ct-new">＋ Neuer Kontakt</button>
    <button class="btn" data-act="ct-import" title="Kontakte aus einer vCard-Datei (.vcf) übernehmen – z. B. aus Apple Kontakte, Google oder Outlook">Importieren …</button>
    <button class="btn" data-act="ct-export" title="Alle Kontakte als vCard-Datei (.vcf) speichern">Exportieren …</button></div>`;
  if (!list.length) {
    return html + `<div class="empty">${q ? 'Kein Kontakt gefunden' : 'Noch keine Kontakte'}<small>Mit „Neuer Kontakt“ anlegen, per Rechtsklick auf eine Mail
      den Absender übernehmen oder eine vCard-Datei importieren.</small></div>`;
  }
  let letter = '';
  for (const c of list) {
    const l = (contactTitle(c)[0] || '#').toUpperCase();
    if (l !== letter) { letter = l; html += `<div class="group">${esc(/[A-ZÄÖÜ]/.test(l) ? l : '#')}</div>`; }
    const sub = [c.company && c.name ? c.company : '', c.emails[0] || c.phones[0] || ''].filter(Boolean).join(' · ');
    html += `<div class="row contact-row${S.selContact === c.id ? ' selected' : ''}" data-act="ct-sel" data-id="${esc(c.id)}">
      ${avatar(contactTitle(c))}
      <div class="row-main"><div class="row-top"><span class="from"${colorStyle(validColor(c.color))}>${esc(contactTitle(c))}</span></div>
      <div class="subject">${esc(sub)}</div></div></div>`;
  }
  return html;
}

function contactDetailHtml() {
  const c = findContact(S.selContact);
  if (!c) {
    return `<div class="placeholder"><div style="text-align:center">${icon('person')}<div>${liveContacts().length} Kontakt(e)</div></div></div>`;
  }
  const lines = (arr) => esc((arr || []).join('\n'));
  return `<div class="detail-bar">
      ${c.emails[0] ? `<button class="btn" data-act="ct-mail">${icon('mail')} E-Mail schreiben</button>` : ''}
      <span class="grow"></span>
      <button class="btn danger" data-act="ct-del">${icon('trash')} Löschen</button></div>
    <div class="contact-form form-grid" data-id="${esc(c.id)}">
      <h3${colorStyle(validColor(c.color))}>${esc(contactTitle(c))}</h3>
      <label>Name</label><input data-f="name" value="${esc(c.name || '')}" placeholder="Vorname Nachname">
      <label>Firma</label><input data-f="company" value="${esc(c.company || '')}">
      <label>E-Mail</label><textarea data-f="emails" rows="2" placeholder="eine Adresse pro Zeile">${lines(c.emails)}</textarea>
      <label>Telefon</label><textarea data-f="phones" rows="2" placeholder="eine Nummer pro Zeile">${lines(c.phones)}</textarea>
      <label>Straße</label><input data-f="street" value="${esc(c.street || '')}">
      <label>PLZ / Ort</label><div class="ct-city"><input data-f="zip" value="${esc(c.zip || '')}" style="width:90px">
        <input data-f="city" value="${esc(c.city || '')}"></div>
      <label>Land</label><input data-f="country" value="${esc(c.country || '')}">
      <label>Notiz</label><textarea data-f="notes" rows="4">${esc(c.notes || '')}</textarea>
      <label>Schriftfarbe</label><div>${swatchesHtml('data-act="ct-color"', c.color, 'Keine')}
        <div class="hint-text" style="margin-top:4px">Name dieses Kontakts in der Mailliste farbig anzeigen.</div></div>
      <span></span><div class="hint-text">Änderungen werden automatisch gespeichert und mit deinen anderen Geräten synchronisiert.</div>
    </div>`;
}

function newContact(data = {}) {
  const c = { id: uuid(), name: '', company: '', emails: [], phones: [], street: '', zip: '', city: '', country: '', notes: '', color: '',
    ...data, updatedAt: now(), deleted: false };
  S.settings.contacts.push(c);
  saveSettings();
  return c;
}

function showContacts(id) {
  S.view = { type: 'contacts' };
  S.selContact = id || null;
  renderAll();
  const first = $('#detail [data-f="name"]');
  if (first && id && !findContact(id).name) first.focus();
}

// ---- Kontaktdaten aus einer E-Mail (Signatur) herauslesen
/** HTML → Text mit Zeilenumbrüchen (Signaturen sind oft Tabellen) */
function htmlToLines(html) {
  const marked = String(html || '')
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d|\/table)\b[^>]*>/gi, '\n')
    .replace(/<\/td>/gi, ' • ');
  const d = new DOMParser().parseFromString(marked, 'text/html');
  return d.body ? d.body.textContent || '' : '';
}

/** Signaturbereich: nach „-- “ bzw. die letzten Zeilen vor einem Zitat */
function signatureLines(text) {
  let lines = String(text || '').replace(/\r/g, '').replace(/ /g, ' ').split('\n');
  // Zitat bzw. weitergeleitete Mail abschneiden
  const cut = lines.findIndex((l) => /^\s*>/.test(l) || /^\s*(Am .{3,80} schrieb|On .{3,80} wrote|-{2,}\s*(Original|Ursprüngliche)|Von:\s|From:\s)/i.test(l));
  if (cut > 0) lines = lines.slice(0, cut);
  const sep = lines.map((l) => l.trim()).lastIndexOf('--');
  let sig = sep >= 0 ? lines.slice(sep + 1) : lines.slice(-25);
  sig = sig.flatMap((l) => l.split(/\s+[•|·]\s+|\s{3,}|\t/)).map((l) => l.trim()).filter(Boolean);
  return sig.slice(0, 40);
}

const COMPANY_RE = /(^|\s)(GmbH|AG|KG|OHG|UG|e\.\s?K\.|e\.\s?V\.|mbH|GbR|Inc\.?|Ltd\.?|LLC|S\.A\.|B\.V\.|SE)(?=[\s,;&)]|$)/;

function extractContactInfo(text, fromName, fromAddress) {
  const out = { phones: [], street: '', zip: '', city: '', country: '', company: '', website: '' };
  const lines = signatureLines(text);
  const phoneRe = /(?:^|[^\d])(\+?\(?\d[\d\s/().–-]{5,}\d)(?![\d])/;
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ');
    // Telefon/Fax mit Bezeichnung
    const lab = /^(?:(tel(?:efon)?|fon|phone|mobil(?:e|funk)?|handy|cell|fax|telefax|privat|büro|office|zentrale|direkt(?:wahl)?)\.?\s*[:.]?\s*)/i.exec(line);
    const pm = phoneRe.exec(line);
    if (pm) {
      const num = pm[1].trim().replace(/\s{2,}/g, ' ');
      const digits = num.replace(/\D/g, '');
      const looksDate = /^\d{1,2}[./]\d{1,2}[./]\d{2,4}$/.test(num);
      const looksZip = /^\d{5}$/.test(digits) || /^\d{4}$/.test(digits);
      if (digits.length >= 6 && digits.length <= 16 && !looksDate && !looksZip && !/iban|bic|ust|steuer|hrb|hra|amtsgericht|konto|blz/i.test(line)) {
        const label = lab ? lab[1].replace(/^tel(efon)?$/i, 'Telefon').replace(/^(fon|phone)$/i, 'Telefon')
          .replace(/^(handy|cell|mobile|mobilfunk)$/i, 'Mobil').replace(/^telefax$/i, 'Fax') : '';
        const entry = label ? `${label.charAt(0).toUpperCase()}${label.slice(1).toLowerCase()}: ${num}` : num;
        if (!out.phones.some((p) => p.replace(/\D/g, '') === digits)) out.phones.push(entry);
        if (lab || /^[+\d(]/.test(line)) continue;
      }
    }
    // PLZ + Ort (DE 5-stellig, AT/CH 4-stellig mit Länderkürzel)
    const zm = /(?:^|[\s,])((?:D-|DE-)?\d{5}|(?:A|AT|CH)-\d{4})\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß.\- ]{1,40}?)(?:\s*[,(]|$)/.exec(line);
    if (zm && !out.zip) {
      out.zip = zm[1].replace(/^(D|DE|A|AT|CH)-/, '');
      out.city = zm[2].trim();
      if (/^(A|AT)-/.test(zm[1])) out.country = 'Österreich';
      if (/^CH-/.test(zm[1])) out.country = 'Schweiz';
      // Straße auf derselben Zeile davor …
      const before = line.slice(0, zm.index).replace(/[,•|·\s]+$/, '').trim();
      const segs = before.split(/[,•|]/).map((x) => x.trim()).filter(Boolean);
      if (segs.length && /\d+\s*[a-z]?$/i.test(segs[segs.length - 1]) && /[A-Za-zÄÖÜäöüß]{3}/.test(segs[segs.length - 1])) out.street = segs.pop();
      if (!out.company && segs.length && COMPANY_RE.test(segs[0])) out.company = segs[0];
      continue;
    }
    if (!out.street && /^[A-ZÄÖÜ][A-Za-zÄÖÜäöüß.\- ]{2,40}\s\d{1,4}\s*[a-zA-Z]?(?:\s*[-/]\s*\d{1,4}[a-z]?)?$/.test(line)
        && !/tel|fax|mobil|handy/i.test(line)) {
      out.street = line;
      continue;
    }
    if (!out.country && /^(Deutschland|Germany|Österreich|Austria|Schweiz|Switzerland|Niederlande|Netherlands|Belgien|Belgium|Frankreich|France|Luxemburg)$/i.test(line)) {
      out.country = line;
      continue;
    }
    if (!out.company && COMPANY_RE.test(line) && line.length < 80
        && !/amtsgericht|registergericht|sitz der/i.test(line)) {
      out.company = line.replace(/^(firma|company)\s*:\s*/i, '');
      continue;
    }
    const wm = /\b((?:https?:\/\/)?www\.[a-z0-9.-]+\.[a-z]{2,}(?:\/\S*)?)/i.exec(line);
    if (wm && !out.website) out.website = wm[1];
  }
  // Straße ohne PLZ-Zeile davor? Dann Zeile vor der PLZ nehmen
  if (out.zip && !out.street) {
    const i = lines.findIndex((l) => l.includes(out.zip));
    const prev = i > 0 ? lines[i - 1].trim() : '';
    if (/\d+\s*[a-z]?$/i.test(prev) && /[A-Za-zÄÖÜäöüß]{3}/.test(prev) && !/tel|fax|mobil/i.test(prev)) out.street = prev;
  }
  return out;
}

/** Text einer Mail für die Auswertung (HTML-Tabellen bleiben zeilenweise erhalten) */
async function mailTextForContact(m) {
  if (!S.bodies[keyOf(m)]) {
    try { S.bodies[keyOf(m)] = await api.call('mail:body', m.accountId, m.folder, m.uid); } catch { return ''; }
  }
  const b = S.bodies[keyOf(m)];
  return b.html ? htmlToLines(b.html) : (b.text || '');
}

/** Absender übernehmen – mit Telefon, Adresse und Firma aus der Signatur; vorhandenen Kontakt ergänzen */
async function addSenderToContacts(m) {
  const info = extractContactInfo(await mailTextForContact(m), m.fromName, m.fromAddress);
  let c = contactByEmail(m.fromAddress);
  const isNew = !c;
  if (!c) c = newContact({ name: m.fromName || '', emails: [m.fromAddress] });
  const found = [];
  for (const [k, label] of [['company', 'Firma'], ['street', 'Straße'], ['zip', ''], ['city', 'Ort'], ['country', 'Land']]) {
    if (info[k] && !c[k]) { c[k] = info[k]; if (label) found.push(label); }
  }
  const newPhones = info.phones.filter((p) => !c.phones.some((x) => x.replace(/\D/g, '') === p.replace(/\D/g, '')));
  if (newPhones.length) { c.phones.push(...newPhones); found.unshift(newPhones.length > 1 ? 'Telefonnummern' : 'Telefon'); }
  if (info.website && !(c.notes || '').includes(info.website)) { c.notes = [c.notes, `Web: ${info.website}`].filter(Boolean).join('\n'); found.push('Webseite'); }
  c.updatedAt = now();
  saveSettings();
  rebuildContacts();
  toast(found.length ? `${isNew ? 'Kontakt angelegt' : 'Kontakt ergänzt'} – aus der Mail übernommen: ${found.join(', ')}. Bitte prüfen.`
    : (isNew ? 'Zu Kontakten hinzugefügt' : 'Keine neuen Angaben in dieser Mail gefunden'));
  showContacts(c.id);
}

// Eingaben im Kontaktformular speichern
let contactSaveTimer = null;
document.addEventListener('input', (e) => {
  const f = e.target.closest && e.target.closest('.contact-form [data-f]');
  if (!f) return;
  const c = findContact(S.selContact);
  if (!c) return;
  const key = f.dataset.f;
  c[key] = key === 'emails' || key === 'phones'
    ? f.value.split(/\n|,|;/).map((x) => x.trim()).filter(Boolean) : f.value;
  c.updatedAt = now();
  const row = document.querySelector(`.contact-row[data-id="${CSS.escape(c.id)}"] .from`);
  if (row) row.textContent = contactTitle(c);
  clearTimeout(contactSaveTimer);
  contactSaveTimer = setTimeout(() => { saveSettings(); rebuildContacts(); }, 600);
});

// ---- vCard (.vcf)
function vcardEscape(v) { return String(v || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;'); }

function contactsToVcf(list) {
  return list.map((c) => {
    const parts = (c.name || '').trim().split(/\s+/);
    const last = parts.length > 1 ? parts.pop() : (parts[0] || '');
    const first = parts.length ? parts.join(' ') : '';
    const out = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${vcardEscape(contactTitle(c))}`, `N:${vcardEscape(last)};${vcardEscape(first)};;;`];
    if (c.company) out.push(`ORG:${vcardEscape(c.company)}`);
    for (const e of c.emails) out.push(`EMAIL;TYPE=INTERNET:${e}`);
    for (const p of c.phones) out.push(`TEL:${vcardEscape(p)}`);
    if (c.street || c.city || c.zip || c.country) {
      out.push(`ADR:;;${vcardEscape(c.street)};${vcardEscape(c.city)};;${vcardEscape(c.zip)};${vcardEscape(c.country)}`);
    }
    if (c.notes) out.push(`NOTE:${vcardEscape(c.notes)}`);
    out.push('END:VCARD');
    return out.join('\r\n');
  }).join('\r\n') + '\r\n';
}

function parseVcf(text) {
  const lines = String(text || '').replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const unesc = (v) => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
  const splitUnesc = (v) => v.split(/(?<!\\);/).map(unesc);
  const decodeQP = (v, charset) => {
    const bytes = [];
    const s0 = v.replace(/=\r?$/, '');
    for (let i = 0; i < s0.length; i++) {
      if (s0[i] === '=' && /^[0-9A-F]{2}$/i.test(s0.slice(i + 1, i + 3))) { bytes.push(parseInt(s0.slice(i + 1, i + 3), 16)); i += 2; } else bytes.push(s0.charCodeAt(i));
    }
    try { return new TextDecoder(charset || 'utf-8').decode(new Uint8Array(bytes)); } catch { return v; }
  };
  const out = [];
  let c = null;
  for (const raw of lines) {
    const i = raw.indexOf(':');
    if (i < 0) continue;
    const head = raw.slice(0, i);
    let value = raw.slice(i + 1);
    const [nameRaw, ...params] = head.split(';');
    const name = nameRaw.replace(/^item\d+\./i, '').toUpperCase();
    const pstr = params.join(';').toUpperCase();
    if (/ENCODING=QUOTED-PRINTABLE/.test(pstr)) {
      const cs = (/CHARSET=([^;:]+)/i.exec(params.join(';')) || [])[1];
      value = decodeQP(value, cs);
    }
    if (name === 'BEGIN' && /VCARD/i.test(value)) { c = { name: '', company: '', emails: [], phones: [], street: '', zip: '', city: '', country: '', notes: '' }; continue; }
    if (!c) continue;
    if (name === 'END') { if (c.name || c.company || c.emails.length) out.push(c); c = null; continue; }
    if (name === 'FN') c.name = unesc(value).trim();
    else if (name === 'N' && !c.name) { const n = splitUnesc(value); c.name = [n[3], n[1], n[2], n[0], n[4]].filter(Boolean).join(' ').trim(); }
    else if (name === 'ORG') c.company = splitUnesc(value).filter(Boolean).join(', ');
    else if (name === 'EMAIL') { const e = value.trim(); if (e && !c.emails.includes(e)) c.emails.push(e); }
    else if (name === 'TEL') { const t = unesc(value).replace(/^tel:/i, '').trim(); if (t) c.phones.push(t); }
    else if (name === 'ADR' && !c.street && !c.city) { const a = splitUnesc(value); [c.street, c.city, c.zip, c.country] = [a[2] || '', a[3] || '', a[5] || '', a[6] || '']; }
    else if (name === 'NOTE') c.notes = unesc(value);
  }
  return out;
}

async function importContacts() {
  let text;
  try { text = await api.call('contacts:open'); } catch (e) { showError(e.message); return; }
  if (text == null) return;
  const cards = parseVcf(text);
  let added = 0, merged = 0;
  for (const card of cards) {
    const ex = card.emails.map(contactByEmail).find(Boolean)
      || liveContacts().find((x) => x.name && card.name && x.name.toLowerCase() === card.name.toLowerCase());
    if (ex) {
      for (const k of ['company', 'street', 'zip', 'city', 'country', 'notes']) if (!ex[k] && card[k]) ex[k] = card[k];
      for (const e of card.emails) if (!ex.emails.some((x) => x.toLowerCase() === e.toLowerCase())) ex.emails.push(e);
      for (const p of card.phones) if (!ex.phones.includes(p)) ex.phones.push(p);
      if (!ex.name) ex.name = card.name;
      ex.updatedAt = now();
      merged++;
    } else {
      S.settings.contacts.push({ id: uuid(), ...card, updatedAt: now(), deleted: false });
      added++;
    }
  }
  await saveSettings();
  rebuildContacts();
  renderAll();
  toast(cards.length ? `${added} Kontakt(e) neu, ${merged} ergänzt` : 'Keine Kontakte in der Datei gefunden');
}

async function exportContacts() {
  const list = liveContacts();
  if (!list.length) { toast('Keine Kontakte vorhanden'); return; }
  try {
    const ok = await api.call('contacts:save', contactsToVcf(list));
    if (ok) toast(`${list.length} Kontakt(e) exportiert`);
  } catch (e) { showError(e.message); }
}

// ---- Kontakte für Adressvorschläge (Adressbuch + aus geladenen Mails)
function rebuildContacts() {
  const colors = new Map();
  for (const c of liveContacts()) {
    const col = validColor(c.color);
    if (col) for (const e of c.emails) colors.set(String(e).toLowerCase(), col);
  }
  S.contactColors = colors;
  const map = new Map();
  const add = (name, email) => {
    const k = (email || '').toLowerCase();
    if (!k.includes('@') || k.includes('noreply') || k.includes('no-reply')) return;
    const ex = map.get(k);
    if (ex && ex.name) return;
    map.set(k, { name: name || '', email });
  };
  for (const c of liveContacts()) for (const e of c.emails) add(c.name || c.company, e);
  for (const m of everyInbox().concat(S.folderMsgs)) {
    add(m.fromName, m.fromAddress);
    for (const part of m.to.split(',')) {
      const mm = part.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
      if (mm) add(mm[1].replace(/^"|"$/g, ''), mm[2]); else add('', part.trim());
    }
  }
  const own = new Set(S.accounts.map((a) => a.email.toLowerCase()));
  S.contacts = [...map.values()].filter((c) => !own.has(c.email.toLowerCase()));
}

function suggestions(field) {
  const token = (field.split(',').pop() || '').trim().toLowerCase();
  if (token.length < 2 || token.includes('<')) return [];
  const hits = S.contacts.filter((c) => (c.email.toLowerCase().includes(token) || c.name.toLowerCase().includes(token)) &&
    c.email.toLowerCase() !== token);
  const starts = (c) => c.email.toLowerCase().startsWith(token) || c.name.toLowerCase().startsWith(token);
  return hits.filter(starts).concat(hits.filter((c) => !starts(c))).slice(0, 6);
}

const contactDisplay = (c) => (!c.name || /[,"]/.test(c.name) ? c.email : `${c.name} <${c.email}>`);

function completing(field, c) {
  const parts = field.split(',').map((p) => p.trim());
  parts.pop();
  return parts.filter(Boolean).concat(contactDisplay(c)).join(', ') + ', ';
}

// =================================================================== Rendern

function renderAll() {
  renderSidebar();
  renderList();
  renderDetail();
  renderStatus();
}

function sideItem(label, iconName, view, count, active) {
  return `<div class="side-item${active ? ' active' : ''}" data-act="view" data-view='${esc(JSON.stringify(view))}'>
    ${icon(iconName)}<span class="label">${esc(label)}</span>${count ? `<span class="count">${count}</span>` : ''}</div>`;
}

const sameView = (a, b) => a.type === b.type && a.cat === b.cat && a.acc === b.acc && a.path === b.path;

/** Alle Zähler der Seitenleiste in einem Durchlauf (vorher ein Durchlauf je Zähler, teils doppelt) */
function sidebarCounts() {
  const filter = accountFilter();
  const c = { byAcc: {}, total: 0, inView: 0, byCat: {}, snoozed: 0 };
  for (const [acc, list] of Object.entries(S.inbox)) {
    const inView = !filter || filter === acc;
    let n = 0;
    for (const m of list || []) {
      if (isSnoozed(m)) { if (inView) c.snoozed++; continue; }
      if (m.isRead) continue;
      n++;
      if (inView) { c.inView++; c.byCat[m.category] = (c.byCat[m.category] || 0) + 1; }
    }
    c.byAcc[acc] = n;
    c.total += n;
  }
  return c;
}

let sidebarHtmlLast = '';
function renderSidebar() {
  const v = S.view;
  const cnt = sidebarCounts();
  const snoozedCount = cnt.snoozed;
  const filter = accountFilter();
  let html = '';
  if (S.accounts.length) {
    const unreadOf = (id) => cnt.byAcc[id] || 0;
    const total = S.accounts.reduce((n, a) => n + unreadOf(a.id), 0);
    html += '<div class="side-title">Konten</div>';
    html += `<div class="side-item account-item${filter ? '' : ' active'}" data-act="account-filter" data-acc="">
      <span class="acc-badge all">${icon('inbox')}</span><span class="label">Alle Konten</span>${total ? `<span class="count">${total}</span>` : ''}</div>`;
    for (const a of S.accounts) {
      const name = a.displayName || a.email;
      const on = S.push[a.id];
      html += `<div class="side-item account-item${filter === a.id ? ' active' : ''}" data-act="account-filter" data-acc="${esc(a.id)}" title="${esc(a.email)}${a.hasPassword === false ? ' – Passwort fehlt' : ''}">
        ${avatar(name).replace('class="avatar"', 'class="avatar acc-avatar"').replace(/background:[^"]*/, `background:${accountColor(a)}`)}
        <span class="label"><span class="acc-name">${esc(a.email)}</span>${a.hasPassword === false ? '<span class="acc-warn">Passwort fehlt</span>' : ''}</span>
        <span class="push-dot ${on ? 'on' : ''}" title="${on ? 'Push aktiv' : 'Abruf alle 5 Minuten'}"></span>
        ${unreadOf(a.id) ? `<span class="count">${unreadOf(a.id)}</span>` : ''}</div>`;
    }
  }
  html += `<div class="side-title">${filter ? esc(findAccount(filter).email) : 'Posteingang'}</div>`;
  html += sideItem('Smart Inbox', 'tray', { type: 'smart' }, cnt.inView, sameView(v, { type: 'smart' }));
  html += sideItem('Ungelesen', 'unread', { type: 'unread' }, cnt.inView, sameView(v, { type: 'unread' }));
  html += sideItem('Markiert', 'star', { type: 'flagged' }, 0, sameView(v, { type: 'flagged' }));
  html += sideItem('Später', 'clock', { type: 'snoozed' }, snoozedCount, sameView(v, { type: 'snoozed' }));
  html += sideItem('Geplant', 'send', { type: 'scheduled' }, S.outbox.length, sameView(v, { type: 'scheduled' }));
  // 3.2.44: Entwürfe aller Konten
  html += sideItem('Entwürfe', 'drafts', { type: 'drafts' }, 0, sameView(v, { type: 'drafts' }));
  // 3.2.36: gemeinsame Ordner aller Konten (nehmen gezogene Mails an)
  html += sideItem('Gesendet', 'sent', { type: 'sent' }, 0, sameView(v, { type: 'sent' })).replace('class="side-item', 'data-drop-role="sent" class="side-item');
  html += sideItem('Papierkorb', 'trash', { type: 'trash' }, 0, sameView(v, { type: 'trash' })).replace('class="side-item', 'data-drop-role="trash" class="side-item');
  html += sideItem('Kontakte', 'person', { type: 'contacts' }, 0, sameView(v, { type: 'contacts' }));
  html += '<div class="side-title">Kategorien</div>';
  for (const c of CATEGORIES) {
    // 3.2.29: Mail auf eine Kategorie ziehen → Absender landet künftig dort
    html += sideItem(c.title, c.icon, { type: 'category', cat: c.id }, cnt.byCat[c.id] || 0, sameView(v, { type: 'category', cat: c.id }))
      .replace('class="side-item', `data-drop-cat="${c.id}" class="side-item`);
  }
  // 3.2.27: „Spam“ nimmt gezogene Mails an (→ Spam-Ordner ihres Kontos)
  html += sideItem('Spam', 'junk', { type: 'spam' }, 0, sameView(v, { type: 'spam' })).replace('class="side-item', 'data-drop-spam="1" class="side-item');
  for (const a of S.accounts.filter((x) => !filter || x.id === filter)) {
    const on = S.push[a.id];
    html += `<div class="side-title" data-acc-title="${esc(a.id)}"><span class="acc-dot" style="background:${accountColor(a)}"></span><span class="grow" title="${esc(a.email)}">${filter ? 'Ordner' : esc(a.email)}</span>
      <span class="push ${on ? 'on' : 'off'}" title="${on ? 'Push aktiv (IMAP IDLE)' : 'Abruf alle 5 Minuten'}">${on ? '⚡ Push' : '⏱'}</span></div>`;
    for (const f of S.folders[a.id] || []) {
      const pad = `style="padding-left:${10 + f.depth * 14}px"`;
      const fc = folderColor(a.id, f.path);
      if (!f.selectable) {
        html += `<div class="side-item disabled" ${pad} data-folder-acc="${esc(a.id)}" data-folder-path="${esc(f.path)}">${icon('folder')}<span class="label"${fc ? ` style="color:${fc}"` : ''}>${esc(f.name)}</span></div>`;
        continue;
      }
      const view = { type: 'folder', acc: a.id, path: f.path };
      const count = ['trash', 'junk', 'sent', 'drafts'].includes(f.role) ? 0 : f.unread;
      let item = sideItem(f.name, ROLE_ICON[f.role], view, count, sameView(v, view))
        .replace('class="side-item', `${pad} data-drop-acc="${esc(a.id)}" data-drop-path="${esc(f.path)}" class="side-item`);
      // 3.2.38: eigene Schriftfarbe (Rechtsklick → Schriftfarbe …)
      if (fc) item = item.replace('class="side-item', 'class="side-item colored').replace('<span class="label">', `<span class="label" style="color:${fc}">`);
      html += item;
    }
  }
  html += `<div style="height:12px"></div>` + sideItem('Einstellungen', 'gear', { type: 'settings' }, 0, false);
  // Unverändert → DOM nicht anfassen (wird nach jedem Klick/Abruf aufgerufen)
  const side = $('#sidebar');
  if (html === sidebarHtmlLast && side.children.length) return;
  sidebarHtmlLast = html;
  side.innerHTML = html;
}

// =================================================================== Seitenleiste: Rechtsklick

const SYSTEM_ROLES = ['inbox', 'sent', 'drafts', 'trash', 'junk', 'archive'];

/** Eingabedialog (Promise<string|null>) */
function promptDialog({ title, label = '', value = '', ok = 'OK' }) {
  return new Promise((resolve) => {
    const { el, close } = openOverlay(`<div class="dialog" style="width:420px">
      <div class="dialog-head">${esc(title)}</div>
      <div style="padding:16px 18px">${label ? `<div style="color:var(--muted);margin-bottom:8px">${esc(label)}</div>` : ''}
        <input class="text-input" id="pd-val" value="${esc(value)}" style="width:100%"></div>
      <div class="dialog-foot"><span class="grow"></span>
        <button class="btn" data-x="no">Abbrechen</button>
        <button class="primary" data-x="yes">${esc(ok)}</button></div></div>`, { closable: false });
    const input = $('#pd-val', el);
    let done = false;
    const finish = (v) => { if (done) return; done = true; close(); resolve(v); };
    el.addEventListener('click', (e) => {
      const x = e.target.closest('[data-x]');
      if (x) finish(x.dataset.x === 'yes' ? input.value.trim() || null : null);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); finish(null); }
      if (e.key === 'Enter') { e.preventDefault(); finish(input.value.trim() || null); }
    });
    input.focus(); input.select();
  });
}

const folderEntry = (accId, path) => (S.folders[accId] || []).find((f) => f.path === path) || null;

/** Mehrere Mails als gelesen markieren (gebündelt je Konto und Ordner) */
async function markListRead(list) {
  const unread = list.filter((m) => !m.isRead);
  if (!unread.length) { toast('Keine ungelesenen E-Mails'); return; }
  for (const m of unread) markReadLocally(m, true);
  renderAll(); updateBadge();
  toast(`${unread.length} E-Mail${unread.length === 1 ? '' : 's'} als gelesen markiert`);
  const groups = new Map();
  for (const m of unread) {
    const k = `${m.accountId}\u0000${m.folder}`;
    if (!groups.has(k)) groups.set(k, { acc: m.accountId, folder: m.folder, uids: [] });
    groups.get(k).uids.push(m.uid);
  }
  for (const g of groups.values()) {
    try { await api.call('mail:flagMany', g.acc, g.folder, g.uids, '\\Seen', true); } catch (e) { showError(e.message); }
  }
}

async function unflagList(list) {
  const flagged = list.filter((m) => m.isFlagged);
  if (!flagged.length) return;
  for (const m of flagged) { notePending(m, { flagged: false }); updateLocal(keyOf(m), (x) => { x.isFlagged = false; }); }
  renderAll();
  const groups = new Map();
  for (const m of flagged) {
    const k = `${m.accountId}\u0000${m.folder}`;
    if (!groups.has(k)) groups.set(k, { acc: m.accountId, folder: m.folder, uids: [] });
    groups.get(k).uids.push(m.uid);
  }
  for (const g of groups.values()) {
    try { await api.call('mail:flagMany', g.acc, g.folder, g.uids, '\\Flagged', false); } catch (e) { showError(e.message); }
  }
}

/** Ganzen Ordner auf dem Server als gelesen markieren */
async function markFolderRead(accId, path) {
  try {
    for (const m of (S.inbox[accId] || []).concat(S.folderMsgs)) {
      if (m.accountId === accId && m.folder === path && !m.isRead) updateLocal(keyOf(m), (x) => { x.isRead = true; });
    }
    const f = folderEntry(accId, path);
    if (f) f.unread = 0;
    renderAll(); updateBadge();
    const n = await api.call('folders:markAllRead', accId, path);
    toast(n ? `${n} E-Mail${n === 1 ? '' : 's'} als gelesen markiert` : 'Keine ungelesenen E-Mails');
  } catch (e) { showError(e.message); }
}

async function createFolder(accId, parent) {
  const name = await promptDialog({ title: parent ? 'Neuer Unterordner' : 'Neuer Ordner',
    label: parent ? `in „${(folderEntry(accId, parent) || {}).name || parent}“` : findAccount(accId).email, ok: 'Anlegen' });
  if (!name) return;
  try {
    await api.call('folders:create', accId, parent || null, name);
    toast(`Ordner „${name}“ angelegt`);
    await loadFolders();
  } catch (e) { showError(e.message); }
}

async function renameFolder(accId, path) {
  const f = folderEntry(accId, path);
  if (!f) return;
  const name = await promptDialog({ title: 'Ordner umbenennen', value: f.name, ok: 'Umbenennen' });
  if (!name || name === f.name) return;
  try {
    const full = await api.call('folders:rename', accId, path, name);
    // Regeln, die in den Ordner verschieben, mitziehen
    const acc = findAccount(accId);
    let changed = false;
    for (const r of S.settings.rules || []) {
      const t = r.actions && r.actions.moveTo;
      if (r.deleted || !t || String(r.accountEmail || '').toLowerCase() !== acc.email.toLowerCase()) continue;
      if (t === path || t.startsWith(path + f.delimiter)) { r.actions.moveTo = full + t.slice(path.length); r.updatedAt = now(); changed = true; }
    }
    if (moveFolderColors(accId, path, full, f.delimiter)) changed = true;   // 3.2.38: Farbe zieht mit
    if (changed) saveSettings();
    if (S.view.type === 'folder' && S.view.acc === accId && (S.view.path === path || S.view.path.startsWith(path + f.delimiter))) {
      S.view = { type: 'folder', acc: accId, path: full + S.view.path.slice(path.length) };
      S.folderMsgs = []; S.selected = null;
    }
    toast(`Ordner umbenannt in „${name}“`);
    await loadFolders();
    if (S.view.type === 'folder') refresh();
  } catch (e) { showError(e.message); }
}

async function deleteFolder(accId, path) {
  const f = folderEntry(accId, path);
  if (!f) return;
  const subs = (S.folders[accId] || []).filter((x) => x.path.startsWith(path + f.delimiter));
  const ok = await confirmDialog({ title: `Ordner „${f.name}“ löschen?`, danger: true, ok: 'Endgültig löschen',
    text: `Der Ordner${subs.length ? ` mit ${subs.length} Unterordner${subs.length === 1 ? '' : 'n'}` : ''} und alle darin enthaltenen E-Mails werden auf dem Server gelöscht.<br><b>Das kann nicht rückgängig gemacht werden.</b>` });
  if (!ok) return;
  try {
    await api.call('folders:delete', accId, path);
    if (moveFolderColors(accId, path, null, f.delimiter)) saveSettings();
    if (S.view.type === 'folder' && S.view.acc === accId && (S.view.path === path || S.view.path.startsWith(path + f.delimiter))) {
      S.view = { type: 'smart' }; S.folderMsgs = []; S.selected = null;
    }
    toast(`Ordner „${f.name}“ gelöscht`);
    await loadFolders();
    renderAll();
  } catch (e) { showError(e.message); }
}

/** Papierkorb/Spam endgültig leeren; targets = [{ acc, path }] */
async function emptyFolders(targets, title) {
  if (!targets.length) { toast('Kein passender Ordner vorhanden'); return; }
  const ok = await confirmDialog({ title, danger: true, ok: 'Endgültig löschen',
    text: `Alle E-Mails in ${targets.length === 1 ? 'diesem Ordner' : `${targets.length} Ordnern`} werden auf dem Server gelöscht.<br><b>Das kann nicht rückgängig gemacht werden.</b>` });
  if (!ok) return;
  let n = 0;
  for (const t of targets) {
    try { n += await api.call('folders:empty', t.acc, t.path); } catch (e) { showError(e.message); }
    S.folderMsgs = S.folderMsgs.filter((m) => !(m.accountId === t.acc && m.folder === t.path));
  }
  if (S.selected && !findMessage(S.selected)) S.selected = null;
  toast(`${n} E-Mail${n === 1 ? '' : 's'} endgültig gelöscht`);
  renderAll();
}

async function removeAccount(a) {
  const ok = await confirmDialog({ title: `Konto ${a.email} entfernen?`, danger: true, ok: 'Entfernen',
    text: 'Das Konto wird aus SimpleMail (und über die Synchronisation auch auf deinen anderen Geräten) entfernt.<br>Die E-Mails bleiben auf dem Server erhalten.' });
  if (!ok) return false;
  await api.call('accounts:remove', a.id);
  scheduleSync(1500);
  S.accounts = S.accounts.filter((x) => x.id !== a.id);
  delete S.inbox[a.id]; delete S.folders[a.id];
  S.settings.snoozes = S.settings.snoozes.filter((s) => s.accountId !== a.id);
  if (S.settings.accountFilter === a.id) S.settings.accountFilter = null;
  saveSettings();
  if (S.view.acc === a.id) { S.view = { type: 'smart' }; S.folderMsgs = []; }
  const sel = findMessage(S.selected);
  if (!sel) S.selected = null;
  renderAll(); updateBadge();
  toast(`Konto ${a.email} entfernt`);
  return true;
}

function folderMenuItems(accId, path) {
  const f = folderEntry(accId, path);
  if (!f) return [];
  const system = SYSTEM_ROLES.includes(f.role);
  const items = [];
  if (f.selectable) items.push({ label: 'Alle als gelesen markieren', action: () => markFolderRead(accId, path) });
  items.push({ label: 'Schriftfarbe …', hint: folderColor(accId, path) ? '●' : '', action: (x, y) => folderColorMenu(accId, path, x, y) });
  if (['trash', 'junk'].includes(f.role)) {
    items.push({ label: f.role === 'trash' ? 'Papierkorb leeren …' : 'Spam-Ordner leeren …', danger: true,
      action: () => emptyFolders([{ acc: accId, path }], `„${f.name}“ leeren?`) });
  }
  items.push('-', { label: 'Neuer Unterordner …', action: () => createFolder(accId, path) });
  items.push({ label: 'Umbenennen …', disabled: system, action: () => renameFolder(accId, path) });
  items.push('-', { label: system ? 'Ordner löschen (Systemordner)' : 'Ordner löschen …', danger: !system, disabled: system,
    action: () => deleteFolder(accId, path) });
  return items;
}

function accountMenuItems(a) {
  return [
    { label: 'Alle als gelesen markieren', action: () => markFolderRead(a.id, 'INBOX') },
    { label: 'Neuer Ordner …', action: () => createFolder(a.id, null) },
    '-',
    { label: 'Konto bearbeiten …', action: () => openSettings({ account: a.id }) },
    { label: 'Konto entfernen …', danger: true, action: () => removeAccount(a).catch((e) => showError(e.message)) },
  ];
}

/** Menüeinträge für das angeklickte Element der Seitenleiste */
function sidebarMenuItems(target) {
  const accTitle = target.closest('[data-acc-title]');
  if (accTitle) {
    const a = findAccount(accTitle.dataset.accTitle);
    return a ? [{ label: 'Neuer Ordner …', action: () => createFolder(a.id, null) }, '-',
      { label: 'Konto entfernen …', danger: true, action: () => removeAccount(a).catch((e) => showError(e.message)) }] : [];
  }
  const item = target.closest('.side-item');
  if (!item) return [];
  if (item.dataset.folderAcc) return folderMenuItems(item.dataset.folderAcc, item.dataset.folderPath);
  if (item.dataset.act === 'account-filter') {
    if (!item.dataset.acc) {
      return [{ label: 'Alle als gelesen markieren', action: () => markListRead(allInbox().filter((m) => !isSnoozed(m))) }];
    }
    const a = findAccount(item.dataset.acc);
    return a ? accountMenuItems(a) : [];
  }
  if (item.dataset.act !== 'view') return [];
  const view = JSON.parse(item.dataset.view);
  const filter = accountFilter();
  const inView = (pred) => allInbox().filter((m) => !isSnoozed(m) && pred(m));
  switch (view.type) {
    case 'folder': return folderMenuItems(view.acc, view.path);
    case 'smart': case 'unread':
      return [{ label: 'Alle als gelesen markieren', action: () => markListRead(inView(() => true)) }];
    case 'category':
      return [{ label: 'Alle als gelesen markieren', action: () => markListRead(inView((m) => m.category === view.cat)) }];
    case 'flagged':
      return [{ label: 'Alle als gelesen markieren', action: () => markListRead(inView((m) => m.isFlagged)) },
        { label: 'Alle Markierungen entfernen', action: () => unflagList(inView((m) => m.isFlagged)) }];
    case 'snoozed': {
      const list = allInbox().filter(isSnoozed);
      return [{ label: 'Alle zurück in den Posteingang', disabled: !list.length, action: () => { for (const m of list) unsnooze(m); } }];
    }
    case 'scheduled':
      return [{ label: 'Alle geplanten E-Mails verwerfen …', danger: !!S.outbox.length, disabled: !S.outbox.length, action: async () => {
        const n = S.outbox.length;
        if (!await confirmDialog({ title: `${n} geplante E-Mail${n === 1 ? '' : 's'} verwerfen?`, text: 'Die E-Mails werden nicht gesendet.', ok: 'Verwerfen', danger: true })) return;
        for (const o of [...S.outbox]) await api.call('outbox:cancel', o.id).catch((e) => showError(e.message));
      } }];
    case 'contacts':
      return [{ label: 'Neuer Kontakt', action: () => showContacts(newContact().id) },
        { label: 'Kontakte importieren …', action: () => importContacts() },
        { label: 'Kontakte exportieren …', action: () => exportContacts() }];
    case 'sent': {
      const targets = roleTargets('sent');
      return [{ label: 'Alle als gelesen markieren', action: async () => { for (const t of targets) await markFolderRead(t.acc, t.path); } }];
    }
    case 'trash': {
      const targets = roleTargets('trash');
      return [{ label: 'Alle als gelesen markieren', action: async () => { for (const t of targets) await markFolderRead(t.acc, t.path); } },
        '-', { label: targets.length > 1 ? 'Papierkorb aller Konten leeren …' : 'Papierkorb leeren …', danger: true, disabled: !targets.length,
          action: () => emptyFolders(targets, targets.length > 1 ? 'Papierkorb aller Konten leeren?' : 'Papierkorb leeren?') }];
    }
    case 'spam': {
      const targets = S.accounts.filter((a) => !filter || a.id === filter)
        .map((a) => ({ acc: a.id, path: junkFolderOf(a.id) })).filter((t) => t.path);
      return [{ label: 'Alle als gelesen markieren', action: async () => { for (const t of targets) await markFolderRead(t.acc, t.path); } },
        '-', { label: targets.length > 1 ? 'Spam aller Konten leeren …' : 'Spam leeren …', danger: true, disabled: !targets.length,
          action: () => emptyFolders(targets, 'Spam leeren?') }];
    }
    default: return [];
  }
}

// =================================================================== Kalender

const fmtEvTime = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const fmtEvDay = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' });
const fmtEvLong = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function dayLabel(d) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const diff = Math.round((x - today) / 86400e3);
  if (diff <= 0) return 'Heute';
  if (diff === 1) return 'Morgen';
  return fmtEvDay.format(new Date(d));
}

/** „Do., 12. November 2026, 10:00–11:00“ */
function eventWhen(ev) {
  const s = new Date(ev.start);
  const e = new Date(ev.end);
  if (ev.allDay) {
    const last = new Date(e.getTime() - 1);
    return last.toDateString() === s.toDateString() ? `${fmtEvLong.format(s)}, ganztägig`
      : `${fmtEvLong.format(s)} – ${fmtEvLong.format(last)}`;
  }
  if (e.toDateString() === s.toDateString()) return `${fmtEvLong.format(s)}, ${fmtEvTime.format(s)}–${fmtEvTime.format(e)} Uhr`;
  return `${fmtEvLong.format(s)}, ${fmtEvTime.format(s)} – ${fmtEvLong.format(e)}, ${fmtEvTime.format(e)} Uhr`;
}

async function loadEvents(force = false) {
  const calConfigured = () => S.google.connected || (S.settings.calendar && S.settings.calendar.icsUrl);
  if (!calConfigured()) { S.events = null; renderCalendar(); return; }
  try {
    const r = await api.call('calendar:events', 14, force);
    S.events = r.configured ? r.events : null;
    S.eventsError = '';
  } catch (e) {
    S.eventsError = e.message;
    if (e.message && /abgelaufen|Neu anmelden/i.test(e.message)) { try { S.google = await api.call('google:status'); } catch { /* egal */ } }
  }
  renderCalendar();
  renderGoogleBanner();
}

// ---- 3.2.34: Erinnerung an die Google-Neuanmeldung (App im Google-Testmodus: Anmeldung gilt 7 Tage)
const G_SNOOZE_MS = 4 * 3600e3;
let gBannerSnoozed = 0;   // „Später“: bis zu diesem Zeitpunkt ausgeblendet (nur „läuft bald ab“)
let gReconnecting = false;

function fmtGoogleDue(t) {
  const d = new Date(t);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((day - today) / 86400e3);
  const time = `${fmtEvTime.format(d)} Uhr`;
  if (diff === 0) return `heute um ${time}`;
  if (diff === 1) return `morgen um ${time}`;
  return `${new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' }).format(d)} um ${time}`;
}

/** null | { kind: 'expired' } | { kind: 'soon', when } – Hinweis ab dem letzten der 7 Tage */
function googleReminder(now = Date.now()) {
  const g = S.google || {};
  if (!g.connected) return null;
  if (g.expired || (S.eventsError && /abgelaufen|Neu anmelden/i.test(S.eventsError))) return { kind: 'expired' };
  if (!g.remind || !g.expiresAt) return null;
  const warnFrom = g.expiresAt - (g.lifetime || 7 * 86400e3) / 7;   // 7 Tage → ab Tag 6
  if (now < warnFrom) return null;
  return { kind: 'soon', when: now >= g.expiresAt ? 'jetzt' : fmtGoogleDue(g.expiresAt) };
}

function renderGoogleBanner() {
  const el = $('#gBanner');
  if (!el) return;
  const r = googleReminder();
  const show = r && (r.kind === 'expired' || Date.now() >= gBannerSnoozed);
  el.classList.toggle('hidden', !show);
  document.body.style.setProperty('--gbanner-h', show ? '44px' : '0px');
  if (!show) { el.innerHTML = ''; el.dataset.kind = ''; return; }
  el.classList.toggle('expired', r.kind === 'expired');
  el.dataset.kind = r.kind;
  el.innerHTML = r.kind === 'expired'
    ? `<span>⚠</span><span class="msg"><b>Google-Kalender-Anmeldung abgelaufen</b> – Termine werden nicht mehr aktualisiert. Ein Klick genügt, Client-ID und Schlüssel sind gespeichert.</span>
       <button class="primary" data-act="g-reconnect"${gReconnecting ? ' disabled' : ''}>${icon('calendar')} Neu anmelden</button>`
    : `<span>⏰</span><span class="msg"><b>Google-Kalender-Anmeldung läuft ${esc(r.when)} ab</b> (Google-Testmodus: alle 7 Tage neu anmelden).</span>
       <button class="primary" data-act="g-reconnect"${gReconnecting ? ' disabled' : ''}>${icon('calendar')} Jetzt neu anmelden</button>
       <button class="btn" data-act="g-later" title="Für 4 Stunden ausblenden">Später</button>`;
  notifyGoogleReminder(r);
}

/** Einmalige Windows-Benachrichtigung je Anmeldung und Zustand */
function notifyGoogleReminder(r) {
  const key = `${S.google.connectedAt || 0}:${r.kind}`;
  let last = '';
  try { last = localStorage.getItem('simplemail.gNotified') || ''; } catch { /* egal */ }
  if (last === key) return;
  try { localStorage.setItem('simplemail.gNotified', key); } catch { /* egal */ }
  try {
    const n = new Notification('SimpleMail – Google Kalender', {
      body: r.kind === 'expired' ? 'Die Anmeldung ist abgelaufen. In SimpleMail auf „Neu anmelden“ klicken.'
        : `Die Anmeldung läuft ${r.when} ab. In SimpleMail auf „Jetzt neu anmelden“ klicken.`,
      silent: false,
    });
    n.onclick = () => window.focus();
  } catch { /* ohne Benachrichtigung */ }
}

async function refreshGoogleStatus(check = false) {
  try { S.google = await api.call(check ? 'google:check' : 'google:status'); } catch { /* offline */ }
  renderGoogleBanner();
}

function googleReconnect(btn) {
  if (gReconnecting) return;
  gReconnecting = true;
  document.querySelectorAll('[data-act="g-reconnect"],[data-x="g-reconnect"]').forEach((b) => { b.disabled = true; });
  toast('Browser geöffnet – bitte bei Google anmelden …');
  api.call('google:reconnect')
    .then(async (r) => {
      gReconnecting = false; gBannerSnoozed = 0;
      S.google = await api.call('google:status');
      S.events = null; S.eventsError = '';
      renderGoogleBanner(); renderCalendar(); loadEvents(true);
      if ($('#g-reconnect-box')) $('#g-reconnect-box').outerHTML = '';
      toast(`Google Kalender wieder verbunden${r && r.email ? ` (${r.email})` : ''}`);
    })
    .catch((err) => {
      gReconnecting = false;
      document.querySelectorAll('[data-act="g-reconnect"],[data-x="g-reconnect"]').forEach((b) => { b.disabled = false; });
      if (btn) btn.disabled = false;
      showError(err.message);
    });
}

// ---- Terminspalte rechts (14 Tage)
function renderCalendar() {
  const pane = $('#calPane');
  if (!pane) return;
  const open = !!S.settings.layout.calOpen;
  $('#app').classList.toggle('cal-open', open);
  $('#calToggle').classList.toggle('on', open);
  applyLayout();
  if (!open) return;
  let body = '';
  if (!S.settings.calendar.icsUrl && !S.google.connected) {
    body = `<div class="cal-empty">Noch kein Kalender verbunden.<br><br>
      <button class="btn" data-act="cal-setup">${icon('calendar')} Google Kalender verbinden</button></div>`;
  } else if (S.google.connected && (S.google.expired || (S.eventsError && /abgelaufen|Neu anmelden/i.test(S.eventsError)))) {
    body = `<div class="cal-empty">Die Google-Anmeldung ist abgelaufen (Google erlaubt im Testmodus 7 Tage).<br><br>
      <button class="btn" data-act="g-reconnect">${icon('calendar')} Neu anmelden</button></div>`;
  } else if (S.eventsError && !S.events) {
    body = `<div class="cal-empty">Kalender nicht erreichbar:<br>${esc(S.eventsError)}</div>`;
  } else if (!S.events) {
    body = '<div class="cal-empty">Wird geladen …</div>';
  } else if (!S.events.length) {
    body = '<div class="cal-empty">Keine Termine in den nächsten 14 Tagen.</div>';
  } else {
    const now = Date.now();
    let lastDay = '';
    for (const ev of S.events) {
      const s0 = new Date(ev.start);
      const dayKey = s0.toDateString();
      if (dayKey !== lastDay) {
        lastDay = dayKey;
        const lbl = dayLabel(s0);
        const isToday = lbl === 'Heute';
        body += `<div class="cal-day${isToday ? ' today' : ''}">${esc(lbl === 'Heute' || lbl === 'Morgen'
          ? `${lbl}, ${new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long' }).format(s0)}`
          : new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }).format(s0))}</div>`;
      }
      const past = new Date(ev.end).getTime() < now;
      const t = ev.allDay ? 'ganzt.' : fmtEvTime.format(s0);
      const loc = ev.meeting && ev.location && ev.location.includes(ev.meeting.url) ? ev.meeting.name : ev.location;
      const sub = [ev.allDay ? '' : `bis ${fmtEvTime.format(new Date(ev.end))}`, loc, ev.calendar].filter(Boolean).join(' · ');
      body += `<div class="cal-ev${ev.allDay ? ' allday' : ''}${past ? ' past' : ''}" data-act="ev-open" data-start="${esc(ev.start)}"
        ${ev.link ? `data-link="${esc(ev.link)}"` : ''}
        title="${esc(`${ev.summary}\n${eventWhen(ev)}${ev.location ? `\n${ev.location}` : ''}`)}">
        <span class="t">${esc(t)}</span><span class="bar"${ev.color ? ` style="background:${esc(ev.color)}"` : ''}></span>
        <span class="x"><b>${esc(ev.summary)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>${calJoin(ev, now)}</div>`;
    }
  }
  const gr = googleReminder();
  if (gr && gr.kind === 'soon') {
    body = `<div class="cal-warn">⏰ Google-Anmeldung läuft ${esc(gr.when)} ab.<br>
      <button class="btn small" data-act="g-reconnect">${icon('calendar')} Jetzt neu anmelden</button></div>${body}`;
  }
  pane.innerHTML = `<div class="cal-head"><h2>Termine</h2>
      <button class="icon-btn" data-act="meet-new" title="Neuer Termin / Online-Meeting (Strg+Umschalt+M)">＋</button>
      <button class="icon-btn" data-act="cal-reload" title="Neu laden">${icon('refresh')}</button>
      <button class="icon-btn" data-act="toggle-cal" title="Ausblenden">✕</button></div>
    <div class="cal-list">${body}</div>
    ${S.google.connected ? `<div class="cal-foot">Nächste 14 Tage · Google Kalender (${esc(S.google.email || 'verbunden')})${
      S.google.expiresAt && !S.google.expired ? `<br>Anmeldung gültig bis ${esc(fmtGoogleDue(S.google.expiresAt))}` : ''}</div>`
    : S.settings.calendar.icsUrl ? '<div class="cal-foot">Nächste 14 Tage · Google Kalender (nur lesen)</div>' : ''}`;
  // zu „Heute“ bzw. erstem kommenden Termin scrollen
  let first = pane.querySelector('.cal-ev:not(.past)');
  while (first && !first.classList.contains('cal-day')) first = first.previousElementSibling;
  if (first) first.scrollIntoView({ block: 'start' });
}

/** „Beitreten“ an Terminen mit Meeting-Link; hervorgehoben ab 15 Minuten vor Beginn */
function calJoin(ev, now) {
  if (!ev.meeting || !ev.meeting.url || new Date(ev.end).getTime() < now) return '';
  const soon = new Date(ev.start).getTime() - now < 15 * 60e3;
  return `<button class="${soon ? 'primary' : 'btn'} small cal-join" data-act="meet-join" data-url="${esc(ev.meeting.url)}"
    title="${esc(`${ev.meeting.name} beitreten`)}">${soon ? 'Beitreten' : '🎥'}</button>`;
}

function toggleCalendar() {
  S.settings.layout.calOpen = !S.settings.layout.calOpen;
  saveSettings({ sync: false });
  renderCalendar();
}

// ---- Spaltenbreiten
const LAYOUT_LIMITS = { side: [170, 420], list: [260, 760], cal: [220, 520] };
const LAYOUT_DEFAULT = { side: 250, list: 400, cal: 300 };

function applyLayout() {
  const L = S.settings.layout;
  const app = $('#app');
  // Bei schmalem Fenster Spalten vorübergehend verkleinern, damit der Lesebereich sichtbar bleibt
  let side = L.side, list = L.list, cal = L.calOpen ? L.cal : 0;
  let over = side + list + cal + 15 + 260 - window.innerWidth;
  const shrink = (w, min) => { const d = Math.min(Math.max(0, over), w - min); over -= d; return w - d; };
  if (over > 0) list = shrink(list, LAYOUT_LIMITS.list[0]);
  if (over > 0 && cal) cal = shrink(cal, LAYOUT_LIMITS.cal[0]);
  if (over > 0) side = shrink(side, LAYOUT_LIMITS.side[0]);
  app.style.setProperty('--w-side', `${side}px`);
  app.style.setProperty('--w-list', `${list}px`);
  app.style.setProperty('--cal-cols', L.calOpen ? `5px ${cal}px` : '0px 0px');
}
window.addEventListener('resize', () => { if (S.settings && S.settings.layout) applyLayout(); });

function initSplitters() {
  for (const sp of document.querySelectorAll('.splitter')) {
    const key = sp.dataset.split;
    sp.addEventListener('dblclick', () => {
      S.settings.layout[key] = LAYOUT_DEFAULT[key];
      applyLayout();
      saveSettings({ sync: false });
    });
    sp.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const startX = e.clientX;
      const startW = S.settings.layout[key];
      const [min, max] = LAYOUT_LIMITS[key];
      sp.classList.add('dragging');
      document.body.classList.add('resizing');
      const move = (ev) => {
        const dx = ev.clientX - startX;
        // Terminspalte liegt rechts vom Griff → Ziehen nach links macht sie breiter
        let w = key === 'cal' ? startW - dx : startW + dx;
        w = Math.max(min, Math.min(max, w));
        // Lesebereich nicht zu schmal werden lassen
        const L = S.settings.layout;
        const others = (key === 'side' ? 0 : L.side) + (key === 'list' ? 0 : L.list) + (L.calOpen && key !== 'cal' ? L.cal : 0);
        w = Math.min(w, window.innerWidth - others - 340);
        S.settings.layout[key] = Math.round(Math.max(min, w));
        applyLayout();
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        sp.classList.remove('dragging');
        document.body.classList.remove('resizing');
        saveSettings({ sync: false });
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }
}

function eventsSidebar() {
  if (!S.events && !S.eventsError) return '';
  let html = '<div class="side-title"><span class="grow">Termine</span></div>';
  if (S.eventsError && !S.events) return `${html}<div class="ev-empty" title="${esc(S.eventsError)}">Kalender nicht erreichbar</div>`;
  const now = Date.now();
  const list = S.events.filter((e) => new Date(e.end).getTime() > now).slice(0, 6);
  if (!list.length) return `${html}<div class="ev-empty">Keine Termine in den nächsten 7 Tagen</div>`;
  for (const ev of list) {
    const s = new Date(ev.start);
    const time = ev.allDay ? 'ganztägig' : fmtEvTime.format(s);
    html += `<div class="side-item ev-item" data-act="ev-open" data-start="${esc(ev.start)}"
      title="${esc(`${ev.summary}\n${eventWhen(ev)}${ev.location ? `\n${ev.location}` : ''}`)}">
      ${icon('calendar')}<span class="label"><span class="ev-title">${esc(ev.summary)}</span>
      <span class="ev-time">${esc(dayLabel(s))} · ${esc(time)}</span></span></div>`;
  }
  return html;
}

/** Karte für Einladungen in der Leseansicht */
function inviteCard(m, body) {
  const inv = body.invite;
  if (!inv || !inv.event || !inv.event.start) return '';
  const ev = inv.event;
  const method = inv.method;
  const mine = S.accounts.map((a) => a.email.toLowerCase());
  const meAtt = (ev.attendees || []).find((x) => mine.includes(String(x.email).toLowerCase()));
  const answered = S.inviteAnswers[keyOf(m)] || (meAtt && meAtt.partstat !== 'NEEDS-ACTION' ? meAtt.partstat : '');
  const WORD = { ACCEPTED: 'zugesagt', TENTATIVE: 'mit Vorbehalt zugesagt', DECLINED: 'abgelehnt' };
  let head = 'Einladung';
  let actions = '';
  if (method === 'CANCEL') head = 'Termin abgesagt';
  else if (method === 'REPLY') {
    const a = (ev.attendees || [])[0];
    head = a ? `${a.name || a.email} hat ${WORD[a.partstat] || 'geantwortet'}` : 'Antwort auf Einladung';
  } else if (method === 'REQUEST' && ev.organizer && ev.organizer.email) {
    actions = `<div class="inv-actions">
      <button class="btn${answered === 'ACCEPTED' ? ' chosen' : ''}" data-act="inv-reply" data-ps="ACCEPTED">✓ Zusagen</button>
      <button class="btn${answered === 'TENTATIVE' ? ' chosen' : ''}" data-act="inv-reply" data-ps="TENTATIVE">? Vielleicht</button>
      <button class="btn${answered === 'DECLINED' ? ' chosen' : ''}" data-act="inv-reply" data-ps="DECLINED">✕ Absagen</button>
      <span class="sep"></span>
      <button class="btn" data-act="inv-google" title="${S.google.connected ? 'Direkt in Google Kalender eintragen' : 'Öffnet Google Kalender mit vorausgefülltem Termin'}">${icon('calendar')} In Google Kalender</button></div>
      ${answered ? `<div class="inv-state">Du hast ${esc(WORD[answered] || answered)}.</div>` : ''}`;
  } else {
    actions = `<div class="inv-actions"><button class="btn" data-act="inv-google">${icon('calendar')} In Google Kalender übernehmen</button></div>`;
  }
  const meet = ev.meeting && method !== 'CANCEL' ? ev.meeting : null;
  const people = (ev.attendees || []).slice(0, 8).map((a) => a.name || a.email).join(', ');
  return `<div class="invite${method === 'CANCEL' ? ' cancelled' : ''}">
    <div class="inv-date"><span class="inv-mon">${esc(new Intl.DateTimeFormat('de-DE', { month: 'short' }).format(new Date(ev.start)))}</span>
      <span class="inv-day">${new Date(ev.start).getDate()}</span></div>
    <div class="inv-body"><div class="inv-kind">${esc(head)}</div>
      <div class="inv-title">${esc(ev.summary)}</div>
      <div class="inv-line">${esc(eventWhen(ev))}</div>
      ${ev.location && !(meet && ev.location.includes(meet.url)) ? `<div class="inv-line">📍 ${esc(ev.location)}</div>` : ''}
      ${meet ? meetingLine(meet) : ''}
      ${ev.organizer && ev.organizer.email ? `<div class="inv-line">Organisator: ${esc(ev.organizer.name || ev.organizer.email)}</div>` : ''}
      ${people ? `<div class="inv-line muted">Teilnehmer: ${esc(people)}${ev.attendees.length > 8 ? ' …' : ''}</div>` : ''}
      ${actions}</div></div>`;
}

/** Zeile „🎥 Microsoft Teams  [Beitreten] [Link kopieren]“ */
function meetingLine(meet) {
  return `<div class="inv-line meet-line"><span class="meet-badge meet-${esc(meet.provider)}">🎥 ${esc(meet.name)}</span>
    <button class="primary small" data-act="meet-join" data-url="${esc(meet.url)}" title="${esc(meet.url)}">Beitreten</button>
    <button class="btn small" data-act="meet-copy" data-url="${esc(meet.url)}">Link kopieren</button></div>`;
}

/** Mail ohne Einladung, aber mit Meeting-Link im Text */
function meetingBanner(body) {
  if (!body.meeting || (body.invite && body.invite.event && body.invite.event.start)) return '';
  const meet = body.meeting;
  return `<div class="banner info-banner meet-banner"><span>🎥</span><span>Online-Meeting-Link (${esc(meet.name)}) in dieser E-Mail</span>
    <button class="primary small" data-act="meet-join" data-url="${esc(meet.url)}" title="${esc(meet.url)}">Beitreten</button>
    <button class="btn small" data-act="ev-new">${icon('calendar')} Termin anlegen</button></div>`;
}

/** Termin in Google Kalender: direkt eintragen (wenn verbunden) oder Browser-Vorlage */
async function saveToGoogle(ev) {
  try {
    const r = await api.call('calendar:openGoogle', ev);
    if (r && r.created) { toast('In Google Kalender eingetragen'); loadEvents(true); }
  } catch (e) { showError(e.message); }
}

const MEETING_CHOICES = [
  ['none', 'Kein Online-Meeting'], ['teams', 'Microsoft Teams'], ['zoom', 'Zoom'], ['meet', 'Google Meet'],
  ['webex', 'Webex'], ['jitsi', 'Jitsi Meet (Link automatisch, ohne Konto)'], ['other', 'Anderer Link'],
];
const MEETING_SITES = {
  teams: 'https://teams.microsoft.com/v2/', zoom: 'https://zoom.us/meeting/schedule', webex: 'https://signin.webex.com/',
  meet: 'https://meet.google.com/',
};
const meetingLinks = () => ({ teams: '', zoom: '', webex: '', meet: '', default: 'none', ...(S.settings.meetingLinks || {}) });

/**
 * Termin anlegen – optional als Online-Meeting mit Einladung an Teilnehmer.
 * Ohne Teilnehmer: nur in den eigenen Kalender (wie bisher „Termin aus E-Mail“).
 */
function openEventDialog(m, preset = {}) {
  const body = m ? S.bodies[keyOf(m)] : null;
  const start = new Date(); start.setDate(start.getDate() + 1); start.setHours(10, 0, 0, 0);
  const text = body ? String(body.text || '').trim().slice(0, 1200) : '';
  const links = meetingLinks();
  const found = body && body.meeting ? body.meeting : null;
  let provider = preset.provider || (found ? (MEETING_CHOICES.some(([id]) => id === found.provider) ? found.provider : 'other') : links.default || 'none');
  const accOptions = S.accounts.map((a) => `<option value="${esc(a.id)}" ${m && a.id === m.accountId ? 'selected' : ''}>${esc(a.displayName ? `${a.displayName} <${a.email}>` : a.email)}</option>`).join('');
  const { el, close } = openOverlay(`<div class="dialog meeting-dialog" style="width:520px">
    <div class="dialog-head">${icon('calendar')} ${m ? 'Termin aus E-Mail' : 'Neuer Termin / Online-Meeting'}</div>
    <div class="form-grid" style="padding:16px 18px">
      <label>Titel</label><input id="ev-title" value="${esc(preset.title != null ? preset.title : (m ? m.subject || '' : ''))}">
      <label>Beginn</label><input type="datetime-local" id="ev-start" value="${toLocalInput(start)}">
      <label>Dauer</label><select id="ev-dur"><option value="15">15 Minuten</option><option value="30">30 Minuten</option><option value="45">45 Minuten</option><option value="60" selected>1 Stunde</option>
        <option value="90">1,5 Stunden</option><option value="120">2 Stunden</option><option value="240">4 Stunden</option><option value="allday">ganztägig</option></select>
      <label>Online-Meeting</label><select id="ev-prov">${MEETING_CHOICES.map(([id, l]) => `<option value="${id}" ${id === provider ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <label class="ev-link-row">Meeting-Link</label><div class="ev-link-row" style="display:flex;gap:6px">
        <input id="ev-link" style="flex:1" placeholder="https://…" value="${esc(found ? found.url : '')}">
        <button class="btn" data-x="site" id="ev-site" title="Seite des Anbieters öffnen, um ein Meeting anzulegen – Link dann hier einfügen">Anlegen …</button></div>
      <div class="ev-link-row"></div><div class="hint-text ev-link-row" id="ev-link-hint" style="margin:0"></div>
      ${S.accounts.length > 1 ? `<label>Von</label><select id="ev-from">${accOptions}</select>` : ''}
      <label>Teilnehmer</label><div style="position:relative"><input id="ev-to" autocomplete="off" placeholder="leer = nur in meinen Kalender" value="${esc(preset.to || '')}">
        <div class="suggest hidden" data-for="ev-to"></div></div>
      ${m ? `<div></div><div><button class="btn small" data-x="add-sender">+ ${esc(sender(m))} einladen</button></div>` : ''}
      <label>Ort</label><input id="ev-loc" placeholder="optional">
      <label>Notiz</label><textarea id="ev-notes" rows="4">${esc(m ? `E-Mail von ${sender(m)} <${m.fromAddress}>\n\n${text}` : '')}</textarea>
      <div></div><label class="check"><input type="checkbox" id="ev-save" style="width:auto" checked> ${S.google.connected ? `In Google Kalender (${esc(S.google.email)}) eintragen` : 'In Google Kalender eintragen (öffnet den Browser)'}</label>
    </div>
    <div class="err hidden" id="ev-err" style="margin:0 18px"></div>
    <div class="dialog-foot"><span class="spinner hidden" id="ev-spin"></span><span class="grow"></span>
      <button class="btn" data-x="cancel">Abbrechen</button>
      <button class="primary" data-x="ok" id="ev-ok"></button></div></div>`);
  const $e = (sel) => $(sel, el);
  const setErr = (msg) => { const x = $e('#ev-err'); x.textContent = msg || ''; x.classList.toggle('hidden', !msg); };
  const update = () => {
    provider = $e('#ev-prov').value;
    const needLink = provider !== 'none';
    el.querySelectorAll('.ev-link-row').forEach((x) => { x.style.display = needLink ? '' : 'none'; });
    const linkEl = $e('#ev-link');
    const hint = {
      teams: 'Teams-Link einfügen (Teams → Kalender → „Neue Besprechung“ bzw. „Jetzt besprechen“ → Link kopieren) oder unter Einstellungen → Kalender einen festen Link hinterlegen.',
      zoom: 'Zoom-Link einfügen – z. B. dein persönlicher Meetingraum (zoom.us/j/…), einstellbar unter Einstellungen → Kalender.',
      webex: 'Webex-Link einfügen – z. B. dein persönlicher Raum (firma.webex.com/meet/name).',
      meet: S.google.connected ? 'Leer lassen: SimpleMail legt über Google Kalender automatisch einen neuen Meet-Link an.' : 'Meet-Link einfügen (meet.google.com → „Neue Videokonferenz“) oder Google Kalender verbinden – dann entsteht der Link automatisch.',
      jitsi: 'Leer lassen: SimpleMail erzeugt einen Jitsi-Raum (meet.jit.si) – Teilnehmer brauchen kein Konto.',
      other: 'Beliebiger https-Link zum Meeting.',
    }[provider] || '';
    $e('#ev-link-hint').textContent = hint;
    $e('#ev-site').style.display = MEETING_SITES[provider] ? '' : 'none';
    if (needLink && !linkEl.value.trim() && links[provider]) linkEl.value = links[provider];
    linkEl.placeholder = provider === 'jitsi' || (provider === 'meet' && S.google.connected) ? 'wird automatisch erzeugt' : 'https://…';
    const invite = $e('#ev-to').value.trim();
    $e('#ev-ok').innerHTML = invite ? `${icon('send')} Einladung senden` : `${icon('calendar')} ${S.google.connected ? 'In Google Kalender eintragen' : 'In Google Kalender öffnen'}`;
  };
  update();
  $e('#ev-title').focus();
  el.addEventListener('change', (e) => { if (e.target.id === 'ev-prov') { $e('#ev-link').value = ''; update(); } });
  // Teilnehmer: Adressvorschläge
  {
    const input = $e('#ev-to');
    const box = $e('.suggest[data-for="ev-to"]');
    let hits = [];
    input.addEventListener('input', () => {
      update();
      hits = suggestions(input.value);
      box.classList.toggle('hidden', !hits.length);
      box.innerHTML = hits.map((c, i) => `<div class="sg" data-i="${i}">${c.name ? `<b>${esc(c.name)}</b>` : ''}<span class="em">${esc(c.email)}</span></div>`).join('');
    });
    input.addEventListener('blur', () => setTimeout(() => box.classList.add('hidden'), 150));
    box.addEventListener('mousedown', (e) => {
      const sg = e.target.closest('.sg');
      if (!sg || !hits[Number(sg.dataset.i)]) return;
      e.preventDefault();
      input.value = completing(input.value, hits[Number(sg.dataset.i)]);
      box.classList.add('hidden');
      update();
    });
  }
  el.addEventListener('click', async (e) => {
    const x = e.target.closest('[data-x]');
    if (!x) return;
    if (x.dataset.x === 'cancel') { close(); return; }
    if (x.dataset.x === 'site') { if (MEETING_SITES[provider]) api.call('app:openExternal', MEETING_SITES[provider]); return; }
    if (x.dataset.x === 'add-sender' && m) {
      const input = $e('#ev-to');
      const me = contactDisplay({ name: sender(m), email: m.fromAddress });
      if (!input.value.toLowerCase().includes(m.fromAddress.toLowerCase())) input.value = input.value.trim() ? `${input.value.replace(/[,;\s]+$/, '')}, ${me}` : me;
      update();
      return;
    }
    if (x.dataset.x !== 'ok') return;
    setErr('');
    const s = new Date($e('#ev-start').value);
    if (Number.isNaN(s.getTime())) { setErr('Bitte einen Beginn wählen.'); return; }
    const dur = $e('#ev-dur').value;
    const allDay = dur === 'allday';
    if (allDay) s.setHours(0, 0, 0, 0);
    const endD = allDay ? new Date(s.getTime() + 86400e3) : new Date(s.getTime() + Number(dur) * 60e3);
    let link = $e('#ev-link').value.trim();
    if (link && !/^https:\/\//i.test(link)) { setErr('Der Meeting-Link muss mit https:// beginnen.'); return; }
    if (provider === 'none') link = '';
    const to = $e('#ev-to').value.trim();
    const saveCal = $e('#ev-save').checked;
    if (!to) {
      // nur eigener Kalender
      if (provider !== 'none' && !link && provider === 'jitsi') link = `https://meet.jit.si/SimpleMail-${Math.random().toString(36).slice(2, 12)}`;
      if (provider !== 'none' && !link) { setErr(provider === 'meet' ? 'Ohne Teilnehmer bitte einen Meet-Link eintragen.' : 'Bitte den Meeting-Link eintragen.'); return; }
      const meeting = link ? ({ provider, name: (MEETING_CHOICES.find(([id]) => id === provider) || [0, 'Online-Meeting'])[1].replace(/ \(.*$/, ''), url: link }) : null;
      if (saveCal) {
        saveToGoogle({ summary: $e('#ev-title').value, start: s.toISOString(), end: endD.toISOString(), allDay,
          location: $e('#ev-loc').value, description: $e('#ev-notes').value, meeting });
      }
      close();
      return;
    }
    $e('#ev-spin').classList.remove('hidden');
    x.disabled = true;
    try {
      const r = await api.call('calendar:invite', {
        accountId: ($e('#ev-from') && $e('#ev-from').value) || (m && m.accountId) || (S.accounts[0] && S.accounts[0].id),
        to, summary: $e('#ev-title').value, start: s.toISOString(), end: endD.toISOString(), allDay,
        location: $e('#ev-loc').value, description: $e('#ev-notes').value,
        provider, meetingUrl: link, saveToCalendar: saveCal,
      });
      close();
      toast(`Einladung an ${r.attendees} ${r.attendees === 1 ? 'Teilnehmer' : 'Teilnehmer'} gesendet${r.savedToCalendar ? ' und in Google Kalender eingetragen' : ''}`);
      if (r.savedToCalendar) loadEvents(true);
      refresh();
    } catch (err) {
      setErr(err.message);
      x.disabled = false;
    }
    $e('#ev-spin').classList.add('hidden');
  });
}

function setListLines(n) {
  S.settings.listLines = n;
  saveSettings({ sync: false });
  api.call('app:setListLines', n).catch(() => {});
  renderList();
}

/** „Max Muster <max@x.de>, b@y.de“ → „Max Muster, b@y.de“ */
function recipientNames(to) {
  return String(to).split(',').map((x) => x.trim()).filter(Boolean)
    .map((x) => { const mm = /^"?([^"<]*?)"?\s*<([^>]+)>$/.exec(x); return mm ? (mm[1].trim() || mm[2]) : x; }).join(', ');
}

function rowHtml(m) {
  const k = keyOf(m);
  const lines = S.settings.listLines || 2;
  const until = snoozeUntil(m);
  const meta = [];
  if (until) meta.push(`<span class="snz">⏰ ${esc(fmtWeekday.format(until))}</span>`);
  const multiAcc = S.accounts.length > 1;
  const accCol = multiAcc ? accountColor(findAccount(m.accountId)) : '';
  const fLabel = S.searchResults ? folderLabelOf(m) : '';
  if (fLabel) meta.push(`<span class="folder-tag" title="Ordner">📁 ${esc(fLabel)}</span>`);
  if (multiAcc) meta.push(`<span class="acc-tag"><span class="acc-dot" style="background:${accCol}"></span>${esc(accountLabel(m.accountId))}</span>`);
  const subjectText = esc(m.subject || '(Kein Betreff)');
  // 3.2.36: in Gesendet die Empfänger statt des eigenen Namens
  const role = folderRole(m);
  const who = role === 'drafts' ? `Entwurf${m.to ? ` an ${recipientNames(m.to)}` : ''}`
    : role === 'sent' && m.to ? `An: ${recipientNames(m.to)}` : sender(m);
  const isSel = S.multi.size > 1 ? S.multi.has(k) : S.selected === k;
  return `<div class="row lines-${lines}${m.isRead ? '' : ' unread'}${isSel ? ' selected' : ''}" data-act="select" data-key="${esc(k)}" draggable="true">
    ${accCol ? `<span class="acc-stripe" style="background:${accCol}" title="${esc(accountLabel(m.accountId))}"></span>` : ''}
    ${m.isRead ? '' : '<span class="dot" title="Ungelesen"></span>'}
    ${lines === 1 ? '' : avatar(sender(m))}
    <div class="row-main">
      <div class="row-top">
        <span class="from"${who === sender(m) ? colorStyle(contactColor(m.fromAddress)) : ''}>${esc(who)}</span>
        ${lines === 1 ? `<span class="subject-inline">${subjectText}</span>` : ''}
        ${m.hasAttachment ? icon('clip') : ''}
        ${m.isFlagged ? `<span class="flag">${icon('flag')}</span>` : ''}
        ${fLabel && lines === 1 ? `<span class="folder-tag">📁 ${esc(fLabel)}</span>` : ''}
        <span class="date">${esc(listDate(m.date))}</span>
      </div>
      ${lines === 1 ? '' : `<div class="subject">${subjectText}</div>`}
      ${lines === 3 ? `<div class="preview">${m.preview ? esc(m.preview) : '&nbsp;'}</div>` : ''}
      ${meta.length && lines !== 1 ? `<div class="meta">${meta.join('')}</div>` : ''}
    </div>
    <div class="row-actions">
      <button data-act="row-read" data-key="${esc(k)}" title="${m.isRead ? 'Als ungelesen markieren' : 'Als gelesen markieren'}">${icon(m.isRead ? 'unread' : 'read')}</button>
      ${m.folder === 'INBOX' ? `<button data-act="row-snooze" data-key="${esc(k)}" title="Später erinnern">${icon('clock')}</button>` : ''}
      <button data-act="row-archive" data-key="${esc(k)}" title="Archivieren (E)">${icon('archive')}</button>
      <button data-act="row-delete" data-key="${esc(k)}" title="Löschen (Entf)">${icon('trash')}</button>
    </div>
  </div>`;
}

function renderSortButton() {
  const b = $('#sortToggle');
  if (!b) return;
  const asc = !!S.settings.sortAsc;
  b.innerHTML = icon(asc ? 'sortAsc' : 'sortDesc');
  b.title = asc ? 'Sortierung: älteste oben – klicken für neueste oben' : 'Sortierung: neueste oben – klicken für älteste oben';
}

// Zuletzt gezeigte Liste (je Eintrag Schlüssel + HTML) – Grundlage für das Nachführen einzelner Zeilen
let listParts = null;

function renderList() {
  renderSortButton();
  const el = $('#list');
  if (S.view.type === 'scheduled') { listParts = null; el.innerHTML = scheduledHtml(); return; }
  if (S.view.type === 'contacts') { listParts = null; el.innerHTML = contactsListHtml(); return; }
  const vis = visibleMessages();
  const parts = [];
  const rows = (list) => { for (const m of list) parts.push({ k: keyOf(m), h: rowHtml(m) }); };
  if (S.searchResults) {
    parts.push({ k: 'g:suche', h: `<div class="group">🔍 ${S.searching ? 'Suche' : 'Suchergebnisse'} ${S.view.type === 'folder' ? 'in diesem Ordner' : 'in allen Ordnern'}${S.searching ? ' …' : ''} (${vis.length})</div>` });
    rows(vis);
  } else if (S.view.type === 'smart' && !S.search) {
    const byCat = new Map(CATEGORIES.map((c) => [c.id, []]));
    for (const m of vis) { const arr = byCat.get(m.category); if (arr) arr.push(m); }
    for (const id of SMART_ORDER) {
      const c = CATEGORIES.find((x) => x.id === id);
      const items = byCat.get(id);
      if (!items.length) continue;
      if (COLLAPSIBLE.includes(id)) {
        const open = S.expandedGroups.has(id);
        const unread = items.filter((m) => !m.isRead).length;
        parts.push({ k: `g:${id}:${open ? 'auf' : 'zu'}`, h: `<div class="group group-toggle${open ? ' open' : ''}" data-act="toggle-group" data-cat="${id}" title="${open ? 'Einklappen' : 'Aufklappen'}">
          <span class="chev">${open ? '▾' : '▸'}</span>${icon(c.icon)}<span class="gtitle">${esc(c.title)}</span>
          ${unread ? `<span class="gnew">${unread} neu</span>` : ''}<span class="gcount">${items.length}</span></div>` });
        if (open) rows(items);
      } else {
        parts.push({ k: `g:${id}`, h: `<div class="group">${esc(c.title)} (${items.length})</div>` });
        rows(items);
      }
    }
  } else {
    if (S.view.type === 'folder') {
      const f = (S.folders[S.view.acc] || []).find((x) => x.path === S.view.path);
      if (f) parts.push({ k: 'g:ordner', h: `<div class="group">${esc(f.name)} · ${esc(findAccount(S.view.acc)?.email || '')}</div>` });
    } else if (S.view.type === 'sent' || S.view.type === 'trash' || S.view.type === 'drafts') {
      const f = accountFilter();
      const title = { sent: 'Gesendet', trash: 'Papierkorb', drafts: 'Entwürfe' }[S.view.type];
      parts.push({ k: `g:${S.view.type}`, h: `<div class="group">${title} · ${f ? esc(findAccount(f)?.email || '') : 'alle Konten'}</div>` });
    }
    rows(vis);
  }
  if (!vis.length && !S.loading && !S.searching && S.accounts.length) {
    parts.push({ k: 'leer', h: `<div class="empty">${S.view.type === 'snoozed' ? 'Keine zurückgestellten E-Mails' : 'Keine E-Mails'}</div>` });
  }
  if (canLoadMore()) {
    parts.push({ k: 'mehr', h: `<div class="load-more"><button class="btn" data-act="load-more" ${S.loading ? 'disabled' : ''}>Ältere E-Mails laden</button></div>` });
  }
  patchList(el, parts);
}

/**
 * Liste aktualisieren, ohne sie jedes Mal komplett neu aufzubauen: Sind Reihenfolge und Einträge gleich
 * (z. B. Mail geöffnet, gelesen, markiert, Auswahl gewechselt), werden nur die geänderten Zeilen ersetzt.
 * Vorher wurde bei jedem Klick die ganze Liste (Tausende Zeilen) neu erzeugt.
 */
function patchList(el, parts) {
  const old = listParts;
  const sameShape = old && old.length === parts.length && el.children.length === parts.length &&
    old.every((p, i) => p.k === parts[i].k);
  if (sameShape) {
    for (let i = 0; i < parts.length; i++) {
      if (old[i].h === parts[i].h) continue;
      const t = document.createElement('template');
      t.innerHTML = parts[i].h;
      const fresh = t.content.firstElementChild;
      if (fresh) el.children[i].replaceWith(fresh);
    }
  } else {
    const scroll = el.scrollTop;
    el.innerHTML = parts.map((p) => p.h).join('');
    el.scrollTop = scroll;
  }
  listParts = parts;
}

function scheduledHtml() {
  if (!S.outbox.length) {
    return '<div class="empty">Keine geplanten E-Mails<small>Beim Verfassen über „Später senden“ planen.</small></div>';
  }
  return S.outbox.map((o) => `<div class="row">
      <div class="row-main">
        <div class="row-top"><span class="from">${esc(o.subject || '(Kein Betreff)')}</span>
          <span class="date">${esc(fmtWeekday.format(new Date(o.sendAt)))}</span></div>
        <div class="subject">An: ${esc(o.toDisplay)}</div>
        <div class="meta"><span>${esc(accountLabel(o.accountId))}</span>${o.lastError ? `<span style="color:var(--danger)">Fehler: ${esc(o.lastError)}</span>` : ''}</div>
      </div>
      <div class="row-actions" style="display:flex;position:static;box-shadow:none">
        <button data-act="outbox-send" data-id="${esc(o.id)}" title="Jetzt senden">${icon('send')}</button>
        <button data-act="outbox-cancel" data-id="${esc(o.id)}" title="Löschen">${icon('trash')}</button>
      </div>
    </div>`).join('') + '<div class="empty" style="padding:20px"><small>SimpleMail muss zum Sendezeitpunkt geöffnet sein.</small></div>';
}

function renderStatus() {
  const el = $('#status');
  let html = '';
  if (S.loading || S.searching) html += `<div class="info">${S.searching ? 'Suche läuft …' : 'Abrufen …'}</div>`;
  if (S.offline && !S.loading) html += '<div class="info">⚡ Offline – gespeicherte E-Mails werden angezeigt</div>';
  if (S.error) html += `<div class="err"><span>⚠ ${esc(S.error)}</span><button class="icon-btn" data-act="dismiss-error">✕</button></div>`;
  el.innerHTML = html;
}

let detailSig = '';
function renderDetail(force = false) {
  const el = $('#detail');
  if (S.view.type === 'contacts') {
    detailSig = '';
    // Während im Kontaktformular getippt wird, das Formular nicht neu aufbauen (sonst springt der Cursor bzw. Eingaben gehen verloren)
    const form = el.querySelector('.contact-form');
    if (!force && form && form.dataset.id === S.selContact && findContact(S.selContact) && form.contains(document.activeElement)) {
      const c = findContact(S.selContact);
      const h = form.querySelector('h3');
      if (h) h.textContent = contactTitle(c);
      for (const f of form.querySelectorAll('[data-f]')) {
        if (f === document.activeElement) continue;
        const k = f.dataset.f;
        const v = k === 'emails' || k === 'phones' ? (c[k] || []).join('\n') : (c[k] || '');
        const cur = k === 'emails' || k === 'phones' ? f.value.split(/\n|,|;/).map((x) => x.trim()).filter(Boolean).join('\n') : f.value;
        if (cur !== v) f.value = v;
      }
      return;
    }
    el.innerHTML = contactDetailHtml();
    return;
  }
  if (multiActive()) {
    detailSig = '';
    el.innerHTML = bulkPanel();
    return;
  }
  const m = findMessage(S.selected);
  if (!m) {
    detailSig = '';
    el.innerHTML = `<div class="placeholder"><div style="text-align:center">${icon('mail')}<div>Keine E-Mail ausgewählt</div></div></div>`;
    return;
  }
  const k = keyOf(m);
  const body = S.bodies[k];
  const allow = remoteAllowed(m);
  const until = snoozeUntil(m);
  const sig = [k, !!body, allow, m.isFlagged, until ? until.getTime() : 0, body ? body.cc : '', S.inviteAnswers[k] || ''].join('#');
  if (!force && sig === detailSig) return;
  detailSig = sig;

  const acc = findAccount(m.accountId);
  let html = `<div class="detail-bar">
    ${isDraftMsg(m) ? `<button class="primary" data-act="edit-draft" title="Entwurf weiterschreiben (Enter / Doppelklick)">${icon('drafts')} Entwurf bearbeiten</button><span class="sep"></span>` : ''}
    <button class="btn" data-act="reply" title="Antworten (Strg+R)">${icon('reply')} Antworten</button>
    <button class="btn" data-act="reply-all" title="Allen antworten (Strg+Umschalt+R)">${icon('replyAll')}</button>
    <button class="btn" data-act="forward" title="Weiterleiten (Strg+Umschalt+F)">${icon('forward')}</button>
    <span class="sep"></span>
    ${m.folder === 'INBOX' ? `<button class="btn" data-act="snooze-menu" title="Später erinnern">${icon('clock')} Später</button>` : ''}
    <button class="btn" data-act="flag" title="Markieren">${icon('flag')}${m.isFlagged ? ' Markiert' : ''}</button>
    <button class="btn" data-act="archive" title="Archivieren (E)">${icon('archive')}</button>
    <button class="btn" data-act="move-menu" title="In Ordner verschieben (V)">${icon('folder')} Verschieben</button>
    <button class="btn" data-act="ct-from-mail" title="Absender mit Telefon und Adresse aus der Signatur in die Kontakte übernehmen">${icon('person')}${contactByEmail(m.fromAddress) ? ' Kontakt ergänzen' : ' Zu Kontakten'}</button>
    ${folderRole(m) === 'junk'
    ? '<button class="btn" data-act="not-spam" title="Kein Spam – zurück in den Posteingang">✓ Kein Spam</button>'
    : `<button class="btn" data-act="spam-menu" title="Als Spam markieren">${icon('junk')} Spam</button>`}
    <button class="btn danger" data-act="delete" title="Löschen (Entf)">${icon('trash')}</button>
    <span class="sep"></span>
    <button class="btn" data-act="ev-new" title="Termin aus dieser E-Mail anlegen">${icon('calendar')} Termin</button>
    <button class="btn" data-act="print" title="Drucken oder als PDF speichern (Strg+P)">${icon('print')}</button>
    <button class="btn" data-act="open-window" title="In eigenem Fenster öffnen (Enter / Doppelklick)">${icon('window')}</button>
  </div>
  <div class="detail-head">
    <h1>${esc(m.subject || '(Kein Betreff)')}</h1>
    <div class="sender">
      ${avatar(sender(m), true)}
      <div class="who">
        <div><span class="name"${colorStyle(contactColor(m.fromAddress))}>${esc(sender(m))}</span> <span class="addr">&lt;<a href="#" class="mail-addr" data-act="mailto" data-url="mailto:${esc(m.fromAddress)}" title="E-Mail an ${esc(m.fromAddress)} schreiben">${esc(m.fromAddress)}</a>&gt;</span></div>
        ${m.to ? `<div class="line">An: ${linkAddrs(m.to)}</div>` : ''}
        ${body && body.cc ? `<div class="line">Cc: ${linkAddrs(body.cc)}</div>` : ''}
        ${S.accounts.length > 1 && acc ? `<div class="line">Konto: <span class="acc-dot" style="background:${accountColor(acc)}"></span>${esc(acc.email)}</div>` : ''}
      </div>
      <div class="when">${esc(fmtFull.format(new Date(m.date)))}
        ${until ? `<div class="snz">⏰ Erinnerung ${esc(fmtWeekday.format(until))}</div>` : ''}</div>
    </div>
  </div>`;

  if (!body) {
    html += '<div class="placeholder"><div class="spinner"></div></div>';
    el.innerHTML = html;
    return;
  }
  if (body.warnings && body.warnings.length) {
    html += `<div class="banner danger-banner">⚠<div><b>Vorsicht – möglicher Betrugsversuch (Phishing)</b>
      ${body.warnings.map((w) => `<div>${esc(w)}</div>`).join('')}
      <div class="muted">Keine Links anklicken, keine Daten eingeben. Im Zweifel den Absender auf bekanntem Weg kontaktieren.</div></div>
      ${folderRole(m) !== 'junk' ? `<button class="btn" data-act="spam-menu">${icon('junk')} Spam</button>` : ''}</div>`;
  }
  if (body.unsubscribe && folderRole(m) !== 'junk') {
    html += `<div class="banner info-banner">${icon('news')}<span>Newsletter – du kannst dich mit einem Klick abmelden.</span>
      <button class="btn" data-act="unsubscribe">Abmelden</button></div>`;
  }
  html += inviteCard(m, body);
  html += meetingBanner(body);
  if (body.html) {
    html += trackerBanner(body, allow, 'main');
    html += '<iframe class="body-frame" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer"></iframe>';
  } else {
    html += `<pre class="body-text">${linkify(body.text || '')}</pre>`;
  }
  const files = visibleAttachments(body);
  if (files.length) {
    html += `<div class="attachments"><div class="chips">${files.map((a) =>
      `<span class="chip" data-act="att-open" data-att="${esc(a.key)}" title="${esc(attachmentHint(a.filename))}">
        ${icon('clip')}${esc(a.filename)} <span class="size">${esc(fmtSize(a.size))}</span></span>`).join('')}</div>
      <button class="btn" data-act="att-save-all">${icon('download')} ${files.length > 1 ? 'Alle sichern' : 'Sichern'}</button></div>`;
  }
  el.innerHTML = html;
  const frame = $('.body-frame', el);
  if (frame) frame.srcdoc = prepareHtml(body, allow);
}

function linkify(text) {
  return esc(text).replace(/(https?:\/\/[^\s<>"']+)|(?:mailto:)?([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, (all, url, addr) => url
    ? `<a href="#" data-act="ext-link" data-url="${url}">${url}</a>`
    : `<a href="#" data-act="mailto" data-url="mailto:${addr}">${all}</a>`);
}

function visibleAttachments(body) {
  const html = body.html || '';
  return body.attachments.filter((a) => !a.calendar && !(a.inline && a.cid && html.includes(`cid:${a.cid}`)));
}

const REMOTE_RE = /((src|srcset|background|poster)\s*=\s*["']?\s*(https?:)?\/\/|url\(\s*["']?\s*(https?:)?\/\/|@import\s+["']?\s*(https?:)?\/\/|<link[^>]+href\s*=\s*["']?\s*(https?:)?\/\/)/i;
const hasRemoteContent = (html) => REMOTE_RE.test(html);
// Vertrauenswürdiger Absender nur ohne fehlgeschlagene Absenderprüfung (sonst evtl. gefälscht)
const remoteAllowed = (m) => !S.settings.blockImages || (!m.authFailed && isTrusted(m.fromAddress.toLowerCase())) ||
  S.imagesAllowed.has(keyOf(m));

// ------------------------------------------------------------------- Tracking-Schutz
// Listen kommen aus security.js (gleich wie Mac Privacy.swift); bis sie da sind, wirkt die Pixel-Erkennung allein.
const TRACK = { hosts: [], path: null };
api.call('privacy:trackers').then((t) => { TRACK.hosts = t.hosts || []; TRACK.path = t.path ? new RegExp(t.path, 'i') : null; }).catch(() => {});

const isRemoteUrl = (u) => /^\s*(https?:)?\/\//i.test(u || '');
function trackerHost(u) {
  try { return new URL(/^\s*\/\//.test(u) ? `https:${u.trim()}` : u.trim()).hostname.toLowerCase(); } catch { return ''; }
}
function isTrackerUrl(u) {
  const host = trackerHost(u);
  if (!host) return false;
  if (TRACK.hosts.some((d) => host === d || host.endsWith(`.${d}`))) return true;
  if (!TRACK.path) return false;
  try { const x = new URL(/^\s*\/\//.test(u) ? `https:${u.trim()}` : u.trim()); return TRACK.path.test(x.pathname + x.search); } catch { return false; }
}
// Winzig oder unsichtbar: typisches Zählpixel
function isPixelImg(img) {
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  const st = (img.getAttribute('style') || '').toLowerCase().replace(/\s+/g, '');
  const sw = st.match(/(?:^|;)(?:max-)?width:(\d+(?:\.\d+)?)px/);
  const sh = st.match(/(?:^|;)(?:max-)?height:(\d+(?:\.\d+)?)px/);
  const w = num(img.getAttribute('width')) ?? (sw ? num(sw[1]) : null);
  const h = num(img.getAttribute('height')) ?? (sh ? num(sh[1]) : null);
  if ((w !== null && w <= 3) && (h === null || h <= 3)) return true;
  if ((h !== null && h <= 3) && w === null) return true;
  return /display:none|visibility:hidden|opacity:0(?:[;.]|$)/.test(st);
}

/** Entfernt Zählpixel und Tracker-Bilder aus dem Mail-HTML. Ergebnis wird je Mail zwischengespeichert. */
function scanTracking(body) {
  if (body._privacy && body._privacy.gen === TRACK.hosts.length) return body._privacy;
  const out = { gen: TRACK.hosts.length, html: body.html, count: 0, hosts: [] };
  const hosts = new Set();
  const hit = (u) => { out.count++; const h = trackerHost(u); if (h) hosts.add(h.replace(/^www\./, '')); };
  try {
    const doc = new DOMParser().parseFromString(body.html, 'text/html');
    for (const img of [...doc.querySelectorAll('img, image, input[type=image]')]) {
      const src = img.getAttribute('src') || img.getAttribute('href') || img.getAttribute('xlink:href') || '';
      const set = img.getAttribute('srcset') || '';
      if (!isRemoteUrl(src) && !/(https?:)?\/\//i.test(set)) continue;
      if (isTrackerUrl(src) || isPixelImg(img)) { hit(src); img.remove(); }
    }
    // Hintergrundbilder und Stylesheets von Tracking-Diensten
    for (const e of [...doc.querySelectorAll('[background]')]) {
      const u = e.getAttribute('background');
      if (isRemoteUrl(u) && isTrackerUrl(u)) { hit(u); e.removeAttribute('background'); }
    }
    const cssUrl = /url\(\s*["']?\s*((?:https?:)?\/\/[^"')\s]+)\s*["']?\s*\)/gi;
    for (const e of [...doc.querySelectorAll('[style]')]) {
      const st = e.getAttribute('style');
      const ns = st.replace(cssUrl, (all, u) => (isTrackerUrl(u) ? (hit(u), 'none') : all));
      if (ns !== st) e.setAttribute('style', ns);
    }
    for (const e of [...doc.querySelectorAll('style')]) {
      const st = e.textContent;
      const ns = st.replace(cssUrl, (all, u) => (isTrackerUrl(u) ? (hit(u), 'none') : all));
      if (ns !== st) e.textContent = ns;
    }
    for (const e of [...doc.querySelectorAll('link[href]')]) {
      const u = e.getAttribute('href');
      if (isRemoteUrl(u) && isTrackerUrl(u)) { hit(u); e.remove(); }
    }
    // Hyperlink-Auditing und Vorab-Verbindungen abschalten
    for (const e of [...doc.querySelectorAll('[ping]')]) e.removeAttribute('ping');
    for (const e of [...doc.querySelectorAll('link[rel~=preconnect], link[rel~=dns-prefetch], link[rel~=prefetch], link[rel~=preload], meta[http-equiv=refresh]')]) e.remove();
    out.html = doc.head.innerHTML + doc.body.innerHTML;
  } catch { /* Original anzeigen – die CSP blockiert ohnehin externe Inhalte */ }
  out.hosts = [...hosts].sort();
  body._privacy = out;
  return out;
}

const SHIELD_SVG = '<svg class="pv-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5l-8-3z"/><path class="pv-mark" d="m8.5 12 2.5 2.5 4.5-5" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const HAND_SVG = '<svg class="pv-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5l-8-3z"/><path class="pv-mark" d="M8 8l8 8M16 8l-8 8" fill="none" stroke-width="2.2" stroke-linecap="round"/></svg>';

function trackerBanner(body, allow, where) {
  const p = scanTracking(body);
  const remote = hasRemoteContent(body.html);
  const tr = p.count ? `${p.count} Tracker blockiert` : '';
  const title = p.hosts.length ? ` title="${esc(p.hosts.join(', '))}"` : '';
  const names = esc(p.hosts.slice(0, 3).join(', ') + (p.hosts.length > 3 ? ' …' : ''));
  if (!allow && remote) {
    return `<div class="banner privacy-banner warn">${HAND_SVG}<div class="pv-text"><b>Externe Inhalte blockiert${tr ? ` · <span class="tr-count"${title}>${tr}</span>` : ''}</b>
      <div class="muted">${names ? `Zählpixel von ${names} entfernt. ` : ''}Der Absender erfährt nicht, ob und wo du die Mail öffnest.</div></div>
      ${where === 'main' ? `<div class="pv-actions"><button class="btn" data-act="images-once">Bilder laden</button>
      <button class="btn" data-act="images-always">Absender immer vertrauen</button></div>` : ''}</div>`;
  }
  if (tr) {
    return `<div class="banner privacy-banner ok">${SHIELD_SVG}<div class="pv-text"><b class="tr-count"${title}>${tr}</b>
      <div class="muted">${names ? `Entfernt: ${names}. Bilder werden ohne Cookies und Referrer geladen.` : 'Bilder werden ohne Zählpixel, Cookies und Referrer geladen.'}</div></div></div>`;
  }
  return '';
}

function prepareHtml(body, allow) {
  let h = scanTracking(body).html;
  for (const a of body.attachments) {
    if (a.cid && a.dataUrl) h = h.split(`cid:${a.cid}`).join(a.dataUrl);
  }
  const csp = allow
    ? "default-src 'none'; img-src https: http: data:; style-src https: http: 'unsafe-inline'; font-src https: http: data:; media-src https: http:"
    : "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="referrer" content="no-referrer">
<base target="_blank"><style>body{font-family:'Segoe UI',system-ui,sans-serif;font-size:14px;margin:16px;word-wrap:break-word;color:#1b1b1b;background:#fff}img{max-width:100%;height:auto}::-webkit-scrollbar{width:14px;height:14px}::-webkit-scrollbar-thumb{background:#b9b9b9;border-radius:7px;border:3px solid transparent;background-clip:content-box}::-webkit-scrollbar-thumb:hover{background:#8f8f8f;border:3px solid transparent;background-clip:content-box}</style>
</head><body>${h}</body></html>`;
}

// =================================================================== Drucken

/** Druckfertiges Dokument: Kopfzeilen (Von/An/Cc/Datum/Anhänge) und Inhalt */
function printDocument(m, body) {
  const allow = remoteAllowed(m);
  let content;
  if (body.html) {
    let h = scanTracking(body).html;
    for (const a of body.attachments) if (a.cid && a.dataUrl) h = h.split(`cid:${a.cid}`).join(a.dataUrl);
    content = h;
  } else {
    content = `<div class="sm-plain">${esc(body.text || '')}</div>`;
  }
  const csp = allow
    ? "default-src 'none'; img-src https: http: data:; style-src https: http: 'unsafe-inline'; font-src https: http: data:"
    : "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:";
  const rows = [
    ['Von:', m.fromName ? `${m.fromName} <${m.fromAddress}>` : m.fromAddress],
    m.to ? ['An:', m.to] : null,
    body.cc ? ['Cc:', body.cc] : null,
    ['Datum:', fmtFull.format(new Date(m.date))],
  ].filter(Boolean);
  const files = visibleAttachments(body);
  if (files.length) rows.push(['Anhänge:', files.map((a) => `${a.filename} (${fmtSize(a.size)})`).join(', ')]);
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="referrer" content="no-referrer">
<title>${esc(m.subject || 'E-Mail')}</title>
<style>
  body{font-family:'Segoe UI',system-ui,sans-serif;font-size:11pt;margin:0;color:#000;word-wrap:break-word;-webkit-print-color-adjust:exact}
  .sm-head{border-bottom:1px solid #999;padding-bottom:8pt;margin-bottom:12pt}
  .sm-head h1{font-size:15pt;margin:0 0 6pt 0}
  .sm-head table{border-collapse:collapse;font-size:9.5pt}
  .sm-head th{text-align:left;vertical-align:top;color:#555;font-weight:600;padding:1pt 8pt 1pt 0;white-space:nowrap}
  .sm-head td{padding:1pt 0}
  .sm-plain{white-space:pre-wrap}
  img{max-width:100%!important;height:auto}
  table{max-width:100%!important}
</style></head><body>
<div class="sm-head"><h1>${esc(m.subject || '(Kein Betreff)')}</h1>
<table>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table></div>
${content}
</body></html>`;
}

async function printMessage(m) {
  const k = keyOf(m);
  if (!S.bodies[k]) await loadBody(m);
  const body = S.bodies[k];
  if (!body) return;
  toast('Druckvorschau wird vorbereitet …');
  try { await api.call('mail:print', printDocument(m, body), m.subject || 'E-Mail'); } catch (e) { showError(e.message); }
}

// =================================================================== Eigenes Fenster (Doppelklick)

async function openInWindow(m) {
  if (isDraftMsg(m)) { openDraft(m); return; }
  const k = keyOf(m);
  if (!S.bodies[k]) await loadBody(m);
  const body = S.bodies[k];
  if (!body) return;
  const allow = remoteAllowed(m);
  const acc = findAccount(m.accountId);
  const payload = {
    key: k,
    subject: m.subject || '',
    fromName: m.fromName || '',
    fromAddress: m.fromAddress || '',
    to: m.to || '',
    cc: body.cc || '',
    date: fmtFull.format(new Date(m.date)),
    account: S.accounts.length > 1 && acc ? acc.email : '',
    accountColor: S.accounts.length > 1 && acc ? accountColor(acc) : '',
    nameColor: contactColor(m.fromAddress) || '',
    html: body.html ? prepareHtml(body, allow) : null,
    text: body.text || '',
    imagesBlocked: !!body.html && !allow && hasRemoteContent(body.html),
    privacyBanner: body.html ? trackerBanner(body, allow, 'viewer') : '',
    warnings: body.warnings || [],
    isFlagged: !!m.isFlagged,
    attachments: visibleAttachments(body).map((a) => ({ key: a.key, filename: a.filename, size: fmtSize(a.size), risk: attRisk(a) })),
  };
  try { await api.call('viewer:open', payload); } catch (e) { showError(e.message); }
}

// Befehle aus einem Mail-Fenster
api.on('viewer-action', (action, key) => {
  const m = findMessage(key);
  if (!m) { toast('Die E-Mail ist in der Liste nicht mehr vorhanden.'); return; }
  switch (action) {
    case 'reply': openCompose(replyDraft(m, false)); break;
    case 'replyAll': openCompose(replyDraft(m, true)); break;
    case 'forward': openCompose(forwardDraft(m)); break;
    case 'print': printMessage(m); break;
    case 'flag': toggleFlag(m); break;
    case 'archive': archive(m); break;
    case 'delete': remove(m); break;
    default: break;
  }
});

// Doppelklick auf eine Zeile öffnet die Mail in einem eigenen Fenster.
// Eigene Erkennung: Der erste Klick zeichnet die Liste neu, dadurch liefert Chromium unter Windows
// oft weder „dblclick“ noch einen zweiten „click“ auf derselben Zeile.
// Geöffnet wird erst beim Loslassen der Maustaste – sonst holt Windows das Hauptfenster beim
// Loslassen wieder nach vorn und das neue Fenster verschwindet dahinter (Fehler in 3.2.3).
let lastRowDown = { key: null, t: 0, x: 0, y: 0 };
let pendingOpen = null;      // Schlüssel, der beim nächsten Loslassen geöffnet wird
let lastOpen = { key: null, t: 0 };
function rowDoubleOpen(key) {
  lastRowDown = { key: null, t: 0, x: 0, y: 0 };
  pendingOpen = null;
  // dblclick-Rückfall und eigene Erkennung nicht doppelt auslösen
  const t = performance.now();
  if (lastOpen.key === key && t - lastOpen.t < 1000) return;
  lastOpen = { key, t };
  const m = findMessage(key);
  if (m) setTimeout(() => openInWindow(m), 0);
}
document.addEventListener('mousedown', (e) => {
  pendingOpen = null;
  if (e.button !== 0 || e.ctrlKey || e.shiftKey || e.metaKey || e.altKey) { lastRowDown.key = null; return; }
  if (e.target.closest('.row-actions') || e.target.closest('#modal-root') || e.target.closest('#menu')) return;
  const row = e.target.closest('.row[data-key]');
  if (!row || !row.closest('#list')) { lastRowDown.key = null; return; }
  const key = row.dataset.key;
  const t = performance.now();
  const near = Math.abs(e.clientX - lastRowDown.x) < 8 && Math.abs(e.clientY - lastRowDown.y) < 8;
  if ((lastRowDown.key === key && near && t - lastRowDown.t < 650) || e.detail === 2) {
    pendingOpen = key;
    lastRowDown = { key: null, t: 0, x: 0, y: 0 };
    return;
  }
  lastRowDown = { key, t, x: e.clientX, y: e.clientY };
}, true);
document.addEventListener('mouseup', (e) => {
  if (e.button !== 0 || !pendingOpen) return;
  const key = pendingOpen;
  pendingOpen = null;
  rowDoubleOpen(key);
}, true);
// Rückfall: echtes dblclick-Ereignis (falls die Zeile nicht neu gezeichnet wurde)
document.addEventListener('dblclick', (e) => {
  const row = e.target.closest('#list .row[data-key]');
  if (!row || e.target.closest('.row-actions')) return;
  rowDoubleOpen(row.dataset.key);
});

// =================================================================== Menüs

function showMenu(x, y, items) {
  const el = $('#menu');
  el.innerHTML = items.map((it, i) => (it === '-' ? '<div class="msep"></div>'
    : `<div class="mi${it.danger ? ' danger' : ''}${it.disabled ? ' disabled' : ''}" data-mi="${i}">${it.check !== undefined ? `<span class="mi-check">${it.check ? '✓' : ''}</span>` : ''}${it.color ? `<span class="mi-dot" style="background:${validColor(it.color)}"></span>` : ''}${it.color ? `<span style="color:${validColor(it.color)}">${esc(it.label)}</span>` : esc(it.label)}${it.hint ? `<span class="hint">${esc(it.hint)}</span>` : ''}</div>`)).join('');
  el.classList.remove('hidden');
  const r = el.getBoundingClientRect();
  el.style.left = `${Math.min(x, window.innerWidth - r.width - 8)}px`;
  el.style.top = `${Math.min(y, window.innerHeight - r.height - 8)}px`;
  el.onclick = (e) => {
    const mi = e.target.closest('[data-mi]');
    if (!mi) return;
    hideMenu();
    items[Number(mi.dataset.mi)].action(e.clientX, e.clientY);
  };
}
const hideMenu = () => $('#menu').classList.add('hidden');

function snoozeMenuItems(m) {
  const items = snoozeOptions().map((o) => ({ label: o.title, hint: fmtWeekday.format(o.date), action: () => snooze(m, o.date) }));
  items.push('-', { label: 'Eigener Zeitpunkt …', action: () => openSnoozeDialog(m) });
  if (isSnoozed(m)) items.push('-', { label: 'Zurück in den Posteingang', action: () => unsnooze(m) });
  return items;
}

function messageMenu(m, x, y) {
  const items = [
    { label: 'In eigenem Fenster öffnen', hint: 'Enter', action: () => openInWindow(m) },
    { label: 'Drucken …', hint: 'Strg+P', action: () => printMessage(m) },
    '-',
    { label: 'Antworten', hint: 'Strg+R', action: () => openCompose(replyDraft(m, false)) },
    { label: 'Allen antworten', hint: 'Strg+Umschalt+R', action: () => openCompose(replyDraft(m, true)) },
    { label: 'Weiterleiten', hint: 'Strg+Umschalt+F', action: () => openCompose(forwardDraft(m)) },
    '-',
    { label: m.isRead ? 'Als ungelesen markieren' : 'Als gelesen markieren', hint: 'Strg+U', action: () => setRead(m, !m.isRead) },
    { label: m.isFlagged ? 'Markierung entfernen' : 'Markieren', action: () => toggleFlag(m) },
  ];
  if (m.folder === 'INBOX') {
    items.push('-');
    for (const it of snoozeMenuItems(m)) items.push(it === '-' ? it : { ...it, label: it.label.startsWith('Zurück') || it.label.startsWith('Eigener') ? it.label : `Später: ${it.label}` });
  }
  items.push('-', contactByEmail(m.fromAddress)
    ? { label: 'Kontakt aus dieser Mail ergänzen', action: () => addSenderToContacts(m) }
    : { label: 'Absender zu Kontakten hinzufügen', action: () => addSenderToContacts(m) });
  if (contactByEmail(m.fromAddress)) items.push({ label: 'Kontakt anzeigen', action: () => showContacts(contactByEmail(m.fromAddress).id) });
  items.push('-', { label: 'Verschieben nach …', action: () => showMoveMenu(m, x, y) });
  items.push('-');
  if (folderRole(m) === 'junk') items.push({ label: 'Kein Spam', action: () => markNotSpam(m) });
  else items.push(...spamMenuItems(m));
  items.push('-', { label: 'Archivieren', hint: 'E', action: () => archive(m) },
    { label: 'Löschen', hint: 'Entf', danger: true, action: () => remove(m) });
  showMenu(x, y, items);
}

// =================================================================== Entwürfe

function signatureBlock(acc) {
  const sig = (acc && acc.signature ? acc.signature : '').trim();
  return sig ? `\n\n-- \n${sig}` : '';
}

function defaultAccountId() {
  if (S.view.type === 'folder') return S.view.acc;
  if (accountFilter()) return accountFilter();
  return S.accounts[0] && S.accounts[0].id;
}

function newDraft() {
  const accountId = defaultAccountId();
  return { accountId, to: '', cc: '', subject: '', body: signatureBlock(findAccount(accountId)), attachments: [] };
}

/** mailto:-Link → Entwurf (An, Cc, Betreff, Text; RFC 6068) */
function parseMailto(url) {
  const raw = String(url || '').replace(/^mailto:/i, '');
  const q = raw.indexOf('?');
  const dec = (v) => { try { return decodeURIComponent(v.replace(/\+/g, '%2B')); } catch { return v; } };
  const list = (v) => dec(v).split(/[,;]/).map((x) => x.trim()).filter(Boolean);
  const to = list(q < 0 ? raw : raw.slice(0, q));
  const cc = []; let subject = ''; let text = '';
  if (q >= 0) {
    for (const part of raw.slice(q + 1).split('&')) {
      const i = part.indexOf('=');
      const k = (i < 0 ? part : part.slice(0, i)).toLowerCase();
      const v = i < 0 ? '' : part.slice(i + 1);
      if (k === 'to') to.push(...list(v));
      else if (k === 'cc' || k === 'bcc') cc.push(...list(v));   // kein Bcc-Feld → in Cc, damit nichts verloren geht
      else if (k === 'subject') subject = dec(v);
      else if (k === 'body') text = dec(v).replace(/\r\n/g, '\n');
    }
  }
  return { to, cc, subject, text };
}

function mailtoDraft(url) {
  const p = parseMailto(url);
  const sel = findMessage(S.selected);
  const accountId = sel && findAccount(sel.accountId) ? sel.accountId : defaultAccountId();
  const show = (addr) => { const c = contactByEmail(addr); return c && c.name ? contactDisplay({ name: c.name, email: addr }) : addr; };
  return {
    accountId,
    to: p.to.map(show).join(', '),
    cc: p.cc.map(show).join(', '),
    subject: p.subject,
    body: p.text + signatureBlock(findAccount(accountId)),
    attachments: [],
  };
}

function composeMailto(url) {
  if (!S.accounts.length) { toast('Bitte zuerst ein Konto einrichten.'); return; }
  if (composeOpen) { toast('Bitte zuerst die offene E-Mail senden oder verwerfen.'); return; }
  openCompose(mailtoDraft(url));
}
api.on('compose-mailto', (url) => composeMailto(url));

/** Einstellungen: zeigt, ob SimpleMail das Standard-Mailprogramm ist */
async function showMailHandlerState(root) {
  const st = $('#p-mail-state', root);
  if (!st) return;
  try {
    const r = await api.call('mailhandler:status');
    const btn = $('#p-mail-default', root);
    if (!r.supported) { st.textContent = 'nur in der installierten Windows-App'; if (btn) btn.disabled = true; return; }
    st.textContent = r.isDefault ? '✓ SimpleMail ist das Standard-Mailprogramm' : 'noch nicht festgelegt';
    st.classList.toggle('ok', !!r.isDefault);
    if (btn) btn.textContent = r.isDefault ? 'Einstellungen öffnen …' : 'Als Standard-Mailprogramm festlegen …';
  } catch { st.textContent = ''; }
}

/** E-Mail-Adressen in einer Kopfzeile (An/Cc) anklickbar machen */
function linkAddrs(text) {
  return esc(text).replace(/[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (a) => `<a href="#" class="mail-addr" data-act="mailto" data-url="mailto:${a}" title="E-Mail an ${a} schreiben">${a}</a>`);
}

function plainText(m) {
  const b = S.bodies[keyOf(m)];
  if (!b) return '';
  if (b.text) return b.text;
  if (b.html) {
    const d = new DOMParser().parseFromString(b.html, 'text/html');
    return d.body ? d.body.innerText || d.body.textContent || '' : '';
  }
  return '';
}

function replyDraft(m, all) {
  const acc = findAccount(m.accountId);
  const own = acc ? acc.email.toLowerCase() : '';
  let cc = '';
  if (all) {
    const body = S.bodies[keyOf(m)];
    const addrs = (m.to + ',' + (body ? body.cc : '')).split(',').map((x) => {
      const mm = x.match(/<([^>]+)>/);
      return (mm ? mm[1] : x).trim();
    }).filter((x) => x.includes('@') && x.toLowerCase() !== own && x.toLowerCase() !== m.fromAddress.toLowerCase());
    cc = [...new Set(addrs)].join(', ');
  }
  const quoted = plainText(m).split(/\r?\n/).map((l) => `> ${l}`).join('\n');
  return {
    accountId: m.accountId,
    to: m.fromAddress,
    cc,
    subject: /^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`,
    body: `${signatureBlock(acc)}\n\nAm ${fmtFull.format(new Date(m.date))} schrieb ${sender(m)}:\n${quoted}`,
    inReplyTo: m.messageId,
    references: `${m.references} ${m.messageId}`.trim(),
    attachments: [],
  };
}

function forwardDraft(m) {
  const acc = findAccount(m.accountId);
  const body = S.bodies[keyOf(m)];
  return {
    accountId: m.accountId,
    to: '', cc: '',
    subject: /^(fwd|wg):/i.test(m.subject) ? m.subject : `WG: ${m.subject}`,
    body: `${signatureBlock(acc)}\n\n---------- Weitergeleitete Nachricht ----------\nVon: ${sender(m)} <${m.fromAddress}>\nDatum: ${fmtFull.format(new Date(m.date))}\nBetreff: ${m.subject}\nAn: ${m.to}\n\n${plainText(m)}`,
    attachments: body ? body.attachments.filter((a) => !a.inline).map((a) => ({ key: a.key, name: a.filename, size: a.size })) : [],
  };
}

function insertSnippet(text, body) {
  const markers = ['\n\n-- \n', '\n\nAm ', '\n\n---------- Weitergeleitete'];
  const idx = markers.map((mk) => body.indexOf(mk)).filter((i) => i >= 0);
  if (!idx.length) return body ? `${body}\n${text}` : text;
  const at = Math.min(...idx);
  const head = body.slice(0, at);
  return (head.trim() ? `${head}\n${text}` : text) + body.slice(at);
}

// =================================================================== Dialoge

function openOverlay(html, { closable = true } = {}) {
  const root = $('#modal-root');
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = html;
  root.appendChild(ov);
  const close = () => ov.remove();
  if (closable) {
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
    ov.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  }
  return { el: ov, close };
}

function openSnoozeDialog(m) {
  const def = atHour(8, 1);
  const { el, close } = openOverlay(`<div class="dialog" style="width:380px">
    <div class="dialog-head">Erinnern am …</div>
    <div style="padding:16px">
      <div style="color:var(--muted);margin-bottom:10px">${esc(m.subject || '(Kein Betreff)')}</div>
      <input type="datetime-local" class="text-input" id="snz-date" value="${toLocalInput(def)}" min="${toLocalInput(new Date())}">
    </div>
    <div class="dialog-foot"><span class="grow"></span>
      <button class="btn" data-x="cancel">Abbrechen</button>
      <button class="primary" data-x="ok">Zurückstellen</button></div></div>`);
  $('#snz-date', el).focus();
  el.addEventListener('click', (e) => {
    const x = e.target.closest('[data-x]');
    if (!x) return;
    if (x.dataset.x === 'ok') {
      const d = new Date($('#snz-date', el).value);
      if (isNaN(d) || d <= new Date()) { toast('Bitte einen Zeitpunkt in der Zukunft wählen.'); return; }
      snooze(m, d);
    }
    close();
  });
}

// ---- Bestätigungsdialog (Promise<boolean>)
function confirmDialog({ title, text, ok = 'OK', cancel = 'Abbrechen', danger = false }) {
  return new Promise((resolve) => {
    const { el, close } = openOverlay(`<div class="dialog" style="width:480px">
      <div class="dialog-head">${danger ? '⚠ ' : ''}${esc(title)}</div>
      <div style="padding:16px 18px;line-height:1.5;user-select:text">${text}</div>
      <div class="dialog-foot"><span class="grow"></span>
        <button class="primary" data-x="no">${esc(cancel)}</button>
        <button class="btn${danger ? ' danger' : ''}" data-x="yes">${esc(ok)}</button></div></div>`, { closable: false });
    let done = false;
    const finish = (v) => { if (done) return; done = true; close(); resolve(v); };
    el.addEventListener('click', (e) => {
      const x = e.target.closest('[data-x]');
      if (x) finish(x.dataset.x === 'yes');
      else if (e.target === el) finish(false);
    });
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); finish(false); } });
    $('[data-x="no"]', el).focus();
  });
}

// ---- Anhänge sicher öffnen (Einstufung kommt vom Hauptprozess: risk = 'blocked' | 'dangerous' | '')
const attByKey = (key) => {
  const body = Object.values(S.bodies).find((b) => b.attachments.some((a) => a.key === key));
  return body ? body.attachments.find((a) => a.key === key) : null;
};
// Ersatz, falls die Einstufung fehlt (ältere Ablage) – maßgeblich ist die Prüfung im Hauptprozess
const fallbackRisk = (name) => {
  const n = String(name || '').replace(/[. \u00a0]+$/, '').toLowerCase();
  if (/\.(exe|msi|bat|cmd|com|scr|pif|cpl|vbs?|vbe|jse?|wsf|wsh|ps1|hta|chm|jar|lnk|url|reg|msc|inf|application|appref-ms|settingcontent-ms|library-ms|search-ms|xll|cab|diagcab|app|pkg|command|sh)$/.test(n)) return 'blocked';
  return /\.(docm|dotm|xlsm|xltm|xlam|pptm|potm|ppam|sldm|one|iso|img|vhdx?|dmg|html?|svg|mht)$/.test(n) ? 'dangerous' : '';
};
const attRisk = (att) => (att ? (att.risk !== undefined ? att.risk : fallbackRisk(att.filename)) : '');
function blockedInfo(name) {
  return confirmDialog({
    title: 'Programmdatei',
    danger: true,
    ok: 'Sichern unter …',
    cancel: 'Abbrechen',
    text: `<b>${esc(name)}</b> ist ein Programm oder Skript. Solche Anhänge öffnet SimpleMail aus Sicherheitsgründen nicht direkt.<br><br>
      Rechnungen, Bewerbungen oder Paketmitteilungen kommen fast nie als Programm. Wenn du die Datei wirklich erwartest:
      sichern und vorher mit dem Virenscanner prüfen.`,
  });
}

// ---- Anhänge mit bestimmtem Programm öffnen (Kennungen wie auf dem Mac)
const DOC_EXT = ['doc', 'docx', 'dot', 'dotx', 'odt', 'ott', 'rtf'];
function attachmentKind(name) {
  const ext = String(name || '').split('.').pop().toLowerCase();
  if (ext === 'pdf') return 'pdf';
  return DOC_EXT.includes(ext) ? 'doc' : 'other';
}
const OPEN_APP_LABELS = { word: 'Microsoft Word', libreoffice: 'LibreOffice', wordcraft: 'Wordcraft' };
function attachmentHint(name) {
  const choice = (S.settings.openWith || {})[attachmentKind(name)];
  const app = OPEN_APP_LABELS[choice] || (attachmentKind(name) === 'pdf' ? 'dem Standard-PDF-Reader' : 'der Standard-App');
  return `Klicken öffnet mit ${app} – Rechtsklick: Öffnen mit … / Sichern`;
}

async function confirmAttachment(key) {
  const att = attByKey(key);
  const name = att ? att.filename : '';
  if (attRisk(att) === 'blocked') {
    if (await blockedInfo(name)) api.call('attachment:save', key).catch((err) => showError(err.message));
    return { ok: false, confirmed: false };
  }
  if (attRisk(att) !== 'dangerous') return { ok: true, confirmed: false };
  const m = findMessage(S.selected);
  const confirmed = await confirmDialog({
    title: 'Möglicherweise gefährlicher Anhang',
    danger: true,
    ok: 'Trotzdem öffnen',
    cancel: 'Nicht öffnen',
    text: `<b>${esc(name)}</b> kann Programme oder Makros ausführen.<br><br>
      Öffne solche Dateien nur, wenn du sie erwartet hast und dem Absender${m ? ` <b>${esc(m.fromAddress)}</b>` : ''} vertraust.
      Rechnungen, Bewerbungen oder Paketmitteilungen kommen fast nie als Programm.`,
  });
  return { ok: confirmed, confirmed };
}

async function openAttachmentWith(key, appId) {
  const c = await confirmAttachment(key);
  if (!c.ok) return;
  const call = appId === 'other' ? api.call('attachment:openWithOther', key, c.confirmed) : api.call('attachment:open', key, c.confirmed, appId);
  call.catch((err) => showError(err.message));
}

/** Programmdatei selbst auswählen und merken (nur auf diesem Gerät) */
async function chooseAppPath(id) {
  const p = await api.call('apps:choose', id);
  if (!p) return false;
  S.settings.appPaths = { ...(S.settings.appPaths || {}), [id]: p };
  await saveSettings({ sync: false });
  return true;
}

async function attachmentMenu(key, x, y) {
  if (attRisk(attByKey(key)) === 'blocked') {
    showMenu(x, y, [{ label: 'Sichern unter …', action: () => api.call('attachment:save', key).catch((err) => showError(err.message)) }]);
    return;
  }
  let apps = [];
  try { apps = await api.call('attachment:apps', key); } catch { /* egal */ }
  showMenu(x, y, [
    { label: 'Öffnen', action: () => openAttachmentSafe(key) },
    ...apps.map((a) => (a.installed
      ? { label: `Öffnen mit ${a.label}`, action: () => openAttachmentWith(key, a.id) }
      : { label: `Öffnen mit ${a.label} …`, hint: 'Programm suchen',
        action: async () => { try { if (await chooseAppPath(a.id)) openAttachmentWith(key, a.id); } catch (err) { showError(err.message); } } })),
    { label: 'Öffnen mit Standard-App', action: () => openAttachmentWith(key, 'default') },
    { label: 'Öffnen mit anderer App …', action: () => openAttachmentWith(key, 'other') },
    '-',
    { label: 'Sichern unter …', action: () => api.call('attachment:save', key).catch((err) => showError(err.message)) },
  ]);
}

async function openAttachmentSafe(key) {
  const att = attByKey(key);
  const name = att ? att.filename : '';
  let confirmed = false;
  if (attRisk(att) === 'blocked') {
    if (await blockedInfo(name)) api.call('attachment:save', key).catch((err) => showError(err.message));
    return;
  }
  if (attRisk(att) === 'dangerous') {
    const m = findMessage(S.selected);
    confirmed = await confirmDialog({
      title: 'Möglicherweise gefährlicher Anhang',
      danger: true,
      ok: 'Trotzdem öffnen',
      cancel: 'Nicht öffnen',
      text: `<b>${esc(name)}</b> kann Programme oder Makros ausführen.<br><br>
        Öffne solche Dateien nur, wenn du sie erwartet hast und dem Absender${m ? ` <b>${esc(m.fromAddress)}</b>` : ''} vertraust.
        Rechnungen, Bewerbungen oder Paketmitteilungen kommen fast nie als Programm.`,
    });
    if (!confirmed) return;
  }
  api.call('attachment:open', key, confirmed).catch((err) => showError(err.message));
}

// ---- Serveränderungen aus der Synchronisation bestätigen
let resolvingPending = false;
async function askPendingServerChanges(list) {
  if (resolvingPending || !list || !list.length) return;
  resolvingPending = true;
  const labels = { username: 'Benutzername', imapHost: 'IMAP-Server', imapPort: 'IMAP-Port', smtpHost: 'SMTP-Server',
    smtpPort: 'SMTP-Port', allowInvalidCerts: 'Zertifikat nicht prüfen' };
  for (const p of list) {
    const rows = Object.keys(p.proposed).map((f) => `<tr><td style="padding:2px 10px 2px 0;color:var(--muted)">${esc(labels[f] || f)}</td>
      <td style="padding:2px 10px 2px 0">${esc(String(p.current[f] ?? '–'))}</td><td>→ <b>${esc(String(p.proposed[f] ?? '–'))}</b></td></tr>`).join('');
    const accept = await confirmDialog({
      title: 'Geänderte Serverdaten vom anderen Gerät',
      ok: 'Übernehmen',
      cancel: 'Ablehnen',
      text: `Für <b>${esc(p.email)}</b> wurden auf einem anderen Gerät die Serverdaten geändert:<br><br>
        <table style="font-size:13px">${rows}</table><br>
        Übernimm die Änderung nur, wenn <b>du selbst</b> sie vorgenommen hast. Sonst „Ablehnen“ – dann bleiben die bisherigen
        Daten und werden auch auf den anderen Geräten wiederhergestellt.`,
    });
    try { await api.call('sync:resolve', p.email, accept); } catch (e) { showError(e.message); }
  }
  resolvingPending = false;
  await reloadFromDisk();
  renderAll();
}

// ---- Verfassen
let composeOpen = false;
let composeSaveHook = null;   // „Als Entwurf speichern“ (Menü/Strg+S) für das offene Verfassen-Fenster

/** Entwurf aus dem Entwürfe-Ordner zum Weiterschreiben öffnen (3.2.44) */
const isDraftMsg = (m) => !!m && folderRole(m) === 'drafts';
async function openDraft(m) {
  if (composeOpen) { toast('Bitte zuerst die offene E-Mail senden, speichern oder verwerfen.'); return; }
  let r;
  try { r = await api.call('mail:loadDraft', m.accountId, m.folder, m.uid); } catch (e) { showError(e.message); return; }
  openCompose({
    accountId: m.accountId, to: r.to, cc: r.cc, subject: r.subject,
    html: r.html ? draftEditorHtml(r.html) : null, body: r.text,
    inReplyTo: r.inReplyTo || undefined, references: r.references || undefined,
    attachments: r.attachments,
    draftRef: { accountId: m.accountId, folder: m.folder, uid: m.uid },
  });
}
/** HTML eines gespeicherten Entwurfs → Editor-Inhalt (Hülle der Mail entfernen, Signatur wieder erkennen) */
function draftEditorHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const n of doc.querySelectorAll('script, style, meta, title')) n.remove();
  let root = doc.body;
  const only = root.children.length === 1 && root.firstElementChild;
  if (only && only.tagName === 'DIV' && /font-family/i.test(only.getAttribute('style') || '')) root = only;
  for (const n of root.querySelectorAll('.simplemail-signature')) { n.classList.remove('simplemail-signature'); n.classList.add('sm-sig'); }
  for (const n of root.querySelectorAll('*')) for (const a of [...n.attributes]) if (/^on/i.test(a.name)) n.removeAttribute(a.name);
  return root.innerHTML.trim() || '<div><br></div>';
}

/** Dialog mit mehreren Knöpfen → id des gewählten Knopfs ('cancel' bei Esc) */
function choiceDialog({ title, text, buttons, focus }) {
  return new Promise((resolve) => {
    const { el, close } = openOverlay(`<div class="dialog" style="width:480px">
      <div class="dialog-head">${esc(title)}</div>
      <div style="padding:16px 18px;line-height:1.5">${esc(text)}</div>
      <div class="dialog-foot">${buttons.map((b, i) => `${i === 1 ? '<span class="grow"></span>' : ''}<button class="${b.cls}" data-x="${esc(b.id)}">${esc(b.label)}</button>`).join('')}</div></div>`, { closable: false });
    let done = false;
    const finish = (v) => { if (done) return; done = true; close(); resolve(v); };
    el.addEventListener('click', (e) => { const x = e.target.closest('[data-x]'); if (x) finish(x.dataset.x); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish('cancel'); } });
    const f = $(`[data-x="${focus}"]`, el);
    if (f) f.focus();
  });
}

/** Signatur für den formatierten Editor (inkl. Trenner „-- “) */
function editorSignature(acc) {
  if (!acc) return '';
  if (isRichHtml(acc.signatureHtml)) return `-- <br>${cleanSignatureHtml(acc.signatureHtml)}`;
  const sig = (acc.signature || '').trim();
  return sig ? `-- <br>${textToHtml(sig)}` : '';
}

/** Zitat-Zeilen („> …“) als eingerückter Block */
function quoteHTML(text) {
  let out = '';
  let quote = [];
  const flush = () => { if (quote.length) { out += `<blockquote>${textToHtml(quote.join('\n'))}</blockquote>`; quote = []; } };
  for (const line of text.split('\n')) {
    if (line.startsWith('>')) quote.push(line.replace(/^> ?/, ''));
    else { flush(); out += `${textToHtml(line)}<br>`; }
  }
  flush();
  return out;
}

/** Anfangsinhalt des Editors aus dem Text-Entwurf */
function editorHTML(d) {
  if (d.html) return d.html;
  const body = d.body || '';
  const acc = findAccount(d.accountId);
  const block = signatureBlock(acc);
  let before = body;
  let after = '';
  let sig = '';
  const i = block ? body.indexOf(block) : -1;
  if (i >= 0) {
    before = body.slice(0, i);
    after = body.slice(i + block.length);
    sig = editorSignature(acc);
  }
  let html = before.trim() ? textToHtml(before) : '<div><br></div>';
  if (sig) html += `<div><br></div><div class="sm-sig">${sig}</div>`;
  const rest = after.replace(/^\n+|\n+$/g, '');
  if (rest) html += `<div><br></div><div class="sm-quote">${quoteHTML(rest)}</div>`;
  return html;
}

function openCompose(draft) {
  if (!S.accounts.length) return;
  composeOpen = true;
  const d = { ...draft, attachments: [...(draft.attachments || [])] };
  let lastAcc = d.accountId;
  const accOptions = S.accounts.map((a) => `<option value="${esc(a.id)}" ${a.id === d.accountId ? 'selected' : ''}>${esc(a.displayName ? `${a.displayName} <${a.email}>` : a.email)}</option>`).join('');
  const { el, close: rawClose } = openOverlay(`<div class="dialog compose">
    <div class="dialog-head"><span class="grow">${esc(d.subject || 'Neue E-Mail')}</span></div>
    ${S.accounts.length > 1 ? `<div class="field-row"><label>Von:</label><select id="c-from">${accOptions}</select></div>` : ''}
    <div class="field-row"><label>An:</label><input id="c-to" autocomplete="off" value="${esc(d.to)}"><div class="suggest hidden" data-for="c-to"></div></div>
    <div class="field-row"><label>Cc:</label><input id="c-cc" autocomplete="off" value="${esc(d.cc)}"><div class="suggest hidden" data-for="c-cc"></div></div>
    <div class="field-row"><label>Betreff:</label><input id="c-subject" value="${esc(d.subject)}"></div>
    <div class="fmt-bar">
      <button class="icon-btn" data-x="fmt" data-cmd="bold" title="Fett (Strg+B)"><b>F</b></button>
      <button class="icon-btn" data-x="fmt" data-cmd="italic" title="Kursiv (Strg+I)"><i>K</i></button>
      <button class="icon-btn" data-x="fmt" data-cmd="underline" title="Unterstrichen (Strg+U)"><u>U</u></button>
      <button class="icon-btn" data-x="fmt" data-cmd="strikeThrough" title="Durchgestrichen"><s>S</s></button>
      <span class="sep"></span>
      <select id="c-size" title="Schriftgröße"><option value="">Größe</option><option value="2">Klein</option><option value="3">Normal</option><option value="5">Groß</option><option value="6">Sehr groß</option></select>
      <input type="color" id="c-color" title="Schriftfarbe" value="#c42b1c">
      <span class="sep"></span>
      <button class="icon-btn" data-x="fmt" data-cmd="insertUnorderedList" title="Aufzählung">• Liste</button>
      <button class="icon-btn" data-x="fmt" data-cmd="insertOrderedList" title="Nummerierung">1. Liste</button>
      <button class="icon-btn" data-x="fmt" data-cmd="outdent" title="Einzug verkleinern">⇤</button>
      <button class="icon-btn" data-x="fmt" data-cmd="indent" title="Einzug vergrößern">⇥</button>
      <span class="sep"></span>
      <button class="icon-btn" data-x="c-link" title="Link einfügen – markierter Text wird zum Link">🔗 Link</button>
      <button class="icon-btn" data-x="fmt" data-cmd="removeFormat" title="Formatierung entfernen">✕ Format</button>
    </div>
    <div class="fmt-link hidden" id="c-linkrow"><input class="text-input" id="c-url" placeholder="https://… oder name@firma.de">
      <button class="primary" data-x="c-link-ok">Einfügen</button><button class="btn" data-x="c-link">Abbrechen</button></div>
    <div id="c-body" class="rich-body" contenteditable="true" spellcheck="true"></div>
    <div class="chips hidden" id="c-files"></div>
    <div class="schedule-row hidden" id="c-sched">Senden am <input type="datetime-local" class="text-input" style="width:auto" id="c-sched-date">
      <span class="grow" style="flex:1"></span><button class="btn" data-x="sched-cancel">Abbrechen</button><button class="primary" data-x="sched-ok">Planen</button></div>
    <div class="err hidden" id="c-err"></div>
    <div class="dialog-foot">
      <button class="btn" data-x="cancel">Verwerfen</button>
      <button class="btn" data-x="attach" title="Dateien anhängen (oder ins Fenster ziehen)">${icon('clip')} Anhang</button>
      <button class="btn" data-x="snippets">${icon('snippet')} Textbaustein</button>
      <button class="btn" data-x="save-draft" title="Als Entwurf speichern (Strg+S)">${icon('drafts')} Entwurf speichern</button>
      <span class="grow"></span>
      <span class="spinner hidden" id="c-spin"></span>
      <button class="btn" data-x="later">${icon('clock')} Später senden</button>
      <button class="primary" data-x="send" title="Senden (Strg+Enter)">${icon('send')} Senden</button>
    </div></div>`, { closable: false });
  const close = () => { composeOpen = false; composeSaveHook = null; document.removeEventListener('selectionchange', onSel); rawClose(); };
  const dlg = $('.compose', el);
  const bodyEl = $('#c-body', el);
  bodyEl.innerHTML = editorHTML(d);
  document.execCommand('styleWithCSS', false, true);
  document.execCommand('defaultParagraphSeparator', false, 'div');
  let savedRange = null;
  const caretTo = (range) => { const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range); };
  if ($('#c-to', el).value) {
    bodyEl.focus();
    const r = document.createRange(); r.setStart(bodyEl, 0); r.collapse(true); caretTo(r);
  } else {
    $('#c-to', el).focus();
  }
  const onSel = () => {
    const sel = window.getSelection();
    if (sel.rangeCount && bodyEl.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
  };
  document.addEventListener('selectionchange', onSel);
  const restore = () => { bodyEl.focus(); if (savedRange) caretTo(savedRange); };
  const fmt = (cmd, value) => { restore(); document.execCommand(cmd, false, value); };
  const caretBeforeSignature = () => {
    const sig = bodyEl.querySelector('.sm-sig');
    const r = document.createRange();
    if (sig && sig.previousSibling) { r.selectNodeContents(sig.previousSibling); r.collapse(false); }
    else if (sig) { r.setStartBefore(sig); r.collapse(true); }
    else { r.selectNodeContents(bodyEl); r.collapse(false); }
    caretTo(r);
  };
  const setSignature = (html) => {
    let sig = bodyEl.querySelector('.sm-sig');
    if (!html) { if (sig) sig.remove(); return; }
    if (!sig) {
      sig = document.createElement('div');
      sig.className = 'sm-sig';
      const quote = bodyEl.querySelector('.sm-quote');
      if (quote) bodyEl.insertBefore(sig, quote); else bodyEl.appendChild(sig);
      const gap = document.createElement('div'); gap.innerHTML = '<br>';
      bodyEl.insertBefore(gap, sig);
    }
    sig.innerHTML = html;
  };
  el.addEventListener('change', (e) => {
    if (e.target.id === 'c-size' && e.target.value) { fmt('fontSize', e.target.value); e.target.value = ''; }
    else if (e.target.id === 'c-color') fmt('foreColor', e.target.value);
  });
  $('#c-url', el).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('[data-x="c-link-ok"]', el).click(); }
  });
  // Eingefügtes HTML (Word, Webseiten) säubern
  bodyEl.addEventListener('paste', (e) => {
    const html = e.clipboardData.getData('text/html');
    if (html) { e.preventDefault(); document.execCommand('insertHTML', false, cleanSignatureHtml(html)); }
  });

  const sync = () => {
    d.to = $('#c-to', el).value;
    d.cc = $('#c-cc', el).value;
    d.subject = $('#c-subject', el).value;
    d.body = bodyEl.innerText.replace(/\u00a0/g, ' ');
    d.html = bodyEl.innerHTML;
  };
  // 3.2.44: Entwürfe – Stand beim Öffnen/Speichern merken, beim Schließen nachfragen
  const stateOf = () => JSON.stringify([d.accountId, d.to, d.cc, d.subject, d.html, d.attachments.map((a) => a.key || a.path)]);
  sync();
  let savedState = stateOf();
  let saving = null;
  const isDirty = () => { sync(); return stateOf() !== savedState; };
  const doSaveDraft = async ({ quiet = false } = {}) => {
    sync();
    if (saving) return saving;
    $('#c-spin', el).classList.remove('hidden');
    setErr('');
    saving = (async () => {
      try {
        const ref = await api.call('mail:saveDraft', d);
        d.draftRef = { accountId: ref.accountId, folder: ref.folder, uid: ref.uid, messageId: ref.messageId };
        savedState = stateOf();
        if (!quiet) toast('Als Entwurf gespeichert');
        if (S.view.type === 'drafts' || (S.view.type === 'folder' && S.view.path === ref.folder)) refresh();
        return true;
      } catch (e) {
        setErr(`Entwurf nicht gespeichert: ${e.message}`);
        return false;
      } finally {
        saving = null;
        $('#c-spin', el).classList.add('hidden');
      }
    })();
    return saving;
  };
  composeSaveHook = () => doSaveDraft();
  const requestClose = async () => {
    if (!isDirty()) { close(); return; }
    const choice = await choiceDialog({
      title: 'Als Entwurf speichern?',
      text: d.draftRef ? 'Der Entwurf wurde geändert. Sollen die Änderungen gespeichert werden?'
        : 'Die E-Mail wurde noch nicht gesendet. Im Ordner „Entwürfe“ speichern, um sie später weiterzuschreiben?',
      buttons: [{ id: 'discard', label: d.draftRef ? 'Änderungen verwerfen' : 'Verwerfen', cls: 'btn danger' },
        { id: 'cancel', label: 'Abbrechen', cls: 'btn' }, { id: 'save', label: 'Speichern', cls: 'primary' }],
      focus: 'save',
    });
    if (choice === 'discard') close();
    else if (choice === 'save' && await doSaveDraft()) close();
  };
  el.addEventListener('mousedown', (e) => { if (e.target === el) requestClose(); });
  const setErr = (msg) => { const e = $('#c-err', el); e.textContent = msg || ''; e.classList.toggle('hidden', !msg); };
  const renderFiles = () => {
    const box = $('#c-files', el);
    box.classList.toggle('hidden', !d.attachments.length);
    box.innerHTML = d.attachments.map((a, i) => `<span class="chip">${icon('clip')}${esc(a.name)} <span class="size">${esc(fmtSize(a.size || 0))}</span>
      <button data-x="unattach" data-i="${i}" title="Entfernen">✕</button></span>`).join('');
  };
  renderFiles();
  const addFiles = (files) => {
    for (const f of files) if (!d.attachments.some((a) => a.path && a.path === f.path)) d.attachments.push(f);
    renderFiles();
  };

  // Absender wechseln → Signatur tauschen
  const fromSel = $('#c-from', el);
  if (fromSel) {
    fromSel.addEventListener('change', () => {
      if (fromSel.value !== lastAcc) setSignature(editorSignature(findAccount(fromSel.value)));
      d.accountId = fromSel.value;
      lastAcc = fromSel.value;
    });
  }

  // Adressvorschläge
  for (const id of ['c-to', 'c-cc']) {
    const input = $(`#${id}`, el);
    const box = $(`.suggest[data-for="${id}"]`, el);
    let hits = [];
    let hl = 0;
    const show = () => {
      hits = suggestions(input.value);
      hl = 0;
      box.classList.toggle('hidden', !hits.length);
      box.innerHTML = hits.map((c, i) => `<div class="sg${i === hl ? ' hl' : ''}" data-i="${i}">${c.name ? `<b>${esc(c.name)}</b>` : ''}<span class="em">${esc(c.email)}</span></div>`).join('');
    };
    const pick = (i) => {
      if (!hits[i]) return;
      input.value = completing(input.value, hits[i]);
      box.classList.add('hidden');
      input.focus();
    };
    input.addEventListener('input', show);
    input.addEventListener('blur', () => setTimeout(() => box.classList.add('hidden'), 150));
    input.addEventListener('keydown', (e) => {
      if (box.classList.contains('hidden')) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        hl = (hl + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length;
        box.querySelectorAll('.sg').forEach((n, i) => n.classList.toggle('hl', i === hl));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(hl);
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        box.classList.add('hidden');
      }
    });
    box.addEventListener('mousedown', (e) => {
      const sg = e.target.closest('.sg');
      if (sg) { e.preventDefault(); pick(Number(sg.dataset.i)); }
    });
  }

  // Drag & Drop
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  dlg.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dlg.classList.add('dragover'); });
  dlg.addEventListener('dragleave', (e) => { if (e.target === dlg) dlg.classList.remove('dragover'); });
  dlg.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dlg.classList.remove('dragover');
    const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean);
    if (paths.length) addFiles(await api.call('files:info', paths));
  });

  const doSend = async () => {
    sync();
    if (!d.to.trim()) { setErr('Bitte mindestens einen Empfänger angeben.'); return; }
    $('#c-spin', el).classList.remove('hidden');
    setErr('');
    try {
      await api.call('mail:send', d);
      close();
      toast('Gesendet');
      refresh();
    } catch (e) {
      setErr(e.message);
    }
    $('#c-spin', el).classList.add('hidden');
  };
  const doSchedule = async (date) => {
    sync();
    if (!d.to.trim()) { setErr('Bitte mindestens einen Empfänger angeben.'); return; }
    try {
      await api.call('mail:schedule', d, date.toISOString());
      close();
      toast(`Geplant für ${fmtWeekday.format(date)}`);
    } catch (e) {
      setErr(e.message);
    }
  };

  el.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); doSend(); }
    else if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); doSaveDraft(); }
    else if (e.key === 'Escape' && !e.defaultPrevented) { e.stopPropagation(); requestClose(); }
  });
  el.addEventListener('click', async (e) => {
    const x = e.target.closest('[data-x]');
    if (!x) return;
    const r = x.getBoundingClientRect();
    switch (x.dataset.x) {
      case 'cancel': requestClose(); break;
      case 'save-draft': doSaveDraft(); break;
      case 'send': doSend(); break;
      case 'fmt': fmt(x.dataset.cmd); break;
      case 'c-link': {
        const row = $('#c-linkrow', el);
        row.classList.toggle('hidden');
        if (!row.classList.contains('hidden')) $('#c-url', el).focus();
        break;
      }
      case 'c-link-ok': {
        let url = $('#c-url', el).value.trim();
        if (url && !/^(https?:|mailto:|tel:)/i.test(url)) url = url.includes('@') ? `mailto:${url}` : `https://${url}`;
        $('#c-linkrow', el).classList.add('hidden');
        $('#c-url', el).value = '';
        if (!url) break;
        restore();
        const sel = window.getSelection();
        if (!sel.rangeCount || sel.isCollapsed) {
          document.execCommand('insertHTML', false, `<a href="${esc(url)}">${esc(url.replace(/^(mailto|tel):/i, ''))}</a>&nbsp;`);
        } else {
          document.execCommand('createLink', false, url);
        }
        break;
      }
      case 'attach': addFiles(await api.call('files:pick')); break;
      case 'unattach': d.attachments.splice(Number(x.dataset.i), 1); renderFiles(); break;
      case 'snippets': {
        const items = liveSnippets().length
          ? liveSnippets().map((s) => ({ label: s.title || '(ohne Titel)', action: () => {
            if (savedRange) restore(); else { bodyEl.focus(); caretBeforeSignature(); }
            document.execCommand('insertText', false, s.text);
          } }))
          : [{ label: 'Noch keine Textbausteine – in den Einstellungen anlegen', disabled: true, action: () => {} }];
        showMenu(r.left, r.top - 8 - items.length * 33, items);
        break;
      }
      case 'later': {
        const items = sendLaterOptions().map((o) => ({ label: o.title, hint: fmtWeekday.format(o.date), action: () => doSchedule(o.date) }));
        items.push('-', { label: 'Eigener Zeitpunkt …', action: () => {
          const row = $('#c-sched', el);
          row.classList.remove('hidden');
          const inp = $('#c-sched-date', el);
          inp.value = toLocalInput(new Date(Date.now() + 3600e3));
          inp.min = toLocalInput(new Date());
          inp.focus();
        } });
        showMenu(r.left, r.top - 8 - 5 * 33, items);
        break;
      }
      case 'sched-cancel': $('#c-sched', el).classList.add('hidden'); break;
      case 'sched-ok': {
        const date = new Date($('#c-sched-date', el).value);
        if (isNaN(date) || date <= new Date()) { setErr('Bitte einen Zeitpunkt in der Zukunft wählen.'); return; }
        doSchedule(date);
        break;
      }
      default: break;
    }
  });
}

// ---- Einstellungen
function openSettings({ welcome = false, tab = 'accounts', account = null } = {}) {
  const { el, close } = openOverlay(`<div class="dialog settings">
    <div class="dialog-head"><span class="grow">Einstellungen</span>${welcome ? '' : '<button class="icon-btn" data-x="close">✕</button>'}</div>
    ${welcome ? `<div class="welcome">${icon('mail', 'ico" style="width:40px;height:40px;fill:var(--accent)')}<h2>Willkommen bei SimpleMail</h2>
      <p>Richte dein erstes Konto ein. Weitere Konten kannst du später hinzufügen.</p></div>` : ''}
    <div class="tabs">
      <div class="tab" data-tab="accounts">Konten</div>
      <div class="tab" data-tab="snippets">Textbausteine</div>
      <div class="tab" data-tab="rules">Regeln</div>
      <div class="tab" data-tab="calendar">Kalender</div>
      <div class="tab" data-tab="privacy">Darstellung &amp; Datenschutz</div>
      <div class="tab" data-tab="offline">Offline &amp; Sync</div>
    </div>
    <div class="split" id="set-body"></div></div>`, { closable: !welcome });

  let current = tab;
  let selAccount = welcome ? null : (account && findAccount(account) ? account : (S.accounts[0] && S.accounts[0].id) || null);
  let newAccColor = '';   // Farbe für ein noch nicht gespeichertes Konto
  let selSnippet = liveSnippets()[0] ? liveSnippets()[0].id : null;
  let selRule = liveRules()[0] ? liveRules()[0].id : null;

  const renderTab = () => {
    el.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === current));
    const box = $('#set-body', el);
    if (current === 'accounts') box.innerHTML = accountsTab();
    else if (current === 'snippets') box.innerHTML = snippetsTab();
    else if (current === 'rules') { box.innerHTML = rulesTab(); loadRuleFolders(); }
    else if (current === 'calendar') box.innerHTML = calendarTab();
    else if (current === 'offline') { box.innerHTML = offlineTab(); updateCacheSize(); }
    else {
      box.innerHTML = privacyTab();
      showMailHandlerState(el);
      // nicht installierte Programme kennzeichnen
      api.call('apps:installed').then((inst) => {
        el.querySelectorAll('#p-open-doc option').forEach((o) => {
          if (o.value !== 'default') o.textContent = inst[o.value] ? o.dataset.label : `${o.dataset.label} (nicht gefunden)`;
        });
        const find = $('#p-open-find', el);
        if (find) {
          find.innerHTML = Object.entries(OPEN_APP_LABELS).map(([id, label]) =>
            `<button class="btn" data-x="app-find" data-app="${id}" title="${inst[id] ? esc((S.settings.appPaths || {})[id] || 'automatisch gefunden') : 'nicht gefunden'}">${esc(label)} ${inst[id] ? '✓' : 'suchen …'}</button>`).join('');
        }
      }).catch(() => {});
    }
    if (current === 'accounts') fillAccountForm();
    if (current === 'snippets') {
      const s = S.settings.snippets.find((x) => x.id === selSnippet);
      if (s) { $('#sn-title', el).value = s.title; $('#sn-text', el).value = s.text; }
    }
  };

  const accountsTab = () => `<div class="side"><div class="items">
      ${S.accounts.map((a) => `<div class="side-item${a.id === selAccount ? ' active' : ''}" data-x="acc-sel" data-id="${esc(a.id)}">
        <span class="acc-dot" style="background:${accountColor(a)};width:10px;height:10px;margin:0 4px"></span><span class="label">${esc(a.email)}</span>${a.hasPassword ? '' : '<span class="count" style="color:var(--danger)">Passwort fehlt</span>'}${a.allowInvalidCerts ? '<span class="count" style="color:var(--danger)" title="Zertifikat wird nicht geprüft">⚠</span>' : ''}</div>`).join('')}
      ${selAccount === null ? `<div class="side-item active">${icon('person')}<span class="label">Neues Konto</span></div>` : ''}
    </div><div class="side-foot"><button class="btn" data-x="acc-new" title="Konto hinzufügen">＋</button>
      <button class="btn" data-x="acc-del" ${selAccount ? '' : 'disabled'} title="Konto entfernen">－</button></div></div>
    <div class="main"><div class="form-grid">
      <h3>Absender</h3>
      <label>Name</label><input id="f-name">
      <label>E-Mail</label><input id="f-email" placeholder="name@beispiel.de">
      <label>Farbe</label><div id="f-color-box">${swatchesHtml('data-x="acc-color"', (findAccount(selAccount) || {}).color || newAccColor, 'Automatisch')}
        <div class="hint-text" style="margin-top:4px">Kennzeichnet Mails dieses Kontos in Liste und Seitenleiste.</div></div>
      ${selAccount && findAccount(selAccount) && findAccount(selAccount).hasPassword === false ? `<div class="hint-text" style="color:var(--danger)">
        ⚠ Dieses Konto kam per Synchronisation von einem anderen Gerät. Prüfe IMAP- und SMTP-Server unten, bevor du das Passwort eingibst.</div>` : ''}
      <h3>Anmeldung</h3>
      <label>Benutzername</label><input id="f-user">
      <label>Passwort</label><input id="f-pass" type="password" placeholder="${selAccount ? 'leer = unverändert' : 'Passwort / App-Passwort'}">
      <h3>Server</h3>
      <label>Vorlage</label><select id="f-preset"><option value="">– Anbieter wählen –</option>
        <option value="imap.gmail.com|smtp.gmail.com|465">Gmail / Googlemail</option>
        <option value="imap.web.de|smtp.web.de|587">WEB.DE</option>
        <option value="imap.gmx.net|mail.gmx.net|465">GMX</option>
        <option value="outlook.office365.com|smtp.office365.com|587">Outlook.com (nur mit App-Passwort)</option>
        <option value="imap.mail.me.com|smtp.mail.me.com|587">iCloud</option>
        <option value="imap.ionos.de|smtp.ionos.de|465">IONOS</option>
        <option value="secureimap.t-online.de|securesmtp.t-online.de|465">T-Online</option>
        <option value="imap.strato.de|smtp.strato.de|465">Strato</option></select>
      <label>IMAP-Server</label><input id="f-imap">
      <label>IMAP-Port</label><input id="f-imapport" type="number" placeholder="993">
      <label>SMTP-Server</label><input id="f-smtp">
      <label>SMTP-Port</label><input id="f-smtpport" type="number" placeholder="465 (SSL) oder 587 (STARTTLS)">
      <span></span><label class="check"><input type="checkbox" id="f-insecure" style="width:auto"> Zertifikat nicht prüfen (unsicher – nur für eigene Server)</label>
      <span></span><div class="hint-text hidden" id="f-insecure-warn" style="grid-column:auto;color:var(--danger)">⚠ Ohne Zertifikatsprüfung kann jemand im Netzwerk die Verbindung abfangen und dein Passwort mitlesen.</div>
      <h3>Signatur</h3>
      <div class="sig-editor" style="grid-column:1/-1">
        <div class="sig-tools">
          <button class="icon-btn" data-x="sig-cmd" data-cmd="bold" title="Fett"><b>F</b></button>
          <button class="icon-btn" data-x="sig-cmd" data-cmd="italic" title="Kursiv"><i>K</i></button>
          <button class="icon-btn" data-x="sig-cmd" data-cmd="underline" title="Unterstrichen"><u>U</u></button>
          <select id="sig-size" title="Schriftgröße"><option value="">Größe</option><option value="1">Klein</option><option value="3">Normal</option><option value="4">Groß</option><option value="5">Sehr groß</option></select>
          <input type="color" id="sig-color" title="Textfarbe" value="#0f6cbd">
          <button class="icon-btn" data-x="sig-link" title="Link einfügen">🔗 Link</button>
          <button class="icon-btn" data-x="sig-image" title="Bild/Logo einfügen (max. 400 KB)">🖼 Bild</button>
          <button class="icon-btn" data-x="sig-file" title="Fertige Signatur aus einer HTML-Datei laden">📄 HTML-Datei</button>
          <span style="flex:1"></span>
          <label class="check" style="font-size:12px"><input type="checkbox" id="sig-source" style="width:auto"> HTML-Code</label>
        </div>
        <div class="sig-link-row hidden"><input id="sig-url" class="text-input" placeholder="https://www.beispiel.de"><button class="btn" data-x="sig-link-ok">Einfügen</button></div>
        <div id="f-sig" class="sig-area" contenteditable="true" spellcheck="true"></div>
        <textarea id="f-sig-src" class="sig-area hidden" spellcheck="false"></textarea>
      </div>
      <div class="hint-text">Formatierte Signatur mit Logo, Farben und Links. Tipp: eine fertige Signatur aus Outlook oder Word einfach hineinkopieren. Sie wird in neue Mails, Antworten und Weiterleitungen dieses Kontos eingesetzt.</div>
      <div class="hint-text">Gmail: 2-Faktor aktivieren und ein App-Passwort verwenden. WEB.DE/GMX: IMAP im Webmailer unter Einstellungen → POP3/IMAP freischalten.</div>
      <div class="form-actions"><span id="f-status" class="hint-text" style="grid-column:auto"></span><span class="grow"></span>
        <button class="btn" data-x="acc-test">Verbindung testen</button>
        <button class="primary" data-x="acc-save">${selAccount ? 'Speichern' : 'Konto hinzufügen'}</button></div>
    </div></div>`;

  const fillAccountForm = () => {
    const a = findAccount(selAccount) || { imapPort: 993, smtpPort: 465 };
    $('#f-name', el).value = a.displayName || '';
    $('#f-email', el).value = a.email || '';
    $('#f-user', el).value = a.username || '';
    $('#f-imap', el).value = a.imapHost || '';
    $('#f-imapport', el).value = a.imapPort || 993;
    $('#f-smtp', el).value = a.smtpHost || '';
    $('#f-smtpport', el).value = a.smtpPort || 465;
    $('#f-sig', el).innerHTML = a.signatureHtml ? cleanSignatureHtml(a.signatureHtml) : textToHtml(a.signature || '');
    $('#f-insecure', el).checked = !!a.allowInvalidCerts;
    $('#f-insecure-warn', el).classList.toggle('hidden', !a.allowInvalidCerts);
    $('#f-preset', el).addEventListener('change', (e) => {
      if (!e.target.value) return;
      const [imap, smtp, port] = e.target.value.split('|');
      $('#f-imap', el).value = imap;
      $('#f-imapport', el).value = 993;
      $('#f-smtp', el).value = smtp;
      $('#f-smtpport', el).value = port;
      if (!$('#f-user', el).value) $('#f-user', el).value = $('#f-email', el).value;
    });
    $('#f-email', el).focus();
  };

  const formAccount = () => ({
    ...(findAccount(selAccount) || {}),
    id: selAccount || undefined,
    displayName: $('#f-name', el).value.trim(),
    email: $('#f-email', el).value.trim(),
    username: $('#f-user', el).value.trim() || $('#f-email', el).value.trim(),
    imapHost: $('#f-imap', el).value.trim(),
    imapPort: Number($('#f-imapport', el).value) || 993,
    smtpHost: $('#f-smtp', el).value.trim(),
    smtpPort: Number($('#f-smtpport', el).value) || 465,
    signatureHtml: currentSigHtml(),
    signature: htmlToText(currentSigHtml()),
    allowInvalidCerts: $('#f-insecure', el).checked,
    ...(selAccount ? {} : { color: newAccColor }),
  });
  const status = (msg) => { $('#f-status', el).textContent = msg; };
  const currentSigHtml = () => {
    const src = $('#f-sig-src', el);
    const html = src && !src.classList.contains('hidden') ? src.value : ($('#f-sig', el) ? $('#f-sig', el).innerHTML : '');
    return cleanSignatureHtml(html);
  };
  let savedRange = null;
  el.addEventListener('selectionchange', () => {});
  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    const area = $('#f-sig', el);
    if (area && sel.rangeCount && area.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
  });
  const restoreRange = () => {
    const area = $('#f-sig', el);
    area.focus();
    if (savedRange) { const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(savedRange); }
  };
  const sigCmd = (cmd, value) => { restoreRange(); document.execCommand(cmd, false, value); };

  const snippetsTab = () => `<div class="side"><div class="items">
      ${liveSnippets().map((s) => `<div class="side-item${s.id === selSnippet ? ' active' : ''}" data-x="sn-sel" data-id="${esc(s.id)}">
        ${icon('snippet')}<span class="label">${esc(s.title || '(ohne Titel)')}</span></div>`).join('')}
    </div><div class="side-foot"><button class="btn" data-x="sn-new" title="Textbaustein hinzufügen">＋</button>
      <button class="btn" data-x="sn-del" ${selSnippet ? '' : 'disabled'} title="Löschen">－</button></div></div>
    <div class="main">${selSnippet ? `<div class="form-grid">
      <label>Titel</label><input id="sn-title">
      <textarea id="sn-text" style="grid-column:1/-1;min-height:300px" placeholder="Text des Bausteins"></textarea>
      <div class="hint-text">Im Verfassen-Fenster über „Textbaustein“ einfügen – er landet vor Signatur bzw. Zitat.</div></div>`
    : '<div class="empty">Textbausteine für wiederkehrende Antworten<small>z. B. Angebotsanfrage, Lieferzeit, Rückrufbitte – mit ＋ anlegen</small></div>'}</div>`;

  // ---- Regeln
  const FIELD_OPTS = [['from', 'Absender'], ['to', 'Empfänger (An, Kopie, Verteiler)'], ['subject', 'Betreff'], ['any', 'Absender, Empfänger oder Betreff']];
  const OP_OPTS = [['contains', 'enthält'], ['notContains', 'enthält nicht'], ['equals', 'ist gleich'], ['startsWith', 'beginnt mit'], ['endsWith', 'endet mit']];
  const optList = (list, cur) => list.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const curRule = () => (S.settings.rules || []).find((r) => r.id === selRule);
  const ruleSummary = (r) => {
    const acc = S.accounts.find((a) => a.email.toLowerCase() === String(r.accountEmail || '').toLowerCase());
    const t = r.actions && r.actions.moveTo;
    const f = r.actions && r.actions.forwardTo;
    const cp = r.actions && r.actions.copyTo ? ` · Kopie → ${r.actions.copyAccount}: ${r.actions.copyTo}` : '';
    return `${acc ? acc.email : 'kein Konto'}${t ? ` → ${t}` : ''}${cp}${f ? ` · weiterleiten an ${f}` : ''}`;
  };
  const rulesTab = () => {
    const r = curRule();
    const accOpts = S.accounts.map((a) => `<option value="${esc(a.email.toLowerCase())}" ${r && a.email.toLowerCase() === String(r.accountEmail).toLowerCase() ? 'selected' : ''}>${esc(a.email)}</option>`).join('');
    return `<div class="side"><div class="items">
      ${liveRules().map((x) => `<div class="side-item${x.id === selRule ? ' active' : ''}" data-x="ru-sel" data-id="${esc(x.id)}" title="${esc(ruleSummary(x))}">
        ${icon('folder')}<span class="label" style="${x.enabled === false ? 'opacity:.5' : ''}">${esc(x.name || '(ohne Name)')}</span></div>`).join('')}
    </div><div class="side-foot"><button class="btn" data-x="ru-new" title="Regel hinzufügen">＋</button>
      <button class="btn" data-x="ru-del" ${selRule ? '' : 'disabled'} title="Regel löschen">－</button>
      <button class="btn" data-x="ru-up" ${selRule ? '' : 'disabled'} title="Nach oben (wird früher geprüft)">↑</button>
      <button class="btn" data-x="ru-down" ${selRule ? '' : 'disabled'} title="Nach unten">↓</button></div></div>
    <div class="main">${r ? `<div class="form-grid rule-form">
      <label>Name</label><input id="ru-name" value="${esc(r.name || '')}">
      <span></span><label class="check"><input type="checkbox" id="ru-enabled" style="width:auto" ${r.enabled !== false ? 'checked' : ''}> Regel ist aktiv</label>
      <label>Konto</label><select id="ru-account">${accOpts}</select>
      <h3>Wenn</h3>
      <div style="grid-column:1/-1"><select id="ru-match" style="width:auto">${optList([['all', 'alle'], ['any', 'eine']], r.match)}</select> der folgenden Bedingungen zutreffen:</div>
      <div class="rule-conds" style="grid-column:1/-1">
        ${(r.conditions || []).map((c, i) => `<div class="rule-cond" data-i="${i}">
          <select data-k="field">${optList(FIELD_OPTS, c.field)}</select>
          <select data-k="op">${optList(OP_OPTS, c.op)}</select>
          <input data-k="value" value="${esc(c.value || '')}" placeholder="z. B. @hth-hydraulik.de">
          <button class="btn" data-x="ru-cond-del" data-i="${i}" title="Bedingung entfernen">－</button></div>`).join('')}
        <button class="btn" data-x="ru-cond-add">＋ Bedingung</button>
      </div>
      <h3>Dann</h3>
      <label>Verschieben in</label><select id="ru-move"><option value="">– nicht verschieben –</option></select>
      <label>Kopie ablegen in</label><div style="display:flex;gap:6px;min-width:0">
        <select id="ru-copy-acc" style="flex:1;min-width:0"><option value="">– keine Kopie –</option>${S.accounts.map((a) => `<option value="${esc(a.email.toLowerCase())}" ${r.actions && String(r.actions.copyAccount || '').toLowerCase() === a.email.toLowerCase() ? 'selected' : ''}>${esc(a.email)}</option>`).join('')}</select>
        <select id="ru-copy" style="flex:1;min-width:0" ${r.actions && r.actions.copyAccount ? '' : 'disabled'}><option value="">– Ordner wählen –</option></select></div>
      <div class="hint-text">Kopie: Die Mail bleibt im Posteingang (bzw. wird wie oben verschoben) und wird zusätzlich in den Ordner eines beliebigen Kontos kopiert – z. B. Mails ans Vorstand-Postfach zusätzlich in einen Ordner deines privaten Kontos.</div>
      <span></span><label class="check"><input type="checkbox" id="ru-read" style="width:auto" ${r.actions && r.actions.markRead ? 'checked' : ''}> Als gelesen markieren</label>
      <span></span><label class="check"><input type="checkbox" id="ru-flag" style="width:auto" ${r.actions && r.actions.flag ? 'checked' : ''}> Markieren (Stern)</label>
      <label>Weiterleiten an</label><input id="ru-forward" value="${esc((r.actions && r.actions.forwardTo) || '')}" placeholder="z. B. buero@firma.de (mehrere mit Komma) – leer = nicht weiterleiten">
      <div class="hint-text">Die Mail wird über dieses Konto als „WG:“ weitergeleitet (Original mit allen Anhängen als .eml dabei). Nur bei neu eingehenden Mails; Weiterleitungen werden nie erneut weitergeleitet.</div>
      <div class="hint-text" style="grid-column:1/-1">Mehrere Begriffe in einer Bedingung mit Komma trennen – einer davon muss passen. Regeln gelten für neu eingehende E-Mails im Posteingang. Es greift die erste passende Regel – Reihenfolge mit ↑ ↓ ändern.
        Regeln werden mit „Offline &amp; Sync“ auf deine anderen Geräte übertragen.</div>
      <div style="grid-column:1/-1;display:flex;gap:8px;align-items:center"><button class="btn" data-x="ru-run">Alle Regeln jetzt auf den Posteingang anwenden</button>
        <span id="ru-status" class="hint-text"></span></div>
    </div>`
    : '<div class="empty">Regeln sortieren E-Mails automatisch ein<small>z. B. alles von @lieferant.de in den Ordner „Lieferanten“ – mit ＋ anlegen</small></div>'}</div>`;
  };
  const loadRuleFolders = async () => {
    const r = curRule();
    const sel = $('#ru-move', el);
    if (!r || !sel) return;
    const acc = S.accounts.find((a) => a.email.toLowerCase() === String(r.accountEmail || '').toLowerCase());
    if (!acc) return;
    let folders = S.folders[acc.id];
    if (!folders || !folders.length) { try { folders = await api.call('mail:folders', acc.id); S.folders[acc.id] = folders; } catch { folders = []; } }
    const target = (r.actions && r.actions.moveTo) || '';
    const opts = folders.filter((f) => f.selectable && f.path.toUpperCase() !== 'INBOX')
      .map((f) => `<option value="${esc(f.path)}" ${f.path === target ? 'selected' : ''}>${'\u00a0\u00a0'.repeat(f.depth || 0)}${esc(f.name)}</option>`).join('');
    const missing = target && !folders.some((f) => f.path === target) ? `<option value="${esc(target)}" selected>${esc(target)} (nicht gefunden)</option>` : '';
    if ($('#ru-move', el) === sel) sel.innerHTML = '<option value="">– nicht verschieben –</option>' + missing + opts;
    // Ordner für „Kopie ablegen in“ (beliebiges Konto)
    const csel = $('#ru-copy', el);
    const cAcc = S.accounts.find((a) => a.email.toLowerCase() === String((r.actions && r.actions.copyAccount) || '').toLowerCase());
    if (!csel || !cAcc) return;
    let cf = S.folders[cAcc.id];
    if (!cf || !cf.length) { try { cf = await api.call('mail:folders', cAcc.id); S.folders[cAcc.id] = cf; } catch { cf = []; } }
    const ct = r.actions.copyTo || '';
    const copts = cf.filter((f) => f.selectable)
      .map((f) => `<option value="${esc(f.path)}" ${f.path === ct ? 'selected' : ''}>${'\u00a0\u00a0'.repeat(f.depth || 0)}${esc(f.name)}</option>`).join('');
    const cmissing = ct && !cf.some((f) => f.path === ct) ? `<option value="${esc(ct)}" selected>${esc(ct)} (nicht gefunden)</option>` : '';
    if ($('#ru-copy', el) === csel) csel.innerHTML = '<option value="">– Ordner wählen –</option>' + cmissing + copts;
  };
  const saveRule = () => {
    const r = curRule();
    if (!r) return;
    r.updatedAt = now();
    clearTimeout(openSettings.rt);
    openSettings.rt = setTimeout(saveSettings, 400);
  };
  const readRuleForm = () => {
    const r = curRule();
    if (!r || !$('#ru-name', el)) return;
    r.name = $('#ru-name', el).value;
    r.enabled = $('#ru-enabled', el).checked;
    r.accountEmail = $('#ru-account', el).value;
    r.match = $('#ru-match', el).value;
    r.conditions = [...el.querySelectorAll('.rule-cond')].map((row) => ({
      field: $('[data-k="field"]', row).value, op: $('[data-k="op"]', row).value, value: $('[data-k="value"]', row).value,
    }));
    r.actions = { moveTo: $('#ru-move', el).value, markRead: $('#ru-read', el).checked, flag: $('#ru-flag', el).checked,
      forwardTo: $('#ru-forward', el).value.trim(),
      copyAccount: $('#ru-copy-acc', el).value, copyTo: $('#ru-copy-acc', el).value ? $('#ru-copy', el).value : '' };
    const item = el.querySelector(`[data-x="ru-sel"][data-id="${CSS.escape(r.id)}"] .label`);
    if (item) { item.textContent = r.name || '(ohne Name)'; item.style.opacity = r.enabled ? '' : '.5'; }
    saveRule();
  };
  const onRuleEdit = (e) => {
    if (current !== 'rules' || !e.target.closest('.rule-form')) return;
    const accountChanged = e.target.id === 'ru-account';
    readRuleForm();
    if (accountChanged) { const r = curRule(); r.actions.moveTo = ''; loadRuleFolders(); }
    if (e.target.id === 'ru-copy-acc') {
      const r = curRule(); r.actions.copyTo = '';
      const cs = $('#ru-copy', el); cs.disabled = !r.actions.copyAccount; cs.innerHTML = '<option value="">– Ordner wählen –</option>';
      saveRule(); loadRuleFolders();
    }
  };
  el.addEventListener('input', onRuleEdit);
  el.addEventListener('change', onRuleEdit);

  const calendarTab = () => `<div class="main"><div class="form-grid">
      <h3>Google Kalender – direkte Verbindung (lesen und eintragen)</h3>
      ${S.google.connected ? `
      <label>Client-ID</label><input id="g-id-show" value="${esc(S.google.clientId || '')}" readonly title="Wird mit deinen anderen Windows-PCs synchronisiert">
      <label>Clientschlüssel</label><input id="g-secret-show" type="password" value="${S.google.hasSecret ? '••••••••••••' : ''}" readonly placeholder="nicht gespeichert">
      <span></span><div class="hint-text">Client-ID und Schlüssel sind gespeichert und werden per Sync an deine anderen Windows-PCs übertragen.
        Zum Ändern: „Verbindung trennen“, neue Werte eintragen, neu verbinden.</div>
      <span></span><div class="google-ok">✓ Verbunden mit <b>${esc(S.google.email || 'Google-Konto')}</b>. Termine werden gelesen, neue Termine
        und angenommene Einladungen direkt eingetragen.</div>
      ${S.google.connectedAt ? `<span></span><div class="hint-text" id="g-due">Angemeldet am ${esc(new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(S.google.connectedAt)))} Uhr.
        Die App ist bei Google im Testmodus – die Anmeldung gilt 7 Tage, also bis <b>${esc(fmtGoogleDue(S.google.expiresAt))}</b>${S.google.expired ? ' (bereits abgelaufen)' : ''}.</div>` : ''}
      <span></span><label class="check"><input type="checkbox" id="g-remind" data-x="g-remind" style="width:auto"${S.google.remind ? ' checked' : ''}> Rechtzeitig an die Neuanmeldung erinnern (ab Tag 6, Hinweis oben im Fenster)</label>
      <span></span><div style="display:flex;gap:8px;align-items:center"><button class="btn" data-x="g-reconnect">${icon('calendar')} Jetzt neu anmelden</button><button class="btn" data-x="g-disconnect">Verbindung trennen</button>
        <span id="g-status" class="hint-text"></span></div>` : `
      <label>Client-ID</label><input id="g-id" value="${esc(S.google.clientId || '')}" placeholder="123456-abc….apps.googleusercontent.com" autocomplete="off">
      <label>Clientschlüssel</label><input id="g-secret" type="password" placeholder="${S.google.hasSecret ? 'gespeichert – leer lassen' : 'GOCSPX-…'}" autocomplete="off">
      ${S.google.hasSecret && S.google.clientId ? `<span></span><div class="hint-text" id="g-saved">Zugangsschlüssel sind gespeichert (auch von einem anderen PC per Synchronisation) – nur noch „Mit Google verbinden“ klicken.</div>` : ''}
      <span></span><div style="display:flex;gap:8px;align-items:center"><button class="primary" data-x="g-connect">Mit Google verbinden</button>
        <span id="g-status" class="hint-text"></span></div>
      <details class="g-help" style="grid-column:1/-1"><summary>Anleitung: Client-ID und Clientschlüssel anlegen (einmalig, ca. 10 Minuten)</summary>
        <div>Mit deinem Google-Konto anmelden und die Links nacheinander öffnen. Oben links muss jeweils das Projekt <b>SimpleMail</b> ausgewählt sein.</div>
        <ol>
          <li><b>Projekt anlegen:</b> <a data-ext href="https://console.cloud.google.com/projectcreate">console.cloud.google.com/projectcreate</a>
            → Name „SimpleMail“ → <b>Erstellen</b>.</li>
          <li><b>Kalender-Schnittstelle einschalten:</b>
            <a data-ext href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com">…/apis/library/calendar-json.googleapis.com</a> → <b>Aktivieren</b>.</li>
          <li><b>App registrieren:</b> <a data-ext href="https://console.cloud.google.com/auth/overview">console.cloud.google.com/auth/overview</a>
            → <b>Jetzt starten</b> → App-Name „SimpleMail“, Support-E-Mail = deine Gmail-Adresse → Zielgruppe <b>Extern</b> → Kontakt-E-Mail → zustimmen → <b>Erstellen</b>.
            <i>Nicht veröffentlichen</i> – die App bleibt im Testmodus.</li>
          <li><b>Zugangsschlüssel:</b> <a data-ext href="https://console.cloud.google.com/auth/clients">console.cloud.google.com/auth/clients</a>
            → <b>Client erstellen</b> → Anwendungstyp <b>Desktop-App</b> → Name „SimpleMail“ → <b>Erstellen</b>.
            <b>Client-ID</b> und <b>Clientschlüssel</b> sofort kopieren (der Schlüssel wird nur einmal angezeigt) und oben einfügen.</li>
          <li><b>Mit Google verbinden</b> klicken → im Browser anmelden → bei „Google hat diese App nicht überprüft“
            <b>Erweitert → Weiter zu SimpleMail (unsicher)</b> → Kalender-Zugriff erlauben.</li>
        </ol>
        <div><b>Falls Google „Zugriff blockiert“ / „Error 403: access_denied“ meldet:</b> unter
          <a data-ext href="https://console.cloud.google.com/auth/audience">…/auth/audience</a> bei <b>Testnutzer → Nutzer hinzufügen</b> deine Adresse eintragen
          (Endung <b>@gmail.com</b>, nicht @googlemail.com) und erneut verbinden.</div>
        <div><b>Alle 7 Tage</b> verlangt Google im Testmodus eine neue Anmeldung: In der Terminspalte erscheint dann <b>„Neu anmelden“</b> – ein Klick,
          kurz im Browser bestätigen. Client-ID und Schlüssel bleiben gespeichert.</div>
        <div><b>Neuer PC / Neuinstallation:</b> Mit eingeschalteter Synchronisation kommen Client-ID und Schlüssel automatisch. Ohne Synchronisation findest du sie wieder unter <a data-ext href="https://console.cloud.google.com/auth/clients">…/auth/clients</a>
          (Client „SimpleMail“ öffnen; ist der Schlüssel nicht mehr sichtbar, dort <b>„Secret hinzufügen“</b> und den neuen verwenden).</div>
        <div>Client-ID und Schlüssel werden verschlüsselt gespeichert und mit der Synchronisation (falls eingeschaltet) an deine anderen Windows-PCs übertragen.
          Die Google-Anmeldung selbst gilt nur für diesen PC – auf jedem PC einmal „Mit Google verbinden“ klicken.</div></details>`}
      <h3>Alternativ: nur lesen über iCal-Adresse</h3>
      <label>iCal-Adresse</label><input id="cal-url" type="password" value="${esc(S.settings.calendar.icsUrl || '')}" placeholder="https://calendar.google.com/calendar/ical/…/private-…/basic.ics" autocomplete="off">
      <span></span><div style="display:flex;gap:8px;align-items:center">
        <button class="primary" data-x="cal-save">Speichern &amp; testen</button>
        <button class="btn" data-x="cal-show">Anzeigen</button>
        <button class="btn" data-x="cal-clear">Entfernen</button>
        <span id="cal-status" class="hint-text"></span></div>
      <div class="hint-text" style="grid-column:1/-1;line-height:1.6">
        <b>So findest du die Adresse:</b> calendar.google.com öffnen → Zahnrad → <b>Einstellungen</b> → links deinen Kalender wählen →
        ganz unten <b>„Privatadresse im iCal-Format“</b> → kopieren und hier einfügen.<br>
        Die Termine der nächsten 14 Tage erscheinen dann rechts in der Terminspalte (Kalender-Knopf oben über der Liste). Die Adresse bleibt nur auf diesem PC gespeichert
        (sie wird nicht synchronisiert) – wer sie kennt, kann deinen Kalender lesen.<br>
        Ohne direkte Verbindung öffnen <b>neue Termine</b> („Termin“ in einer E-Mail oder „In Google Kalender“ bei Einladungen) Google Kalender im Browser mit allen Angaben vorausgefüllt.
      </div>
      <h3>Online-Meetings</h3>
      <label>Standard bei neuen Terminen</label><select id="mt-default">
        ${MEETING_CHOICES.map(([id, l]) => `<option value="${id}" ${meetingLinks().default === id ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      ${[['teams', 'Mein Teams-Link'], ['zoom', 'Mein Zoom-Raum'], ['webex', 'Mein Webex-Raum'], ['meet', 'Mein Meet-Link']].map(([id, l]) =>
        `<label>${l}</label><input id="mt-${id}" class="mt-link" value="${esc(meetingLinks()[id] || '')}" placeholder="https://…" autocomplete="off">`).join('')}
      <div class="hint-text" style="grid-column:1/-1;line-height:1.6">
        Feste Links (z. B. persönlicher Zoom-Meetingraum, Webex-Raum oder ein wiederverwendbarer Teams-Link) werden bei „Neuer Termin / Online-Meeting“
        (Terminspalte ＋, Datei-Menü oder Strg+Umschalt+M) automatisch eingesetzt. <b>Google Meet</b> legt bei verbundenem Google Kalender selbst einen neuen Link an,
        <b>Jitsi</b> erzeugt einen Raum ohne Konto. Teilnehmer erhalten eine Einladung (.ics), die Outlook, Apple Kalender und Google direkt annehmen können;
        ihre Zu- oder Absagen kommen als E-Mail zurück. Die Links werden mit dem Mac synchronisiert.
      </div></div></div>`;

  const offlineTab = () => {
    const o = S.settings.offline;
    const sy = S.settings.sync;
    const st = S.syncStatus || {};
    const opts = (vals, cur, fmt) => vals.map((v) => `<option value="${v}" ${Number(cur) === v ? 'selected' : ''}>${fmt(v)}</option>`).join('');
    return `<div class="main"><div class="form-grid">
      <h3>Offline-Ablage</h3>
      <label class="check" style="grid-column:1/-1"><input type="checkbox" id="o-enabled" style="width:auto" ${o.enabled ? 'checked' : ''}>
        E-Mails lokal speichern (schneller Start, Lesen ohne Internet)</label>
      <label>Offline lesbar</label><select id="o-keep">${opts([50, 100, 250, 500, 1000], o.keep, (v) => `neueste ${v} Mails je Posteingang`)}</select>
      <label>Speichergrenze</label><select id="o-limit">${opts([250, 500, 1000, 2000, 5000], o.limitMB, (v) => (v >= 1000 ? `${v / 1000} GB` : `${v} MB`))}</select>
      <label>Belegt</label><div style="display:flex;gap:8px;align-items:center"><span id="o-size">…</span><span style="flex:1"></span><button class="btn" data-x="o-clear">Ablage leeren</button></div>
      <div class="hint-text">Ordnerlisten und geöffnete Mails werden immer gespeichert; die neuesten Mails des Posteingangs zusätzlich im Hintergrund. Ohne Verbindung zeigt SimpleMail den gespeicherten Stand.</div>
      <h3>Synchronisation zwischen Geräten (Mac ↔ Windows)</h3>
      <label class="check" style="grid-column:1/-1"><input type="checkbox" id="y-enabled" style="width:auto" ${sy.enabled ? 'checked' : ''}>
        Einstellungen mit meinen anderen Geräten abgleichen</label>
      <label>Über Konto</label><select id="y-account"><option value="">– Konto wählen –</option>${S.accounts.map((a) =>
        `<option value="${esc(a.email.toLowerCase())}" ${a.email.toLowerCase() === (sy.accountEmail || '').toLowerCase() ? 'selected' : ''}>${esc(a.email)}</option>`).join('')}</select>
      <label>Status</label><div style="display:flex;gap:8px;align-items:center"><span id="y-status">${st.lastError ? `⚠ ${esc(st.lastError)}`
        : st.lastSync ? `Zuletzt: ${esc(fmtFull.format(new Date(st.lastSync)))}` : 'Noch nicht synchronisiert'}</span>
        <span style="flex:1"></span><button class="btn" data-x="y-now" ${sy.enabled ? '' : 'disabled'}>Jetzt synchronisieren</button></div>
      <label>Verschlüsselung</label><div style="display:flex;gap:8px;align-items:center">
        <input id="y-pass" type="password" class="text-input" placeholder="${st.hasPassphrase ? '🔒 Sync-Passwort ist gesetzt' : 'Sync-Passwort (optional)'}" style="flex:1">
        <button class="btn" data-x="y-pass-set">${st.hasPassphrase ? 'Ändern' : 'Setzen'}</button>
        ${st.hasPassphrase ? '<button class="btn danger" data-x="y-pass-clear">Entfernen</button>' : ''}</div>
      <div class="hint-text">Mit Sync-Passwort wird der Abgleich mit AES-256 verschlüsselt im Postfach abgelegt – wer dein Postfach einsehen kann, liest dann nichts mit. Auf allen Geräten dasselbe Sync-Passwort eintragen. Es ist nicht wiederherstellbar.</div>
      <div class="hint-text">Abgeglichen werden Konten (ohne Passwörter), Signaturen, Textbausteine, Erinnerungen und Bild-Freigaben – über einen versteckten Ordner „SimpleMail-Sync“ in deinem eigenen Postfach, ohne fremde Cloud. Auf allen Geräten dasselbe Konto wählen. Passwörter gibst du auf jedem Gerät einmal selbst ein. Geänderte Serverdaten vom anderen Gerät werden erst nach deiner Bestätigung übernommen.</div>
      <div class="hint-text">Tipp: Schalte die Laufwerksverschlüsselung ein (Windows: BitLocker bzw. „Geräteverschlüsselung“), damit auch die Offline-Ablage geschützt ist.</div>
    </div></div>`;
  };
  const updateCacheSize = async () => {
    try {
      const info = await api.call('cache:info');
      const e = $('#o-size', el);
      if (e) e.textContent = fmtSize(info.bytes);
    } catch { /* egal */ }
  };

  const privacyTab = () => `<div class="main"><div class="form-grid">
      <h3>Darstellung</h3>
      <label>Zeilen je E-Mail</label><select id="v-lines">
        <option value="1" ${S.settings.listLines === 1 ? 'selected' : ''}>1 Zeile – kompakt (Absender · Betreff)</option>
        <option value="2" ${S.settings.listLines === 2 ? 'selected' : ''}>2 Zeilen – Absender, Betreff</option>
        <option value="3" ${S.settings.listLines === 3 ? 'selected' : ''}>3 Zeilen – mit Textvorschau</option></select>
      <div class="hint-text">Die Textvorschau steht für alle Mails bereit, die in der Offline-Ablage liegen (standardmäßig die neuesten 100 je Posteingang) oder schon geöffnet wurden. Auch über das Menü Ansicht → Zeilen je E-Mail.</div>
      <h3>Standard-Mailprogramm</h3>
      <label>E-Mail-Links (mailto)</label><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn" data-x="mail-default" id="p-mail-default">Als Standard-Mailprogramm festlegen …</button>
        <span class="hint-text" id="p-mail-state" style="margin:0"></span></div>
      <div class="hint-text">Meldet SimpleMail bei Windows als Mailprogramm an und öffnet „Standard-Apps“. Dort bei „SimpleMail“ auf „Als Standard festlegen“ klicken (oder unter „MAILTO“ SimpleMail wählen) – Windows erlaubt das nur per Klick. Danach öffnen E-Mail-Links aus Browser und anderen Programmen den SimpleMail-Editor.</div>
      <h3>Anhänge öffnen</h3>
      <label>Word-Dokumente (.docx, .doc, .odt, .rtf)</label><select id="p-open-doc">
        ${[['default', 'Standard-App von Windows'], ...Object.entries(OPEN_APP_LABELS)].map(([id, label]) =>
          `<option value="${id}" data-label="${esc(label)}" ${((S.settings.openWith || {}).doc || 'default') === id ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>
      <div></div><div style="display:flex;gap:6px;flex-wrap:wrap" id="p-open-find"></div>
      <label>PDF</label><div class="hint-text" style="margin:0;align-self:center">Standard-PDF-Reader von Windows</div>
      <div class="hint-text">Ein Klick auf den Anhang öffnet ihn mit diesem Programm. Ist es nicht installiert, wird die Standard-App genommen. Rechtsklick → „Öffnen mit …“ für ein anderes Programm. Die Wahl wird mit dem Mac synchronisiert.</div>
      <h3>Datenschutz</h3>
      <label class="check" style="grid-column:1/-1"><input type="checkbox" id="p-block" style="width:auto" ${S.settings.blockImages ? 'checked' : ''}>
        Externe Inhalte in HTML-Mails blockieren (empfohlen)</label>
      <div class="hint-text">Bilder, Schriften und Stile von fremden Servern werden erst nach „Bilder laden“ oder für vertraute Absender geladen. Eingebettete Bilder erscheinen immer.</div>
      <div class="hint-text" style="grid-column:1/-1">Immer aktiv: Zählpixel und bekannte Tracking-Dienste werden entfernt, Bilder ohne Cookies, Referrer und Programmkennung geladen, Tracking-Parameter (utm_* usw.) beim Öffnen von Links gelöscht.</div>
      <h3>Spamfilter</h3>
      <label class="check" style="grid-column:1/-1"><input type="checkbox" id="p-spam" style="width:auto" ${spamFilter().enabled ? 'checked' : ''}>
        Erkannten Spam automatisch in den Spam-Ordner verschieben</label>
      <label>Empfindlichkeit</label><select id="p-spam-level" ${spamFilter().enabled ? '' : 'disabled'}>
        ${[['low', 'Niedrig – nur eindeutiger Spam'], ['medium', 'Mittel (empfohlen)'], ['high', 'Hoch – sortiert mehr aus']].map(([v, l]) =>
          `<option value="${v}" ${spamFilter().level === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <div class="hint-text">Neue E-Mails im Posteingang werden geprüft: Spam-Kennzeichnung des Mailservers, fehlgeschlagene Absenderprüfung (SPF/DKIM/DMARC), nachgeahmte Firmen und typische Spam-Betreffs. Fehlt ein Spam-Ordner, wird „Spam“ angelegt. Kontakte, eigene Adressen und vertrauenswürdige Absender werden nie aussortiert. Irrtum? Im Spam-Ordner „Kein Spam“ wählen – der Absender wird dann vertrauenswürdig. Die Einstellung wird mit dem Mac synchronisiert.</div>
      <h3>Vertrauenswürdige Absender (Bilder laden, nie Spam)</h3>
      <div style="grid-column:1/-1">${Object.keys(S.settings.trusted).filter(isTrusted).length ? Object.keys(S.settings.trusted).filter(isTrusted).sort().map((t) => `<div class="trusted"><span>${esc(t)}</span>
        <button class="icon-btn" data-x="untrust" data-addr="${esc(t)}">✕</button></div>`).join('')
        : '<div class="hint-text">Noch keine – in einer Mail „Immer für diesen Absender“ wählen.</div>'}</div>
      <h3>Absender mit fester Kategorie</h3>
      <div style="grid-column:1/-1">${Object.entries(S.settings.senderCats || {}).filter(([, v]) => v && !v.deleted).length
        ? Object.entries(S.settings.senderCats || {}).filter(([, v]) => v && !v.deleted).sort((a, b) => a[0].localeCompare(b[0])).map(([t, v]) => `<div class="trusted"><span>${esc(t)} → ${esc((CATEGORIES.find((c) => c.id === v.category) || {}).title || v.category)}</span>
        <button class="icon-btn" data-x="uncat" data-addr="${esc(t)}" title="Wieder automatisch einsortieren">✕</button></div>`).join('')
        : '<div class="hint-text">Noch keine – eine Mail auf „Persönlich“, „Benachrichtigungen“ oder „Newsletter“ ziehen.</div>'}</div>
      <h3>Gesperrte Absender (landen automatisch im Spam)</h3>
      <div style="grid-column:1/-1">${Object.keys(S.settings.blocked).filter(isBlockedAddr).length ? Object.keys(S.settings.blocked).filter(isBlockedAddr).sort().map((t) => `<div class="trusted"><span>${esc(t)}</span>
        <button class="icon-btn" data-x="unblock" data-addr="${esc(t)}" title="Sperre aufheben">✕</button></div>`).join('')
        : '<div class="hint-text">Noch keine – in einer Mail „Spam“ → „Absender sperren“ wählen.</div>'}</div>
      <div style="grid-column:1/-1;display:flex;gap:6px"><input id="bl-new" placeholder="name@firma.de oder @firma.de" style="flex:1">
        <button class="btn" data-x="block-add">Sperren</button></div>
    </div></div>`;

  // Textbausteine live speichern
  el.addEventListener('input', (e) => {
    if (e.target.id === 'sn-title' || e.target.id === 'sn-text') {
      const s = S.settings.snippets.find((x) => x.id === selSnippet);
      if (!s) return;
      s.title = $('#sn-title', el).value;
      s.text = $('#sn-text', el).value;
      s.updatedAt = now();
      clearTimeout(openSettings.t);
      openSettings.t = setTimeout(saveSettings, 400);
      const item = el.querySelector(`[data-x="sn-sel"][data-id="${CSS.escape(s.id)}"] .label`);
      if (item) item.textContent = s.title || '(ohne Titel)';
    }
  });
  el.addEventListener('change', async (e) => {
    const id = e.target.id;
    if (id === 'v-lines') {
      setListLines(Number(e.target.value));
    } else if (id === 'p-open-doc') {
      S.settings.openWith = { ...(S.settings.openWith || {}), doc: e.target.value };
      S.settings.openWithUpdatedAt = now();
      saveSettings();
      renderDetail(true);
    } else if (id === 'mt-default' || id.startsWith('mt-')) {
      const v = { default: $('#mt-default', el).value };
      let bad = '';
      for (const k of ['teams', 'zoom', 'webex', 'meet']) {
        const u = $(`#mt-${k}`, el).value.trim();
        if (u && !/^https:\/\/\S+$/i.test(u)) { bad = k; continue; }
        v[k] = u;
      }
      if (bad) { showError('Der Link muss mit https:// beginnen.'); return; }
      S.settings.meetingLinks = v;
      S.settings.meetingLinksUpdatedAt = now();
      saveSettings();
    } else if (id === 'p-spam' || id === 'p-spam-level') {
      S.settings.spamFilter = { enabled: $('#p-spam', el).checked, level: $('#p-spam-level', el).value };
      S.settings.spamFilterUpdatedAt = now();
      $('#p-spam-level', el).disabled = !S.settings.spamFilter.enabled;
      saveSettings();
    } else if (id === 'p-block') {
      S.settings.blockImages = e.target.checked;
      S.settings.blockImagesUpdatedAt = now();
      saveSettings();
      renderDetail(true);
    } else if (id === 'o-enabled' || id === 'o-keep' || id === 'o-limit') {
      S.settings.offline = { enabled: $('#o-enabled', el).checked, keep: Number($('#o-keep', el).value), limitMB: Number($('#o-limit', el).value) };
      await saveSettings({ sync: false });
      if (!S.settings.offline.enabled) { await api.call('cache:clear'); updateCacheSize(); }
    } else if (id === 'y-enabled' || id === 'y-account') {
      S.settings.sync = { enabled: $('#y-enabled', el).checked, accountEmail: $('#y-account', el).value };
      if (S.settings.sync.enabled && !S.settings.sync.accountEmail && S.accounts[0]) {
        S.settings.sync.accountEmail = S.accounts[0].email.toLowerCase();
      }
      await saveSettings({ sync: false });
      renderTab();
      if (S.settings.sync.enabled) { $('#y-status', el).textContent = 'Synchronisiere …'; await runSync(); renderTab(); }
    } else if (id === 'f-insecure') {
      if (e.target.checked) {
        const ok = await confirmDialog({
          title: 'Zertifikatsprüfung abschalten?', danger: true, ok: 'Abschalten', cancel: 'Abbrechen',
          text: 'Nur für eigene Server mit selbst erstelltem Zertifikat sinnvoll. Bei Gmail, WEB.DE, GMX & Co. <b>niemals</b> nötig – dort deutet ein Zertifikatsfehler auf einen Angriff oder ein falsches Netzwerk hin.',
        });
        if (!ok) e.target.checked = false;
      }
      $('#f-insecure-warn', el).classList.toggle('hidden', !e.target.checked);
    } else if (id === 'sig-source') {
      const area = $('#f-sig', el);
      const src = $('#f-sig-src', el);
      if (e.target.checked) { src.value = area.innerHTML; src.classList.remove('hidden'); area.classList.add('hidden'); }
      else { area.innerHTML = cleanSignatureHtml(src.value); src.classList.add('hidden'); area.classList.remove('hidden'); }
    } else if (id === 'sig-size' && e.target.value) {
      sigCmd('fontSize', e.target.value);
      e.target.value = '';
    } else if (id === 'sig-color') {
      sigCmd('foreColor', e.target.value);
    }
  });
  // Einfügen in den Signatur-Editor: Skripte usw. entfernen
  el.addEventListener('paste', (e) => {
    if (e.target.closest && e.target.closest('#f-sig')) {
      const html = e.clipboardData.getData('text/html');
      if (html) { e.preventDefault(); document.execCommand('insertHTML', false, cleanSignatureHtml(html)); }
    }
  });

  el.addEventListener('click', async (e) => {
    const tabEl = e.target.closest('.tab');
    if (tabEl) { current = tabEl.dataset.tab; renderTab(); return; }
    const x = e.target.closest('[data-x]');
    if (!x) return;
    switch (x.dataset.x) {
      case 'close': close(); break;
      case 'mail-default':
        try {
          await api.call('mailhandler:register');
          toast('Windows-Einstellungen geöffnet: bei SimpleMail „Als Standard festlegen“ klicken.');
          // nach der Rückkehr aus den Einstellungen den Stand neu zeigen
          setTimeout(() => showMailHandlerState(el), 4000);
          window.addEventListener('focus', () => showMailHandlerState(el), { once: true });
        } catch (err) { showError(`Anmelden als Mailprogramm fehlgeschlagen: ${err.message}`); }
        break;
      case 'acc-sel': selAccount = x.dataset.id; renderTab(); break;
      case 'acc-new': selAccount = null; newAccColor = ''; renderTab(); break;
      case 'acc-color': {
        const color = validColor(x.dataset.color);
        if (!selAccount) { newAccColor = color; } else {
          try {
            const saved = await api.call('accounts:setColor', selAccount, color);
            const i = S.accounts.findIndex((a) => a.id === saved.id);
            if (i >= 0) S.accounts[i] = saved;
            scheduleSync(1500);
            renderAll();
          } catch (err) { status(`Fehler: ${err.message}`); break; }
        }
        const cur = selAccount ? (findAccount(selAccount) || {}).color : newAccColor;
        el.querySelectorAll('[data-x="acc-color"]').forEach((b) => b.classList.toggle('active', (b.dataset.color || '') === (validColor(cur) || '')));
        break;
      }
      case 'acc-del': {
        const a = findAccount(selAccount);
        if (!a || !confirm(`Konto ${a.email} entfernen?\n\nDie E-Mails bleiben auf dem Server erhalten.`)) return;
        await api.call('accounts:remove', a.id);
        scheduleSync(1500);
        S.accounts = S.accounts.filter((x2) => x2.id !== a.id);
        delete S.inbox[a.id]; delete S.folders[a.id];
        S.settings.snoozes = S.settings.snoozes.filter((s) => s.accountId !== a.id);
        saveSettings();
        if (S.view.acc === a.id) S.view = { type: 'smart' };
        selAccount = S.accounts[0] ? S.accounts[0].id : null;
        renderTab(); renderAll(); updateBadge();
        break;
      }
      case 'acc-test': {
        status('Teste Verbindung …');
        try { await api.call('accounts:test', formAccount(), $('#f-pass', el).value); status('IMAP-Verbindung erfolgreich ✓'); } catch (err) { status(`Fehler: ${err.message}`); }
        break;
      }
      case 'acc-save': {
        const acc = formAccount();
        if (!acc.email || !acc.imapHost || !acc.smtpHost) { status('Bitte E-Mail, IMAP- und SMTP-Server ausfüllen.'); return; }
        const prevAcc = selAccount ? findAccount(selAccount) : null;
        if (prevAcc && prevAcc.fromSync && $('#f-pass', el).value) {
          const ok = await confirmDialog({
            title: 'Serverdaten vom anderen Gerät prüfen',
            ok: 'Stimmt, speichern',
            cancel: 'Abbrechen',
            danger: !!acc.allowInvalidCerts,
            text: `Dieses Konto wurde über die Synchronisation angelegt. Dein Passwort wird an diese Server geschickt:<br><br>
              <table style="font-size:13px">
              <tr><td style="padding:2px 10px 2px 0;color:var(--muted)">IMAP</td><td><b>${esc(acc.imapHost)}:${esc(String(acc.imapPort || 993))}</b></td></tr>
              <tr><td style="padding:2px 10px 2px 0;color:var(--muted)">SMTP</td><td><b>${esc(acc.smtpHost)}:${esc(String(acc.smtpPort || 465))}</b></td></tr>
              <tr><td style="padding:2px 10px 2px 0;color:var(--muted)">Zertifikat</td><td>${acc.allowInvalidCerts ? '<b style="color:var(--danger)">wird NICHT geprüft</b>' : 'wird geprüft'}</td></tr>
              </table><br>Nur speichern, wenn das <b>deine</b> Server sind.`,
          });
          if (!ok) { status('Nicht gespeichert.'); return; }
        }
        status('Speichere …');
        try {
          const saved = await api.call('accounts:save', acc, $('#f-pass', el).value);
          const i = S.accounts.findIndex((a) => a.id === saved.id);
          if (i >= 0) S.accounts[i] = saved; else S.accounts.push(saved);
          delete S.inbox[saved.id];
          selAccount = saved.id;
          renderTab();
          status('Gespeichert ✓');
          renderAll();
          if (welcome) close();
          refresh();
          scheduleSync(1500);
        } catch (err) { status(`Fehler: ${err.message}`); }
        break;
      }
      case 'sn-sel': selSnippet = x.dataset.id; renderTab(); break;
      case 'sig-cmd': sigCmd(x.dataset.cmd); break;
      case 'sig-link': {
        const row = $('.sig-link-row', el);
        row.classList.toggle('hidden');
        if (!row.classList.contains('hidden')) $('#sig-url', el).focus();
        break;
      }
      case 'sig-link-ok': {
        let url = $('#sig-url', el).value.trim();
        if (url && !/^(https?:|mailto:)/i.test(url)) url = url.includes('@') ? `mailto:${url}` : `https://${url}`;
        if (url) sigCmd('createLink', url);
        $('.sig-link-row', el).classList.add('hidden');
        $('#sig-url', el).value = '';
        break;
      }
      case 'sig-file': {
        try {
          const html = await api.call('files:readHtml');
          if (html == null) break;
          const clean = cleanSignatureHtml(html);
          if (!clean) { status('In der Datei wurde keine Signatur gefunden.'); break; }
          $('#sig-source', el).checked = false;
          $('#f-sig-src', el).classList.add('hidden');
          $('#f-sig', el).classList.remove('hidden');
          $('#f-sig', el).innerHTML = clean;
          status('Signatur geladen – bitte „Speichern“ klicken.');
        } catch (err) { status(err.message); }
        break;
      }
      case 'sig-image': {
        try {
          const dataUrl = await api.call('files:imageDataUrl');
          if (dataUrl) sigCmd('insertHTML', `<img src="${dataUrl}" alt="Logo" style="max-width:240px;height:auto">`);
        } catch (err) { status(err.message); }
        break;
      }
      case 'o-clear':
        await api.call('cache:clear');
        updateCacheSize();
        toast('Offline-Ablage geleert');
        break;
      case 'y-pass-set': {
        const pw = $('#y-pass', el).value;
        if (pw.length < 8) { $('#y-status', el).textContent = 'Sync-Passwort: mindestens 8 Zeichen.'; break; }
        $('#y-status', el).textContent = 'Verschlüssele …';
        try { await api.call('sync:setPassphrase', pw); } catch (err) { showError(err.message); }
        S.syncStatus = await api.call('sync:status');
        renderTab();
        break;
      }
      case 'y-pass-clear': {
        const ok = await confirmDialog({ title: 'Sync-Passwort entfernen?', ok: 'Entfernen',
          text: 'Der Abgleich wird dann wieder unverschlüsselt im Postfach gespeichert. Entferne das Passwort auf allen Geräten.' });
        if (!ok) break;
        try { await api.call('sync:setPassphrase', ''); } catch (err) { showError(err.message); }
        S.syncStatus = await api.call('sync:status');
        renderTab();
        break;
      }
      case 'y-now': {
        $('#y-status', el).textContent = 'Synchronisiere …';
        await runSync();
        renderTab();
        break;
      }
      case 'sn-new': {
        const s = { id: uuid(), title: 'Neuer Baustein', text: '', updatedAt: now(), deleted: false };
        S.settings.snippets.push(s);
        selSnippet = s.id;
        saveSettings();
        renderTab();
        $('#sn-title', el).select();
        break;
      }
      case 'g-connect': {
        const st = $('#g-status', el);
        st.textContent = 'Browser geöffnet – bitte dort anmelden und den Zugriff erlauben …';
        x.disabled = true;
        try {
          const r = await api.call('google:connect', $('#g-id', el).value, $('#g-secret', el).value);
          S.google = await api.call('google:status');
          renderTab();
          toast(`Mit Google verbunden${r.email ? ` (${r.email})` : ''}`);
          S.events = null; renderCalendar(); loadEvents(true);
        } catch (err) { st.textContent = err.message; x.disabled = false; }
        break;
      }
      case 'g-reconnect':
        googleReconnect(x);
        break;
      case 'g-remind':
        S.google = await api.call('google:setRemind', x.checked);
        renderGoogleBanner();
        break;
      case 'g-disconnect':
        await api.call('google:disconnect');
        S.google = await api.call('google:status');
        renderTab();
        S.events = null; renderCalendar(); loadEvents(true);
        break;
      case 'cal-show': { const f = $('#cal-url', el); f.type = f.type === 'password' ? 'text' : 'password'; break; }
      case 'cal-clear':
        S.settings.calendar.icsUrl = '';
        await saveSettings({ sync: false });
        S.events = null;
        renderTab();
        renderSidebar();
        break;
      case 'cal-save': {
        const url = $('#cal-url', el).value.trim();
        const st = $('#cal-status', el);
        if (url && !/^(https|webcal):\/\/|^http:\/\/(localhost|127\.0\.0\.1)[:/]/i.test(url)) { st.textContent = 'Die Adresse muss mit https:// beginnen.'; break; }
        S.settings.calendar.icsUrl = url;
        await saveSettings({ sync: false });
        st.textContent = 'Wird geladen …';
        try {
          const r = await api.call('calendar:events', 14, true);
          st.textContent = r.configured ? `✓ Verbunden – ${r.events.length} Termin(e) in den nächsten 14 Tagen.` : 'Gespeichert.';
          S.events = r.configured ? r.events : null;
          S.eventsError = '';
          renderSidebar();
        } catch (err) { st.textContent = err.message; }
        break;
      }
      case 'ru-new': {
        const first = S.accounts[0];
        const order = liveRules().reduce((mx, r) => Math.max(mx, r.order || 0), 0) + 1;
        const r = { id: uuid(), name: 'Neue Regel', enabled: true, accountEmail: first ? first.email.toLowerCase() : '', match: 'all',
          conditions: [{ field: 'from', op: 'contains', value: '' }], actions: { moveTo: '', markRead: false, flag: false, forwardTo: '', copyAccount: '', copyTo: '' },
          order, updatedAt: now(), deleted: false };
        S.settings.rules.push(r);
        selRule = r.id;
        saveSettings();
        renderTab();
        $('#ru-name', el).select();
        break;
      }
      case 'ru-sel': selRule = x.dataset.id; renderTab(); break;
      case 'ru-del':
        for (const r of S.settings.rules) if (r.id === selRule) { r.deleted = true; r.updatedAt = now(); }
        selRule = liveRules()[0] ? liveRules()[0].id : null;
        saveSettings();
        renderTab();
        break;
      case 'ru-up': case 'ru-down': {
        const list = liveRules();
        const i = list.findIndex((r) => r.id === selRule);
        const j = i + (x.dataset.x === 'ru-up' ? -1 : 1);
        if (i < 0 || j < 0 || j >= list.length) break;
        list.forEach((r, k) => { r.order = k; });
        [list[i].order, list[j].order] = [list[j].order, list[i].order];
        list.forEach((r) => { r.updatedAt = now(); });
        saveSettings();
        renderTab();
        break;
      }
      case 'ru-cond-add': {
        readRuleForm();
        curRule().conditions.push({ field: 'from', op: 'contains', value: '' });
        renderTab();
        break;
      }
      case 'ru-cond-del': {
        readRuleForm();
        curRule().conditions.splice(Number(x.dataset.i), 1);
        saveRule();
        renderTab();
        break;
      }
      case 'ru-run': {
        readRuleForm();
        clearTimeout(openSettings.rt);
        await saveSettings();
        $('#ru-status', el).textContent = 'Wird angewendet …';
        try {
          const r = await api.call('rules:run');
          $('#ru-status', el).innerText = r.report;
          refresh();
        } catch (err) { $('#ru-status', el).textContent = err.message; }
        break;
      }
      case 'sn-del':
        for (const sn of S.settings.snippets) if (sn.id === selSnippet) { sn.deleted = true; sn.updatedAt = now(); }
        selSnippet = liveSnippets()[0] ? liveSnippets()[0].id : null;
        saveSettings();
        renderTab();
        break;
      case 'unblock':
        unblockSender(x.dataset.addr);
        renderTab();
        break;
      case 'block-add': {
        const v = $('#bl-new', el).value.trim().toLowerCase();
        if (!/^([^@\s]+@)?@?[a-z0-9.-]+\.[a-z]{2,}$/.test(v)) { toast('Bitte eine Adresse oder @domain.de eingeben'); break; }
        blockSender(v.includes('@') ? v : `@${v}`);
        renderTab();
        break;
      }
      case 'app-find':
        try { if (await chooseAppPath(x.dataset.app)) renderTab(); } catch (err) { showError(err.message); }
        break;
      case 'uncat':
        S.settings.senderCats[x.dataset.addr] = { category: '', updatedAt: now(), deleted: true };
        saveSettings();
        renderTab();
        toast('Wird ab dem nächsten Abruf wieder automatisch einsortiert');
        break;
      case 'untrust':
        S.settings.trusted[x.dataset.addr] = { updatedAt: now(), deleted: true };
        saveSettings();
        renderTab();
        renderDetail(true);
        break;
      default: break;
    }
  });

  renderTab();
}

// =================================================================== Ereignisse

function selectMessage(key) {
  S.selected = key;
  renderList();
  renderDetail();
  const m = findMessage(key);
  if (m) loadBody(m);
}

// Links in Einstellungen/Anleitungen im Browser öffnen
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[data-ext]');
  if (!a) return;
  e.preventDefault();
  api.call('app:openExternal', a.getAttribute('href'));
}, true);

// Menü schließen bei Klick daneben (mousedown, damit der öffnende Klick es nicht sofort wieder schließt)
document.addEventListener('mousedown', (e) => { if (!e.target.closest('#menu')) hideMenu(); });

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.closest('#modal-root')) return;
  const act = el.dataset.act;
  const m = el.dataset.key ? findMessage(el.dataset.key) : findMessage(S.selected);
  switch (act) {
    case 'view': {
      const view = JSON.parse(el.dataset.view);
      if (view.type === 'settings') { openSettings(); return; }
      const wasFolder = S.view.type === 'folder' || isRoleView(S.view);
      S.view = view;
      S.searchResults = null;
      if (view.type === 'folder' || isRoleView(view) || wasFolder) { S.folderMsgs = []; S.selected = null; }
      renderAll();
      // Spam/Gesendet/Papierkorb aller Konten (Ordnerliste fehlt evtl. noch → erst laden)
      if (isRoleView(view)) openRoleView(view);
      if (view.type === 'folder') {
        if (view.path === 'INBOX') {
          // Posteingang eines Kontos: schon geladene Mails sofort zeigen
          S.folderMsgs = (S.inbox[view.acc] || []).map((m) => ({ ...m }));
          renderList();
          refreshFolder();
        } else {
          // Gespeicherte Kopfzeilen zuerst, dann nur diesen Ordner abgleichen (wartet nicht auf den Gesamtabruf)
          api.call('cache:headers', view.acc, view.path).catch(() => null).then((c) => {
            if (c && S.view === view && !S.folderMsgs.length) { S.folderMsgs = c.messages; renderList(); }
            return refreshFolder();
          });
        }
      }
      break;
    }
    case 'account-filter': {
      const id = el.dataset.acc || null;
      S.settings.accountFilter = id;
      saveSettings({ sync: false });
      if (id && S.view.type === 'folder' && S.view.acc !== id) { S.view = { type: 'smart' }; S.folderMsgs = []; }
      // 3.2.41: Konto wählen zeigt den ganzen Posteingang – vorher blieb eine gefilterte Ansicht
      // (z. B. Kategorie „Benachrichtigungen“, Ungelesen, Markiert) stehen, Persönlich-Mails fehlten scheinbar
      if (FILTERED_INBOX_VIEWS.includes(S.view.type)) S.view = { type: 'smart' };
      if (S.view.type === 'folder' && !id) { /* Ordneransicht bleibt */ }
      S.searchResults = null;
      const sel = findMessage(S.selected);
      if (sel && id && sel.accountId !== id) S.selected = null;
      renderAll();
      break;
    }
    case 'select': handleRowClick(el.dataset.key, e); break;
    case 'bulk': bulk(el.dataset.kind, el.dataset.kind === 'read' || el.dataset.kind === 'flag' ? !!el.dataset.arg : undefined); break;
    case 'bulk-move': { const r = el.getBoundingClientRect(); showMenu(r.left, r.bottom + 4, bulkMoveItems(r.left, r.bottom + 4)); break; }
    case 'bulk-clear': clearMulti(); break;
    case 'refresh': refresh(); break;
    case 'toggle-sort': setSortOrder(!S.settings.sortAsc); break;
    case 'print': if (m) printMessage(m); break;
    case 'open-window': if (m) openInWindow(m); break;
    case 'compose': openCompose(newDraft()); break;
    case 'load-more': loadMore(); break;
    case 'toggle-group': toggleGroup(el.dataset.cat); break;
    case 'dismiss-error': S.error = null; renderStatus(); break;
    case 'row-read': e.stopPropagation(); if (m) setRead(m, !m.isRead); break;
    case 'row-archive': e.stopPropagation(); if (m) archive(m); break;
    case 'row-delete': e.stopPropagation(); if (m) remove(m); break;
    case 'row-snooze': {
      e.stopPropagation();
      const r = el.getBoundingClientRect();
      if (m) showMenu(r.left - 180, r.bottom + 4, snoozeMenuItems(m));
      break;
    }
    case 'edit-draft': if (m) openDraft(m); break;
    case 'reply': if (m) openCompose(replyDraft(m, false)); break;
    case 'reply-all': if (m) openCompose(replyDraft(m, true)); break;
    case 'forward': if (m) openCompose(forwardDraft(m)); break;
    case 'flag': if (m) toggleFlag(m); break;
    case 'archive': if (m) archive(m); break;
    case 'delete': if (m) remove(m); break;
    case 'ct-from-mail': if (m) addSenderToContacts(m); break;
    case 'ct-new': { const c = newContact(); showContacts(c.id); break; }
    case 'ct-sel': S.selContact = el.dataset.id; renderList(); renderDetail(); break;
    case 'ct-color': {
      const c = findContact(S.selContact);
      if (!c) break;
      c.color = validColor(el.dataset.color);
      c.updatedAt = now();
      saveSettings(); rebuildContacts(); renderList(); renderDetail(true);
      break;
    }
    case 'ct-import': importContacts(); break;
    case 'ct-export': exportContacts(); break;
    case 'ct-del': {
      const c = findContact(S.selContact);
      if (!c) break;
      confirmDialog({ title: 'Kontakt löschen?', text: esc(contactTitle(c)), ok: 'Löschen', cancel: 'Abbrechen' }).then((ok) => {
        if (!ok) return;
        c.deleted = true; c.updatedAt = now();
        S.selContact = null;
        saveSettings(); rebuildContacts(); renderAll();
      });
      break;
    }
    case 'ct-mail': {
      const c = findContact(S.selContact);
      if (c && c.emails[0]) { const d = newDraft(); d.to = contactDisplay({ name: c.name, email: c.emails[0] }); openCompose(d); }
      break;
    }
    case 'move-menu': if (m) { const r = el.getBoundingClientRect(); showMoveMenu(m, r.left, r.bottom + 4); } break;
    case 'spam-menu': if (m) { const r = el.getBoundingClientRect(); showMenu(r.left, r.bottom + 4, spamMenuItems(m)); } break;
    case 'not-spam': if (m) markNotSpam(m); break;
    case 'unsubscribe': if (m) unsubscribe(m); break;
    case 'toggle-cal': toggleCalendar(); break;
    case 'cal-reload': S.events = null; renderCalendar(); loadEvents(true); break;
    case 'cal-setup': openSettings({ tab: 'calendar' }); break;
    case 'g-reconnect': googleReconnect(el); break;
    case 'g-later': gBannerSnoozed = Date.now() + G_SNOOZE_MS; renderGoogleBanner(); break;
    case 'ev-new': if (m) openEventDialog(m); break;
    case 'meet-new': openEventDialog(null); break;
    case 'meet-join': if (/^https:\/\//i.test(el.dataset.url || '')) { api.call('app:openExternal', el.dataset.url); toast('Meeting wird geöffnet …'); } break;
    case 'meet-copy': navigator.clipboard.writeText(el.dataset.url || '').then(() => toast('Link kopiert')).catch(() => {}); break;
    case 'ev-open': if (el.dataset.link && /^https:\/\/(www\.)?google\.com\/calendar|^https:\/\/calendar\.google\.com/.test(el.dataset.link)) api.call('app:openExternal', el.dataset.link); else api.call('calendar:openDay', el.dataset.start); break;
    case 'inv-google': {
      const b = m && S.bodies[keyOf(m)];
      if (b && b.invite) saveToGoogle(b.invite.event);
      break;
    }
    case 'inv-reply': {
      const b = m && S.bodies[keyOf(m)];
      if (!b || !b.invite) break;
      const ps = el.dataset.ps;
      el.closest('.inv-actions').querySelectorAll('button').forEach((x) => { x.disabled = true; });
      api.call('calendar:respond', m.accountId, b.invite.event, ps)
        .then(() => {
          S.inviteAnswers[keyOf(m)] = ps;
          toast(ps === 'DECLINED' ? 'Absage gesendet' : 'Antwort gesendet');
          renderDetail(true);
          // Bei direkter Google-Verbindung zugesagte Termine gleich eintragen
          if (ps !== 'DECLINED' && S.google.connected) saveToGoogle(b.invite.event);
        })
        .catch((err) => { showError(err.message); renderDetail(true); });
      break;
    }
    case 'snooze-menu': {
      const r = el.getBoundingClientRect();
      if (m) showMenu(r.left, r.bottom + 4, snoozeMenuItems(m));
      break;
    }
    case 'images-once': if (m) { S.imagesAllowed.add(keyOf(m)); renderDetail(true); } break;
    case 'images-always':
      if (m) {
        S.settings.trusted[m.fromAddress.toLowerCase()] = { updatedAt: now(), deleted: false };
        saveSettings();
        renderDetail(true);
      }
      break;
    case 'att-open': openAttachmentSafe(el.dataset.att); break;
    case 'att-save-all': {
      const body = m && S.bodies[keyOf(m)];
      if (body) api.call('attachment:saveAll', visibleAttachments(body).map((a) => a.key)).catch((err) => showError(err.message));
      break;
    }
    case 'ext-link': e.preventDefault(); api.call('app:openExternal', el.dataset.url); break;
    case 'mailto': e.preventDefault(); composeMailto(el.dataset.url); break;
    case 'outbox-send': api.call('outbox:sendNow', el.dataset.id).catch((err) => showError(err.message)); break;
    case 'outbox-cancel': api.call('outbox:cancel', el.dataset.id).catch((err) => showError(err.message)); break;
    default: break;
  }
});

document.addEventListener('contextmenu', (e) => {
  if (e.target.closest('#modal-root')) return;
  const row = e.target.closest('.row[data-key]');
  const chip = e.target.closest('[data-act="att-open"]');
  if (row) {
    e.preventDefault();
    if (multiActive() && S.multi.has(row.dataset.key)) { showMenu(e.clientX, e.clientY, bulkMenuItems(e.clientX, e.clientY)); return; }
    const m = findMessage(row.dataset.key);
    if (m) messageMenu(m, e.clientX, e.clientY);
  } else if (chip) {
    e.preventDefault();
    attachmentMenu(chip.dataset.att, e.clientX, e.clientY);
  } else if (e.target.closest('#sidebar')) {
    const items = sidebarMenuItems(e.target);
    e.preventDefault();
    if (items.length) showMenu(e.clientX, e.clientY, items);
  }
});

window.addEventListener('blur', hideMenu);
window.addEventListener('resize', hideMenu);

const searchEl = $('#search');
// Lokales Filtern erst nach kurzer Tipp-Pause (vorher Neuaufbau der Liste bei jedem Buchstaben)
let searchTimer = null;
function applySearchInput() {
  clearTimeout(searchTimer);
  searchTimer = null;
  if (S.search === searchEl.value) return;
  S.search = searchEl.value;
  if (!S.search) S.searchResults = null;
  renderList();
}
searchEl.addEventListener('input', () => {
  clearTimeout(searchTimer);
  if (!searchEl.value) { applySearchInput(); return; }
  searchTimer = setTimeout(applySearchInput, 150);
});
searchEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { applySearchInput(); serverSearch(); }
  if (e.key === 'Escape') { clearTimeout(searchTimer); searchEl.value = ''; S.search = ''; S.searchResults = null; renderList(); searchEl.blur(); }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideMenu();
  if ($('#modal-root').children.length) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
  const m = findMessage(S.selected);
  const k = e.key.toLowerCase();
  // 3.2.25: Strg+Umschalt+N / Strg+Umschalt+F wurden von Strg+N / Strg+F abgefangen (Abrufen öffnete eine neue Mail,
  // Weiterleiten sprang ins Suchfeld) → Strg+Taste nur ohne Umschalt
  if (e.ctrlKey && !e.shiftKey && k === 'n') { e.preventDefault(); openCompose(newDraft()); return; }
  if (e.ctrlKey && e.shiftKey && k === 'm') { e.preventDefault(); openEventDialog(null); return; }
  if (e.key === 'F5' || (e.ctrlKey && e.shiftKey && k === 'n')) { e.preventDefault(); refresh(); return; }
  if (e.ctrlKey && !e.shiftKey && k === 'f') { e.preventDefault(); searchEl.focus(); searchEl.select(); return; }
  if (e.ctrlKey && k === ',') { e.preventDefault(); openSettings(); return; }
  if (e.ctrlKey && e.shiftKey && k === 'k') { e.preventDefault(); toggleCalendar(); return; }
  if (!typing && !e.ctrlKey && !e.altKey && k === 'v' && m && !multiActive()) {
    e.preventDefault();
    const sel = document.querySelector(`.row[data-key="${CSS.escape(keyOf(m))}"]`);
    const r = sel ? sel.getBoundingClientRect() : { left: 300, bottom: 200 };
    showMoveMenu(m, r.left + 40, r.bottom);
    return;
  }
  if (!typing && e.ctrlKey && k === 'a' && document.activeElement && !document.activeElement.closest('#detail')) {
    e.preventDefault(); selectAll(); return;
  }
  if (multiActive() && !typing) {
    if (e.key === 'Escape') { e.preventDefault(); clearMulti(); return; }
    if (e.key === 'Delete') { e.preventDefault(); bulk('delete'); return; }
    if (k === 'e' && !e.ctrlKey) { e.preventDefault(); bulk('archive'); return; }
    if (e.ctrlKey && k === 'u') { e.preventDefault(); bulk('read', selectedMessages().some((x) => !x.isRead)); return; }
    if (k === 'v' && !e.ctrlKey) { e.preventDefault(); showMenu(400, 200, bulkMoveItems()); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { S.multi.clear(); }
  }
  if (!m) { if (!typing && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) moveSelection(1); return; }
  if (e.ctrlKey && !e.shiftKey && k === 'p') { e.preventDefault(); printMessage(m); return; }
  if (e.key === 'Enter' && !e.ctrlKey && !e.altKey && !multiActive()
      && (document.activeElement === document.body || (document.activeElement && document.activeElement.closest('#list')))) {
    e.preventDefault(); openInWindow(m); return;
  }
  if (e.ctrlKey && e.shiftKey && k === 'r') { e.preventDefault(); openCompose(replyDraft(m, true)); return; }
  if (e.ctrlKey && k === 'r') { e.preventDefault(); openCompose(replyDraft(m, false)); return; }
  if (e.ctrlKey && e.shiftKey && k === 'f') { e.preventDefault(); openCompose(forwardDraft(m)); return; }
  if (e.ctrlKey && k === 'u') { e.preventDefault(); setRead(m, !m.isRead); return; }
  if (typing) return;
  if (e.key === 'Delete') { e.preventDefault(); remove(m); }
  else if (k === 'e') { e.preventDefault(); archive(m); }
  else if (k === 's') { e.preventDefault(); toggleFlag(m); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); moveSelection(-1); }
});

function moveSelection(delta) {
  S.multi.clear();
  const vis = visibleMessages();
  if (!vis.length) return;
  const i = vis.findIndex((x) => keyOf(x) === S.selected);
  const next = vis[Math.max(0, Math.min(vis.length - 1, i < 0 ? 0 : i + delta))];
  if (next) {
    selectMessage(keyOf(next));
    const row = document.querySelector(`.row[data-key="${CSS.escape(keyOf(next))}"]`);
    if (row) row.scrollIntoView({ block: 'nearest' });
  }
}

// ---- Menüleiste (Befehle aus dem Hauptprozess)
function handleMenu(command) {
  hideMenu();
  if ($('#modal-root').children.length && !['settings'].includes(command)) return;
  const m = findMessage(S.selected);
  if (command.startsWith('lines:')) { setListLines(Number(command.slice(6))); return; }
  if (command.startsWith('sort:')) { setSortOrder(command === 'sort:asc'); return; }
  if (command.startsWith('view:')) {
    const type = command.slice(5);
    const wasFolder = S.view.type === 'folder' || isRoleView(S.view);
    const view = { type };
    S.view = view;
    S.searchResults = null;
    if (wasFolder || isRoleView(view)) { S.folderMsgs = []; S.selected = null; }
    renderAll();
    if (isRoleView(view)) openRoleView(view);
    return;
  }
  switch (command) {
    case 'compose': openCompose(newDraft()); break;
    case 'save-draft': if (composeSaveHook) composeSaveHook(); else toast('Kein Verfassen-Fenster offen.'); break;
    case 'meeting': if (!$('#modal-root').children.length) openEventDialog(null); break;
    case 'google-reconnect':
      if (S.google.clientId) googleReconnect(null); else openSettings({ tab: 'calendar' });
      break;
    case 'refresh': refresh(); break;
    case 'settings': if (!$('#modal-root').children.length) openSettings(); break;
    case 'search': searchEl.focus(); searchEl.select(); break;
    default:
      if (!m) { toast('Bitte zuerst eine E-Mail auswählen.'); return; }
      switch (command) {
        case 'reply': openCompose(replyDraft(m, false)); break;
        case 'replyAll': openCompose(replyDraft(m, true)); break;
        case 'forward': openCompose(forwardDraft(m)); break;
        case 'print': printMessage(m); break;
        case 'openWindow': openInWindow(m); break;
        case 'toggleRead': setRead(m, !m.isRead); break;
        case 'flag': toggleFlag(m); break;
        case 'archive': archive(m); break;
        case 'delete': remove(m); break;
        case 'snooze':
          if (m.folder !== 'INBOX') { toast('Zurückstellen ist nur im Posteingang möglich.'); break; }
          showMenu(window.innerWidth - 300, 60, snoozeMenuItems(m));
          break;
        case 'saveAttachments': {
          const body = S.bodies[keyOf(m)];
          const files = body ? visibleAttachments(body) : [];
          if (!files.length) { toast('Diese E-Mail hat keine Anhänge.'); break; }
          api.call('attachment:saveAll', files.map((a) => a.key)).catch((err) => showError(err.message));
          break;
        }
        default: break;
      }
  }
}
api.on('menu', handleMenu);

// Ansicht per Strg+1 … Strg+5
document.addEventListener('keydown', (e) => {
  if (!e.ctrlKey || e.shiftKey || e.altKey || $('#modal-root').children.length) return;
  const views = { 1: 'smart', 2: 'unread', 3: 'flagged', 4: 'snoozed', 5: 'scheduled' };
  if (views[e.key]) { e.preventDefault(); handleMenu(`view:${views[e.key]}`); }
});

// =================================================================== Menüleiste (eigene, größere Schrift)

const MB = { menus: [], open: -1, active: -1, sub: -1, subActive: -1, kbd: false, altAlone: false };

async function loadMenubar() {
  try { MB.menus = await api.call('menu:get'); } catch { MB.menus = []; }
  if (!MB.version) { try { MB.version = await api.call('app:version'); } catch { /* egal */ } }
  renderMenubar();
}

function renderMenubar() {
  const bar = $('#menubar');
  if (!bar) return;
  bar.classList.toggle('kbd', MB.kbd);
  bar.innerHTML = MB.menus.map((m, i) => {
    const idx = m.mnemonic ? m.label.toLowerCase().indexOf(m.mnemonic) : -1;
    const label = idx >= 0 ? `${esc(m.label.slice(0, idx))}<u>${esc(m.label[idx])}</u>${esc(m.label.slice(idx + 1))}` : esc(m.label);
    return `<div class="mb-top${MB.open === i ? ' open' : ''}" role="menuitem" data-top="${i}">${label}</div>`;
  }).join('') + (MB.version ? `<span class="mb-ver">SimpleMail ${esc(MB.version)}</span>` : '');
}

const mbItemHtml = (it, i, active) => (it.sep ? '<div class="msep"></div>'
  : `<div class="mi${it.enabled ? '' : ' disabled'}${active === i ? ' active' : ''}" data-i="${i}" role="menuitem">`
    + `${it.checked ? '<span class="chk">✓</span>' : ''}${esc(it.label)}`
    + `${it.items ? '<span class="arrow">›</span>' : it.keys ? `<span class="hint">${esc(it.keys)}</span>` : ''}</div>`);

function renderMbDrop() {
  const drop = $('#mbDrop');
  const sub = $('#mbSub');
  const m = MB.menus[MB.open];
  if (!m) { drop.classList.add('hidden'); sub.classList.add('hidden'); drop.dataset.key = ''; sub.dataset.key = ''; return; }
  // nur neu aufbauen, wenn sich das Menü ändert – sonst nur die Markierung (Klick bleibt gültig)
  if (drop.dataset.key !== String(MB.open) || drop.classList.contains('hidden')) {
    drop.innerHTML = m.items.map((it, i) => mbItemHtml(it, i, -1)).join('');
    drop.dataset.key = String(MB.open);
    drop.classList.remove('hidden');
    const top = $(`#menubar [data-top="${MB.open}"]`).getBoundingClientRect();
    drop.style.left = `${Math.max(4, Math.min(top.left, window.innerWidth - drop.offsetWidth - 4))}px`;
    drop.style.top = `${top.bottom + 2}px`;
  }
  drop.querySelectorAll('.mi').forEach((el) => el.classList.toggle('active', Number(el.dataset.i) === MB.active || Number(el.dataset.i) === MB.sub));
  const parent = MB.sub >= 0 ? m.items[MB.sub] : null;
  if (parent && parent.items) {
    const key = `${MB.open}/${MB.sub}`;
    if (sub.dataset.key !== key || sub.classList.contains('hidden')) {
      sub.innerHTML = parent.items.map((it, i) => mbItemHtml(it, i, -1)).join('');
      sub.dataset.key = key;
      sub.classList.remove('hidden');
      const row = drop.querySelector(`[data-i="${MB.sub}"]`).getBoundingClientRect();
      const left = row.right + 4 + sub.offsetWidth > window.innerWidth ? row.left - sub.offsetWidth - 4 : row.right + 4;
      sub.style.left = `${Math.max(4, left)}px`;
      sub.style.top = `${Math.max(4, Math.min(row.top - 5, window.innerHeight - sub.offsetHeight - 4))}px`;
    }
    sub.querySelectorAll('.mi').forEach((el) => el.classList.toggle('active', Number(el.dataset.i) === MB.subActive));
  } else {
    sub.classList.add('hidden');
    sub.dataset.key = '';
  }
}

async function openMbMenu(i, viaKeyboard) {
  if (MB.open < 0) await loadMenubar();   // Haken (Sortierung, Zeilen) aktuell holen
  hideMenu();
  MB.open = i;
  MB.sub = -1;
  MB.subActive = -1;
  MB.active = viaKeyboard ? mbNext(MB.menus[i].items, -1, 1) : -1;
  $('#mbDrop').dataset.key = '';
  $('#mbSub').dataset.key = '';
  renderMenubar();
  renderMbDrop();
}

function closeMb() {
  if (MB.open < 0 && !MB.kbd) return;
  MB.open = -1; MB.active = -1; MB.sub = -1; MB.subActive = -1; MB.kbd = false;
  renderMenubar();
  renderMbDrop();
}

function mbNext(items, from, dir) {
  const n = items.length;
  for (let k = 1; k <= n; k += 1) {
    const i = (((from + dir * k) % n) + n) % n;
    if (!items[i].sep && items[i].enabled) return i;
  }
  return -1;
}

function activateMb(pathIdx) {
  const top = MB.menus[pathIdx[0]];
  let it = top && top.items[pathIdx[1]];
  if (it && pathIdx.length > 2) it = it.items && it.items[pathIdx[2]];
  if (!it || it.sep || !it.enabled) return;
  if (it.items) { MB.sub = pathIdx[1]; MB.subActive = mbNext(it.items, -1, 1); renderMbDrop(); return; }
  closeMb();
  api.call('menu:invoke', pathIdx).catch((err) => showError(err.message));
}

// Maus: Fokus im Textfeld behalten (Kopieren/Einfügen wirken dort)
for (const id of ['#menubar', '#mbDrop', '#mbSub']) {
  $(id).addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
}
$('#menubar').addEventListener('mousedown', (e) => {
  const t = e.target.closest('[data-top]');
  if (!t || e.button !== 0) return;
  const i = Number(t.dataset.top);
  if (MB.open === i) closeMb(); else openMbMenu(i, false);
});
$('#menubar').addEventListener('mouseover', (e) => {
  const t = e.target.closest('[data-top]');
  if (t && MB.open >= 0 && Number(t.dataset.top) !== MB.open) openMbMenu(Number(t.dataset.top), false);
});
$('#mbDrop').addEventListener('mouseover', (e) => {
  const r = e.target.closest('[data-i]');
  if (!r) return;
  const i = Number(r.dataset.i);
  const it = MB.menus[MB.open].items[i];
  if (MB.active === i && (it.items ? MB.sub === i : MB.sub < 0)) return;
  MB.active = i;
  if (it.items) { if (MB.sub !== i) { MB.sub = i; MB.subActive = -1; } } else { MB.sub = -1; }
  renderMbDrop();
});
$('#mbSub').addEventListener('mouseover', (e) => {
  const r = e.target.closest('[data-i]');
  if (r && MB.subActive !== Number(r.dataset.i)) { MB.subActive = Number(r.dataset.i); renderMbDrop(); }
});
$('#mbDrop').addEventListener('click', (e) => {
  const r = e.target.closest('[data-i]');
  if (r) activateMb([MB.open, Number(r.dataset.i)]);
});
$('#mbSub').addEventListener('click', (e) => {
  const r = e.target.closest('[data-i]');
  if (r) activateMb([MB.open, MB.sub, Number(r.dataset.i)]);
});
document.addEventListener('mousedown', () => closeMb());
window.addEventListener('blur', () => closeMb());
window.addEventListener('resize', () => closeMb());

// Tastatur: Alt (allein) bzw. F10 = Menüleiste, Alt+Buchstabe = Menü, Pfeile/Enter/Esc
window.addEventListener('keydown', (e) => {
  MB.altAlone = e.key === 'Alt' && !e.ctrlKey && !e.shiftKey && !e.metaKey;
  if (MB.open < 0) {
    if (e.key === 'F10' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      e.preventDefault(); e.stopPropagation(); MB.kbd = true; openMbMenu(0, true); return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.length === 1) {
      const i = MB.menus.findIndex((m) => m.mnemonic && m.mnemonic === e.key.toLowerCase());
      if (i >= 0) { e.preventDefault(); e.stopPropagation(); MB.kbd = true; openMbMenu(i, true); }
    }
    return;
  }
  const m = MB.menus[MB.open];
  const inSub = MB.sub >= 0 && MB.subActive >= 0;
  const subItems = MB.sub >= 0 ? m.items[MB.sub].items : null;
  e.preventDefault();
  e.stopPropagation();
  MB.kbd = true;
  switch (e.key) {
    case 'Escape':
      if (MB.sub >= 0) { MB.sub = -1; MB.subActive = -1; renderMbDrop(); } else closeMb();
      break;
    case 'ArrowDown': case 'ArrowUp': {
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      if (inSub) MB.subActive = mbNext(subItems, MB.subActive, dir);
      else { MB.sub = -1; MB.active = mbNext(m.items, MB.active, dir); }
      renderMbDrop();
      break;
    }
    case 'ArrowRight': {
      const it = m.items[MB.active];
      if (!inSub && it && it.items) { MB.sub = MB.active; MB.subActive = mbNext(it.items, -1, 1); renderMbDrop(); } else openMbMenu((MB.open + 1) % MB.menus.length, true);
      break;
    }
    case 'ArrowLeft':
      if (inSub) { MB.sub = -1; MB.subActive = -1; renderMbDrop(); } else openMbMenu((MB.open - 1 + MB.menus.length) % MB.menus.length, true);
      break;
    case 'Enter': case ' ':
      if (inSub) activateMb([MB.open, MB.sub, MB.subActive]);
      else if (MB.active >= 0) activateMb([MB.open, MB.active]);
      break;
    case 'Alt': case 'F10':
      closeMb();
      MB.altAlone = false;
      break;
    default: {
      // Anfangsbuchstabe springt zum Eintrag
      const list = inSub ? subItems : m.items;
      const ch = e.key.length === 1 ? e.key.toLowerCase() : '';
      const start = inSub ? MB.subActive : MB.active;
      if (!ch) break;
      for (let k = 1; k <= list.length; k += 1) {
        const i = (start + k) % list.length;
        if (!list[i].sep && list[i].enabled && list[i].label.toLowerCase().startsWith(ch)) {
          if (inSub) MB.subActive = i; else { MB.active = i; MB.sub = -1; }
          renderMbDrop();
          break;
        }
      }
    }
  }
}, true);
window.addEventListener('keyup', (e) => {
  if (e.key === 'Alt' && MB.altAlone && MB.open < 0) {
    e.preventDefault();
    MB.kbd = true;
    openMbMenu(0, true);
  }
  MB.altAlone = false;
}, true);

loadMenubar();

init();
