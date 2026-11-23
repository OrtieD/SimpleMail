// 3.2.39: Regel-Aktion „Weiterleiten an“ – echte Weiterleitung über das SMTP des Kontos (WG:, Original als .eml),
// Schleifenschutz (X-SimpleMail-Forwarded, eigene Konten, Ziele, Mailer-Daemon), Doppelt-Schutz ($SMForwarded),
// „jetzt anwenden“ leitet nicht weiter, Feld forwardTo im Formular und im Sync-Dokument.
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
const acc = { displayName: 'ortie', email: 'ortie@test.local', username: 'ortie@test.local', imapHost: '127.0.0.1', imapPort: 1143, smtpHost: '127.0.0.1', smtpPort: 2525 };
let fail = 0; const check = (name, ok, info) => { console.log(ok ? 'OK  ' : 'FAIL', name, ok || info === undefined ? '' : `→ ${info}`); if (!ok) fail++; };
const imap = async (fn) => {
  const c = new ImapFlow({ host: '127.0.0.1', port: 1143, secure: false, auth: { user: 'ortie@test.local', pass: 'geheim' }, logger: false });
  await c.connect(); try { return await fn(c); } finally { await c.logout(); }
};
const append = (raw, flags = []) => imap((c) => c.append('INBOX', raw, flags));
const mail = ({ from, name, subject, headers = [], attach = false }) => {
  const id = `<${Math.random().toString(36).slice(2)}@x>`;
  const head = [`From: ${name} <${from}>`, 'To: ortie@test.local', `Subject: ${subject}`, `Date: ${new Date().toUTCString()}`, `Message-ID: ${id}`, ...headers, 'MIME-Version: 1.0'];
  if (!attach) return head.join('\r\n') + '\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHallo Ortie,\r\nbitte prüfen.\r\n';
  return head.join('\r\n') + '\r\nContent-Type: multipart/mixed; boundary="b1"\r\n\r\n--b1\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHallo Ortie,\r\nanbei die Rechnung.\r\n'
    + '--b1\r\nContent-Type: application/pdf; name="rechnung.pdf"\r\nContent-Disposition: attachment; filename="rechnung.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\nJVBERi0xLjQK\r\n--b1--\r\n';
};
const sentMails = () => imap(async (c) => {
  const lock = await c.getMailboxLock('Sent');
  const out = [];
  try { for await (const m of c.fetch('1:*', { source: true })) out.push(await simpleParser(m.source)); } catch { /* leer */ } finally { lock.release(); }
  return out;
});
const inboxFlags = () => imap(async (c) => {
  const lock = await c.getMailboxLock('INBOX');
  const out = {};
  try { for await (const m of c.fetch('1:*', { envelope: true, flags: true })) out[m.envelope.subject] = [...m.flags]; } finally { lock.release(); }
  return out;
});
const syncDoc = () => imap(async (c) => {
  const box = (await c.list()).find((f) => f.name === 'SimpleMail-Sync');
  if (!box) return null;
  await c.mailboxOpen(box.path);
  let last = null;
  for await (const m of c.fetch('1:*', { source: true })) last = m.source;
  const p = await simpleParser(last);
  return JSON.parse(p.attachments.find((a) => /sync\.json$/.test(a.filename)).content.toString());
});
const reload = async (page) => { await page.evaluate(() => refresh()); await sleep(3000); };

