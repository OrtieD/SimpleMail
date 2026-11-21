// 3.2.38: Schriftfarbe für Ordner der Seitenleiste (Rechtsklick → Schriftfarbe …), synchronisiert als folderColors,
// Umbenennen nimmt die Farbe (auch der Unterordner) mit, „Keine Farbe“ entfernt sie auf beiden Geräten.
const { _electron } = require('playwright-core');
const fs = require('fs'); const path = require('path');
const { ImapFlow } = require(path.resolve(__dirname, '../app/node_modules/imapflow'));
const { simpleParser } = require(path.resolve(__dirname, '../app/node_modules/mailparser'));
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
const imap = async (fn) => {
  const c = new ImapFlow({ host: '127.0.0.1', port: 1143, secure: false, auth: { user: 'ortie@test.local', pass: 'geheim' }, logger: false });
  await c.connect(); try { return await fn(c); } finally { await c.logout(); }
};
const syncDoc = () => imap(async (c) => {
  const box = (await c.list()).find((f) => f.name === 'SimpleMail-Sync');
  if (!box) return null;
  await c.mailboxOpen(box.path);
  let last = null;
  for await (const m of c.fetch('1:*', { source: true })) last = m.source;
  const p = await simpleParser(last);
  return JSON.parse(p.attachments.find((a) => /sync\.json$/.test(a.filename)).content.toString());
});
const setupPc = (page) => page.evaluate(async (a) => {
  await api.call('accounts:save', a, 'geheim');
  S.settings.sync = { enabled: true, accountEmail: 'ortie@test.local' };
  await saveSettings({ sync: false });
}, acc);
const sync = async (page) => { await page.evaluate(async () => { await runSync(); }); await sleep(1500); };
const folderSel = (p) => `#sidebar .side-item[data-drop-path="${p}"]`;
const labelColor = (page, p) => page.$eval(`${folderSel(p)} .label`, (e) => getComputedStyle(e).color).catch(() => null);
const menuLabels = (page) => page.$$eval('#menu:not(.hidden) .mi', (els) => els.map((e) => e.textContent.trim()));
async function pickColor(page, folder, colorName) {
  await page.click(folderSel(folder), { button: 'right' }); await sleep(200);
  const items = await menuLabels(page);
  await page.locator('#menu .mi', { hasText: 'Schriftfarbe' }).first().click(); await sleep(250);
  const sub = await menuLabels(page);
  await page.locator('#menu:not(.hidden) .mi', { hasText: colorName }).first().click(); await sleep(400);
  return { items, sub };
}
async function start(dir, setup) {
  let { app, page } = await launch(dir);
  if (setup) { await setupPc(page); await app.close(); ({ app, page } = await launch(dir)); }
  await page.keyboard.press('Escape');
  await page.waitForSelector('#sidebar .side-item[data-drop-path="INBOX"]', { timeout: 20000 });
  await page.evaluate(() => loadFolders()); await sleep(500);
  return { app, page };
}
const RED = 'rgb(255, 59, 48)'; const BLUE = 'rgb(10, 132, 255)';

