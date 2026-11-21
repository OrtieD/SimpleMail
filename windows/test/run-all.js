// Führt alle Tests nacheinander aus: test-alltag.js + alle test-*.js (je mit frischem Testserver server.js).
// Aufruf: xvfb-run -a node run-all.js [Filter]     z. B. node run-all.js suche
// Ergebnis: Übersicht in der Konsole und in testlauf-bericht.txt; Ausgaben je Test unter logs/.
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const filter = process.argv[2] || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LOGS = path.join(__dirname, 'logs'); fs.mkdirSync(LOGS, { recursive: true });
// Veraltet/manuell: test.js (alter Gesamttest), test-ungelesen.js (seit 3.2.14 überholt, siehe test-zaehler.js)
const SKIP = new Set(['test.js', 'test-ungelesen.js']);
const tests = ['test-alltag.js', ...fs.readdirSync(__dirname).filter((f) => /^test-.*\.js$/.test(f) && f !== 'test-alltag.js' && !SKIP.has(f)).sort()]
  .filter((f) => f.includes(filter));

function run(cmd, args, logFile, timeoutMs) {
  return new Promise((resolve) => {
    const out = fs.createWriteStream(logFile);
    const p = spawn(cmd, args, { cwd: __dirname, env: { ...process.env, TZ: 'Europe/Berlin' } });
    p.stdout.pipe(out); p.stderr.pipe(out);
    const timer = setTimeout(() => { p.kill('SIGKILL'); }, timeoutMs);
    p.on('close', (code, sig) => { clearTimeout(timer); out.end(); resolve(sig ? `abgebrochen (${sig})` : code); });
  });
}
async function startServer() {
  for (const d of fs.readdirSync(__dirname)) if (/^data-/.test(d)) fs.rmSync(path.join(__dirname, d), { recursive: true, force: true });
  for (const d of ['/tmp/smF', '/tmp/smS', '/tmp/smG']) fs.rmSync(d, { recursive: true, force: true });
  const p = spawn(process.execPath, [path.join(__dirname, 'server.js')], { cwd: __dirname, stdio: 'ignore' });
  fs.writeFileSync(path.join(__dirname, 'server.pid'), String(p.pid));
  await sleep(1200);
  return p;
}
(async () => {
  const results = [];
  const t0 = Date.now();
  for (const t of tests) {
    const server = t === 'test-alltag.js' ? null : await startServer();   // Alltagstest bringt eigenen Server mit
    const start = Date.now();
    process.stdout.write(`${t.padEnd(26)} … `);
    const code = await run(process.execPath, [t], path.join(LOGS, t.replace(/\.js$/, '.log')), 15 * 60 * 1000);
    if (server) { try { process.kill(server.pid); } catch { /* schon weg */ } }
    try { fs.unlinkSync(path.join(__dirname, 'server.pid')); } catch { /* egal */ }
    const log = fs.readFileSync(path.join(LOGS, t.replace(/\.js$/, '.log')), 'utf8');
    const fails = log.split('\n').filter((l) => /^FAIL/.test(l));
    const sec = ((Date.now() - start) / 1000).toFixed(0);
    const ok = code === 0;
    console.log(`${ok ? 'OK    ' : 'FEHLER'} ${sec.padStart(4)} s${fails.length ? `  (${fails.length} FAIL)` : ''}${!ok && !fails.length ? `  (Exit ${code})` : ''}`);
    results.push({ t, ok, sec, fails, code });
    await sleep(500);
  }
  const bad = results.filter((r) => !r.ok);
  const lines = [`SimpleMail ${require('../app/package.json').version} – Testlauf ${new Date().toISOString()}`, '',
    ...results.map((r) => `${r.ok ? 'OK    ' : 'FEHLER'} ${r.t.padEnd(26)} ${r.sec.padStart(4)} s`), '',
    `${results.length - bad.length}/${results.length} Tests bestanden – ${Math.round((Date.now() - t0) / 1000)} s`];
  for (const r of bad) lines.push('', `--- ${r.t} (Exit ${r.code})`, ...(r.fails.length ? r.fails : ['(siehe logs/' + r.t.replace(/\.js$/, '.log') + ')']));
  fs.writeFileSync(path.join(__dirname, 'testlauf-bericht.txt'), lines.join('\n') + '\n');
  console.log('\n' + lines.slice(-1 - bad.reduce((n, r) => n + 2 + Math.max(1, r.fails.length), 0)).join('\n'));
  process.exit(bad.length ? 1 : 0);
})();
