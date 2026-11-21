// Prüft: Strg+F fokussiert das Suchfeld, Tippen filtert lokal, Enter durchsucht alle Ordner
// (Posteingang, Gesendet, eigene Ordner; nicht Papierkorb) und zeigt den Ordnernamen
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
const mail = (from, subj, body, d, id) => [`From: ${from}`, 'To: ortie@test.local', `Subject: ${subj}`, `Date: ${d}`,
  `Message-ID: <${id}@x>`, 'Content-Type: text/plain; charset=utf-8', '', body].join('\r\n');
const rows = (page) => page.$$eval('#list .row[data-key]', (r) => r.map((x) => x.innerText));
(async () => {
  await imap(async (c) => {
    await c.mailboxCreate('Projekte');
    await c.append('INBOX', mail('Ina <ina@x.example>', 'Posteingang-Treffer', 'Das Zauberwort steht hier.', 'Wed, 12 Nov 2026 09:00:00 +0100', 'in1'), []);
    await c.append('Sent', mail('Ortie <ortie@test.local>', 'Gesendet-Treffer', 'Auch hier: Zauberwort.', 'Thu, 13 Nov 2026 09:00:00 +0100', 'se1'), ['\\Seen']);
    await c.append('Projekte', mail('Paul <paul@x.example>', 'Projekt-Treffer', 'Zauberwort im Projektordner', 'Fri, 14 Nov 2026 09:00:00 +0100', 'pr1'), ['\\Seen']);
    await c.append('Trash', mail('Tom <tom@x.example>', 'Papierkorb-Treffer', 'Zauberwort im Papierkorb', 'Fri, 14 Nov 2026 10:00:00 +0100', 'tr1'), ['\\Seen']);
  });
  const D = '/tmp/smS'; fs.rmSync(D, { recursive: true, force: true });
  let { app, page } = await launch(D);
  await page.evaluate(async (a) => { await api.call('accounts:save', a, 'geheim'); }, acc);
  await app.close();
  ({ app, page } = await launch(D));
  await page.keyboard.press('Escape');
  await page.waitForSelector('.row[data-key]', { timeout: 20000 });
  await sleep(2500);
  check(`Version ${require('../app/package.json').version} (package.json = App)`, (await app.evaluate(({ app: a }) => a.getVersion())) === require('../app/package.json').version);
  check('Suchfeld sichtbar', await page.isVisible('#search'));
  check('Platzhalter nennt Strg+F', /Strg\+F/.test(await page.getAttribute('#search', 'placeholder')));
  // 3.2.30: Suchfeld größer, größere Schrift, gelb hervorgehoben
  const look = await page.evaluate(() => {
    const box = document.querySelector('.search'); const inp = document.querySelector('#search');
    return { h: box.getBoundingClientRect().height, fs: parseFloat(getComputedStyle(inp).fontSize), bg: getComputedStyle(box).backgroundColor };
  });
  console.log('Suchfeld:', JSON.stringify(look));
  check('Suchfeld mind. 36 px hoch', look.h >= 36);
  check('Suchschrift mind. 15 px', look.fs >= 15);
  check('Suchfeld gelblich hinterlegt', (() => { const m = look.bg.match(/\d+/g).map(Number); return m[0] > m[2] + 20 && m[1] > m[2] + 10; })());

  await page.click('#list'); await page.keyboard.press('Control+f'); await sleep(200);
  check('Strg+F fokussiert Suchfeld', await page.evaluate(() => document.activeElement && document.activeElement.id === 'search'));

  // lokales Filtern nach Absender
  await page.keyboard.type('Alice'); await sleep(500);
  let r = await rows(page);
  check('Tippen filtert lokal (Alice)', r.length === 1 && /Alice/.test(r[0]));

  // Serversuche (Text) über alle Ordner
  await page.fill('#search', ''); await page.type('#search', 'Zauberwort'); await sleep(300);
  check('Lokal kein Treffer im Text vor Enter', (await rows(page)).length === 0);
  await page.press('#search', 'Enter');
  await page.waitForFunction(() => !document.querySelector('#list .info') || !/Suche läuft/.test(document.querySelector('#list').innerText), null, { timeout: 30000 }).catch(() => {});
  await sleep(1500);
  r = await rows(page);
  const all = r.join('\n');
  console.log(r.map((x) => x.replace(/\s+/g, ' ')).join('\n'));
  check('Treffer Posteingang', /Posteingang-Treffer/.test(all));
  check('Treffer Gesendet', /Gesendet-Treffer/.test(all));
  check('Treffer eigener Ordner', /Projekt-Treffer/.test(all));
  check('Kein Treffer Papierkorb', !/Papierkorb-Treffer/.test(all));
  check('Ordnername bei Projekt-Treffer', r.some((x) => /Projekt-Treffer/.test(x) && /Projekte/.test(x)));
  check('Kopfzeile „in allen Ordnern“', /Suchergebnisse in allen Ordnern \(3\)/.test(await page.innerText('#list')));

  // Treffer öffnen
  await page.locator('#list .row[data-key]', { hasText: 'Projekt-Treffer' }).click(); await sleep(1500);
  check('Treffer aus Ordner öffnet sich', /Zauberwort im Projektordner/.test(await page.evaluate(() => {
    const f = document.querySelector('.body-frame'); return (f && f.contentDocument && f.contentDocument.body.innerText) || document.body.innerText; })));

  // Esc leert
  await page.focus('#search'); await page.keyboard.press('Escape'); await sleep(500);
  check('Esc leert Suche', (await page.inputValue('#search')) === '' && !/Suchergebnisse/.test(await page.innerText('#list')));
  await app.close();
  console.log(fail ? `${fail} FEHLER` : 'ALLE OK');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
