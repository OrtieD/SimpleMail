// 3.2.36: gemeinsame Ordner „Gesendet“ und „Papierkorb“ über alle Konten (wie „Spam“): Anzeige, Kontofilter,
// Ziehen als Ablegeziel, Löschen im Papierkorb, „Papierkorb aller Konten leeren“, Menü Ansicht (Strg+6/7)
const { _electron } = require('playwright-core');
const fs = require('fs'); const path = require('path');
const hoodiecrow = require('hoodiecrow-imap');
const { ImapFlow } = require(path.resolve(__dirname, '../app/node_modules/imapflow'));
const APP = path.resolve(__dirname, '../app');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0; const check = (name, ok) => { console.log(ok ? 'OK  ' : 'FAIL', name); if (!ok) fail++; };
const U = { 1143: ['ortie@test.local', 'geheim'], 1145: ['zweit@test.local', 'geheim2'] };
const imap = async (port, fn) => {
  const c = new ImapFlow({ host: '127.0.0.1', port, secure: false, auth: { user: U[port][0], pass: U[port][1] }, logger: false });
  await c.connect(); try { return await fn(c); } finally { await c.logout(); }
};
const subjects = (port, box) => imap(port, async (c) => { const out = []; const lock = await c.getMailboxLock(box); try { for await (const m of c.fetch('1:*', { envelope: true })) out.push(m.envelope.subject); } catch {} finally { lock.release(); } return out; });
const mail = (subj, mins, to = 'Empfänger Eins <e1@example.com>', from = 'Ich <ortie@test.local>') =>
  `From: ${from}\r\nTo: ${to}\r\nSubject: ${subj}\r\nDate: ${new Date(Date.now() - mins * 60000).toUTCString()}\r\nMessage-ID: <${Math.random().toString(36).slice(2)}@x>\r\n\r\nText\r\n`;
async function launch(dir) {
  const app = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox'], env: { ...process.env, SIMPLEMAIL_DATA: dir } });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}
async function waitFor(fn, ms = 10000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(300); } return false; }
const listSubjects = (page) => page.$$eval('#list .row[data-key] .subject', (els) => els.map((e) => e.textContent.trim()));
const settle = (page) => page.evaluate(async () => { await refresh(); while (S.loading || S.pending) await new Promise((r) => setTimeout(r, 50)); });
const menuLabels = (page) => page.$$eval('#menu:not(.hidden) .mi', (els) => els.map((e) => ({ t: e.textContent.trim(), d: e.classList.contains('disabled') })));

