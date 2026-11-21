// 3.2.26: Nach einem Neustart zeigten Smart Inbox und Kontoansicht nicht alle Mails – erst der direkt gewählte
// Posteingang des Kontos war vollständig. Geprüft wird:
//  1. Neue Mails, die während die App geschlossen war eingingen, erscheinen nach dem Neustart in Smart Inbox
//     und Kontoansicht, ohne den Posteingang anzuklicken.
//  2. Ein hängendes Konto (Server antwortet nicht) hält die anderen Konten nicht mehr auf.
//  3. Posteingang anklicken → Smart Inbox zeigt danach dieselben Mails.
//  4. Start ohne Server: sobald er erreichbar ist, kommen die Mails nach Sekunden (nicht erst nach 5 Minuten).
const { _electron } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path'); const net = require('net');
const { ImapFlow } = require(path.resolve(__dirname, '../app/node_modules/imapflow'));
const APP = path.resolve(__dirname, '../app');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0; const check = (name, ok) => { console.log(ok ? 'OK  ' : 'FAIL', name); if (!ok) fail++; };
async function launch(dir) {
  const app = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox'], env: { ...process.env, SIMPLEMAIL_DATA: dir } });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}
const imap = async (fn) => {
  const c = new ImapFlow({ host: '127.0.0.1', port: 1143, secure: false, auth: { user: 'ortie@test.local', pass: 'geheim' }, logger: false });
  await c.connect();
  try { return await fn(c); } finally { await c.logout(); }
};
const serverCount = () => imap(async (c) => (await c.status('INBOX', { messages: true })).messages);
const mail = (i) => `From: Neu ${i} <neu${i}@example.com>\r\nTo: ortie@test.local\r\nSubject: Neu nach Neustart ${i}\r\nDate: ${new Date(Date.now() - i * 60000).toUTCString()}\r\nMessage-ID: <neu${i}.${Date.now()}@x>\r\n\r\nHallo\r\n`;
const rows = (page) => page.$$eval('#list .row[data-key]', (rs) => rs.length);
async function waitFor(page, fn, arg, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await page.evaluate(fn, arg)) return Date.now() - t0; await sleep(200); }
  return -1;
}
const acc = (n, port) => ({ displayName: n, email: `${n}@test.local`, username: 'ortie@test.local', imapHost: '127.0.0.1', imapPort: port, smtpHost: '127.0.0.1', smtpPort: 2525 });

