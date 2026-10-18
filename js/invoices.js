// Espace client : mes factures, avec « Payer par MonCash / NatCash ». Aucun paiement ne passe par le site :
// on montre le numéro du photographe, le montant et la référence ; le client envoie l'argent puis prévient son photographe.
import { api, escape, hello } from './service.js';
import { icon } from './icons.js';

const STATUS = { paid: ['Payée', 'is-live'], partial: ['Partielle', 'is-draft'], unpaid: ['À payer', 'is-draft'], overdue: ['En retard', 'is-late'] };
const money = (n, c) => { try { return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: c, minimumFractionDigits: 0, maximumFractionDigits: Number.isInteger(n) ? 0 : 2 }).format(n); } catch { return `${n} ${c}`; } };
const fday = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
const digits = (s) => String(s || '').replace(/[^0-9]/g, '');

export const clientInvoicesPage = () => '<div class="greeting"><h1>Mes factures</h1><p>Consultez vos factures et réglez-les par MonCash ou NatCash.</p></div><div id="invC-root"><div class="empty small"><p>Chargement…</p></div></div>';

export async function bindClientInvoices({ toast, modal }) {
  const root = document.getElementById('invC-root');
  if (!root) return;
  let list;
  try { list = (await api('/api/client/invoices')).invoices; } catch (e) { root.innerHTML = `<div class="empty"><h2>${escape(e.message)}</h2></div>`; return; }
  if (!list.length) { root.innerHTML = '<div class="empty"><h2>Aucune facture pour le moment</h2><p>Les factures de votre photographe apparaissent ici.</p></div>'; return; }
  const canPay = (i) => i.balance > 0 && (i.pay.moncash || i.pay.natcash);
  const card = (i) => `<article class="inv-card ${i.status === 'overdue' ? 'is-late' : ''}">
    <header><span class="inv-ico">${icon('file')}</span><div><strong>${escape(i.number)}</strong><span>${escape(i.title)} · ${escape(i.studio)}</span></div><span class="badge ${STATUS[i.status][1]}">${STATUS[i.status][0]}</span></header>
    <dl class="inv-amounts"><div><dt>Total</dt><dd>${escape(money(i.total, i.currency))}</dd></div><div><dt>Payé</dt><dd>${escape(money(i.paid, i.currency))}</dd></div><div><dt>Reste</dt><dd class="${i.status === 'overdue' ? 'amt-late' : ''}">${escape(money(Math.max(0, i.balance), i.currency))}</dd></div></dl>
    <p class="inv-foot"><span>Émise le ${escape(fday(i.issuedAt))}</span>${i.balance > 0 ? `<span>Échéance : ${escape(fday(i.dueDate))}</span>` : ''}</p>
    <div class="actions"><a class="btn sm" href="${escape(i.url)}" target="_blank" rel="noopener noreferrer">${icon('eye')} Voir la facture</a>
      ${canPay(i) ? `<button type="button" class="btn sm primary" data-inv-pay="${i.id}">${icon('cash')} Payer (MonCash / NatCash)</button>` : ''}</div>
  </article>`;
  const open = list.filter((i) => i.balance > 0), paid = list.filter((i) => i.balance <= 0);
  root.innerHTML = `${open.length ? `<section class="settings bill-block"><h2>À régler</h2><div class="inv-grid">${open.map(card).join('')}</div></section>` : ''}
    ${paid.length ? `<section class="settings bill-block"><h2>Payées</h2><div class="inv-grid">${paid.map(card).join('')}</div></section>` : ''}`;

  root.querySelectorAll('[data-inv-pay]').forEach((b) => { b.onclick = () => {
    const i = list.find((x) => x.id === b.dataset.invPay);
    const amount = money(i.balance, i.currency);
    const method = (name, num) => num ? `<div class="pay-method"><strong>${name}</strong><span class="pay-num">${escape(num)}</span><button type="button" class="btn sm" data-copy-pay="${escape(num)}">${icon('copy')} Copier le numéro</button></div>` : '';
    const wa = digits(i.pay.whatsapp) ? `https://wa.me/${digits(i.pay.whatsapp)}?text=${encodeURIComponent(`${hello()}, j’ai envoyé ${amount} pour la facture ${i.number}. Voici la preuve de paiement.`)}` : '';
    modal(`Payer la facture ${i.number}`, `<div class="pay-box">
      <p class="pay-amount">À envoyer : <strong>${escape(amount)}</strong></p>
      <ol class="pay-steps"><li>Ouvrez MonCash ou NatCash sur votre téléphone.</li><li>Envoyez <strong>${escape(amount)}</strong> à l’un des numéros ci-dessous.</li><li>Écrivez <strong>${escape(i.number)}</strong> comme référence si l’application le permet.</li><li>Prévenez ${escape(i.studio || 'votre photographe')} avec la capture d’écran : il enregistrera votre paiement.</li></ol>
      ${method('MonCash', i.pay.moncash)}${method('NatCash', i.pay.natcash)}
      ${i.pay.note ? `<p class="small">${escape(i.pay.note)}</p>` : ''}
      <p class="small">Le paiement ne se fait pas sur ce site : la facture sera marquée « payée » quand votre photographe aura reçu l’argent.</p>
      ${wa ? `<a class="btn primary" href="${escape(wa)}" target="_blank" rel="noopener noreferrer">${icon('chat')} J’ai payé : prévenir sur WhatsApp</a>` : ''}</div>`);
    document.querySelectorAll('#overlays [data-copy-pay]').forEach((c) => { c.onclick = async () => { try { await navigator.clipboard.writeText(c.dataset.copyPay); toast('Numéro copié.'); } catch { toast(c.dataset.copyPay); } }; });
  }; });
}
