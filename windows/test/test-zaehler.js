// Prüft: Zähler (Kategorie + Ordner) sinken sofort beim Öffnen einer ungelesenen Mail, nicht erst nach dem Laden
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
(async () => {
  const D = path.join(__dirname, 'data-zaehler'); fs.rmSync(D, { recursive: true, force: true });
  let { app, page } = await launch(D);
  await page.evaluate(async (a) => { await api.call('accounts:save', a, 'geheim'); }, acc);
  await app.close();
  ({ app, page } = await launch(D));
  await page.keyboard.press('Escape');
  await page.waitForSelector('.row[data-key]', { timeout: 20000 });
  await page.evaluate(async () => { while (S.loading || S.pending || !Object.values(S.folders)[0]) await new Promise((r) => setTimeout(r, 50)); });
  const r = await page.evaluate(async () => {
    const inboxF = () => Object.values(S.folders)[0].find((f) => f.path === 'INBOX').unread;
    const m = Object.values(S.inbox)[0].find((x) => !x.isRead);
    const before = { cat: unreadCount(), folder: inboxF() };
    // Laden des Textes künstlich verzögern
    const orig = api.call;
    api.call = (ch, ...a) => ch === 'mail:body' ? new Promise((res) => setTimeout(() => res(orig(ch, ...a)), 1500)) : orig(ch, ...a);
    const p = loadBody(m);
    await new Promise((res) => setTimeout(res, 50));
    const during = { cat: unreadCount(), folder: inboxF() };
    await p;
    api.call = orig;
    return { before, during };
  });
  console.log(JSON.stringify(r));
  check('Kategorie-Zähler sinkt sofort', r.during.cat === r.before.cat - 1);
  check('Ordner-Zähler sinkt sofort', r.during.folder === r.before.folder - 1);
  await page.screenshot({ path: path.join(__dirname, 'shot-zaehler.png') });
  await app.close();
  console.log(fail ? `FEHLER: ${fail}` : 'ALLE TESTS OK');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
