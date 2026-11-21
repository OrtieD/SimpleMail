// Testserver für den Alltagstest: zwei getrennte IMAP-Postfächer + SMTP, das gesendete Mails mitschreibt.
//   1144  „Büro“  – normaler Server (Sent/Trash/Archiv, kein Spam-Ordner → SimpleMail legt „Spam“ an)
//   1145  „Gmail“ – Gmail-artige Ordner ([Gmail]/Alle Nachrichten \All, Gesendet, Papierkorb, Spam, Markiert, Wichtig)
//   2526  SMTP mit AUTH PLAIN, schreibt jede Mail als JSON-Zeile nach $SMTP_LOG (Standard smtp-alltag.log)
// Start: node server-alltag.js  (PID steht in server-alltag.pid)
const hoodiecrow = require('hoodiecrow-imap');
const net = require('net'); const fs = require('fs'); const path = require('path');

const PLUGINS = ['IDLE', 'UIDPLUS', 'MOVE', 'SPECIAL-USE', 'LITERALPLUS', 'ENABLE', 'CONDSTORE', 'ID', 'UNSELECT', 'NAMESPACE'];
const user = { 'ortie@test.local': { password: 'geheim' } };

const buero = hoodiecrow({
  plugins: PLUGINS, users: user,
  storage: { INBOX: { messages: [] }, '': { separator: '/', folders: {
    Sent: { 'special-use': '\\Sent' }, Trash: { 'special-use': '\\Trash' }, Archiv: { 'special-use': '\\Archive' }, Projekte: {},
  } } },
});
const gmail = hoodiecrow({
  plugins: PLUGINS, users: user,
  storage: { INBOX: { messages: [] }, '': { separator: '/', folders: {
    '[Gmail]': { flags: ['\\Noselect'], folders: {
      'Alle Nachrichten': { 'special-use': '\\All' },
      Gesendet: { 'special-use': '\\Sent' },
      'Entw&APw-rfe': { 'special-use': '\\Drafts' },
      Papierkorb: { 'special-use': '\\Trash' },
      Spam: { 'special-use': '\\Junk' },
      Markiert: { 'special-use': '\\Flagged' },
      Wichtig: { 'special-use': '\\Important' },
    } },
    Privat: {},
  } } },
});
buero.listen(1144); gmail.listen(1145);

const LOG = process.env.SMTP_LOG || path.join(__dirname, 'smtp-alltag.log');
fs.writeFileSync(LOG, '');
net.createServer((c) => {
  let buf = ''; let data = null; let env = { from: '', to: [] };
  c.write('220 alltag ESMTP\r\n');
  c.on('error', () => {});
  c.on('data', (d) => {
    buf += d.toString('binary');
    for (;;) {
      if (data !== null) {
        const end = buf.indexOf('\r\n.\r\n');
        if (end < 0) return;
        data += buf.slice(0, end); buf = buf.slice(end + 5);
        fs.appendFileSync(LOG, JSON.stringify({ ...env, raw: Buffer.from(data, 'binary').toString('utf8'), at: Date.now() }) + '\n');
        data = null; env = { from: '', to: [] };
        c.write('250 OK gespeichert\r\n');
        continue;
      }
      const i = buf.indexOf('\r\n');
      if (i < 0) return;
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === 'EHLO') c.write('250-alltag\r\n250-AUTH PLAIN\r\n250 8BITMIME\r\n');
      else if (cmd === 'HELO') c.write('250 alltag\r\n');
      else if (cmd === 'AUTH') c.write('235 ok\r\n');
      else if (cmd === 'MAIL') { env.from = (line.match(/<([^>]*)>/) || [])[1] || ''; c.write('250 ok\r\n'); }
      else if (cmd === 'RCPT') { env.to.push((line.match(/<([^>]*)>/) || [])[1] || ''); c.write('250 ok\r\n'); }
      else if (cmd === 'DATA') { data = ''; c.write('354 go\r\n'); }
      else if (cmd === 'QUIT') { c.end('221 bye\r\n'); return; }
      else c.write('250 ok\r\n');
    }
  });
}).listen(2526, () => {
  fs.writeFileSync(path.join(__dirname, 'server-alltag.pid'), String(process.pid));
  console.log('Alltag-Server: IMAP 1144 (Büro), 1145 (Gmail-artig), SMTP 2526');
});