(async () => {
  // Server, der Verbindungen annimmt und nie antwortet (z. B. hängendes iCloud/Gmail)
  const hang = net.createServer(() => {}).listen(1144);
  const D = path.join(__dirname, 'data-neustart'); fs.rmSync(D, { recursive: true, force: true });

  // 1. Erster Start: ein Konto, Posteingang laden
  let { app, page } = await launch(D);
  await page.evaluate(async (a) => { await api.call('accounts:save', a, 'geheim'); }, acc('ortie', 1143));
  await app.close();
  ({ app, page } = await launch(D));
  await page.keyboard.press('Escape');
  check(`Version ${require('../app/package.json').version}`, (await app.evaluate(({ app: a }) => a.getVersion())) === require('../app/package.json').version);
  let n0 = await serverCount();
  check(`erster Start: ${n0} Mails geladen`, (await waitFor(page, (n) => !S.loading && Object.values(S.inbox).flat().length === n, n0, 20000)) >= 0);
  await app.close();

  // 2. Während die App zu ist: neue Mails; außerdem ein zweites, hängendes Konto (steht vorn)
  await imap(async (c) => { for (let i = 0; i < 5; i++) await c.append('INBOX', mail(i), []); });
  const n1 = await serverCount();
  const slowFirst = JSON.parse(fs.readFileSync(path.join(D, 'accounts.json'), 'utf8'));
  ({ app, page } = await launch(D));
  await page.evaluate(async (a) => { await api.call('accounts:save', a, 'geheim'); }, acc('langsam', 1144));
  await app.close();
  // hängendes Konto an die erste Stelle
  try {
    const f = path.join(D, 'accounts.json'); const list = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (Array.isArray(list)) { list.sort((a, b) => (a.email.startsWith('langsam') ? -1 : 1) - (b.email.startsWith('langsam') ? -1 : 1)); fs.writeFileSync(f, JSON.stringify(list, null, 2)); }
  } catch { /* Ablage anders aufgebaut – Reihenfolge egal */ }
  void slowFirst;

  const t0 = Date.now();
  ({ app, page } = await launch(D));
  await page.keyboard.press('Escape');
  const ortieId = await page.evaluate(() => S.accounts.find((a) => a.email.startsWith('ortie')).id);
  console.log('     Kontenreihenfolge:', await page.evaluate(() => S.accounts.map((a) => a.email).join(', ')));
  const ms = await waitFor(page, ([id, n]) => (S.inbox[id] || []).length === n, [ortieId, n1], 30000);
  check(`Neustart: Smart Inbox hat alle ${n1} Mails ohne Klick auf Posteingang (${ms} ms nach Fensterstart, ${Date.now() - t0} ms gesamt)`, ms >= 0);
  check('… trotz hängendem Konto schnell (< 8 s)', ms >= 0 && ms < 8000);
  check('… und der Gesamtabruf läuft noch (hängendes Konto)', await page.evaluate(() => S.loading));
  await sleep(300);
  check(`Smart Inbox zeigt ${n1} Zeilen`, (await rows(page)) === n1);
  await page.click(`#sidebar .account-item[data-acc="${ortieId}"]`);
  await sleep(400);
  check(`Kontoansicht zeigt ${n1} Zeilen`, (await rows(page)) === n1);
  await page.click(`#sidebar .account-item[data-acc=""]`);
  await sleep(300);

  // 3. Posteingang direkt anklicken, neue Mail kommt dabei → danach auch in der Smart Inbox
  await imap((c) => c.append('INBOX', mail(9), []));
  const n2 = await serverCount();
  await page.click(`#sidebar .side-item[data-drop-acc="${ortieId}"][data-drop-path="INBOX"]`);
  check(`Posteingang zeigt ${n2} Mails`, (await waitFor(page, (n) => S.folderMsgs.length === n, n2, 15000)) >= 0);
  await page.click('#sidebar .side-item[data-view*="smart"]').catch(async () => {
    await page.evaluate(() => { S.view = { type: 'smart' }; renderAll(); });
  });
  await sleep(400);
  check(`zurück in Smart Inbox: ebenfalls ${n2} Mails`, (await page.evaluate((id) => (S.inbox[id] || []).length, ortieId)) === n2 && (await rows(page)) === n2);
  await page.screenshot({ path: path.join(__dirname, 'shot-neustart.png') });
  await app.close();

  // 4. Start ohne Server → Server kommt nach 3 s → Mails nach wenigen Sekunden da
  const pidFile = path.join(__dirname, 'server.pid');
  if (fs.existsSync(pidFile)) {
    try { process.kill(Number(fs.readFileSync(pidFile, 'utf8'))); } catch {}
    await sleep(800);
    // nur das funktionierende Konto behalten
    ({ app, page } = await launch(D));
    await page.evaluate(async () => { for (const a of S.accounts) if (a.email.startsWith('langsam')) await api.call('accounts:remove', a.id).catch(() => {}); });
    await app.close();
    ({ app, page } = await launch(D));
    await page.keyboard.press('Escape');
    const off = await waitFor(page, () => S.offline && !S.loading, null, 15000);
    check('ohne Server: offline erkannt', off >= 0);
    const srv = spawn(process.execPath, [path.join(__dirname, 'server.js')], { cwd: __dirname, stdio: 'ignore' });
    fs.writeFileSync(pidFile, String(srv.pid));
    await sleep(1500);
    await imap(async (c) => { for (let i = 20; i < 23; i++) await c.append('INBOX', mail(i), []); });
    const n3 = await serverCount();
    const t1 = Date.now();
    const back = await waitFor(page, (n) => !S.offline && Object.values(S.inbox).flat().length === n, n3, 70000);
    check(`Server wieder da: ${n3} Mails nach ${back < 0 ? '–' : Math.round((Date.now() - t1) / 1000)} s (nicht erst nach 5 Min.)`, back >= 0 && back < 70000);
    await app.close();
    try { srv.kill(); } catch {}   // eigenen Server beenden, sonst läuft er in den nächsten Test hinein
  } else console.log('(server.pid fehlt – Offline-Start übersprungen)');
  hang.close();
  console.log(fail ? `${fail} FEHLER` : 'ALLES OK');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
