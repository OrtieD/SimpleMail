// Prüft: Klick auf E-Mail-Adresse (mailto-Link in HTML-Mail, Adresse in Text-Mail, Absender/An im Kopf,
// Link im eigenen Mail-Fenster) öffnet den eigenen Editor mit An/Cc/Betreff/Text – kein fremdes Mailprogramm
const { _electron } = require('playwright-core');
const fs = require('fs'); const path = require('path');
const { ImapFlow } = require(path.resolve(__dirname, '../app/node_modules/imapflow'));
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
const htmlMail = ['From: Carla Chef <carla@firma.example>', 'To: ortie@test.local, team@firma.example', 'Cc: dora@firma.example', 'Subject: Kontaktliste',
  'Date: Wed, 12 Nov 2026 09:00:00 +0100', 'Message-ID: <html1@x>', 'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8', '',
  '<p>Bitte schreib an <a id="m1" href="mailto:max@firma.example">Max</a> oder',
  '<a id="m2" href="mailto:info@firma.example?subject=Anfrage%20M%C3%A4rz&cc=chef@firma.example&body=Hallo%20Team%2C%0D%0Azeile2">Info</a>.</p>',
  '<p><a id="web" href="https://example.com/">Webseite</a></p>'].join('\r\n');
const textMail = ['From: Erik Ernst <erik@firma.example>', 'To: ortie@test.local', 'Subject: Nur Text', 'Date: Thu, 13 Nov 2026 09:00:00 +0100',
  'Message-ID: <text1@x>', 'Content-Type: text/plain; charset=utf-8', '', 'Hallo,', 'meine neue Adresse: erik.neu@firma.example', 'Gruß'].join('\r\n');
const composeVals = (page) => page.evaluate(() => ({
  open: !!document.querySelector('.dialog.compose'),
  to: document.querySelector('#c-to') && document.querySelector('#c-to').value,
  cc: document.querySelector('#c-cc') && document.querySelector('#c-cc').value,
  subject: document.querySelector('#c-subject') && document.querySelector('#c-subject').value,
  body: document.querySelector('#c-body') && document.querySelector('#c-body').innerText,
}));
const closeCompose = async (page) => { await page.click('.dialog.compose [data-x="cancel"]'); await sleep(400);
  if (await page.$('.dialog.compose')) { const b = await page.$('#modal-root .primary, #modal-root .danger'); if (b) await b.click(); await sleep(300); } };
(async () => {
  await imap(async (c) => { await c.append('INBOX', htmlMail, []); await c.append('INBOX', textMail, []); });
  const D = '/tmp/smM'; fs.rmSync(D, { recursive: true, force: true });
  let { app, page } = await launch(D);
  await page.evaluate(async (a) => { await api.call('accounts:save', a, 'geheim'); }, acc);
  await app.close();
  ({ app, page } = await launch(D));
  await page.keyboard.press('Escape');
  await page.waitForSelector('.row[data-key]', { timeout: 20000 });
  await sleep(1500);
  check(`Version ${require('../app/package.json').version} (package.json = App)`, (await app.evaluate(({ app: a }) => a.getVersion())) === require('../app/package.json').version);
  // fremdes Mailprogramm/Browser abfangen
  await app.evaluate(({ shell }) => { global.__ext = []; shell.openExternal = async (u) => { global.__ext.push(u); }; });
  const ext = () => app.evaluate(() => global.__ext);

  // 1) HTML-Mail: einfacher mailto-Link
  await page.locator('#list .row[data-key]', { hasText: 'Kontaktliste' }).click();
  const fr = page.frameLocator('.body-frame');
  await fr.locator('#m1').waitFor({ timeout: 15000 });
  await fr.locator('#m1').click(); await sleep(800);
  let v = await composeVals(page);
  check('mailto-Link öffnet Editor', v.open);
  check('An = max@firma.example', /max@firma\.example/.test(v.to || ''));
  check('Kein externes Programm', (await ext()).length === 0);
  await page.screenshot({ path: path.join(__dirname, 'shot-mailto.png') });
  await closeCompose(page);
  check('Editor geschlossen', !(await composeVals(page)).open);

  // 2) mailto mit Betreff, Cc, Text
  await fr.locator('#m2').click(); await sleep(800);
  v = await composeVals(page);
  check('Betreff aus Link (Umlaut)', v.subject === 'Anfrage März');
  check('Cc aus Link', /chef@firma\.example/.test(v.cc || ''));
  check('Text aus Link', /Hallo Team,\s*\n?\s*zeile2/.test(v.body || ''));
  check('An = info@', /info@firma\.example/.test(v.to || ''));
  await closeCompose(page);

  // 3) http-Link geht weiterhin in den Browser
  await fr.locator('#web').click(); await sleep(800);
  check('Weblink → Browser', (await ext()).includes('https://example.com/'));
  check('Weblink öffnet keinen Editor', !(await composeVals(page)).open);

  // 4) Adressen im Kopf
  await page.click('.detail-head .addr a.mail-addr'); await sleep(500);
  v = await composeVals(page);
  check('Absender im Kopf anklickbar', v.open && /carla@firma\.example/.test(v.to || ''));
  await closeCompose(page);
  await page.locator('.detail-head .line a.mail-addr', { hasText: 'team@firma.example' }).click(); await sleep(500);
  v = await composeVals(page);
  check('An-Adresse im Kopf anklickbar', v.open && /team@firma\.example/.test(v.to || ''));
  await closeCompose(page);

  // 5) Text-Mail: Adresse wird Link
  await page.locator('#list .row[data-key]', { hasText: 'Nur Text' }).click();
  await page.waitForSelector('.body-text a[data-act="mailto"]', { timeout: 15000 });
  await page.click('.body-text a[data-act="mailto"]'); await sleep(500);
  v = await composeVals(page);
  check('Adresse in Text-Mail öffnet Editor', v.open && /erik\.neu@firma\.example/.test(v.to || ''));
  await closeCompose(page);

  // 6) Eigenes Mail-Fenster
  await page.locator('#list .row[data-key]', { hasText: 'Kontaktliste' }).click(); await sleep(800);
  const winP = app.waitForEvent('window', { timeout: 10000 });
  await page.click('[data-act="open-window"]');
  const w2 = await winP;
  w2.on('pageerror', (e) => console.log('PAGEERROR (Fenster)', e.message));
  const fr2 = w2.frameLocator('.body-frame');
  await fr2.locator('#m2').waitFor({ timeout: 15000 });
  await fr2.locator('#m2').click(); await sleep(1000);
  v = await composeVals(page);
  check('Link im Mail-Fenster → Editor im Hauptfenster', v.open && v.subject === 'Anfrage März');
  await closeCompose(page);
  await w2.locator('.addr a[data-url^="mailto:"]').click(); await sleep(800);
  v = await composeVals(page);
  check('Absender im Mail-Fenster anklickbar', v.open && /carla@firma\.example/.test(v.to || ''));
  check('Weiterhin kein externes Mailprogramm', !(await ext()).some((u) => /^mailto:/i.test(u)));

  await app.close();
  console.log(fail ? `\n${fail} FEHLER` : '\nALLES OK');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
