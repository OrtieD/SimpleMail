// 3.2.41: Konto wählen zeigt den ganzen Posteingang – auch wenn vorher eine gefilterte Ansicht
// (Kategorie „Benachrichtigungen“, Ungelesen, Markiert) gewählt war. Persönlich-Mails fehlten sonst scheinbar.
const { _electron } = require('playwright-core');
const fs = require('fs'); const path = require('path');
const { ImapFlow } = require(path.resolve(__dirname, '../app/node_modules/imapflow'));
const APP = path.resolve(__dirname, '../app');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0; const check = (name, ok) => { console.log(ok ? 'OK  ' : 'FAIL', name); if (!ok) fail++; };
async function launch(dir) {
  const app = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox'], env: { ...process.env, SIMPLEMAIL_DATA: dir } });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}
(async () => {
  const c = new ImapFlow({ host: '127.0.0.1', port: 1143, secure: false, auth: { user: 'ortie@test.local', pass: 'geheim' }, logger: false });
  await c.connect();
  const t = Date.now();
  await c.append('INBOX', `From: Hans Vorstand <hans@verein.example>\r\nTo: ortie@test.local\r\nSubject: Persoenlich Sitzung\r\nDate: ${new Date(t).toUTCString()}\r\nMessage-ID: <p.${t}@x>\r\n\r\nHallo\r\n`, []);
  await c.append('INBOX', `From: Shop <bestellung@shop.example>\r\nTo: ortie@test.local\r\nSubject: Bestellung Info\r\nAuto-Submitted: auto-generated\r\nDate: ${new Date(t - 3600e3).toUTCString()}\r\nMessage-ID: <b.${t}@x>\r\n\r\nBestellt\r\n`, []);
  await c.logout();
  const D = path.join(__dirname, 'data-kontoansicht'); fs.rmSync(D, { recursive: true, force: true });
  let { app, page } = await launch(D);
  await page.evaluate(async () => { await api.call('accounts:save', { displayName: 'vorstand', email: 'ortie@test.local', username: 'ortie@test.local', imapHost: '127.0.0.1', imapPort: 1143, smtpHost: '127.0.0.1', smtpPort: 2525 }, 'geheim'); });
  await app.close();
  ({ app, page } = await launch(D));
  await page.keyboard.press('Escape');
  check(`Version ${require('../app/package.json').version}`, (await app.evaluate(({ app: a }) => a.getVersion())) === require('../app/package.json').version);
  await page.waitForFunction(() => !S.loading && Object.values(S.inbox).flat().some((m) => m.subject === 'Persoenlich Sitzung'), null, { timeout: 20000 });
  const accId = await page.evaluate(() => S.accounts[0].id);
  const rows = () => page.$$eval('#list .row', (els) => els.map((e) => e.textContent));
  for (const [label, view] of [['Benachrichtigungen', { type: 'category', cat: 'notification' }], ['Ungelesen', { type: 'unread' }], ['Markiert', { type: 'flagged' }]]) {
    await page.evaluate((v) => { S.settings.accountFilter = null; S.view = v; renderAll(); }, view);
    await sleep(150);
    await page.click(`.account-item[data-acc="${accId}"]`);
    await sleep(250);
    const st = await page.evaluate(() => ({ type: S.view.type, f: S.settings.accountFilter }));
    const r = await rows();
    check(`aus „${label}“: Konto gewählt → Smart Inbox des Kontos`, st.type === 'smart' && st.f === accId);
    check(`aus „${label}“: Persönlich-Mail sichtbar`, r.some((x) => x.includes('Persoenlich Sitzung')));
  }
  // Gemeinsame Ordner (Gesendet/Papierkorb/Spam) bleiben beim Kontowechsel stehen
  await page.evaluate(() => { S.settings.accountFilter = null; S.view = { type: 'sent' }; renderAll(); });
  await page.click(`.account-item[data-acc="${accId}"]`);
  await sleep(200);
  check('Gesendet bleibt beim Kontowechsel', (await page.evaluate(() => S.view.type)) === 'sent');
  // Persönlich-Kategorie selbst: Mails liegen weiter im Posteingang des Kontos
  await page.evaluate(() => { S.view = { type: 'smart' }; renderAll(); });
  await sleep(200);
  check('Smart Inbox mit Kontofilter zeigt Persönlich-Mail', (await rows()).some((x) => x.includes('Persoenlich Sitzung')));
  await page.screenshot({ path: path.join(__dirname, 'shot-kontoansicht.png') });
  await app.close();
  console.log(fail ? `${fail} FEHLER` : 'ALLES OK');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
