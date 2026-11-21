'use strict';
// SimpleMail für Windows – Hauptprozess: Konten, IMAP/SMTP, Push (IDLE), Speicher, Dateien
const { app, BrowserWindow, ipcMain, dialog, shell, Notification, safeStorage, nativeImage, powerMonitor, Menu, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { ImapFlow } = require('imapflow');
const nodemailer = require('nodemailer');
const MailComposer = require('nodemailer/lib/mail-composer');
const addressparser = require('nodemailer/lib/addressparser');
const { simpleParser } = require('mailparser');
const { fileURLToPath } = require('url');
const ics = require('./ics');
const security = require('./security');
const { createGoogle } = require('./google');

const PAGE = 200;
const MAX_PER_FOLDER = 2000;
const MAX_ATTACH_BYTES = 20 * 1024 * 1024;
const SYNC_FOLDER = 'SimpleMail-Sync';
const SYNC_SUBJECT = 'SimpleMail Sync – bitte nicht löschen';

let win = null;
const sessions = new Map();          // accountId → Session
const attachmentCache = new Map();   // key → { filename, contentType, content }

// ---------------------------------------------------------------- Speicher

const dataDir = () => app.getPath('userData');

function readJSON(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(dataDir(), name), 'utf8')); } catch { return fallback; }
}

function writeJSON(name, value) {
  fs.mkdirSync(dataDir(), { recursive: true });
  const file = path.join(dataDir(), name);
  fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 1));
  fs.renameSync(file + '.tmp', file);
}

/** Lokale Adressen (eigener Rechner) – dort ist eine unverschlüsselte Verbindung kein Abhörrisiko */
const isLoopback = (host) => /^(localhost|127\.\d+\.\d+\.\d+|::1|\[::1\])$/i.test(String(host || '').trim());
/** IMAP: Port 993 = TLS; andere Ports: STARTTLS ist Pflicht (kein stilles Zurückfallen auf Klartext) */
function imapTls(host, port) {
  if ((Number(port) || 993) === 993) return { secure: true };
  return isLoopback(host) ? { secure: false } : { secure: false, doSTARTTLS: true };
}

function encryptPassword(pw) {
  if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(pw).toString('base64');
  return 'b64:' + Buffer.from(pw, 'utf8').toString('base64');
}

function decryptPassword(stored) {
  if (!stored) return '';
  try {
    if (stored.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'));
    if (stored.startsWith('b64:')) return Buffer.from(stored.slice(4), 'base64').toString('utf8');
  } catch { /* nicht entschlüsselbar */ }
  return '';
}

// Google Kalender (direkt): Zugangsdaten verschlüsselt in google.json
const google = createGoogle({
  fetch: (url, opts) => net.fetch(url, opts),
  openExternal: (url) => shell.openExternal(url),
  load: () => loadGoogleCfg(),
  save: (obj) => {
    // 3.2.31: Client-ID/-Schlüssel tragen einen eigenen Zeitstempel (Sync prefs.googleCalendar)
    const prev = loadGoogleCfg() || {};
    if (obj) {
      const same = (obj.clientId || '') === (prev.clientId || '') && (obj.clientSecret || '') === (prev.clientSecret || '');
      obj = { ...obj, clientUpdatedAt: same ? (prev.clientUpdatedAt || obj.clientUpdatedAt || 0) : Date.now() };
      if (!same) settingsVersion++;
    }
    saveGoogleCfg(obj);
  },
});

function loadGoogleCfg() {
  const raw = readJSON('google.json', null);
  if (!raw || !raw.data) return null;
  try { return JSON.parse(decryptPassword(raw.data) || 'null'); } catch { return null; }
}
// 3.2.34: Verbindungen von vor 3.2.34 kennen ihren Anmeldezeitpunkt nicht → Zeitpunkt der letzten Speicherung von google.json
function migrateGoogleConnectedAt() {
  const c = loadGoogleCfg();
  if (!c || !c.refreshToken || c.connectedAt) return;
  let at = Date.now();
  try { at = fs.statSync(path.join(dataDir(), 'google.json')).mtimeMs || at; } catch { /* jetzt */ }
  saveGoogleCfg({ ...c, connectedAt: Math.min(at, Date.now()) });
}
function saveGoogleCfg(obj) { writeJSON('google.json', obj ? { data: encryptPassword(JSON.stringify(obj)) } : {}); }

let accounts = [];   // inkl. verschlüsseltem Passwort
let outbox = [];

const publicAccount = (a) => { const { password, ...rest } = a; return { ...rest, hasPassword: !!decryptPassword(password) }; };

function send(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

// ---------------------------------------------------------------- Hilfen

function parseHeaders(buf) {
  const out = {};
  if (!buf) return out;
  const text = buf.toString('utf8').replace(/\r?\n[ \t]+/g, ' ');
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) {
      const k = line.slice(0, i).trim().toLowerCase();
      if (!(k in out)) out[k] = line.slice(i + 1).trim();
    }
  }
  return out;
}

// Smart-Inbox-Einteilung (gleiche Logik wie Categorizer in Models.swift)
// Version erhöhen, wenn sich die Einteilung ändert – gespeicherte Kopfzeilen im Posteingang werden dann einmal neu geholt
const CAT_VERSION = 2;
// Automatische Absender (nur im Teil vor dem @, als eigenes Wort)
const AUTOMATED_RE = /(^|[._+-])(no[_-]?reply|do[_-]?not[_-]?reply|notifications?|notify|mailer-daemon|postmaster|alerts?|automated|bounces?|system|service|support|billing|invoice|rechnung|accounts?|security|versand|shipping|orders?|bestellung|calendar|kalender)([._+-]|\d|$)/;
// Newsletter-Absender (ganze Adresse)
const NEWSLETTER_RE = /newsletter|(^|[._+-])(news|marketing|promo|angebote?|aktionen?|mailing)([._+-]|@)/;
// Betreffe von Bestell-, Versand-, Konto- und Terminmails (zählen nur bei Massenversand)
const TRANSACTIONAL_RE = /bestell|auftrag|rechnung|lieferung|versand|versendet|zustellung|sendung|paket|zahlung|kontoauszug|passwort|kennwort|anmeldung|sicherheitscode|bestätigungscode|verifizier|termin|erinnerung|buchung|reservierung|ticket|order|invoice|receipt|shipped|shipping|delivery|payment|password|sign-in|sign in|login|verification|security alert|your account|ihr konto|dein konto|reminder|booking|reservation/;

function categorize(h, address, subject) {
  const addr = (address || '').toLowerCase();
  const local = addr.split('@')[0];
  const prec = (h['precedence'] || '').toLowerCase().trim();
  const auto = (h['auto-submitted'] || '').toLowerCase().trim();
  if (auto && auto !== 'no') return 'notification';
  if (NEWSLETTER_RE.test(addr)) return 'newsletter';
  if (AUTOMATED_RE.test(local)) return 'notification';
  const isList = h['list-id'] !== undefined || prec === 'list';
  const isBulk = isList || prec === 'bulk' || prec === 'junk' || h['list-unsubscribe'] !== undefined;
  if (isBulk) {
    // z. B. Versandbestätigung mit Abmelde-Link → Benachrichtigung statt Newsletter
    if (!isList && TRANSACTIONAL_RE.test(String(subject || '').toLowerCase())) return 'notification';
    return 'newsletter';
  }
  return 'personal';
}

/** Läuft das Konto über Google (gmail.com, googlemail.com, Google Workspace)? */
const isGmailHost = (h) => /(gmail|googlemail)\.com$/i.test(String(h || '').trim());
const isGmail = (a) => isGmailHost(a.imapHost) || isGmailHost(a.smtpHost);
/** App-Passwörter werden mit Leerzeichen angezeigt („abcd efgh ijkl mnop“) – Google erwartet sie ohne */
function cleanPassword(pw, host) {
  if (!isGmailHost(host)) return pw;
  const t = String(pw || '').trim();
  return /^[a-zA-Z]{4}( [a-zA-Z]{4}){3}$/.test(t) ? t.replace(/ /g, '') : pw;
}

/** Gmail ordnet selbst ein (Allgemein/Updates/Werbung/Soziale Netzwerke/Foren) – diese Einteilung übernehmen */
async function applyGmailCategories(c, list) {
  if (!list.length || !c.capabilities || !c.capabilities.has('X-GM-EXT-1')) return;
  const range = uidRanges(list.map((m) => m.uid));
  const queries = [['category:primary', 'personal'], ['category:updates', 'notification'],
    ['category:promotions OR category:social OR category:forums', 'newsletter']];
  const cats = new Map();
  try {
    for (const [raw, cat] of queries) {
      for (const u of (await c.search({ uid: range, gmraw: raw }, { uid: true })) || []) cats.set(u, cat);
    }
  } catch (e) { console.error('Gmail-Kategorien:', e.message); return; }
  for (const m of list) if (cats.has(m.uid)) m.category = cats.get(m.uid);
}

const fmtAddr = (a) => (a.name ? `${a.name} <${a.address}>` : a.address || '');

function convertMessage(m, accountId, folder) {
  const env = m.envelope || {};
  const from = (env.from && env.from[0]) || {};
  const h = parseHeaders(m.headers);
  const date = env.date || m.internalDate || new Date(0);
  const spam = security.spamScore({ fromName: from.name || '', fromAddress: from.address || '', subject: env.subject || '', headers: h });
  return {
    accountId, folder, uid: m.uid,
    fromName: from.name || '',
    fromAddress: from.address || '',
    to: (env.to || []).map(fmtAddr).join(', '),
    subject: env.subject || '',
    date: new Date(date).toISOString(),
    messageId: env.messageId || '',
    references: h['references'] || '',
    isRead: m.flags ? m.flags.has('\\Seen') : false,
    isFlagged: m.flags ? m.flags.has('\\Flagged') : false,
    hasAttachment: /^multipart\/mixed/i.test(h['content-type'] || ''),
    size: m.size || 0,
    category: categorize(h, from.address, env.subject || ''),
    catVersion: CAT_VERSION,
    spamScore: spam.score,
    authFailed: security.authFailed(h),
    // Alle Empfänger-Angaben (für Regeln): An, Kopie, Verteiler- und Weiterleitungsadressen
    recipients: [(env.to || []).map(fmtAddr).join(' '), (env.cc || []).map(fmtAddr).join(' '),
      ...['delivered-to', 'x-original-to', 'envelope-to', 'x-envelope-to', 'resent-to', 'list-post', 'list-id'].map((k) => h[k] || '')]
      .filter(Boolean).join(' '),
  };
}

const FETCH_QUERY = {
  uid: true, flags: true, envelope: true, internalDate: true, size: true,
  headers: ['list-unsubscribe', 'list-id', 'precedence', 'auto-submitted', 'content-type', 'references',
    'delivered-to', 'x-original-to', 'envelope-to', 'x-envelope-to', 'resent-to', 'list-post',
    'authentication-results', 'x-spam-flag', 'x-spam-status', 'x-spam'],
};

const ROLE_ORDER = { inbox: 0, drafts: 1, sent: 2, archive: 3, junk: 4, trash: 5, other: 6 };

function folderRole(f) {
  if (f.path.toUpperCase() === 'INBOX') return 'inbox';
  const su = (f.specialUse || '').toLowerCase();
  if (su === '\\drafts') return 'drafts';
  if (su === '\\sent') return 'sent';
  if (su === '\\archive' || su === '\\all') return 'archive';
  if (su === '\\junk') return 'junk';
  if (su === '\\trash') return 'trash';
  const n = (f.name || '').toLowerCase();
  if (['drafts', 'entwürfe', 'entwurf'].includes(n)) return 'drafts';
  if (['sent', 'gesendet', 'sent items', 'sent messages', 'gesendete objekte', 'gesendete elemente'].includes(n)) return 'sent';
  if (['archive', 'archiv'].includes(n)) return 'archive';
  if (['spam', 'junk', 'junk-e-mail', 'unerwünscht', 'junk e-mail'].includes(n)) return 'junk';
  if (['trash', 'papierkorb', 'gelöscht', 'deleted', 'deleted items', 'deleted messages', 'gelöschte objekte', 'gelöschte elemente'].includes(n)) return 'trash';
  return 'other';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** UID-Liste kompakt als Bereiche („1:50,60,70:80“) */
function uidRanges(uids) {
  const u = [...new Set(uids)].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < u.length; i++) {
    let j = i;
    while (j + 1 < u.length && u[j + 1] === u[j] + 1) j++;
    parts.push(i === j ? String(u[i]) : `${u[i]}:${u[j]}`);
    i = j;
  }
  return parts.join(',');
}

/** Kurzer Fingerabdruck einer Liste (UIDs + Flags) – erkennt, ob die Ablage neu geschrieben werden muss */
const signatureOf = (list) => list.map((m) => `${m.uid}${m.isRead ? 'r' : ''}${m.isFlagged ? 'f' : ''}`).join(',');

// ---------------------------------------------------------------- Konto-Sitzung

class Session {
  constructor(account, password) {
    this.account = account;
    this.password = password;
    this.client = null;
    this.queue = Promise.resolve();
    // Zweite Verbindung für Hintergrundarbeit (Vorausladen, Ordnerzähler) – Öffnen einer Mail wartet nicht darauf
    this.bgClient = null;
    this.bgQueue = Promise.resolve();
    // Bekannte Kopfdaten je Ordner: { uidValidity, byUid: Map } – für den schnellen Abgleich
    this.known = new Map();
    this.folders = [];
    this.special = {};
    this.idleClient = null;
    this.idleStop = true;
    this.changeTimer = null;
  }

  imapOptions() {
    const a = this.account;
    return {
      host: a.imapHost,
      port: Number(a.imapPort) || 993,
      ...imapTls(a.imapHost, a.imapPort),
      auth: { user: a.username, pass: cleanPassword(this.password, a.imapHost) },
      logger: false,
      tls: { rejectUnauthorized: !a.allowInvalidCerts },
      maxIdleTime: 20 * 60 * 1000,
    };
  }

  async connect() {
    if (this.client && this.client.usable) return this.client;
    const c = new ImapFlow(this.imapOptions());
    c.on('error', () => {});
    c.on('close', () => { if (this.client === c) this.client = null; });
    await c.connect();
    this.client = c;
    await this.loadFolderList(c);
    return c;
  }

  async connectBg() {
    if (this.bgClient && this.bgClient.usable) return this.bgClient;
    const c = new ImapFlow(this.imapOptions());
    c.on('error', () => {});
    c.on('close', () => { if (this.bgClient === c) this.bgClient = null; });
    await c.connect();
    this.bgClient = c;
    return c;
  }

  /** Wie run(), aber über die Hintergrund-Verbindung */
  runBg(fn) {
    const job = this.bgQueue.then(async () => {
      let c = await this.connectBg();
      try {
        return await fn(c);
      } catch (e) {
        if (c.usable) throw e;
        this.bgClient = null;
        c = await this.connectBg();
        return await fn(c);
      }
    });
    this.bgQueue = job.catch(() => {});
    return job;
  }

  async withMailboxBg(pathName, fn) {
    return this.runBg(async (c) => {
      const lock = await c.getMailboxLock(pathName);
      try { return await fn(c); } finally { lock.release(); }
    });
  }

  /** Führt IMAP-Befehle nacheinander aus; bei Verbindungsabbruch einmal neu verbinden */
  run(fn) {
    const job = this.queue.then(async () => {
      let c = await this.connect();
      try {
        return await fn(c);
      } catch (e) {
        if (c.usable) throw e;
        this.client = null;
        c = await this.connect();
        return await fn(c);
      }
    });
    this.queue = job.catch(() => {});
    return job;
  }

  async withMailbox(pathName, fn) {
    return this.run(async (c) => {
      const lock = await c.getMailboxLock(pathName);
      try { return await fn(c); } finally { lock.release(); }
    });
  }

  async loadFolderList(c) {
    const list = (await c.list()).filter((f) => f.name !== SYNC_FOLDER);
    const folders = list.map((f) => ({
      path: f.path,
      name: f.path.toUpperCase() === 'INBOX' ? 'Posteingang' : f.name,
      depth: (f.parent || []).length,
      selectable: !f.flags.has('\\Noselect') && !f.flags.has('\\NonExistent'),
      role: folderRole(f),
      // Gmail: „Alle Nachrichten“ bzw. virtuelle Ordner „Wichtig“/„Markiert“ (keine eigenen Mails)
      allMail: f.specialUse === '\\All' || f.flags.has('\\All'),
      virtual: f.flags.has('\\Important') || f.flags.has('\\Flagged') || f.specialUse === '\\Flagged' || f.specialUse === '\\Important',
      delimiter: f.delimiter || '/',
      unread: 0,
    }));
    folders.sort((a, b) => {
      const ra = a.depth === 0 ? ROLE_ORDER[a.role] : ROLE_ORDER.other;
      const rb = b.depth === 0 ? ROLE_ORDER[b.role] : ROLE_ORDER.other;
      if (ra !== rb) return ra - rb;
      return a.path.localeCompare(b.path, 'de', { numeric: true, sensitivity: 'base' });
    });
    const pick = (role) => (folders.find((f) => f.role === role && f.selectable && f.depth === 0)
      || folders.find((f) => f.role === role && f.selectable) || {}).path;
    this.special = { archive: pick('archive'), trash: pick('trash'), sent: pick('sent'), junk: pick('junk') };
    this.folders = folders;
  }

  // ---- Push per IMAP IDLE (eigene Verbindung auf dem Posteingang)
  startIdle() {
    this.stopIdle();
    this.idleStop = false;
    const loop = async () => {
      let backoff = 5000;
      let reconnect = false;
      while (!this.idleStop) {
        const c = new ImapFlow(this.imapOptions());
        this.idleClient = c;
        c.on('error', () => {});
        const notify = () => this.changed();
        c.on('exists', notify);
        c.on('expunge', notify);
        c.on('flags', notify);
        try {
          const closed = new Promise((res) => c.once('close', res));
          await c.connect();
          await c.mailboxOpen('INBOX');
          send('push-status', this.account.id, c.capabilities.has('IDLE'));
          backoff = 5000;
          // 3.2.25: nach Wiederverbindung (WLAN, Ruhezustand) verpasste Mails sofort abholen –
          // vorher kamen sie erst mit dem nächsten 5-Minuten-Abruf
          if (reconnect) this.changed();
          reconnect = true;
          await closed;
        } catch { /* Verbindung fehlgeschlagen */ }
        send('push-status', this.account.id, false);
        if (this.idleStop) break;
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 300000);
      }
    };
    loop();
  }

  stopIdle() {
    this.idleStop = true;
    const c = this.idleClient;
    this.idleClient = null;
    if (c) c.logout().catch(() => c.close());
  }

  changed() {
    clearTimeout(this.changeTimer);
    this.changeTimer = setTimeout(() => send('mail-changed', this.account.id), 800);
  }

  close() {
    this.stopIdle();
    if (this.client) this.client.logout().catch(() => {});
    this.client = null;
    if (this.bgClient) this.bgClient.logout().catch(() => {});
    this.bgClient = null;
  }
}

function startSession(acc) {
  const old = sessions.get(acc.id);
  if (old) old.close();
  sessions.delete(acc.id);
  const pw = decryptPassword(acc.password);
  if (!pw) return;
  const s = new Session(acc, pw);
  sessions.set(acc.id, s);
  s.startIdle();
}

