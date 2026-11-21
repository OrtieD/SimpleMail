// Prüft (3.2.19): Liste ersetzt beim Öffnen/Auswählen nur geänderte Zeilen, „Später“ funktioniert mit dem
// neuen Index, Suche filtert nach Tipp-Pause; misst die Dauer typischer Aktionen bei vielen Mails.
const { _electron } = require('playwright-core');
const fs = require('fs'); const path = require('path');
const { ImapFlow } = require(path.resolve(__dirname, '../app/node_modules/imapflow'));
const APP = path.resolve(__dirname, process.env.SM_APP || '../app');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function launch(dir) {
  const app = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox'], env: { ...process.env, SIMPLEMAIL_DATA: dir } });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.waitForLoadState('domcontentloaded'); await sleep(1500);
  // 3.2.28: Smart Inbox klappt Benachrichtigungen/Newsletter ein – dieser Test erwartet alle Zeilen
  await page.evaluate(() => { try { localStorage.setItem('simplemail.expandedGroups', '["notification","newsletter"]'); } catch {} if (window.S) { S.expandedGroups = new Set(['notification', 'newsletter']); } }).catch(() => {});
  return { app, page };
}
const acc = { displayName: 'Ortie', email: 'ortie@test.local', username: 'ortie@test.local', imapHost: '127.0.0.1', imapPort: 1143, smtpHost: '127.0.0.1', smtpPort: 2525 };
let fail = 0; const check = (name, ok) => { console.log(ok ? 'OK  ' : 'FAIL', name); if (!ok) fail++; };
const N = 600;
const names = ['Anna Alt', 'Bernd Bau', 'Clara Chor', 'Dieter Dach', 'Eva Esch', 'Frank Fink', 'Gabi Gans', 'Hans Hut'];
(async () => {
  const c = new ImapFlow({ host: '127.0.0.1', port: 1143, secure: false, auth: { user: 'ortie@test.local', pass: 'geheim' }, logger: false });
  await c.connect();
  for (let i = 0; i < N; i++) {
    const d = new Date(Date.UTC(2026, 9, 1) + i * 3600e3).toUTCString().replace('GMT', '+0000');
    const n = names[i % names.length];
    const list = i % 3 === 0 ? 'List-Id: <news.example>\r\n' : '';
    await c.append('INBOX', `From: ${n} <${n.split(' ')[0].toLowerCase()}@x.example>\r\nTo: ortie@test.local\r\nSubject: Nachricht ${i}\r\nDate: ${d}\r\nMessage-ID: <m${i}@x>\r\n${list}Content-Type: text/plain; charset=utf-8\r\n\r\nText ${i}`, i % 4 ? ['\\Seen'] : []);
  }
  await c.logout();
  const D = '/tmp/smF'; fs.rmSync(D, { recursive: true, force: true });
  let { app, page } = await launch(D);
  await page.evaluate(async (a) => { await api.call('accounts:save', a, 'geheim'); }, acc);
  await app.close();
  ({ app, page } = await launch(D));
  await page.keyboard.press('Escape');
  await page.waitForSelector('.row[data-key]', { timeout: 30000 });
  await sleep(3000);
  const version = await app.evaluate(({ app: a }) => a.getVersion());
  console.log('Version', version);
  const count = await page.$$eval('#list .row[data-key]', (r) => r.length);
  console.log('Zeilen', count);
  check('Viele Zeilen geladen', count >= 200);

  // Zeitmessung: 20 ungelesene Mails nacheinander öffnen (synchroner Teil: Liste + Detail + gelesen markieren)
  const t = await page.evaluate(async () => {
    const keys = [...document.querySelectorAll('#list .row.unread[data-key]')].slice(0, 20).map((r) => r.dataset.key);
    const times = [];
    for (const k of keys) {
      const t0 = performance.now();
      document.querySelector(`.row[data-key="${CSS.escape(k)}"]`).click();
      times.push(performance.now() - t0);
      await new Promise((r) => setTimeout(r, 60));
    }
    const t1 = performance.now();
    for (let i = 0; i < 10; i++) renderAll();
    return { open: times.reduce((a, b) => a + b, 0) / times.length, renderAll: (performance.now() - t1) / 10 };
  });
  console.log(`Mail öffnen Ø ${t.open.toFixed(1)} ms, renderAll Ø ${t.renderAll.toFixed(1)} ms`);

  // Unveränderte Zeilen bleiben dieselben DOM-Elemente (nur geänderte werden ersetzt)
  const kept = await page.evaluate(async () => {
    const rows = [...document.querySelectorAll('#list .row[data-key]')];
    const far = rows[rows.length - 5];
    rows[3].click();
    await new Promise((r) => setTimeout(r, 300));
    const sel = document.querySelector('#list .row.selected');
    return { farStill: far.isConnected, selKey: sel && sel.dataset.key, want: rows[3].dataset.key, one: document.querySelectorAll('#list .row.selected').length };
  });
  check('Unveränderte Zeile nicht neu aufgebaut', kept.farStill);
  check('Ausgewählte Zeile markiert', kept.selKey === kept.want && kept.one === 1);
  const detail = await page.$eval('#detail', (e) => e.innerText);
  check('Detail zeigt gewählte Mail', /Nachricht \d+/.test(detail));

  // Später: Mail verschwindet aus der Smart Inbox, erscheint unter „Später“
  const sk = await page.evaluate(() => {
    const k = document.querySelectorAll('#list .row[data-key]')[5].dataset.key;
    snooze(findMessage(k), new Date(Date.now() + 3600e3));
    return k;
  });
  await sleep(300);
  check('Zurückgestellte Mail aus der Liste', !(await page.$(`#list .row[data-key="${sk}"]`)));
  const side = await page.$eval('#sidebar', (e) => e.innerText);
  check('Seitenleiste zählt „Später“ 1', /Später\s*1/.test(side));
  await page.click('.side-item[data-view*="snoozed"]');
  await sleep(300);
  check('Unter „Später“ sichtbar', !!(await page.$(`#list .row[data-key="${sk}"]`)));
  await page.evaluate((k) => unsnooze(findMessage(k)), sk);
  await sleep(300);
  check('Zurückholen leert „Später“', !(await page.$(`#list .row[data-key="${sk}"]`)));
  await page.click('.side-item[data-view*="smart"]');
  await sleep(300);
  check('Wieder in der Smart Inbox', !!(await page.$(`#list .row[data-key="${sk}"]`)));

  // Suche: schnelles Tippen filtert erst nach der Pause, dann richtig
  await page.click('#search');
  await page.keyboard.type('Nachricht 59', { delay: 20 });
  await sleep(400);
  const hits = await page.$$eval('#list .row[data-key]', (r) => r.map((x) => x.querySelector('.subject').innerText));
  check('Suche filtert (Nachricht 59…)', hits.length >= 1 && hits.every((h) => h.includes('Nachricht 59')));
  await page.keyboard.press('Escape');
  await sleep(200);
  check('Esc zeigt wieder alle', (await page.$$eval('#list .row[data-key]', (r) => r.length)) >= 200);

  // Zähler stimmen nach dem Öffnen (ungelesen weniger)
  const unread = await page.evaluate(() => sidebarCounts ? sidebarCounts().total : -1).catch(() => -1);
  const real = await page.evaluate(() => Object.values(S.inbox).flat().filter((m) => !m.isRead).length);
  if (unread >= 0) check('Zähler = tatsächlich ungelesen', unread === real);

  await app.close();
  console.log(fail ? `${fail} FEHLER` : 'ALLE OK');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
