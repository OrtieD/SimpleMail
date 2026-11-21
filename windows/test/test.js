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
const acc = (email) => ({ displayName: email.split('@')[0], email, username: 'ortie@test.local', imapHost: '127.0.0.1', imapPort: 1143, smtpHost: '127.0.0.1', smtpPort: 2525 });
(async () => {
  const A = '/tmp/smA', B = '/tmp/smB';
  for (const d of [A, B]) fs.rmSync(d, { recursive: true, force: true });
  let { app, page } = await launch(A);
  await page.evaluate(async ([a1, a2]) => {
    await api.call('accounts:save', a1, 'geheim');
    await api.call('accounts:save', a2, 'geheim');
  }, [acc('ortie@test.local'), acc('zweit@test.local')]);
  await app.close();
  ({ app, page } = await launch(A));
  await page.keyboard.press('Escape');
  await page.waitForSelector('.row[data-key]', { timeout: 20000 });
  await sleep(1500);
  // Kontofarbe über Einstellungen setzen (erstes Konto → Rot)
  await page.evaluate(() => openSettings({ tab: 'accounts' }));
  await page.click('[data-x="acc-color"][data-color="#ff3b30"]');
  await sleep(500);
  console.log('Swatch aktiv:', await page.$eval('[data-x="acc-color"].active', (b) => b.dataset.color));
  await page.screenshot({ path: 'shot-settings.png' });
  await page.click('[data-x="close"]');
  const stripes = await page.$$eval('.row .acc-stripe', (els) => els.map((e) => getComputedStyle(e).backgroundColor));
  console.log('Streifen:', stripes);
  const sideDots = await page.$$eval('.side-title .acc-dot', (els) => els.map((e) => getComputedStyle(e).backgroundColor));
  console.log('Seitenleiste:', sideDots);
  // Kontakt mit Schriftfarbe
  await page.evaluate(() => { const c = newContact({ name: 'Alice Anders', emails: ['alice@example.com'] }); showContacts(c.id); });
  await sleep(300);
  await page.click('[data-act="ct-color"][data-color="#34c759"]');
  await sleep(300);
  console.log('Kontaktliste Farbe:', await page.$eval('.contact-row .from', (e) => getComputedStyle(e).color));
  await page.screenshot({ path: 'shot-contact.png' });
  await page.evaluate(() => { S.view = { type: 'smart' }; renderAll(); });
  await sleep(300);
  const froms = await page.$$eval('.row[data-key] .from', (els) => els.map((e) => e.textContent + '=' + getComputedStyle(e).color));
  console.log('Absender:', froms);
  await page.screenshot({ path: 'shot-list.png' });
  // Sync einschalten, Dokument hochladen
  await page.evaluate(async () => { S.settings.sync = { enabled: true, accountEmail: 'ortie@test.local' }; await api.call('settings:set', S.settings); });
  console.log('Sync A:', JSON.stringify(await page.evaluate(() => api.call('sync:now'))));
  await app.close();
  // Zweites Gerät
  ({ app, page } = await launch(B));
  await page.evaluate(async ([a1]) => { await api.call('accounts:save', a1, 'geheim'); }, [acc('ortie@test.local')]);
  await app.close();
  ({ app, page } = await launch(B));
  await page.keyboard.press('Escape');
  await page.evaluate(async () => { S.settings.sync = { enabled: true, accountEmail: 'ortie@test.local' }; await api.call('settings:set', S.settings); });
  await sleep(2500);
  console.log('Sync B:', JSON.stringify(await page.evaluate(() => api.call('sync:now'))));
  await sleep(1500);
  const accs = await page.evaluate(() => S.accounts.map((a) => [a.email, a.color, a.colorUpdatedAt > 0]));
  console.log('B fromSync:', JSON.stringify((await page.evaluate(() => api.call('accounts:list'))).map((a) => [a.email, !!a.fromSync])));
  console.log('B Konten:', JSON.stringify(accs));
  const ct = await page.evaluate(() => S.settings.contacts.map((c) => [c.name, c.color]));
  console.log('B Kontakte:', JSON.stringify(ct));
  await page.waitForSelector('.row[data-key]', { timeout: 20000 }).catch(() => {});
  await sleep(1500);
  const froms2 = await page.$$eval('.row[data-key] .from', (els) => els.map((e) => e.textContent + '=' + getComputedStyle(e).color));
  console.log('B Absender:', froms2);
  // B ändert Farbe zurück auf automatisch → A übernimmt
  await page.evaluate(async () => { const a = S.accounts.find((x) => x.email === 'ortie@test.local'); await api.call('accounts:setColor', a.id, '#5856d6'); });
  console.log('Sync B2:', JSON.stringify(await page.evaluate(() => api.call('sync:now'))));
  await page.screenshot({ path: 'shot-B.png' });
  await app.close();
  ({ app, page } = await launch(A));
  await sleep(2500);
  await page.evaluate(() => api.call('sync:now'));
  await sleep(1000);
  console.log('A Konten nach B-Änderung:', JSON.stringify(await page.evaluate(() => S.accounts.map((a) => [a.email, a.color]))));
  await app.close();
  console.log('FERTIG');
})().catch((e) => { console.error('FEHLER', e); process.exit(1); });
