'use strict';
// Direkte Anbindung an Google Kalender (OAuth 2.0 mit PKCE, Rückleitung an 127.0.0.1)
// Die Client-ID legt der Nutzer einmal in der Google Cloud Console an („Desktop-App“).

const http = require('http');
const crypto = require('crypto');
const { findMeeting } = require('./ics');

// Für Tests umleitbar
const AUTH_URL = process.env.SIMPLEMAIL_GOOGLE_AUTH || 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = process.env.SIMPLEMAIL_GOOGLE_TOKEN || 'https://oauth2.googleapis.com/token';
const API = process.env.SIMPLEMAIL_GOOGLE_API || 'https://www.googleapis.com/calendar/v3';
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
  'openid', 'email',
].join(' ');

// Google-Testmodus: Refresh-Token gilt 7 Tage (für Tests per Umgebungsvariable verkürzbar)
const LIFETIME = Number(process.env.SIMPLEMAIL_GOOGLE_LIFETIME_MS) || 7 * 86400e3;

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function createGoogle({ fetch, openExternal, load, save }) {
  // load() → { clientId, clientSecret, refreshToken, email } | null ; save(obj|null)
  let access = { token: '', expires: 0 };

  const cfg = () => load() || {};
  const connected = () => !!cfg().refreshToken;

  /** Anmeldung im Browser; liefert die E-Mail-Adresse des Google-Kontos */
  async function connect(clientId, clientSecret) {
    clientId = String(clientId || '').trim();
    clientSecret = String(clientSecret || '').trim();
    if (!/\.apps\.googleusercontent\.com$/.test(clientId) && !process.env.SIMPLEMAIL_GOOGLE_AUTH) {
      throw new Error('Die Client-ID endet normalerweise auf „.apps.googleusercontent.com“ – bitte prüfen.');
    }
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));

    const { code, redirect } = await new Promise((resolve, reject) => {
      let port = 0;
      const server = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://127.0.0.1');
        if (u.pathname !== '/') { res.writeHead(404); res.end(); return; }
        const err = u.searchParams.get('error');
        const ok = !err && u.searchParams.get('state') === state && u.searchParams.get('code');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><meta charset="utf-8"><title>SimpleMail</title>
          <body style="font-family:Segoe UI,Arial,sans-serif;text-align:center;padding:60px">
          <h2>${ok ? '✓ SimpleMail ist mit Google Kalender verbunden.' : 'Anmeldung abgebrochen.'}</h2>
          <p>Du kannst dieses Fenster schließen und zu SimpleMail zurückkehren.</p></body>`);
        clearTimeout(timer);
        server.close();
        if (ok) resolve({ code: u.searchParams.get('code'), redirect: `http://127.0.0.1:${port}` });
        else reject(new Error(err === 'access_denied' ? 'Zugriff wurde bei Google abgelehnt.' : `Anmeldung fehlgeschlagen (${err || 'ungültige Antwort'}).`));
      });
      const timer = setTimeout(() => { server.close(); reject(new Error('Zeitüberschreitung – die Anmeldung im Browser wurde nicht abgeschlossen.')); }, 5 * 60e3);
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        const q = new URLSearchParams({
          client_id: clientId, redirect_uri: `http://127.0.0.1:${port}`, response_type: 'code', scope: SCOPES,
          code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'offline', prompt: 'consent',
        });
        openExternal(`${AUTH_URL}?${q}`);
      });
    });

    const tok = await tokenRequest({
      grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: clientId,
      client_secret: clientSecret, code_verifier: verifier,
    });
    if (!tok.refresh_token) throw new Error('Google hat keinen dauerhaften Zugang erteilt. Bitte erneut verbinden.');
    let email = '';
    try {
      const payload = JSON.parse(Buffer.from(String(tok.id_token || '').split('.')[1] || '', 'base64').toString('utf8'));
      email = payload.email || '';
    } catch { /* ohne E-Mail weiter */ }
    access = { token: tok.access_token, expires: Date.now() + (tok.expires_in || 3600) * 1000 - 60e3 };
    save({ ...cfg(), clientId, clientSecret, refreshToken: tok.refresh_token, email, calendars: null, expired: false, connectedAt: Date.now() });
    return email;
  }

  async function tokenRequest(params) {
    const res = await fetch(TOKEN_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.error_description || data.error || `HTTP ${res.status}`;
      if (data.error === 'invalid_grant') {
        const c = cfg();
        if (c.refreshToken) save({ ...c, expired: true });
        throw Object.assign(new Error('Die Google-Anmeldung ist abgelaufen – bitte „Neu anmelden“ klicken.'), { code: 'reauth' });
      }
      if (data.error === 'invalid_client') throw new Error('Client-ID oder Clientschlüssel stimmen nicht.');
      throw new Error(`Google: ${msg}`);
    }
    return data;
  }

  async function token() {
    if (access.token && Date.now() < access.expires) return access.token;
    const c = cfg();
    if (!c.refreshToken) throw new Error('Nicht mit Google verbunden.');
    const tok = await tokenRequest({
      grant_type: 'refresh_token', refresh_token: c.refreshToken, client_id: c.clientId, client_secret: c.clientSecret,
    });
    access = { token: tok.access_token, expires: Date.now() + (tok.expires_in || 3600) * 1000 - 60e3 };
    return access.token;
  }

  async function api(path, opts = {}) {
    const t = await token();
    const res = await fetch(`${API}${path}`, {
      method: opts.method || 'GET',
      headers: { Authorization: `Bearer ${t}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401) { access = { token: '', expires: 0 }; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (data.error && (data.error.message || data.error.status)) || `HTTP ${res.status}`;
      if (res.status === 403 && /has not been used|is disabled/i.test(msg)) {
        throw new Error('Die „Google Calendar API“ ist im Google-Cloud-Projekt noch nicht aktiviert.');
      }
      throw new Error(`Google Kalender: ${msg}`);
    }
    return data;
  }

  /** Sichtbare Kalender des Kontos */
  async function calendars() {
    const data = await api('/users/me/calendarList?minAccessRole=reader&maxResults=250');
    return (data.items || []).filter((c) => !c.deleted && !c.hidden).map((c) => ({
      id: c.id, name: c.summaryOverride || c.summary || c.id, color: c.backgroundColor || '#4285f4',
      primary: !!c.primary, selected: c.selected !== false, writable: ['owner', 'writer'].includes(c.accessRole),
    }));
  }

  const toEvent = (e, cal) => {
    const allDay = !!(e.start && e.start.date);
    const start = allDay ? new Date(`${e.start.date}T00:00:00`) : new Date(e.start.dateTime);
    const end = allDay ? new Date(`${e.end.date}T00:00:00`) : new Date(e.end.dateTime);
    return {
      id: e.id, summary: e.summary || '(ohne Titel)', start: start.toISOString(), end: end.toISOString(), allDay,
      location: e.location || '', calendar: cal.name, color: cal.color, link: e.htmlLink || '',
      meeting: findMeeting(e.hangoutLink || '',
        ((e.conferenceData && e.conferenceData.entryPoints) || []).filter((p) => p.entryPointType === 'video').map((p) => p.uri).join(' '),
        e.location || '', e.description || ''),
    };
  };

  /** Termine im Zeitraum aus allen ausgewählten Kalendern */
  async function events(from, to) {
    const all = await calendars();
    const chosen = all.filter((c) => c.selected);
    const lists = await Promise.all(chosen.map(async (cal) => {
      const q = new URLSearchParams({
        timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
      });
      try {
        const data = await api(`/calendars/${encodeURIComponent(cal.id)}/events?${q}`);
        return (data.items || []).filter((e) => e.status !== 'cancelled' && e.start).map((e) => toEvent(e, cal));
      } catch { return []; }
    }));
    return lists.flat().sort((a, b) => new Date(a.start) - new Date(b.start));
  }

  // Ganztägig: Datum (Ende ist bei Google wie in iCalendar der Folgetag)
  const asGoogleTime = (iso, allDay) => {
    const d = new Date(iso);
    if (allDay) return { date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` };
    return { dateTime: d.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  };

  /** Termin anlegen; mit iCalUID (Einladung) per „import“, damit er nicht doppelt entsteht */
  async function createEvent(ev, calendarId = 'primary') {
    const body = {
      summary: ev.summary || '(ohne Titel)', location: ev.location || undefined, description: ev.description || undefined,
      start: asGoogleTime(ev.start, ev.allDay), end: asGoogleTime(ev.end, ev.allDay),
    };
    const cal = encodeURIComponent(calendarId);
    if (ev.uid) {
      body.iCalUID = ev.uid;
      if (ev.organizer && ev.organizer.email) body.organizer = { email: ev.organizer.email, displayName: ev.organizer.name || undefined };
      const r = await api(`/calendars/${cal}/events/import`, { method: 'POST', body });
      return r.htmlLink || '';
    }
    const r = await api(`/calendars/${cal}/events`, { method: 'POST', body });
    return r.htmlLink || '';
  }

  /**
   * Termin mit echtem Google-Meet-Link anlegen (conferenceData). Teilnehmer werden eingetragen,
   * Google verschickt aber selbst nichts (sendUpdates=none) – die Einladung schickt SimpleMail.
   */
  async function createMeetEvent(ev, attendees = [], calendarId = 'primary') {
    const body = {
      summary: ev.summary || '(ohne Titel)', location: ev.location || undefined, description: ev.description || undefined,
      start: asGoogleTime(ev.start, ev.allDay), end: asGoogleTime(ev.end, ev.allDay),
      attendees: attendees.map((a) => ({ email: a.email, displayName: a.name || undefined })),
      conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } },
    };
    const r = await api(`/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=1&sendUpdates=none`, { method: 'POST', body });
    const video = ((r.conferenceData && r.conferenceData.entryPoints) || []).find((p) => p.entryPointType === 'video');
    const url = r.hangoutLink || (video && video.uri) || '';
    if (!url) throw new Error('Google hat keinen Meet-Link erzeugt (Meet ist für dieses Konto evtl. nicht verfügbar).');
    return { url, uid: r.iCalUID || '', link: r.htmlLink || '' };
  }

  function disconnect() {
    access = { token: '', expires: 0 };
    const c = cfg();
    // Zugang bei Google widerrufen (ohne auf das Ergebnis zu warten)
    if (c.refreshToken && !process.env.SIMPLEMAIL_GOOGLE_AUTH) {
      fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(c.refreshToken)}`, { method: 'POST' }).catch(() => {});
    }
    save(c.clientId ? { clientId: c.clientId, clientSecret: c.clientSecret, clientUpdatedAt: c.clientUpdatedAt || 0, ...(c.remind === false ? { remind: false } : {}) } : null);
  }

  /** Zugang aktiv prüfen (frisches Zugriffstoken holen) – erkennt eine abgelaufene Anmeldung (invalid_grant) */
  async function verify() {
    if (!connected()) return false;
    access = { token: '', expires: 0 };
    try { await token(); return true; } catch (e) { if (e.code === 'reauth') return false; throw e; }
  }

  function status() {
    const c = cfg();
    const connectedAt = c.connectedAt || 0;
    return {
      connected: connected(), email: c.email || '', clientId: c.clientId || '', hasSecret: !!c.clientSecret, expired: !!c.expired,
      // 3.2.34: Erinnerung an die Neuanmeldung (Testmodus)
      connectedAt, expiresAt: connectedAt ? connectedAt + LIFETIME : 0, lifetime: LIFETIME, remind: c.remind !== false,
    };
  }

  return { connect, disconnect, connected, events, calendars, createEvent, createMeetEvent, verify, status };
}

module.exports = { createGoogle };
