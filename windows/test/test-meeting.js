// Prüft Online-Meetings: Erkennen von Meeting-Links in Einladungen und Mails, „Beitreten“, Zusagen mit REPLY,
// neues Online-Meeting mit Einladung (REQUEST) an Teilnehmer, feste Meeting-Links in den Einstellungen + Sync
const { _electron } = require('playwright-core');
const fs = require('fs'); const path = require('path');
const { ImapFlow } = require(path.resolve(__dirname, '../app/node_modules/imapflow'));
const { simpleParser } = require(path.resolve(__dirname, '../app/node_modules/mailparser'));
const ics = require(path.resolve(__dirname, '../app/ics'));
const APP = path.resolve(__dirname, '../app');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function launch(dir) {
  const app = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox'], env: { ...process.env, SIMPLEMAIL_DATA: dir } });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.waitForLoadState('domcontentloaded'); await sleep(1500);
  return { app, page };
}
const acc = { displayName: 'Ortie', email: 'ortie@test.local', username: 'ortie@test.local', imapHost: '127.0.0.1', imapPort: 1143, smtpHost: '127.0.0.1', smtpPort: 2525 };
let fail = 0; const check = (name, ok) => { console.log(ok ? 'OK  ' : 'FAIL', name); if (!ok) fail++; };
const imap = async (fn) => {
  const c = new ImapFlow({ host: '127.0.0.1', port: 1143, secure: false, auth: { user: 'ortie@test.local', pass: 'geheim' }, logger: false });
  await c.connect(); try { return await fn(c); } finally { await c.logout(); }
};
const settle = (page) => page.evaluate(async () => { await refresh(); while (S.loading || S.pending) await new Promise((r) => setTimeout(r, 50)); });
const sentMails = () => imap(async (c) => {
  await c.mailboxOpen('Sent');
  const out = [];
  if (!c.mailbox.exists) return out;
  for await (const m of c.fetch('1:*', { source: true })) out.push(await simpleParser(m.source));
  return out;
});
const TEAMS = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_NjQ5%40thread.v2/0?context=%7b%22Tid%22%3a%22abc%22%7d';
const inviteMail = () => {
  const cal = ['BEGIN:VCALENDAR', 'METHOD:REQUEST', 'PRODID:Microsoft Exchange Server 2010', 'VERSION:2.0', 'BEGIN:VEVENT',
    'ORGANIZER;CN=Bea Boss:mailto:bea@firma.example', 'ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=Ortie:mailto:ortie@test.local',
    'DESCRIPTION;LANGUAGE=de-DE:Hallo zusammen\\n\\n___\\nMicrosoft Teams-Besprechung\\nJetzt an der Besprechung teilnehmen <' + TEAMS + '>',
    'UID:040000008200E00074C5B7101A82E008000000001', 'SUMMARY;LANGUAGE=de-DE:Quartalsplanung',
    'DTSTART;TZID=W. Europe Standard Time:20261120T100000', 'DTEND;TZID=W. Europe Standard Time:20261120T110000',
    'LOCATION;LANGUAGE=de-DE:Microsoft Teams-Besprechung', 'SEQUENCE:0', 'STATUS:CONFIRMED',
    `X-MICROSOFT-SKYPETEAMSMEETINGURL:${TEAMS}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  return ['From: Bea Boss <bea@firma.example>', 'To: ortie@test.local', 'Subject: Quartalsplanung',
    'Date: Fri, 14 Nov 2026 09:00:00 +0100', 'Message-ID: <inv1@firma.example>', 'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="b1"', '', '--b1', 'Content-Type: text/plain; charset=utf-8', '',
    'Einladung zur Quartalsplanung.', '--b1', 'Content-Type: text/calendar; charset=utf-8; method=REQUEST', '', cal, '--b1--', ''].join('\r\n');
};
const zoomMail = () => ['From: Carl <carl@example.com>', 'To: ortie@test.local', 'Subject: Kurzer Call?',
  'Date: Fri, 14 Nov 2026 09:30:00 +0100', 'Message-ID: <zoom1@example.com>', 'Content-Type: text/plain; charset=utf-8', '',
  'Hi, lass uns kurz sprechen: https://us02web.zoom.us/j/81234567890?pwd=abcDEF.', ''].join('\r\n');

(async () => {
  // Einheit: Erkennung + Einladung erzeugen/lesen
  check('Teams-Link erkannt (Safe Link aufgelöst)', (ics.findMeeting(`x https://eur01.safelinks.protection.outlook.com/?url=${encodeURIComponent(TEAMS)}&data=1`) || {}).provider === 'teams');
  check('Zoom/Meet/Webex/Jitsi erkannt', ['https://us02web.zoom.us/j/8?pwd=1', 'https://meet.google.com/abc-defg-hij', 'https://acme.webex.com/acme/j.php?MTID=1', 'https://meet.jit.si/Raum']
    .map((u) => (ics.findMeeting(u) || {}).provider).join() === 'zoom,meet,webex,jitsi');
  check('Normale Links kein Meeting', ics.findMeeting('https://example.com/zoom.us/j/1 https://zoom.us/pricing') === null);

  const D = path.join(__dirname, 'data-meeting'); fs.rmSync(D, { recursive: true, force: true });
  let { app, page } = await launch(D);
  await page.evaluate(async (a) => { await api.call('accounts:save', a, 'geheim'); }, acc);
  await app.close();
  await imap(async (c) => { await c.append('INBOX', inviteMail(), []); await c.append('INBOX', zoomMail(), []); });
  ({ app, page } = await launch(D));
  await page.keyboard.press('Escape');
  await page.waitForSelector('.row[data-key]', { timeout: 20000 });
  check(`Version ${require('../app/package.json').version} (package.json = App)`, (await app.evaluate(({ app: a }) => a.getVersion())) === require('../app/package.json').version);
  await settle(page);
  // Browser-Aufrufe abfangen
  await app.evaluate(({ shell }) => { global.__opened = []; shell.openExternal = async (u) => { global.__opened.push(u); }; });
  const opened = () => app.evaluate(() => global.__opened);
  const toasts = [];
  await page.exposeFunction('noteToast', (t) => toasts.push(t));
  await page.evaluate(() => { const o = toast; window.toast = (m) => { noteToast(m); return o(m); }; });

  // 1) Teams-Einladung
  await page.click('.row[data-key]:has-text("Quartalsplanung")');
  await page.waitForSelector('.invite', { timeout: 10000 });
  const card = await page.textContent('.invite');
  check('Einladungskarte zeigt Microsoft Teams', /Microsoft Teams/.test(card) && /Beitreten/.test(card));
  check('Zeit aus Outlook-Zeitzone richtig (10:00–11:00)', /10:00–11:00/.test(card));
  await page.click('.invite [data-act="meet-join"]');
  await sleep(300);
  check('Beitreten öffnet den Teams-Link', (await opened()).includes(TEAMS));
  await page.click('.invite [data-act="inv-reply"][data-ps="ACCEPTED"]');
  await page.waitForFunction(() => Object.values(S.inviteAnswers).includes('ACCEPTED'), null, { timeout: 15000 });
  let sent = await sentMails();
  const reply = sent.find((x) => /Zugesagt: Quartalsplanung/.test(x.subject || ''));
  const replyCal = reply && (reply.attachments || []).find((a) => /calendar/.test(a.contentType));
  const replyText = replyCal ? replyCal.content.toString() : '';
  check('Zusage an Organisator gesendet (METHOD:REPLY, ACCEPTED)', reply && reply.to.text.includes('bea@firma.example')
    && /METHOD:REPLY/.test(replyText) && /PARTSTAT=ACCEPTED/.test(replyText) && /UID:040000008200E00074C5B7101A82E008000000001/.test(replyText));
  check('Karte zeigt „Du hast zugesagt“', /Du hast zugesagt/.test(await page.textContent('.invite')));

  // 2) Mail mit Zoom-Link ohne Einladung
  await page.click('.row[data-key]:has-text("Kurzer Call")');
  await page.waitForSelector('.meet-banner', { timeout: 10000 });
  check('Banner „Online-Meeting-Link (Zoom)“', /Zoom/.test(await page.textContent('.meet-banner')));
  await page.click('.meet-banner [data-act="meet-join"]');
  await sleep(300);
  check('Beitreten öffnet den Zoom-Link', (await opened()).includes('https://us02web.zoom.us/j/81234567890?pwd=abcDEF'));
  // „Termin anlegen“ übernimmt den Link
  await page.click('.meet-banner [data-act="ev-new"]');
  await page.waitForSelector('.meeting-dialog');
  check('Termin-Dialog übernimmt Zoom + Link', (await page.inputValue('#ev-prov')) === 'zoom' && (await page.inputValue('#ev-link')).includes('zoom.us/j/81234567890'));
  await page.click('.meeting-dialog [data-x="add-sender"]');
  check('„Carl einladen“ setzt Teilnehmer', /carl@example\.com/.test(await page.inputValue('#ev-to')));
  await page.click('.meeting-dialog [data-x="cancel"]');

  // 3) Feste Links in den Einstellungen
  await page.evaluate(() => openSettings());
  await page.click('.tab[data-tab="calendar"]');
  await page.waitForSelector('#mt-teams');
  await page.fill('#mt-teams', TEAMS);
  await page.dispatchEvent('#mt-teams', 'change');
  await page.selectOption('#mt-default', 'teams');
  await sleep(500);
  let st = await page.evaluate(() => api.call('settings:get'));
  check('Teams-Link + Standard gespeichert mit Zeitstempel', st.meetingLinks && st.meetingLinks.teams === TEAMS && st.meetingLinks.default === 'teams' && st.meetingLinksUpdatedAt > 0);
  await page.fill('#mt-zoom', 'zoom.us/j/1');
  await page.dispatchEvent('#mt-zoom', 'change');
  await sleep(300);
  st = await page.evaluate(() => api.call('settings:get'));
  check('Link ohne https wird abgelehnt', !st.meetingLinks.zoom);
  await page.keyboard.press('Escape');
  await sleep(300);

  // 4) Neues Teams-Meeting per Strg+Umschalt+M → Einladung
  await page.keyboard.press('Control+Shift+M');
  await page.waitForSelector('.meeting-dialog');
  check('Standard Teams + fester Link vorausgefüllt', (await page.inputValue('#ev-prov')) === 'teams' && (await page.inputValue('#ev-link')) === TEAMS);
  await page.fill('#ev-title', 'Projektstart SimpleMail');
  await page.fill('#ev-start', '2026-11-25T14:30');
  await page.selectOption('#ev-dur', '45');
  await page.fill('#ev-to', 'Alice Anders <alice@example.com>, bob@example.com');
  await page.dispatchEvent('#ev-to', 'input');
  check('Knopf heißt „Einladung senden“', /Einladung senden/.test(await page.textContent('#ev-ok')));
  await page.uncheck('#ev-save');
  await page.click('#ev-ok');
  await page.waitForFunction(() => !document.querySelector('.meeting-dialog'), null, { timeout: 15000 });
  check('Hinweis „Einladung an 2 Teilnehmer gesendet“', toasts.some((t) => /Einladung an 2 Teilnehmer gesendet/.test(t)));
  sent = await sentMails();
  const inv = sent.find((x) => /Einladung: Projektstart SimpleMail/.test(x.subject || ''));
  const calAtt = inv && (inv.attachments || []).filter((a) => /calendar|ics/.test(a.contentType));
  const reqText = calAtt && calAtt.length ? calAtt[0].content.toString() : '';
  const parsed = ics.parseICS(reqText);
  const ev = parsed.events[0] || {};
  check('Einladung enthält text/calendar method=REQUEST + einladung.ics', inv && calAtt.length >= 1 && parsed.method === 'REQUEST'
    && (inv.attachments || []).some((a) => a.filename === 'einladung.ics'));
  check('ICS: Titel, Zeit 14:30–15:15, Teilnehmer, Organisator', ev.summary === 'Projektstart SimpleMail'
    && new Date(ev.start).getTime() === new Date('2026-11-25T14:30').getTime() && new Date(ev.end).getTime() === new Date('2026-11-25T15:15').getTime()
    && ev.attendees.map((a) => a.email).join() === 'alice@example.com,bob@example.com' && ev.organizer.email === 'ortie@test.local');
  check('ICS: Teams-Link als Meeting erkannt', ev.meeting && ev.meeting.provider === 'teams' && ev.meeting.url === TEAMS);
  check('Mailtext mit Beitreten-Knopf', /jetzt beitreten/.test(inv.html || '') && (inv.text || '').includes(TEAMS));

  // 5) Jitsi: Link wird erzeugt
  await page.keyboard.press('Control+Shift+M');
  await page.waitForSelector('.meeting-dialog');
  await page.selectOption('#ev-prov', 'jitsi');
  await page.fill('#ev-title', 'Spontan');
  await page.fill('#ev-to', 'carl@example.com');
  await page.dispatchEvent('#ev-to', 'input');
  await page.uncheck('#ev-save');
  await page.click('#ev-ok');
  await page.waitForFunction(() => !document.querySelector('.meeting-dialog'), null, { timeout: 15000 });
  sent = await sentMails();
  const jit = sent.find((x) => /Einladung: Spontan/.test(x.subject || ''));
  check('Jitsi-Raum automatisch erzeugt', jit && /https:\/\/meet\.jit\.si\/SimpleMail-\w+/.test(jit.text || ''));

  // 6) Fehlender Link bei Zoom → Fehlermeldung, kein Versand
  await page.keyboard.press('Control+Shift+M');
  await page.waitForSelector('.meeting-dialog');
  await page.selectOption('#ev-prov', 'zoom');
  await page.fill('#ev-to', 'carl@example.com');
  await page.dispatchEvent('#ev-to', 'input');
  await page.click('#ev-ok');
  await page.waitForSelector('#ev-err:not(.hidden)');
  check('Ohne Zoom-Link: Hinweis statt Versand', /Meeting-Link/.test(await page.textContent('#ev-err')));
  await page.click('.meeting-dialog [data-x="cancel"]');

  // 7) Terminspalte: Beitreten-Knopf (Kalender-Ereignisse simuliert)
  await page.evaluate(() => {
    S.settings.layout.calOpen = true;
    S.settings.calendar.icsUrl = 'https://example.invalid/x.ics';
    const s = new Date(Date.now() + 5 * 60e3); const e = new Date(Date.now() + 65 * 60e3);
    S.events = [{ summary: 'Daily', start: s.toISOString(), end: e.toISOString(), allDay: false, location: 'https://meet.google.com/abc-defg-hij',
      meeting: { provider: 'meet', name: 'Google Meet', url: 'https://meet.google.com/abc-defg-hij' } }];
    renderCalendar();
  });
  const calText = await page.textContent('#calPane');
  check('Terminspalte: „Beitreten“ kurz vor Beginn, Ort als „Google Meet“', /Beitreten/.test(calText) && /Google Meet/.test(calText) && !/meet\.google\.com/.test(calText));
  check('Terminspalte: ＋ für neues Meeting', !!(await page.$('#calPane [data-act="meet-new"]')));
  await page.click('#calPane [data-act="meet-join"]');
  await sleep(300);
  check('Beitreten aus der Terminspalte', (await opened()).includes('https://meet.google.com/abc-defg-hij'));

  // 8) Sync-Dokument enthält prefs.meetingLinks
  await page.evaluate(async () => {
    S.settings.calendar.icsUrl = '';
    S.settings.sync = { enabled: true, accountEmail: 'ortie@test.local' };
    await saveSettings({ sync: false });
    await runSync();
  });
  await sleep(1000);
  const doc = await imap(async (c) => {
    const box = (await c.list()).find((f) => f.name === 'SimpleMail-Sync');
    if (!box) return null;
    await c.mailboxOpen(box.path);
    let last = null;
    for await (const m of c.fetch('1:*', { source: true })) last = m.source;
    const p = await simpleParser(last);
    return JSON.parse(p.attachments.find((a) => /sync\.json$/.test(a.filename)).content.toString());
  });
  console.log('prefs.meetingLinks', JSON.stringify(doc && doc.prefs.meetingLinks));
  check('Sync-Dokument enthält prefs.meetingLinks', doc && doc.prefs.meetingLinks && doc.prefs.meetingLinks.value.teams === TEAMS
    && doc.prefs.meetingLinks.value.default === 'teams' && doc.prefs.meetingLinks.updatedAt > 0);
  await app.close();
  console.log(fail ? `\n${fail} FEHLER` : '\nALLES OK');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
