// 3.2.45: Zwei Entwürfe-Ordner (WEB.DE: „Entwürfe“ mit \Drafts + zusätzlicher „Drafts“) → Entwurf landet im vom Server markierten
const { _electron } = require('playwright-core');
const fs = require('fs'); const path = require('path');
const hoodiecrow = require('hoodiecrow-imap');
const { ImapFlow } = require(path.resolve(__dirname, '../app/node_modules/imapflow'));
const APP = path.resolve(__dirname, '../app');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 1147;
const msg = 'From: Alice <alice@example.com>\r\nTo: ortie@test.local\r\nSubject: Hallo\r\nDate: Mon, 10 Nov 2026 09:00:00 +0100\r\nMessage-ID: <a1@x>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nTest\r\n';
const server = hoodiecrow({
  plugins: ['IDLE', 'UIDPLUS', 'MOVE', 'SPECIAL-USE', 'LITERALPLUS', 'ENABLE', 'ID', 'UNSELECT', 'NAMESPACE'],
  users: { 'ortie@test.local': { password: 'geheim' } },
  storage: { INBOX: { messages: [{ raw: msg, flags: [] }] }, '': { separator: '/', folders: {
    Drafts: {}, 'Entw&APw-rfe': { 'special-use': '\\Drafts' }, Gesendet: { 'special-use': '\\Sent' }, Sent: {}, Trash: { 'special-use': '\\Trash' } } } },
});
let fail = 0; const check = (name, ok) => { console.log(ok ? 'OK  ' : 'FAIL', name); if (!ok) fail++; };
const count = async (box) => {
  const c = new ImapFlow({ host: '127.0.0.1', port: PORT, secure: false, auth: { user: 'ortie@test.local', pass: 'geheim' }, logger: false });
  await c.connect();
  try { const s = await c.status(box, { messages: true }); return s.messages; } finally { await c.logout(); }
};
(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const D = '/tmp/smEO'; fs.rmSync(D, { recursive: true, force: true });
  const launch = async () => {
    const app = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox'], env: { ...process.env, SIMPLEMAIL_DATA: D } });
    const page = await app.firstWindow(); page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
    await page.waitForLoadState('domcontentloaded'); await sleep(1500); return { app, page };
  };
  let { app, page } = await launch();
  await page.evaluate(async () => { await api.call('accounts:save', { displayName: 'Ortie', email: 'ortie@test.local', username: 'ortie@test.local', imapHost: '127.0.0.1', imapPort: 1147, smtpHost: '127.0.0.1', smtpPort: 2525 }, 'geheim'); });
  await app.close();
  ({ app, page } = await launch());
  await page.keyboard.press('Escape');
  await page.waitForSelector('.row[data-key]', { timeout: 20000 });
  await sleep(1000);
  check(`Version ${require('../app/package.json').version}`, (await app.evaluate(({ app: a }) => a.getVersion())) === require('../app/package.json').version);
  const id = await page.evaluate(() => S.accounts[0].id);
  const special = await page.evaluate((i) => api.call('mail:special', i), id);
  check('Entwürfe-Ordner = „Entwürfe“ (\\Drafts), nicht „Drafts“', special.drafts === 'Entwürfe');
  check('Gesendet-Ordner = „Gesendet“ (\\Sent), nicht „Sent“', special.sent === 'Gesendet');
  await page.evaluate((i) => api.call('mail:saveDraft', { accountId: i, to: 'x@web.example', subject: 'Ordnertest', body: 'Hallo' }), id);
  await sleep(800);
  check('Entwurf liegt in „Entwürfe“', (await count('Entwürfe')) === 1 && (await count('Drafts')) === 0);
  await page.evaluate(() => loadFolders());
  await sleep(500);
  check('Seitenleiste „Entwürfe“ zeigt „Entwürfe“', (await page.evaluate((i) => roleFolderOf(i, 'drafts'), id)) === 'Entwürfe');
  await app.close(); server.close();
  console.log(fail ? `${fail} FEHLER` : 'ALLES OK');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
