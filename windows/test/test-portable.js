// 3.2.40: Portable Version – portable.txt neben der EXE → Daten im Unterordner „Daten“, Anzeige „(portabel)“.
const { _electron } = require('playwright-core');
const fs = require('fs'); const path = require('path');
const APP = path.resolve(__dirname, '../app');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0; const check = (name, ok, info) => { console.log(ok ? 'OK  ' : 'FAIL', name, ok || info === undefined ? '' : `→ ${info}`); if (!ok) fail++; };
async function launch(exeDir) {
  const env = { ...process.env, SIMPLEMAIL_EXE_DIR: exeDir }; delete env.SIMPLEMAIL_DATA;
  const app = await _electron.launch({ executablePath: require('electron'), args: [APP, '--no-sandbox'], env });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded'); await sleep(1500);
  return { app, page };
}
(async () => {
  const P = path.join(__dirname, 'data-portable'); fs.rmSync(P, { recursive: true, force: true }); fs.mkdirSync(P);
  fs.writeFileSync(path.join(P, 'portable.txt'), 'x');
  let { app, page } = await launch(P);
  const ud = await app.evaluate(({ app: a }) => a.getPath('userData'));
  check('Datenordner = <EXE-Ordner>\\Daten', ud === path.join(P, 'Daten'), ud);
  await page.evaluate(async () => { await api.call('accounts:save', { displayName: 'p', email: 'ortie@test.local', username: 'ortie@test.local', imapHost: '127.0.0.1', imapPort: 1143, smtpHost: '127.0.0.1', smtpPort: 2525 }, 'geheim'); });
  await sleep(500);
  check('Konto liegt im portablen Ordner', fs.existsSync(path.join(P, 'Daten', 'accounts.json')));
  check('Menüleiste zeigt „(portabel)“', /portabel/.test(await page.innerText('#menubar')), await page.innerText('#menubar'));
  await app.close();
  const N = path.join(__dirname, 'data-normal'); fs.rmSync(N, { recursive: true, force: true }); fs.mkdirSync(N);
  ({ app, page } = await launch(N));
  const ud2 = await app.evaluate(({ app: a }) => a.getPath('userData'));
  check('ohne portable.txt: normaler Datenordner', ud2 !== path.join(N, 'Daten') && !fs.existsSync(path.join(N, 'Daten')), ud2);
  check('ohne portable.txt: kein „(portabel)“', !/portabel/.test(await page.innerText('#menubar')));
  await app.close();
  console.log(fail ? `\n${fail} FEHLER` : '\nAlle Prüfungen bestanden');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL Abbruch', e); process.exit(1); });
