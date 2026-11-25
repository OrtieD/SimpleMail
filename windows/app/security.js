'use strict';
// Spam- und Phishing-Erkennung für die Leseansicht (Windows). Die Mac-Version (Security.swift) prüft dasselbe.

// Marken, deren Namen Betrüger gern im Absender verwenden – mit den echten Domains
const BRANDS = [
  { name: 'PayPal', words: ['paypal'], domains: ['paypal.com', 'paypal.de', 'paypal-communication.com', 'e.paypal.de', 'paypal.co.uk'] },
  { name: 'Amazon', words: ['amazon'], domains: ['amazon.de', 'amazon.com', 'amazon.co.uk', 'amazonses.com', 'amazon.fr', 'amazon.it', 'amazon.es', 'amazon.nl', 'amazon.at', 'amazonaws.com'] },
  { name: 'Apple', words: ['apple', 'icloud', 'itunes'], domains: ['apple.com', 'icloud.com', 'me.com', 'mac.com', 'itunes.com', 'email.apple.com', 'insideapple.apple.com'] },
  { name: 'Microsoft', words: ['microsoft', 'outlook', 'office 365', 'office365', 'onedrive'], domains: ['microsoft.com', 'outlook.com', 'office.com', 'live.com', 'hotmail.com', 'microsoftonline.com', 'onedrive.com', 'sharepoint.com', 'email.microsoft.com'] },
  { name: 'Google', words: ['google', 'gmail'], domains: ['google.com', 'gmail.com', 'googlemail.com', 'accounts.google.com', 'youtube.com'] },
  { name: 'DHL', words: ['dhl'], domains: ['dhl.de', 'dhl.com', 'deutschepost.de', 'dpdhl.com'] },
  { name: 'Deutsche Post', words: ['deutsche post'], domains: ['deutschepost.de', 'dhl.de', 'dpdhl.com'] },
  { name: 'DPD', words: ['dpd'], domains: ['dpd.de', 'dpd.com'] },
  { name: 'Hermes', words: ['hermes'], domains: ['myhermes.de', 'hermesworld.com', 'hermes-europe.eu'] },
  { name: 'UPS', words: ['ups'], domains: ['ups.com'] },
  { name: 'Netflix', words: ['netflix'], domains: ['netflix.com', 'mailer.netflix.com'] },
  { name: 'eBay', words: ['ebay'], domains: ['ebay.de', 'ebay.com', 'reply.ebay.de', 'ebay.co.uk'] },
  { name: 'Telekom', words: ['telekom'], domains: ['telekom.de', 't-online.de', 'telekom.com'] },
  { name: 'Vodafone', words: ['vodafone'], domains: ['vodafone.de', 'vodafone.com', 'kabeldeutschland.de'] },
  { name: 'WEB.DE', words: ['web.de'], domains: ['web.de', 'webde.de', 'mail.web.de'] },
  { name: 'GMX', words: ['gmx'], domains: ['gmx.de', 'gmx.net', 'gmx.at', 'gmx.ch'] },
  { name: 'Elster/Finanzamt', words: ['elster', 'finanzamt', 'bundeszentralamt'], domains: ['elster.de', 'bzst.de', 'bund.de'] },
  // Banken mit vielen regionalen Domains: echt, wenn der Markenname in der Domain steht
  { name: 'Sparkasse', words: ['sparkasse'], domains: [], ownWord: true },
  { name: 'Volksbank', words: ['volksbank', 'raiffeisenbank'], domains: [], ownWord: true },
  { name: 'Commerzbank', words: ['commerzbank'], domains: ['commerzbank.de', 'commerzbank.com', 'comdirect.de'] },
  { name: 'Deutsche Bank', words: ['deutsche bank'], domains: ['db.com', 'deutsche-bank.de', 'deutschebank.de'] },
  { name: 'Postbank', words: ['postbank'], domains: ['postbank.de'] },
  { name: 'ING', words: ['ing-diba', 'ing diba'], domains: ['ing.de', 'ing-diba.de', 'ing.com'] },
  { name: 'DKB', words: ['dkb'], domains: ['dkb.de'] },
  { name: 'N26', words: ['n26'], domains: ['n26.com'] },
];

