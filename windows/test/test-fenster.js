// Prüft: Doppelklick öffnet Mail im eigenen Fenster (Öffnen erst beim Loslassen), Fenster sichtbar,
// kein doppeltes Fenster, Enter, Kontextmenü, Archivieren aus dem Fenster, Kontofarbe/Laden noch vorhanden
const { _electron } = require('playwright-core');
const fs = require('fs'); const path = require('path');
const APP = path.resolve(__dirname, '../app');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function launch(dir) {
  const app = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox'], env: { ...process.env, SIMPLEMAIL_DATA: dir } });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.waitForLoadState('domcontentloaded'); await sleep(1500);
  return { app, page };
}
const acc = { displayName: 'ortie', email: 'ortie@test.local', username: 'ortie@test.local', imapHost: '127.0.0.1', imapPort: 1143, smtpHost: '127.0.0.1', smtpPort: 2525 };
let fail = 0; const check = (name, ok) => { console.log(ok ? 'OK  ' : 'FAIL', name); if (!ok) fail++; };
const winCount = (app) => app.windows().length;
(async () => {
  const D = '/tmp/smF'; fs.rmSync(D, { recursive: true, force: true });
  let { app, page } = await launch(D);
  await page.evaluate(async (a) => { await api.call('accounts:save', a, 'geheim'); }, acc);
  await app.close();
  ({ app, page } = await launch(D));
  await page.keyboard.press('Escape');
  await page.waitForSelector('.row[data-key]', { timeout: 20000 });
  await sleep(1500);
  check(`Version ${require('../app/package.json').version} (package.json = App)`, (await app.evaluate(({ app: a }) => a.getVersion())) === require('../app/package.json').version);
  check('Kontofarben vorhanden (3.2.0)', await page.evaluate(() => typeof COLOR_CHOICES !== 'undefined' && COLOR_CHOICES.length === 10));
  const row = () => page.locator('#list .row[data-key]', { hasText: 'Treffen morgen' });
  // Doppelklick mit getrennten Maus-Ereignissen: nach dem 2. Drücken noch kein Fenster, erst beim Loslassen
  const box = await row().boundingBox();
  const x = box.x + 60, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down(); await page.mouse.up(); await sleep(120);
  await page.mouse.down({ clickCount: 2 }); await sleep(400);
  check('Beim 2. Drücken noch kein Fenster', winCount(app) === 1);
  const winP = app.waitForEvent('window', { timeout: 10000 });
  await page.mouse.up({ clickCount: 2 });
  const w2 = await winP;
  w2.on('pageerror', (e) => console.log('PAGEERROR (Fenster)', e.message));
  await w2.waitForFunction(() => document.body.innerText.includes('Testmail'), null, { timeout: 15000 });
  check('Fenster zeigt Mailtext', true);
  check('Fenstertitel = Betreff', (await w2.title()) === 'Treffen morgen');
  const vis = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ t: w.getTitle(), v: w.isVisible(), top: w.isAlwaysOnTop() })));
  console.log(vis);
  check('Neues Fenster sichtbar', vis.some((w) => w.t === 'Treffen morgen' && w.v));
  await sleep(500);
  check('„Immer im Vordergrund“ wieder aus', await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every((w) => !w.isAlwaysOnTop())));
  await w2.screenshot({ path: path.join(__dirname, 'shot-fenster.png') });
  // Playwright-dblclick (echtes dblclick-Ereignis) auf dieselbe Mail → kein zweites Fenster
  await row().dblclick(); await sleep(1500);
  check('Kein doppeltes Fenster', winCount(app) === 2);
  // Andere Mail per Doppelklick → zweites Fenster, nur eins
  await page.locator('#list .row[data-key]', { hasText: 'Rechnung' }).dblclick(); await sleep(2000);
  check('Zweite Mail: genau ein weiteres Fenster', winCount(app) === 3);
  let w3 = null; for (const w of app.windows()) { if (!w.isClosed() && (await w.title()) === 'Rechnung') w3 = w; }
  const c3 = w3.waitForEvent('close', { timeout: 5000 }).then(() => true).catch(() => false);
  await w3.keyboard.press('Escape').catch(() => {});
  check('Escape schließt Fenster', await c3);
  // Kontextmenü
  await row().click({ button: 'right' });
  check('Kontextmenü-Eintrag', (await page.locator('#menu').innerText()).includes('In eigenem Fenster öffnen'));
  await page.keyboard.press('Escape');
  // Archivieren im Fenster
  const closed = w2.waitForEvent('close', { timeout: 5000 }).then(() => true).catch(() => false);
  await w2.locator('[data-a="delete"]').click();
  check('Fenster schließt nach Löschen', await closed);
  await sleep(1000);
  console.log('Fehler:', await page.evaluate(() => S.error)); console.log((await page.locator('#list').innerText()).slice(0,300));
  check('Mail im Hauptfenster entfernt', !(await page.locator('#list').innerText()).includes('Treffen morgen'));
  // Enter öffnet gewählte Mail
  await page.locator('#list .row[data-key]', { hasText: 'Rechnung' }).click(); await sleep(500);
  const w4P = app.waitForEvent('window', { timeout: 10000 });
  await page.keyboard.press('Enter');
  const w4 = await w4P; await w4.waitForFunction(() => document.body.innerText.includes('Testmail'), null, { timeout: 15000 });
  check('Enter öffnet Fenster', true);
  await page.screenshot({ path: path.join(__dirname, 'shot-haupt.png') });
  await app.close();
  console.log(fail ? `FEHLER: ${fail}` : 'ALLE TESTS OK');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
