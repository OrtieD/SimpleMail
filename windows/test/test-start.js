// 3.2.22/3.2.23: Start immer mit Smart Inbox über alle Konten, alle Konten samt Unterordnern in der Seitenleiste
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
const acc = (n) => ({ displayName: n, email: `${n}@test.local`, username: 'ortie@test.local', imapHost: '127.0.0.1', imapPort: 1143, smtpHost: '127.0.0.1', smtpPort: 2525 });
let fail = 0; const check = (name, ok) => { console.log(ok ? 'OK  ' : 'FAIL', name); if (!ok) fail++; };
(async () => {
  const c = new ImapFlow({ host: '127.0.0.1', port: 1143, secure: false, auth: { user: 'ortie@test.local', pass: 'geheim' }, logger: false });
  await c.connect();
  try { await c.mailboxCreate('Projekte'); } catch {}
  try { await c.mailboxCreate('Projekte/Alt'); } catch {}
  await c.logout();

  const D = path.join(__dirname, 'data-start'); fs.rmSync(D, { recursive: true, force: true });
  let { app, page } = await launch(D);
  await page.evaluate(async (list) => { for (const a of list) await api.call('accounts:save', a, 'geheim'); }, [acc('ortie'), acc('zweit')]);
  await app.close();
  ({ app, page } = await launch(D));
  await page.keyboard.press('Escape');
  check(`Version ${require('../app/package.json').version} (package.json = App)`, (await app.evaluate(({ app: a }) => a.getVersion())) === require('../app/package.json').version);
  await page.waitForSelector('#sidebar .side-item[data-drop-path="Projekte/Alt"]', { timeout: 20000 });
  // Kontofilter auf ein Konto setzen und Ordner öffnen, dann neu starten
  const second = await page.evaluate(() => S.accounts[1].id);
  await page.click(`#sidebar .account-item[data-acc="${second}"]`);
  await sleep(300);
  await page.click(`#sidebar .side-item[data-drop-acc="${second}"][data-drop-path="Projekte"]`);
  await sleep(500);
  check('vorher: Kontofilter gespeichert', (await page.evaluate(() => S.settings.accountFilter)) === second);
  await app.close();

  ({ app, page } = await launch(D));
  await page.keyboard.press('Escape');
  await page.waitForSelector('#sidebar .side-item[data-drop-path="Projekte/Alt"]', { timeout: 20000 });
  await sleep(500);
  const st = await page.evaluate(() => ({ view: S.view.type, filter: S.settings.accountFilter, accs: S.accounts.map((a) => a.id) }));
  check('Smart Inbox ausgewählt', st.view === 'smart');
  check('kein Kontofilter', !st.filter);
  check('„Alle Konten“ aktiv', !!(await page.$('#sidebar .account-item.active[data-acc=""]')));
  check('Smart Inbox in Seitenleiste markiert', (await page.$$eval('#sidebar .side-item.active', (els) => els.map((e) => e.textContent))).some((t) => t.includes('Smart Inbox')));
  for (const id of st.accs) {
    check(`Konto ${id.slice(0, 6)}: Kopf sichtbar`, !!(await page.$(`#sidebar [data-acc-title="${id}"]`)));
    check(`Konto ${id.slice(0, 6)}: Unterordner sichtbar`, await page.locator(`#sidebar .side-item[data-drop-acc="${id}"][data-drop-path="Projekte/Alt"]`).isVisible());
  }
  check('Filter auch auf der Platte zurückgesetzt', !(await page.evaluate(async () => (await api.call('settings:get')).accountFilter)));
  await page.screenshot({ path: path.join(__dirname, 'shot-start.png') });
  await app.close();

  // 3.2.23: Ordnerbaum kommt aus dem Zwischenspeicher – auch ohne Server sofort da
  const pidFile = path.join(__dirname, 'server.pid');
  if (fs.existsSync(pidFile)) {
    try { process.kill(Number(fs.readFileSync(pidFile, 'utf8'))); } catch {}
    await sleep(500);
    const t0 = Date.now();
    ({ app, page } = await launch(D));
    await page.keyboard.press('Escape');
    const ok = await page.waitForSelector('#sidebar .side-item[data-drop-path="Projekte/Alt"]', { timeout: 3000 }).then(() => true, () => false);
    check(`ohne Server: Unterordner sofort aus Zwischenspeicher (${Date.now() - t0} ms)`, ok);
    const n = await page.$$eval('#sidebar [data-acc-title]', (els) => els.length);
    check('ohne Server: beide Konten aufgeklappt', n === 2);
    await app.close();
  } else console.log('(server.pid fehlt – Zwischenspeicher-Test übersprungen)');
  console.log(fail ? `${fail} FEHLER` : 'ALLES OK');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
