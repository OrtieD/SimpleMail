const hoodiecrow = require('hoodiecrow-imap');
const net = require('net');
const msg = (from, name, subj, d) => `From: ${name} <${from}>\r\nTo: ortie@test.local\r\nSubject: ${subj}\r\nDate: ${d}\r\nMessage-ID: <${Math.random().toString(36).slice(2)}@x>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHallo Ortie,\r\nTestmail.\r\n`;
const server = hoodiecrow({
  plugins: ['IDLE', 'UIDPLUS', 'MOVE', 'SPECIAL-USE', 'LITERALPLUS', 'ENABLE', 'CONDSTORE', 'ID', 'UNSELECT', 'NAMESPACE'],
  users: { 'ortie@test.local': { password: 'geheim' } },
  storage: { INBOX: { messages: [
    { raw: msg('alice@example.com', 'Alice Anders', 'Treffen morgen', 'Mon, 10 Nov 2026 09:00:00 +0100'), flags: [] },
    { raw: msg('bob@example.com', 'Bob Berger', 'Rechnung', 'Tue, 11 Nov 2026 10:00:00 +0100'), flags: ['\\Seen'] },
  ] }, '': { separator: '/', folders: { Sent: { 'special-use': '\\Sent' }, Trash: { 'special-use': '\\Trash' } } } },
});
server.listen(1143, () => console.log('IMAP 1143'));
// SMTP-Attrappe
net.createServer((c) => { c.write('220 x\r\n'); c.on('data', (d) => { const t = d.toString(); if (/^DATA/m.test(t)) c.write('354 go\r\n'); else if (/^QUIT/m.test(t)) c.end('221 bye\r\n'); else c.write('250 x\r\n'); }); }).listen(2525);
