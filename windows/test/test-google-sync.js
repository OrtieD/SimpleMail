// 3.2.31: Google-Kalender-Zugangsschlüssel (Client-ID + Clientschlüssel) werden über das Sync-Dokument
// an andere Windows-PCs übertragen (prefs.googleCalendar); die Anmeldung selbst (Refresh-Token) bleibt je PC.
// Google wird durch einen kleinen Attrappen-Server ersetzt (SIMPLEMAIL_GOOGLE_AUTH/TOKEN/API).
const { _electron } = require('playwright-core');
const http = require('http');
const fs = require('fs'); const path = require('path');
const { ImapFlow } = require(path.resolve(__dirname, '../app/node_modules/imapflow'));
const { simpleParser } = require(path.resolve(__dirname, '../app/node_modules/mailparser'));
const APP = path.resolve(__dirname, '../app');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0; const check = (name, ok) => { console.log(ok ? 'OK  ' : 'FAIL', name); if (!ok) fail++; };

// ---- Google-Attrappe
const GPORT = 18791;
const tokens = [];   // { grant_type, client_id, client_secret }
let rtCounter = 0;
const gserver = http.createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${GPORT}`);
  if (u.pathname === '/auth') {
    const back = `${u.searchParams.get('redirect_uri')}/?code=c${Date.now()}&state=${u.searchParams.get('state')}`;
    res.writeHead(302, { Location: back }); res.end(); return;
  }
  if (u.pathname === '/token') {
    let body = ''; req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const p = Object.fromEntries(new URLSearchParams(body));
      tokens.push(p);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const idt = `x.${Buffer.from(JSON.stringify({ email: 'ortie@gmail.com' })).toString('base64')}.y`;
      res.end(JSON.stringify({ access_token: 'at', expires_in: 3600, refresh_token: `rt-geheim-${++rtCounter}`, id_token: idt }));
    });
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ items: [] }));
});

const ENV = { SIMPLEMAIL_GOOGLE_AUTH: `http://127.0.0.1:${GPORT}/auth`, SIMPLEMAIL_GOOGLE_TOKEN: `http://127.0.0.1:${GPORT}/token`,
  SIMPLEMAIL_GOOGLE_API: `http://127.0.0.1:${GPORT}/api` };
async function launch(dir) {
  const app = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox'], env: { ...process.env, ...ENV, SIMPLEMAIL_DATA: dir } });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.waitForLoadState('domcontentloaded'); await sleep(1500);
  // Browser-Anmeldung simulieren: Auth-URL abrufen, Weiterleitung landet beim lokalen Rückleitungs-Server der App
  await app.evaluate(({ shell }) => { shell.openExternal = async (u) => { fetch(u).catch(() => {}); }; });
  return { app, page };
}
const acc = { displayName: 'Ortie', email: 'ortie@test.local', username: 'ortie@test.local', imapHost: '127.0.0.1', imapPort: 1143, smtpHost: '127.0.0.1', smtpPort: 2525 };
const imap = async (fn) => {
  const c = new ImapFlow({ host: '127.0.0.1', port: 1143, secure: false, auth: { user: 'ortie@test.local', pass: 'geheim' }, logger: false });
  await c.connect(); try { return await fn(c); } finally { await c.logout(); }
};
const syncDocRaw = () => imap(async (c) => {
  const box = (await c.list()).find((f) => f.name === 'SimpleMail-Sync');
  if (!box) return null;
  await c.mailboxOpen(box.path);
  let last = null;
  for await (const m of c.fetch('1:*', { source: true })) last = m.source;
  const p = await simpleParser(last);
  return p.attachments.find((a) => /sync\.json$/.test(a.filename)).content.toString();
});
const setupPc = async (page) => page.evaluate(async (a) => {
  await api.call('accounts:save', a, 'geheim');
  S.settings.sync = { enabled: true, accountEmail: 'ortie@test.local' };
  await saveSettings({ sync: false });
}, acc);
const sync = async (page) => { await page.evaluate(async () => { await refresh(); await runSync(); }); await sleep(800); };
const status = (page) => page.evaluate(() => api.call('google:status'));

