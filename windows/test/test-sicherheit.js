// Prüft die Sicherheits-Korrekturen 3.2.10: Anhänge (getarnte Programme, Makros, Mark of the Web),
// IPC nur von eigenen Seiten, Navigation, Programmpfade, STARTTLS-Pflicht, Sync-Downgrade, Signatur-Filter
const { _electron } = require('playwright-core');
const fs = require('fs'); const path = require('path'); const os = require('os');
const { ImapFlow } = require(path.resolve(__dirname, '../app/node_modules/imapflow'));
const APP = path.resolve(__dirname, '../app');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function launch(dir) {
  const app = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox'],
    env: { ...process.env, SIMPLEMAIL_DATA: dir, SIMPLEMAIL_MOTW_TEST: '1' } });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.waitForLoadState('domcontentloaded'); await sleep(1500);
  return { app, page };
}
const acc = { displayName: 'ortie', email: 'ortie@test.local', username: 'ortie@test.local', imapHost: '127.0.0.1', imapPort: 1143, smtpHost: '127.0.0.1', smtpPort: 2525 };
let fail = 0; const check = (name, ok) => { console.log(ok ? 'OK  ' : 'FAIL', name); if (!ok) fail++; };
const imap = async (fn) => {
  const c = new ImapFlow({ host: '127.0.0.1', port: 1143, secure: false, auth: { user: 'ortie@test.local', pass: 'geheim' }, logger: false });
  await c.connect(); try { return await fn(c); } finally { await c.logout(); }
};
(async () => {
  const b64 = (s) => Buffer.from(s).toString('base64');
  const part = (name, type) => [`--B`, `Content-Type: ${type}; name="${name}"`, `Content-Disposition: attachment; filename="${name}"`,
    'Content-Transfer-Encoding: base64', '', b64('MZ fake'), ''];
  const raw = ['From: Mallory <mallory@example.com>', 'To: ortie@test.local', 'Subject: Ihre Rechnung',
    'Date: Thu, 13 Nov 2026 12:00:00 +0100', `Message-ID: <sec.${Date.now()}@x>`, 'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="B"', '', '--B', 'Content-Type: text/plain; charset=utf-8', '', 'Siehe Anhang.', '',
    ...part('rechnung.exe ', 'application/octet-stream'), ...part('mahnung.exe.', 'application/octet-stream'),
    ...part('beleg‮fdp.exe', 'application/octet-stream'), ...part('Makro.docm', 'application/vnd.ms-word.document.macroEnabled.12'),
    ...part('Vertrag.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), '--B--', ''].join('\r\n');
  await imap((c) => c.append('INBOX', raw, []));

  const D = path.join(__dirname, 'data-sicherheit'); fs.rmSync(D, { recursive: true, force: true });
  let { app, page } = await launch(D);
  await page.evaluate(async (a) => { await api.call('accounts:save', a, 'geheim'); }, acc);
  await app.close();
  ({ app, page } = await launch(D));
  await app.evaluate(({ shell }) => { global.opened = []; shell.openPath = async (p) => { global.opened.push(p); return ''; }; });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.row[data-key]', { timeout: 20000 });
  await page.evaluate(async () => { while (S.loading || S.pending) await new Promise((r) => setTimeout(r, 50)); });
  await page.locator('.row[data-key]', { hasText: 'Ihre Rechnung' }).first().click();
  await page.waitForSelector('[data-act="att-open"]', { timeout: 15000 });
  const atts = await page.evaluate(() => S.bodies[S.selected].attachments.map((a) => ({ key: a.key, filename: a.filename, risk: a.risk })));
  console.log(JSON.stringify(atts.map((a) => [a.filename, a.risk])));
  const by = (re) => atts.find((a) => re.test(a.filename));
  check('„rechnung.exe “ → Name bereinigt, als Programm gesperrt', by(/^rechnung/).filename === 'rechnung.exe' && by(/^rechnung/).risk === 'blocked');
  check('„mahnung.exe.“ → gesperrt', by(/^mahnung/).filename === 'mahnung.exe' && by(/^mahnung/).risk === 'blocked');
  check('Richtungszeichen U+202E entfernt, gesperrt', by(/^beleg/).filename === 'belegfdp.exe' && by(/^beleg/).risk === 'blocked');
  check('Makro.docm → Rückfrage', by(/docm$/).risk === 'dangerous');
  check('Vertrag.docx → unbedenklich', by(/docx$/).risk === '');

  // gesperrt: auch mit „bestätigt“ kein Öffnen, kein Öffnen mit anderer App
  const err = async (ch, key, ...rest) => page.evaluate(async ([c, k, r]) => { try { await api.call(c, k, ...r); return 'geöffnet'; } catch (e) { return e.message; } }, [ch, key, rest]);
  check('Programm: attachment:open trotz Bestätigung abgelehnt', /nicht direkt/.test(await err('attachment:open', by(/^rechnung/).key, true)));
  check('Programm: openWithOther abgelehnt', /nicht direkt/.test(await err('attachment:openWithOther', by(/^mahnung/).key, true)));
  check('Makro ohne Bestätigung abgelehnt', /nicht bestätigt/.test(await err('attachment:open', by(/docm$/).key, false)));
  check('Kein Programm gestartet', (await app.evaluate(() => global.opened)).length === 0);
  // Klick im Fenster: Hinweis statt Öffnen
  await page.locator('[data-act="att-open"]', { hasText: 'rechnung.exe' }).click(); await sleep(500);
  const dlg = await page.evaluate(() => (document.querySelector('.overlay') || {}).textContent || '');
  check('Klick auf Programm zeigt Hinweis „Sichern unter“', /Programm oder Skript/.test(dlg) && /Sichern unter/.test(dlg));
  await page.keyboard.press('Escape'); await sleep(300);
  check('… und öffnet nichts', (await app.evaluate(() => global.opened)).length === 0);
  await page.locator('[data-act="att-open"]', { hasText: 'rechnung.exe' }).click({ button: 'right' }); await sleep(400);
  const menu = await page.$$eval('#menu .mi', (m) => m.map((x) => x.textContent));
  check('Rechtsklick auf Programm: nur „Sichern unter …“', menu.length === 1 && /Sichern unter/.test(menu[0]));
  await page.evaluate(() => hideMenu());

  // unbedenklicher Anhang: geöffnet, mit Mark of the Web
  await page.locator('[data-act="att-open"]', { hasText: 'Vertrag.docx' }).click(); await sleep(800);
  const opened = await app.evaluate(() => global.opened);
  const docx = opened.find((p) => p.endsWith('Vertrag.docx'));
  check('DOCX geöffnet', !!docx);
  check('Mark of the Web (ZoneId=3) gesetzt', !!docx && /ZoneId=3/.test(fs.readFileSync(docx + '.Zone.Identifier', 'utf8')));
  // Sichern unter: ebenfalls markiert
  const out = path.join(os.tmpdir(), `sm-save-${Date.now()}.docx`);
  await app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }); }, out);
  await page.evaluate((k) => api.call('attachment:save', k), by(/docx$/).key);
  check('Gesicherte Datei markiert', fs.existsSync(out + '.Zone.Identifier'));

  // Temp-Aufräumen: alte Ordner verschwinden
  const oldDir = path.join(os.tmpdir(), 'SimpleMail', 'alt-test'); fs.mkdirSync(oldDir, { recursive: true });
  const past = new Date(Date.now() - 3 * 24 * 3600e3); fs.utimesSync(oldDir, past, past);
  await app.close();
  ({ app, page } = await launch(D)); await sleep(6000);
  check('Alte Temp-Kopien nach Start gelöscht', !fs.existsSync(oldDir));

  // IPC: Mail-Fenster darf nur seine Kanäle
  await page.keyboard.press('Escape');
  await page.waitForSelector('.row[data-key]', { timeout: 20000 });
  await page.locator('.row[data-key]', { hasText: 'Ihre Rechnung' }).first().click();
  await page.waitForSelector('[data-act="att-open"]', { timeout: 15000 });
  await page.evaluate(() => openInWindow(findMessage(S.selected)));
  const viewer = await app.waitForEvent('window', { timeout: 10000 });
  await viewer.waitForSelector('[data-att]', { timeout: 10000 });
  const vr = await viewer.evaluate(async () => { try { await window.api.call('settings:get'); return 'erlaubt'; } catch (e) { return e.message; } });
  check('Mail-Fenster: settings:get abgelehnt', vr === 'Nicht erlaubt.');
  const vr2 = await viewer.evaluate(async () => { try { await window.api.call('accounts:list'); return 'erlaubt'; } catch (e) { return e.message; } });
  check('Mail-Fenster: accounts:list abgelehnt', vr2 === 'Nicht erlaubt.');
  await viewer.close();

  // Programmpfad lässt sich nicht frei setzen
  await page.evaluate(async () => { const st = await api.call('settings:get'); st.appPaths = { word: '/bin/sh', evil: '/bin/sh' }; await api.call('settings:set', st); });
  const st = await page.evaluate(() => api.call('settings:get'));
  check('settings:set ignoriert untergeschobenen Programmpfad', !st.appPaths || !st.appPaths.word);

  // Signatur aus dem Sync wird gefiltert angezeigt
  await page.evaluate(async (a) => {
    const cur = S.accounts.find((x) => x.email === a.email);
    await api.call('accounts:save', { ...cur, signatureHtml: '<b>Ortie</b><img src="x" onerror="alert(1)"><iframe srcdoc="<script>alert(2)</script>"></iframe><a href=" javascript:alert(3)">x</a>' }, '');
    S.accounts = await api.call('accounts:list');
    openSettings({ tab: 'accounts' });
  }, acc);
  await page.waitForSelector('#f-sig'); await sleep(300);
  const sig = await page.$eval('#f-sig', (e) => e.innerHTML);
  console.log('Signatur:', sig);
  check('Signatur ohne onerror/iframe/javascript:', /<b>Ortie<\/b>/.test(sig) && !/onerror|iframe|javascript/i.test(sig));
  await page.keyboard.press('Escape');

  // STARTTLS: Server ohne STARTTLS auf nicht-lokaler Adresse → Verbindung wird abgelehnt
  const ip = (Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal) || {}).address;
  if (ip) {
    const r = await page.evaluate(async (a) => { try { await api.call('accounts:test', a, 'geheim'); return 'verbunden'; } catch (e) { return e.message; } }, { ...acc, imapHost: ip });
    console.log('STARTTLS:', r);
    check(`IMAP ohne STARTTLS über ${ip}:1143 abgelehnt`, r !== 'verbunden');
    const r2 = await page.evaluate(async (a) => { try { await api.call('accounts:test', a, 'geheim'); return 'verbunden'; } catch (e) { return e.message; } }, acc);
    check('Lokaler Server (127.0.0.1) weiter erreichbar', r2 === 'verbunden');
  } else console.log('(keine Netzadresse – STARTTLS-Test übersprungen)');

  // Sync: mit Passwort wird ein untergeschobenes unverschlüsseltes Dokument ignoriert
  await page.evaluate(async () => { S.settings.sync = { enabled: true, accountEmail: 'ortie@test.local' }; await api.call('settings:set', S.settings); });
  await page.evaluate(() => api.call('sync:setPassphrase', 'Sync-Geheim-123'));
  const box = await imap(async (c) => (await c.list()).find((f) => f.name === 'SimpleMail-Sync').path);
  const fake = { format: 1, accounts: { 'neu@boese.example': { email: 'neu@boese.example', imapHost: 'imap.boese.example', imapPort: 993,
    smtpHost: 'smtp.boese.example', smtpPort: 465, allowInvalidCerts: true, updatedAt: Date.now() + 1e6 } },
  snippets: {}, rules: {}, contacts: {}, snoozes: {}, trusted: { 'mallory@example.com': { deleted: false, updatedAt: Date.now() + 1e6 } }, blocked: {},
  prefs: { blockImages: { value: false, updatedAt: Date.now() + 1e6 } } };
  const syncRaw = ['From: ortie@test.local', 'To: ortie@test.local', 'Subject: SimpleMail Sync – bitte nicht löschen', 'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="S"', '', '--S', 'Content-Type: text/plain', '', 'x', '', '--S',
    'Content-Type: application/json; name="simplemail-sync.json"', 'Content-Disposition: attachment; filename="simplemail-sync.json"', '',
    JSON.stringify(fake), '', '--S--', ''].join('\r\n');
  await imap((c) => c.append(box, syncRaw, ['\\Seen']));
  const sr = await page.evaluate(() => api.call('sync:now'));
  console.log('Sync:', JSON.stringify(sr));
  const st3 = await page.evaluate(() => api.call('settings:get'));
  const accs = await page.evaluate(() => api.call('accounts:list'));
  check('Untergeschobener vertrauter Absender nicht übernommen', !(st3.trusted || {})['mallory@example.com']);
  check('Bildersperre nicht abgeschaltet', st3.blockImages !== false);
  check('Untergeschobenes Konto nicht angelegt', !accs.some((a) => a.email === 'neu@boese.example'));
  const latest = await imap(async (c) => { const l = await c.getMailboxLock(box); try { const m = await c.fetchOne('*', { source: true }); return m.source.toString(); } finally { l.release(); } });
  check('Sync-Ordner enthält wieder verschlüsselten Stand', /simplemailEncrypted/.test(Buffer.from((latest.split('\r\n\r\n').pop() || ''), 'base64').toString() + latest));

  // Navigation auf fremde lokale Datei wird verhindert
  const evil = path.join(os.tmpdir(), 'sm-evil.html'); fs.writeFileSync(evil, '<h1>evil</h1>');
  await page.evaluate((u) => { location.href = u; }, 'file://' + evil).catch(() => {});
  await sleep(800);
  check('Hauptfenster bleibt auf eigener Seite', /renderer\/index\.html$/.test(page.url()));

  check(`Version ${require('../app/package.json').version} (package.json = App)`, (await app.evaluate(({ app: a }) => a.getVersion())) === require('../app/package.json').version);
  await app.close();
  console.log(fail ? `FEHLER: ${fail}` : 'ALLE TESTS OK');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
