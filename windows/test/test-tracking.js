// 3.2.42: Tracking-Schutz – Zählpixel und Tracker-Bilder werden entfernt (auch nach „Bilder laden“),
// externe Inhalte bleiben ohne Freigabe gesperrt, Bilder laden ohne Cookies/Referrer mit allgemeiner Kennung,
// Hinweis „X Tracker blockiert“, „Absender immer vertrauen“ landet im Sync-Dokument, Links ohne utm_*.
const { _electron } = require('playwright-core');
const fs = require('fs'); const path = require('path'); const http = require('http');
const { ImapFlow } = require(path.resolve(__dirname, '../app/node_modules/imapflow'));
const security = require(path.resolve(__dirname, '../app/security.js'));
const APP = path.resolve(__dirname, '../app');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0; const check = (name, ok) => { console.log(ok ? 'OK  ' : 'FAIL', name); if (!ok) fail++; };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

(async () => {
  // Bildserver, der jede Anfrage mit Kopfzeilen protokolliert und ein Cookie setzt
  const hits = [];
  const srv = http.createServer((req, res) => {
    hits.push({ url: req.url, cookie: req.headers.cookie || '', referer: req.headers.referer || '', ua: req.headers['user-agent'] || '' });
    res.writeHead(200, { 'Content-Type': 'image/png', 'Set-Cookie': 'tid=abc123; Path=/; Max-Age=3600', 'Cache-Control': 'no-store' });
    res.end(PNG);
  }).listen(8765, '127.0.0.1');
  const B = 'http://127.0.0.1:8765';

  // Reine Logik aus security.js (gleich wie Mac Privacy.swift)
  check('cleanLinkUrl entfernt utm_* und fbclid', security.cleanLinkUrl('https://shop.example/p?id=7&utm_source=nl&utm_campaign=x&fbclid=1#a') === 'https://shop.example/p?id=7#a');
  check('cleanLinkUrl lässt normale Links unverändert', security.cleanLinkUrl('https://shop.example/p?id=7&page=2') === 'https://shop.example/p?id=7&page=2');
  check('isTrackerUrl: Mailchimp-Öffnungspixel', security.isTrackerUrl('https://shop.us1.list-manage.com/track/open.php?u=1'));
  check('isTrackerUrl: SendGrid /wf/open', security.isTrackerUrl('https://u123.ct.sendgrid.net/wf/open?upn=x'));
  check('isTrackerUrl: normales Logo nicht', !security.isTrackerUrl('https://cdn.shop.example/img/logo.png'));

  const html = `<p>Neuigkeiten</p>
<img id="logo" src="${B}/logo.png" width="120" height="40" alt="Logo">
<img src="${B}/px.gif?u=42" width="1" height="1" alt="">
<img src="${B}/track/open.php?u=42" alt="">
<img src="${B}/hidden.png" style="display:none">
<div style="background-image:url('${B}/e/o/abc')">x</div>
<a id="lnk" href="https://shop.example/angebot?id=5&utm_source=newsletter" ping="${B}/ping">Angebot</a>`;
  const c = new ImapFlow({ host: '127.0.0.1', port: 1143, secure: false, auth: { user: 'ortie@test.local', pass: 'geheim' }, logger: false });
  await c.connect();
  const t = Date.now();
  await c.append('INBOX', [`From: Shop <news@shop.example>`, 'To: ortie@test.local', 'Subject: Newsletter Tracking', `Date: ${new Date(t).toUTCString()}`,
    `Message-ID: <trk.${t}@x>`, 'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8', '', html].join('\r\n'), []);
  await c.logout();

  const D = path.join(__dirname, 'data-tracking'); fs.rmSync(D, { recursive: true, force: true });
  const launch = async () => {
    const app = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox'], env: { ...process.env, SIMPLEMAIL_DATA: D } });
    const page = await app.firstWindow();
    page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
    await page.waitForLoadState('domcontentloaded');
    return { app, page };
  };
  let { app, page } = await launch();
  await page.evaluate(async () => { await api.call('accounts:save', { displayName: 'Ortie', email: 'ortie@test.local', username: 'ortie@test.local', imapHost: '127.0.0.1', imapPort: 1143, smtpHost: '127.0.0.1', smtpPort: 2525 }, 'geheim'); });
  await app.close();
  ({ app, page } = await launch());
  await page.keyboard.press('Escape');
  check(`Version ${require('../app/package.json').version}`, (await app.evaluate(({ app: a }) => a.getVersion())) === require('../app/package.json').version);
  await page.waitForFunction(() => Object.values(S.inbox).flat().some((m) => m.subject === 'Newsletter Tracking'), null, { timeout: 20000 });
  await sleep(500);
  await page.evaluate(() => selectMessage(keyOf(Object.values(S.inbox).flat().find((m) => m.subject === 'Newsletter Tracking'))));
  await page.waitForSelector('.privacy-banner', { timeout: 10000 });
  await sleep(1500);

  // 1) Ohne Freigabe: nichts geladen, Hinweis mit Trackerzahl
  const b1 = await page.textContent('.privacy-banner');
  check('Hinweis „Externe Inhalte blockiert“', /Externe Inhalte blockiert/.test(b1));
  check('Hinweis zählt 4 Tracker', /4 Tracker blockiert/.test(b1));
  check('Knöpfe „Bilder laden“ und „Absender immer vertrauen“', !!(await page.$('[data-act="images-once"]')) && !!(await page.$('[data-act="images-always"]')));
  check('Ohne Freigabe keine Anfrage an fremde Server', hits.length === 0);
  await page.screenshot({ path: path.join(__dirname, 'shot-tracking-gesperrt.png') });

  // 2) „Bilder laden“: nur das Logo, ohne Cookie/Referrer, allgemeine Kennung
  await page.click('[data-act="images-once"]');
  await sleep(2500);
  const urls = hits.map((h) => h.url);
  check('Logo geladen', urls.includes('/logo.png'));
  check('Kein Zählpixel / Tracker / verstecktes Bild geladen', !urls.some((u) => /px\.gif|track\/open|hidden|\/e\/o\/|ping/.test(u)));
  check('Kein Referrer gesendet', hits.every((h) => !h.referer));
  check('Programmkennung verborgen (kein Electron/SimpleMail im User-Agent)', hits.length > 0 && hits.every((h) => !/electron|simplemail/i.test(h.ua)));
  const b2 = await page.textContent('.privacy-banner');
  check('Nach Freigabe Hinweis „4 Tracker blockiert“', /4 Tracker blockiert/.test(b2) && !/Externe Inhalte blockiert/.test(b2));
  const frameInfo = await page.frames().find((f) => f !== page.mainFrame() && f.parentFrame() === page.mainFrame())
    .evaluate(() => ({ imgs: document.images.length, ping: !!document.querySelector('[ping]'), logoW: (document.getElementById('logo') || {}).naturalWidth || 0 }));
  check('Im Mailtext nur noch das Logo als Bild', frameInfo.imgs === 1 && frameInfo.logoW === 1);
  check('ping-Attribut entfernt', !frameInfo.ping);
  await page.screenshot({ path: path.join(__dirname, 'shot-tracking.png') });

  // 3) Cookie aus der ersten Antwort wird nicht zurückgeschickt
  const before = hits.length;
  await page.evaluate(() => renderDetail(true));
  await sleep(2000);
  check('Zweiter Abruf', hits.length > before);
  check('Kein Cookie zurückgeschickt', hits.every((h) => !h.cookie));
  const jar = await app.evaluate(async ({ session }) => (await session.defaultSession.cookies.get({})).length);
  check('Kein Cookie gespeichert', jar === 0);

  // 4) Webrequest-Sperre: Tracker-URL wird auch ohne HTML-Prüfung nicht abgerufen
  const n0 = hits.length;
  await page.evaluate((u) => new Promise((r) => { const i = new Image(); i.onload = i.onerror = () => r(); i.src = u; }), `${B}/track/open.php?direct=1`);
  await sleep(500);
  check('Direkter Abruf einer Tracker-URL gesperrt', !hits.slice(n0).some((h) => /direct=1/.test(h.url)));

  // 5) Absender immer vertrauen → Sync-Dokument
  await page.evaluate(() => { S.imagesAllowed.clear(); renderDetail(true); });
  await sleep(500);
  if (await page.$('[data-act="images-always"]')) { await page.click('[data-act="images-always"]'); await sleep(800); }
  const st = await page.evaluate(() => api.call('settings:get'));
  check('Absender als vertraut gespeichert', !!(st.trusted && st.trusted['news@shop.example'] && !st.trusted['news@shop.example'].deleted));
  const b3 = await page.textContent('.privacy-banner').catch(() => '');
  check('Vertrauter Absender: Inhalte geladen, Tracker weiter blockiert', /4 Tracker blockiert/.test(b3) && !/Externe Inhalte blockiert/.test(b3));

  // 6) Link-Bereinigung beim Öffnen
  await app.evaluate(({ shell }) => { global.__opened = []; shell.openExternal = async (u) => { global.__opened.push(u); }; });
  await page.evaluate(() => api.call('app:openExternal', 'https://shop.example/angebot?id=5&utm_source=newsletter&mc_eid=9'));
  const opened = await app.evaluate(() => global.__opened);
  check('Geöffneter Link ohne Tracking-Parameter', opened[0] === 'https://shop.example/angebot?id=5');

  await app.close();
  srv.close();
  console.log(fail ? `${fail} FEHLER` : 'ALLE OK');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