(async () => {
  await new Promise((r) => gserver.listen(GPORT, '127.0.0.1', r));
  const A = path.join(__dirname, 'data-gsync-a'); const B = path.join(__dirname, 'data-gsync-b');
  for (const d of [A, B]) fs.rmSync(d, { recursive: true, force: true });

  // 1) PC A: verbinden mit Client-ID + Schlüssel, synchronisieren
  let { app, page } = await launch(A);
  await setupPc(page);
  await sleep(1500);
  const r1 = await page.evaluate(() => api.call('google:connect', 'test-client.apps.googleusercontent.com', 'GOCSPX-alt'));
  check('PC A mit Google verbunden', r1 && r1.email === 'ortie@gmail.com');
  await sync(page);
  let raw = await syncDocRaw();
  let doc = raw && JSON.parse(raw);
  console.log('prefs.googleCalendar', JSON.stringify(doc && doc.prefs.googleCalendar));
  check('Sync-Dokument enthält Client-ID + Schlüssel', doc && doc.prefs.googleCalendar && doc.prefs.googleCalendar.value.clientId === 'test-client.apps.googleusercontent.com'
    && doc.prefs.googleCalendar.value.clientSecret === 'GOCSPX-alt' && doc.prefs.googleCalendar.updatedAt > 1);
  check('Refresh-Token NICHT im Sync-Dokument', !/rt-geheim/.test(raw) && !/refreshToken/.test(raw));
  await app.close();

  // 2) PC B: nur Konto + Sync → Schlüssel kommen an, Anmeldung fehlt noch
  ({ app, page } = await launch(B));
  await setupPc(page);
  await sleep(1500);
  await sync(page);
  let st = await status(page);
  check('PC B hat Client-ID übernommen', st.clientId === 'test-client.apps.googleusercontent.com' && st.hasSecret === true);
  check('PC B ist noch nicht angemeldet (Token gerätebezogen)', st.connected === false);
  // Einstellungen → Kalender zeigt Hinweis + vorausgefüllte Client-ID
  await page.evaluate(() => openSettings({ tab: 'calendar' }));
  await sleep(500);
  const ui = await page.evaluate(() => {
    const t = [...document.querySelectorAll('[data-tab], .tabs button, .settings-tabs *')].find((x) => /Kalender/.test(x.textContent || '') && x.children.length === 0);
    if (t && !document.querySelector('#g-id')) t.click();
    return null;
  });
  await sleep(400);
  const form = await page.evaluate(() => ({ id: (document.querySelector('#g-id') || {}).value, ph: (document.querySelector('#g-secret') || {}).placeholder, hint: !!document.querySelector('#g-saved') }));
  console.log('Formular', JSON.stringify(form), ui);
  check('Formular: Client-ID vorausgefüllt, Schlüssel „gespeichert“, Hinweis', form.id === 'test-client.apps.googleusercontent.com' && /gespeichert/.test(form.ph || '') && form.hint);
  await page.screenshot({ path: path.join(__dirname, 'shot-google-sync.png') });
  // Verbinden mit leerem Schlüsselfeld → gespeicherter Schlüssel wird verwendet
  tokens.length = 0;
  await page.fill('#g-secret', '');
  await page.click('[data-x="g-connect"]');
  for (let i = 0; i < 40 && !(await status(page)).connected; i++) await sleep(150);
  st = await status(page);
  check('PC B: nur „Mit Google verbinden“ → verbunden', st.connected === true && st.email === 'ortie@gmail.com');
  // 3.2.32: auch verbunden sind Client-ID und Schlüssel in den Einstellungen sichtbar
  await page.evaluate(() => { document.querySelector('.overlay [data-x="close"]')?.click(); openSettings({ tab: 'calendar' }); });
  await sleep(500);
  const shown = await page.evaluate(() => ({ id: (document.querySelector('#g-id-show') || {}).value, sec: (document.querySelector('#g-secret-show') || {}).value }));
  check('Verbunden: Client-ID + Schlüssel sichtbar', shown.id === 'test-client.apps.googleusercontent.com' && !!shown.sec);
  await page.screenshot({ path: path.join(__dirname, 'shot-google-verbunden.png') });
  check('PC B: synchronisierter Schlüssel an Google gesendet', tokens.some((t) => t.grant_type === 'authorization_code' && t.client_secret === 'GOCSPX-alt'));
  await sync(page);
  await app.close();

  // 3) PC A: neuer Schlüssel (gleiche Client-ID) → PC B übernimmt ihn und bleibt angemeldet
  ({ app, page } = await launch(A));
  await sleep(1500);
  await page.evaluate(() => api.call('google:connect', 'test-client.apps.googleusercontent.com', 'GOCSPX-neu'));
  await sync(page);
  doc = JSON.parse(await syncDocRaw());
  check('Neuer Schlüssel im Sync-Dokument', doc.prefs.googleCalendar.value.clientSecret === 'GOCSPX-neu');
  await app.close();

  ({ app, page } = await launch(B));
  await sleep(1500);
  await sync(page);
  st = await status(page);
  check('PC B bleibt bei gleicher Client-ID angemeldet', st.connected === true);
  tokens.length = 0;
  await page.evaluate(() => api.call('google:reconnect'));
  check('PC B nutzt danach den neuen Schlüssel', tokens.some((t) => t.client_secret === 'GOCSPX-neu'));
  await app.close();

  // 4) PC A: andere Client-ID → PC B muss sich neu anmelden (Token gehört zum alten Client)
  ({ app, page } = await launch(A));
  await sleep(1500);
  await page.evaluate(() => api.call('google:connect', 'anderer-client.apps.googleusercontent.com', 'GOCSPX-x'));
  await sync(page);
  await app.close();
  ({ app, page } = await launch(B));
  await sleep(1500);
  await sync(page);
  st = await status(page);
  check('PC B: andere Client-ID übernommen, Anmeldung zurückgesetzt', st.clientId === 'anderer-client.apps.googleusercontent.com' && st.connected === false && st.hasSecret);
  // Mac-Felder bleiben im Dokument (unbekannte prefs werden durchgereicht)
  doc = JSON.parse(await syncDocRaw());
  check('Dokument enthält weiter googleCalendar nach Abgleich von B', doc.prefs.googleCalendar.value.clientId === 'anderer-client.apps.googleusercontent.com');
  await app.close();

  gserver.close();
  console.log(fail ? `\n${fail} FEHLER` : '\nALLES OK');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
