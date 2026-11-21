// Alltagstest: spielt einen typischen Arbeitstag mit zwei Konten durch (Büro + Gmail-artig) und misst dabei Zeiten.
// Startet seinen eigenen Testserver (server-alltag.js: IMAP 1144/1145, SMTP 2526) und beendet ihn am Ende.
// Aufruf: xvfb-run -a node test-alltag.js   (TZ=Europe/Berlin empfohlen; LAST=0 überspringt den Lasttest)
// Ergebnis: Konsole + alltag-bericht.txt (Prüfungen, Zeiten, Fehler aus der Oberfläche)
const { _electron } = require('playwright-core');
const fs = require('fs'); const path = require('path'); const { spawn } = require('child_process');
const { ImapFlow } = require(path.resolve(__dirname, '../app/node_modules/imapflow'));
const APP = path.resolve(__dirname, process.env.SM_APP || '../app');
const VERSION = require(path.join(APP, 'package.json')).version;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const D = path.join(__dirname, 'data-alltag');
const SMTP_LOG = path.join(__dirname, 'smtp-alltag.log');
const LAST = process.env.LAST !== '0';

// ---------------------------------------------------------------- Protokoll
const lines = []; const times = []; const uiErrors = [];
const log = (s) => { console.log(s); lines.push(s); };
let fail = 0; let ok = 0;
const check = (name, cond, extra = '') => { log(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? `  (${extra})` : ''}`); if (cond) ok++; else fail++; return cond; };
const timed = (name, ms, limit) => { times.push({ name, ms: Math.round(ms), limit }); log(`  ⏱ ${name}: ${Math.round(ms)} ms${limit ? ` (Grenze ${limit})` : ''}`); if (limit) check(`${name} unter ${limit} ms`, ms < limit); };
const phase = async (name, fn) => {
  log(`\n== ${name}`);
  try { await fn(); } catch (e) { check(`${name}: ohne Ausnahme`, false, e.message.split('\n')[0]); }
};

// ---------------------------------------------------------------- Server + IMAP-Helfer
let server = null;
async function startServer() {
  server = spawn(process.execPath, [path.join(__dirname, 'server-alltag.js')], { env: { ...process.env, SMTP_LOG }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { await sleep(100); try { await imap(1144, async () => {}); return; } catch { /* noch nicht */ } }
  throw new Error('Testserver startet nicht');
}
function stopServer() { if (server) { try { server.kill(); } catch { /* egal */ } server = null; } }
// Vermittler vor dem Büro-Server: simuliert WLAN-Abbruch / Laptop-Ruhezustand (alle Verbindungen kappen, eine Weile nichts annehmen)
const net = require('net');
const PROXY = 1146; const proxySockets = new Set(); let proxyDown = false;
const proxy = net.createServer((client) => {
  if (proxyDown) { client.destroy(); return; }
  const up = net.connect(1144, '127.0.0.1');
  proxySockets.add(client); proxySockets.add(up);
  const drop = () => { client.destroy(); up.destroy(); proxySockets.delete(client); proxySockets.delete(up); };
  client.on('error', drop); up.on('error', drop); client.on('close', drop); up.on('close', drop);
  client.pipe(up); up.pipe(client);
});
proxy.listen(PROXY);
function cutNetwork(down) { proxyDown = down; if (down) for (const x of proxySockets) x.destroy(); }
const imap = async (port, fn) => {
  const c = new ImapFlow({ host: '127.0.0.1', port, secure: false, auth: { user: 'ortie@test.local', pass: 'geheim' }, logger: false });
  c.on('error', () => {});
  await c.connect(); try { return await fn(c); } finally { await c.logout().catch(() => {}); }
};
const BUERO = 1144; const GMAIL = 1145;
const ME = { [BUERO]: 'ortie@buero.example', [GMAIL]: 'ortie.privat@gmail-test.example' };
let seq = 0;
const rfcDate = (d) => d.toUTCString().replace('GMT', '+0000');
function mail({ from, name, to, subject, body = 'Hallo,\r\nkurze Nachricht.\r\nGruß', headers = [], date = new Date() }) {
  seq++;
  return [`From: ${name ? `${name} <${from}>` : from}`, `To: ${to}`, `Subject: ${subject}`, `Date: ${rfcDate(date)}`,
    `Message-ID: <alltag${seq}.${Date.now()}@test>`, ...headers, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', body, ''].join('\r\n');
}
const append = (port, box, raw, flags = []) => imap(port, (c) => c.append(box, raw, flags));
const boxSubjects = (port, box) => imap(port, async (c) => {
  const out = [];
  const lock = await c.getMailboxLock(box);
  try { const st = await c.status(box, { messages: true }); if (st.messages) for await (const m of c.fetch('1:*', { envelope: true, flags: true })) out.push({ subject: m.envelope.subject, seen: m.flags.has('\\Seen'), uid: m.uid }); } finally { lock.release(); }
  return out;
});
const smtpLog = () => (fs.existsSync(SMTP_LOG) ? fs.readFileSync(SMTP_LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

// ---------------------------------------------------------------- App-Helfer
async function launch() {
  const t0 = Date.now();
  const app = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox'], env: { ...process.env, SIMPLEMAIL_DATA: D } });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => { uiErrors.push(e.message); log(`  PAGEERROR ${e.message}`); });
  page.on('console', (m) => { if (m.type() === 'error') uiErrors.push(`console: ${m.text()}`); });
  await page.waitForLoadState('domcontentloaded');
  // 3.2.28: Smart Inbox klappt Benachrichtigungen/Newsletter ein – dieser Test erwartet alle Zeilen
  await page.evaluate(() => { try { localStorage.setItem('simplemail.expandedGroups', '["notification","newsletter"]'); } catch {} if (window.S) { S.expandedGroups = new Set(['notification', 'newsletter']); } }).catch(() => {});
  return { app, page, t0 };
}
const until = async (page, fn, arg, timeout = 15000) => {
  const t0 = Date.now();
  try { await page.waitForFunction(fn, arg, { timeout, polling: 50 }); return Date.now() - t0; } catch { return null; }
};
const idle = (page) => page.evaluate(async () => { for (let i = 0; i < 400 && (S.loading || S.pending); i++) await new Promise((r) => setTimeout(r, 50)); });
const subjectsShown = (page) => page.$$eval('#list .row[data-key]', (rs) => rs.map((r) => (r.querySelector('.subject') || r).textContent.trim()));
const shown = async (page, subj) => (await page.$$eval('#list .row[data-key]', (rs, s) => rs.some((r) => r.textContent.includes(s)), subj));
const keyBySubject = (page, subj) => page.evaluate((s) => { const m = [...everyInbox(), ...S.folderMsgs].find((x) => x.subject === s); return m ? keyOf(m) : null; }, subj);
const view = (page, v) => page.evaluate((vv) => { const el = [...document.querySelectorAll('#sidebar [data-act="view"]')].find((e) => { try { return JSON.stringify(JSON.parse(e.dataset.view)) === JSON.stringify(vv); } catch { return false; } }); if (el) el.click(); return !!el; }, v);
const smart = (page) => view(page, { type: 'smart' });

(async () => {
  fs.rmSync(D, { recursive: true, force: true });
  await startServer();
  const tStart = Date.now();

  // ------------------------------------------------ Morgens: Postfächer füllen
  const people = [['Anna Becker', 'anna@kunde.example'], ['Jonas Weber', 'jonas@partner.example'], ['Maria Schulz', 'maria@kunde.example'], ['Paul Krüger', 'paul@freunde.example']];
  const day = Date.now() - 20 * 3600e3;
  for (let i = 0; i < 24; i++) {
    const [n, a] = people[i % people.length];
    await append(BUERO, 'INBOX', mail({ from: a, name: n, to: ME[BUERO], subject: `Projekt Phoenix Abstimmung ${i}`, date: new Date(day + i * 1800e3) }), i % 3 ? ['\\Seen'] : []);
  }
  for (let i = 0; i < 6; i++) await append(BUERO, 'INBOX', mail({ from: 'news@shop.example', name: 'Shop News', to: ME[BUERO], subject: `Angebote der Woche ${i}`, headers: ['List-Id: <angebote.shop.example>', 'List-Unsubscribe: <https://shop.example/ab>'], date: new Date(day + i * 3600e3) }));
  for (let i = 0; i < 4; i++) await append(BUERO, 'INBOX', mail({ from: 'noreply@konto.example', name: 'Kontoservice', to: ME[BUERO], subject: `Ihr Kontoauszug ${i}`, headers: ['Auto-Submitted: auto-generated'], date: new Date(day + i * 5000e3) }));
  for (let i = 0; i < 15; i++) {
    const [n, a] = people[(i + 1) % people.length];
    await append(GMAIL, 'INBOX', mail({ from: a, name: n, to: ME[GMAIL], subject: `Privat Grillfest ${i}`, date: new Date(day + i * 2400e3) }), i % 2 ? ['\\Seen'] : []);
  }
  // Gmail: eine Mail mit Label „Privat“ liegt auch in „Alle Nachrichten“ (gleiche Message-ID)
  const foto = mail({ from: 'paul@freunde.example', name: 'Paul Krüger', to: ME[GMAIL], subject: 'Urlaubsfotos Zauberberg', body: 'Die Fotos vom Zauberberg' });
  await append(GMAIL, 'Privat', foto, ['\\Seen']);
  await append(GMAIL, '[Gmail]/Alle Nachrichten', foto, ['\\Seen']);
  await append(BUERO, 'Projekte', mail({ from: 'jonas@partner.example', name: 'Jonas Weber', to: ME[BUERO], subject: 'Vertrag Zauberberg', body: 'Vertragsentwurf Zauberberg' }), ['\\Seen']);
  timed('Postfächer befüllt (50 Mails)', Date.now() - tStart);

  let { app, page, t0 } = await launch();
  let ids = {};
  await phase('Einrichtung: zwei Konten', async () => {
    await sleep(800);
    await page.keyboard.press('Escape');
    const res = await page.evaluate(async (list) => { const out = []; for (const a of list) out.push((await api.call('accounts:save', a, 'geheim')).id); return out; }, [
      { displayName: 'Büro', email: ME[BUERO], username: 'ortie@test.local', imapHost: '127.0.0.1', imapPort: PROXY, smtpHost: '127.0.0.1', smtpPort: 2526 },
      { displayName: 'Privat (Gmail)', email: ME[GMAIL], username: 'ortie@test.local', imapHost: '127.0.0.1', imapPort: GMAIL, smtpHost: '127.0.0.1', smtpPort: 2526 },
    ]);
    ids = { buero: res[0], gmail: res[1] };
    check('Zwei Konten angelegt', res.length === 2 && res[0] !== res[1]);
    await app.close();
  });

  await phase('Erster Start (ohne Zwischenspeicher)', async () => {
    ({ app, page, t0 } = await launch());
    await page.keyboard.press('Escape');
    check(`Version ${VERSION}`, (await app.evaluate(({ app: a }) => a.getVersion())) === VERSION);
    const tRows = await until(page, () => document.querySelectorAll('#list .row[data-key]').length >= 40, null, 30000);
    check('Smart Inbox zeigt Mails beider Konten', tRows !== null);
    timed('Erster Start bis Liste voll', Date.now() - t0, 15000);
    await idle(page);
    const tf = await until(page, (id) => (S.folders[id] || []).some((f) => f.path === '[Gmail]/Gesendet'), ids.gmail, 15000);
    check('Gmail-Ordner geladen', tf !== null);
    await sleep(1500);
    const st = await page.evaluate((i) => ({
      g: (S.folders[i.gmail] || []).map((f) => ({ path: f.path, name: f.name, role: f.role, sel: f.selectable, all: f.allMail, virt: f.virtual })),
      b: (S.folders[i.buero] || []).map((f) => ({ path: f.path, role: f.role })),
      cats: everyInbox().reduce((o, m) => { o[m.category] = (o[m.category] || 0) + 1; return o; }, {}),
      err: S.error,
    }), ids);
    log(`  Kategorien: ${JSON.stringify(st.cats)}`);
    const g = (p) => st.g.find((f) => f.path === p) || {};
    check('Gmail: [Gmail] als nicht wählbarer Oberordner', g('[Gmail]').sel === false);
    check('Gmail: Gesendet erkannt', g('[Gmail]/Gesendet').role === 'sent');
    check('Gmail: Papierkorb erkannt', g('[Gmail]/Papierkorb').role === 'trash');
    check('Gmail: Spam erkannt', g('[Gmail]/Spam').role === 'junk');
    check('Gmail: Entwürfe mit Umlaut dekodiert', st.g.some((f) => f.name === 'Entwürfe' && f.role === 'drafts'), st.g.map((f) => f.name).join(', '));
    check('Gmail: „Alle Nachrichten“ als allMail', g('[Gmail]/Alle Nachrichten').all === true);
    check('Gmail: „Wichtig“/„Markiert“ virtuell', g('[Gmail]/Wichtig').virt === true && g('[Gmail]/Markiert').virt === true);
    check('Gmail: kein zusätzlicher Ordner „Spam“ angelegt', !st.g.some((f) => f.path === 'Spam'));
    check('Büro: Spam-Ordner automatisch angelegt', st.b.some((f) => f.role === 'junk'));
    check('Newsletter erkannt', st.cats.newsletter >= 6);
    check('Benachrichtigungen erkannt', st.cats.notification >= 4);
    check('Persönliche Mails', st.cats.personal >= 30);
    check('Keine Fehlermeldung nach Start', !st.err, st.err || '');
    const sideText = await page.innerText('#sidebar');
    check('Seitenleiste zeigt beide Konten', sideText.includes(ME[BUERO]) && sideText.includes(ME[GMAIL]));
  });

  await phase('Lesen', async () => {
    await smart(page); await sleep(200);
    const target = 'Projekt Phoenix Abstimmung 21';
    const key = await keyBySubject(page, target);
    check('Ungelesene Mail vorhanden', !!key && !(await page.evaluate((k) => findMessage(k).isRead, key)));
    const ta = Date.now();
    await page.click(`#list .row[data-key="${key}"]`);
    const tBody = await until(page, (k) => !!S.bodies[k], key, 10000);
    timed('Mail öffnen bis Text da', Date.now() - ta, 3000);
    check('Text geladen', tBody !== null);
    check('Lokal sofort gelesen', await page.evaluate((k) => findMessage(k).isRead, key));
    await sleep(1500);
    const srv = (await boxSubjects(BUERO, 'INBOX')).find((m) => m.subject === target);
    check('Auf dem Server gelesen (\\Seen)', srv && srv.seen);
    // mit Pfeiltasten durchblättern
    const tk = Date.now();
    await page.focus('#list').catch(() => {});
    for (let i = 0; i < 8; i++) { await page.keyboard.press('ArrowDown'); await sleep(60); }
    timed('8× Pfeil runter', Date.now() - tk);
    check('Auswahl hat sich bewegt', (await page.evaluate(() => S.selected)) !== key);
  });

  await phase('Antworten (Strg+R, Strg+Enter)', async () => {
    const key = await keyBySubject(page, 'Projekt Phoenix Abstimmung 20');
    await page.click(`#list .row[data-key="${key}"]`);
    await until(page, (k) => !!S.bodies[k], key, 10000);
    await page.keyboard.press('Control+r');
    await page.waitForSelector('.compose #c-body', { timeout: 5000 });
    check('Antwortfenster: Empfänger vorbelegt', /@kunde\.example|@partner\.example|@freunde\.example/.test(await page.inputValue('#c-to')));
    check('Antwortfenster: Betreff „Re:“', /^Re: Projekt Phoenix Abstimmung 20$/.test(await page.inputValue('#c-subject')));
    await page.keyboard.type('Danke, passt so. ');
    const before = smtpLog().length;
    const ts = Date.now();
    await page.keyboard.press('Control+Enter');
    const closed = await until(page, () => !document.querySelector('.compose'), null, 15000);
    timed('Antwort senden bis Fenster zu', Date.now() - ts, 5000);
    check('Fenster schließt nach Senden', closed !== null);
    await sleep(1000);
    const sent = smtpLog().slice(before);
    check('Antwort beim SMTP-Server angekommen', sent.length === 1);
    if (sent[0]) {
      check('Absender = Büro-Konto', /^From: .*ortie@buero\.example/m.test(sent[0].raw));
      check('In-Reply-To gesetzt', /^In-Reply-To: <alltag/m.test(sent[0].raw));
      check('Zitat enthalten', /^> /m.test(sent[0].raw) || /&gt;|blockquote/i.test(sent[0].raw));
      check('Eigener Text enthalten', sent[0].raw.includes('Danke, passt so.'));
    }
    const inSent = (await boxSubjects(BUERO, 'Sent')).map((m) => m.subject);
    check('Kopie in „Sent“ (Büro)', inSent.includes('Re: Projekt Phoenix Abstimmung 20'));
  });

  await phase('Neue Mail aus dem Gmail-Konto (Strg+N)', async () => {
    await page.keyboard.press('Escape');
    await page.click('#list').catch(() => {});
    await page.keyboard.press('Control+n');
    await page.waitForSelector('.compose #c-from', { timeout: 5000 });
    await page.selectOption('#c-from', ids.gmail);
    await page.fill('#c-to', 'anna@kunde.example');
    await page.fill('#c-subject', 'Grillfest Samstag');
    await page.click('#c-body'); await page.keyboard.type('Kommst du auch?');
    const before = smtpLog().length;
    await page.click('.compose [data-x="send"]');
    await until(page, () => !document.querySelector('.compose'), null, 15000);
    await sleep(1500);
    const sent = smtpLog().slice(before);
    check('Gesendet über SMTP', sent.length === 1);
    if (sent[0]) check('Absender = Gmail-Konto', /^From: .*ortie\.privat@gmail-test\.example/m.test(sent[0].raw));
    // Server ist kein echter Gmail-Host → SimpleMail legt die Kopie selbst ab
    const gs = (await boxSubjects(GMAIL, '[Gmail]/Gesendet')).map((m) => m.subject);
    check('Kopie in „[Gmail]/Gesendet“', gs.includes('Grillfest Samstag'));
  });

  await phase('Neue Mails kommen im Laufe des Tages (Push)', async () => {
    await smart(page); await idle(page);
    const lat = [];
    for (let i = 0; i < 3; i++) {
      for (const port of [BUERO, GMAIL]) {
        const subj = `Neu eingetroffen ${port === BUERO ? 'Büro' : 'Gmail'} ${i}`;
        const ta = Date.now();
        await append(port, 'INBOX', mail({ from: 'maria@kunde.example', name: 'Maria Schulz', to: ME[port], subject: subj }));
        const t = await until(page, (s) => [...document.querySelectorAll('#list .row[data-key]')].some((r) => r.textContent.includes(s)), subj, 20000);
        lat.push(t === null ? null : Date.now() - ta);
        check(`Push: „${subj}“ erscheint ohne Klick`, t !== null);
      }
      await sleep(500);
    }
    const okLat = lat.filter((x) => x !== null);
    if (okLat.length) timed('Push-Verzögerung Ø', okLat.reduce((a, b) => a + b, 0) / okLat.length, 6000);
    check('Badge/Zähler im Konto-Eintrag', /\d/.test(await page.innerText('#sidebar .account-item[data-acc=""]')));
  });

  await phase('Regel: Rechnungen automatisch in „Projekte“', async () => {
    await page.evaluate((email) => {
      S.settings.rules.push({ id: uuid(), name: 'Rechnungen', enabled: true, accountEmail: email, match: 'all', order: 1,
        conditions: [{ field: 'subject', op: 'contains', value: 'Rechnung, Invoice' }], actions: { moveTo: 'Projekte', markRead: true, flag: false },
        updatedAt: now(), deleted: false });
      return saveSettings();
    }, ME[BUERO]);
    await sleep(500);
    await append(BUERO, 'INBOX', mail({ from: 'buchhaltung@lieferant.example', name: 'Lieferant GmbH', to: ME[BUERO], subject: 'Rechnung 4711' }));
    await append(BUERO, 'INBOX', mail({ from: 'billing@saas.example', name: 'SaaS', to: ME[BUERO], subject: 'Your Invoice March' }));
    await sleep(4000); await page.evaluate(() => refresh()); await idle(page); await sleep(1500);
    const proj = await boxSubjects(BUERO, 'Projekte');
    const inbox = (await boxSubjects(BUERO, 'INBOX')).map((m) => m.subject);
    check('Regel verschiebt „Rechnung 4711“', proj.some((m) => m.subject === 'Rechnung 4711'));
    check('Regel: zweiter Begriff (Komma) greift', proj.some((m) => m.subject === 'Your Invoice March'));
    check('Regel: als gelesen markiert', proj.filter((m) => /Rechnung|Invoice/.test(m.subject)).every((m) => m.seen));
    check('Nicht mehr im Posteingang (Server)', !inbox.includes('Rechnung 4711'));
    check('Nicht in der Liste', !(await shown(page, 'Rechnung 4711')));
  });

  await phase('Spam', async () => {
    const spamHdr = ['X-Spam-Flag: YES', 'Authentication-Results: mx.test; dmarc=fail (p=reject) header.from=paypal.com; spf=fail'];
    await append(BUERO, 'INBOX', mail({ from: 'security@paypa1-verify.example', name: 'PayPal Service', to: ME[BUERO], subject: 'DRINGEND: Konto gesperrt!!!', headers: spamHdr }));
    await append(GMAIL, 'INBOX', mail({ from: 'win@lotto-gewinn.example', name: 'Lotto', to: ME[GMAIL], subject: 'GEWINN!!! Sie haben gewonnen', headers: spamHdr }));
    await sleep(4000); await page.evaluate(() => refresh()); await idle(page); await sleep(1500);
    const bJunk = await page.evaluate((id) => junkFolderOf(id), ids.buero);
    const bSpam = bJunk ? (await boxSubjects(BUERO, bJunk)).map((m) => m.subject) : [];
    const gSpam = (await boxSubjects(GMAIL, '[Gmail]/Spam')).map((m) => m.subject);
    check('Büro: Phishing automatisch im Spam', bSpam.includes('DRINGEND: Konto gesperrt!!!'), bJunk || 'kein Spam-Ordner');
    check('Gmail: Spam landet in „[Gmail]/Spam“', gSpam.includes('GEWINN!!! Sie haben gewonnen'));
    check('Spam nicht in der Smart Inbox', !(await shown(page, 'DRINGEND')) && !(await shown(page, 'GEWINN')));
    // manuell als Spam markieren, dann „Kein Spam“
    const k = await keyBySubject(page, 'Angebote der Woche 0');
    await page.evaluate((kk) => markSpam(findMessage(kk), null), k);
    await sleep(1500);
    check('Manuell: Newsletter im Spam-Ordner', (await boxSubjects(BUERO, bJunk)).some((m) => m.subject === 'Angebote der Woche 0'));
    await view(page, { type: 'spam' });
    const tSpam = await until(page, () => [...document.querySelectorAll('#list .row[data-key]')].some((r) => r.textContent.includes('Angebote der Woche 0')), null, 10000);
    check('Kategorie „Spam“ zeigt Spam beider Konten', tSpam !== null && (await shown(page, 'GEWINN')));
    const sk = await page.evaluate(() => { const m = S.folderMsgs.find((x) => x.subject === 'Angebote der Woche 0'); return m ? keyOf(m) : null; });
    await page.evaluate((kk) => markNotSpam(findMessage(kk)), sk);
    await sleep(1500);
    check('„Kein Spam“: zurück im Posteingang', (await boxSubjects(BUERO, 'INBOX')).some((m) => m.subject === 'Angebote der Woche 0'));
    check('„Kein Spam“: Absender vertraut', await page.evaluate(() => !!S.settings.trusted['news@shop.example']));
    await smart(page); await sleep(300);
  });

  await phase('Löschen (Entf) und nächste Mail', async () => {
    await page.evaluate(() => refresh()); await idle(page);
    const order = await page.$$eval('#list .row[data-key]', (r) => r.map((x) => x.dataset.key));
    const key = order[2];
    const subj = await page.evaluate((k) => findMessage(k).subject, key);
    await page.click(`#list .row[data-key="${key}"]`); await sleep(300);
    const ta = Date.now();
    await page.keyboard.press('Delete');
    timed('Entf bis Liste aktualisiert', Date.now() - ta, 500);
    const sel = await page.evaluate(() => S.selected);
    check('Auswahl springt zur nächsten', sel === order[3], sel === order[3] ? '' : `${sel} statt ${order[3]}`);
    await sleep(2000);
    const isB = key.startsWith(ids.buero);
    const trash = isB ? 'Trash' : '[Gmail]/Papierkorb';
    check(`Im Papierkorb (${trash})`, (await boxSubjects(isB ? BUERO : GMAIL, trash)).some((m) => m.subject === subj));
    await page.evaluate(() => refresh()); await idle(page); await sleep(500);
    check('Bleibt nach Abruf weg', !(await page.$(`#list .row[data-key="${key}"]`)));
    // Gmail-Mail löschen
    const gk = await keyBySubject(page, 'Privat Grillfest 3');
    await page.evaluate((k) => remove(findMessage(k)), gk);
    await sleep(2000);
    check('Gmail: gelöschte Mail in „[Gmail]/Papierkorb“', (await boxSubjects(GMAIL, '[Gmail]/Papierkorb')).some((m) => m.subject === 'Privat Grillfest 3'));
  });

  await phase('Verschieben (Ordner + anderes Konto)', async () => {
    const k1 = await keyBySubject(page, 'Projekt Phoenix Abstimmung 5');
    await page.evaluate((k) => moveTo(findMessage(k), 'Archiv'), k1);
    await sleep(1500);
    check('Büro → Archiv', (await boxSubjects(BUERO, 'Archiv')).some((m) => m.subject === 'Projekt Phoenix Abstimmung 5'));
    const k2 = await keyBySubject(page, 'Projekt Phoenix Abstimmung 6');
    await page.evaluate(([k, acc]) => moveTo(findMessage(k), 'Privat', acc), [k2, ids.gmail]);
    await sleep(3000);
    check('Büro → Gmail/Privat (kontoübergreifend)', (await boxSubjects(GMAIL, 'Privat')).some((m) => m.subject === 'Projekt Phoenix Abstimmung 6'));
    check('Quelle leer danach', !(await boxSubjects(BUERO, 'INBOX')).some((m) => m.subject === 'Projekt Phoenix Abstimmung 6'));
    // Ordner öffnen und Inhalt sehen
    await view(page, { type: 'folder', acc: ids.gmail, path: 'Privat' });
    const tf = await until(page, () => [...document.querySelectorAll('#list .row[data-key]')].some((r) => r.textContent.includes('Projekt Phoenix Abstimmung 6')), null, 10000);
    check('Gmail-Ordner „Privat“ zeigt verschobene Mail', tf !== null);
    if (tf !== null) timed('Ordner öffnen', tf, 3000);
    // Gmail „Alle Nachrichten“ öffnen
    await view(page, { type: 'folder', acc: ids.gmail, path: '[Gmail]/Alle Nachrichten' });
    await sleep(1500);
    check('„Alle Nachrichten“ öffnet ohne Fehler', !(await page.evaluate(() => S.error)), await page.evaluate(() => S.error || ''));
    await smart(page); await sleep(300);
  });

  await phase('Suchen', async () => {
    await page.click('#list').catch(() => {});
    await page.keyboard.press('Control+f');
    await page.keyboard.type('Grillfest');
    await sleep(500);
    const loc = await subjectsShown(page);
    check('Lokal: nur Grillfest-Mails', loc.length > 0 && loc.every((s) => /Grillfest/.test(s)), `${loc.length} Treffer`);
    await page.fill('#search', 'Zauberberg');
    const ts = Date.now();
    await page.press('#search', 'Enter');
    const t = await until(page, () => S.searchResults && S.searchResults.length >= 2 && !S.searching, null, 20000);
    timed('Serversuche über alle Ordner beider Konten', Date.now() - ts, 8000);
    const r = await subjectsShown(page);
    check('Treffer in Gmail (über „Alle Nachrichten“)', r.some((s) => s.includes('Urlaubsfotos Zauberberg')), r.join(' | '));
    check('Keine Dubletten', new Set(r).size === r.length);
    check('Treffer in Büro/Projekte', r.some((s) => s.includes('Vertrag Zauberberg')));
    check('Suche fertig', t !== null);
    await page.focus('#search'); await page.keyboard.press('Escape'); await sleep(300);
    check('Esc beendet Suche', !(await page.evaluate(() => S.searchResults)));
  });

  await phase('Später (Snooze)', async () => {
    await smart(page); await sleep(200);
    const key = await keyBySubject(page, 'Privat Grillfest 10');
    const until2 = Date.now() + 4000;
    await page.evaluate(([k, t]) => snooze(findMessage(k), new Date(t)), [key, until2]);
    await sleep(300);
    check('Zurückgestellt: aus Smart Inbox verschwunden', !(await shown(page, 'Privat Grillfest 10')));
    await view(page, { type: 'snoozed' }); await sleep(300);
    check('In „Später“ sichtbar', await shown(page, 'Privat Grillfest 10'));
    await sleep(4500);
    await page.evaluate(() => tick()); await sleep(800);
    await smart(page); await sleep(300);
    check('Nach Ablauf wieder in Smart Inbox', await shown(page, 'Privat Grillfest 10'));
    check('Nach Ablauf wieder ungelesen', !(await page.evaluate((k) => findMessage(k).isRead, key)));
  });

  await phase('Kontowechsel', async () => {
    const tm = [];
    for (const [name, id] of [['Büro', ids.buero], ['Gmail', ids.gmail], ['Alle', '']]) {
      const ta = Date.now();
      await page.click(`#sidebar .account-item[data-acc="${id}"]`);
      await page.waitForSelector(`#sidebar .account-item.active[data-acc="${id}"]`, { timeout: 3000 });
      tm.push(Date.now() - ta);
      const accs = await page.$$eval('#list .row[data-key]', (r) => [...new Set(r.map((x) => x.dataset.key.split('|')[0]))]);
      if (id) check(`Nur Mails von ${name}`, accs.length === 1 && accs[0] === id);
      else check('Alle Konten wieder gemischt', accs.length === 2);
    }
    timed('Kontowechsel Ø', tm.reduce((a, b) => a + b, 0) / tm.length, 300);
    // Antworten im gefilterten Konto nutzt dieses Konto
    await page.click(`#sidebar .account-item[data-acc="${ids.gmail}"]`); await sleep(200);
    check('Neue Mail im Gmail-Filter: Absender Gmail', await page.evaluate((id) => newDraft().accountId === id, ids.gmail));
    await page.click('#sidebar .account-item[data-acc=""]'); await sleep(200);
  });

  await phase('Zweitgerät (Handy) ändert das Postfach', async () => {
    await smart(page); await idle(page);
    // Handy liest eine Mail, markiert eine, löscht eine – SimpleMail soll das per Push übernehmen
    const subjRead = await page.evaluate((id) => (S.inbox[id].find((m) => !m.isRead && /Phoenix/.test(m.subject)) || {}).subject, ids.buero); const subjFlag = 'Projekt Phoenix Abstimmung 17'; const subjDel = 'Projekt Phoenix Abstimmung 16';
    const kR = await keyBySubject(page, subjRead);
    check('Vorher ungelesen', kR && !(await page.evaluate((k) => findMessage(k).isRead, kR)));
    await imap(BUERO, async (c) => {
      const lock = await c.getMailboxLock('INBOX');
      try {
        const find = async (s) => (await c.search({ subject: s }, { uid: true }))[0];
        await c.messageFlagsAdd(String(await find(subjRead)), ['\\Seen'], { uid: true });
        await c.messageFlagsAdd(String(await find(subjFlag)), ['\\Flagged'], { uid: true });
        await c.messageMove(String(await find(subjDel)), 'Trash', { uid: true });
      } finally { lock.release(); }
    });
    const t1 = await until(page, (s) => { const m = everyInbox().find((x) => x.subject === s); return m && m.isRead; }, subjRead, 15000);
    check('Am Handy gelesen → hier gelesen', t1 !== null);
    if (t1 !== null) timed('Gelesen-Status vom Zweitgerät', t1, 8000);
    const t2 = await until(page, (s) => { const m = everyInbox().find((x) => x.subject === s); return m && m.isFlagged; }, subjFlag, 15000);
    check('Am Handy markiert → hier markiert', t2 !== null);
    const t3 = await until(page, (s) => !everyInbox().some((x) => x.subject === s) && ![...document.querySelectorAll('#list .row')].some((r) => r.textContent.includes(s)), subjDel, 15000);
    check('Am Handy gelöscht → hier verschwunden', t3 !== null);
    const unreadSide = await page.evaluate(() => unreadCount());
    const unreadSrv = (await boxSubjects(BUERO, 'INBOX')).filter((m) => !m.seen).length + (await boxSubjects(GMAIL, 'INBOX')).filter((m) => !m.seen).length;
    check('Ungelesen-Zähler stimmt mit Servern überein', unreadSide === unreadSrv, `App ${unreadSide}, Server ${unreadSrv}`);
  });

  await phase('Weitere Handgriffe: Markieren, Archivieren, Sammelaktion, Weiterleiten, Später senden', async () => {
    await smart(page); await idle(page);
    // Markieren mit S → Server
    const kF = await keyBySubject(page, 'Projekt Phoenix Abstimmung 15');
    await page.click(`#list .row[data-key="${kF}"]`); await sleep(200);
    await page.keyboard.press('s'); await sleep(1500);
    check('Taste S markiert auf dem Server', await imap(BUERO, async (c) => { const l = await c.getMailboxLock('INBOX'); try { const u = (await c.search({ subject: 'Projekt Phoenix Abstimmung 15', flagged: true }, { uid: true })); return u.length === 1; } finally { l.release(); } }));
    await view(page, { type: 'flagged' }); await sleep(300);
    check('Ansicht „Markiert“ zeigt sie', await shown(page, 'Projekt Phoenix Abstimmung 15'));
    await smart(page); await sleep(200);
    // Gmail: Archivieren (E) = raus aus dem Posteingang, bleibt in „Alle Nachrichten“
    const kA = await keyBySubject(page, 'Privat Grillfest 12');
    await page.click(`#list .row[data-key="${kA}"]`); await sleep(200);
    await page.keyboard.press('e'); await sleep(2000);
    const gIn = (await boxSubjects(GMAIL, 'INBOX')).map((m) => m.subject);
    const gAll = (await boxSubjects(GMAIL, '[Gmail]/Alle Nachrichten')).map((m) => m.subject);
    check('Gmail-Archiv: aus Posteingang raus', !gIn.includes('Privat Grillfest 12'));
    check('Gmail-Archiv: in „Alle Nachrichten“', gAll.includes('Privat Grillfest 12'));
    // Sammelaktion: 3 Newsletter mit Strg-Klick auswählen und als gelesen markieren, dann löschen
    const nk = await page.evaluate(() => displayedMessages().filter((m) => m.category === 'newsletter').slice(0, 3).map(keyOf));
    await page.click(`#list .row[data-key="${nk[0]}"]`);
    for (const k of nk.slice(1)) await page.click(`#list .row[data-key="${k}"]`, { modifiers: ['Control'] });
    check('Mehrfachauswahl aktiv (3)', await page.evaluate(() => S.multi.size) === 3);
    const subs = await page.evaluate((ks) => ks.map((k) => findMessage(k).subject), nk);
    await page.keyboard.press('Delete'); await sleep(2000);
    const trash = (await boxSubjects(BUERO, 'Trash')).map((m) => m.subject);
    check('Sammel-Löschen: alle 3 im Papierkorb', subs.every((x) => trash.includes(x)), subs.join(', '));
    // Weiterleiten mit Anhang
    await append(BUERO, 'INBOX', ['From: Anna Becker <anna@kunde.example>', `To: ${ME[BUERO]}`, 'Subject: =?UTF-8?B?QW5nZWJvdCBmw7xyIELDvHJvbcO2YmVs?=', `Date: ${rfcDate(new Date())}`,
      'Message-ID: <anhang1@test>', 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="b1"', '', '--b1', 'Content-Type: text/html; charset=utf-8', '',
      '<p>Anbei das <b>Angebot</b> – Größe ändern? Grüße</p>', '--b1', 'Content-Type: application/pdf; name="angebot.pdf"', 'Content-Disposition: attachment; filename="angebot.pdf"', 'Content-Transfer-Encoding: base64', '',
      Buffer.from('%PDF-1.4 Testangebot').toString('base64'), '--b1--', ''].join('\r\n'));
    const tA = await until(page, () => everyInbox().some((m) => m.subject === 'Angebot für Büromöbel'), null, 15000);
    check('Betreff mit Umlauten (kodiert) richtig', tA !== null);
    const kW = await keyBySubject(page, 'Angebot für Büromöbel');
    await page.click(`#list .row[data-key="${kW}"]`);
    await until(page, (k) => !!S.bodies[k], kW, 8000);
    check('Anhang angezeigt', await page.evaluate((k) => visibleAttachments(S.bodies[k]).some((a) => a.filename === 'angebot.pdf'), kW));
    await page.keyboard.press('Control+Shift+f');
    await page.waitForSelector('.compose #c-to', { timeout: 5000 });
    await page.fill('#c-to', 'jonas@partner.example');
    const before = smtpLog().length;
    await page.click('.compose [data-x="send"]');
    await until(page, () => !document.querySelector('.compose'), null, 15000); await sleep(1000);
    const fw = smtpLog().slice(before)[0];
    check('Weiterleitung gesendet', !!fw);
    if (fw) {
      check('Weiterleitung: Betreff „WG:“ mit Umlauten', /^Subject: .*/m.test(fw.raw) && /WG: Angebot f(ü|=C3=BC)r|=\?UTF-8\?/i.test(fw.raw));
      check('Weiterleitung: Anhang dabei', /filename="?angebot\.pdf/.test(fw.raw));
    }
    // Später senden (in 3 s) → Geplant → wird verschickt
    const before2 = smtpLog().length;
    await page.evaluate(async (id) => { await api.call('mail:schedule', { accountId: id, to: 'maria@kunde.example', cc: '', subject: 'Geplante Mail', body: 'Kommt später', attachments: [] }, new Date(Date.now() + 3000).toISOString()); }, ids.buero);
    await sleep(500);
    check('Geplant: in Ausgangsliste', await page.evaluate(async () => (await api.call('outbox:list')).some((o) => o.subject === 'Geplante Mail')));
    const tG = Date.now();
    let got = false;
    for (let i = 0; i < 90 && !got; i++) { await sleep(1000); got = smtpLog().slice(before2).some((x) => /Subject: Geplante Mail/.test(x.raw)); }
    check('Geplante Mail wurde verschickt (≤ 90 s)', got);
    if (got) timed('Geplant: Verzögerung nach Fälligkeit', Date.now() - tG + 500);
  });

  await phase('Verbindungsabbruch (WLAN weg, Laptop zugeklappt)', async () => {
    await smart(page); await idle(page);
    cutNetwork(true);
    await sleep(3000);
    // Während offline: Mail löschen → muss nach Wiederverbindung trotzdem auf dem Server ankommen
    const kOff = await keyBySubject(page, 'Projekt Phoenix Abstimmung 14');
    await page.evaluate((k) => remove(findMessage(k)), kOff);
    await sleep(500);
    await page.evaluate(() => refresh()); await idle(page);
    const st = await page.evaluate(() => ({ offline: S.offline, err: S.error }));
    check('Abbruch: Hinweis offline statt Fehlermeldung', st.offline || !st.err, JSON.stringify(st));
    await sleep(8000);
    cutNetwork(false);
    const tBack = Date.now();
    // neue Mail nach Wiederverbindung → Push muss sich selbst neu verbinden
    await sleep(500);
    await append(BUERO, 'INBOX', mail({ from: 'anna@kunde.example', name: 'Anna Becker', to: ME[BUERO], subject: 'Nach dem Abbruch' }));
    const t = await until(page, () => [...document.querySelectorAll('#list .row[data-key]')].some((r) => r.textContent.includes('Nach dem Abbruch')), null, 60000);
    check('Nach Abbruch: neue Mail kommt ohne Klick (≤ 60 s)', t !== null);
    if (t !== null) timed('Wiederverbindung bis neue Mail sichtbar', Date.now() - tBack, 30000);
    const pushOn = await until(page, (id) => !!S.push[id], ids.buero, 30000);
    check('Push wieder aktiv', pushOn !== null);
    await page.evaluate(() => refresh()); await idle(page); await sleep(1000);
    const inbox = (await boxSubjects(BUERO, 'INBOX')).map((m) => m.subject);
    check('Offline gelöschte Mail ist auf dem Server gelöscht', !inbox.includes('Projekt Phoenix Abstimmung 14'));
    check('Offline gelöschte Mail bleibt in der Liste weg', !(await shown(page, 'Projekt Phoenix Abstimmung 14')));
    check('Keine hängende Fehlermeldung', !(await page.evaluate(() => S.error)), await page.evaluate(() => S.error || ''));
  });

  await phase('Neustart mit Zwischenspeicher', async () => {
    // offline löschen und App schließen, bevor das Netz zurück ist → Löschen muss nach dem Neustart nachgeholt werden
    cutNetwork(true); await sleep(1500);
    const kQ = await keyBySubject(page, 'Projekt Phoenix Abstimmung 13');
    await page.evaluate((k) => remove(findMessage(k)), kQ); await sleep(800);
    const before = await page.$$eval('#list .row[data-key]', (r) => r.length);
    await app.close();
    cutNetwork(false);
    ({ app, page, t0 } = await launch());
    await page.keyboard.press('Escape');
    const t = await until(page, (n) => document.querySelectorAll('#list .row[data-key]').length >= n - 2, before, 20000);
    timed('Neustart bis Liste da (Cache)', Date.now() - t0, 4000);
    check('Liste nach Neustart vollständig', t !== null);
    const tf = await until(page, (id) => !!document.querySelector(`#sidebar .side-item[data-drop-acc="${id}"][data-drop-path="[Gmail]/Gesendet"]`), ids.gmail, 5000);
    check('Gmail-Ordner sofort aus Zwischenspeicher', tf !== null);
    await idle(page);
    check('Snooze-Zustand erhalten (Grillfest 10 sichtbar)', await shown(page, 'Privat Grillfest 10'));
    check('Offline-Löschen nach Neustart nachgeholt', !(await boxSubjects(BUERO, 'INBOX')).some((m) => m.subject === 'Projekt Phoenix Abstimmung 13'));
    check('… und nicht wieder in der Liste', !(await shown(page, 'Projekt Phoenix Abstimmung 13')));
    check('Regel erhalten', await page.evaluate(() => S.settings.rules.some((r) => r.name === 'Rechnungen' && !r.deleted)));
    check('Start wieder in Smart Inbox über alle Konten', await page.evaluate(() => S.view.type === 'smart' && !S.settings.accountFilter));
  });

  if (LAST) await phase('Last: 2000 Mails im Büro-Posteingang', async () => {
    const ta = Date.now();
    await imap(BUERO, async (c) => {
      for (let i = 0; i < 2000; i++) {
        const [n, a] = people[i % people.length];
        await c.append('INBOX', mail({ from: a, name: n, to: ME[BUERO], subject: `Massenmail ${i}`, date: new Date(day - (i + 1) * 600e3), headers: i % 5 === 0 ? ['List-Id: <massen.example>'] : [] }), i % 3 ? ['\\Seen'] : []);
      }
    });
    timed('2000 Mails eingespielt', Date.now() - ta);
    const tr = Date.now();
    await page.evaluate(() => refresh()); await idle(page);
    timed('Abruf nach 2000 neuen Mails', Date.now() - tr, 20000);
    const n = await page.$$eval('#list .row[data-key]', (r) => r.length);
    log(`  Zeilen in der Liste: ${n}`);
    const tr2 = Date.now();
    await page.evaluate(() => refresh()); await idle(page);
    timed('Zweiter Abruf (nichts Neues)', Date.now() - tr2, 3000);
    const perf = await page.evaluate(async () => {
      const keys = [...document.querySelectorAll('#list .row[data-key]')].slice(0, 30).map((r) => r.dataset.key);
      const t = [];
      for (const k of keys) { const a = performance.now(); document.querySelector(`.row[data-key="${CSS.escape(k)}"]`).click(); t.push(performance.now() - a); await new Promise((r) => setTimeout(r, 30)); }
      const b = performance.now(); for (let i = 0; i < 10; i++) renderAll(); const ra = (performance.now() - b) / 10;
      return { open: t.reduce((x, y) => x + y, 0) / t.length, max: Math.max(...t), renderAll: ra, heap: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0 };
    });
    timed('Mail auswählen Ø (synchron)', perf.open, 50);
    timed('Mail auswählen max', perf.max, 200);
    timed('renderAll Ø', perf.renderAll, 60);
    log(`  JS-Speicher Oberfläche: ${perf.heap.toFixed(0)} MB`);
    check('Speicher Oberfläche unter 300 MB', perf.heap < 300);
    const mem = await app.evaluate(async ({ app: a }) => a.getAppMetrics().reduce((s, m) => s + m.memory.workingSetSize, 0) / 1024);
    log(`  Arbeitsspeicher gesamt: ${mem.toFixed(0)} MB`);
    const tsw = Date.now();
    await page.click(`#sidebar .account-item[data-acc="${ids.buero}"]`); await page.click('#sidebar .account-item[data-acc=""]');
    timed('Kontowechsel hin und zurück bei 2000 Mails', Date.now() - tsw, 800);
    const tS = Date.now();
    await page.fill('#search', 'Massenmail 1999'); await sleep(400);
    timed('Lokale Suche bei 2000 Mails', Date.now() - tS - 150, 600);
    await page.focus('#search'); await page.keyboard.press('Escape');
    await app.close();
    ({ app, page, t0 } = await launch());
    await page.keyboard.press('Escape');
    const t = await until(page, () => document.querySelectorAll('#list .row[data-key]').length >= 100, null, 20000);
    check('Neustart mit großem Cache', t !== null);
    timed('Neustart bis Liste (2000 Mails im Cache)', Date.now() - t0, 5000);
    await idle(page);
  });

  await phase('Offline: Server weg, App startet trotzdem', async () => {
    await app.close();
    stopServer(); await sleep(800);
    ({ app, page, t0 } = await launch());
    await page.keyboard.press('Escape');
    const t = await until(page, () => document.querySelectorAll('#list .row[data-key]').length >= 20, null, 10000);
    check('Mails aus dem Zwischenspeicher sichtbar', t !== null);
    timed('Offline-Start bis Liste', Date.now() - t0, 4000);
    await sleep(4000);
    const st = await page.evaluate(() => ({ offline: S.offline, err: S.error }));
    check('Als offline erkannt, keine Fehlerflut', st.offline && !st.err, JSON.stringify(st));
    const k = await page.$eval('#list .row[data-key]', (r) => r.dataset.key);
    await page.click(`#list .row[data-key="${k}"]`);
    const tb = await until(page, (kk) => !!S.bodies[kk], k, 5000);
    check('Neueste Mail offline lesbar (Vorausladen)', tb !== null);
    await page.screenshot({ path: path.join(__dirname, 'shot-alltag.png') });
    await app.close();
  });

  check('Keine Skriptfehler in der Oberfläche', uiErrors.length === 0, uiErrors.slice(0, 3).join(' | '));
  stopServer(); proxy.close();
  log(`\n${ok} OK, ${fail} FEHLER – Gesamtdauer ${Math.round((Date.now() - tStart) / 1000)} s`);
  log('\nZeiten:'); for (const t of times) log(`  ${t.name.padEnd(48)} ${String(t.ms).padStart(6)} ms${t.limit ? `  ${t.ms < t.limit ? '✓' : '✗'} < ${t.limit}` : ''}`);
  fs.writeFileSync(path.join(__dirname, 'alltag-bericht.txt'), `SimpleMail ${VERSION} – Alltagstest ${new Date().toISOString()}\n${lines.join('\n')}\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); stopServer(); process.exit(1); });
