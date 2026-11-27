// 3.2.33/3.2.35 (größer + Versionsanzeige): eigene Menüleiste im Fenster mit größerer Schrift (natives Menü ausgeblendet, Kürzel bleiben)
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
const acc = { displayName: 'Ortie', email: 'ortie@test.local', username: 'ortie@test.local', imapHost: '127.0.0.1', imapPort: 1143, smtpHost: '127.0.0.1', smtpPort: 2525 };
let fail = 0; const check = (name, ok) => { console.log(ok ? 'OK  ' : 'FAIL', name); if (!ok) fail++; };
const dropOpen = (page) => page.$eval('#mbDrop', (e) => !e.classList.contains('hidden'));
const openTop = (page, label) => page.locator('#menubar .mb-top', { hasText: label }).click();
const item = (page, sel, label) => page.locator(`${sel} .mi`, { hasText: label }).first();
(async () => {
  const D = path.join(__dirname, 'data-menue'); fs.rmSync(D, { recursive: true, force: true });
  let { app, page } = await launch(D);
  await page.evaluate(async (a) => { await api.call('accounts:save', a, 'geheim'); }, acc);
  await app.close();
  ({ app, page } = await launch(D));
  await page.keyboard.press('Escape');
  check(`Version ${require('../app/package.json').version}`, (await app.evaluate(({ app: a }) => a.getVersion())) === require('../app/package.json').version);

  const nat = await app.evaluate(({ BrowserWindow, Menu }) => ({ visible: BrowserWindow.getAllWindows()[0].isMenuBarVisible(), menu: !!Menu.getApplicationMenu() }));
  check('natives Menü ausgeblendet', nat.visible === false);
  check('Anwendungsmenü bleibt (Kürzel)', nat.menu);

  await page.waitForSelector('#menubar .mb-top');
  const tops = await page.$$eval('#menubar .mb-top', (els) => els.map((e) => e.textContent));
  check(`Einträge: ${tops.join(', ')}`, tops.join('|') === 'Datei|Bearbeiten|E-Mail|Ansicht|Hilfe');
  const bar = await page.$eval('#menubar', (e) => ({ fs: parseFloat(getComputedStyle(e).fontSize), h: e.getBoundingClientRect().height }));
  check(`Schrift Menüleiste ${bar.fs}px (≥ 18)`, bar.fs >= 18);
  check(`Höhe Menüleiste ${bar.h}px`, bar.h >= 42);
  const ver = await page.$eval('#menubar .mb-ver', (e) => e.textContent).catch(() => '');
  check(`Versionsanzeige: ${ver}`, ver === `SimpleMail ${require('../app/package.json').version}`);
  const appH = await page.evaluate(() => document.querySelector('#app').getBoundingClientRect().bottom <= window.innerHeight + 1);
  check('Fenster-Inhalt passt unter die Menüleiste', appH);

  // Datei → Neue E-Mail
  await openTop(page, 'Datei');
  check('Datei-Menü offen', await dropOpen(page));
  const row = await item(page, '#mbDrop', 'Neue E-Mail').evaluate((e) => ({ t: e.textContent, fs: parseFloat(getComputedStyle(e).fontSize) }));
  check(`Eintrag mit Kürzel: ${row.t}`, row.t.includes('Strg+N'));
  check(`Schrift Einträge ${row.fs}px (≥ 17)`, row.fs >= 17);
  await page.screenshot({ path: path.join(__dirname, 'shot-menueleiste.png') });
  // Wechsel per Maus auf anderes Menü
  await page.locator('#menubar .mb-top', { hasText: 'Bearbeiten' }).hover();
  await sleep(200);
  check('Hover wechselt zu Bearbeiten', (await page.$eval('#mbDrop', (e) => e.textContent)).includes('Kopieren'));
  await openTop(page, 'Datei'); await sleep(100);
  await openTop(page, 'Datei'); await sleep(200);
  await item(page, '#mbDrop', 'Neue E-Mail').click();
  await sleep(800);
  check('Neue E-Mail geöffnet', (await page.$$eval('#modal-root *', (e) => e.length)) > 0);
  check('Menü danach zu', !(await dropOpen(page)));
  await page.keyboard.press('Escape'); await sleep(300);
  if ((await page.$$eval('#modal-root *', (e) => e.length)) > 0) { await page.evaluate(() => { document.querySelector('#modal-root').innerHTML = ''; }); }

  // Klick außerhalb schließt
  await openTop(page, 'Hilfe');
  await page.mouse.click(700, 500); await sleep(200);
  check('Klick außerhalb schließt', !(await dropOpen(page)));

  // Ansicht → Sortierung (Untermenü) mit Haken
  await openTop(page, 'Ansicht');
  await item(page, '#mbDrop', 'Sortierung').hover(); await sleep(200);
  check('Untermenü sichtbar', await page.$eval('#mbSub', (e) => !e.classList.contains('hidden')));
  check('Haken bei „Neueste oben“', (await item(page, '#mbSub', 'Neueste').textContent()).includes('✓'));
  await item(page, '#mbSub', 'Älteste').click(); await sleep(600);
  check('Sortierung aufsteigend gesetzt', await page.evaluate(() => !!S.settings.sortAsc));
  await openTop(page, 'Ansicht');
  await item(page, '#mbDrop', 'Sortierung').hover(); await sleep(200);
  check('Haken jetzt bei „Älteste oben“', (await item(page, '#mbSub', 'Älteste').textContent()).includes('✓'));
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await sleep(100);
  check('Esc schließt', !(await dropOpen(page)));

  // Vergrößern / Originalgröße (Rolle)
  await openTop(page, 'Ansicht'); await item(page, '#mbDrop', 'Vergrößern').click(); await sleep(400);
  const z1 = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomLevel());
  check(`Vergrößern wirkt (Stufe ${z1})`, z1 > 0);
  await openTop(page, 'Ansicht'); await item(page, '#mbDrop', 'Originalgröße').click(); await sleep(400);
  check('Originalgröße', (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomLevel())) === 0);

  // Bearbeiten: Kopieren/Einfügen wirken im Feld, Fokus bleibt
  await page.click('#search');
  await page.keyboard.type('Menütest');
  await page.keyboard.press('Control+a');
  await openTop(page, 'Bearbeiten');
  check('Fokus bleibt im Suchfeld', await page.evaluate(() => document.activeElement.id === 'search'));
  await item(page, '#mbDrop', 'Kopieren').click(); await sleep(300);
  await page.evaluate(() => { const s = document.querySelector('#search'); s.value = ''; s.focus(); });
  await openTop(page, 'Bearbeiten'); await item(page, '#mbDrop', 'Einfügen').click(); await sleep(400);
  check('Kopieren + Einfügen über Menü', (await page.inputValue('#search')) === 'Menütest');
  await page.evaluate(() => { const s = document.querySelector('#search'); s.value = ''; s.dispatchEvent(new Event('input')); s.blur(); });
  await sleep(300);

  // Tastatur: Alt+A, Pfeile, Enter; F10; Alt allein
  await page.click('#list'); await sleep(100);
  await page.keyboard.press('Alt+a'); await sleep(200);
  check('Alt+A öffnet Ansicht', (await page.$eval('#menubar .mb-top.open', (e) => e.textContent)) === 'Ansicht');
  check('Unterstrich im Tastaturmodus', await page.$eval('#menubar', (e) => e.classList.contains('kbd')));
  await page.keyboard.press('ArrowRight'); await sleep(100);
  check('Pfeil rechts → Hilfe', (await page.$eval('#menubar .mb-top.open', (e) => e.textContent)) === 'Hilfe');
  await page.keyboard.press('Escape'); await sleep(100);
  await page.keyboard.press('F10'); await sleep(200);
  check('F10 öffnet Datei', (await page.$eval('#menubar .mb-top.open', (e) => e.textContent)) === 'Datei');
  await page.keyboard.press('ArrowDown'); await sleep(100);
  check('Pfeil runter markiert Eintrag 2', (await page.$eval('#mbDrop .mi.active', (e) => e.textContent)).startsWith('Als Entwurf speichern'));
  await page.keyboard.press('Escape'); await sleep(100);
  await page.keyboard.press('Alt'); await sleep(200);
  check('Alt allein öffnet Menüleiste', await dropOpen(page));
  await page.keyboard.press('Alt'); await sleep(200);
  check('Alt erneut schließt', !(await dropOpen(page)));
  // Alt+E → E-Mail, Taste „g“ springt zu „Gelesen / ungelesen“
  await page.keyboard.press('Alt+e'); await sleep(200);
  await page.keyboard.press('g'); await sleep(100);
  check('Buchstabe springt zum Eintrag', (await page.$eval('#mbDrop .mi.active', (e) => e.textContent)).startsWith('Gelesen'));
  await page.keyboard.press('Escape');
  // Pfeiltasten in der Liste funktionieren weiter, wenn Menü zu ist
  check('Menü zu', !(await dropOpen(page)));

  await app.close();
  console.log(fail ? `${fail} FEHLER` : 'ALLES OK');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