(async () => {
  const A = path.join(__dirname, 'data-weiter-a');
  fs.rmSync(A, { recursive: true, force: true });
  let { app, page } = await launch(A);
  await page.evaluate(async (a) => {
    await api.call('accounts:save', a, 'geheim');
    S.settings.sync = { enabled: true, accountEmail: 'ortie@test.local' };
    await saveSettings({ sync: false });
  }, acc);
  await app.close();
  ({ app, page } = await launch(A));
  await page.keyboard.press('Escape');
  await page.waitForSelector('#sidebar .side-item[data-drop-path="INBOX"]', { timeout: 20000 });
  check(`Version ${require('../app/package.json').version}`, (await app.evaluate(({ app: a }) => a.getVersion())) === require('../app/package.json').version);

  // Regel über das Formular anlegen
  await page.evaluate(() => openSettings({ tab: 'rules' })); await sleep(500);
  await page.click('[data-x="ru-new"]'); await sleep(400);
  check('Formular hat Feld „Weiterleiten an“', !!(await page.$('#ru-forward')));
  await page.fill('#ru-name', 'Rechnungen an Chef');
  await page.fill('.rule-cond [data-k="value"]', 'Rechnung');
  await page.selectOption('.rule-cond [data-k="field"]', 'subject');
  await page.fill('#ru-forward', 'Chef <chef@example.com>, ortie@test.local');
  await sleep(800);
  const rule = await page.evaluate(() => liveRules()[0]);
  check('forwardTo gespeichert', rule && rule.actions.forwardTo === 'Chef <chef@example.com>, ortie@test.local', JSON.stringify(rule && rule.actions));
  check('settings.json enthält forwardTo', JSON.parse(fs.readFileSync(path.join(A, 'settings.json'), 'utf8')).rules.some((r) => r.actions && r.actions.forwardTo));
  await page.screenshot({ path: path.join(__dirname, 'shot-weiterleiten.png') });
  await page.keyboard.press('Escape'); await sleep(300);
  await reload(page);   // Grundstand für „neu seit letztem Abruf“

  // Neue Mails
  await append(mail({ from: 'buchhaltung@lieferant.example', name: 'Lieferant GmbH', subject: 'Rechnung 42', attach: true }));
  await append(mail({ from: 'chef@example.com', name: 'Chef', subject: 'WG: Rechnung 42', headers: ['X-SimpleMail-Forwarded: 1'] }));
  await append(mail({ from: 'ortie@test.local', name: 'ortie', subject: 'Rechnung von mir selbst' }));
  await append(mail({ from: 'MAILER-DAEMON@test.local', name: 'Mail Delivery', subject: 'Rechnung unzustellbar' }));
  await append(mail({ from: 'x@lieferant.example', name: 'Lieferant', subject: 'Rechnung schon erledigt' }), ['$SMForwarded']);
  await append(mail({ from: 'y@lieferant.example', name: 'Lieferant', subject: 'Rechnung zurück', headers: ['X-SimpleMail-Forwarded: abc'] }));
  await append(mail({ from: 'bob@example.com', name: 'Bob', subject: 'Mittagessen' }));
  await sleep(1500);
  await reload(page); await sleep(2000);

  let sent = await sentMails();
  const fw = sent.filter((m) => /^WG: /.test(m.subject || ''));
  check('genau eine Weiterleitung', fw.length === 1, fw.map((m) => m.subject).join(' | '));
  const f = fw[0];
  if (f) {
    check('Betreff „WG: Rechnung 42“', f.subject === 'WG: Rechnung 42', f.subject);
    check('An nur chef@example.com (eigene Adresse entfernt)', f.to && f.to.value.map((x) => x.address).join(',') === 'chef@example.com', f.to && f.to.text);
    check('Absender = Konto', f.from && f.from.value[0].address === 'ortie@test.local');
    check('Kopfzeile X-SimpleMail-Forwarded', !!f.headers.get('x-simplemail-forwarded'));
    check('Auto-Submitted gesetzt', f.headers.get('auto-submitted') === 'auto-generated');
    check('Text enthält Kopfblock + Originaltext', /Weitergeleitete Nachricht/.test(f.text) && /Von: .*buchhaltung@lieferant\.example/.test(f.text) && /anbei die Rechnung/.test(f.text), f.text);
    const eml = f.attachments.find((a) => a.filename === 'Originalnachricht.eml');
    check('Original als .eml angehängt', !!eml && /message\/rfc822/.test(eml.contentType));
    check('.eml enthält PDF-Anhang', !!eml && /rechnung\.pdf/.test(eml.content.toString()));
  }
  const flags = await inboxFlags();
  check('Original trägt $SMForwarded', (flags['Rechnung 42'] || []).includes('$SMForwarded'), JSON.stringify(flags['Rechnung 42']));
  const log = fs.readFileSync(path.join(A, 'versand.log'), 'utf8');
  check('Versandprotokoll: an chef@example.com', /an: chef@example\.com .*OK SMTP/.test(log), log);

  // Nochmals abrufen + „jetzt anwenden“ → keine zweite Weiterleitung
  await reload(page);
  const run = await page.evaluate(() => api.call('rules:run'));
  await sleep(2000);
  sent = await sentMails();
  check('kein zweites Mal weitergeleitet', sent.filter((m) => /^WG: /.test(m.subject || '')).length === 1);
  check('„jetzt anwenden“ meldet: nicht weitergeleitet', /nicht weitergeleitet/.test(run.report), run.report);

  // Sync-Dokument
  await page.evaluate(async () => { await runSync(); }); await sleep(1500);
  const doc = await syncDoc();
  check('Sync-Dokument enthält forwardTo', doc && Object.values(doc.rules || {}).some((r) => r.actions && r.actions.forwardTo === 'Chef <chef@example.com>, ortie@test.local'));

  // Feld leeren → keine Weiterleitung mehr
  await page.evaluate(() => openSettings({ tab: 'rules' })); await sleep(500);
  check('Formular zeigt gespeicherte Adresse', (await page.inputValue('#ru-forward')) === 'Chef <chef@example.com>, ortie@test.local');
  await page.fill('#ru-forward', ''); await sleep(800);
  await page.keyboard.press('Escape'); await sleep(300);
  await append(mail({ from: 'z@lieferant.example', name: 'Lieferant', subject: 'Rechnung 43' }));
  await sleep(1000); await reload(page); await sleep(1500);
  sent = await sentMails();
  check('leeres Feld: keine Weiterleitung', !sent.some((m) => m.subject === 'WG: Rechnung 43'));

  await app.close();
  console.log(fail ? `\n${fail} FEHLER` : '\nAlle Prüfungen bestanden');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL Abbruch', e); process.exit(1); });
