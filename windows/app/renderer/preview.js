'use strict';
// SimpleMail – Druckvorschau: Seitenansicht (PDF), eigenes Druckermenü, PDF speichern

const $ = (id) => document.getElementById(id);
const LAST = 'simplemail.lastPrinter';
let busy = false;
let pages = 1;

function show(info) {
  document.title = `Druckvorschau – ${info.title}`;
  $('title').textContent = info.title;
  $('portrait').classList.toggle('on', !info.landscape);
  $('landscape').classList.toggle('on', info.landscape);
  pages = info.pages || 1;
  $('from').max = pages; $('to').max = pages; $('to').value = pages;
  $('range').options[0].textContent = `Alle (${pages} ${pages === 1 ? 'Seite' : 'Seiten'})`;
  $('pdf').src = info.pdfUrl;
}

async function loadPrinters() {
  const sel = $('printer');
  let list = [];
  try { list = await window.api.call('preview:printers'); } catch { /* leer */ }
  if (!list.length) {
    sel.innerHTML = '<option value="">Kein Drucker gefunden</option>';
    $('print').disabled = true;
    $('status').textContent = 'Drucker in Windows unter Einstellungen → Drucker & Scanner einrichten – oder „PDF speichern …“ verwenden.';
    return;
  }
  let last = '';
  try { last = localStorage.getItem(LAST) || ''; } catch { /* egal */ }
  const pick = list.find((p) => p.name === last) || list.find((p) => p.isDefault) || list[0];
  sel.innerHTML = list.map((p) =>
    `<option value="${p.name.replace(/"/g, '&quot;')}"${p === pick ? ' selected' : ''}>${p.label.replace(/</g, '&lt;')}${p.isDefault ? ' (Standard)' : ''}</option>`).join('');
}

async function run(fn) {
  if (busy) return;
  busy = true;
  document.body.style.cursor = 'progress';
  try { await fn(); } catch (e) { $('status').textContent = ''; alert(e.message); } finally { busy = false; document.body.style.cursor = ''; }
}

async function doPrint() {
  const deviceName = $('printer').value;
  if (!deviceName) return;
  const opts = {
    deviceName,
    copies: Number($('copies').value) || 1,
    color: $('color').value === '1',
    duplex: $('duplex').checked,
  };
  if ($('range').value === 'part') {
    const from = Math.max(1, Math.min(pages, Number($('from').value) || 1));
    const to = Math.max(from, Math.min(pages, Number($('to').value) || from));
    opts.from = from; opts.to = to;
  }
  try { localStorage.setItem(LAST, deviceName); } catch { /* egal */ }
  $('status').textContent = 'Wird an den Drucker gesendet …';
  const ok = await window.api.call('preview:print', opts);
  if (ok) { $('status').textContent = 'Gedruckt.'; setTimeout(() => window.close(), 600); }
  else $('status').textContent = 'Abgebrochen.';
}

$('portrait').addEventListener('click', () => run(async () => show(await window.api.call('preview:orientation', false))));
$('landscape').addEventListener('click', () => run(async () => show(await window.api.call('preview:orientation', true))));
$('print').addEventListener('click', () => run(doPrint));
$('save').addEventListener('click', () => run(() => window.api.call('preview:savePdf')));
$('close').addEventListener('click', () => window.close());
$('range').addEventListener('change', () => { $('rangeBox').style.display = $('range').value === 'part' ? '' : 'none'; });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.close();
  if (e.ctrlKey && e.key.toLowerCase() === 'p') { e.preventDefault(); $('print').click(); }
  if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); $('save').click(); }
});

window.api.call('preview:data').then((info) => { show(info); loadPrinters(); }).catch((e) => {
  document.getElementById('pv').innerHTML = `<div class="pv-msg">${String(e.message).replace(/</g, '&lt;')}</div>`;
});
