// Prüft den schnellen Abgleich: neue Mail, geänderte Flags, gelöschte Mail, Neustart aus der Ablage
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
async function imap(fn) {
  const c = new ImapFlow({ host: '127.0.0.1', port: 1143, secure: false, auth: { user: 'ortie@test.local', pass: 'geheim' }, logger: false });
  await c.connect(); const lock = await c.getMailboxLock('INBOX');
  try { return await fn(c); } finally { lock.release(); await c.logout(); }
}
const raw = (subj) => `From: Carla <carla@example.com>\r\nTo: ortie@test.local\r\nSubject: ${subj}\r\nDate: Wed, 12 Nov 2026 10:00:00 +0100\r\nMessage-ID: <${Math.random().toString(36).slice(2)}@x>\r\n\r\nHallo\r\n`;
const doRefresh = (page) => page.evaluate(async () => { const w = async () => { while (S.loading || S.pending) await new Promise((r) => setTimeout(r, 50)); }; await w(); await refresh(); await w(); });
const inbox = (page) => page.evaluate(() => Object.values(S.inbox)[0].map((m) => `${m.subject}|${m.isRead ? 'R' : 'U'}`).sort());
let fail = 0; const check = (name, ok) => { console.log(ok ? 'OK  ' : 'FAIL', name); if (!ok) fail++; };
(async () => {
  const D = '/tmp/smL'; fs.rmSync(D, { recursive: true, force: true });
  let { app, page } = await launch(D);
  await page.evaluate(async (a) => { await api.call('accounts:save', a, 'geheim'); }, acc);
  await app.close();
  ({ app, page } = await launch(D));
  await page.keyboard.press('Escape');
  await page.waitForSelector('.row[data-key]', { timeout: 20000 });
  await sleep(1000);
  let t0 = Date.now(); await doRefresh(page); console.log('Abruf 1 (ms):', Date.now() - t0);
  const l1 = await inbox(page); console.log(l1);
  check('Erstabruf 2 Mails', l1.length === 2);
  check('Ordner geladen', await page.evaluate(() => (Object.values(S.folders)[0] || []).length > 0));
  // Neue Mail + Flag-Änderung auf dem Server
  await imap(async (c) => { await c.append('INBOX', raw('Neu dazu'), []); await c.messageFlagsAdd({ all: true }, ['\\Seen']); });
  t0 = Date.now(); await doRefresh(page); console.log('Abruf 2 (ms):', Date.now() - t0);
  const l2 = await inbox(page); console.log(l2);
  check('Neue Mail erscheint', l2.some((x) => x.startsWith('Neu dazu')));
  check('Gelesen-Status übernommen', l2.length === 3 && l2.every((x) => x.endsWith('|R')));
  // Löschen auf dem Server
  await imap(async (c) => { const u = (await c.search({ subject: 'Rechnung' }, { uid: true })); await c.messageDelete(u, { uid: true }); });
  await doRefresh(page);
  const l3 = await inbox(page); console.log(l3);
  check('Gelöschte Mail verschwindet', l3.length === 2 && !l3.some((x) => x.startsWith('Rechnung')));
  // Ungelesen setzen
  await imap(async (c) => { await c.messageFlagsRemove({ all: true }, ['\\Seen']); });
  await doRefresh(page);
  check('Ungelesen übernommen', (await inbox(page)).every((x) => x.endsWith('|U')));
  // Mail öffnen
  await page.click('.row[data-key]'); await sleep(1500);
  check('Mail öffnet', (await page.locator('body').innerText()).includes('Hallo'));
  await page.screenshot({ path: 'shot-laden.png' });
  await app.close();
  // Neustart: aus Ablage, dann Abgleich
  ({ app, page } = await launch(D));
  await page.keyboard.press('Escape');
  await page.waitForSelector('.row[data-key]', { timeout: 20000 });
  await imap(async (c) => { await c.append('INBOX', raw('Nach Neustart'), []); });
  await doRefresh(page);
  const l4 = await inbox(page); console.log(l4);
  check('Nach Neustart neue Mail', l4.length === 3 && l4.some((x) => x.startsWith('Nach Neustart')));
  await app.close();
  console.log(fail ? `FEHLER: ${fail}` : 'ALLE TESTS OK');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