(async () => {
  // Zweites Konto auf eigenem Testserver (Port 1145)
  const srv2 = hoodiecrow({
    plugins: ['IDLE', 'UIDPLUS', 'MOVE', 'SPECIAL-USE', 'LITERALPLUS', 'ENABLE', 'CONDSTORE', 'ID', 'UNSELECT', 'NAMESPACE'],
    users: { 'zweit@test.local': { password: 'geheim2' } },
    storage: { INBOX: { messages: [] }, '': { separator: '/', folders: { Sent: { 'special-use': '\\Sent' }, Trash: { 'special-use': '\\Trash' } } } },
  });
  await new Promise((r) => srv2.listen(1145, r));

  await imap(1143, async (c) => {
    await c.append('Sent', mail('Gesendet A1', 30), ['\\Seen']);
    await c.append('Trash', mail('Papierkorb A1', 40), ['\\Seen']);
    await c.append('INBOX', mail('Zum Papierkorb ziehen', 5, 'ortie@test.local', 'Z <z@example.com>'), []);
    await c.append('INBOX', mail('Zum Gesendet ziehen', 6, 'ortie@test.local', 'Z <z@example.com>'), []);
  });
  await imap(1145, async (c) => {
    await c.append('Sent', mail('Gesendet B2', 10, '"Bea Beispiel" <bea@example.com>, c@example.com', 'Zweit <zweit@test.local>'), ['\\Seen']);
    await c.append('Trash', mail('Papierkorb B2', 20), ['\\Seen']);
  });

  const D = path.join(__dirname, 'data-gemeinsam');
  let { app, page } = await launch(D);
  await page.evaluate(async () => {
    await api.call('accounts:save', { displayName: 'ortie', email: 'ortie@test.local', username: 'ortie@test.local', imapHost: '127.0.0.1', imapPort: 1143, smtpHost: '127.0.0.1', smtpPort: 2525 }, 'geheim');
    await api.call('accounts:save', { displayName: 'zweit', email: 'zweit@test.local', username: 'zweit@test.local', imapHost: '127.0.0.1', imapPort: 1145, smtpHost: '127.0.0.1', smtpPort: 2525 }, 'geheim2');
  });
  await app.close();
  ({ app, page } = await launch(D));
  await page.keyboard.press('Escape');
  check(`Version ${require('../app/package.json').version}`, (await app.evaluate(({ app: a }) => a.getVersion())) === require('../app/package.json').version);
  await page.waitForSelector('#list .row[data-key]', { timeout: 20000 });
  await settle(page);

  // 1. Einträge in der Seitenleiste
  const sent = '#sidebar .side-item[data-drop-role="sent"]';
  const trash = '#sidebar .side-item[data-drop-role="trash"]';
  check('Seitenleiste: „Gesendet“ und „Papierkorb“ vorhanden', !!(await page.$(sent)) && !!(await page.$(trash)));
  check('… Beschriftung', (await page.textContent(sent)).includes('Gesendet') && (await page.textContent(trash)).includes('Papierkorb'));

  // 2. Gesendet aller Konten
  await page.click(sent);
  check('Gesendet: beide Konten', await waitFor(async () => { const s = await listSubjects(page); return s.includes('Gesendet A1') && s.includes('Gesendet B2'); }));
  let s = await listSubjects(page);
  check('… nach Datum sortiert (neueste oben)', s.indexOf('Gesendet B2') < s.indexOf('Gesendet A1'));
  check('… keine Posteingangs-Mails', !s.includes('Zum Papierkorb ziehen'));
  check('… Überschrift „Gesendet · alle Konten“', (await page.textContent('#list')).includes('Gesendet · alle Konten'));
  const fromB2 = await page.locator('#list .row[data-key]', { hasText: 'Gesendet B2' }).locator('.from').textContent();
  check(`… zeigt Empfänger statt Absender („${fromB2}“)`, fromB2 === 'An: Bea Beispiel, c@example.com');
  check('… Kontofarbe je Zeile', (await page.$$('#list .row[data-key] .acc-stripe')).length >= 2);

  // 3. Papierkorb aller Konten
  await page.click(trash);
  check('Papierkorb: beide Konten', await waitFor(async () => { s = await listSubjects(page); return s.includes('Papierkorb A1') && s.includes('Papierkorb B2'); }));
  check('… Gesendet-Mails nicht dabei', !s.includes('Gesendet A1'));

  // 4. Kontofilter: nur zweites Konto
  await page.click('#sidebar .account-item[data-acc]:not([data-acc=""]) >> nth=1');
  await sleep(500);
  s = await listSubjects(page);
  check('Kontofilter zweit@: nur dessen Papierkorb', s.includes('Papierkorb B2') && !s.includes('Papierkorb A1'));
  await page.click('#sidebar .account-item[data-acc=""]');
  await sleep(500);

  // 5. Löschen im gemeinsamen Papierkorb = endgültig (im Konto der Mail)
  await page.locator('#list .row[data-key]', { hasText: 'Papierkorb B2' }).click();
  await sleep(300);
  await page.keyboard.press('Delete');
  check('Löschen im Papierkorb: auf dem Server von zweit@ weg', await waitFor(async () => !(await subjects(1145, 'Trash')).includes('Papierkorb B2')));
  check('… Papierkorb A1 bleibt', (await subjects(1143, 'Trash')).includes('Papierkorb A1'));

  // 6. Ziehen auf „Papierkorb“ und „Gesendet“
  await page.click('#sidebar .side-item[data-view=\'{"type":"smart"}\']');
  const row = (subj) => page.locator('#list .row[data-key]', { hasText: subj }).first();
  await row('Zum Papierkorb ziehen').waitFor({ timeout: 10000 });
  await row('Zum Papierkorb ziehen').dragTo(page.locator(trash));
  check('Ziehen auf „Papierkorb“: Mail im Papierkorb ihres Kontos', await waitFor(async () => (await subjects(1143, 'Trash')).includes('Zum Papierkorb ziehen')));
  await row('Zum Gesendet ziehen').dragTo(page.locator(sent));
  check('Ziehen auf „Gesendet“: Mail im Gesendet-Ordner ihres Kontos', await waitFor(async () => (await subjects(1143, 'Sent')).includes('Zum Gesendet ziehen')));
  check('… nicht mehr im Posteingang', !(await subjects(1143, 'INBOX')).includes('Zum Gesendet ziehen'));

  // 7. Menüleiste Ansicht → Gesendet / Papierkorb (alle Konten), Kürzel Strg+6/7 im Eintrag
  const pickMenu = async (label) => {
    await page.locator('#menubar .mb-top', { hasText: 'Ansicht' }).click(); await sleep(200);
    const it = page.locator('#mbDrop .mi', { hasText: label }).first();
    const t = await it.textContent();
    await it.click(); await sleep(500);
    return t;
  };
  let t = await pickMenu('Gesendet (alle Konten)');
  check(`Menü Ansicht → Gesendet (alle Konten), Kürzel im Eintrag („${t.trim()}“)`, (await page.evaluate(() => S.view.type)) === 'sent' && t.includes('Strg+6'));
  check('… zeigt auch die hineingezogene Mail', await waitFor(async () => (await listSubjects(page)).includes('Zum Gesendet ziehen')));
  t = await pickMenu('Papierkorb (alle Konten)');
  check('Menü Ansicht → Papierkorb (alle Konten)', (await page.evaluate(() => S.view.type)) === 'trash' && t.includes('Strg+7'));

  // 8. Rechtsklick „Papierkorb aller Konten leeren …“
  await imap(1145, (c) => c.append('Trash', mail('Papierkorb B3', 2), ['\\Seen']));
  await page.click(trash, { button: 'right' }); await sleep(200);
  const items = await menuLabels(page);
  check('Rechtsklick Papierkorb: „Papierkorb aller Konten leeren …“', items.some((i) => i.t.startsWith('Papierkorb aller Konten leeren') && !i.d));
  await page.locator('#menu .mi', { hasText: 'Papierkorb aller Konten leeren' }).first().click();
  await page.waitForSelector('[data-x="yes"]'); await page.click('[data-x="yes"]');
  check('… beide Papierkörbe leer', await waitFor(async () => (await subjects(1143, 'Trash')).length === 0 && (await subjects(1145, 'Trash')).length === 0));
  await page.click(sent, { button: 'right' }); await sleep(200);
  check('Rechtsklick Gesendet: kein Leeren', !(await menuLabels(page)).some((i) => /leeren/.test(i.t)));
  await page.keyboard.press('Escape');
  await page.click(sent); await sleep(800);
  await page.screenshot({ path: path.join(__dirname, 'shot-gemeinsam.png') });
  await app.close();
  srv2.close();
  console.log(fail ? `${fail} FEHLER` : 'ALLES OK');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