function sessionFor(id) {
  const s = sessions.get(id);
  if (!s) throw new Error('Konto nicht verbunden – Passwort in den Einstellungen prüfen.');
  return s;
}

// ---------------------------------------------------------------- Offline-Ablage

const cacheRoot = () => path.join(dataDir(), 'cache');
const offlinePrefs = () => Object.assign({ enabled: true, keep: 100, limitMB: 1000 }, (readJSON('settings.json', {}).offline || {}));

function cacheDir(accountId, folder) {
  const id = crypto.createHash('sha1').update(`${accountId}|${folder}`).digest('hex').slice(0, 20);
  return path.join(cacheRoot(), id);
}

function readHeaderCache(accountId, folder) {
  try { return JSON.parse(fs.readFileSync(path.join(cacheDir(accountId, folder), 'headers.json'), 'utf8')); } catch { return null; }
}

function writeHeaderCache(accountId, folder, uidValidity, messages, low) {
  if (!offlinePrefs().enabled) return;
  const dir = cacheDir(accountId, folder);
  const old = readHeaderCache(accountId, folder);
  // UIDVALIDITY geändert → UIDs ungültig → alten Stand verwerfen
  if (old && old.uidValidity !== uidValidity) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'headers.json'), JSON.stringify({ uidValidity, low, savedAt: new Date().toISOString(), messages }));
}

const bodyCachePath = (accountId, folder, uid) => path.join(cacheDir(accountId, folder), `${uid}.eml`);

function readBodyCache(accountId, folder, uid) {
  try { return fs.readFileSync(bodyCachePath(accountId, folder, uid)); } catch { return null; }
}

function writeBodyCache(accountId, folder, uid, source) {
  if (!offlinePrefs().enabled) return;
  try {
    fs.mkdirSync(cacheDir(accountId, folder), { recursive: true });
    fs.writeFileSync(bodyCachePath(accountId, folder, uid), source);
  } catch { /* egal */ }
}

// ---- Textvorschau für die Übersicht (aus gespeicherten Nachrichtentexten)

/** Erste Zeilen des eigentlichen Textes – ohne Zitate und Signatur */
function makePreview(text) {
  const lines = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (line === '-- ' || /^(Am .{4,80} schrieb|On .{4,80} wrote|-{5,} ?(Weitergeleitete|Forwarded|Original))/i.test(line.trim())) break;
    if (/^\s*>/.test(line)) continue;
    lines.push(line);
  }
  return lines.join(' ').replace(/\s+/g, ' ').trim().slice(0, 240);
}

function htmlToPlain(html) {
  if (typeof html !== 'string') return '';
  return html.replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}
const previewOf = (parsed) => makePreview(parsed.text || htmlToPlain(parsed.html));

const previewFile = (accountId, folder) => path.join(cacheDir(accountId, folder), 'previews.json');

function readPreviews(accountId, folder) {
  try { return JSON.parse(fs.readFileSync(previewFile(accountId, folder), 'utf8')); } catch { return {}; }
}

function savePreviews(accountId, folder, entries) {
  if (!offlinePrefs().enabled || !Object.keys(entries).length) return;
  try {
    fs.mkdirSync(cacheDir(accountId, folder), { recursive: true });
    fs.writeFileSync(previewFile(accountId, folder), JSON.stringify({ ...readPreviews(accountId, folder), ...entries }));
  } catch { /* egal */ }
}

function attachPreviews(messages, accountId, folder) {
  const p = readPreviews(accountId, folder);
  for (const m of messages) if (p[m.uid] !== undefined) m.preview = p[m.uid];
  return messages;
}

function cacheFiles() {
  const out = [];
  let dirs = [];
  try { dirs = fs.readdirSync(cacheRoot()); } catch { return out; }
  for (const d of dirs) {
    const full = path.join(cacheRoot(), d);
    let files = [];
    try { files = fs.readdirSync(full); } catch { continue; }
    for (const f of files) {
      try { const st = fs.statSync(path.join(full, f)); out.push({ path: path.join(full, f), size: st.size, mtime: st.mtimeMs, eml: f.endsWith('.eml') }); } catch { /* weg */ }
    }
  }
  return out;
}

function cacheSize() { return cacheFiles().reduce((n, f) => n + f.size, 0); }

/** Hält die Ablage unter der Größengrenze (älteste Nachrichtentexte zuerst löschen) */
function enforceCacheLimit() {
  const limit = offlinePrefs().limitMB * 1024 * 1024;
  const files = cacheFiles();
  let total = files.reduce((n, f) => n + f.size, 0);
  if (total <= limit) return;
  for (const f of files.filter((x) => x.eml).sort((a, b) => a.mtime - b.mtime)) {
    try { fs.unlinkSync(f.path); total -= f.size; } catch { /* egal */ }
    if (total <= limit * 0.8) break;
  }
}

// ---------------------------------------------------------------- Senden

const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const textToHtml = (t) => escHtml(t).replace(/\r?\n/g, '<br>');
const plainSignatureBlock = (acc) => { const s = (acc.signature || '').trim(); return s ? `\n\n-- \n${s}` : ''; };
const isRichHtml = (h) => /<(img|a|b|strong|i|em|u|font|table|span[^>]*style|p[^>]*style|div[^>]*style)\b/i.test(h || '');

/** Ersetzt den Text-Platzhalter der Signatur durch die formatierte HTML-Signatur */
function htmlForDraft(body, acc) {
  const sigHtml = acc.signatureHtml || '';
  const block = plainSignatureBlock(acc);
  if (!isRichHtml(sigHtml) || !block) return null;
  const i = body.indexOf(block);
  if (i < 0) return null;
  const before = body.slice(0, i);
  const after = body.slice(i + block.length);
  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px">${textToHtml(before)}<br><br>`
    + `<div class="simplemail-signature">${sigHtml}</div>${after ? `<br>${textToHtml(after)}` : ''}</div>`;
}

/** Formatierter Editor-Inhalt → HTML-Teil der Mail */
function composedHtml(html) {
  const body = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/[a-z-]+:\s*var\(--[^;"]*\);?\s*/gi, '')   // App-Farbvariablen gehören nicht in die Mail
    .replace(/\sstyle="\s*"/gi, '')
    .replace(/class="sm-sig"/g, 'class="simplemail-signature"');
  return '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>'
    + `<div style="font-family:'Segoe UI',Arial,sans-serif;font-size:14px">${body}</div></body></html>`;
}

async function buildMessage(draft, acc) {
  const files = [];
  let total = 0;
  for (const a of draft.attachments || []) {
    if (a.key && attachmentCache.has(a.key)) {
      const c = attachmentCache.get(a.key);
      total += c.content.length;
      files.push({ filename: c.filename, content: c.content, contentType: c.contentType });
    } else if (a.path) {
      const content = await fs.promises.readFile(a.path);
      total += content.length;
      files.push({ filename: a.name || path.basename(a.path), content });
    }
    if (total > MAX_ATTACH_BYTES) throw new Error('Anhänge zu groß (max. ca. 20 MB insgesamt).');
  }
  const mail = {
    from: acc.displayName ? { name: acc.displayName, address: acc.email } : acc.email,
    to: draft.to,
    cc: draft.cc || undefined,
    subject: draft.subject || '',
    text: draft.body || '',
    html: (draft.html ? composedHtml(draft.html) : htmlForDraft(draft.body || '', acc)) || undefined,
    attachDataUrls: true,   // eingebettete Bilder der Signatur → cid-Anhänge
    inReplyTo: draft.inReplyTo || undefined,
    references: draft.references || undefined,
    attachments: draft.icalMethod === 'REQUEST' && draft.icalEvent
      // zusätzlich als Datei: manche Programme (ältere Outlook-/Webmail-Versionen) werten nur den Anhang aus
      ? [...files, { filename: 'einladung.ics', content: draft.icalEvent, contentType: 'application/ics' }] : files,
    icalEvent: draft.icalEvent ? { method: draft.icalMethod === 'REQUEST' ? 'REQUEST' : 'REPLY', content: draft.icalEvent } : undefined,
    headers: { 'User-Agent': 'SimpleMail/3.1 (Windows)' },
  };
  const node = new MailComposer(mail).compile();
  const envelope = node.getEnvelope();
  if (!envelope.to || !envelope.to.length) throw new Error('Kein gültiger Empfänger angegeben.');
  const raw = await node.build();
  return { raw, envelope };
}

async function deliver(acc, raw, envelope) {
  const pw = decryptPassword(acc.password);
  const port = Number(acc.smtpPort) || 465;
  const transport = nodemailer.createTransport({
    host: acc.smtpHost, port, secure: port === 465, requireTLS: port !== 465 && !isLoopback(acc.smtpHost),
    auth: { user: acc.username, pass: cleanPassword(pw, acc.smtpHost) },
    tls: { rejectUnauthorized: !acc.allowInvalidCerts },
  });
  const head = raw.toString('binary').split('\r\n\r\n')[0];
  const msgId = (/^Message-ID:\s*(.*)$/im.exec(head) || [])[1] || '';
  const to = (envelope && envelope.to) || [];
  let info;
  try {
    info = await transport.sendMail({ envelope, raw });
  } catch (e) {
    sendLog(acc, to, msgId, 'FEHLER SMTP: ' + e.message);
    throw e;
  } finally {
    transport.close();
  }
  const reply = (info && info.response) || '';
  // Gesendet-Kopie: Google legt Mails, die über SEINEN SMTP-Server gehen, selbst ab – entscheidend ist nur der SMTP-Server
  // (3.2.20–3.2.23 prüften auch imap.gmail.com: Konten mit Google-IMAP und anderem SMTP bekamen keine Kopie)
  let sentNote = 'Gesendet-Kopie: von Google abgelegt';
  if (!isGmailHost(acc.smtpHost)) {
    try {
      sentNote = 'Gesendet-Kopie: ' + await storeSentCopy(acc, raw);
    } catch (e) {
      sentNote = 'Gesendet-Kopie FEHLGESCHLAGEN: ' + e.message;
      send('app-error', `Die Mail an ${to.join(', ')} wurde gesendet, aber nicht in „Gesendet“ abgelegt: ${e.message}`);
    }
  }
  sendLog(acc, to, msgId, `OK SMTP: ${reply} | ${sentNote}`);
}

/** Legt die gesendete Mail im Gesendet-Ordner ab (Ordnerliste notfalls erst laden) */
async function storeSentCopy(acc, raw) {
  const s = sessions.get(acc.id);
  if (!s) throw new Error('Konto ist nicht verbunden.');
  return s.run(async (c) => {
    if (!s.special.sent) await s.loadFolderList(c);
    if (!s.special.sent) throw new Error('Kein Gesendet-Ordner gefunden.');
    await c.append(s.special.sent, raw, ['\\Seen']);
    return s.special.sent;
  });
}

/** Versandprotokoll versand.log (nur lokal, ohne Inhalt): Zeit, Konto, Empfänger, Message-ID, Antwort des Servers */
function sendLog(acc, to, msgId, result) {
  try {
    const file = path.join(dataDir(), 'versand.log');
    try { if (fs.statSync(file).size > 512 * 1024) fs.renameSync(file, file + '.1'); } catch { /* neu */ }
    const line = `${new Date().toISOString()}  ${acc.email} (${acc.smtpHost}:${acc.smtpPort})  an: ${to.join(', ')}  ${msgId}  ${result}`
      .replace(/[\r\n]+/g, ' ');
    fs.appendFileSync(file, line + '\r\n');
  } catch { /* Protokoll ist optional */ }
}

function withCurrentDate(raw) {
  const s = raw.toString('binary');
  const end = s.indexOf('\r\n\r\n');
  const head = end >= 0 ? s.slice(0, end) : s;
  const fixed = head.replace(/^Date: .*$/m, 'Date: ' + new Date().toUTCString().replace('GMT', '+0000'));
  return Buffer.from(fixed + s.slice(head.length), 'binary');
}

let outboxBusy = false;
async function processOutbox() {
  if (outboxBusy) return;
  outboxBusy = true;
  try {
    const now = Date.now();
    for (const item of outbox.filter((o) => new Date(o.sendAt).getTime() <= now)) {
      await sendScheduled(item.id);
    }
  } finally {
    outboxBusy = false;
  }
}

async function sendScheduled(id) {
  const item = outbox.find((o) => o.id === id);
  if (!item) return;
  const acc = accounts.find((a) => a.id === item.accountId);
  if (!acc) { outbox = outbox.filter((o) => o.id !== id); writeJSON('outbox.json', outbox); return; }
  try {
    await deliver(acc, withCurrentDate(Buffer.from(item.raw, 'base64')), item.envelope);
    outbox = outbox.filter((o) => o.id !== id);
    notify('Geplante E-Mail gesendet', item.subject || '(Kein Betreff)');
  } catch (e) {
    item.lastError = e.message;
    item.sendAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  }
  writeJSON('outbox.json', outbox);
  send('outbox-changed', outbox.map(publicOutbox));
}

const publicOutbox = (o) => { const { raw, envelope, ...rest } = o; return rest; };

function notify(title, body) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: false });
  n.on('click', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  n.show();
}

// ---------------------------------------------------------------- Kalender-Abo (Google: „Privatadresse im iCal-Format“)

const calendarCache = { url: '', text: '', at: 0 };
const googleEventsCache = { events: null, at: 0, days: 0 };

async function loadCalendar(url, force) {
  if (!/^(https:\/\/|webcal:\/\/|http:\/\/(localhost|127\.0\.0\.1)[:/])/i.test(url)) throw new Error('Die Kalenderadresse muss mit https:// beginnen.');
  const real = url.replace(/^webcal:/i, 'https:');
  if (!force && calendarCache.url === real && Date.now() - calendarCache.at < 10 * 60e3) return calendarCache.text;
  try {
    const res = await net.fetch(real, { headers: { Accept: 'text/calendar' } });
    if (!res.ok) throw new Error(`Kalender konnte nicht geladen werden (HTTP ${res.status}).`);
    const text = await res.text();
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('Unter dieser Adresse liegt kein Kalender (iCal).');
    Object.assign(calendarCache, { url: real, text, at: Date.now() });
    fs.promises.writeFile(path.join(dataDir(), 'calendar.ics'), text).catch(() => {});
    return text;
  } catch (e) {
    // offline: letzte gespeicherte Fassung verwenden
    if (calendarCache.url === real && calendarCache.text) return calendarCache.text;
    try {
      const text = await fs.promises.readFile(path.join(dataDir(), 'calendar.ics'), 'utf8');
      Object.assign(calendarCache, { url: real, text, at: Date.now() - 9 * 60e3 });
      return text;
    } catch { throw e; }
  }
}

// ---------------------------------------------------------------- Regeln (automatisch einsortieren)
// Regel: { id, name, enabled, accountEmail, match: 'all'|'any', conditions: [{ field, op, value }],
//          actions: { moveTo, markRead, flag }, updatedAt, deleted }
// Es greift jeweils die erste passende Regel (Reihenfolge wie in den Einstellungen).

const RULE_TEXT = {
  from: (m) => `${m.fromName} <${m.fromAddress}>`,
  to: (m) => m.recipients || m.to || '',
  subject: (m) => m.subject || '',
  any: (m) => `${m.fromName} ${m.fromAddress} ${m.recipients || m.to} ${m.subject}`,
};

function ruleMatches(rule, m) {
  const conds = (rule.conditions || []).filter((x) => String(x.value || '').trim());
  if (!conds.length) return false;
  const test = (x) => {
    // Mehrere Begriffe mit Komma oder Semikolon: einer davon muss passen („enthält nicht“: keiner)
    const terms = String(x.value).toLowerCase().split(/[,;]/).map((t) => t.trim()).filter(Boolean);
    if (terms.length > 1) {
      const one = (t) => test({ ...x, value: t });
      return x.op === 'notContains' ? terms.every(one) : terms.some(one);
    }
    const v = String(x.value).trim().toLowerCase();
    const hay = (RULE_TEXT[x.field] || RULE_TEXT.any)(m).toLowerCase();
    // „ist gleich“ beim Absender: Adresse oder Name genau
    const whole = x.field === 'from' ? [m.fromAddress.toLowerCase(), m.fromName.toLowerCase()] : [hay];
    switch (x.op) {
      case 'equals': return whole.some((w) => w === v);
      case 'startsWith': return whole.some((w) => w.startsWith(v));
      case 'endsWith': return whole.some((w) => w.endsWith(v));
      case 'notContains': return !hay.includes(v);
      default: return hay.includes(v);
    }
  };
  return rule.match === 'any' ? conds.some(test) : conds.every(test);
}

function rulesForAccount(accountId) {
  const acc = accounts.find((a) => a.id === accountId);
  if (!acc) return [];
  const st = readJSON('settings.json', {});
  return (st.rules || []).filter((r) => !r.deleted && r.enabled !== false
    && String(r.accountEmail || '').toLowerCase() === acc.email.toLowerCase());
}

/** Nur E-Mails, die seit dem letzten Abruf neu sind (beim ersten Mal: keine) */
function newSinceLastCheck(accountId, folder, uidValidity, messages) {
  const state = readJSON('rules-state.json', {});
  const key = `${accountId}|${folder}`;
  const maxUid = messages.reduce((mx, m) => Math.max(mx, m.uid), 0);
  const prev = state[key];
  state[key] = { uidValidity, lastUid: Math.max(maxUid, prev && prev.uidValidity === uidValidity ? prev.lastUid : 0) };
  writeJSON('rules-state.json', state);
  if (!prev || prev.uidValidity !== uidValidity) return [];
  return messages.filter((m) => m.uid > prev.lastUid);
}

/** Einstellung des automatischen Spamfilters (Standard: an, mittlere Stufe) */
/** Persönliche Meeting-Räume (teams, zoom, webex, meet) + Standard-Anbieter; nur https-Links */
const MEETING_KEYS = ['teams', 'zoom', 'webex', 'meet'];
const MEETING_DEFAULTS = ['none', 'teams', 'zoom', 'webex', 'meet', 'jitsi', 'other'];
function cleanMeetingLinks(v) {
  const out = {};
  for (const k of MEETING_KEYS) {
    const u = String((v && v[k]) || '').trim();
    out[k] = /^https:\/\/\S+$/i.test(u) ? u : '';
  }
  out.default = MEETING_DEFAULTS.includes(v && v.default) ? v.default : 'none';
  return out;
}

function spamFilterSettings() {
  const sf = readJSON('settings.json', {}).spamFilter || {};
  return { enabled: sf.enabled !== false, level: security.SPAM_LEVELS[sf.level] ? sf.level : 'medium' };
}

/** Absender, die nie aussortiert werden: eigene Konten, Kontakte, vertrauenswürdige */
function spamFilterOptions() {
  const st = readJSON('settings.json', {});
  const known = new Set();
  for (const c of st.contacts || []) {
    if (c.deleted) continue;
    for (const e of c.emails || []) {
      const v = String((e && typeof e === 'object' ? e.value || e.email : e) || '').trim().toLowerCase();
      if (v) known.add(security.normalizeAddress(v));
    }
  }
  for (const [k, v] of Object.entries(st.trusted || {})) if (v && !v.deleted) known.add(security.normalizeAddress(k));
  return { own: accounts.map((a) => security.normalizeAddress(a.email)), known };
}

