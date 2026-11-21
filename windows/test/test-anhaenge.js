// Prüft: Anhänge öffnen mit eingestelltem Programm (Word/LibreOffice/Wordcraft), „Öffnen mit …“, PDF mit Standard-App
const { _electron } = require('playwright-core');
const fs = require('fs'); const path = require('path');
const { ImapFlow } = require(path.resolve(__dirname, '../app/node_modules/imapflow'));
const APP = path.resolve(__dirname, '../app');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Attrappen für Word und LibreOffice: schreiben die übergebene Datei in ein Protokoll
const FAKE = path.join(__dirname, 'fake-apps'); fs.rmSync(FAKE, { recursive: true, force: true }); fs.mkdirSync(FAKE);
const LOG = path.join(FAKE, 'log.txt');
for (const id of ['word', 'libreoffice', 'wordcraft-selbst']) {
  const p = path.join(FAKE, id); fs.writeFileSync(p, `#!/bin/sh\necho "${id} $1" >> "${LOG}"\n`); fs.chmodSync(p, 0o755);
}
const APP_PATHS = JSON.stringify({ word: path.join(FAKE, 'word'), libreoffice: path.join(FAKE, 'libreoffice'), wordcraft: path.join(FAKE, 'fehlt') });
async function launch(dir) {
  const app = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox'],
    env: { ...process.env, SIMPLEMAIL_DATA: dir, SIMPLEMAIL_APP_PATHS: APP_PATHS } });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.waitForLoadState('domcontentloaded'); await sleep(1500);
  return { app, page };
}
const log = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : '');
const waitLog = async (re) => { for (let i = 0; i < 40 && !re.test(log()); i++) await sleep(100); return re.test(log()); };
const acc = { displayName: 'ortie', email: 'ortie@test.local', username: 'ortie@test.local', imapHost: '127.0.0.1', imapPort: 1143, smtpHost: '127.0.0.1', smtpPort: 2525 };
let fail = 0; const check = (name, ok) => { console.log(ok ? 'OK  ' : 'FAIL', name); if (!ok) fail++; };
(async () => {
  const b64 = (s) => Buffer.from(s).toString('base64');
  const raw = ['From: Carla <carla@example.com>', 'To: ortie@test.local', 'Subject: Vertrag mit Anhang',
    'Date: Thu, 13 Nov 2026 12:00:00 +0100', `Message-ID: <anh.${Date.now()}@x>`, 'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="B"', '', '--B', 'Content-Type: text/plain; charset=utf-8', '', 'Anbei der Vertrag.', '',
    '--B', 'Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document; name="Vertrag.docx"',
    'Content-Disposition: attachment; filename="Vertrag.docx"', 'Content-Transfer-Encoding: base64', '', b64('PK fake docx'), '',
    '--B', 'Content-Type: application/pdf; name="Rechnung.pdf"', 'Content-Disposition: attachment; filename="Rechnung.pdf"',
    'Content-Transfer-Encoding: base64', '', b64('%PDF-1.4 fake'), '', '--B--', ''].join('\r\n');
  const c = new ImapFlow({ host: '127.0.0.1', port: 1143, secure: false, auth: { user: 'ortie@test.local', pass: 'geheim' }, logger: false });
  await c.connect(); await c.append('INBOX', raw, []); await c.logout();

  const D = path.join(__dirname, 'data-anhaenge'); fs.rmSync(D, { recursive: true, force: true });
  let { app, page } = await launch(D);
  await page.evaluate(async (a) => { await api.call('accounts:save', a, 'geheim'); }, acc);
  await app.close();
  ({ app, page } = await launch(D));
  // shell.openPath (Standard-App) mitschreiben statt wirklich öffnen
  await app.evaluate(({ shell }) => { global.opened = []; shell.openPath = async (p) => { global.opened.push(p); return ''; }; });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.row[data-key]', { timeout: 20000 });
  await page.evaluate(async () => { while (S.loading || S.pending) await new Promise((r) => setTimeout(r, 50)); });
  await page.locator('.row[data-key]', { hasText: 'Vertrag mit Anhang' }).first().click();
  await page.waitForSelector('[data-act="att-open"]', { timeout: 15000 });
  const chips = await page.$$eval('[data-act="att-open"]', (els) => els.map((e) => e.textContent.trim()));
  check('Zwei Anhänge angezeigt', chips.length === 2);
  const docx = page.locator('[data-act="att-open"]', { hasText: 'Vertrag.docx' });
  const pdf = page.locator('[data-act="att-open"]', { hasText: 'Rechnung.pdf' });

  // 1) ohne Einstellung: Standard-App
  await docx.click(); await sleep(800);
  let opened = await app.evaluate(() => global.opened);
  check('DOCX ohne Einstellung → Standard-App', opened.some((p) => p.endsWith('Vertrag.docx')) && !log());
  await pdf.click(); await sleep(800);
  opened = await app.evaluate(() => global.opened);
  check('PDF → Standard-PDF-Reader (shell.openPath)', opened.some((p) => p.endsWith('Rechnung.pdf')));

  // 2) Einstellungen: LibreOffice wählen, Wordcraft als „nicht installiert“
  await page.evaluate(() => openSettings({ tab: 'privacy' }));
  await page.waitForSelector('#p-open-doc');
  await sleep(800);
  const labels = await page.$$eval('#p-open-doc option', (o) => o.map((x) => x.textContent));
  console.log(JSON.stringify(labels));
  check('Wordcraft als nicht gefunden markiert', labels.includes('Wordcraft (nicht gefunden)') && labels.includes('Microsoft Word'));
  check('Knöpfe „Programm suchen“ sichtbar', (await page.$$('[data-x="app-find"]')).length === 3);
  await page.selectOption('#p-open-doc', 'libreoffice');
  await sleep(500);
  const st = await page.evaluate(() => api.call('settings:get'));
  check('Einstellung gespeichert (openWith.doc = libreoffice, mit Zeitstempel)', st.openWith && st.openWith.doc === 'libreoffice' && st.openWithUpdatedAt > 0);
  await page.keyboard.press('Escape'); await sleep(300);
  await page.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => o.remove()));
  await docx.click();
  check('Klick auf DOCX öffnet mit LibreOffice', await waitLog(/libreoffice .*Vertrag\.docx/));

  // 3) Rechtsklick → Öffnen mit
  await docx.click({ button: 'right' }); await sleep(500);
  const items = await page.$$eval('#menu .mi', (m) => m.map((x) => x.textContent));
  console.log(JSON.stringify(items));
  check('Menü bietet Word, LibreOffice, Standard-App, andere App', items.includes('Öffnen mit Microsoft Word') && items.includes('Öffnen mit LibreOffice')
    && items.includes('Öffnen mit Standard-App') && items.includes('Öffnen mit anderer App …'));
  check('Nicht gefundenes Wordcraft mit „Programm suchen“ im Menü', items.some((t) => t.startsWith('Öffnen mit Wordcraft …') && t.includes('Programm suchen')));
  await page.locator('#menu .mi', { hasText: 'Öffnen mit Microsoft Word' }).click();
  check('„Öffnen mit Microsoft Word“ startet Word', await waitLog(/word .*Vertrag\.docx/));
  await pdf.click({ button: 'right' }); await sleep(500);
  const pdfItems = await page.$$eval('#menu .mi', (m) => m.map((x) => x.textContent));
  check('PDF-Menü ohne Word/LibreOffice', !pdfItems.some((t) => /Word|LibreOffice/.test(t)) && pdfItems.includes('Öffnen mit Standard-App'));
  await page.keyboard.press('Escape');
  await page.evaluate(() => hideMenu());

  // 3b) Wordcraft selbst auswählen → wird gemerkt und gestartet
  await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, path.join(FAKE, 'wordcraft-selbst'));
  await docx.click({ button: 'right' }); await sleep(500);
  await page.locator('#menu .mi', { hasText: 'Öffnen mit Wordcraft' }).click();
  check('Wordcraft per „Programm suchen“ gewählt und gestartet', await waitLog(/wordcraft-selbst .*Vertrag\.docx/));
  const st2 = await page.evaluate(() => api.call('settings:get'));
  check('Programmpfad gemerkt', st2.appPaths && /wordcraft-selbst$/.test(st2.appPaths.wordcraft || ''));
  await docx.click({ button: 'right' }); await sleep(500);
  const items2 = await page.$$eval('#menu .mi', (m) => m.map((x) => x.textContent));
  check('Danach direkt „Öffnen mit Wordcraft“', items2.includes('Öffnen mit Wordcraft'));
  await page.evaluate(() => hideMenu());

  // 4) Synchronisation: Mac-Wert „preview“ für PDF bleibt auf Windows Standard-Reader
  await page.evaluate(async () => { S.settings.openWith = { doc: 'libreoffice', pdf: 'preview' }; S.settings.openWithUpdatedAt = Date.now(); await saveSettings({ sync: false }); });
  const n = (await app.evaluate(() => global.opened.length));
  await pdf.click(); await sleep(800);
  opened = await app.evaluate(() => global.opened);
  check('PDF mit Mac-Wert „preview“ → Standard-PDF-Reader', opened.length === n + 1);

  // 5) eigenes Fenster: Klick nutzt ebenfalls die Einstellung
  fs.writeFileSync(LOG, '');
  await page.evaluate(() => openInWindow(findMessage(S.selected)));
  const viewer = await app.waitForEvent('window', { timeout: 10000 });
  await viewer.waitForSelector('[data-att]', { timeout: 10000 });
  await viewer.locator('[data-att]', { hasText: 'Vertrag.docx' }).click();
  check('Eigenes Fenster: DOCX öffnet mit LibreOffice', await waitLog(/libreoffice .*Vertrag\.docx/));
  // Rechtsklick im eigenen Fenster: Menü mitschreiben statt anzeigen
  await app.evaluate(({ Menu }) => { const orig = Menu.buildFromTemplate; Menu.buildFromTemplate = (t) => { global.lastMenu = t; const m = orig(t); m.popup = () => {}; return m; }; });
  await viewer.locator('[data-att]', { hasText: 'Vertrag.docx' }).click({ button: 'right' }); await sleep(800);
  const vItems = await app.evaluate(() => (global.lastMenu || []).map((i) => i.label || '-'));
  console.log(JSON.stringify(vItems));
  check('Eigenes Fenster: Rechtsklick bietet Word/LibreOffice/Wordcraft', ['Öffnen mit Microsoft Word', 'Öffnen mit LibreOffice', 'Öffnen mit Wordcraft', 'Öffnen mit Standard-App'].every((l) => vItems.includes(l)));
  fs.writeFileSync(LOG, '');
  await app.evaluate(() => global.lastMenu.find((i) => i.label === 'Öffnen mit Microsoft Word').click());
  check('Eigenes Fenster: „Öffnen mit Microsoft Word“ startet Word', await waitLog(/word .*Vertrag\.docx/));

  check(`Version ${require('../app/package.json').version} (package.json = App)`, (await app.evaluate(({ app: a }) => a.getVersion())) === require('../app/package.json').version);
  await page.screenshot({ path: path.join(__dirname, 'shot-anhaenge.png') });
  await app.close();
  console.log(fail ? `FEHLER: ${fail}` : 'ALLE TESTS OK');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