const domainOf = (addr) => String(addr || '').toLowerCase().split('@').pop().trim();
const belongs = (domain, list) => list.some((d) => domain === d || domain.endsWith(`.${d}`));
const wordIn = (text, w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`, 'i').test(text);

/** grob die „registrierbare“ Domain: letzte zwei Teile (bei co.uk usw. drei) */
function baseDomain(host) {
  const parts = String(host || '').toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const two = parts.slice(-2).join('.');
  if (/^(co|com|org|net|gov|ac)\.[a-z]{2}$/.test(two)) return parts.slice(-3).join('.');
  return two;
}

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

/** Ergebnisse von SPF/DKIM/DMARC aus der obersten Authentication-Results-Zeile */
function authResults(headerLines) {
  const line = (headerLines || []).find((h) => h.key === 'authentication-results');
  if (!line) return null;
  const v = line.line.toLowerCase();
  const get = (k) => { const m = new RegExp(`\\b${k}=([a-z]+)`).exec(v); return m ? m[1] : null; };
  return { spf: get('spf'), dkim: get('dkim'), dmarc: get('dmarc') };
}

/** List-Unsubscribe: { url, mailto, oneClick } */
function unsubscribeInfo(headerLines) {
  const line = (headerLines || []).find((h) => h.key === 'list-unsubscribe');
  if (!line) return null;
  const value = line.line.replace(/^[^:]*:/, '');
  const items = [...value.matchAll(/<([^>]+)>/g)].map((m) => m[1].trim());
  const url = items.find((x) => /^https:\/\//i.test(x)) || null;
  const mailto = items.find((x) => /^mailto:/i.test(x)) || null;
  const post = (headerLines || []).find((h) => h.key === 'list-unsubscribe-post');
  const oneClick = !!(url && post && /one-click/i.test(post.line));
  if (!url && !mailto) return null;
  return { url, mailto, oneClick };
}

/** Links, deren sichtbarer Text eine andere Adresse zeigt als das Ziel */
function linkMismatches(html) {
  const out = [];
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || ''))) && out.length < 3) {
    const href = m[1].trim();
    if (!/^https?:/i.test(href)) continue;
    const text = m[2].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
    // Nur wenn der Text selbst wie eine Adresse aussieht
    const t = /^(https?:\/\/)?(www\.)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i.exec(text);
    if (!t) continue;
    const shown = baseDomain(hostOf(/^https?:/i.test(text) ? text : `https://${text}`));
    const real = baseDomain(hostOf(href));
    if (shown && real && shown !== real) out.push({ shown: text.replace(/^https?:\/\//i, '').split('/')[0], real: hostOf(href) });
  }
  return out;
}

/**
 * Prüft eine Nachricht. Liefert Warnungen (Text) für das Banner.
 * fromName/fromAddress: Absender; html: HTML-Inhalt; headerLines: rohe Kopfzeilen (mailparser)
 */
function analyze({ fromName, fromAddress, html, headerLines, ownAddresses = [] }) {
  const warnings = [];
  const domain = domainOf(fromAddress);
  const name = String(fromName || '').toLowerCase();
  const unsubscribe = unsubscribeInfo(headerLines);

  // 1. Anzeigename enthält eine andere E-Mail-Adresse
  const shownAddr = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.exec(fromName || '');
  // gmail.com und googlemail.com sind dieselbe Adresse
  if (shownAddr && normalizeAddress(shownAddr[0]) !== normalizeAddress(fromAddress)) {
    warnings.push(`Der Absendername zeigt „${shownAddr[0]}“, die Mail kommt aber von „${fromAddress}“.`);
  }

  // 2. Markenname im Absender, aber fremde Domain
  if (domain && !ownAddresses.map((a) => a.toLowerCase()).includes(String(fromAddress).toLowerCase())) {
    for (const b of BRANDS) {
      const inName = b.words.some((w) => wordIn(name, w));
      const tokens = domain.split(/[.-]/);
      const inDomain = b.words.some((w) => {
        const flat = w.replace(/[^a-z0-9]/g, '');
        return tokens.includes(flat) || (flat.length >= 6 && domain.replace(/[^a-z0-9]/g, '').includes(flat));
      });
      const official = b.ownWord ? inDomain : belongs(domain, b.domains);
      if (official) continue;
      if (inName) {
        warnings.push(`Der Absender nennt sich „${fromName}“, die Adresse ${domain} gehört aber nicht zu ${b.name}.`);
        break;
      }
      if (inDomain && !b.ownWord) {
        warnings.push(`Die Absender-Domain ${domain} ahmt ${b.name} nach – sie gehört nicht zu ${b.name}.`);
        break;
      }
    }
  }

  // 3. Server-Prüfung des Absenders
  const auth = authResults(headerLines);
  if (auth) {
    if (auth.dmarc === 'fail') warnings.push(`Der Mailserver konnte nicht bestätigen, dass die Mail wirklich von ${domain} stammt (DMARC fehlgeschlagen).`);
    else if (!auth.dmarc && (auth.spf === 'fail' || auth.dkim === 'fail')) {
      warnings.push(`Die Absenderprüfung des Mailservers ist fehlgeschlagen (${auth.spf === 'fail' ? 'SPF' : 'DKIM'}) – Absender evtl. gefälscht.`);
    }
  }

  // 4. Irreführende Links (bei Newslettern mit Abmelde-Link nicht, dort sind Umleitungs-Links üblich)
  if (!unsubscribe) {
    for (const l of linkMismatches(html)) {
      warnings.push(`Ein Link zeigt „${l.shown}“, führt aber zu „${l.real}“.`);
    }
  }
  return { warnings, unsubscribe };
}

/** Steht der Absender auf der Sperrliste? Einträge: „name@firma.de“ oder „@firma.de“ */
function isBlocked(address, blocked) {
  const a = String(address || '').toLowerCase();
  const d = `@${domainOf(a)}`;
  return Object.entries(blocked || {}).some(([k, v]) => v && !v.deleted
    && (k === a || k === d || (k.startsWith('@') && d.endsWith(`.${k.slice(1)}`))));
}

// ---------------------------------------------------------------- Automatischer Spamfilter
// Bewertet eine neue Mail nur anhand der Kopfzeilen (ohne Inhalt zu laden). Die Mac-Version (Security.swift,
// SpamFilter.score) rechnet mit denselben Punkten, damit beide Seiten gleich entscheiden.
const SPAM_LEVELS = { low: 6, medium: 4, high: 3 };   // Schwelle: ab so vielen Punkten ist es Spam
const SPAM_WORDS = ['viagra', 'cialis', 'casino', 'lotto', 'lottery', 'gewinnspiel', 'sie haben gewonnen', 'you have won',
  'you won', 'erbschaft', 'inheritance', 'bitcoin', 'krypto', 'crypto', 'abnehmen', 'potenz', 'sexy', 'dating',
  'konto gesperrt', 'konto wurde gesperrt', 'account suspended', 'verify your account', 'bestätigen sie ihr konto',
  'kredit ohne schufa', 'millionen euro', 'million dollars', 'wire transfer', 'rolex', 'replica'];

/** h: Kopfzeilen als Objekt (Kleinbuchstaben-Schlüssel). Liefert { score, reasons } */
function spamScore({ fromName, fromAddress, subject, headers }) {
  const h = headers || {};
  const reasons = [];
  let score = 0;
  const add = (n, why) => { score += n; reasons.push(why); };
  // 1. Der Mailserver hat sie schon als Spam markiert
  const flag = String(h['x-spam-flag'] || '').trim().toLowerCase();
  const status = String(h['x-spam-status'] || h['x-spam'] || '').trim().toLowerCase();
  if (flag === 'yes' || flag === 'true' || /^yes\b/.test(status)) add(5, 'vom Mailserver als Spam markiert');
  // 2. Absenderprüfung (SPF/DKIM/DMARC)
  const ar = String(h['authentication-results'] || '').toLowerCase();
  if (ar) {
    const get = (k) => { const m = new RegExp(`\\b${k}=([a-z]+)`).exec(ar); return m ? m[1] : null; };
    if (get('dmarc') === 'fail') {
      // Absender verlangt keine Abweisung (p=none) – typisch bei Weiterleitungen und Verteilern
      if (/\b(p|dis)=none\b/.test(ar)) add(2, 'DMARC fehlgeschlagen (ohne Sperr-Richtlinie)');
      else add(4, 'DMARC fehlgeschlagen');
    }
    else if (get('spf') === 'fail') add(2, 'SPF fehlgeschlagen');
    else if (get('dkim') === 'fail') add(1, 'DKIM fehlgeschlagen');
  }
  // 3. Markenimitat / fremde Adresse im Namen (wie die Warnung in der Leseansicht)
  const warn = analyze({ fromName, fromAddress, html: '', headerLines: [] }).warnings;
  if (warn.some((w) => /gehört aber nicht zu|ahmt .* nach/.test(w))) add(4, 'Absender gibt sich als bekannte Firma aus');
  else if (warn.some((w) => /Absendername zeigt/.test(w))) add(3, 'Absendername zeigt eine andere Adresse');
  // 4. Betreff
  const subj = String(subject || '');
  const low = subj.toLowerCase();
  if (SPAM_WORDS.some((w) => new RegExp(`(^|[^a-z0-9äöüß])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9äöüß])`).test(low))) add(2, 'typische Spam-Wörter im Betreff');
  const letters = subj.replace(/[^A-Za-zÄÖÜäöüß]/g, '');
  if (letters.length >= 10 && letters.replace(/[^A-ZÄÖÜ]/g, '').length / letters.length > 0.7) add(1, 'Betreff in Großbuchstaben');
  if (/!!!|\$\$\$|€€€/.test(subj)) add(1, 'auffällige Zeichen im Betreff');
  if (!String(fromAddress || '').includes('@')) add(1, 'keine gültige Absenderadresse');
  return { score, reasons };
}

/**
 * Gehört die Mail in den Spam? opts: { level, own: [Adressen], known: Set(Adressen aus Kontakten/vertrauenswürdig) }
 * Eigene Adressen und bekannte Absender werden nie aussortiert.
 */
/** DMARC fehlgeschlagen oder (ohne DMARC) SPF fehlgeschlagen – der Absender ist womöglich gefälscht */
function authFailed(h) {
  const ar = String((h && h['authentication-results']) || '').toLowerCase();
  if (!ar) return false;
  const get = (k) => { const m = new RegExp(`\\b${k}=([a-z]+)`).exec(ar); return m ? m[1] : null; };
  const dmarc = get('dmarc');
  return dmarc === 'fail' || (dmarc === null && get('spf') === 'fail');
}

/** Eigene Adressen/Kontakte/vertrauenswürdige nie aussortieren – außer die Absenderprüfung schlägt fehl
 *  (z. B. Erpresser-Mail „von dir selbst“) */
function isSpam(m, { level = 'medium', own = [], known = new Set() } = {}) {
  const a = normalizeAddress(m.fromAddress);
  if (a && !m.authFailed && (own.includes(a) || known.has(a) || known.has(`@${domainOf(a)}`))) return false;
  const limit = SPAM_LEVELS[level] || SPAM_LEVELS.medium;
  const score = typeof m.spamScore === 'number' ? m.spamScore : spamScore(m).score;
  return score >= limit;
}

/** Gmail und Googlemail sind dieselbe Adresse */
function normalizeAddress(address) {
  const a = String(address || '').trim().toLowerCase();
  return a.endsWith('@googlemail.com') ? `${a.slice(0, -'googlemail.com'.length)}gmail.com` : a;
}


// =================================================================== Tracking-Schutz
// Bekannte Dienste für Öffnungs-Tracking in Mails. Die Mac-Version (Privacy.swift) nutzt dieselben Listen.
const TRACKER_HOSTS = [
  'list-manage.com', 'mandrillapp.com', 'mcsv.net', 'sendgrid.net', 'mailgun.org', 'hubspotemail.net', 'hubspotlinks.com',
  'hs-analytics.net', 'track.hubspot.com', 'awstrack.me', 'mjt.lu', 'sendibt2.com', 'sendibt3.com', 'sendibw.com',
  'klclick.com', 'klclick1.com', 'cmail19.com', 'cmail20.com', 'rs6.net', 'exct.net', 'customeriomail.com',
  'track.customer.io', 'pstmrk.it', 'via.intercom.io', 'mailtrack.io', 't.yesware.com', 'mailfoogae.appspot.com',
  'getnotify.com', 'bananatag.com', 'track.mixmax.com', 'r.superhuman.com', 'sidekickopen01.com', 'acemlna.com',
  'acemlnb.com', 'acemlnc.com', 'acemlnd.com', 'crsend.com', 'mlsend.com', 'zcsend.net', 'dripemail2.com',
  'doubleclick.net', 'google-analytics.com', 'googletagmanager.com', 'pixel.wp.com', 'mathtag.com', 'emltrk.com',
  'returnpath.net', 'nl-tracking.com', 'pippio.com', 'liadm.com', 'mi-msg.com', 'eccmp.com', 'emailopen.net',
];
// Typische Pfade von Öffnungs-Pixeln
const TRACKER_PATH = /(\/track(ing)?\/(open|o)\b|\/open\.(php|aspx|gif|jsp)|\/wf\/open|\/e\/o\/|\/oo\/|\/o\.gif|\/on\.jsp|\/trk\/|\/pixel(\.gif|\.png|\/|\?|$)|\/beacon\b|\/openrate|\/imp\?|\/t\.gif|\/tr\?|\/mpss\/o\/|\/ss\/o\/)/i;

function hostOf(url) {
  try { return new URL(String(url).startsWith('//') ? `https:${url}` : String(url)).hostname.toLowerCase(); } catch { return ''; }
}
/** Liegt die Adresse auf einer bekannten Tracking-Domain oder hat sie einen typischen Pixel-Pfad? */
function isTrackerUrl(url) {
  const host = hostOf(url);
  if (!host) return false;
  if (TRACKER_HOSTS.some((d) => host === d || host.endsWith(`.${d}`))) return true;
  let p = '';
  try { const u = new URL(String(url).startsWith('//') ? `https:${url}` : String(url)); p = u.pathname + u.search; } catch { return false; }
  return TRACKER_PATH.test(p);
}

// Tracking-Parameter, die beim Öffnen eines Links entfernt werden (wie Apples Link-Tracking-Schutz)
const TRACKING_PARAMS = new Set(['fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'twclid', 'ttclid', 'li_fat_id',
  'mc_cid', 'mc_eid', '_hsenc', '_hsmi', '__hssc', '__hstc', '__hsfp', 'hsctatracking', 'mkt_tok', 'oly_anon_id', 'oly_enc_id',
  'vero_conv', 'vero_id', 'wickedid', 'igshid', '_ke', 'ck_subscriber_id', 'ml_subscriber', 'ml_subscriber_hash', 'sc_cid', 's_cid',
  'ecid', 'ncid', 'trk_contact', 'trk_msg', 'trk_module', 'trk_sid', 'sfmc_id', 'sfmc_activityid', 'et_rid', 'et_cid', 'cmpid', 'mbid']);
/** Link ohne Tracking-Parameter (utm_* und bekannte Kennungen); andere Parameter bleiben unverändert */
function cleanLinkUrl(url) {
  let u;
  try { u = new URL(String(url)); } catch { return String(url); }
  if (!/^https?:$/.test(u.protocol)) return String(url);
  const keys = [...u.searchParams.keys()];
  const drop = keys.filter((k) => /^utm_/i.test(k) || TRACKING_PARAMS.has(k.toLowerCase()));
  if (!drop.length) return String(url);
  for (const k of drop) u.searchParams.delete(k);
  return u.toString();
}

module.exports = { isTrackerUrl, cleanLinkUrl, TRACKER_HOSTS, TRACKER_PATH, authFailed, normalizeAddress, analyze, isBlocked, baseDomain, domainOf, spamScore, isSpam, SPAM_LEVELS };
