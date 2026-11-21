// Prüft: gelöschte Mail taucht durch einen parallel laufenden Abruf nicht wieder auf; Auswahl springt zur nächsten Zeile
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
const acc = { displayName: 'ortie', email: 'ortie@test.local', username: 'ortie@test.local', imapHost: '127.0.0.1', imapPort: 1143, smtpHost: '127.0.0.1', smtpPort: 2525 };
let fail = 0; const check = (name, ok) => { console.log(ok ? 'OK  ' : 'FAIL', name); if (!ok) fail++; };
(async () => {
  // ein paar persönliche Mails und Newsletter dazu
  const c = new ImapFlow({ host: '127.0.0.1', port: 1143, secure: false, auth: { user: 'ortie@test.local', pass: 'geheim' }, logger: false });
  await c.connect();
  for (let i = 0; i < 4; i++) await c.append('INBOX', `From: P${i} <p${i}@example.com>\r\nTo: ortie@test.local\r\nSubject: Person ${i}\r\nDate: Wed, 12 Nov 2026 0${i}:00:00 +0100\r\nMessage-ID: <p${i}.${Date.now()}@x>\r\n\r\nHallo\r\n`, []);
  for (let i = 0; i < 3; i++) await c.append('INBOX', `From: News <news@example.com>\r\nTo: ortie@test.local\r\nSubject: Newsletter ${i}\r\nList-Id: x\r\nDate: Thu, 13 Nov 2026 0${i}:00:00 +0100\r\nMessage-ID: <n${i}.${Date.now()}@x>\r\n\r\nNews\r\n`, []);
  await c.logout();
  const D = path.join(__dirname, 'data-loeschen'); fs.rmSync(D, { recursive: true, force: true });
  let { app, page } = await launch(D);
  await page.evaluate(async (a) => { await api.call('accounts:save', a, 'geheim'); }, acc);
  await app.close();
  ({ app, page } = await launch(D));
  await page.keyboard.press('Escape');
  await page.waitForSelector('.row[data-key]', { timeout: 20000 });
  await page.evaluate(async () => { while (S.loading || S.pending) await new Promise((r) => setTimeout(r, 50)); });
  const order = await page.$$eval('.row[data-key]', (r) => r.map((x) => x.dataset.key));
  // letzte persönliche Mail auswählen (danach folgt in der Anzeige die Newsletter-Gruppe)
  const res = await page.evaluate(async () => {
    const pers = displayedMessages().filter((m) => m.category === 'personal');
    const target = pers[pers.length - 1];
    S.selected = keyOf(target); renderAll();
    const shownBefore = displayedMessages().map(keyOf);
    const idx = shownBefore.indexOf(keyOf(target));
    // Abruf läuft schon, dann wird gelöscht (wie bei Push direkt vor dem Löschen)
    const r = refresh();
    await remove(target);
    await r;
    while (S.loading || S.pending) await new Promise((res) => setTimeout(res, 50));
    const keys = [...document.querySelectorAll('.row[data-key]')].map((x) => x.dataset.key);
    return { target: keyOf(target), expectedNext: shownBefore[idx + 1] || shownBefore[idx - 1], selected: S.selected, stillShown: keys.includes(keyOf(target)) };
  });
  console.log(JSON.stringify(res));
  check('Gelöschte Mail bleibt weg trotz parallelem Abruf', !res.stillShown);
  check('Auswahl springt zur nächsten angezeigten Zeile', res.selected === res.expectedNext);
  await sleep(1500);
  await page.evaluate(async () => { await refresh(); while (S.loading || S.pending) await new Promise((r) => setTimeout(r, 50)); });
  const after = await page.$$eval('.row[data-key]', (r) => r.map((x) => x.dataset.key));
  check('Auch nach weiterem Abruf weg', !after.includes(res.target) && after.length === order.length - 1);
  await page.screenshot({ path: path.join(__dirname, 'shot-loeschen.png') });
  await app.close();
  console.log(fail ? `FEHLER: ${fail}` : 'ALLE TESTS OK');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
