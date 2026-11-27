// 3.2.44: Als Entwurf speichern (Knopf, Strg+S, Nachfrage beim Schließen), Entwurf wieder öffnen, beim Senden löschen
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
const mailsIn = (box) => imap(async (c) => {
  const out = [];
  let lock;
  try {
    lock = await c.getMailboxLock(box);
    for await (const m of c.fetch('1:*', { envelope: true, flags: true, source: true })) {
      out.push({ uid: m.uid, subject: m.envelope.subject, to: (m.envelope.to || []).map((x) => x.address).join(','), flags: [...m.flags], source: m.source.toString() });
    }
  } catch { /* leer/fehlt */ } finally { if (lock) lock.release(); }
  return out;
});
const visible = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && e.offsetParent !== null; }, sel);

(async () => {
  const D = '/tmp/smE'; fs.rmSync(D, { recursive: true, force: true });
  let { app, page } = await launch(D);
  await page.evaluate(async (a) => { await api.call('accounts:save', a, 'geheim'); }, acc);
  await app.close();
  ({ app, page } = await launch(D));
  await page.keyboard.press('Escape');
  await page.waitForSelector('.row[data-key]', { timeout: 20000 });
  await sleep(1500);
  check(`Version ${require('../app/package.json').version} (package.json = App)`, (await app.evaluate(({ app: a }) => a.getVersion())) === require('../app/package.json').version);

  // 1) Neue Mail, Knopf „Entwurf speichern“ → Ordner „Drafts“ wird angelegt, Mail mit \Draft
  await page.keyboard.press('Control+n');
  await page.waitForSelector('.compose');
  check('Knopf „Entwurf speichern“ im Verfassen-Fenster', await visible(page, '.compose [data-x="save-draft"]'));
  await page.fill('#c-to', 'freund@web.example');
  await page.fill('#c-subject', 'Entwurf Eins');
  await page.click('#c-body');
  await page.keyboard.type('Erste Fassung mit fett');
  await page.click('.compose [data-x="save-draft"]');
  await sleep(1500);
  let drafts = await mailsIn('Drafts');
  check('Entwurf liegt in „Drafts“', drafts.length === 1 && drafts[0].subject === 'Entwurf Eins');
  check('Flag \\Draft gesetzt', drafts[0] && drafts[0].flags.includes('\\Draft'));
  check('Empfänger im Entwurf', drafts[0] && drafts[0].to === 'freund@web.example');
  check('Fenster bleibt offen', await visible(page, '.compose'));

  // 2) Weiterschreiben + Strg+S → alter Stand ersetzt (nur 1 Entwurf)
  await page.click('#c-body');
  await page.keyboard.press('End');
  await page.keyboard.type(' – zweite Fassung');
  await page.keyboard.press('Control+s');
  await sleep(1500);
  drafts = await mailsIn('Drafts');
  check('Strg+S speichert, alter Stand gelöscht', drafts.length === 1 && /zweite Fassung/.test(drafts[0].source));

  // 3) Schließen ohne Änderung → keine Nachfrage
  await page.click('.compose [data-x="cancel"]');
  await sleep(400);
  check('Unverändert: Schließen ohne Nachfrage', !(await visible(page, '.compose')));

  // 4) Neue Mail ändern, Esc → Nachfrage, „Speichern“ → zweiter Entwurf (ohne Empfänger)
  await page.keyboard.press('Control+n');
  await page.waitForSelector('.compose');
  await page.fill('#c-subject', 'Entwurf Zwei');
  await page.click('#c-body');
  await page.keyboard.type('Noch ohne Empfänger');
  await page.keyboard.press('Escape');
  await sleep(400);
  const ask = await page.evaluate(() => document.body.innerText.includes('Als Entwurf speichern?'));
  check('Esc bei Änderungen fragt nach', ask);
  await page.click('.dialog [data-x="save"]');
  await sleep(1500);
  check('Nach „Speichern“ geschlossen', !(await visible(page, '.compose')));
  drafts = await mailsIn('Drafts');
  check('Zweiter Entwurf (ohne Empfänger) gespeichert', drafts.length === 2 && drafts.some((d) => d.subject === 'Entwurf Zwei'));

  // 5) Verwerfen-Knopf bei Änderungen → Nachfrage, „Verwerfen“ → nichts gespeichert
  await page.keyboard.press('Control+n');
  await page.waitForSelector('.compose');
  await page.fill('#c-subject', 'Wegwerfen');
  await page.click('.compose [data-x="cancel"]');
  await sleep(300);
  await page.click('.dialog [data-x="discard"]');
  await sleep(800);
  drafts = await mailsIn('Drafts');
  check('„Verwerfen“ speichert nichts', drafts.length === 2 && !(await visible(page, '.compose')));

  // 6) Seitenleiste „Entwürfe“ zeigt beide; Doppelklick öffnet den Entwurf im Editor
  await page.evaluate(async () => { await loadFolders(); });
  await page.evaluate(() => { const el = [...document.querySelectorAll('.side-item')].find((x) => /Entwürfe/.test(x.textContent)); if (el) el.click(); });
  await sleep(2500);
  const rows = await page.evaluate(() => [...document.querySelectorAll('#list .row')].map((r) => r.innerText));
  check('Ansicht „Entwürfe“ listet beide Entwürfe', rows.length === 2 && rows.some((r) => /Entwurf an/.test(r)));
  await page.screenshot({ path: path.join(__dirname, 'shot-entwurf-liste.png') });
  const keyEins = await page.evaluate(() => { const m = visibleMessages().find((x) => x.subject === 'Entwurf Eins'); return m ? keyOf(m) : null; });
  await page.dblclick(`#list .row[data-key="${keyEins}"]`);
  await page.waitForSelector('.compose', { timeout: 5000 }).catch(() => {});
  await sleep(800);
  const form = await page.evaluate(() => ({
    to: document.querySelector('#c-to') && document.querySelector('#c-to').value,
    subject: document.querySelector('#c-subject') && document.querySelector('#c-subject').value,
    body: document.querySelector('#c-body') && document.querySelector('#c-body').innerText,
  }));
  check('Doppelklick öffnet Entwurf im Editor', form.to === 'freund@web.example' && form.subject === 'Entwurf Eins');
  check('Text des Entwurfs wieder da', /Erste Fassung mit fett – zweite Fassung/.test(form.body || ''));
  check('Signatur-Hülle nicht verdoppelt', (await page.evaluate(() => document.querySelectorAll('#c-body div[style*="font-family"]').length)) === 0);
  await page.screenshot({ path: path.join(__dirname, 'shot-entwurf.png') });

  // 7) Senden → Entwurf wird gelöscht, Mail in Gesendet
  await page.click('.compose [data-x="send"]');
  await sleep(2000);
  drafts = await mailsIn('Drafts');
  check('Nach dem Senden: Entwurf gelöscht', drafts.length === 1 && drafts[0].subject === 'Entwurf Zwei');
  check('Gesendete Mail in „Sent“', (await mailsIn('Sent')).some((m) => m.subject === 'Entwurf Eins'));

  // 8) Lesebereich: Knopf „Entwurf bearbeiten“; geplantes Senden löscht ebenfalls
  await page.evaluate(() => refresh());
  await sleep(2000);
  const keyZwei = await page.evaluate(() => { const m = visibleMessages().find((x) => x.subject === 'Entwurf Zwei'); return m ? keyOf(m) : null; });
  await page.click(`#list .row[data-key="${keyZwei}"]`);
  await sleep(1200);
  check('Lesebereich zeigt „Entwurf bearbeiten“', await visible(page, '[data-act="edit-draft"]'));
  await page.click('[data-act="edit-draft"]');
  await page.waitForSelector('.compose');
  await sleep(500);
  await page.fill('#c-to', 'kollege@web.example');
  await page.evaluate(async () => {
    const t = new Date(Date.now() + 86400e3);
    document.querySelector('[data-x="later"]').click();
  });
  await sleep(300);
  await page.click('#menu .mi >> nth=0');
  await sleep(1500);
  drafts = await mailsIn('Drafts');
  check('Geplant: Entwurf gelöscht', drafts.length === 0);
  check('Geplante Mail in der Warteschlange', (await page.evaluate(() => S.outbox.map((o) => o.subject))).includes('Entwurf Zwei'));

  // 9) Menü Datei → „Als Entwurf speichern“ vorhanden
  const menu = await app.evaluate(({ Menu }) => {
    const m = Menu.getApplicationMenu(); const out = [];
    const walk = (items) => { for (const it of items) { out.push(it.label); if (it.submenu) walk(it.submenu.items); } };
    if (m) walk(m.items); return out;
  });
  check('Menüeintrag „Als Entwurf speichern“', menu.includes('Als Entwurf speichern'));
  check('Keine Fehlermeldung', !(await page.evaluate(() => S.error)));
  await app.close();
  console.log(fail ? `${fail} FEHLER` : 'ALLES OK');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
