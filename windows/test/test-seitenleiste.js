// Prüft das Kontextmenü der Seitenleiste: Ordner anlegen, umbenennen (Regel zieht mit), löschen (mit Rückfrage),
// Systemordner geschützt, Papierkorb leeren, Ordner/Kategorie als gelesen markieren, Konto-Menü
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
const mail = (subj) => `From: X <x@example.com>\r\nTo: ortie@test.local\r\nSubject: ${subj}\r\nDate: Thu, 13 Nov 2026 12:00:00 +0100\r\nMessage-ID: <${Math.random().toString(36).slice(2)}@x>\r\n\r\nText\r\n`;
const boxes = () => imap(async (c) => (await c.list()).map((f) => f.path));
const settle = (page) => page.evaluate(async () => { await refresh(); while (S.loading || S.pending) await new Promise((r) => setTimeout(r, 50)); });
const menuLabels = (page) => page.$$eval('#menu:not(.hidden) .mi', (els) => els.map((e) => ({ t: e.textContent.trim(), d: e.classList.contains('disabled') })));
async function rightClick(page, selector) { await page.click(selector, { button: 'right' }); await sleep(200); return menuLabels(page); }
async function pick(page, label) { await page.locator('#menu .mi', { hasText: label }).first().click(); await sleep(300); }
async function answer(page, value) {
  await page.waitForSelector('#pd-val'); await page.fill('#pd-val', value); await page.click('[data-x="yes"]');
}
const folderSel = (p) => `#sidebar .side-item[data-drop-path="${p}"]`;
(async () => {
  const D = path.join(__dirname, 'data-seite'); fs.rmSync(D, { recursive: true, force: true });
  let { app, page } = await launch(D);
  await page.evaluate(async (a) => { await api.call('accounts:save', a, 'geheim'); }, acc);
  await app.close();
  ({ app, page } = await launch(D));
  await page.keyboard.press('Escape');
  await page.waitForSelector('.row[data-key]', { timeout: 20000 });
  check(`Version ${require('../app/package.json').version} (package.json = App)`, (await app.evaluate(({ app: a }) => a.getVersion())) === require('../app/package.json').version);
  await settle(page);
  await page.evaluate(() => loadFolders());
  await sleep(300);

  // Systemordner: Löschen/Umbenennen gesperrt
  let items = await rightClick(page, folderSel('INBOX'));
  const del = items.find((i) => i.t.startsWith('Ordner löschen'));
  check('Posteingang: Löschen gesperrt', del && del.d);
  check('Posteingang: Umbenennen gesperrt', items.find((i) => i.t.startsWith('Umbenennen')).d);
  await page.keyboard.press('Escape');
  items = await rightClick(page, folderSel('Trash'));
  check('Papierkorb: „Papierkorb leeren“ angeboten', items.some((i) => i.t.startsWith('Papierkorb leeren')));
  await page.keyboard.press('Escape');

  // Neuer Ordner über das Konto-Menü
  await rightClick(page, '#sidebar .account-item[data-acc]:not([data-acc=""])');
  await pick(page, 'Neuer Ordner');
  await answer(page, 'Projekte Ä');
  await sleep(1200);
  check('Ordner auf dem Server angelegt', (await boxes()).includes('Projekte Ä'));
  check('Ordner in der Seitenleiste', !!(await page.$(folderSel('Projekte Ä'))));

  // Unterordner
  await rightClick(page, folderSel('Projekte Ä'));
  await pick(page, 'Neuer Unterordner');
  await answer(page, 'Alt');
  await sleep(1200);
  check('Unterordner angelegt', (await boxes()).includes('Projekte Ä/Alt'));

  // Regel, die in den Ordner verschiebt
  await page.evaluate(() => {
    S.settings.rules.push({ id: 'r1', name: 'R', enabled: true, accountEmail: 'ortie@test.local', match: 'all', conditions: [{ field: 'from', op: 'contains', value: 'x' }],
      actions: { moveTo: 'Projekte Ä/Alt', markRead: false, flag: false }, order: 1, updatedAt: 1, deleted: false });
    return saveSettings({ sync: false });
  });

  // Umbenennen
  await rightClick(page, folderSel('Projekte Ä'));
  await pick(page, 'Umbenennen');
  await answer(page, 'Kunden');
  await sleep(1500);
  const b1 = await boxes();
  check('Umbenannt auf dem Server (inkl. Unterordner)', b1.includes('Kunden') && b1.includes('Kunden/Alt') && !b1.includes('Projekte Ä'));
  const rule = await page.evaluate(() => S.settings.rules.find((r) => r.id === 'r1'));
  check('Regel zeigt auf den neuen Pfad', rule.actions.moveTo === 'Kunden/Alt' && rule.updatedAt > 1);

  // Mails hineinlegen, dann Ordner als gelesen markieren
  await imap(async (c) => { await c.append('Kunden', mail('K1'), []); await c.append('Kunden', mail('K2'), []); });
  await page.evaluate(() => loadFolders()); await sleep(500);
  items = await rightClick(page, folderSel('Kunden'));
  await pick(page, 'Alle als gelesen markieren');
  await sleep(1000);
  const unseen = await imap(async (c) => (await c.status('Kunden', { unseen: true })).unseen);
  check('Ordner als gelesen markiert (Server)', unseen === 0);

  // Löschen – erst abbrechen, dann bestätigen
  await rightClick(page, folderSel('Kunden'));
  await pick(page, 'Ordner löschen');
  await page.waitForSelector('[data-x="no"]');
  check('Rückfrage nennt Unterordner', (await page.textContent('#modal-root')).includes('1 Unterordner'));
  await page.click('[data-x="no"]'); await sleep(500);
  check('Abbrechen löscht nichts', (await boxes()).includes('Kunden'));
  await rightClick(page, folderSel('Kunden'));
  await pick(page, 'Ordner löschen');
  await page.waitForSelector('[data-x="yes"]'); await page.click('[data-x="yes"]');
  await sleep(1500);
  const b2 = await boxes();
  check('Ordner + Unterordner gelöscht', !b2.includes('Kunden') && !b2.includes('Kunden/Alt'));
  check('Seitenleiste ohne gelöschten Ordner', !(await page.$(folderSel('Kunden'))));
  check('Löschen eines Systemordners wird im Hauptprozess abgelehnt',
    await page.evaluate(async () => { try { await api.call('folders:delete', S.accounts[0].id, 'INBOX'); return false; } catch (e) { return /Systemordner/.test(e.message); } }));

  // Papierkorb leeren
  await imap(async (c) => { await c.append('Trash', mail('T1'), ['\\Seen']); await c.append('Trash', mail('T2'), ['\\Seen']); });
  await rightClick(page, folderSel('Trash'));
  await pick(page, 'Papierkorb leeren');
  await page.waitForSelector('[data-x="yes"]'); await page.click('[data-x="yes"]');
  await sleep(1500);
  const trashLeft = await imap(async (c) => (await c.status('Trash', { messages: true })).messages);
  check('Papierkorb geleert', trashLeft === 0);

  // Smart Inbox: alle als gelesen
  await imap(async (c) => { await c.append('INBOX', mail('Neu 1'), []); });
  for (let i = 0; i < 20 && !(await page.evaluate(() => allInbox().some((m) => m.subject === 'Neu 1'))); i++) { await settle(page); await sleep(300); }
  check('Ungelesene vorhanden', await page.evaluate(() => unreadCount() > 0));
  items = await rightClick(page, '#sidebar .side-item[data-view=\'{"type":"smart"}\']');
  check('Smart Inbox: Menü „Alle als gelesen markieren“', items.some((i) => i.t === 'Alle als gelesen markieren'));
  await pick(page, 'Alle als gelesen markieren');
  await sleep(1500);
  if (process.env.DBG) console.log(await page.evaluate(() => JSON.stringify({ u: unreadCount(), e: S.error, l: allInbox().map((m) => [m.uid, m.isRead, m.subject]) })));
  check('Smart Inbox lokal gelesen', await page.evaluate(() => unreadCount() === 0));
  const inboxUnseen = await imap(async (c) => (await c.status('INBOX', { unseen: true })).unseen);
  check('Smart Inbox auf dem Server gelesen', inboxUnseen === 0);

  // weitere Menüs
  items = await rightClick(page, '#sidebar .side-item[data-view=\'{"type":"spam"}\']');
  check('Spam-Kategorie: „Spam leeren“ statt Löschen', items.some((i) => i.t.startsWith('Spam leeren')) && !items.some((i) => i.t.startsWith('Ordner löschen')));
  await page.keyboard.press('Escape');
  items = await rightClick(page, '#sidebar .side-item[data-view=\'{"type":"contacts"}\']');
  check('Kontakte: Neu/Import/Export', items.length === 3);
  await page.keyboard.press('Escape');
  items = await rightClick(page, '#sidebar .account-item[data-acc]:not([data-acc=""])');
  check('Konto-Menü: Konto entfernen', items.some((i) => i.t.startsWith('Konto entfernen')));
  await pick(page, 'Konto entfernen');
  await page.waitForSelector('[data-x="no"]'); await page.click('[data-x="no"]'); await sleep(300);
  check('Abbrechen behält das Konto', await page.evaluate(() => S.accounts.length === 1));
  await rightClick(page, '#sidebar .account-item[data-acc]:not([data-acc=""])');
  await pick(page, 'Konto entfernen');
  await page.waitForSelector('[data-x="yes"]'); await page.click('[data-x="yes"]'); await sleep(800);
  check('Konto entfernt', await page.evaluate(async () => S.accounts.length === 0 && (await api.call('accounts:list')).length === 0));

  await app.close();
  console.log(fail ? `${fail} Fehler` : 'Alle Prüfungen bestanden');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
