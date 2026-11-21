// 3.2.34: Erinnerung an die Google-Neuanmeldung (App im Google-Testmodus → Refresh-Token gilt 7 Tage).
// Lebensdauer per SIMPLEMAIL_GOOGLE_LIFETIME_MS auf 8 s verkürzt → Hinweis ab ~6,9 s („Tag 6“).
// Google wird durch eine Attrappe ersetzt; sie kann „invalid_grant“ (abgelaufene Anmeldung) liefern.
const { _electron } = require('playwright-core');
const http = require('http');
const fs = require('fs'); const path = require('path');
const APP = path.resolve(__dirname, '../app');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0; const check = (name, ok) => { console.log(ok ? 'OK  ' : 'FAIL', name); if (!ok) fail++; };

const GPORT = 18792;
const LIFETIME = 8000;
const tokens = [];
let refreshDead = false;   // true → Refresh-Token ungültig (wie nach 7 Tagen)
let rt = 0;
const gserver = http.createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${GPORT}`);
  if (u.pathname === '/auth') {
    res.writeHead(302, { Location: `${u.searchParams.get('redirect_uri')}/?code=c${Date.now()}&state=${u.searchParams.get('state')}` }); res.end(); return;
  }
  if (u.pathname === '/token') {
    let body = ''; req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const p = Object.fromEntries(new URLSearchParams(body));
      tokens.push(p);
      if (p.grant_type === 'refresh_token' && refreshDead) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })); return;
      }
      if (p.grant_type === 'authorization_code') refreshDead = false;
      const idt = `x.${Buffer.from(JSON.stringify({ email: 'ortie@gmail.com' })).toString('base64')}.y`;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ access_token: `at${Date.now()}`, expires_in: 3600, refresh_token: `rt-${++rt}`, id_token: idt }));
    });
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ items: [] }));
});

(async () => {
  await new Promise((r) => gserver.listen(GPORT, '127.0.0.1', r));
  const DIR = path.join(__dirname, 'data-gerinnerung');
  fs.rmSync(DIR, { recursive: true, force: true });
  const app = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox'], env: {
    ...process.env, SIMPLEMAIL_DATA: DIR, SIMPLEMAIL_GOOGLE_LIFETIME_MS: String(LIFETIME),
    SIMPLEMAIL_GOOGLE_AUTH: `http://127.0.0.1:${GPORT}/auth`, SIMPLEMAIL_GOOGLE_TOKEN: `http://127.0.0.1:${GPORT}/token`,
    SIMPLEMAIL_GOOGLE_API: `http://127.0.0.1:${GPORT}/api` } });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => { console.log('PAGEERROR', e.message); fail++; });
  await page.waitForLoadState('domcontentloaded'); await sleep(1500);
  await app.evaluate(({ shell }) => { shell.openExternal = async (u) => { fetch(u).catch(() => {}); }; });
  await page.evaluate(async () => {
    await api.call('accounts:save', { displayName: 'Ortie', email: 'ortie@test.local', username: 'ortie@test.local', imapHost: '127.0.0.1', imapPort: 1143, smtpHost: '127.0.0.1', smtpPort: 2525 }, 'geheim');
  });
  await sleep(500);
  // Willkommensdialog (nicht schließbar ohne Konto) entfernen – Konto ist angelegt
  await page.evaluate(() => { document.querySelector('#modal-root').innerHTML = ''; });
  check('Kein Dialog offen', !(await page.evaluate(() => document.querySelector('#modal-root').children.length)));

  const banner = () => page.evaluate(() => {
    renderGoogleBanner();
    const el = document.querySelector('#gBanner');
    return { shown: !el.classList.contains('hidden'), kind: el.dataset.kind, expired: el.classList.contains('expired'), text: el.textContent.replace(/\s+/g, ' ').trim(),
      btn: !!el.querySelector('[data-act="g-reconnect"]'), later: !!el.querySelector('[data-act="g-later"]'),
      appH: document.querySelector('#app').getBoundingClientRect().height, bannerBottom: el.getBoundingClientRect().bottom,
      appTop: document.querySelector('#app').getBoundingClientRect().top, winH: window.innerHeight };
  });

  // 1) Verbinden → Zeitpunkt gemerkt, noch kein Hinweis
  const t0 = Date.now();
  await page.evaluate(() => api.call('google:connect', 'test.apps.googleusercontent.com', 'GOCSPX-x'));
  await page.evaluate(async () => { S.google = await api.call('google:status'); });
  let st = await page.evaluate(() => S.google);
  check('Verbindungszeitpunkt gemerkt', st.connectedAt >= t0 - 50 && st.connectedAt <= Date.now() && st.expiresAt === st.connectedAt + LIFETIME);
  check('Erinnerung standardmäßig an', st.remind === true);
  let b = await banner();
  check('Frisch verbunden: kein Hinweis', !b.shown);

  // 2) „Tag 6“ → gelber Hinweis mit Button
  const warnAt = st.expiresAt - LIFETIME / 7;
  await sleep(Math.max(0, warnAt - Date.now()) + 200);
  b = await banner();
  console.log('Hinweis:', b.text);
  check('Ab Tag 6: Hinweis sichtbar', b.shown && b.kind === 'soon' && !b.expired && /läuft .* ab/.test(b.text));
  check('Hinweis hat „Jetzt neu anmelden“ + „Später“', b.btn && b.later && /Jetzt neu anmelden/.test(b.text));
  check('Layout: Hinweis über den Spalten, nichts abgeschnitten', b.appTop >= b.bannerBottom - 1 && Math.abs(b.appTop + b.appH - b.winH) <= 1);
  // Terminspalte zeigt den Hinweis ebenfalls
  await page.evaluate(() => { S.settings.layout.calOpen = true; renderCalendar(); });
  check('Terminspalte: Hinweis + Button', await page.evaluate(() => !!document.querySelector('#calPane .cal-warn [data-act="g-reconnect"]')));
  await page.screenshot({ path: path.join(__dirname, 'shot-google-erinnerung.png') });

  // 3) „Später“ blendet aus
  await page.click('#gBanner [data-act="g-later"]');
  b = await banner();
  check('„Später“ blendet aus', !b.shown);

  // 4) Google meldet invalid_grant → roter Hinweis trotz „Später“
  refreshDead = true;
  st = await page.evaluate(async () => { S.google = await api.call('google:check'); return S.google; });
  check('Prüfung erkennt abgelaufene Anmeldung', st.expired === true && st.connected === true);
  b = await banner();
  console.log('Hinweis:', b.text);
  check('Abgelaufen: roter Hinweis mit „Neu anmelden“', b.shown && b.expired && b.btn && /abgelaufen/.test(b.text));
  await page.evaluate(() => renderCalendar());
  check('Terminspalte: „Neu anmelden“', await page.evaluate(() => !!document.querySelector('#calPane .cal-empty [data-act="g-reconnect"]')));
  await page.screenshot({ path: path.join(__dirname, 'shot-google-abgelaufen.png') });

  // 5) Klick auf „Neu anmelden“ → Anmeldung mit gespeicherter Client-ID + Schlüssel
  tokens.length = 0;
  await page.click('#gBanner [data-act="g-reconnect"]');
  for (let i = 0; i < 40; i++) { if ((await page.evaluate(() => S.google.expired)) === false) break; await sleep(150); }
  await sleep(300);
  st = await page.evaluate(() => S.google);
  check('Neu angemeldet mit gespeicherten Schlüsseln', st.expired === false && tokens.some((t) => t.grant_type === 'authorization_code' && t.client_id === 'test.apps.googleusercontent.com' && t.client_secret === 'GOCSPX-x'));
  check('Neuer Verbindungszeitpunkt', st.connectedAt > warnAt);
  b = await banner();
  check('Hinweis danach weg', !b.shown);

  // 6) Menü Datei → „Google Kalender neu anmelden“
  const menuHas = await app.evaluate(({ Menu }) => JSON.stringify(Menu.getApplicationMenu().items[0].submenu.items.map((i) => i.label)).includes('Google Kalender neu anmelden'));
  check('Menüeintrag vorhanden', menuHas);
  tokens.length = 0;
  await page.evaluate(() => handleMenu('google-reconnect'));
  for (let i = 0; i < 40 && !tokens.some((t) => t.grant_type === 'authorization_code'); i++) await sleep(150);
  check('Menü startet Anmeldung', tokens.some((t) => t.grant_type === 'authorization_code'));
  await sleep(500);

  // 7) Einstellungen → Kalender: Ablaufdatum, Erinnerung abschaltbar
  await page.evaluate(() => openSettings({ tab: 'calendar' }));
  await sleep(500);
  const s1 = await page.evaluate(() => ({ due: (document.querySelector('#g-due') || {}).textContent || '', remind: (document.querySelector('#g-remind') || {}).checked,
    btn: !!document.querySelector('[data-x="g-reconnect"]') }));
  console.log('Einstellungen:', s1.due.replace(/\s+/g, ' ').trim());
  check('Einstellungen: Anmeldezeitpunkt + Ablauf + Button', /Angemeldet am/.test(s1.due) && /7 Tage/.test(s1.due) && s1.remind === true && s1.btn);
  await page.click('#g-remind');
  await sleep(300);
  st = await page.evaluate(() => api.call('google:status'));
  check('Erinnerung abgeschaltet gespeichert', st.remind === false);
  for (let i = 0; i < 3 && await page.evaluate(() => document.querySelector('#modal-root').children.length); i++) { await page.keyboard.press('Escape'); await sleep(300); }
  await sleep(LIFETIME);   // jetzt wäre sie fällig
  b = await banner();
  check('Abgeschaltet: kein „läuft ab“-Hinweis', !b.shown);
  refreshDead = true;
  await page.evaluate(async () => { S.google = await api.call('google:check'); });
  b = await banner();
  check('Abgeschaltet: abgelaufen wird trotzdem gezeigt', b.shown && b.expired);

  await app.close();

  // 8) Verbindung aus 3.2.33 (ohne connectedAt) → beim Start Zeitpunkt der letzten Speicherung übernommen
  const gfile = path.join(DIR, 'google.json');
  const raw = JSON.parse(fs.readFileSync(gfile, 'utf8')).data;
  if (raw.startsWith('b64:')) {
    const cfg = JSON.parse(Buffer.from(raw.slice(4), 'base64').toString('utf8'));
    delete cfg.connectedAt; cfg.expired = false; cfg.remind = true;
    fs.writeFileSync(gfile, JSON.stringify({ data: `b64:${Buffer.from(JSON.stringify(cfg)).toString('base64')}` }));
    const old = new Date(Date.now() - 3 * 86400e3);
    fs.utimesSync(gfile, old, old);
    const app2 = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox'], env: { ...process.env, SIMPLEMAIL_DATA: DIR } });
    const p2 = await app2.firstWindow(); await p2.waitForLoadState('domcontentloaded'); await sleep(1200);
    const s2 = await p2.evaluate(() => api.call('google:status'));
    check('Alte Verbindung: Zeitpunkt aus Dateidatum (vor 3 Tagen), Ablauf in 4 Tagen', Math.abs(s2.connectedAt - old.getTime()) < 2000 && Math.abs(s2.expiresAt - (old.getTime() + 7 * 86400e3)) < 2000);
    await app2.close();
  } else console.log('(Migration übersprungen: Datei verschlüsselt)');
  gserver.close();
  console.log(fail ? `\n${fail} FEHLER` : '\nALLES OK');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
