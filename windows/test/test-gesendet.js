// 3.2.24: Gesendete Mail landet in „Gesendet“, Versandprotokoll versand.log, sichtbare Meldung wenn das Ablegen scheitert
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
const acc = { displayName: 'Ortie', email: 'ortie@test.local', username: 'ortie@test.local', imapHost: '127.0.0.1', imapPort: 1143, smtpHost: '127.0.0.1', smtpPort: 2525 };
let fail = 0; const check = (name, ok) => { console.log(ok ? 'OK  ' : 'FAIL', name); if (!ok) fail++; };
const imap = async (fn) => {
  const c = new ImapFlow({ host: '127.0.0.1', port: 1143, secure: false, auth: { user: 'ortie@test.local', pass: 'geheim' }, logger: false });
  await c.connect(); try { return await fn(c); } finally { await c.logout(); }
};
const subjectsIn = (box) => imap(async (c) => {
  const out = [];
  const lock = await c.getMailboxLock(box);
  try { for await (const m of c.fetch('1:*', { envelope: true })) out.push(m.envelope.subject); } catch { /* leer */ } finally { lock.release(); }
  return out;
});
(async () => {
  const D = '/tmp/smG'; fs.rmSync(D, { recursive: true, force: true });
  let { app, page } = await launch(D);
  await page.evaluate(async (a) => { await api.call('accounts:save', a, 'geheim'); }, acc);
  await app.close();
  ({ app, page } = await launch(D));
  await page.keyboard.press('Escape');
  await page.waitForSelector('.row[data-key]', { timeout: 20000 });
  await sleep(1500);
  check(`Version ${require('../app/package.json').version} (package.json = App)`, (await app.evaluate(({ app: a }) => a.getVersion())) === require('../app/package.json').version);
  const accountId = await page.evaluate(() => S.accounts[0].id);

  // 1) Normal senden → Kopie in „Sent“, Protokoll mit SMTP-Antwort
  await page.evaluate(async (id) => { await api.call('mail:send', { accountId: id, to: 'freund@web.example', subject: 'Test Gesendet 1', body: 'Hallo' }); }, accountId);
  await sleep(1500);
  check('Kopie liegt in Gesendet', (await subjectsIn('Sent')).includes('Test Gesendet 1'));
  let log = fs.readFileSync(path.join(D, 'versand.log'), 'utf8');
  check('versand.log: OK SMTP + Empfänger', /OK SMTP: 250.*Gesendet-Kopie: Sent/.test(log) && /an: freund@web\.example/.test(log));
  check('versand.log: Message-ID, kein Inhalt', /<[^>]+@test\.local>/.test(log) && !/Hallo/.test(log));
  check('Keine Fehlermeldung', !(await page.evaluate(() => S.error)));

  // 2) Gesendet-Ordner verschwindet auf dem Server → Ablegen scheitert → sichtbare Meldung + Protokoll
  await imap(async (c) => { await c.mailboxRename('Sent', 'Weg'); });
  await page.evaluate(async (id) => { await api.call('mail:send', { accountId: id, to: 'freund@web.example', subject: 'Test Gesendet 2', body: 'Hallo' }); }, accountId);
  await sleep(1500);
  const err = await page.evaluate(() => S.error || '');
  check('Meldung „nicht in Gesendet abgelegt“', /gesendet, aber nicht in „Gesendet“ abgelegt/.test(err) && /freund@web\.example/.test(err));
  const statusText = await page.evaluate(() => document.body.innerText);
  check('Meldung ist sichtbar', /nicht in „Gesendet“ abgelegt/.test(statusText));
  log = fs.readFileSync(path.join(D, 'versand.log'), 'utf8');
  check('versand.log: FEHLGESCHLAGEN vermerkt', /Gesendet-Kopie FEHLGESCHLAGEN/.test(log));

  // 3) SMTP-Fehler → Fehler geht an den Editor, Protokoll vermerkt ihn
  await page.evaluate(async () => { const a = S.accounts[0]; await api.call('accounts:save', { ...a, smtpPort: 2599 }, ''); });
  await sleep(500);
  const smtpErr = await page.evaluate(async (id) => { try { await api.call('mail:send', { accountId: id, to: 'x@web.example', subject: 'Test 3', body: 'x' }); return ''; } catch (e) { return e.message || String(e); } }, accountId);
  check('SMTP-Fehler wird gemeldet', !!smtpErr);
  log = fs.readFileSync(path.join(D, 'versand.log'), 'utf8');
  check('versand.log: FEHLER SMTP', /FEHLER SMTP/.test(log));
  await page.screenshot({ path: path.join(__dirname, 'shot-gesendet.png') });
  await app.close();
  console.log(fail ? `${fail} FEHLER` : 'ALLES OK');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