/** Spam-Ordner des Kontos; fehlt er, wird „Spam“ angelegt */
async function ensureJunk(s, c) {
  if (!s.folders.length) await s.loadFolderList(c);
  if (s.special.junk) return s.special.junk;
  const list = await c.list();
  const inbox = list.find((f) => f.path.toUpperCase() === 'INBOX');
  const candidates = ['Spam'];
  if (inbox && inbox.delimiter) candidates.push(`INBOX${inbox.delimiter}Spam`);
  let lastErr = null;
  for (const p of candidates) {
    try {
      await c.mailboxCreate(p);
      try { await c.mailboxSubscribe(p); } catch { /* egal */ }
      await s.loadFolderList(c);
      if (!s.special.junk) s.special.junk = p;
      send('folders-changed', s.account.id);
      return s.special.junk;
    } catch (e) { lastErr = e; }
  }
  throw new Error(`Spam-Ordner konnte nicht angelegt werden: ${lastErr ? lastErr.message : ''}`);
}

/** Wendet die Regeln an; liefert die UIDs der verschobenen E-Mails */
async function applyRules(c, accountId, folder, messages) {
  const moved = new Set();
  if (!messages.length) return moved;
  // Gesperrte Absender → Spam-Ordner
  const blocked = readJSON('settings.json', {}).blocked || {};
  const junk = sessionFor(accountId).special.junk;
  if (junk && junk !== folder && Object.keys(blocked).length) {
    const spam = messages.filter((m) => security.isBlocked(m.fromAddress, blocked)).map((m) => m.uid);
    if (spam.length) {
      try {
        await c.messageMove(spam.join(','), junk, { uid: true });
        for (const u of spam) moved.add(u);
      } catch (e) { console.error('Sperrliste:', e.message); }
    }
  }
  messages = messages.filter((m) => !moved.has(m.uid));
  // Automatischer Spamfilter
  const sf = spamFilterSettings();
  if (sf.enabled && folder.toUpperCase() === 'INBOX' && messages.length) {
    const opts = spamFilterOptions();
    const spam = messages.filter((m) => security.isSpam(m, { ...opts, level: sf.level })).map((m) => m.uid);
    if (spam.length) {
      try {
        const target = await ensureJunk(sessionFor(accountId), c);
        if (target && target !== folder) {
          await c.messageMove(spam.join(','), target, { uid: true });
          for (const u of spam) moved.add(u);
          moved.spam = spam.length;
          send('spam-filtered', accountId, spam.length);
        }
      } catch (e) { console.error('Spamfilter:', e.message); send('app-error', `Spamfilter: ${e.message}`); }
    }
    messages = messages.filter((m) => !moved.has(m.uid));
  }
  const rules = rulesForAccount(accountId);
  if (!rules.length || !messages.length) return moved;
  const groups = new Map();   // Zielordner → UIDs
  const seen = [];
  const flagged = [];
  for (const m of messages) {
    const rule = rules.find((r) => ruleMatches(r, m));
    if (!rule) continue;
    moved.hits = (moved.hits || 0) + 1;
    const act = rule.actions || {};
    if (act.markRead && !m.isRead) { seen.push(m.uid); m.isRead = true; }
    if (act.flag && !m.isFlagged) { flagged.push(m.uid); m.isFlagged = true; }
    if (act.moveTo && act.moveTo !== folder) {
      if (!groups.has(act.moveTo)) groups.set(act.moveTo, []);
      groups.get(act.moveTo).push(m.uid);
    }
  }
  if (seen.length) await c.messageFlagsAdd(seen.join(','), ['\\Seen'], { uid: true });
  if (flagged.length) await c.messageFlagsAdd(flagged.join(','), ['\\Flagged'], { uid: true });
  for (const [target, uids] of groups) {
    try {
      await c.messageMove(uids.join(','), target, { uid: true });
      for (const u of uids) moved.add(u);
    } catch (e) {
      console.error(`Regel: Verschieben nach ${target} fehlgeschlagen:`, e.message);
      send('app-error', `Regel: Verschieben nach „${target}“ fehlgeschlagen – ${e.message}`);
    }
  }
  return moved;
}

// ---------------------------------------------------------------- Synchronisation (Mac ↔ Windows)
// Ein JSON-Dokument liegt als Mail im versteckten IMAP-Ordner „SimpleMail-Sync“ eines eigenen Kontos.
// Jeder Eintrag trägt updatedAt; beim Abgleich gewinnt der neuere, Löschungen bleiben als „deleted“ erhalten.

let settingsVersion = 0;
let syncBusy = false;
let syncAgain = false;   // während eines Abgleichs angefordert → danach nochmals

const ts = (x) => (x && Number(x.updatedAt)) || 0;

function mergeMaps(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) if (!out[k] || ts(v) > ts(out[k])) out[k] = v;
  return out;
}

function mergeDocs(local, remote) {
  if (!remote) return local;
  const prefs = { ...(local.prefs || {}) };
  for (const [k, v] of Object.entries(remote.prefs || {})) if (!prefs[k] || ts(v) > ts(prefs[k])) prefs[k] = v;
  return {
    format: 1,
    accounts: mergeAccounts(local.accounts, remote.accounts),
    snippets: mergeMaps(local.snippets, remote.snippets),
    rules: mergeMaps(local.rules, remote.rules),
    contacts: mergeMaps(local.contacts, remote.contacts),
    snoozes: mergeMaps(local.snoozes, remote.snoozes),
    trusted: mergeMaps(local.trusted, remote.trusted),
    blocked: mergeMaps(local.blocked, remote.blocked),
    senderCats: mergeMaps(local.senderCats, remote.senderCats),
    folderColors: mergeMaps(local.folderColors, remote.folderColors),
    prefs,
  };
}

const ACCOUNT_FIELDS = ['displayName', 'email', 'username', 'imapHost', 'imapPort', 'smtpHost', 'smtpPort', 'allowInvalidCerts'];
const SIG_FIELDS = ['signature', 'signatureHtml'];
// Kontofarbe hat einen eigenen Zeitstempel (wie die Signatur) – unabhängig von Serveränderungen
const COLOR_FIELDS = ['color'];

function mergeAccounts(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const mine = out[k];
    if (!mine) { out[k] = v; continue; }
    const base = ts(v) > ts(mine) ? { ...v } : { ...mine };
    if (!base.deleted && !mine.deleted && !v.deleted) {
      const sigSrc = (v.sigUpdatedAt || 0) > (mine.sigUpdatedAt || 0) ? v : mine;
      for (const f of SIG_FIELDS) base[f] = sigSrc[f];
      base.sigUpdatedAt = sigSrc.sigUpdatedAt || 0;
      const colSrc = (v.colorUpdatedAt || 0) > (mine.colorUpdatedAt || 0) ? v : mine;
      for (const f of COLOR_FIELDS) base[f] = colSrc[f] || '';
      base.colorUpdatedAt = colSrc.colorUpdatedAt || 0;
    }
    out[k] = base;
  }
  return out;
}

function buildLocalDoc() {
  const st = readJSON('settings.json', {});
  const meta = readJSON('sync-state.json', {});
  const doc = { format: 1, accounts: {}, snippets: {}, rules: {}, contacts: {}, snoozes: {}, trusted: {}, blocked: {}, senderCats: {}, folderColors: {}, prefs: {} };
  for (const a of accounts) {
    const e = {};
    for (const f of ACCOUNT_FIELDS.concat(SIG_FIELDS)) if (a[f] !== undefined) e[f] = a[f];
    e.updatedAt = a.updatedAt || 1;
    e.sigUpdatedAt = a.sigUpdatedAt || 0;
    e.color = a.color || '';
    e.colorUpdatedAt = a.colorUpdatedAt || 0;
    doc.accounts[a.email.toLowerCase()] = e;
  }
  for (const [email, t] of Object.entries(meta.deletedAccounts || {})) {
    if (!doc.accounts[email] || t > ts(doc.accounts[email])) doc.accounts[email] = { email, deleted: true, updatedAt: t };
  }
  for (const sn of st.snippets || []) doc.snippets[sn.id] = { ...sn, updatedAt: sn.updatedAt || 1 };
  for (const r of st.rules || []) doc.rules[r.id] = { ...r, updatedAt: r.updatedAt || 1 };
  for (const c of st.contacts || []) doc.contacts[c.id] = { ...c, updatedAt: c.updatedAt || 1 };
  const emailOf = (id) => { const a = accounts.find((x) => x.id === id); return a ? a.email.toLowerCase() : null; };
  for (const z of st.snoozes || []) {
    const email = (z.accountEmail || emailOf(z.accountId) || '').toLowerCase();
    if (!email) continue;
    const { accountId, ...rest } = z;
    doc.snoozes[`${email}|${z.messageId || z.uid}`] = { ...rest, accountEmail: email, updatedAt: z.updatedAt || 1 };
  }
  for (const [addr, v] of Object.entries(st.trusted || {})) doc.trusted[addr] = { deleted: !!v.deleted, updatedAt: v.updatedAt || 1 };
  for (const [addr, v] of Object.entries(st.blocked || {})) doc.blocked[addr] = { deleted: !!v.deleted, updatedAt: v.updatedAt || 1 };
  // 3.2.29: Kategorie je Absender (Mail auf Kategorie gezogen)
  for (const [addr, v] of Object.entries(st.senderCats || {})) doc.senderCats[addr] = { category: v.category || '', deleted: !!v.deleted, updatedAt: v.updatedAt || 1 };
  // 3.2.38: Schriftfarbe je Ordner („adresse|Pfad“)
  for (const [k, v] of Object.entries(st.folderColors || {})) doc.folderColors[k] = { color: v.color || '', deleted: !!v.deleted, updatedAt: v.updatedAt || 1 };
  if (st.blockImages !== undefined) doc.prefs.blockImages = { value: !!st.blockImages, updatedAt: st.blockImagesUpdatedAt || 1 };
  if (st.openWithUpdatedAt) doc.prefs.openWith = { value: { ...(st.openWith || {}) }, updatedAt: st.openWithUpdatedAt };
  if (st.meetingLinksUpdatedAt) doc.prefs.meetingLinks = { value: cleanMeetingLinks(st.meetingLinks), updatedAt: st.meetingLinksUpdatedAt };
  if (st.spamFilterUpdatedAt) {
    const sf = st.spamFilter || {};
    doc.prefs.spamFilter = { value: { enabled: sf.enabled !== false, level: sf.level || 'medium' }, updatedAt: st.spamFilterUpdatedAt };
  }
  // 3.2.31: Google-Kalender-Zugangsschlüssel (Client-ID + -Schlüssel) – die Anmeldung selbst (Refresh-Token) bleibt je Gerät
  const g = loadGoogleCfg();
  if (g && g.clientId && g.clientSecret) {
    doc.prefs.googleCalendar = { value: { clientId: g.clientId, clientSecret: g.clientSecret }, updatedAt: g.clientUpdatedAt || 1 };
  }
  return doc;
}

/** Übernimmt das abgeglichene Dokument in Konten und Einstellungen dieses Geräts */
const CONN_FIELDS = ['username', 'imapHost', 'imapPort', 'smtpHost', 'smtpPort', 'allowInvalidCerts'];
let pending = [];   // Serveränderungen, die auf Bestätigung warten

function applyDoc(doc) {
  let accountsChanged = false;
  const restart = [];
  pending = [];
  for (const [email, e] of Object.entries(doc.accounts)) {
    const i = accounts.findIndex((a) => a.email.toLowerCase() === email);
    if (e.deleted) {
      if (i >= 0 && ts(e) > (accounts[i].updatedAt || 0)) {
        const s = sessions.get(accounts[i].id);
        if (s) s.close();
        sessions.delete(accounts[i].id);
        accounts.splice(i, 1);
        accountsChanged = true;
      }
      continue;
    }
    if (i < 0) {
      // Konto vom anderen Gerät – Passwort muss hier einmal eingegeben werden
      const a = { id: crypto.randomUUID(), updatedAt: ts(e), sigUpdatedAt: e.sigUpdatedAt || 0,
        color: e.color || '', colorUpdatedAt: e.colorUpdatedAt || 0, fromSync: true };
      for (const f of ACCOUNT_FIELDS.concat(SIG_FIELDS)) if (e[f] !== undefined) a[f] = e[f];
      accounts.push(a);
      accountsChanged = true;
    } else {
      const a = accounts[i];
      if (ts(e) > (a.updatedAt || 0)) {
        // Vergleich unempfindlich gegen Groß-/Kleinschreibung, Leerzeichen und „Benutzername leer = E-Mail-Adresse“
        const norm = (acc, f, v) => {
          let x = String(v ?? '').trim().toLowerCase();
          if (f === 'username' && !x) x = String(acc.email || email).toLowerCase();
          if (f === 'allowInvalidCerts') x = String(!!v);
          return x;
        };
        const changed = CONN_FIELDS.filter((f) => e[f] !== undefined && norm(a, f, a[f]) !== norm(e, f, e[f]));
        if (changed.length) {
          // Sicherheit: geänderte Serverdaten nie automatisch übernehmen – sonst könnte jemand mit Zugriff
          // auf das Sync-Postfach Passwörter auf einen fremden Server umleiten. Der Nutzer entscheidet.
          const proposed = {};
          for (const f of changed) proposed[f] = e[f];
          pending.push({ email, updatedAt: ts(e), current: Object.fromEntries(changed.map((f) => [f, a[f]])), proposed });
        } else {
          for (const f of ACCOUNT_FIELDS) if (e[f] !== undefined) a[f] = e[f];
          a.updatedAt = ts(e);
          accountsChanged = true;
        }
      }
      if ((e.sigUpdatedAt || 0) > (a.sigUpdatedAt || 0)) {
        for (const f of SIG_FIELDS) a[f] = e[f] || '';
        a.sigUpdatedAt = e.sigUpdatedAt;
        accountsChanged = true;
      }
      if ((e.colorUpdatedAt || 0) > (a.colorUpdatedAt || 0)) {
        a.color = e.color || '';
        a.colorUpdatedAt = e.colorUpdatedAt;
        accountsChanged = true;
      }
    }
  }
  if (accountsChanged) writeJSON('accounts.json', accounts);
  for (const a of restart) startSession(a);

  const st = readJSON('settings.json', {});
  const idOf = (email) => { const a = accounts.find((x) => x.email.toLowerCase() === email); return a ? a.id : null; };
  st.snippets = Object.values(doc.snippets);
  if (doc.rules) st.rules = Object.values(doc.rules).sort((a, b) => (a.order || 0) - (b.order || 0));
  if (doc.contacts) st.contacts = Object.values(doc.contacts);
  st.snoozes = Object.values(doc.snoozes).map((z) => ({ ...z, accountId: idOf(z.accountEmail) }));
  st.trusted = doc.trusted;
  if (doc.blocked) st.blocked = doc.blocked;
  if (doc.senderCats) st.senderCats = doc.senderCats;
  if (doc.folderColors) st.folderColors = doc.folderColors;
  if (doc.prefs.blockImages) {
    st.blockImages = !!doc.prefs.blockImages.value;
    st.blockImagesUpdatedAt = ts(doc.prefs.blockImages);
  }
  if (doc.prefs.openWith && ts(doc.prefs.openWith) > (st.openWithUpdatedAt || 0)) {
    st.openWith = { ...(doc.prefs.openWith.value || {}) };
    st.openWithUpdatedAt = ts(doc.prefs.openWith);
  }
  if (doc.prefs.meetingLinks && ts(doc.prefs.meetingLinks) > (st.meetingLinksUpdatedAt || 0)) {
    st.meetingLinks = cleanMeetingLinks(doc.prefs.meetingLinks.value);
    st.meetingLinksUpdatedAt = ts(doc.prefs.meetingLinks);
  }
  if (doc.prefs.spamFilter && ts(doc.prefs.spamFilter) > (st.spamFilterUpdatedAt || 0)) {
    const v = doc.prefs.spamFilter.value || {};
    st.spamFilter = { enabled: v.enabled !== false, level: security.SPAM_LEVELS[v.level] ? v.level : 'medium' };
    st.spamFilterUpdatedAt = ts(doc.prefs.spamFilter);
  }
  applyGoogleCalendarPref(doc.prefs.googleCalendar);
  writeJSON('settings.json', st);
  writeJSON('sync-state.json', { ...readJSON('sync-state.json', {}), pending });
  return accountsChanged;
}

/** Zugangsschlüssel vom anderen Gerät übernehmen; die Anmeldung bleibt erhalten, solange die Client-ID gleich bleibt */
function applyGoogleCalendarPref(p) {
  const v = p && p.value;
  if (!v || typeof v.clientId !== 'string' || typeof v.clientSecret !== 'string') return false;
  const clientId = v.clientId.trim().slice(0, 300);
  const clientSecret = v.clientSecret.trim().slice(0, 300);
  if (!clientId || !clientSecret) return false;
  const cur = loadGoogleCfg() || {};
  if (ts(p) <= (cur.clientUpdatedAt || 0)) return false;
  if (cur.clientId === clientId && cur.clientSecret === clientSecret) {
    saveGoogleCfg({ ...cur, clientUpdatedAt: ts(p) });
    return false;
  }
  // Andere Client-ID: bisherige Anmeldung gehört zum alten Client → neu anmelden nötig
  const keep = cur.clientId === clientId ? cur : {};
  saveGoogleCfg({ ...keep, clientId, clientSecret, clientUpdatedAt: ts(p) });
  googleEventsCache.at = 0;
  return true;
}

async function syncFolderPath(s) {
  return s.run(async (c) => {
    const list = await c.list();
    const found = list.find((f) => f.name === SYNC_FOLDER);
    if (found) return found.path;
    const inbox = list.find((f) => f.path.toUpperCase() === 'INBOX');
    const candidates = [SYNC_FOLDER];
    if (inbox && inbox.delimiter) candidates.push(`INBOX${inbox.delimiter}${SYNC_FOLDER}`);
    let lastErr = null;
    for (const p of candidates) {
      try { await c.mailboxCreate(p); return p; } catch (e) { lastErr = e; }
    }
    throw new Error(`Sync-Ordner konnte nicht angelegt werden: ${lastErr ? lastErr.message : ''}`);
  });
}

// Optionale Verschlüsselung des Sync-Dokuments (identisch zur Mac-Version):
// PBKDF2-HMAC-SHA256 (210 000 Runden, 16 Byte Salt) → AES-256-GCM (12 Byte Nonce, 16 Byte Tag)
const KDF_ITER = 210000;

function syncPassphrase() {
  return decryptPassword(readJSON('sync-state.json', {}).passphrase || '');
}

// Schlüsselableitung asynchron (Thread-Pool): pbkdf2Sync blockierte den Hauptprozess bei jedem Abgleich
// für einen spürbaren Moment – in der Zeit hing jede Anfrage der Oberfläche
const pbkdf2Async = (pass, salt, iter) => new Promise((resolve, reject) => {
  crypto.pbkdf2(Buffer.from(pass, 'utf8'), salt, iter, 32, 'sha256', (err, key) => (err ? reject(err) : resolve(key)));
});

