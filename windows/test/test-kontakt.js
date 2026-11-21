// Prüft: übernommener Kontakt (aus Mail-Signatur) lässt sich bearbeiten, auch wenn währenddessen
// ein Sync-Abgleich oder ein Mail-Abruf die Ansicht neu aufbaut
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
// so, wie der Hauptprozess nach einem Sync-Abgleich das Fenster benachrichtigt
const syncApplied = (app) => app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].webContents.send('sync-applied', {}); });
(async () => {
  const D = path.join(__dirname, 'data-kontakt'); fs.rmSync(D, { recursive: true, force: true });
  let { app, page } = await launch(D);
  await page.evaluate(async (a) => { await api.call('accounts:save', a, 'geheim'); }, acc);
  await app.close();
  ({ app, page } = await launch(D));
  await page.keyboard.press('Escape');
  await page.waitForSelector('.row[data-key]', { timeout: 20000 });
  check(`Version ${require('../app/package.json').version} (package.json = App)`, (await app.evaluate(({ app: a }) => a.getVersion())) === require('../app/package.json').version);

  // Kontakt aus einer Mail mit Signatur übernehmen
  await page.evaluate(async () => {
    const m = { ...Object.values(S.inbox)[0][0], uid: 99999, fromName: 'Max Muster', fromAddress: 'max@firma.de' };
    S.bodies[keyOf(m)] = { text: 'Hallo,\n\nviele Grüße\nMax Muster\nMuster GmbH\nTel. +49 89 123456\nHauptstr. 5\n80331 München' };
    await addSenderToContacts(m);
  });
  await page.waitForSelector('.contact-form [data-f="phones"]');
  const before = await page.evaluate(() => ({ ...findContact(S.selContact) }));
  console.log(JSON.stringify(before));
  check('Telefon übernommen', before.phones.length === 1);

  // zweite Telefonnummer mit Leerzeichen anhängen – mitten im Tippen kommt ein Sync-Abgleich
  const ph = page.locator('.contact-form [data-f="phones"]');
  await ph.click(); await page.keyboard.press('End'); await page.keyboard.press('Control+End');
  await page.keyboard.type('\n+49 171', { delay: 20 });
  await syncApplied(app); await sleep(300);
  await page.keyboard.type(' 555 66', { delay: 20 });
  // und ein Neuaufbau durch einen Mail-Abruf
  await page.evaluate(() => renderAll());
  await page.keyboard.type('77', { delay: 20 });
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.dataset.f);
  check('Cursor bleibt im Telefonfeld', focused === 'phones');
  check('Eingabe vollständig im Feld', (await ph.inputValue()) === 'Telefon: +49 89 123456\n+49 171 555 6677');

  // Name ändern, Sync kommt, bevor gespeichert wurde
  const nm = page.locator('.contact-form [data-f="name"]');
  await nm.click(); await page.keyboard.press('End');
  await page.keyboard.type(' jun.', { delay: 20 });
  await syncApplied(app); await sleep(200);
  check('Name nach Sync unverändert', (await nm.inputValue()) === 'Max Muster jun.');
  await sleep(1200);
  const saved = await page.evaluate(async () => (await api.call('settings:get')).contacts.find((c) => c.emails.includes('max@firma.de')));
  console.log(JSON.stringify(saved));
  check('Telefonnummern gespeichert', JSON.stringify(saved.phones) === JSON.stringify(['Telefon: +49 89 123456', '+49 171 555 6677']));
  check('Name gespeichert', saved.name === 'Max Muster jun.');
  check('Adresse übernommen', saved.street === 'Hauptstr. 5' && saved.city === 'München');

  // Farbe wählen aktualisiert die Ansicht weiterhin
  await page.locator('.contact-form [data-act="ct-color"]').nth(2).click();
  const sel = await page.evaluate(() => { const b = document.querySelector('.contact-form [data-act="ct-color"].selected, .contact-form [data-act="ct-color"].on, .contact-form [data-act="ct-color"][aria-pressed="true"]'); return b ? b.dataset.color : findContact(S.selContact).color; });
  check('Farbe gesetzt', !!(await page.evaluate(() => findContact(S.selContact).color)));
  await page.screenshot({ path: path.join(__dirname, 'shot-kontakt.png') });
  await app.close();
  console.log(fail ? `FEHLER: ${fail}` : 'ALLE TESTS OK');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
