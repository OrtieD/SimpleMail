// 3.2.27: Mails per Ziehen in Ordner verschieben – auch auf „Spam“ unter Kategorien (vorher kein Ablegeziel)
// 3.2.29: Ordner → Ordner, auf Kategorien ziehen (Absender merkt sich die Kategorie), Seitenleiste scrollt beim Ziehen mit
const { _electron } = require('playwright-core');
const fs = require('fs'); const path = require('path');
const { ImapFlow } = require(path.resolve(__dirname, '../app/node_modules/imapflow'));
const APP = path.resolve(__dirname, '../app');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0; const check = (name, ok) => { console.log(ok ? 'OK  ' : 'FAIL', name); if (!ok) fail++; };
const imap = async (fn) => {
  const c = new ImapFlow({ host: '127.0.0.1', port: 1143, secure: false, auth: { user: 'ortie@test.local', pass: 'geheim' }, logger: false });
  await c.connect(); try { return await fn(c); } finally { await c.logout(); }
};
const subjects = (box) => imap(async (c) => { const out = []; const lock = await c.getMailboxLock(box); try { for await (const m of c.fetch('1:*', { envelope: true })) out.push(m.envelope.subject); } catch {} finally { lock.release(); } return out; });
async function launch(dir) {
  const app = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox'], env: { ...process.env, SIMPLEMAIL_DATA: dir } });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}
async function waitServer(box, subj, ms = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if ((await subjects(box)).includes(subj)) return true; await sleep(300); }
  return false;
}
(async () => {
  await imap(async (c) => {
    for (const [i, s] of ['Ziehen in Spam', 'Ziehen in Papierkorb', 'Ziehen Mehrfach A', 'Ziehen Mehrfach B', 'Ziehen Kategorie'].entries()) {
      await c.append('INBOX', `From: Z${i} <z${i}@example.com>\r\nTo: ortie@test.local\r\nSubject: ${s}\r\nDate: ${new Date(Date.now() - i * 60000).toUTCString()}\r\nMessage-ID: <z${i}.${Date.now()}@x>\r\n\r\nHallo\r\n`, []);
    }
  });
  await imap(async (c) => { for (const f of ['Projekt', 'Projekt/Alt']) await c.mailboxCreate(f).catch(() => {}); });
  const D = path.join(__dirname, 'data-ziehen'); fs.rmSync(D, { recursive: true, force: true });
  let { app, page } = await launch(D);
  await page.evaluate(async () => { await api.call('accounts:save', { displayName: 'ortie', email: 'ortie@test.local', username: 'ortie@test.local', imapHost: '127.0.0.1', imapPort: 1143, smtpHost: '127.0.0.1', smtpPort: 2525 }, 'geheim'); });
  await app.close();
  ({ app, page } = await launch(D));
  await page.keyboard.press('Escape');
  check(`Version ${require('../app/package.json').version}`, (await app.evaluate(({ app: a }) => a.getVersion())) === require('../app/package.json').version);
  await page.waitForSelector('#sidebar .side-item[data-drop-path="Spam"]', { timeout: 20000 });
  const row = (subj) => page.locator('#list .row[data-key]', { hasText: subj }).first();
  await row('Ziehen in Spam').waitFor({ timeout: 15000 });

  // 1. Auf „Spam“ unter Kategorien ziehen
  check('„Spam“ unter Kategorien ist Ablegeziel', !!(await page.$('#sidebar .side-item[data-drop-spam]')));
  await row('Ziehen in Spam').dragTo(page.locator('#sidebar .side-item[data-drop-spam]'));
  check('Kategorie „Spam“: Mail liegt auf dem Server im Spam-Ordner', await waitServer('Spam', 'Ziehen in Spam'));
  check('… und ist aus der Liste verschwunden', (await page.locator('#list .row[data-key]', { hasText: 'Ziehen in Spam' }).count()) === 0);

  // 2. Auf den Kontoordner „Trash“ ziehen
  await row('Ziehen in Papierkorb').dragTo(page.locator('#sidebar .side-item[data-drop-path="Trash"]'));
  check('Kontoordner: Mail liegt im Papierkorb', await waitServer('Trash', 'Ziehen in Papierkorb'));

  // 3. Mehrere markiert → alle auf den Kontoordner „Spam“
  await row('Ziehen Mehrfach A').click();
  await row('Ziehen Mehrfach B').click({ modifiers: ['Control'] });
  await sleep(200);
  await row('Ziehen Mehrfach B').dragTo(page.locator('#sidebar .side-item[data-drop-path="Spam"]'));
  check('Mehrfachauswahl: beide im Spam-Ordner', (await waitServer('Spam', 'Ziehen Mehrfach A')) && (await waitServer('Spam', 'Ziehen Mehrfach B')));

  // 4. Auf Kategorie „Newsletter“ ziehen → Absender landet künftig dort
  check('Kategorien sind Ablegeziele', (await page.$$('#sidebar .side-item[data-drop-cat]')).length === 3);
  await row('Ziehen Kategorie').dragTo(page.locator('#sidebar .side-item[data-drop-cat="newsletter"]'));
  await sleep(400);
  const cat = await page.evaluate(() => ({ s: (S.settings.senderCats || {})['z4@example.com'], m: allInbox().find((m) => m.subject === 'Ziehen Kategorie') }));
  check('Kategorie: Absender gemerkt (newsletter)', !!cat.s && cat.s.category === 'newsletter' && !cat.s.deleted);
  check('… Mail ist jetzt Newsletter', !!cat.m && cat.m.category === 'newsletter');
  await sleep(300);
  const disk = JSON.parse(fs.readFileSync(path.join(D, 'settings.json'), 'utf8'));
  check('… gespeichert (Sync-fähig)', !!disk.senderCats && disk.senderCats['z4@example.com'].category === 'newsletter');
  await imap((c) => c.append('INBOX', `From: Z4 <z4@example.com>\r\nTo: ortie@test.local\r\nSubject: Ziehen Kategorie 2\r\nDate: ${new Date().toUTCString()}\r\nMessage-ID: <z4b.${Date.now()}@x>\r\n\r\nHallo\r\n`, []));
  await page.evaluate(() => refresh());
  let neu = null; const tn = Date.now();
  while (Date.now() - tn < 10000 && !neu) { neu = await page.evaluate(() => allInbox().find((m) => m.subject === 'Ziehen Kategorie 2')); await sleep(300); }
  check('… neue Mail desselben Absenders kommt als Newsletter an', !!neu && neu.category === 'newsletter');

  // 5. Ordner → Ordner: Papierkorb → Unterordner → Ordner → Kategorie
  await page.click('#sidebar .side-item[data-drop-path="Trash"]');
  await row('Ziehen in Papierkorb').waitFor({ timeout: 10000 });
  await row('Ziehen in Papierkorb').dragTo(page.locator('#sidebar .side-item[data-drop-path="Projekt/Alt"]'));
  check('Ordner → Unterordner: Papierkorb → Projekt/Alt', await waitServer('Projekt/Alt', 'Ziehen in Papierkorb'));
  await page.click('#sidebar .side-item[data-drop-path="Projekt/Alt"]');
  await row('Ziehen in Papierkorb').waitFor({ timeout: 10000 });
  await row('Ziehen in Papierkorb').dragTo(page.locator('#sidebar .side-item[data-drop-path="Projekt"]'));
  check('Unterordner → Ordner: Projekt/Alt → Projekt', await waitServer('Projekt', 'Ziehen in Papierkorb'));
  await page.click('#sidebar .side-item[data-drop-path="Projekt"]');
  await row('Ziehen in Papierkorb').waitFor({ timeout: 10000 });
  await row('Ziehen in Papierkorb').dragTo(page.locator('#sidebar .side-item[data-drop-cat="personal"]'));
  check('Ordner → Kategorie „Persönlich“: Mail wieder im Posteingang', await waitServer('INBOX', 'Ziehen in Papierkorb'));
  check('… Absender als persönlich gemerkt', await page.evaluate(() => (S.settings.senderCats['z1@example.com'] || {}).category === 'personal'));

  // 6. Seitenleiste scrollt beim Ziehen am unteren Rand mit
  await page.evaluate(() => { S.view = { type: 'smart' }; renderAll(); });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 360));
  await sleep(600);
  const sideBox = await page.locator('#sidebar').boundingBox();
  check('Seitenleiste ist bei kleinem Fenster scrollbar', await page.evaluate(() => $('#sidebar').scrollHeight > $('#sidebar').clientHeight + 20));
  await page.evaluate(() => { $('#sidebar').scrollTop = 0; });
  const rb = await page.locator('#list .row[data-key]').first().boundingBox();
  await page.mouse.move(rb.x + 40, rb.y + rb.height / 2);
  await page.mouse.down();
  await page.mouse.move(rb.x + 60, rb.y + rb.height / 2 + 5, { steps: 3 });
  for (let i = 0; i < 25; i++) { await page.mouse.move(sideBox.x + sideBox.width / 2, sideBox.y + sideBox.height - 8 - (i % 2)); await sleep(60); }
  const st = await page.evaluate(() => $('#sidebar').scrollTop);
  await page.mouse.move(rb.x + 40, rb.y + rb.height / 2, { steps: 3 });
  await page.mouse.up();
  check(`Ziehen am unteren Rand scrollt die Seitenleiste (scrollTop ${st})`, st > 30);
  await page.screenshot({ path: path.join(__dirname, 'shot-ziehen.png') });
  await app.close();
  console.log(fail ? `${fail} FEHLER` : 'ALLES OK');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
