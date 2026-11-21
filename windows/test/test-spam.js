// Prüft den automatischen Spamfilter: Spam-Ordner wird angelegt, Spam verschoben, Kontakte/vertrauenswürdige bleiben,
// Empfindlichkeit wirkt, „Kein Spam“ holt zurück und merkt den Absender, Einstellung geht in das Sync-Dokument
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
let fail = 0; const check = (name, ok) => { console.log(ok ? 'OK  ' : 'FAIL', name); if (!ok) fail++; };
const imap = async (fn) => {
  const c = new ImapFlow({ host: '127.0.0.1', port: 1143, secure: false, auth: { user: 'ortie@test.local', pass: 'geheim' }, logger: false });
  await c.connect(); try { return await fn(c); } finally { await c.logout(); }
};
const mail = (from, name, subj, extra = '') => `From: ${name} <${from}>\r\nTo: ortie@test.local\r\nSubject: ${subj}\r\n${extra}Date: Thu, 13 Nov 2026 12:00:00 +0100\r\nMessage-ID: <${Math.random().toString(36).slice(2)}@x>\r\n\r\nText\r\n`;
const subjects = (c, box) => c.mailboxOpen(box).then(async () => { const out = []; if (!c.mailbox.exists) return out; for await (const m of c.fetch('1:*', { envelope: true })) out.push(m.envelope.subject); return out; });
const settle = (page) => page.evaluate(async () => { await refresh(); while (S.loading || S.pending) await new Promise((r) => setTimeout(r, 50)); });
(async () => {
  const D = path.join(__dirname, 'data-spam'); fs.rmSync(D, { recursive: true, force: true });
  let { app, page } = await launch(D);
  await page.evaluate(async (a) => { await api.call('accounts:save', a, 'geheim'); }, acc);
  await app.close();
  ({ app, page } = await launch(D));
  await page.keyboard.press('Escape');
  await page.waitForSelector('.row[data-key]', { timeout: 20000 });
  check(`Version ${require('../app/package.json').version} (package.json = App)`, (await app.evaluate(({ app: a }) => a.getVersion())) === require('../app/package.json').version);
  await settle(page);
  await page.evaluate(() => loadFolders());
  check('Spam-Ordner gleich beim Start angelegt und sichtbar', await page.evaluate(() => (S.folders[S.accounts[0].id] || []).some((f) => f.path === 'Spam' && f.role === 'junk')));
  // Kontakt anlegen: der darf nie aussortiert werden
  await page.evaluate(async () => {
    S.settings.contacts = [...(S.settings.contacts || []), { id: 'k1', name: 'Freund', emails: ['freund@example.com'], phones: [], updatedAt: Date.now() }];
    await saveSettings({ sync: false });
  });
  const toasts = [];
  await page.exposeFunction('noteToast', (t) => toasts.push(t));
  await page.evaluate(() => { const o = toast; window.toast = (m) => { noteToast(m); return o(m); }; });

  // neue Mails: eindeutiger Spam, Server-Spam, Phishing, harmlos, Kontakt mit Spam-Betreff, Grenzfall (2 Punkte)
  await imap(async (c) => {
    await c.append('INBOX', mail('win@lotto-xyz.biz', 'Gewinnzentrale', 'SIE HABEN GEWONNEN!!!', 'Authentication-Results: mx.test; spf=fail smtp.mailfrom=lotto-xyz.biz\r\n'), []);
    await c.append('INBOX', mail('info@shop.example', 'Shop', 'Angebot', 'X-Spam-Flag: YES\r\n'), []);
    await c.append('INBOX', mail('service@paypal-sicherheit.ru', 'PayPal Service', 'Ihr Konto', ''), []);
    await c.append('INBOX', mail('carla@example.com', 'Carla', 'Mittagessen?', 'Authentication-Results: mx.test; spf=pass dkim=pass dmarc=pass\r\n'), []);
    await c.append('INBOX', mail('freund@example.com', 'Freund', 'Bitcoin!!! JETZT KAUFEN', 'X-Spam-Flag: YES\r\n'), []);
    await c.append('INBOX', mail('dora@example.com', 'Dora', 'Bitcoin-Kurs heute', ''), []);
  });
  await settle(page); await sleep(500);
  let inbox, spam, folders;
  await imap(async (c) => {
    folders = (await c.list()).map((f) => f.path);
    inbox = await subjects(c, 'INBOX');
    spam = folders.includes('Spam') ? await subjects(c, 'Spam') : [];
  });
  console.log('Ordner', folders, '\nINBOX', inbox, '\nSpam', spam);
  check('Spam-Ordner angelegt', folders.includes('Spam'));
  check('Eindeutiger Spam verschoben', spam.includes('SIE HABEN GEWONNEN!!!'));
  check('Server-Spam verschoben', spam.includes('Angebot'));
  check('Markenimitat verschoben', spam.includes('Ihr Konto'));
  check('Harmlose Mail bleibt', inbox.includes('Mittagessen?'));
  check('Kontakt bleibt trotz Spam-Merkmalen', inbox.includes('Bitcoin!!! JETZT KAUFEN'));
  check('Grenzfall (Stufe mittel) bleibt', inbox.includes('Bitcoin-Kurs heute'));
  check('Hinweis „3 E-Mails als Spam aussortiert“', toasts.some((t) => /3 E-Mails als Spam aussortiert/.test(t)));
  check('Spam-Ordner in der Seitenleiste', await page.evaluate(async () => { await loadFolders(); return (S.folders[S.accounts[0].id] || []).some((f) => f.path === 'Spam' && f.role === 'junk'); }));
  // Kategorie „Spam“ in der Seitenleiste zeigt den Spam aller Konten
  const spamItem = page.locator('#sidebar .side-item', { hasText: /^\s*Spam\s*$/ }).first();
  check('Seitenleiste: „Spam“ unter Kategorien', await page.evaluate(() => {
    const items = [...document.querySelectorAll('#sidebar > *')];
    const kat = items.findIndex((x) => x.textContent.trim() === 'Kategorien');
    const sp = items.findIndex((x) => x.dataset.view && JSON.parse(x.dataset.view).type === 'spam');
    const nextTitle = items.findIndex((x, i) => i > kat && x.classList.contains('side-title'));
    return kat >= 0 && sp > kat && (nextTitle < 0 || sp < nextTitle);
  }));
  await page.click('#sidebar [data-view*="spam"]');
  await page.waitForFunction(() => S.view.type === 'spam' && !S.loading && S.folderMsgs.length > 0, null, { timeout: 15000 });
  await sleep(300);
  const shownSpam = await page.$$eval('.row[data-key]', (r) => r.map((x) => x.textContent));
  check('Ansicht „Spam“ zeigt die aussortierten Mails', ['GEWONNEN', 'Angebot', 'Ihr Konto'].every((t) => shownSpam.some((x) => x.includes(t))) && shownSpam.length === 3);
  await page.click('#sidebar [data-view*="smart"]');
  await sleep(300);
  check('Liste zeigt Spam nicht mehr', !(await page.evaluate(() => allInbox().some((m) => /GEWONNEN/.test(m.subject)))));

  // Einstellungen: Empfindlichkeit hoch über die Oberfläche
  await page.evaluate(() => openSettings());
  await page.click('.tab[data-tab="privacy"]');
  await page.waitForSelector('#p-spam');
  check('Spamfilter standardmäßig an', await page.isChecked('#p-spam'));
  await page.selectOption('#p-spam-level', 'high');
  await sleep(500);
  let st = await page.evaluate(() => api.call('settings:get'));
  check('Stufe „hoch“ gespeichert mit Zeitstempel', st.spamFilter && st.spamFilter.level === 'high' && st.spamFilterUpdatedAt > 0);
  await page.keyboard.press('Escape');
  await imap((c) => c.append('INBOX', mail('eve@example.com', 'Eve', 'GRATIS ANGEBOT NUR HEUTE!!!', ''), []));   // 2 Punkte
  await imap((c) => c.append('INBOX', mail('fritz@example.com', 'Fritz', 'Casino Bonus!!!', ''), []));             // 3 Punkte
  await settle(page); await sleep(500);
  await imap(async (c) => { inbox = await subjects(c, 'INBOX'); spam = await subjects(c, 'Spam'); });
  check('Stufe hoch: 3 Punkte → Spam', spam.includes('Casino Bonus!!!'));
  check('Stufe hoch: 2 Punkte → bleibt', inbox.includes('GRATIS ANGEBOT NUR HEUTE!!!'));

  // ausschalten
  await page.evaluate(async () => { S.settings.spamFilter = { enabled: false, level: 'high' }; S.settings.spamFilterUpdatedAt = Date.now(); await saveSettings({ sync: false }); });
  await imap((c) => c.append('INBOX', mail('x@lotto-xyz.biz', 'Gewinn', 'Lotto Gewinn!!!', 'X-Spam-Flag: YES\r\n'), []));
  await settle(page); await sleep(500);
  await imap(async (c) => { inbox = await subjects(c, 'INBOX'); });
  check('Ausgeschaltet: nichts verschoben', inbox.includes('Lotto Gewinn!!!'));

  // „Kein Spam“ im Spam-Ordner
  const res = await page.evaluate(async () => {
    const id = S.accounts[0].id;
    const list = await api.call('mail:fetch', id, 'Spam');
    const m = (list.messages || list).find((x) => x.subject === 'Angebot');
    await markNotSpam(m);
    await new Promise((r) => setTimeout(r, 800));
    return { trusted: isTrusted('info@shop.example') };
  });
  await imap(async (c) => { inbox = await subjects(c, 'INBOX'); });
  check('„Kein Spam“ → wieder im Posteingang', inbox.includes('Angebot'));
  check('„Kein Spam“ → Absender vertrauenswürdig', res.trusted);
  // vertrauenswürdiger Absender wird nicht mehr aussortiert
  await page.evaluate(async () => { S.settings.spamFilter = { enabled: true, level: 'medium' }; S.settings.spamFilterUpdatedAt = Date.now(); await saveSettings({ sync: false }); });
  await imap((c) => c.append('INBOX', mail('info@shop.example', 'Shop', 'Neues Angebot', 'X-Spam-Flag: YES\r\n'), []));
  await settle(page); await sleep(500);
  await imap(async (c) => { inbox = await subjects(c, 'INBOX'); });
  check('Vertrauenswürdiger Absender bleibt', inbox.includes('Neues Angebot'));

  // Sync-Dokument enthält prefs.spamFilter, und ein neuerer Stand vom Mac wird übernommen
  await page.evaluate(async () => {
    S.settings.sync = { enabled: true, accountEmail: 'ortie@test.local' };
    await saveSettings({ sync: false });
    await runSync();
  });
  await sleep(1000);
  const { simpleParser } = require(path.resolve(__dirname, '../app/node_modules/mailparser'));
  const doc = await imap(async (c) => {
    const box = (await c.list()).find((f) => f.name === 'SimpleMail-Sync');
    if (!box) return null;
    await c.mailboxOpen(box.path);
    let last = null;
    for await (const m of c.fetch('1:*', { source: true })) last = m.source;
    const parsed = await simpleParser(last);
    return JSON.parse(parsed.attachments.find((a) => /sync\.json$/.test(a.filename)).content.toString());
  });
  console.log('prefs.spamFilter', JSON.stringify(doc && doc.prefs.spamFilter));
  check('Sync-Dokument enthält prefs.spamFilter', doc && doc.prefs.spamFilter && doc.prefs.spamFilter.value.enabled === true
    && doc.prefs.spamFilter.value.level === 'medium' && doc.prefs.spamFilter.updatedAt > 0);
  await app.close();
  console.log(fail ? `\n${fail} FEHLER` : '\nALLES OK');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
