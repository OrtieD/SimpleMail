'use strict';
// SimpleMail – E-Mail in eigenem Fenster (geöffnet per Doppelklick bzw. Enter in der Liste)

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICONS = {
  reply: 'M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z',
  replyAll: 'M7 8V5l-7 7 7 7v-3l-4-4 4-4zm6 1V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z',
  forward: 'M14 9V5l7 7-7 7v-4.1c-5 0-8.5 1.6-11 5.1 1-5 4-10 11-11z',
  flag: 'M5 3h2v18H5V3zm3 1h11l-3 5 3 5H8V4z',
  archive: 'M3 4h18v4H3V4zm1 5h16v11H4V9zm5 3v2h6v-2H9z',
  trash: 'M9 3h6l1 2h4v2H4V5h4l1-2zM5 8h14l-1 13H6L5 8zm4 2v9h2v-9H9zm4 0v9h2v-9h-2z',
  print: 'M7 3h10v4H7V3zM5 8h14a2 2 0 0 1 2 2v6h-4v4H7v-4H3v-6a2 2 0 0 1 2-2zm4 7v3h6v-3H9zm8-5a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
  clip: 'M16.5 6.5v10a4.5 4.5 0 0 1-9 0V5a3 3 0 0 1 6 0v10.5a1.5 1.5 0 0 1-3 0V6.5H9v9a3 3 0 0 0 6 0V5a4.5 4.5 0 0 0-9 0v11.5a6 6 0 0 0 12 0v-10h-1.5z',
  eye: 'M12 5c5 0 9 4.5 10 7-1 2.5-5 7-10 7S3 14.5 2 12c1-2.5 5-7 10-7zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
};
const icon = (n) => `<svg viewBox="0 0 24 24" class="ico"><path d="${ICONS[n]}"/></svg>`;
const PALETTE = ['#0f6cbd', '#8764b8', '#c239b3', '#da3b01', '#038387', '#107c10', '#5c2e91', '#c50f1f'];
function avatar(name) {
  const letters = String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return `<div class="avatar big" style="background:${PALETTE[h % PALETTE.length]}">${esc(letters)}</div>`;
}
const linkify = (t) => esc(t).replace(/(https?:\/\/[^\s<>"']+)|(?:mailto:)?([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,
  (all, url, addr) => `<a href="#" data-url="${url || `mailto:${addr}`}">${all}</a>`);

let mail = null;

function render() {
  const m = mail;
  const name = m.fromName || m.fromAddress || '(unbekannt)';
  document.title = m.subject || '(Kein Betreff)';
  let html = `<div class="detail-bar">
    <button class="btn" data-a="reply" title="Antworten (Strg+R)">${icon('reply')} Antworten</button>
    <button class="btn" data-a="replyAll" title="Allen antworten (Strg+Umschalt+R)">${icon('replyAll')}</button>
    <button class="btn" data-a="forward" title="Weiterleiten (Strg+Umschalt+F)">${icon('forward')}</button>
    <span class="sep"></span>
    <button class="btn" data-a="flag" title="Markieren">${icon('flag')}${m.isFlagged ? ' Markiert' : ''}</button>
    <button class="btn" data-a="print" title="Drucken oder als PDF speichern (Strg+P)">${icon('print')} Drucken</button>
    <button class="btn" data-a="archive" title="Archivieren">${icon('archive')}</button>
    <button class="btn danger" data-a="delete" title="Löschen (Entf)">${icon('trash')}</button>
  </div>
  <div class="detail-head">
    <h1>${esc(m.subject || '(Kein Betreff)')}</h1>
    <div class="sender">
      ${avatar(name)}
      <div class="who">
        <div><span class="name"${/^#[0-9a-f]{6}$/i.test(m.nameColor || '') ? ` style="color:${m.nameColor}"` : ''}>${esc(name)}</span> <span class="addr">&lt;${linkify(m.fromAddress || '')}&gt;</span></div>
        ${m.to ? `<div class="line">An: ${linkify(m.to)}</div>` : ''}
        ${m.cc ? `<div class="line">Cc: ${linkify(m.cc)}</div>` : ''}
        ${m.account ? `<div class="line">Konto: ${/^#[0-9a-f]{6}$/i.test(m.accountColor || '') ? `<span class="acc-dot" style="background:${m.accountColor}"></span>` : ''}${esc(m.account)}</div>` : ''}
      </div>
      <div class="when">${esc(m.date)}</div>
    </div>
  </div>`;
  if (m.warnings && m.warnings.length) {
    html += `<div class="banner danger-banner">⚠<div><b>Vorsicht – möglicher Betrugsversuch (Phishing)</b>
      ${m.warnings.map((w) => `<div>${esc(w)}</div>`).join('')}</div></div>`;
  }
  if (m.imagesBlocked) {
    html += `<div class="banner">${icon('eye')}<span>Externe Bilder blockiert (im Hauptfenster freigeben)</span></div>`;
  }
  html += m.html
    ? '<iframe class="body-frame" sandbox="allow-popups allow-popups-to-escape-sandbox"></iframe>'
    : `<pre class="body-text">${linkify(m.text || '')}</pre>`;
  if (m.attachments.length) {
    html += `<div class="attachments"><div class="chips">${m.attachments.map((a) =>
      `<span class="chip" data-att="${esc(a.key)}" title="Klicken zum Öffnen – Rechtsklick: Öffnen mit …">${icon('clip')}${esc(a.filename)} <span class="size">${esc(a.size)}</span></span>`).join('')}</div></div>`;
  }
  const root = document.getElementById('viewer');
  root.innerHTML = html;
  const frame = root.querySelector('.body-frame');
  if (frame) frame.srcdoc = m.html;
}

async function action(a) {
  try {
    await window.api.call('viewer:action', a);
    if (a === 'flag') { mail.isFlagged = !mail.isFlagged; render(); }
  } catch (e) { alert(e.message); }
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-a]');
  if (b) { action(b.dataset.a); return; }
  const link = e.target.closest('a[data-url]');
  if (link) { e.preventDefault(); window.api.call('app:openExternal', link.dataset.url).catch(() => {}); return; }
  const chip = e.target.closest('[data-att]');
  if (chip) {
    const att = mail.attachments.find((x) => x.key === chip.dataset.att);
    let ok = false;
    if (att && att.risk === 'blocked') {
      alert(`„${att.filename}“ ist ein Programm oder Skript und wird aus Sicherheitsgründen nicht direkt geöffnet.\n\nRechtsklick → „Sichern unter …“, wenn du die Datei wirklich erwartest.`);
      return;
    }
    if (att && att.risk === 'dangerous') {
      ok = confirm(`„${att.filename}“ kann Programme oder Makros ausführen.\n\nNur öffnen, wenn du die Datei erwartet hast und dem Absender vertraust.\n\nTrotzdem öffnen?`);
      if (!ok) return;
    }
    window.api.call('attachment:open', chip.dataset.att, ok).catch((err) => alert(err.message));
  }
});

// Rechtsklick auf einen Anhang: „Öffnen mit …“
document.addEventListener('contextmenu', async (e) => {
  const chip = e.target.closest('[data-att]');
  if (!chip) return;
  e.preventDefault();
  const att = mail.attachments.find((x) => x.key === chip.dataset.att);
  let ok = false;
  if (att && att.risk === 'dangerous') {
    ok = confirm(`„${att.filename}“ kann Programme oder Makros ausführen.\n\nNur öffnen, wenn du die Datei erwartet hast und dem Absender vertraust.\n\nTrotzdem fortfahren?`);
    if (!ok) return;
  }
  window.api.call('viewer:attachmentMenu', chip.dataset.att, ok).catch((err) => alert(err.message));
});

window.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'none'; });
window.addEventListener('drop', (e) => e.preventDefault());

document.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (e.key === 'Escape') window.close();
  else if (e.ctrlKey && k === 'p') { e.preventDefault(); action('print'); }
  else if (e.ctrlKey && e.shiftKey && k === 'r') { e.preventDefault(); action('replyAll'); }
  else if (e.ctrlKey && k === 'r') { e.preventDefault(); action('reply'); }
  else if (e.ctrlKey && e.shiftKey && k === 'f') { e.preventDefault(); action('forward'); }
  else if (e.ctrlKey && k === 'w') { e.preventDefault(); window.close(); }
  else if (e.key === 'Delete') { e.preventDefault(); action('delete'); }
});

window.api.call('viewer:data')
  .then((m) => { mail = m; render(); })
  .catch((e) => { document.getElementById('viewer').innerHTML = `<div class="v-msg">${esc(e.message)}</div>`; });