async function encryptDoc(doc, passphrase) {
  const salt = crypto.randomBytes(16);
  const nonce = crypto.randomBytes(12);
  const key = await pbkdf2Async(passphrase, salt, KDF_ITER);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(doc), 'utf8'), cipher.final()]);
  return { simplemailEncrypted: 1, kdf: 'pbkdf2-sha256', iterations: KDF_ITER, salt: salt.toString('base64'),
    nonce: nonce.toString('base64'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

async function decryptDoc(env, passphrase) {
  if (!passphrase) throw new Error('Die Synchronisation ist verschlüsselt – bitte unter „Offline & Sync“ das Sync-Passwort eingeben.');
  const iter = Number(env.iterations || KDF_ITER);
  if (!Number.isInteger(iter) || iter < 100000 || iter > 5000000) throw new Error('Sync-Dokument ungültig (Schlüsselparameter).');
  try {
    const key = await pbkdf2Async(passphrase, Buffer.from(env.salt, 'base64'), iter);
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(env.nonce, 'base64'));
    d.setAuthTag(Buffer.from(env.tag, 'base64'));
    const plain = Buffer.concat([d.update(Buffer.from(env.ciphertext, 'base64')), d.final()]);
    return JSON.parse(plain.toString('utf8'));
  } catch {
    throw new Error('Sync-Passwort falsch – die Daten konnten nicht entschlüsselt werden.');
  }
}

async function pullDoc(s, folder) {
  // Sicherheit: Nur Sync-Mails, die SimpleMail selbst per APPEND abgelegt hat (kein „Received:“ = nie per SMTP zugestellt)
  // und die von der eigenen Adresse stammen. Sonst könnte ein Fremder über „name+Ordner@“ eine Sync-Mail einschleusen.
  const own = security.normalizeAddress(s.account.email);
  const sources = await s.withMailbox(folder, async (c) => {
    const n = c.mailbox.exists || 0;
    if (!n) return [];
    const out = [];
    for await (const m of c.fetch(`${Math.max(1, n - 9)}:${n}`, { source: true })) if (m.source) out.push(m.source);
    return out.reverse();   // neueste zuerst
  });
  let att = null;
  for (const source of sources) {
    const parsed = await simpleParser(source);
    const from = parsed.from && parsed.from.value && parsed.from.value[0] ? security.normalizeAddress(parsed.from.value[0].address) : '';
    if (parsed.headers.has('received') || from !== own) continue;
    att = (parsed.attachments || []).find((a) => /simplemail-sync\.json$/i.test(a.filename || ''));
    if (att) break;
  }
  if (!att) return null;
  const obj = JSON.parse(att.content.toString('utf8'));
  if (obj && obj.simplemailEncrypted) return { doc: await decryptDoc(obj, syncPassphrase()), encrypted: true };
  return { doc: obj, encrypted: false };
}

async function pushDoc(s, folder, doc) {
  const acc = s.account;
  const pass = syncPassphrase();
  const payload = pass ? await encryptDoc(doc, pass) : doc;
  const raw = await new MailComposer({
    from: acc.email, to: acc.email, subject: SYNC_SUBJECT,
    text: 'Diese Nachricht enthält die Einstellungen von SimpleMail (Konten ohne Passwörter, Signaturen, Textbausteine, Erinnerungen).\nBitte nicht löschen – sie wird automatisch aktualisiert.',
    attachments: [{ filename: 'simplemail-sync.json', contentType: 'application/json',
      content: JSON.stringify(payload) }],
  }).compile().build();
  await s.run((c) => c.append(folder, raw, ['\\Seen']));
  // ältere Stände entfernen
  await s.withMailbox(folder, async (c) => {
    const uids = (await c.search({ all: true }, { uid: true })) || [];
    if (uids.length > 1) {
      const max = Math.max(...uids);
      await c.messageDelete(uids.filter((u) => u !== max).join(','), { uid: true });
    }
  });
}

const canonical = (doc) => JSON.stringify(doc, (k, v) => (v && typeof v === 'object' && !Array.isArray(v)
  ? Object.keys(v).sort().reduce((o, key) => { o[key] = v[key]; return o; }, {}) : v));

async function syncNow() {
  const st = readJSON('settings.json', {});
  const cfg = st.sync || {};
  if (!cfg.enabled) return { ok: false, message: 'Synchronisation ist ausgeschaltet.' };
  const acc = accounts.find((a) => a.email.toLowerCase() === String(cfg.accountEmail || '').toLowerCase());
  const s = acc && sessions.get(acc.id);
  if (!s) return { ok: false, message: 'Sync-Konto ist nicht verbunden.' };
  if (syncBusy) { syncAgain = true; return { ok: true, message: 'Läuft bereits' }; }
  syncBusy = true;
  const state = readJSON('sync-state.json', {});
  try {
    const folder = await syncFolderPath(s);
    for (let attempt = 0; attempt < 2; attempt++) {
      const version = settingsVersion;
      let pulled = await pullDoc(s, folder);
      // Mit Sync-Passwort nur verschlüsselte Dokumente übernehmen: ein unverschlüsseltes könnte untergeschoben sein
      // (es wird durch den eigenen, verschlüsselten Stand ersetzt)
      if (pulled && !pulled.encrypted && syncPassphrase()) pulled = { doc: null, encrypted: false, ignored: true };
      const remote = pulled ? pulled.doc : null;
      const local = buildLocalDoc();
      const merged = mergeDocs(local, remote);
      if (version !== settingsVersion) continue;   // Einstellungen wurden gerade geändert → neu abgleichen
      const accountsChanged = applyDoc(merged);
      const wantEncrypted = !!syncPassphrase();
      if (!remote || canonical(remote) !== canonical(merged) || !pulled || pulled.encrypted !== wantEncrypted) {
        await pushDoc(s, folder, merged);
      }
      state.lastSync = new Date().toISOString();
      state.lastError = null;
      writeJSON('sync-state.json', { ...readJSON('sync-state.json', {}), lastSync: state.lastSync, lastError: null });
      send('sync-applied', { accountsChanged, pending });
      return { ok: true, message: 'Synchronisiert', lastSync: state.lastSync };
    }
    return { ok: true, message: 'Später erneut' };
  } catch (e) {
    writeJSON('sync-state.json', { ...readJSON('sync-state.json', {}), lastError: e.message });
    return { ok: false, message: e.message };
  } finally {
    syncBusy = false;
    if (syncAgain) { syncAgain = false; setTimeout(() => syncNow().catch(() => {}), 500); }
  }
}

// ---------------------------------------------------------------- Dateien

/** Programme und Skripte: werden nie direkt aus SimpleMail geöffnet, nur gesichert */
const BLOCKED_EXT = new Set(['exe', 'msi', 'msp', 'mst', 'msix', 'msixbundle', 'appx', 'appxbundle', 'appinstaller', 'bat', 'cmd',
  'com', 'scr', 'pif', 'cpl', 'vb', 'vbs', 'vbe', 'js', 'jse', 'ws', 'wsf', 'wsc', 'wsh', 'sct', 'ps1', 'ps1xml', 'ps2', 'psc1',
  'psd1', 'psm1', 'hta', 'chm', 'hlp', 'jar', 'lnk', 'url', 'website', 'scf', 'reg', 'msc', 'inf', 'gadget', 'application',
  'appref-ms', 'xbap', 'settingcontent-ms', 'library-ms', 'search-ms', 'searchconnector-ms', 'diagcab', 'cab', 'xll', 'shs',
  'app', 'pkg', 'mpkg', 'command', 'sh', 'py', 'pyw', 'pyc', 'pl', 'rb', 'workflow', 'action', 'terminal']);
/** Können Makros/Programme enthalten: nur nach Rückfrage öffnen */
const DANGEROUS_EXT = new Set(['iso', 'img', 'vhd', 'vhdx', 'udf', 'dmg', 'docm', 'dotm', 'xlsm', 'xltm', 'xlam', 'xla', 'xlm',
  'pptm', 'potm', 'ppam', 'ppsm', 'sldm', 'one', 'onepkg', 'accde', 'accdb', 'mdb', 'mde', 'ade', 'adp', 'html', 'htm', 'xhtml',
  'mht', 'mhtml', 'svg', 'shtml', 'xml', 'zip', '7z', 'rar']);

/** Dateiname ohne Steuer-/Richtungszeichen, ohne verbotene Zeichen und ohne Punkte/Leerzeichen am Ende
 *  (Windows entfernt diese beim Speichern – „rechnung.exe “ wäre sonst ein Programm ohne Warnung) */
function cleanFileName(n) {
  let s = String(n || '').normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[. \u00a0]+$/g, '').replace(/^[. \u00a0]+/g, '');
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i.test(s)) s = '_' + s;
  if (s.length > 180) { const ext = path.extname(s).slice(0, 20); s = s.slice(0, 180 - ext.length) + ext; }
  return s || 'Anhang';
}
const extOf = (name) => { const n = cleanFileName(name); const i = n.lastIndexOf('.'); return i > 0 ? n.slice(i + 1).toLowerCase() : ''; };
/** 'blocked' (Programm), 'dangerous' (Makros o. Ä.) oder '' */
const fileRisk = (name) => (BLOCKED_EXT.has(extOf(name)) ? 'blocked' : DANGEROUS_EXT.has(extOf(name)) ? 'dangerous' : '');
const isDangerousFile = (name) => !!fileRisk(name);

const safeName = cleanFileName;

/** Kennzeichnet eine gespeicherte Datei als „aus dem Internet“ (Mark of the Web):
 *  Word/Excel öffnen sie in der geschützten Ansicht, Windows SmartScreen warnt vor Programmen. */
function markFromInternet(file) {
  const target = process.platform === 'win32' ? `${file}:Zone.Identifier`
    : process.env.SIMPLEMAIL_MOTW_TEST ? `${file}.Zone.Identifier` : null;
  if (!target) return;
  try { fs.writeFileSync(target, '[ZoneTransfer]\r\nZoneId=3\r\n'); } catch { /* z. B. FAT32/Netzlaufwerk */ }
}

async function writeAttachmentFile(file, content) {
  await fs.promises.writeFile(file, content);
  markFromInternet(file);
}

/** Temporäre Kopien geöffneter Anhänge und Druckdateien aufräumen (älter als maxAgeMs) */
function cleanTemp(maxAgeMs) {
  const now = Date.now();
  const old = (p) => { try { return now - fs.statSync(p).mtimeMs > maxAgeMs; } catch { return false; } };
  const root = path.join(os.tmpdir(), 'SimpleMail');
  let dirs = [];
  try { dirs = fs.readdirSync(root); } catch { /* noch nichts */ }
  for (const d of dirs) { const p = path.join(root, d); if (old(p)) try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* noch geöffnet */ } }
  let files = [];
  try { files = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('simplemail-druck-')); } catch { /* egal */ }
  for (const f of files) { const p = path.join(os.tmpdir(), f); if (old(p)) try { fs.rmSync(p, { force: true }); } catch { /* noch geöffnet */ } }
}

function uniquePath(dir, name) {
  let p = path.join(dir, name);
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let i = 2;
  while (fs.existsSync(p)) p = path.join(dir, `${base} (${i++})${ext}`);
  return p;
}

const BLOCKED_MSG = 'Programme und Skripte werden aus Sicherheitsgründen nicht direkt aus SimpleMail geöffnet. Bei Bedarf „Sichern unter …“ und die Datei vorher mit dem Virenscanner prüfen.';
/** Darf der Anhang geöffnet werden? Programme nie, Makro-Dateien nur nach Rückfrage */
function checkOpen(a, confirmed) {
  if (!a) throw new Error('Anhang nicht mehr verfügbar – Mail bitte neu öffnen.');
  const risk = fileRisk(a.filename);
  if (risk === 'blocked') throw new Error(BLOCKED_MSG);
  if (risk === 'dangerous' && !confirmed) throw new Error('Gefährlicher Anhang – Öffnen nicht bestätigt.');
}

function tempFileFor(key) {
  const a = attachmentCache.get(key);
  if (!a) throw new Error('Anhang nicht mehr verfügbar – Mail bitte neu öffnen.');
  const dir = path.join(os.tmpdir(), 'SimpleMail', key);
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, safeName(a.filename));
  if (!fs.existsSync(p)) { fs.writeFileSync(p, a.content); markFromInternet(p); }
  return p;
}

// ---- Anhänge mit bestimmtem Programm öffnen (Kennungen wie auf dem Mac: word, libreoffice, wordcraft, preview, default)
const DOC_EXT = new Set(['doc', 'docx', 'dot', 'dotx', 'odt', 'ott', 'rtf']);
function attachmentKind(name) {
  const ext = String(name || '').split('.').pop().toLowerCase();
  if (ext === 'pdf') return 'pdf';
  return DOC_EXT.has(ext) ? 'doc' : 'other';
}
const APP_LABELS = { word: 'Microsoft Word', libreoffice: 'LibreOffice', wordcraft: 'Wordcraft', default: 'Standard-App' };
const APP_CANDIDATES = { doc: ['word', 'libreoffice', 'wordcraft'], pdf: [], other: [] };
const APP_EXE = { word: 'winword.exe', libreoffice: 'soffice.exe', wordcraft: 'wordcraft.exe' };
const appFound = new Map();      // id → { path, at }
const chosenAppPaths = new Set(); // im Dateidialog gewählte Programme (nur diese dürfen als appPaths gespeichert werden)

function regAppPath(exe) {
  const keys = [`HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}`,
    `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}`,
    `HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}`];
  return keys.reduce((p, key) => p.then((hit) => hit || new Promise((resolve) => {
    execFile('reg', ['query', key, '/ve'], { windowsHide: true, timeout: 4000 }, (err, out) => {
      const m = !err && /REG_(?:EXPAND_)?SZ\s+(.+)/i.exec(out || '');
      const v = m ? m[1].trim().replace(/^"|"$/g, '').replace(/%([^%]+)%/g, (_, n) => process.env[n] || '') : null;
      resolve(v && fs.existsSync(v) ? v : null);
    });
  })), Promise.resolve(null));
}

function findExeIn(dirs, part) {
  for (const base of dirs.filter(Boolean)) {
    let entries = [];
    try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch { continue; }
    for (const d of entries.filter((e) => e.isDirectory() && e.name.toLowerCase().includes(part))) {
      const dir = path.join(base, d.name);
      for (const sub of [dir, path.join(dir, 'bin'), path.join(dir, 'program')]) {
        let files = [];
        try { files = fs.readdirSync(sub); } catch { continue; }
        const exe = files.find((f) => f.toLowerCase().endsWith('.exe') && f.toLowerCase().includes(part))
          || files.find((f) => f.toLowerCase().endsWith('.exe') && !/unins|update|crash|helper/i.test(f));
        if (exe) return path.join(sub, exe);
      }
    }
  }
  return null;
}

async function findApp(id) {
  // selbst ausgewähltes Programm (Einstellungen bzw. „Programm suchen …“)
  const own = (readJSON('settings.json', {}).appPaths || {})[id];
  if (own && fs.existsSync(own)) return own;
  // Für Tests: SIMPLEMAIL_APP_PATHS='{"word":"/pfad/zum/programm"}'
  if (process.env.SIMPLEMAIL_APP_PATHS) {
    try { const p = JSON.parse(process.env.SIMPLEMAIL_APP_PATHS)[id]; return p && fs.existsSync(p) ? p : null; } catch { return null; }
  }
  if (process.platform !== 'win32' || !APP_EXE[id]) return null;
  const hit = appFound.get(id);
  if (hit && Date.now() - hit.at < 60000 && (!hit.path || fs.existsSync(hit.path))) return hit.path;
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs') : null;
  let p = await regAppPath(APP_EXE[id]);
  if (!p && id === 'word') {
    p = [pf, pf86].flatMap((b) => ['root\\Office16', 'Office16', 'root\\Office15', 'Office15']
      .map((o) => path.join(b, 'Microsoft Office', o, 'WINWORD.EXE'))).find((x) => fs.existsSync(x)) || null;
  }
  if (!p && id === 'libreoffice') {
    p = [pf, pf86].map((b) => path.join(b, 'LibreOffice', 'program', 'soffice.exe')).find((x) => fs.existsSync(x)) || null;
  }
  if (!p && id === 'wordcraft') p = findExeIn([pf, pf86, local, process.env.LOCALAPPDATA], 'wordcraft');
  appFound.set(id, { path: p, at: Date.now() });
  return p;
}

async function installedApps(kind) {
  const out = [];
  for (const id of APP_CANDIDATES[kind] || []) out.push({ id, label: APP_LABELS[id], installed: !!(await findApp(id)) });
  return out;
}

/** Programmdatei selbst auswählen (wenn Word/LibreOffice/Wordcraft nicht automatisch gefunden wird) */
async function chooseAppFile(id, parent) {
  const r = await dialog.showOpenDialog(parent || win, {
    title: `${APP_LABELS[id] || 'Programm'} suchen`,
    defaultPath: process.env.ProgramFiles || undefined,
    filters: process.platform === 'win32' ? [{ name: 'Programme', extensions: ['exe'] }] : [],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  appFound.delete(id);
  chosenAppPaths.add(r.filePaths[0]);
  return r.filePaths[0];
}

function launchWith(exe, file) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(exe, [file], { detached: true, stdio: 'ignore', windowsHide: false }); } catch (e) { reject(e); return; }
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

async function openFileWith(file, appId) {
  const exe = appId && appId !== 'default' && appId !== 'preview' ? await findApp(appId) : null;
  if (exe) {
    try { await launchWith(exe, file); return; } catch { /* Programm startet nicht → Standard-App */ }
  }
  const err = await shell.openPath(file);
  if (err) throw new Error(err);
}

// ---------------------------------------------------------------- IPC

/** Verständliche Fehlermeldung inkl. der Antwort des Mailservers */
function describeError(e) {
  if (!e) return 'Unbekannter Fehler';
  const server = [e.responseText, e.response, e.serverResponseCode].filter((x) => typeof x === 'string' && x.trim()).join(' ').trim();
  const all = `${e.message || ''} ${server} ${e.code || ''}`;
  let hint = '';
  if (/application-specific password|app password|InvalidSecondFactor/i.test(all)) {
    hint = 'Google verlangt ein App-Passwort (myaccount.google.com/apppasswords).';
  } else if (e.authenticationFailed || /AUTHENTICATIONFAILED|Invalid credentials|authentication failed|535|EAUTH|LOGIN failed/i.test(all)) {
    hint = 'Anmeldung abgelehnt – Benutzername oder Passwort falsch. Bei Gmail/Googlemail das App-Passwort verwenden, nicht das normale Passwort.';
  } else if (/WEBALERT|Web login required|Please log in via your web browser/i.test(all)) {
    hint = 'Google blockiert die Anmeldung – einmal im Browser bei Gmail anmelden und die Sicherheitsabfrage bestätigen.';
  } else if (/ENOTFOUND|EAI_AGAIN/i.test(all)) {
    hint = 'Server nicht gefunden – Servername prüfen bzw. Internetverbindung.';
  } else if (/ETIMEDOUT|ECONNREFUSED|ECONNRESET|EHOSTUNREACH/i.test(all)) {
    hint = 'Keine Verbindung zum Server – Port prüfen (IMAP 993, SMTP 465/587) oder Firewall/Virenscanner.';
  } else if (/certificate|self.signed|CERT_/i.test(all)) {
    hint = 'Zertifikatsproblem – bei eigenen Servern „Zertifikat nicht prüfen“ aktivieren.';
  }
  const base = server && !(e.message || '').includes(server) ? `${e.message} – Server: ${server}` : (e.message || String(e));
  return hint ? `${hint} (${base})` : base;
}

// Nur die eigenen Seiten dürfen den Hauptprozess aufrufen; Mail-Fenster und Druckvorschau nur ihre Kanäle
const PAGE_PATHS = { main: path.join(__dirname, 'renderer', 'index.html'), viewer: path.join(__dirname, 'renderer', 'viewer.html'),
  preview: path.join(__dirname, 'renderer', 'preview.html') };
const VIEWER_CHANNELS = new Set(['app:openExternal', 'attachment:open']);
const normPath = (p) => (process.platform === 'win32' ? path.normalize(p).toLowerCase() : path.normalize(p));
function pageOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'file:') return null;
    const p = normPath(fileURLToPath(u));
    return Object.keys(PAGE_PATHS).find((k) => normPath(PAGE_PATHS[k]) === p) || null;
  } catch { return null; }
}
function senderAllowed(e, channel) {
  const frame = e.senderFrame;
  if (!frame || frame.parent) return false;            // nur Hauptframe, nie ein (Mail-)iframe
  const page = pageOf(frame.url);
  if (page === 'main') return !!win && !win.isDestroyed() && e.sender === win.webContents;
  if (page === 'viewer') return viewers.has(e.sender.id) && VIEWER_CHANNELS.has(channel);
  return false;
}
/** Eigene Seite? (für will-navigate) */
const isOwnPage = (url, page) => pageOf(url) === page;

