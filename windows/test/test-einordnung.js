// Prüft (3.2.20): Kategorie-Einteilung, Neu-Einordnung alter Kopfdaten, Kontakte → Persönlich (auch googlemail = gmail),
// gelesen bleibt trotz parallelem Abruf, Ordner öffnet sofort bzw. ohne auf den Gesamtabruf zu warten, DMARC p=none
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
const acc = { displayName: 'ortie', email: 'ortie@test.local', username: 'ortie@test.local', imapHost: '127.0.0.1', imapPort: 1143, smtpHost: '127.0.0.1', smtpPort: 2525 };
let fail = 0; const check = (name, ok, info) => { console.log(ok ? 'OK  ' : 'FAIL', name, ok || info === undefined ? '' : JSON.stringify(info)); if (!ok) fail++; };
const imap = async (fn) => {
  const c = new ImapFlow({ host: '127.0.0.1', port: 1143, secure: false, auth: { user: 'ortie@test.local', pass: 'geheim' }, logger: false });
  await c.connect(); try { return await fn(c); } finally { await c.logout(); }
};
const mail = (from, name, subj, extra = '') => `From: ${name} <${from}>\r\nTo: ortie@test.local\r\nSubject: ${subj}\r\n${extra}Date: Thu, 13 Nov 2026 12:00:00 +0100\r\nMessage-ID: <${Math.random().toString(36).slice(2)}@x>\r\n\r\nText\r\n`;
const settle = (page) => page.evaluate(async () => { await refresh(); while (S.loading || S.pending) await new Promise((r) => setTimeout(r, 50)); });
const UNSUB = 'List-Unsubscribe: <https://shop.example/abmelden>\r\n';
(async () => {
  await imap(async (c) => {
    await c.mailboxCreate('Projekte').catch(() => {});
    await c.append('Projekte', mail('alice@example.com', 'Alice', 'Projekt A'), []);
    await c.append('INBOX', mail('info@shop.example', 'Shop', 'Ihre Bestellung wurde versandt', UNSUB), []);
    await c.append('INBOX', mail('info@shop.example', 'Shop', 'Herbst-Angebote für Sie', UNSUB), []);
    await c.append('INBOX', mail('mitglieder@verein.example', 'Verein', 'Rundbrief November', 'List-Id: <verein.example>\r\n'), []);
    await c.append('INBOX', mail('no-reply@bank.example', 'Bank', 'Neuer Kontoauszug'), []);
    await c.append('INBOX', mail('walter.noreplyfan@example.com', 'Walter', 'Hallo'), []);
    await c.append('INBOX', mail('max.muster@googlemail.com', 'Max', 'Fotos vom Wochenende', UNSUB), []);
    await c.append('INBOX', mail('carla@example.com', 'Carla', 'Mittagessen?',
      'Authentication-Results: mx.google.com; dmarc=fail (p=NONE sp=NONE dis=NONE) header.from=example.com\r\n'), []);
  });
  const D = path.join(__dirname, 'data-einordnung'); fs.rmSync(D, { recursive: true, force: true });
  let { app, page } = await launch(D);
  await page.evaluate(async (a) => { await api.call('accounts:save', a, 'geheim'); }, acc);
  // Kontakt mit gmail.com-Adresse – die Mail kommt von googlemail.com
  await page.evaluate(async () => {
    S.settings.contacts = [{ id: 'k1', name: 'Max', emails: ['max.muster@gmail.com'], phones: [], updatedAt: Date.now() }];
    await saveSettings({ sync: false });
  });
  await app.close();
  ({ app, page } = await launch(D));
  await page.keyboard.press('Escape');
  await page.waitForSelector('.row[data-key]', { timeout: 20000 });
  check(`Version ${require('../app/package.json').version} (package.json = App)`, (await app.evaluate(({ app: a }) => a.getVersion())) === require('../app/package.json').version);
  await settle(page);
  const cats = await page.evaluate(() => Object.fromEntries(allInbox().map((m) => [m.subject, m.category])));
  check('Versandmail mit Abmelde-Link → Benachrichtigung', cats['Ihre Bestellung wurde versandt'] === 'notification', cats);
  check('Werbung mit Abmelde-Link → Newsletter', cats['Herbst-Angebote für Sie'] === 'newsletter');
  check('Verteiler (List-Id) → Newsletter', cats['Rundbrief November'] === 'newsletter');
  check('no-reply → Benachrichtigung', cats['Neuer Kontoauszug'] === 'notification');
  check('„noreply“ nur als eigenes Wort vor dem @ (walter.noreplyfan) → Persönlich', cats['Hallo'] === 'personal');
  check('Kontakt (gmail.com) schreibt von googlemail.com → Persönlich trotz Abmelde-Link', cats['Fotos vom Wochenende'] === 'personal');
  check('Normale Mail → Persönlich', cats['Treffen morgen'] === 'personal');
  check('DMARC p=none ist kein Spam (Stufe mittel)', cats['Mittagessen?'] === 'personal');

  // Alte Kopfdaten (ohne Kategorie-Version, falsch eingeordnet) werden einmal neu eingeordnet
  await app.close();
  const cacheRoot = path.join(D, 'cache');
  let patched = 0;
  for (const d of fs.readdirSync(cacheRoot)) {
    const f = path.join(cacheRoot, d, 'headers.json');
    if (!fs.existsSync(f)) continue;
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!j.messages.some((m) => m.subject === 'Neuer Kontoauszug')) continue;
    for (const m of j.messages) { m.category = 'newsletter'; delete m.catVersion; }
    fs.writeFileSync(f, JSON.stringify(j)); patched++;
  }
  check('Testvorbereitung: Kopfdaten-Ablage verändert', patched === 1);
  ({ app, page } = await launch(D));
  await page.keyboard.press('Escape');
  await settle(page);
  const cats2 = await page.evaluate(() => Object.fromEntries(allInbox().map((m) => [m.subject, m.category])));
  check('Nach dem Abruf neu eingeordnet', cats2['Treffen morgen'] === 'personal' && cats2['Neuer Kontoauszug'] === 'notification', cats2);

  // Gelesen bleibt gelesen, obwohl ein Abruf vor dem Speichern auf dem Server begann
  const res = await page.evaluate(async () => {
    S.view = { type: 'unread' }; renderAll();
    const m = allInbox().find((x) => x.subject === 'Treffen morgen');
    const r = refresh();             // Abruf läuft schon (liefert noch „ungelesen“)
    S.selected = keyOf(m);
    await loadBody(m);               // Mail öffnen → gelesen
    await r;
    while (S.loading || S.pending) await new Promise((x) => setTimeout(x, 50));
    const afterRefresh = findMessage(keyOf(m)).isRead;
    S.view = { type: 'smart' }; renderAll();
    S.view = { type: 'unread' }; S.selected = null; renderAll();
    const inUnread = visibleMessages().some((x) => keyOf(x) === keyOf(m));
    return { afterRefresh, inUnread };
  });
  check('Geöffnete Mail bleibt nach parallelem Abruf gelesen', res.afterRefresh === true, res);
  check('… und ist nach Verlassen nicht mehr in „Ungelesen“', res.inUnread === false, res);
  const seenOnServer = await imap(async (c) => {
    await c.mailboxOpen('INBOX');
    for await (const m of c.fetch('1:*', { envelope: true, flags: true })) if (m.envelope.subject === 'Treffen morgen') return m.flags.has('\\Seen');
    return null;
  });
  check('Gelesen-Status liegt auf dem Server', seenOnServer === true);

  // Posteingang eines Kontos erscheint sofort; anderer Ordner wartet nicht auf den Gesamtabruf
  const inst = await page.evaluate(() => {
    const acc = S.accounts[0].id;
    const el = document.createElement('div');
    el.dataset.act = 'view'; el.dataset.view = JSON.stringify({ type: 'folder', acc, path: 'INBOX' });
    document.body.appendChild(el); el.click(); el.remove();
    return S.folderMsgs.length;
  });
  check('Posteingang des Kontos sofort gefüllt', inst > 5, inst);
  const folderRes = await page.evaluate(async () => {
    const acc = S.accounts[0].id;
    S.loading = true;   // Gesamtabruf läuft (künstlich)
    const el = document.createElement('div');
    el.dataset.act = 'view'; el.dataset.view = JSON.stringify({ type: 'folder', acc, path: 'Projekte' });
    document.body.appendChild(el); el.click(); el.remove();
    const t = Date.now();
    while (!S.folderMsgs.length && Date.now() - t < 8000) await new Promise((x) => setTimeout(x, 50));
    S.loading = false;
    return S.folderMsgs.map((m) => m.subject);
  });
  check('Ordner lädt, obwohl ein Gesamtabruf läuft', folderRes.includes('Projekt A'), folderRes);

  await app.close();
  console.log(fail ? `${fail} FEHLER` : 'ALLES OK');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
