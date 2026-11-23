// 3.2.40: Regel-Aktion „Kopie ablegen in“ – Kopie in einen Ordner eines (auch anderen) Kontos, Original bleibt im Posteingang,
// nur einmal ($SMCopied), auch über „jetzt anwenden“, Felder copyAccount/copyTo im Formular und im Sync-Dokument.
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
// Zwei Konten auf demselben Testserver (hoodiecrow hat ein gemeinsames Postfach): „vorstand“ hat die Regel, „ortie“ bekommt die Kopie
const accOrtie = { displayName: 'ortie', email: 'ortie@test.local', username: 'ortie@test.local', imapHost: '127.0.0.1', imapPort: 1143, smtpHost: '127.0.0.1', smtpPort: 2525 };
const accVorstand = { displayName: 'Vorstand', email: 'vorstand@test.local', username: 'ortie@test.local', imapHost: '127.0.0.1', imapPort: 1143, smtpHost: '127.0.0.1', smtpPort: 2525 };
const TARGET = 'PWFN Fernwärme';
let fail = 0; const check = (name, ok, info) => { console.log(ok ? 'OK  ' : 'FAIL', name, ok || info === undefined ? '' : `→ ${info}`); if (!ok) fail++; };
const imap = async (fn) => {
  const c = new ImapFlow({ host: '127.0.0.1', port: 1143, secure: false, auth: { user: 'ortie@test.local', pass: 'geheim' }, logger: false });
  await c.connect(); try { return await fn(c); } finally { await c.logout(); }
};
const append = (raw, flags = []) => imap((c) => c.append('INBOX', raw, flags));
const mail = (from, subject, to = 'vorstand@test.local') => `From: Absender <${from}>\r\nTo: ${to}\r\nSubject: ${subject}\r\nDate: ${new Date().toUTCString()}\r\nMessage-ID: <${Math.random().toString(36).slice(2)}@x>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHallo Vorstand.\r\n`;
const box = (p) => imap(async (c) => {
  const lock = await c.getMailboxLock(p);
  const out = [];
  try { for await (const m of c.fetch('1:*', { envelope: true, flags: true })) out.push({ subject: m.envelope.subject, flags: [...m.flags] }); } catch { /* leer */ } finally { lock.release(); }
  return out;
});
const syncDoc = () => imap(async (c) => {
  const b = (await c.list()).find((f) => f.name === 'SimpleMail-Sync');
  if (!b) return null;
  await c.mailboxOpen(b.path);
  let last = null;
  for await (const m of c.fetch('1:*', { source: true })) last = m.source;
  const p = await simpleParser(last);
  return JSON.parse(p.attachments.find((a) => /sync\.json$/.test(a.filename)).content.toString());
});
const reload = async (page) => { await page.evaluate(() => refresh()); await sleep(3000); };