function handle(name, fn) {
  ipcMain.handle(name, async (_e, ...args) => {
    if (!senderAllowed(_e, name)) return { ok: false, error: 'Nicht erlaubt.' };
    try { return { ok: true, value: await fn(...args) }; } catch (e) { return { ok: false, error: describeError(e) }; }
  });
}

const viewers = new Map();   // webContents-ID → { win, payload }
const previews = new Map();  // webContents-ID der Druckvorschau → Druckauftrag

async function renderPreviewPdf(job) {
  const buf = await job.doc.webContents.printToPDF({
    pageSize: 'A4', landscape: job.landscape, printBackground: true,
    margins: { top: 0.6, bottom: 0.6, left: 0.55, right: 0.55 },
  });
  const old = job.pdfFile;
  job.rev += 1;
  job.pdf = buf;
  job.pages = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length || 1;
  job.pdfFile = path.join(os.tmpdir(), `simplemail-druck-${job.id}-${job.rev}.pdf`);
  await fs.promises.writeFile(job.pdfFile, buf);
  if (old) fs.promises.unlink(old).catch(() => {});
}

function registerPreviewIPC() {
  const jobOf = (e) => (e.senderFrame && !e.senderFrame.parent && pageOf(e.senderFrame.url) === 'preview' ? previews.get(e.sender.id) : null);
  const wrap = (fn) => async (e, ...args) => {
    const job = jobOf(e);
    if (!job) return { ok: false, error: 'Druckvorschau nicht mehr verfügbar.' };
    try { return { ok: true, value: await fn(job, ...args) }; } catch (err) { return { ok: false, error: describeError(err) }; }
  };
  const info = (job) => ({ title: job.title, landscape: job.landscape, pages: job.pages, pdfUrl: require('url').pathToFileURL(job.pdfFile).href + '#toolbar=0&view=Fit' });
  ipcMain.handle('preview:data', wrap((job) => info(job)));
  ipcMain.handle('preview:orientation', wrap(async (job, landscape) => {
    job.landscape = !!landscape;
    await renderPreviewPdf(job);
    return info(job);
  }));
  // Druckerliste für das eigene Druckermenü (Windows zeigt bei unsichtbaren Fenstern keinen Druckdialog)
  ipcMain.handle('preview:printers', wrap(async (job) => {
    const list = await job.doc.webContents.getPrintersAsync();
    return list.map((p) => ({ name: p.name, label: p.displayName || p.name, isDefault: !!p.isDefault }));
  }));
  ipcMain.handle('preview:print', wrap((job, opts = {}) => new Promise((resolve, reject) => {
    const o = {
      silent: true, printBackground: true, landscape: job.landscape, pageSize: 'A4',
      deviceName: opts.deviceName || '', copies: Math.max(1, Math.min(99, Number(opts.copies) || 1)),
      color: opts.color !== false, collate: true,
      margins: { marginType: 'custom', top: 43, bottom: 43, left: 40, right: 40 },
    };
    if (opts.duplex) o.duplexMode = job.landscape ? 'shortEdge' : 'longEdge';
    if (opts.from && opts.to) o.pageRanges = [{ from: Math.max(0, opts.from - 1), to: Math.max(0, opts.to - 1) }];
    job.doc.webContents.print(o, (ok, reason) => {
      if (ok) resolve(true);
      else if (/cancel/i.test(String(reason))) resolve(false);
      else reject(new Error(`Drucken fehlgeschlagen: ${reason}`));
    });
  })));
  ipcMain.handle('preview:savePdf', wrap(async (job) => {
    const name = String(job.title).replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 80) || 'E-Mail';
    const r = await dialog.showSaveDialog(job.win, {
      title: 'Als PDF speichern', defaultPath: path.join(app.getPath('documents'), `${name}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (r.canceled || !r.filePath) return false;
    await fs.promises.writeFile(r.filePath, job.pdf);
    return r.filePath;
  }));
}


/** Fenster sicher nach vorn holen (Windows lässt neue Fenster sonst gern hinter dem aktiven) */
/** mailto:-Links öffnen den eigenen Verfassen-Editor statt eines fremden Mailprogramms */
function openMailto(url) {
  if (!win || win.isDestroyed()) return false;
  bringToFront(win);
  if (win.webContents.isLoading()) { pendingMailto = String(url); return true; }   // Oberfläche holt ihn beim Start ab
  win.webContents.send('compose-mailto', String(url));
  return true;
}
/** Link aus einer Mail: mailto → eigener Editor, http(s) → Standardbrowser */
function openLink(url) {
  if (/^mailto:/i.test(url)) { if (!openMailto(url)) shell.openExternal(url); }
  else if (/^https?:/i.test(url)) shell.openExternal(url);
}

function bringToFront(w) {
  if (!w || w.isDestroyed()) return;
  if (w.isMinimized()) w.restore();
  w.show();
  if (process.platform === 'win32') {
    w.setAlwaysOnTop(true);
    w.focus();
    setTimeout(() => { if (!w.isDestroyed()) w.setAlwaysOnTop(false); }, 300);
  }
  w.moveTop();
  w.focus();
}

function registerViewerIPC() {
  const viewerOf = (e) => (e.senderFrame && !e.senderFrame.parent && pageOf(e.senderFrame.url) === 'viewer' ? viewers.get(e.sender.id) : null);
  ipcMain.handle('viewer:data', (e) => {
    const v = viewerOf(e);
    return v ? { ok: true, value: v.payload } : { ok: false, error: 'E-Mail nicht mehr verfügbar.' };
  });
  // Rechtsklick auf einen Anhang im eigenen Fenster: „Öffnen mit …“
  ipcMain.handle('viewer:attachmentMenu', async (e, key, confirmed) => {
    const v = viewerOf(e);
    const a = attachmentCache.get(key);
    if (!v || !a) return { ok: false, error: 'Anhang nicht mehr verfügbar – Mail bitte neu öffnen.' };
    const saveItem = { label: 'Sichern unter …', click: () => (async () => {
      const r = await dialog.showSaveDialog(v.win, { defaultPath: path.join(app.getPath('downloads'), safeName(a.filename)) });
      if (!r.canceled && r.filePath) await writeAttachmentFile(r.filePath, a.content);
    })().catch((err) => dialog.showErrorBox('SimpleMail', err.message)) };
    if (fileRisk(a.filename) === 'blocked') {
      Menu.buildFromTemplate([{ label: 'Programmdatei – nur sichern möglich', enabled: false }, { type: 'separator' }, saveItem]).popup({ window: v.win });
      return { ok: true, value: true };
    }
    try { checkOpen(a, confirmed); } catch (err) { return { ok: false, error: err.message }; }
    const run = (fn) => () => fn().catch((err) => dialog.showErrorBox('SimpleMail', err.message));
    const file = () => tempFileFor(key);
    const items = [{ label: 'Öffnen', click: run(() => openFileWith(file(), (readJSON('settings.json', {}).openWith || {})[attachmentKind(a.filename)] || 'default')) }];
    for (const prog of await installedApps(attachmentKind(a.filename))) {
      items.push({ label: prog.installed ? `Öffnen mit ${prog.label}` : `Öffnen mit ${prog.label} … (Programm suchen)`,
        click: run(async () => {
          if (!prog.installed) {
            const p = await chooseAppFile(prog.id, v.win);
            if (!p) return;
            const st = readJSON('settings.json', {});
            st.appPaths = { ...(st.appPaths || {}), [prog.id]: p };
            writeJSON('settings.json', st);
            send('settings-changed');
          }
          await openFileWith(file(), prog.id);
        }) });
    }
    items.push({ label: 'Öffnen mit Standard-App', click: run(() => openFileWith(file(), 'default')) });
    if (process.platform === 'win32') {
      items.push({ label: 'Öffnen mit anderer App …', click: () => {
        const child = spawn('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', file()], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true });
        child.on('error', () => {}); child.unref();
      } });
    }
    items.push({ type: 'separator' }, saveItem);
    Menu.buildFromTemplate(items).popup({ window: v.win });
    return { ok: true, value: true };
  });

  ipcMain.handle('viewer:action', (e, action) => {
    const v = viewerOf(e);
    if (!v) return { ok: false, error: 'E-Mail nicht mehr verfügbar.' };
    send('viewer-action', action, v.payload.key);
    if (['reply', 'replyAll', 'forward'].includes(action) && win) { if (win.isMinimized()) win.restore(); win.focus(); }
    if (['archive', 'delete'].includes(action)) v.win.close();
    return { ok: true, value: true };
  });
}

function registerIPC() {
  registerViewerIPC();
  registerPreviewIPC();
  handle('accounts:list', () => accounts.map(publicAccount));

  handle('accounts:save', async (acc, password) => {
    const i = accounts.findIndex((a) => a.id === acc.id);
    const { hasPassword, ...clean } = acc;
    const prev = i >= 0 ? accounts[i] : null;
    const merged = { ...(prev || {}), ...clean, id: acc.id || crypto.randomUUID(), updatedAt: Date.now() };
    const sigChanged = !prev || (prev.signature || '') !== (merged.signature || '') || (prev.signatureHtml || '') !== (merged.signatureHtml || '');
    // Signatur hat eigenen Zeitstempel: ein neu angelegtes Konto ohne Signatur überschreibt keine synchronisierte
    if (sigChanged) merged.sigUpdatedAt = (merged.signature || merged.signatureHtml) ? Date.now() : 0;
    // Farbe ebenso: nur ein bewusst gewählter Wert bekommt einen Zeitstempel
    if ((prev ? prev.color || '' : '') !== (merged.color || '')) merged.colorUpdatedAt = Date.now();
    if (password) { merged.password = encryptPassword(password); delete merged.fromSync; }
    if (!merged.password) throw new Error('Bitte ein Passwort eingeben.');
    if (i >= 0) accounts[i] = merged; else accounts.push(merged);
    writeJSON('accounts.json', accounts);
    // erneut angelegtes Konto: frühere Löschung nicht mehr synchronisieren
    const sst = readJSON('sync-state.json', {});
    if (sst.deletedAccounts && sst.deletedAccounts[merged.email.toLowerCase()]) {
      delete sst.deletedAccounts[merged.email.toLowerCase()];
      writeJSON('sync-state.json', sst);
    }
    startSession(merged);
    return publicAccount(merged);
  });

  // Nur die Kontofarbe ändern – ohne Passwort, ohne Neuverbindung
  handle('accounts:setColor', (id, color) => {
    const a = accounts.find((x) => x.id === id);
    if (!a) throw new Error('Konto nicht gefunden.');
    a.color = /^#[0-9a-f]{6}$/i.test(color || '') ? color.toLowerCase() : '';
    a.colorUpdatedAt = Date.now();
    writeJSON('accounts.json', accounts);
    return publicAccount(a);
  });

  handle('accounts:remove', (id) => {
    const gone = accounts.find((a) => a.id === id);
    if (gone) {
      const st = readJSON('sync-state.json', {});
      st.deletedAccounts = { ...(st.deletedAccounts || {}), [gone.email.toLowerCase()]: Date.now() };
      writeJSON('sync-state.json', st);
    }
    const s = sessions.get(id);
    if (s) s.close();
    sessions.delete(id);
    accounts = accounts.filter((a) => a.id !== id);
    outbox = outbox.filter((o) => o.accountId !== id);
    writeJSON('accounts.json', accounts);
    writeJSON('outbox.json', outbox);
    return true;
  });

  handle('accounts:test', async (acc, password) => {
    const existing = accounts.find((a) => a.id === acc.id);
    const pass = password || (existing ? decryptPassword(existing.password) : '');
    const port = Number(acc.imapPort) || 993;
    const c = new ImapFlow({ host: acc.imapHost, port, ...imapTls(acc.imapHost, port), auth: { user: acc.username, pass }, logger: false,
      tls: { rejectUnauthorized: !acc.allowInvalidCerts } });
    c.on('error', () => {});
    await c.connect();
    await c.logout();
    return true;
  });

  handle('mail:folders', async (accountId, withCounts = true) => {
    const s = sessionFor(accountId);
    return s.runBg(async (c) => {
      await s.loadFolderList(c);
      // Spamfilter an, aber kein Spam-Ordner: gleich anlegen, damit er in der Seitenleiste steht
      if (spamFilterSettings().enabled && !s.special.junk) {
        try { await ensureJunk(s, c); } catch (e) { console.error('Spam-Ordner:', e.message); }
      }
      if (!withCounts) return s.folders.map((f) => ({ ...f }));
      for (const f of s.folders) {
        if (!f.selectable || ['trash', 'junk', 'sent'].includes(f.role) || f.allMail || f.virtual) continue;
        try { f.unread = (await c.status(f.path, { unseen: true })).unseen || 0; } catch { f.unread = 0; }
      }
      return s.folders;
    });
  });

  // ---- Ordner verwalten (Kontextmenü der Seitenleiste)
  const PROTECTED_ROLES = ['inbox', 'sent', 'drafts', 'trash', 'junk', 'archive'];
  const folderOf = (s, p) => s.folders.find((f) => f.path === p);
  const forgetFolder = (s, p) => {
    s.known.delete(p);
    try { fs.rmSync(cacheDir(s.account.id, p), { recursive: true, force: true }); } catch { /* egal */ }
  };
  const cleanFolderName = (name) => {
    const n = String(name || '').trim();
    if (!n) throw new Error('Bitte einen Ordnernamen eingeben.');
    if (/[\\/*%\x00-\x1f]/.test(n)) throw new Error('Der Name darf keine Zeichen wie / \\ * % enthalten.');
    if (n === SYNC_FOLDER || n.toUpperCase() === 'INBOX') throw new Error('Dieser Name ist reserviert.');
    return n;
  };
  const afterFolderChange = async (s, c) => { await s.loadFolderList(c); send('folders-changed', s.account.id); return s.folders; };

  handle('folders:create', async (accountId, parent, name) => {
    const s = sessionFor(accountId);
    const n = cleanFolderName(name);
    return s.run(async (c) => {
      if (!s.folders.length) await s.loadFolderList(c);
      const par = parent ? folderOf(s, parent) : null;
      if (parent && !par) throw new Error(`Ordner „${parent}“ gibt es nicht.`);
      const full = par ? `${par.path}${par.delimiter}${n}` : n;
      if (folderOf(s, full)) throw new Error(`Ordner „${n}“ gibt es bereits.`);
      await c.mailboxCreate(full);
      try { await c.mailboxSubscribe(full); } catch { /* egal */ }
      await afterFolderChange(s, c);
      return full;
    });
  });

  handle('folders:rename', async (accountId, oldPath, name) => {
    const s = sessionFor(accountId);
    const n = cleanFolderName(name);
    return s.run(async (c) => {
      const f = folderOf(s, oldPath);
      if (!f) throw new Error(`Ordner „${oldPath}“ gibt es nicht.`);
      if (PROTECTED_ROLES.includes(f.role)) throw new Error('Systemordner können nicht umbenannt werden.');
      const cut = oldPath.lastIndexOf(f.delimiter);
      const full = cut >= 0 ? `${oldPath.slice(0, cut + 1)}${n}` : n;
      if (full === oldPath) return full;
      if (folderOf(s, full)) throw new Error(`Ordner „${n}“ gibt es bereits.`);
      if (c.mailbox && c.mailbox.path === oldPath) await c.mailboxClose().catch(() => {});
      await c.mailboxRename(oldPath, full);
      try { await c.mailboxUnsubscribe(oldPath); } catch { /* egal */ }
      try { await c.mailboxSubscribe(full); } catch { /* egal */ }
      for (const x of s.folders) if (x.path === oldPath || x.path.startsWith(oldPath + f.delimiter)) forgetFolder(s, x.path);
      await afterFolderChange(s, c);
      return full;
    });
  });

  handle('folders:delete', async (accountId, p) => {
    const s = sessionFor(accountId);
    return s.run(async (c) => {
      const f = folderOf(s, p);
      if (!f) throw new Error(`Ordner „${p}“ gibt es nicht.`);
      if (PROTECTED_ROLES.includes(f.role)) throw new Error('Systemordner (Posteingang, Gesendet, Entwürfe, Archiv, Spam, Papierkorb) können nicht gelöscht werden.');
      // Unterordner zuerst (tiefste zuerst), dann der Ordner selbst
      const subs = s.folders.filter((x) => x.path.startsWith(p + f.delimiter)).map((x) => x.path).sort((a, b) => b.length - a.length);
      if (subs.some((x) => PROTECTED_ROLES.includes(folderOf(s, x).role))) throw new Error('Der Ordner enthält einen Systemordner und kann nicht gelöscht werden.');
      if (c.mailbox && (c.mailbox.path === p || subs.includes(c.mailbox.path))) await c.mailboxClose().catch(() => {});
      for (const x of [...subs, p]) {
        try { await c.mailboxUnsubscribe(x); } catch { /* egal */ }
        await c.mailboxDelete(x);
        forgetFolder(s, x);
      }
      await afterFolderChange(s, c);
      return true;
    });
  });

  // Ordner leeren – nur Papierkorb und Spam, endgültig
  handle('folders:empty', async (accountId, p) => {
    const s = sessionFor(accountId);
    const f = folderOf(s, p);
    if (!f) throw new Error(`Ordner „${p}“ gibt es nicht.`);
    if (!['trash', 'junk'].includes(f.role)) throw new Error('Nur Papierkorb und Spam können geleert werden.');
    const n = await s.withMailbox(p, async (c) => {
      // 3.2.36: Ordner kann schon länger ausgewählt sein – neu hinzugekommene Mails erst abfragen (sonst blieben sie liegen)
      await c.noop().catch(() => {});
      let exists = c.mailbox.exists || 0;
      if (!exists) exists = ((await c.search({ all: true }, { uid: true }).catch(() => [])) || []).length;
      if (exists) await c.messageDelete('1:*');
      return exists;
    });
    forgetFolder(s, p);
    send('folders-changed', s.account.id);
    return n;
  });

  handle('folders:markAllRead', async (accountId, p) => {
    const s = sessionFor(accountId);
    const n = await s.withMailbox(p, async (c) => {
      const uids = (await c.search({ seen: false }, { uid: true })) || [];
      if (uids.length) await c.messageFlagsAdd(uidRanges(uids), ['\\Seen'], { uid: true });
      return uids.length;
    });
    const f = folderOf(s, p);
    if (f) f.unread = 0;
    return n;
  });

  // Flag für viele Mails eines Ordners auf einmal (z. B. „Alle als gelesen“ in Smart Inbox/Kategorien)
  handle('mail:flagMany', async (accountId, folder, uids, flag, on) => {
    const s = sessionFor(accountId);
    const list = (uids || []).map(Number).filter((u) => u > 0);
    if (!list.length) return 0;
    if (!['\\Seen', '\\Flagged'].includes(flag)) throw new Error('Unbekanntes Flag.');
    await s.withMailbox(folder, (c) => (on
      ? c.messageFlagsAdd(uidRanges(list), [flag], { uid: true })
      : c.messageFlagsRemove(uidRanges(list), [flag], { uid: true })));
    return list.length;
  });

  handle('mail:fetch', async (accountId, folder, low) => {
    const s = sessionFor(accountId);
    return s.withMailbox(folder, async (c) => {
      // Ist der Ordner schon geöffnet, wird er nicht neu gewählt – NOOP holt neue/gelöschte Mails ab,
      // sonst erschien eine neue Mail erst beim übernächsten Abruf
      try { await c.noop(); } catch { /* egal */ }
      const exists = c.mailbox.exists || 0;
      if (!exists) return { messages: [], low: 1 };
      let start = Math.max(1, exists - PAGE + 1);
      if (low) start = Math.min(start, Math.max(1, low));
      start = Math.max(start, exists - MAX_PER_FOLDER + 1);
      const validity = String(c.mailbox.uidValidity);
      const isInbox = folder.toUpperCase() === 'INBOX';
      const gmail = isGmail(s.account);
      // Bekannte Kopfdaten (Speicher oder Offline-Ablage) → nur UID + Flags abgleichen, neue Kopfzeilen nachladen
      let known = s.known.get(folder);
      if (!known) {
        const disk = readHeaderCache(accountId, folder);
        if (disk && disk.messages) {
          known = { uidValidity: disk.uidValidity, byUid: new Map(disk.messages.map((m) => [m.uid, m])) };
        }
      }
      if (known && known.uidValidity !== validity) known = null;
      let messages = [];
      if (known && known.byUid.size) {
        const states = [];
        for await (const m of c.fetch(`${start}:${exists}`, { uid: true, flags: true })) states.push(m);
        // Posteingang: Mails mit älterer Kategorie-Einteilung einmal neu einordnen
        const missing = states.filter((m) => {
          const old = known.byUid.get(m.uid);
          return !old || (isInbox && old.catVersion !== CAT_VERSION);
        }).map((m) => m.uid);
        if (missing.length) {
          const fetched = [];
          for await (const m of c.fetch(uidRanges(missing), FETCH_QUERY, { uid: true })) fetched.push(convertMessage(m, accountId, folder));
          if (isInbox && gmail) await applyGmailCategories(c, fetched);
          for (const m of fetched) known.byUid.set(m.uid, m);
        }
        for (const st of states) {
          const old = known.byUid.get(st.uid);
          if (!old) continue;
          const { preview, ...base } = old;
          messages.push({ ...base,
            isRead: st.flags ? st.flags.has('\\Seen') : false,
            isFlagged: st.flags ? st.flags.has('\\Flagged') : false });
        }
      } else {
        for await (const m of c.fetch(`${start}:${exists}`, FETCH_QUERY)) messages.push(convertMessage(m, accountId, folder));
        if (isInbox && gmail) await applyGmailCategories(c, messages);
      }
      const before = known ? signatureOf([...known.byUid.values()]) : '';
      // Regeln auf neu eingegangene E-Mails im Posteingang anwenden
      if (folder.toUpperCase() === 'INBOX') {
        try {
          const fresh = newSinceLastCheck(accountId, folder, String(c.mailbox.uidValidity), messages);
          const moved = await applyRules(c, accountId, folder, fresh);
          if (moved.size) messages = messages.filter((m) => !moved.has(m.uid));
        } catch (e) { console.error('Regeln:', e.message); send('app-error', `Regeln: ${e.message}`); }
      }
      s.known.set(folder, { uidValidity: validity, byUid: new Map(messages.map((m) => [m.uid, m])) });
      // Offline-Ablage nur schreiben, wenn sich etwas geändert hat
      if (signatureOf(messages) !== before) {
        try { writeHeaderCache(accountId, folder, validity, messages, start); } catch { /* egal */ }
      }
      return { messages: attachPreviews(messages.map((m) => ({ ...m })), accountId, folder), low: start };
    });
  });

  handle('mail:body', async (accountId, folder, uid) => {
    let source = readBodyCache(accountId, folder, uid);
    if (!source) {
      const s = sessionFor(accountId);
      source = await s.withMailbox(folder, async (c) => {
        const m = await c.fetchOne(String(uid), { source: true }, { uid: true });
        if (!m || !m.source) throw new Error('Nachricht wurde nicht gefunden (evtl. bereits verschoben).');
        return m.source;
      });
      writeBodyCache(accountId, folder, uid, source);
    }
    const parsed = await simpleParser(source, { skipTextToHtml: true });
    const preview = previewOf(parsed);
    savePreviews(accountId, folder, { [uid]: preview });
    const attachments = (parsed.attachments || []).map((a) => {
      const key = crypto.randomUUID();
      const fname = cleanFileName(a.filename || a.cid || 'Anhang');
      attachmentCache.set(key, { filename: fname, contentType: a.contentType, content: a.content });
      const inline = !!a.cid && /^image\//i.test(a.contentType || '') && a.contentDisposition !== 'attachment';
      const isInvite = /text\/calendar/i.test(a.contentType || '');
      return {
        key,
        calendar: isInvite,
        filename: a.filename ? fname : (isInvite ? 'einladung.ics' : cleanFileName(a.cid || 'Anhang')),
        risk: fileRisk(fname),
        contentType: a.contentType || 'application/octet-stream',
        size: a.size || (a.content ? a.content.length : 0),
        cid: a.cid || null,
        inline: inline || (!!a.related && !!a.cid),
        dataUrl: inline && a.content.length < 5 * 1024 * 1024
          ? `data:${a.contentType};base64,${a.content.toString('base64')}` : null,
      };
    });
    // Termin-Einladung (text/calendar) erkennen
    let invite = null;
    const cal = (parsed.attachments || []).find((a) => /text\/calendar|application\/ics/i.test(a.contentType || '')
      || /\.ics$/i.test(a.filename || ''));
    if (cal) {
      try {
        const doc = ics.parseICS(cal.content.toString('utf8'));
        if (doc.events.length) invite = { method: doc.method || 'PUBLISH', event: doc.events[0] };
      } catch (e) { console.error('ICS:', e.message); }
    }
    const from = parsed.from && parsed.from.value && parsed.from.value[0] ? parsed.from.value[0] : {};
    const check = security.analyze({
      fromName: from.name || '', fromAddress: from.address || '',
      html: typeof parsed.html === 'string' ? parsed.html : '', headerLines: parsed.headerLines,
      ownAddresses: accounts.map((a) => a.email),
    });
    // Online-Meeting-Link (Teams, Zoom, Meet …) – aus der Einladung, sonst aus dem Mailtext
    const meeting = (invite && invite.event.meeting)
      || ics.findMeeting(parsed.text || '', typeof parsed.html === 'string' ? parsed.html : '');
    return {
      preview,
      invite,
      meeting,
      warnings: check.warnings,
      unsubscribe: check.unsubscribe,
      text: parsed.text || '',
      html: typeof parsed.html === 'string' ? parsed.html : null,
      cc: parsed.cc ? (Array.isArray(parsed.cc) ? parsed.cc.map((x) => x.text).join(', ') : parsed.cc.text) : '',
      attachments,
    };
  });

  handle('mail:flag', async (accountId, folder, uid, flag, on) => {
    const s = sessionFor(accountId);
    return s.withMailbox(folder, (c) => (on
      ? c.messageFlagsAdd(String(uid), [flag], { uid: true })
      : c.messageFlagsRemove(String(uid), [flag], { uid: true })));
  });

  handle('mail:archive', async (accountId, folder, uid) => {
    const s = sessionFor(accountId);
    if (!s.special.archive) throw new Error('Kein Archivordner gefunden.');
    if (s.special.archive === folder) throw new Error('Die E-Mail liegt bereits im Archiv.');
    return s.withMailbox(folder, (c) => c.messageMove(String(uid), s.special.archive, { uid: true }));
  });

  handle('mail:move', async (accountId, folder, uid, target) => {
    const s = sessionFor(accountId);
    if (!target || target === folder) return true;
    if (!s.folders.some((f) => f.path === target)) throw new Error(`Ordner „${target}“ gibt es in diesem Konto nicht.`);
    return s.withMailbox(folder, (c) => c.messageMove(String(uid), target, { uid: true }));
  });

  // In ein anderes Konto verschieben: vollständig laden, im Zielkonto ablegen, erst dann im Quellkonto löschen
  handle('mail:moveAcross', async (accountId, folder, uid, targetAccount, target, flags) => {
    if (targetAccount === accountId) {
      const s = sessionFor(accountId);
      if (!target || target === folder) return true;
      return s.withMailbox(folder, (c) => c.messageMove(String(uid), target, { uid: true }));
    }
    const src = sessionFor(accountId);
    const dst = sessionFor(targetAccount);
    let source = readBodyCache(accountId, folder, uid);
    if (!source) {
      source = await src.withMailbox(folder, async (c) => {
        const m = await c.fetchOne(String(uid), { source: true }, { uid: true });
        if (!m || !m.source) throw new Error('Nachricht wurde nicht gefunden (evtl. bereits verschoben).');
        return m.source;
      });
    }
    await dst.run(async (c) => {
      if (!dst.folders.some((f) => f.path === target)) await dst.loadFolderList(c);
      if (!dst.folders.some((f) => f.path === target)) throw new Error(`Ordner „${target}“ gibt es im Zielkonto nicht.`);
      await c.append(target, source, Array.isArray(flags) ? flags : []);
    });
    try {
      await src.withMailbox(folder, (c) => c.messageDelete(String(uid), { uid: true }));
    } catch (e) {
      throw new Error(`Die E-Mail wurde ins Zielkonto kopiert, konnte im Quellkonto aber nicht gelöscht werden (${describeError(e)}).`);
    }
    dst.changed();
    return true;
  });

  // Drucken: Seitenvorschau (PDF) in eigenem Fenster; von dort Windows-Druckdialog oder „Als PDF speichern“
  handle('mail:print', async (html, title) => {
    const id = crypto.randomUUID();
    const htmlFile = path.join(os.tmpdir(), `simplemail-druck-${id}.html`);
    await fs.promises.writeFile(htmlFile, html, 'utf8');
    const doc = new BrowserWindow({
      show: false, width: 900, height: 1200,
      webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    doc.webContents.on('will-navigate', (e) => e.preventDefault());
    doc.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    await doc.loadFile(htmlFile);
    const job = { id, htmlFile, doc, title: title || 'E-Mail', landscape: false, pdfFile: null, rev: 0 };
    await renderPreviewPdf(job);

    const pv = new BrowserWindow({
      width: 900, height: 1000, minWidth: 600, minHeight: 500,
      title: `Druckvorschau – ${job.title}`,
      backgroundColor: '#525659',
      icon: path.join(__dirname, 'assets', 'icon.png'),
      autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, plugins: true },
    });
    pv.setMenuBarVisibility(false);
    job.win = pv;
    previews.set(pv.webContents.id, job);
    pv.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    pv.webContents.on('will-navigate', (e, url) => { if (!isOwnPage(url, 'preview')) e.preventDefault(); });
    pv.on('closed', () => {
      previews.delete(job.winId);
      if (!doc.isDestroyed()) doc.destroy();
      fs.promises.unlink(htmlFile).catch(() => {});
      if (job.pdfFile) fs.promises.unlink(job.pdfFile).catch(() => {});
    });
    job.winId = pv.webContents.id;
    await pv.loadFile(path.join(__dirname, 'renderer', 'preview.html'));
    return true;
  });

  // E-Mail in eigenem Fenster (Doppelklick in der Liste)
  handle('viewer:open', (payload) => {
    for (const [wc, v] of viewers) {
      if (v.payload.key === payload.key && !v.win.isDestroyed()) { bringToFront(v.win); return true; }
      if (v.win.isDestroyed()) viewers.delete(wc);
    }
    const bounds = win && !win.isDestroyed() ? win.getBounds() : null;
    const offset = (viewers.size % 6) * 24;
    const vw = new BrowserWindow({
      width: 860, height: 900, minWidth: 520, minHeight: 400,
      x: bounds ? bounds.x + 80 + offset : undefined,
      y: bounds ? bounds.y + 30 + offset : undefined,
      show: false,   // erst zeigen, wenn fertig geladen – dann sicher im Vordergrund
      title: payload.subject || '(Kein Betreff)',
      backgroundColor: '#ffffff',
      icon: path.join(__dirname, 'assets', 'icon.png'),
      autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    vw.setMenuBarVisibility(false);
    const id = vw.webContents.id;
    viewers.set(id, { win: vw, payload });
    vw.webContents.setWindowOpenHandler(({ url }) => {
      openLink(url);
      return { action: 'deny' };
    });
    vw.webContents.on('will-navigate', (e, url) => {
      if (isOwnPage(url, 'viewer')) return;
      e.preventDefault();
      openLink(url);
    });
    vw.on('closed', () => viewers.delete(id));
    vw.once('ready-to-show', () => bringToFront(vw));
    vw.loadFile(path.join(__dirname, 'renderer', 'viewer.html'));
    return true;
  });

  handle('viewer:closeFor', (key) => {
    for (const v of viewers.values()) if (v.payload.key === key && !v.win.isDestroyed()) v.win.close();
    return true;
  });

  handle('mail:spam', async (accountId, folder, uid, toSpam) => {
    const s = sessionFor(accountId);
    return s.withMailbox(folder, async (c) => {
      const target = toSpam ? await ensureJunk(s, c) : 'INBOX';
      if (!target || target === folder) return true;
      return c.messageMove(String(uid), target, { uid: true });
    });
  });

  handle('mail:unsubscribe', async (accountId, info) => {
    if (!info) throw new Error('Kein Abmelde-Link vorhanden.');
    if (info.oneClick && info.url && /^https:\/\//i.test(info.url)) {
      const res = await net.fetch(info.url, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click',
      });
      if (!res.ok) throw new Error(`Abmelden fehlgeschlagen (HTTP ${res.status}).`);
      return 'done';
    }
    if (info.mailto && /^mailto:/i.test(info.mailto)) {
      const acc = accounts.find((a) => a.id === accountId) || accounts[0];
      const u = new URL(info.mailto);
      const to = decodeURIComponent(u.pathname);
      const draft = { to, subject: u.searchParams.get('subject') || 'unsubscribe', body: u.searchParams.get('body') || 'unsubscribe' };
      const { raw, envelope } = await buildMessage(draft, acc);
      await deliver(acc, raw, envelope);
      return 'mail';
    }
    if (info.url && /^https:\/\//i.test(info.url)) {
      shell.openExternal(info.url);
      return 'browser';
    }
    throw new Error('Kein gültiger Abmelde-Link vorhanden.');
  });

  handle('mail:delete', async (accountId, folder, uid) => {
    const s = sessionFor(accountId);
    return s.withMailbox(folder, (c) => (s.special.trash && s.special.trash !== folder
      ? c.messageMove(String(uid), s.special.trash, { uid: true })
      : c.messageDelete(String(uid), { uid: true })));
  });

  handle('mail:search', async (accountId, folder, query) => {
    const s = sessionFor(accountId);
    return s.withMailbox(folder, async (c) => {
      const uids = (await c.search({ or: [{ subject: query }, { from: query }, { body: query }] }, { uid: true })) || [];
      if (!uids.length) return [];
      const pick = uids.sort((a, b) => a - b).slice(-150);
      const out = [];
      for await (const m of c.fetch(pick.join(','), FETCH_QUERY, { uid: true })) out.push(convertMessage(m, accountId, folder));
      return attachPreviews(out, accountId, folder);
    });
  });

  handle('mail:special', (accountId) => sessionFor(accountId).special);

  // Regeln jetzt auf den Posteingang anwenden (die letzten 2000 E-Mails)
  handle('rules:run', async () => {
    let count = 0;
    const anyBlocked = Object.values(readJSON('settings.json', {}).blocked || {}).some((v) => !v.deleted);
    const report = [];
    for (const acc of accounts) {
      if (!rulesForAccount(acc.id).length && !anyBlocked && !spamFilterSettings().enabled) continue;
      const s = sessionFor(acc.id);
      count += await s.withMailbox('INBOX', async (c) => {
        const exists = c.mailbox.exists || 0;
        if (!exists) return 0;
        const list = [];
        for await (const m of c.fetch(`${Math.max(1, exists - 1999)}:${exists}`, FETCH_QUERY)) list.push(convertMessage(m, acc.id, 'INBOX'));
        const moved = await applyRules(c, acc.id, 'INBOX', list);
        report.push(`${acc.email}: ${list.length} Mails im Posteingang geprüft, ${moved.hits || 0} passend${moved.spam ? `, ${moved.spam} als Spam aussortiert` : ''}`);
        return (moved.hits || 0) + (moved.spam || 0);
      });
    }
    return { count, report: report.length ? report.join('\n') : 'Für keines der Konten gibt es eine aktive Regel.' };
  });

  handle('mail:send', async (draft) => {
    const acc = accounts.find((a) => a.id === draft.accountId) || accounts[0];
    if (!acc) throw new Error('Kein Konto eingerichtet.');
    const { raw, envelope } = await buildMessage(draft, acc);
    await deliver(acc, raw, envelope);
    return true;
  });

  handle('mail:schedule', async (draft, sendAt) => {
    const acc = accounts.find((a) => a.id === draft.accountId) || accounts[0];
    if (!acc) throw new Error('Kein Konto eingerichtet.');
    const { raw, envelope } = await buildMessage(draft, acc);
    outbox.push({ id: crypto.randomUUID(), accountId: acc.id, sendAt, subject: draft.subject || '', toDisplay: draft.to,
      raw: raw.toString('base64'), envelope, lastError: null });
    outbox.sort((a, b) => new Date(a.sendAt) - new Date(b.sendAt));
    writeJSON('outbox.json', outbox);
    send('outbox-changed', outbox.map(publicOutbox));
    return true;
  });

  // ---- Kalender
  handle('calendar:respond', async (accountId, ev, partstat) => {
    const acc = accounts.find((a) => a.id === accountId) || accounts[0];
    if (!acc) throw new Error('Kein Konto eingerichtet.');
    if (!ev || !ev.organizer || !ev.organizer.email) throw new Error('Die Einladung enthält keinen Organisator.');
    if (!['ACCEPTED', 'TENTATIVE', 'DECLINED'].includes(partstat)) throw new Error('Ungültige Antwort.');
    // eigene Adresse aus der Teilnehmerliste (falls ein Alias eingeladen wurde)
    const mine = accounts.map((a) => a.email.toLowerCase());
    const att = (ev.attendees || []).find((x) => mine.includes(String(x.email).toLowerCase()));
    const me = { email: att ? att.email : acc.email, name: acc.displayName || '' };
    const word = { ACCEPTED: 'Zugesagt', TENTATIVE: 'Mit Vorbehalt', DECLINED: 'Abgelehnt' }[partstat];
    const when = new Date(ev.start).toLocaleString('de-DE', ev.allDay ? { dateStyle: 'full' } : { dateStyle: 'full', timeStyle: 'short' });
    const draft = {
      to: ev.organizer.name ? `"${ev.organizer.name.replace(/"/g, '')}" <${ev.organizer.email}>` : ev.organizer.email,
      subject: `${word}: ${ev.summary}`,
      body: `${me.name || me.email} hat die Einladung „${ev.summary}“ (${when}) beantwortet: ${word}.`,
      icalEvent: ics.buildReply(ev, me, partstat),
    };
    const { raw, envelope } = await buildMessage(draft, acc);
    await deliver(acc, raw, envelope);
    return true;
  });

  handle('calendar:openGoogle', async (ev) => {
    // Direkt verbunden: Termin sofort eintragen; sonst vorausgefüllte Google-Seite im Browser
    ev = { ...(ev || {}) };
    // Meeting-Link auch im eingetragenen Termin behalten
    if (ev.meeting && ev.meeting.url && !String(ev.description || '').includes(ev.meeting.url)) {
      ev.description = `${ev.description ? `${ev.description}\n\n` : ''}${ev.meeting.name} beitreten: ${ev.meeting.url}`;
    }
    if (ev.meeting && ev.meeting.url && !ev.location) ev.location = ev.meeting.url;
    if (google.connected()) {
      const link = await google.createEvent(ev);
      calendarCache.at = 0;
      googleEventsCache.at = 0;
      return { created: true, link };
    }
    const url = ics.googleTemplateUrl(ev);
    if (url.startsWith('https://calendar.google.com/')) shell.openExternal(url);
    return { created: false };
  });

  // Termin/Online-Meeting anlegen und Einladung (iMIP REQUEST) an die Teilnehmer schicken
  handle('calendar:invite', async (inv) => {
    const acc = accounts.find((a) => a.id === inv.accountId) || accounts[0];
    if (!acc) throw new Error('Kein Konto eingerichtet.');
    const start = new Date(inv.start);
    const end = new Date(inv.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) throw new Error('Bitte Beginn und Dauer prüfen.');
    const mine = new Set(accounts.map((a) => a.email.toLowerCase()));
    const seen = new Set();
    const attendees = addressparser(`${inv.to || ''},${inv.cc || ''}`, { flatten: true })
      .filter((a) => a.address && /@/.test(a.address))
      .map((a) => ({ email: a.address.trim(), name: a.name || '' }))
      .filter((a) => { const k = a.email.toLowerCase(); if (seen.has(k) || mine.has(k)) return false; seen.add(k); return true; });
    if (!attendees.length) throw new Error('Bitte mindestens einen Teilnehmer angeben.');
    const ev = {
      uid: `${crypto.randomUUID()}@simplemail`, summary: String(inv.summary || '').trim() || '(ohne Titel)',
      start: start.toISOString(), end: end.toISOString(), allDay: !!inv.allDay,
      location: String(inv.location || '').trim(), description: String(inv.description || '').trim(),
      meetingUrl: String(inv.meetingUrl || '').trim(),
    };
    const provider = inv.provider || '';
    let saved = false;
    let calendarLink = '';
    if (provider === 'jitsi' && !ev.meetingUrl) ev.meetingUrl = ics.jitsiLink();
    if (provider === 'meet' && !ev.meetingUrl) {
      if (!google.connected()) throw new Error('Für einen neuen Google-Meet-Link Google Kalender verbinden (Einstellungen → Kalender) oder einen Meet-Link eintragen.');
      const r = await google.createMeetEvent(ev, attendees);
      ev.meetingUrl = r.url;
      if (r.uid) ev.uid = r.uid;
      saved = true;
      calendarLink = r.link;
      calendarCache.at = 0;
      googleEventsCache.at = 0;
    }
    if (provider && provider !== 'none' && !ev.meetingUrl) throw new Error('Bitte den Meeting-Link eintragen.');
    if (ev.meetingUrl && !/^https:\/\/\S+$/i.test(ev.meetingUrl)) throw new Error('Der Meeting-Link muss mit https:// beginnen.');
    const meet = ev.meetingUrl ? (ics.meetingFromUrl(ev.meetingUrl) || { name: 'Online-Meeting', url: ev.meetingUrl }) : null;
    const organizer = { email: acc.email, name: acc.displayName || '' };
    const when = new Date(ev.start).toLocaleString('de-DE', ev.allDay ? { dateStyle: 'full' } : { dateStyle: 'full', timeStyle: 'short' });
    const until = ev.allDay ? '' : `–${new Date(ev.end).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`;
    const textLines = [
      `Einladung: ${ev.summary}`, '', `Wann: ${when}${until}`,
      ev.location ? `Wo: ${ev.location}` : '',
      meet ? `Online-Meeting (${meet.name}): ${ev.meetingUrl}` : '',
      `Organisator: ${organizer.name ? `${organizer.name} <${organizer.email}>` : organizer.email}`,
      `Teilnehmer: ${attendees.map((a) => a.name || a.email).join(', ')}`,
      ev.description ? `\n${ev.description}` : '',
    ].filter((x, i) => x || i === 1);
    const h = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const html = `<div style="font-family:'Segoe UI',Arial,sans-serif;font-size:14px">
      <div style="font-size:18px;font-weight:600;margin-bottom:6px">${h(ev.summary)}</div>
      <div>🗓 ${h(when + until)}</div>
      ${ev.location ? `<div>📍 ${h(ev.location)}</div>` : ''}
      ${meet ? `<div style="margin:14px 0"><a href="${h(ev.meetingUrl)}" style="background:#0f6cbd;color:#fff;padding:9px 16px;border-radius:6px;text-decoration:none;font-weight:600">${h(meet.name)} – jetzt beitreten</a></div>
        <div style="color:#666;font-size:12px">Link: <a href="${h(ev.meetingUrl)}">${h(ev.meetingUrl)}</a></div>` : ''}
      <div style="margin-top:10px;color:#444">Organisator: ${h(organizer.name || organizer.email)}<br>Teilnehmer: ${h(attendees.map((a) => a.name || a.email).join(', '))}</div>
      ${ev.description ? `<div style="margin-top:12px;white-space:pre-wrap">${h(ev.description)}</div>` : ''}</div>`;
    const draft = {
      to: inv.to, cc: inv.cc || '', subject: `Einladung: ${ev.summary} – ${when}`,
      body: textLines.join('\n'), html,
      icalEvent: ics.buildRequest(ev, organizer, attendees), icalMethod: 'REQUEST',
    };
    const { raw, envelope } = await buildMessage(draft, acc);
    await deliver(acc, raw, envelope);
    // in den eigenen Kalender
    let opened = false;
    if (inv.saveToCalendar && !saved) {
      const calEv = { ...ev, organizer, meeting: meet };
      if (meet && !String(calEv.description).includes(ev.meetingUrl)) {
        calEv.description = `${calEv.description ? `${calEv.description}\n\n` : ''}${meet.name} beitreten: ${ev.meetingUrl}`;
      }
      if (meet && !calEv.location) calEv.location = ev.meetingUrl;
      if (google.connected()) {
        try {
          calendarLink = await google.createEvent(calEv);
          saved = true;
          calendarCache.at = 0;
          googleEventsCache.at = 0;
        } catch (e) { console.error('Google:', e.message); }
      } else {
        const url = ics.googleTemplateUrl(calEv);
        if (url.startsWith('https://calendar.google.com/')) { shell.openExternal(url); opened = true; }
      }
    }
    return { meetingUrl: ev.meetingUrl, uid: ev.uid, savedToCalendar: saved, openedTemplate: opened, calendarLink, attendees: attendees.length };
  });

  handle('meeting:detect', (text) => ics.findMeeting(String(text || '')));

  handle('google:status', () => google.status());
  handle('google:connect', async (clientId, clientSecret) => {
    // Schlüssel leer gelassen → gespeicherten (auch synchronisierten) Schlüssel zur gleichen Client-ID verwenden
    const saved = loadGoogleCfg() || {};
    if (!String(clientSecret || '').trim() && saved.clientSecret && String(clientId || '').trim() === saved.clientId) clientSecret = saved.clientSecret;
    const email = await google.connect(clientId, clientSecret);
    googleEventsCache.at = 0;
    syncNow().catch(() => {});
    return { email };
  });
  handle('google:disconnect', () => { google.disconnect(); return true; });
  // 3.2.34: Erinnerung an die Neuanmeldung ein/aus (nur dieser PC) und aktive Prüfung des Zugangs
  handle('google:setRemind', (on) => { const c = loadGoogleCfg(); if (c) saveGoogleCfg({ ...c, remind: !!on }); return google.status(); });
  handle('google:check', async () => { try { await google.verify(); } catch { /* offline: Status unverändert */ } return google.status(); });
  // Erneut anmelden mit den gespeicherten Zugangsdaten (Testmodus: Anmeldung gilt bei Google 7 Tage)
  handle('google:reconnect', async () => {
    const st = google.status();
    if (!st.clientId) throw new Error('Keine Client-ID gespeichert – bitte unter Einstellungen → Kalender verbinden.');
    const cfg = loadGoogleCfg() || {};
    const email = await google.connect(cfg.clientId, cfg.clientSecret);
    googleEventsCache.at = 0;
    return { email };
  });

  handle('calendar:openDay', (iso) => {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) {
      shell.openExternal(`https://calendar.google.com/calendar/r/day/${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`);
    }
    return true;
  });

  handle('calendar:events', async (days = 7, force = false) => {
    if (google.connected()) {
      const from = new Date(); from.setHours(0, 0, 0, 0);
      const to = new Date(from.getTime() + Math.max(1, Math.min(60, days)) * 86400e3);
      if (!force && googleEventsCache.events && Date.now() - googleEventsCache.at < 5 * 60e3 && googleEventsCache.days === days) {
        return { configured: true, source: 'google', events: googleEventsCache.events };
      }
      try {
        const events = await google.events(from, to);
        Object.assign(googleEventsCache, { events, at: Date.now(), days });
        writeJSON('google-events.json', events);
        return { configured: true, source: 'google', events };
      } catch (e) {
        // offline: letzte Fassung zeigen
        const last = googleEventsCache.events || readJSON('google-events.json', null);
        if (last && e.code !== 'reauth') return { configured: true, source: 'google', events: last, stale: true };
        throw e;
      }
    }
    const st = readJSON('settings.json', {});
    const url = String((st.calendar && st.calendar.icsUrl) || '').trim();
    if (!url) return { configured: false, events: [] };
    const text = await loadCalendar(url, force);
    const doc = ics.parseICS(text);
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + Math.max(1, Math.min(60, days)) * 86400e3);
    const events = ics.eventsBetween(doc, from, to).map((e) => ({
      summary: e.summary, start: e.start, end: e.end, allDay: e.allDay, location: e.location, meeting: e.meeting,
    }));
    return { configured: true, events, fetchedAt: calendarCache.at };
  });

  handle('outbox:list', () => outbox.map(publicOutbox));
  handle('outbox:cancel', (id) => {
    outbox = outbox.filter((o) => o.id !== id);
    writeJSON('outbox.json', outbox);
    send('outbox-changed', outbox.map(publicOutbox));
    return true;
  });
  handle('outbox:sendNow', (id) => sendScheduled(id));

  handle('settings:get', () => readJSON('settings.json', {}));
  handle('settings:set', (value) => {
    // Programmpfade nur aus dem Dateidialog übernehmen – nicht frei vom Fenster setzbar
    const before = readJSON('settings.json', {}).appPaths || {};
    const paths = {};
    for (const [id, p] of Object.entries((value && value.appPaths) || {})) {
      if (APP_EXE[id] && typeof p === 'string' && (p === before[id] || chosenAppPaths.has(p))) paths[id] = p;
    }
    writeJSON('settings.json', { ...value, appPaths: paths });
    settingsVersion++;
    return true;
  });

  handle('files:pick', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Dateien anhängen', properties: ['openFile', 'multiSelections'] });
    if (r.canceled) return [];
    return r.filePaths.map((p) => ({ path: p, name: path.basename(p), size: fs.statSync(p).size }));
  });

  handle('files:info', (paths) => paths.filter((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } })
    .map((p) => ({ path: p, name: path.basename(p), size: fs.statSync(p).size })));

  // appId leer → eingestelltes Programm der Anhangsart (Einstellungen „Anhänge öffnen“), sonst Standard-App
  handle('attachment:open', async (key, confirmed, appId) => {
    const a = attachmentCache.get(key);
    checkOpen(a, confirmed);
    const file = tempFileFor(key);
    const choice = appId || (readJSON('settings.json', {}).openWith || {})[attachmentKind(a && a.filename)] || 'default';
    await openFileWith(file, choice);
    return true;
  });

  handle('attachment:apps', async (key) => {
    const a = attachmentCache.get(key);
    return installedApps(attachmentKind(a && a.filename));
  });

  handle('apps:choose', async (id) => chooseAppFile(id));

  handle('apps:installed', async () => {
    const out = {};
    for (const id of APP_CANDIDATES.doc) out[id] = !!(await findApp(id));
    return out;
  });

  // „Öffnen mit → Andere App …“: Windows-Dialog „Öffnen mit“, sonst Programm auswählen
  handle('attachment:openWithOther', async (key, confirmed) => {
    const a = attachmentCache.get(key);
    checkOpen(a, confirmed);
    const file = tempFileFor(key);
    if (process.platform === 'win32') {
      const child = spawn('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', file],
        { detached: true, stdio: 'ignore', windowsVerbatimArguments: true });
      child.on('error', () => {});
      child.unref();
      return true;
    }
    const r = await dialog.showOpenDialog(win, { title: 'Programm wählen', properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return false;
    await launchWith(r.filePaths[0], file);
    return true;
  });

  handle('attachment:save', async (key) => {
    const a = attachmentCache.get(key);
    if (!a) throw new Error('Anhang nicht mehr verfügbar.');
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('downloads'), safeName(a.filename)) });
    if (r.canceled || !r.filePath) return false;
    await writeAttachmentFile(r.filePath, a.content);
    return true;
  });

  handle('attachment:saveAll', async (keys) => {
    const r = await dialog.showOpenDialog(win, { title: 'Anhänge sichern in …', defaultPath: app.getPath('downloads'),
      properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return false;
    let last = null;
    for (const key of keys) {
      const a = attachmentCache.get(key);
      if (!a) continue;
      last = uniquePath(r.filePaths[0], safeName(a.filename));
      await writeAttachmentFile(last, a.content);
    }
    if (last) shell.showItemInFolder(last);
    return true;
  });

  // ---- Offline-Ablage
  handle('cache:headers', (accountId, folder) => {
    const c = readHeaderCache(accountId, folder);
    return c ? { messages: attachPreviews(c.messages || [], accountId, folder), low: c.low || 1, savedAt: c.savedAt } : null;
  });

  /** Lädt Nachrichtentexte in die Ablage; liefert neue Textvorschauen { uid: text } */
  handle('cache:prefetch', async (accountId, folder, uids) => {
    if (!offlinePrefs().enabled || !uids.length) return {};
    const known = readPreviews(accountId, folder);
    const fresh = {};
    // vorhandene Texte ohne Vorschau (z. B. aus älterer Version) nachträglich auswerten
    for (const u of uids) {
      if (!known[u] && fs.existsSync(bodyCachePath(accountId, folder, u))) {
        try { fresh[u] = previewOf(await simpleParser(readBodyCache(accountId, folder, u))); } catch { /* egal */ }
      }
    }
    const missing = uids.filter((u) => !fs.existsSync(bodyCachePath(accountId, folder, u)));
    if (missing.length) {
      const s = sessionFor(accountId);
      const sources = [];
      await s.withMailboxBg(folder, async (c) => {
        for await (const m of c.fetch(uidRanges(missing), { uid: true, source: true }, { uid: true })) {
          if (m.source) { writeBodyCache(accountId, folder, m.uid, m.source); sources.push([m.uid, m.source]); }
        }
      });
      for (const [u, src] of sources) {
        try { fresh[u] = previewOf(await simpleParser(src)); } catch { /* egal */ }
      }
      enforceCacheLimit();
    }
    savePreviews(accountId, folder, fresh);
    return fresh;
  });

  handle('cache:info', () => ({ bytes: cacheSize() }));
  handle('cache:clear', () => { fs.rmSync(cacheRoot(), { recursive: true, force: true }); return true; });

  // ---- Synchronisation
  handle('sync:now', () => syncNow());
  handle('sync:status', () => {
    const { passphrase, ...rest } = readJSON('sync-state.json', {});
    return { ...rest, hasPassphrase: !!decryptPassword(passphrase || '') };
  });

  handle('sync:setPassphrase', async (pw) => {
    const st = readJSON('sync-state.json', {});
    st.passphrase = pw ? encryptPassword(pw) : '';
    writeJSON('sync-state.json', st);
    return syncNow();
  });

  /** Serveränderung vom anderen Gerät übernehmen (accept) oder ablehnen */
  handle('sync:resolve', (email, accept) => {
    const st = readJSON('sync-state.json', {});
    const p = (st.pending || []).find((x) => x.email === email);
    const a = accounts.find((x) => x.email.toLowerCase() === email);
    if (!p || !a) return false;
    if (accept) {
      for (const [f, v] of Object.entries(p.proposed)) a[f] = v;
      startSession(a);
    }
    a.updatedAt = Date.now();   // eigene Entscheidung gilt ab jetzt auch für die anderen Geräte
    writeJSON('accounts.json', accounts);
    st.pending = (st.pending || []).filter((x) => x.email !== email);
    writeJSON('sync-state.json', st);
    settingsVersion++;
    syncNow().catch(() => {});
    return true;
  });

  handle('contacts:open', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Kontakte importieren', properties: ['openFile'],
      filters: [{ name: 'vCard', extensions: ['vcf', 'vcard'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const buf = await fs.promises.readFile(r.filePaths[0]);
    if (buf.length > 20 * 1024 * 1024) throw new Error('Datei zu groß (max. 20 MB).');
    return buf.toString('utf8');
  });

  handle('contacts:save', async (text) => {
    const r = await dialog.showSaveDialog(win, { title: 'Kontakte exportieren', defaultPath: 'SimpleMail-Kontakte.vcf',
      filters: [{ name: 'vCard', extensions: ['vcf'] }] });
    if (r.canceled || !r.filePath) return false;
    await fs.promises.writeFile(r.filePath, String(text), 'utf8');
    return true;
  });

  handle('files:readHtml', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Signatur laden', properties: ['openFile'],
      filters: [{ name: 'HTML', extensions: ['html', 'htm'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const buf = await fs.promises.readFile(r.filePaths[0]);
    if (buf.length > 2 * 1024 * 1024) throw new Error('Datei zu groß (max. 2 MB).');
    return buf.toString('utf8');
  });

  handle('files:imageDataUrl', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Bild für die Signatur', properties: ['openFile'],
      filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const buf = await fs.promises.readFile(r.filePaths[0]);
    if (buf.length > 400 * 1024) throw new Error('Bild zu groß (max. 400 KB) – bitte vorher verkleinern.');
    const ext = path.extname(r.filePaths[0]).slice(1).toLowerCase().replace('jpg', 'jpeg');
    return `data:image/${ext};base64,${buf.toString('base64')}`;
  });

  handle('app:notify', (title, body) => { notify(title, body); return true; });

  handle('app:setSort', (asc) => {
    const item = Menu.getApplicationMenu() && Menu.getApplicationMenu().getMenuItemById(asc ? 'sort-asc' : 'sort-desc');
    if (item) item.checked = true;
    return true;
  });

  handle('app:setListLines', (n) => {
    const item = Menu.getApplicationMenu() && Menu.getApplicationMenu().getMenuItemById(`lines-${n}`);
    if (item) item.checked = true;
    return true;
  });

  // Eigene (größere) Menüleiste im Fenster: Aufbau liefern, Klicks ausführen
  handle('menu:get', () => serializeMenu(Menu.getApplicationMenu()));
  handle('app:version', () => app.getVersion());
  handle('menu:invoke', (pathIdx) => {
    let items = Menu.getApplicationMenu() ? Menu.getApplicationMenu().items : [];
    let item = null;
    for (const i of Array.isArray(pathIdx) ? pathIdx : []) {
      item = items[Number(i)];
      if (!item) return false;
      items = item.submenu ? item.submenu.items : [];
    }
    if (!item || item.submenu || item.type === 'separator' || !item.enabled) return false;
    // nach dem Schließen der HTML-Liste ausführen (Rolle wirkt auf das fokussierte Feld)
    setImmediate(() => { if (win && !win.isDestroyed()) item.click(undefined, win, win.webContents); });
    return true;
  });

  handle('app:badge', (count, dataUrl) => {
    if (!win) return false;
    if (process.platform === 'win32') {
      win.setOverlayIcon(count > 0 && dataUrl ? nativeImage.createFromDataURL(dataUrl) : null, count > 0 ? `${count} ungelesen` : '');
    } else {
      app.setBadgeCount(count);
    }
    return true;
  });

  handle('mailhandler:status', () => mailHandlerStatus());
  handle('mailhandler:register', async () => {
    await registerMailHandler(true);
    const target = 'ms-settings:defaultapps?registeredAppUser=SimpleMail';
    if (process.env.SIMPLEMAIL_EXTERNAL_LOG) fs.appendFileSync(process.env.SIMPLEMAIL_EXTERNAL_LOG, target + '\n');
    else if (process.platform === 'win32') await shell.openExternal(target);
    return true;
  });
  // Oberfläche bereit → mailto vom Kaltstart abholen
  handle('app:takePendingMailto', () => { const u = pendingMailto; pendingMailto = null; return u; });

  handle('app:openExternal', (url) => {
    openLink(String(url || ''));
    return true;
  });
}

// ---------------------------------------------------------------- Menüleiste

/** Kürzel nur anzeigen – die Tasten selbst verarbeitet die Oberfläche (sonst doppelt ausgelöst) */
const hint = (accelerator) => ({ accelerator, registerAccelerator: false });
const cmd = (label, command, accelerator) => ({ label, ...(accelerator ? hint(accelerator) : {}), click: () => send('menu', command) });

/** Standard-Kürzel der Rollen (nur Anzeige in der HTML-Menüleiste) */
const ROLE_KEYS = {
  undo: 'Ctrl+Z', redo: 'Ctrl+Y', cut: 'Ctrl+X', copy: 'Ctrl+C', paste: 'Ctrl+V', selectAll: 'Ctrl+A',
  zoomIn: 'Ctrl+Plus', zoomOut: 'Ctrl+-', resetZoom: 'Ctrl+0', togglefullscreen: 'F11', quit: 'Alt+F4',
};
const keyLabel = (acc) => String(acc || '').split('+').map((k) => ({
  Ctrl: 'Strg', CmdOrCtrl: 'Strg', CommandOrControl: 'Strg', Shift: 'Umschalt', Delete: 'Entf', Plus: '+', Enter: 'Enter',
}[k] || k)).join('+');

/** Anwendungsmenü als einfache Daten für die Menüleiste im Fenster */
function serializeMenu(menu) {
  const conv = (it) => {
    if (it.type === 'separator') return { sep: true };
    const raw = String(it.label || '');
    const m = raw.match(/&(\S)/);
    const accel = it.accelerator || ROLE_KEYS[it.role] || '';
    return {
      label: raw.replace(/&(\S)/, '$1'),
      mnemonic: m ? m[1].toLowerCase() : '',
      keys: accel ? keyLabel(accel) : '',
      type: it.type, checked: !!it.checked, enabled: it.enabled !== false,
      items: it.submenu ? it.submenu.items.map(conv) : null,
    };
  };
  return menu ? menu.items.map(conv) : [];
}

function showShortcuts() {
  dialog.showMessageBox(win, {
    type: 'info', title: 'Tastenkürzel', message: 'Tastenkürzel',
    detail: [
      'Strg+N  Neue E-Mail', 'F5  Abrufen', 'Strg+F  Suchen (Enter = alle Ordner)',
      'Strg+P  Drucken', 'Enter / Doppelklick  E-Mail in eigenem Fenster', 'Strg+R  Antworten', 'Strg+Umschalt+R  Allen antworten', 'Strg+Umschalt+F  Weiterleiten',
      'E  Archivieren', 'Entf  Löschen', 'S  Markieren', 'Strg+U  Gelesen/ungelesen',
      '↑ / ↓  Vorherige/nächste E-Mail', 'Strg+Enter  Senden (im Verfassen-Fenster)', 'Strg+,  Einstellungen',
    ].join('\n'),
  });
}

function buildMenu() {
  return Menu.buildFromTemplate([
    { label: '&Datei', submenu: [
      cmd('Neue E-Mail', 'compose', 'Ctrl+N'),
      cmd('Neuer Termin / Online-Meeting …', 'meeting', 'Ctrl+Shift+M'),
      cmd('Google Kalender neu anmelden', 'google-reconnect'),
      cmd('E-Mails abrufen', 'refresh', 'F5'),
      { type: 'separator' },
      cmd('Drucken …', 'print', 'Ctrl+P'),
      { type: 'separator' },
      cmd('Einstellungen …', 'settings', 'Ctrl+,'),
      { type: 'separator' },
      { label: 'Beenden', role: 'quit', accelerator: 'Alt+F4' },
    ] },
    { label: '&Bearbeiten', submenu: [
      { label: 'Rückgängig', role: 'undo' },
      { label: 'Wiederholen', role: 'redo' },
      { type: 'separator' },
      { label: 'Ausschneiden', role: 'cut' },
      { label: 'Kopieren', role: 'copy' },
      { label: 'Einfügen', role: 'paste' },
      { label: 'Alles auswählen', role: 'selectAll' },
      { type: 'separator' },
      cmd('Suchen', 'search', 'Ctrl+F'),
    ] },
    { label: '&E-Mail', submenu: [
      cmd('Antworten', 'reply', 'Ctrl+R'),
      cmd('Allen antworten', 'replyAll', 'Ctrl+Shift+R'),
      cmd('Weiterleiten', 'forward', 'Ctrl+Shift+F'),
      { type: 'separator' },
      cmd('In eigenem Fenster öffnen', 'openWindow', 'Enter'),
      cmd('Drucken …', 'print', 'Ctrl+P'),
      { type: 'separator' },
      cmd('Gelesen / ungelesen', 'toggleRead', 'Ctrl+U'),
      cmd('Markieren', 'flag', 'S'),
      cmd('Später erinnern …', 'snooze'),
      { type: 'separator' },
      cmd('Archivieren', 'archive', 'E'),
      cmd('Löschen', 'delete', 'Delete'),
      { type: 'separator' },
      cmd('Alle Anhänge sichern …', 'saveAttachments'),
    ] },
    { label: '&Ansicht', submenu: [
      cmd('Smart Inbox', 'view:smart', 'Ctrl+1'),
      cmd('Ungelesen', 'view:unread', 'Ctrl+2'),
      cmd('Markiert', 'view:flagged', 'Ctrl+3'),
      cmd('Später', 'view:snoozed', 'Ctrl+4'),
      cmd('Geplant', 'view:scheduled', 'Ctrl+5'),
      cmd('Gesendet (alle Konten)', 'view:sent', 'Ctrl+6'),
      cmd('Papierkorb (alle Konten)', 'view:trash', 'Ctrl+7'),
      { type: 'separator' },
      { label: 'Zeilen je E-Mail', submenu: [
        { label: '1 Zeile (kompakt)', type: 'radio', id: 'lines-1', click: () => send('menu', 'lines:1') },
        { label: '2 Zeilen', type: 'radio', id: 'lines-2', checked: true, click: () => send('menu', 'lines:2') },
        { label: '3 Zeilen (mit Textvorschau)', type: 'radio', id: 'lines-3', click: () => send('menu', 'lines:3') },
      ] },
      { label: 'Sortierung nach Datum', submenu: [
        { label: 'Neueste oben (absteigend)', type: 'radio', id: 'sort-desc', checked: true, click: () => send('menu', 'sort:desc') },
        { label: 'Älteste oben (aufsteigend)', type: 'radio', id: 'sort-asc', click: () => send('menu', 'sort:asc') },
      ] },
      { type: 'separator' },
      { label: 'Vergrößern', role: 'zoomIn', accelerator: 'Ctrl+Plus' },
      { label: 'Verkleinern', role: 'zoomOut' },
      { label: 'Originalgröße', role: 'resetZoom' },
      { type: 'separator' },
      { label: 'Vollbild', role: 'togglefullscreen' },
    ] },
    { label: '&Hilfe', submenu: [
      { label: 'Tastenkürzel', click: showShortcuts },
      { label: 'Anleitung (LIESMICH)', click: () => {
        const readme = path.join(path.dirname(process.execPath), 'LIESMICH.txt');
        if (fs.existsSync(readme)) shell.openPath(readme);
        else dialog.showMessageBox(win, { type: 'info', message: 'LIESMICH.txt liegt im Programmordner von SimpleMail.' });
      } },
      { type: 'separator' },
      { label: 'Über SimpleMail', click: () => dialog.showMessageBox(win, {
        type: 'info', title: 'Über SimpleMail', message: `SimpleMail ${app.getVersion()}`,
        detail: 'Schlanker E-Mail-Client für Windows und Mac.\nDaten: ' + dataDir(),
        icon: nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')),
      }) },
    ] },
  ]);
}

// ---------------------------------------------------------------- Fenster

function createWindow() {
  win = new BrowserWindow({
    width: 1320, height: 820, minWidth: 980, minHeight: 600,
    title: 'SimpleMail',
    backgroundColor: '#f3f3f3',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  // Natives Menü bleibt für die Tastenkürzel aktiv, wird aber nicht gezeigt –
  // die Oberfläche zeichnet eine eigene, größere Menüleiste (Windows-Systemschrift ist sehr klein)
  win.setMenuBarVisibility(false);
  win.webContents.session.setSpellCheckerLanguages(['de-DE', 'en-US']);
  // Links aus Mails im Standardbrowser öffnen, nie im App-Fenster
  win.webContents.setWindowOpenHandler(({ url }) => {
    openLink(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (isOwnPage(url, 'main')) return;
    e.preventDefault();
    openLink(url);
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('closed', () => { win = null; });
}

// ---------------------------------------------------------------- Standard-Mailprogramm (mailto)
// 3.2.37: SimpleMail kommt ohne Installer → selbst unter HKCU als Mailprogramm registrieren,
// damit es in Windows-Einstellungen → Standard-Apps → mailto auswählbar ist. Setzen darf nur der Nutzer selbst.

const MAIL_PROGID = 'SimpleMail.mailto';
const MAIL_CLIENT_KEY = 'Software\\Clients\\Mail\\SimpleMail';

/** Inhalt der .reg-Datei für den aktuellen Programmpfad */
function mailHandlerRegContent(exe) {
  const s = (v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  // "--" vor %1: nichts aus dem Link kann als Chromium-Schalter gelesen werden
  const openCmd = s(`"${exe}" -- "%1"`);
  const icon = s(`"${exe}",0`);
  const H = 'HKEY_CURRENT_USER\\';
  return [
    'Windows Registry Editor Version 5.00', '',
    `[${H}Software\\Classes\\${MAIL_PROGID}]`, '@="SimpleMail E-Mail-Link"', '"URL Protocol"=""', '',
    `[${H}Software\\Classes\\${MAIL_PROGID}\\DefaultIcon]`, `@=${icon}`, '',
    `[${H}Software\\Classes\\${MAIL_PROGID}\\shell\\open\\command]`, `@=${openCmd}`, '',
    `[${H}${MAIL_CLIENT_KEY}]`, '@="SimpleMail"', '',
    `[${H}${MAIL_CLIENT_KEY}\\DefaultIcon]`, `@=${icon}`, '',
    `[${H}${MAIL_CLIENT_KEY}\\shell\\open\\command]`, `@=${s(`"${exe}"`)}`, '',
    `[${H}${MAIL_CLIENT_KEY}\\Capabilities]`, '"ApplicationName"="SimpleMail"',
    '"ApplicationDescription"="SimpleMail – schlanker E-Mail-Client"', `"ApplicationIcon"=${icon}`, '',
    `[${H}${MAIL_CLIENT_KEY}\\Capabilities\\URLAssociations]`, `"mailto"="${MAIL_PROGID}"`, '',
    `[${H}${MAIL_CLIENT_KEY}\\Capabilities\\StartMenu]`, '"Mail"="SimpleMail"', '',
    `[${H}Software\\RegisteredApplications]`, `"SimpleMail"="${MAIL_CLIENT_KEY.replace(/\\/g, '\\\\')}\\\\Capabilities"`, '',
  ].join('\r\n');
}

const mailHandlerTest = () => process.env.SIMPLEMAIL_REG_FILE;   // Tests: .reg nur schreiben, nicht importieren

/** Registrierung schreiben; force = auch wenn der gespeicherte Pfad stimmt */
async function registerMailHandler(force) {
  const test = mailHandlerTest();
  if (!test && (process.platform !== 'win32' || !app.isPackaged)) return false;
  const exe = process.execPath;
  const state = readJSON('mailhandler.json', {});
  if (!force && state.exe === exe && state.version === app.getVersion()) return true;
  const content = mailHandlerRegContent(exe);
  if (test) {
    fs.writeFileSync(test, content, 'utf8');
  } else {
    const file = path.join(os.tmpdir(), `simplemail-mailto-${process.pid}.reg`);
    // reg.exe erwartet UTF-16 mit BOM (Umlaute im Pfad)
    fs.writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(content, 'utf16le')]));
    try {
      await new Promise((res, rej) => execFile('reg.exe', ['import', file], { windowsHide: true }, (err, _o, se) => (err ? rej(new Error(String(se || err.message).trim())) : res())));
    } finally { fs.promises.unlink(file).catch(() => {}); }
  }
  writeJSON('mailhandler.json', { exe, version: app.getVersion(), at: Date.now() });
  return true;
}

/** Ist SimpleMail aktuell das Standard-Mailprogramm? (UserChoice von Windows) */
function mailHandlerStatus() {
  return new Promise((resolve) => {
    if (process.env.SIMPLEMAIL_FAKE_DEFAULT !== undefined) { resolve({ supported: true, isDefault: process.env.SIMPLEMAIL_FAKE_DEFAULT === '1' }); return; }
    if (process.platform !== 'win32') { resolve({ supported: false, isDefault: false }); return; }
    execFile('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\mailto\\UserChoice', '/v', 'ProgId'],
      { windowsHide: true }, (err, out) => {
        const m = !err && /ProgId\s+REG_SZ\s+(\S+)/i.exec(String(out));
        resolve({ supported: app.isPackaged, isDefault: !!m && m[1] === MAIL_PROGID, current: m ? m[1] : null });
      });
  });
}

/** mailto-Link aus der Kommandozeile (Aufruf durch Windows) */
function mailtoFromArgv(argv) {
  const a = (argv || []).find((x) => /^mailto:/i.test(String(x)));
  return a && a.length < 8000 ? String(a) : null;
}
let pendingMailto = null;   // beim Kaltstart: bis die Oberfläche bereit ist

// Klassische, immer sichtbare Scrollleisten statt der ausblendenden Windows-11-Variante
app.commandLine.appendSwitch('disable-features', 'FluentOverlayScrollbar,OverlayScrollbar');

// Für Tests: eigener Datenordner
if (process.env.SIMPLEMAIL_DATA) app.setPath('userData', process.env.SIMPLEMAIL_DATA);

/** Windows: Startmenü-Eintrag anlegen – nötig für Mitteilungen und praktisch zum Starten */
function ensureStartMenuShortcut() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  try {
    const lnk = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'SimpleMail.lnk');
    let current = null;
    try { current = shell.readShortcutLink(lnk); } catch { /* noch nicht vorhanden */ }
    if (!current || current.target !== process.execPath) {
      shell.writeShortcutLink(lnk, current ? 'replace' : 'create', {
        target: process.execPath,
        appUserModelId: 'de.simplemail.windows',
        description: 'SimpleMail',
        icon: process.execPath,
        iconIndex: 0,
      });
    }
  } catch { /* nicht kritisch */ }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  pendingMailto = mailtoFromArgv(process.argv);
  app.on('second-instance', (_e, argv) => {
    const url = mailtoFromArgv(argv);
    if (url && openMailto(url)) return;
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(() => {
    setTimeout(() => cleanTemp(24 * 3600e3), 5000);
    setInterval(() => cleanTemp(24 * 3600e3), 3600e3).unref();
    app.setAppUserModelId('de.simplemail.windows');
    ensureStartMenuShortcut();
    registerMailHandler(false).catch(() => {});   // Pfad nach Austausch des Ordners aktualisieren
    Menu.setApplicationMenu(buildMenu());
    accounts = readJSON('accounts.json', []);
    outbox = readJSON('outbox.json', []);
    try { migrateGoogleConnectedAt(); } catch { /* ohne Zeitpunkt weiter */ }
    registerIPC();
    createWindow();
    for (const acc of accounts) startSession(acc);
    setInterval(processOutbox, 30 * 1000);
    setInterval(() => { syncNow().catch(() => {}); }, 5 * 60 * 1000);
    powerMonitor.on('resume', () => {
      for (const acc of accounts) startSession(acc);
      send('mail-changed', null);
    });
  });

  app.on('window-all-closed', () => {
    for (const s of sessions.values()) s.close();
    app.quit();
  });
}