(async () => {
  await imap(async (c) => { await c.mailboxCreate('Projekte'); await c.mailboxCreate('Projekte/Alt'); });
  const A = path.join(__dirname, 'data-ofarbe-a'); const B = path.join(__dirname, 'data-ofarbe-b');
  for (const d of [A, B]) fs.rmSync(d, { recursive: true, force: true });

  // PC A: Farben wählen
  let { app, page } = await start(A, true);
  check(`Version ${require('../app/package.json').version} (package.json = App)`, (await app.evaluate(({ app: a }) => a.getVersion())) === require('../app/package.json').version);
  const normal = await labelColor(page, 'Projekte');
  const r = await pickColor(page, 'Projekte', 'Rot');
  check('Rechtsklick bietet „Schriftfarbe …“', r.items.some((t) => t.startsWith('Schriftfarbe')));
  check('Untermenü: „Keine Farbe“ + 10 Farben', r.sub.length === 11 && r.sub[0].includes('Keine Farbe') && r.sub.some((t) => t.includes('Türkis')));
  check('Projekte rot', (await labelColor(page, 'Projekte')) === RED);
  check('andere Ordner unverändert', (await labelColor(page, 'INBOX')) === normal);
  await pickColor(page, 'Projekte/Alt', 'Blau');
  check('Projekte/Alt blau', (await labelColor(page, 'Projekte/Alt')) === BLUE);
  const sub2 = (await pickColor(page, 'Projekte', 'Rot')).sub;
  check('aktuelle Farbe im Untermenü abgehakt', sub2.some((t) => t.startsWith('✓') && t.includes('Rot')));
  check('gespeichert in settings.json', JSON.parse(fs.readFileSync(path.join(A, 'settings.json'), 'utf8')).folderColors['ortie@test.local|Projekte'].color === '#ff3b30');
  await sync(page);
  let doc = await syncDoc();
  check('Sync-Dokument enthält folderColors', doc && doc.folderColors && doc.folderColors['ortie@test.local|Projekte'] && doc.folderColors['ortie@test.local|Projekte'].color === '#ff3b30');
  await page.screenshot({ path: path.join(__dirname, 'shot-ordnerfarbe.png') });
  // Neustart: Farbe bleibt
  await app.close();
  ({ app, page } = await start(A, false));
  check('nach Neustart noch rot', (await labelColor(page, 'Projekte')) === RED);
  await app.close();

  // PC B: übernimmt die Farbe, benennt um
  ({ app, page } = await start(B, true));
  await sync(page); await page.evaluate(() => { renderAll(); }); await sleep(300);
  check('PC B: Projekte rot (per Sync)', (await labelColor(page, 'Projekte')) === RED);
  check('PC B: Projekte/Alt blau (per Sync)', (await labelColor(page, 'Projekte/Alt')) === BLUE);
  await page.click(folderSel('Projekte'), { button: 'right' }); await sleep(200);
  await page.locator('#menu .mi', { hasText: 'Umbenennen' }).first().click();
  await page.waitForSelector('#pd-val'); await page.fill('#pd-val', 'Kunden'); await page.click('[data-x="yes"]');
  await sleep(1500);
  check('PC B: Kunden rot (Farbe zieht mit)', (await labelColor(page, 'Kunden')) === RED);
  check('PC B: Kunden/Alt blau (Unterordner zieht mit)', (await labelColor(page, 'Kunden/Alt')) === BLUE);
  await sync(page);
  doc = await syncDoc();
  check('Sync: alter Schlüssel gelöscht markiert', doc.folderColors['ortie@test.local|Projekte'].deleted === true);
  check('Sync: neuer Schlüssel rot', doc.folderColors['ortie@test.local|Kunden'].color === '#ff3b30');
  await app.close();

  // PC A: übernimmt Umbenennung, entfernt Farbe
  ({ app, page } = await start(A, false));
  await sync(page); await page.evaluate(() => loadFolders()); await sleep(800);
  check('PC A: Kunden rot', (await labelColor(page, 'Kunden')) === RED);
  await pickColor(page, 'Kunden', 'Keine Farbe');
  check('PC A: Kunden ohne Farbe', (await labelColor(page, 'Kunden')) === normal);
  await sync(page);
  await app.close();
  ({ app, page } = await start(B, false));
  await sync(page); await page.evaluate(() => { renderAll(); }); await sleep(300);
  check('PC B: Kunden ohne Farbe (per Sync)', (await labelColor(page, 'Kunden')) === normal);
  check('PC B: Kunden/Alt weiter blau', (await labelColor(page, 'Kunden/Alt')) === BLUE);

  // Löschen entfernt die Farbe
  await page.click(folderSel('Kunden/Alt'), { button: 'right' }); await sleep(200);
  await page.locator('#menu .mi', { hasText: 'Ordner löschen' }).first().click(); await sleep(300);
  await page.click('[data-x="yes"]'); await sleep(1500);
  const fc = await page.evaluate(() => S.settings.folderColors['ortie@test.local|Kunden/Alt']);
  check('Löschen markiert Farbe als gelöscht', fc && fc.deleted === true);
  await app.close();
  console.log(fail ? `${fail} FEHLER` : 'ALLES OK');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
