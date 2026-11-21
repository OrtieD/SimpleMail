// Sicherheitsprüfung 2 (3.2.21): gefälschter eigener/vertrauter Absender (DMARC fail) wird aussortiert bzw. lädt keine Bilder, Druck lädt keine file://-Bilder (UNC/NTLM), Sync nimmt ohne Passwort keine
// per SMTP zugestellte (Received:) oder fremde Sync-Mail an, normaler Sync läuft weiter
const { _electron } = require('playwright-core');
const fs = require('fs'); const path = require('path');
const { ImapFlow } = require(path.resolve(__dirname, '../app/node_modules/imapflow'));
const APP = path.resolve(__dirname, '../app');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0; const check = (name, ok) => { console.log(ok ? 'OK  ' : 'FAIL', name); if (!ok) fail++; };
const acc = { displayName: 'Ortie', email: 'ortie@test.local', username: 'ortie@test.local', imapHost: '127.0.0.1', imapPort: 1143, smtpHost: '127.0.0.1', smtpPort: 2525 };
const imap = async (fn) => { const c = new ImapFlow({ host: '127.0.0.1', port: 1143, secure: false, auth: { user: 'ortie@test.local', pass: 'geheim' }, logger: false }); await c.connect(); try { return await fn(c); } finally { await c.logout(); } };
const canary = path.join(__dirname, 'canary.png');
fs.writeFileSync(canary, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
const syncMail = (from, extra, doc) => [...extra, `From: ${from}`, 'To: ortie@test.local', 'Subject: SimpleMail Sync – bitte nicht löschen', 'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="S"', '', '--S', 'Content-Type: text/plain', '', 'x', '', '--S',
  'Content-Type: application/json; name="simplemail-sync.json"', 'Content-Disposition: attachment; filename="simplemail-sync.json"', '',
  JSON.stringify(doc), '', '--S--', ''].join('\r\n');
(async () => {
  await imap((c) => c.append('INBOX', ['From: Eve <eve@evil.example>', 'To: ortie@test.local', 'Subject: Druckprobe', 'Date: Thu, 13 Nov 2026 09:00:00 +0100',
    'Message-ID: <druck1@x>', 'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8', '',
    `<p>Hallo</p><img id="i1" src="file://${canary}"><img id="i2" src="http://127.0.0.1:9/x.png">`].join('\r\n'), []));
  const spoof = (id, from, subj) => [`From: ${from}`, 'To: ortie@test.local', `Subject: ${subj}`, 'Date: Fri, 14 Nov 2026 09:00:00 +0100',
    `Message-ID: <${id}@x>`, 'Authentication-Results: mx.test.local; spf=fail smtp.mailfrom=boese.example; dmarc=fail (p=reject) header.from=test.local',
    'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8', '', '<p>Ich habe dein Konto gehackt</p><img src="http://127.0.0.1:9/t.png">'].join('\r\n');
  const D = '/tmp/smS2'; fs.rmSync(D, { recursive: true, force: true });
  const app = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox'], env: { ...process.env, SIMPLEMAIL_DATA: D } });
  const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded'); await sleep(1500);
  await page.evaluate((a) => api.call('accounts:save', a, 'geheim'), acc);
  await page.reload(); await sleep(4000);
  await (await page.$('.row:has-text("Druckprobe")')).click(); await sleep(2000);
  const b = await page.$('[data-act="images-once"]'); check('Bilder-Banner da', !!b); if (b) { await b.click(); await sleep(1000); }
  await page.click('[data-act="print"]'); await sleep(4000);
  const doc = app.windows().find((w) => /simplemail-druck/.test(w.url()));
  const imgs = doc ? await doc.evaluate(() => Object.fromEntries([...document.images].map((i) => [i.id, i.naturalWidth]))) : null;
  check('Druck: file://-Bild nicht geladen (kein UNC/SMB)', imgs && imgs.i1 === 0);
  for (const w of app.windows()) if (/preview\.html/.test(w.url())) await w.close();

  // Gefälschte Absender (DMARC fail): eigene Adresse wird trotzdem aussortiert, vertrauter Absender lädt keine Bilder
  await page.evaluate(async () => { S.settings.trusted['chef@firma.example'] = { deleted: false, updatedAt: Date.now() };
    S.settings.spamFilter = { enabled: true, level: 'low' }; await api.call('settings:set', S.settings); });
  await imap(async (c) => {
    await c.append('INBOX', spoof('sp1', 'Ortie <ortie@test.local>', 'BEZAHLEN SIE JETZT BITCOIN!!!'), []);
    await c.append('INBOX', spoof('sp2', 'Chef <chef@firma.example>', 'Rechnung'), []);
  });
  await page.keyboard.press('F5'); await sleep(5000);
  const inInbox = await imap(async (c) => { const l = await c.mailboxOpen('INBOX'); const subs = []; for await (const m of c.fetch('1:*', { envelope: true })) subs.push(m.envelope.subject); return subs; });
  check('Gefälschte Mail „von mir selbst“ aussortiert', !inInbox.includes('BEZAHLEN SIE JETZT BITCOIN!!!'));
  const row = await page.$('.row:has-text("Rechnung")');
  if (row) { await row.click(); await sleep(2000); }
  check('Gefälschter vertrauter Absender: Bilder bleiben gesperrt', !!row && !!(await page.$('[data-act="images-once"]')));

  // Sync ohne Passwort
  await page.evaluate(async () => { S.settings.sync = { enabled: true, accountEmail: 'ortie@test.local' }; await api.call('settings:set', S.settings); });
  const r1 = await page.evaluate(() => api.call('sync:now'));
  check('Sync läuft', r1 && r1.ok !== false);
  const box = await imap(async (c) => (await c.list()).find((f) => f.name === 'SimpleMail-Sync').path);
  const fake = (who) => ({ format: 1, accounts: {}, snippets: {}, rules: {}, contacts: {}, snoozes: {}, blocked: {},
    trusted: { [who]: { deleted: false, updatedAt: Date.now() + 1e6 } }, prefs: { blockImages: { value: false, updatedAt: Date.now() + 1e6 } } });
  await imap((c) => c.append(box, syncMail('ortie@test.local', ['Received: from mx.boese.example by mx.test.local; Thu, 13 Nov 2026 09:00:00 +0100'], fake('smtp@boese.example')), ['\\Seen']));
  await page.evaluate(() => api.call('sync:now'));
  let st = await page.evaluate(() => api.call('settings:get'));
  check('Zugestellte Sync-Mail (Received:) ignoriert', !(st.trusted || {})['smtp@boese.example'] && st.blockImages !== false);
  await imap((c) => c.append(box, syncMail('mallory@boese.example', [], fake('fremd@boese.example')), ['\\Seen']));
  await page.evaluate(() => api.call('sync:now'));
  st = await page.evaluate(() => api.call('settings:get'));
  check('Sync-Mail mit fremdem Absender ignoriert', !(st.trusted || {})['fremd@boese.example'] && st.blockImages !== false);
  await imap((c) => c.append(box, syncMail('ortie@test.local', [], fake('echt@firma.example')), ['\\Seen']));
  await page.evaluate(() => api.call('sync:now'));
  st = await page.evaluate(() => api.call('settings:get'));
  check('Eigene, abgelegte Sync-Mail wird übernommen', !!(st.trusted || {})['echt@firma.example']);
  await app.close();
  console.log(fail ? `${fail} FEHLER` : 'ALLE TESTS OK'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