(async () => {
  await imap((c) => c.mailboxCreate(TARGET));
  const A = path.join(__dirname, 'data-kopie-a');
  fs.rmSync(A, { recursive: true, force: true });
  let { app, page } = await launch(A);
  await page.evaluate(async ([a, b]) => {
    await api.call('accounts:save', a, 'geheim');
    await api.call('accounts:save', b, 'geheim');
    S.settings.sync = { enabled: true, accountEmail: 'ortie@test.local' };
    await saveSettings({ sync: false });
  }, [accOrtie, accVorstand]);
  await app.close();
  ({ app, page } = await launch(A));
  await page.keyboard.press('Escape');
  await page.waitForSelector('#sidebar .side-item[data-drop-path="INBOX"]', { timeout: 20000 });
  check(`Version ${require('../app/package.json').version}`, (await app.evaluate(({ app: a }) => a.getVersion())) === require('../app/package.json').version);

  // Regel im Formular: Konto vorstand, Empfänger vorstand@, Kopie → ortie / PWFN Fernwärme
  await page.evaluate(() => openSettings({ tab: 'rules' })); await sleep(500);
  await page.click('[data-x="ru-new"]'); await sleep(400);
  await page.fill('#ru-name', 'Vorstand → PWFN');
  await page.selectOption('#ru-account', 'vorstand@test.local'); await sleep(500);
  await page.selectOption('.rule-cond [data-k="field"]', 'to');
  await page.fill('.rule-cond [data-k="value"]', 'vorstand@test.local');
  check('Ordnerauswahl erst nach Kontowahl aktiv', await page.$eval('#ru-copy', (e) => e.disabled));
  await page.selectOption('#ru-copy-acc', 'ortie@test.local'); await sleep(1200);
  const opts = await page.$$eval('#ru-copy option', (os) => os.map((o) => o.value));
  check('Ordner des Zielkontos zur Auswahl', opts.includes(TARGET), opts.join(' | '));
  await page.selectOption('#ru-copy', TARGET); await sleep(800);
  const rule = await page.evaluate(() => liveRules()[0]);
  check('copyAccount/copyTo gespeichert', rule.actions.copyAccount === 'ortie@test.local' && rule.actions.copyTo === TARGET && !rule.actions.moveTo, JSON.stringify(rule.actions));
  await page.screenshot({ path: path.join(__dirname, 'shot-kopie.png') });
  await page.keyboard.press('Escape'); await sleep(300);
  await reload(page);

  await append(mail('kasse@pwfn.example', 'Sitzung Fernwärme'));
  await append(mail('bob@example.com', 'Privat', 'ortie@test.local'));
  await sleep(1000); await reload(page); await sleep(2500);

  let inbox = await box('INBOX');
  let copy = await box(TARGET);
  check('Original bleibt im Posteingang', inbox.some((m) => m.subject === 'Sitzung Fernwärme'), inbox.map((m) => m.subject).join(' | '));
  check('Kopie im Ordner „PWFN Fernwärme“', copy.filter((m) => m.subject === 'Sitzung Fernwärme').length === 1, copy.map((m) => m.subject).join(' | '));
  check('nicht passende Mail nicht kopiert', !copy.some((m) => m.subject === 'Privat'));
  check('Kopie ungelesen wie das Original', copy.some((m) => m.subject === 'Sitzung Fernwärme' && !m.flags.includes('\\Seen')));
  check('Original trägt $SMCopied', inbox.some((m) => m.subject === 'Sitzung Fernwärme' && m.flags.includes('$SMCopied')));

  // erneut abrufen + „jetzt anwenden“ → keine zweite Kopie; ältere passende Mail wird dabei nachgeholt
  await append(mail('alt@pwfn.example', 'Altes Protokoll'), ['$Dummy']);
  await page.evaluate(() => api.call('rules:run')); await sleep(2500);
  await reload(page);
  copy = await box(TARGET);
  check('keine doppelte Kopie', copy.filter((m) => m.subject === 'Sitzung Fernwärme').length === 1, copy.map((m) => m.subject).join(' | '));
  check('„jetzt anwenden“ kopiert vorhandene Mail', copy.filter((m) => m.subject === 'Altes Protokoll').length === 1);
  inbox = await box('INBOX');
  check('Originale weiter im Posteingang', ['Sitzung Fernwärme', 'Altes Protokoll'].every((s) => inbox.some((m) => m.subject === s)));

  await page.evaluate(async () => { await runSync(); }); await sleep(1500);
  const doc = await syncDoc();
  check('Sync-Dokument enthält copyAccount/copyTo', doc && Object.values(doc.rules || {}).some((r) => r.actions && r.actions.copyTo === TARGET && r.actions.copyAccount === 'ortie@test.local'));

  await page.evaluate(() => openSettings({ tab: 'rules' })); await sleep(1200);
  check('Formular zeigt gespeicherte Kopie-Einstellung', (await page.inputValue('#ru-copy-acc')) === 'ortie@test.local' && (await page.inputValue('#ru-copy')) === TARGET);

  await app.close();
  console.log(fail ? `\n${fail} FEHLER` : '\nAlle Prüfungen bestanden');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL Abbruch', e); process.exit(1); });
