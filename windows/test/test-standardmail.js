// Prüft 3.2.37: SimpleMail als Standard-Mailprogramm (Windows)
// – Registrierung unter HKCU (.reg-Inhalt) beim Start und per Button, Öffnen von ms-settings:defaultapps
// – Start über mailto-Link (Kaltstart) und mailto an laufende App (zweite Instanz) öffnen den Editor
const { _electron } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const APP = path.resolve(__dirname, '../app');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const D = '/tmp/smStd'; const REG = '/tmp/smStd.reg'; const EXT = '/tmp/smStd-ext.log';
const baseEnv = (fakeDefault) => ({ ...process.env, SIMPLEMAIL_DATA: D, SIMPLEMAIL_REG_FILE: REG, SIMPLEMAIL_EXTERNAL_LOG: EXT, SIMPLEMAIL_FAKE_DEFAULT: fakeDefault });
async function launch(extra = [], fakeDefault = '0') {
  const app = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox', ...extra], env: baseEnv(fakeDefault) });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.waitForLoadState('domcontentloaded'); await sleep(2000);
  return { app, page };
}
const acc = { displayName: 'Ortie', email: 'ortie@test.local', username: 'ortie@test.local', imapHost: '127.0.0.1', imapPort: 1143, smtpHost: '127.0.0.1', smtpPort: 2525 };
let fail = 0; const check = (name, ok) => { console.log(ok ? 'OK  ' : 'FAIL', name); if (!ok) fail++; };
const composeVals = (page) => page.evaluate(() => ({
  open: !!document.querySelector('.dialog.compose'),
  to: document.querySelector('#c-to') && document.querySelector('#c-to').value,
  subject: document.querySelector('#c-subject') && document.querySelector('#c-subject').value,
  body: document.querySelector('#c-body') && document.querySelector('#c-body').innerText,
}));
const closeCompose = async (page) => { await page.click('.dialog.compose [data-x="cancel"]'); await sleep(400);
  if (await page.$('.dialog.compose')) { const b = await page.$('#modal-root .primary, #modal-root .danger'); if (b) await b.click(); await sleep(300); } };
(async () => {
  for (const f of [D, REG, EXT]) fs.rmSync(f, { recursive: true, force: true });
  let { app, page } = await launch();
  await page.evaluate(async (a) => { await api.call('accounts:save', a, 'geheim'); }, acc);
  // 1) Registrierung beim Start
  const reg = fs.existsSync(REG) ? fs.readFileSync(REG, 'utf8') : '';
  const exe = await app.evaluate(() => process.execPath);
  check('Registrierung beim Start geschrieben', reg.startsWith('Windows Registry Editor Version 5.00'));
  check('ProgID mit Programmpfad und "--" vor %1', reg.includes('[HKEY_CURRENT_USER\\Software\\Classes\\SimpleMail.mailto\\shell\\open\\command]')
    && reg.includes(`@="\\"${exe.replace(/\\/g, '\\\\')}\\" -- \\"%1\\""`));
  check('URL Protocol gesetzt', reg.includes('"URL Protocol"=""'));
  check('Capabilities: mailto → SimpleMail.mailto', /URLAssociations\]\r\n"mailto"="SimpleMail\.mailto"/.test(reg));
  check('RegisteredApplications zeigt auf Capabilities', reg.includes('"SimpleMail"="Software\\\\Clients\\\\Mail\\\\SimpleMail\\\\Capabilities"'));
  check('Clients\\Mail\\SimpleMail vorhanden', reg.includes('[HKEY_CURRENT_USER\\Software\\Clients\\Mail\\SimpleMail]'));
  const st = JSON.parse(fs.readFileSync(path.join(D, 'mailhandler.json'), 'utf8'));
  check('Pfad gemerkt (mailhandler.json)', st.exe === exe);
  await app.close();

  // 2) Neustart mit gleichem Pfad → nicht neu geschrieben; verschobener Pfad → neu geschrieben
  fs.rmSync(REG, { force: true });
  ({ app, page } = await launch());
  check('Gleicher Pfad: keine erneute Registrierung', !fs.existsSync(REG));
  await app.close();
  fs.writeFileSync(path.join(D, 'mailhandler.json'), JSON.stringify({ exe: 'C:\\Alt\\SimpleMail.exe', version: st.version }));

  // 3) Kaltstart über mailto-Link (so ruft Windows das Standard-Mailprogramm auf: exe -- "mailto:…")
  ({ app, page } = await launch(['--', 'mailto:anna@firma.example?subject=Hallo%20M%C3%A4rz&body=Erste%20Zeile']));
  check('Anderer Pfad: Registrierung erneuert', fs.existsSync(REG));
  await page.waitForSelector('.dialog.compose', { timeout: 15000 }).catch(() => {});
  let v = await composeVals(page);
  check('Kaltstart mit mailto öffnet Editor', v.open);
  check('An aus Link', /anna@firma\.example/.test(v.to || ''));
  check('Betreff aus Link (Umlaut)', v.subject === 'Hallo März');
  check('Text aus Link', /Erste Zeile/.test(v.body || ''));
  await page.screenshot({ path: path.join(__dirname, 'shot-standardmail-start.png') });
  await closeCompose(page);

  // 4) App läuft, Windows startet zweite Instanz mit mailto → Editor im laufenden Fenster
  const second = spawn(require('electron'), [APP, '--no-sandbox', '--', 'mailto:bernd@firma.example?subject=Zweite'], { env: baseEnv('0'), stdio: 'ignore' });
  const code = await new Promise((r) => { second.on('close', r); setTimeout(() => r('läuft noch'), 15000); });
  check('Zweite Instanz beendet sich sofort', code === 0);
  await page.waitForSelector('.dialog.compose', { timeout: 10000 }).catch(() => {});
  v = await composeVals(page);
  check('mailto an laufende App öffnet Editor', v.open && /bernd@firma\.example/.test(v.to || '') && v.subject === 'Zweite');
  await closeCompose(page);
  check('Nur ein Fenster', (await app.windows()).length === 1);

  // 5) Einstellungen: Status + Button
  await page.evaluate(() => openSettings({ tab: 'privacy' }));
  await page.waitForSelector('#p-mail-default'); await sleep(800);
  check('Status „noch nicht festgelegt“', (await page.textContent('#p-mail-state')).includes('noch nicht'));
  fs.rmSync(REG, { force: true });
  await page.click('#p-mail-default'); await sleep(1000);
  check('Button registriert erneut', fs.existsSync(REG));
  check('Button öffnet Windows „Standard-Apps“ für SimpleMail', fs.existsSync(EXT) && fs.readFileSync(EXT, 'utf8').includes('ms-settings:defaultapps?registeredAppUser=SimpleMail'));
  await page.locator('#p-mail-default').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(__dirname, 'shot-standardmail.png') });
  await app.close();

  // 6) Ist Standard → Haken
  ({ app, page } = await launch([], '1'));
  await page.evaluate(() => openSettings({ tab: 'privacy' }));
  await page.waitForSelector('#p-mail-default'); await sleep(800);
  check('Status „✓ ist Standard“', (await page.textContent('#p-mail-state')).includes('✓'));
  check(`Version ${require('../app/package.json').version}`, (await app.evaluate(({ app: a }) => a.getVersion())) === require('../app/package.json').version);
  await app.close();
  console.log(fail ? `${fail} FEHLER` : 'ALLE OK');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
