// Administration du studio : factures, paiements, soldes clients, rappels — et statistiques avec graphiques.
// Les graphiques sont en SVG pur (aucune bibliothèque), avec infobulles, légende et vue « tableau » pour l'accessibilité.
import { service, api, escape } from './service.js';
import { icon } from './icons.js';
import { auth } from './auth.js';

const METHODS = { especes: 'Espèces', moncash: 'MonCash', natcash: 'NatCash', virement: 'Virement', carte: 'Carte', cheque: 'Chèque', autre: 'Autre' };
const CURRENCIES = { USD: 'Dollar US', HTG: 'Gourde', EUR: 'Euro', CAD: 'Dollar canadien' };
const STATUS = {
  paid: ['Payée', 'is-live'], partial: ['Partielle', 'is-draft'], unpaid: ['À payer', 'is-draft'], overdue: ['En retard', 'is-late'], cancelled: ['Annulée', 'is-muted'],
};

let bill = null; // { invoices, reminders, today } renvoyé par /api/admin/billing
let currency = null;
let invFilter = 'all';
let ctx = null;

const money = (n, c) => { try { return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: c, minimumFractionDigits: 0, maximumFractionDigits: Number.isInteger(n) ? 0 : 2 }).format(n); } catch { return `${n} ${c}`; } };
const fday = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
const digits = (s) => String(s || '').replace(/[^0-9]/g, '');
const initials = (n) => String(n || '').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const first = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const mb = (b) => `${(b / 1024 / 1024).toFixed(1)} Mo`;
const studioName = () => { const u = auth.session(); return u?.senderName || u?.name || 'votre photographe'; };
const clients = () => service.data.clients || [];
const clientOf = (id) => clients().find((c) => c.id === id);
const pill = (status) => `<span class="badge ${STATUS[status][1]}">${status === 'overdue' ? `${icon('clock')} ` : ''}${STATUS[status][0]}</span>`;
const person = (name, sub, avatar) => `<div class="person">${avatar ? `<img class="avatar" src="${escape(avatar)}" alt="">` : `<span class="avatar">${escape(initials(name))}</span>`}<div><strong>${escape(name)}</strong><span>${escape(sub || '')}</span></div></div>`;
const daysBetween = (a, b) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 864e5);

const waLink = (number, text) => (digits(number) ? `https://wa.me/${digits(number)}?text=${encodeURIComponent(text)}` : '');
const reminderText = (inv) => `Bonjour ${first(inv.client.name)}, c’est ${studioName()}. Petit rappel : il reste ${money(inv.balance, inv.currency)} à régler pour « ${inv.title} » (facture ${inv.number}). Vous pouvez la consulter ici : ${inv.url}. Merci !`;
const invoiceText = (inv) => `Bonjour ${first(inv.client.name)}, c’est ${studioName()}. Voici votre facture ${inv.number} (« ${inv.title} ») : ${money(inv.total, inv.currency)}. Vous pouvez la consulter ici : ${inv.url}. Merci !`;

async function load() {
  bill = await api('/api/admin/billing');
  const counts = {};
  for (const i of bill.invoices) counts[i.currency] = (counts[i.currency] || 0) + 1;
  if (!currency || !counts[currency]) currency = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || currency || 'USD';
  return bill;
}

/** Totaux d'une devise : facturé, encaissé, reste à payer, en retard. */
function totals(cur = currency) {
  const t = { billed: 0, collected: 0, due: 0, overdue: 0, overdueCount: 0, openCount: 0 };
  for (const i of bill.invoices) {
    if (i.currency !== cur || i.status === 'cancelled') continue;
    t.billed += i.total; t.collected += i.paid; t.due += Math.max(0, i.balance);
    if (i.balance > 0) t.openCount += 1;
    if (i.status === 'overdue') { t.overdue += i.balance; t.overdueCount += 1; }
  }
  return t;
}

/** Une ligne par client ayant des factures : facturé, payé, solde, statut. */
function balances(cur = currency) {
  const map = new Map();
  for (const i of bill.invoices) {
    if (i.currency !== cur || i.status === 'cancelled') continue;
    const row = map.get(i.client.id) || { client: i.client, billed: 0, paid: 0, balance: 0, overdue: 0, next: null, open: [] };
    row.billed += i.total; row.paid += i.paid; row.balance += Math.max(0, i.balance);
    if (i.status === 'overdue') row.overdue += i.balance;
    if (i.balance > 0) row.open.push(i);
    map.set(i.client.id, row);
  }
  return [...map.values()].sort((a, b) => b.overdue - a.overdue || b.balance - a.balance);
}

const currencyChips = () => {
  const used = [...new Set(bill.invoices.map((i) => i.currency))];
  if (used.length < 2) return '';
  return `<div class="type-chips" role="group" aria-label="Devise">${used.map((c) => `<button class="chip ${c === currency ? 'active' : ''}" data-cur="${c}">${c}</button>`).join('')}</div>`;
};

// ====================================================================================================
//  Page « Administration »
// ====================================================================================================
const head = (title, actions = '') => `<header class="page-head"><h1>${title}</h1>${actions ? `<div class="page-actions">${actions}</div>` : ''}</header>`;
const btn = (label, attr, ico = '', cls = '') => `<button class="btn sm ${cls}" ${attr}>${ico ? icon(ico) : ''}${label}</button>`;
const ibtn = (label, attr, ico, cls = '') => `<button type="button" class="btn sm icon-btn ${cls}" ${attr} title="${label}" aria-label="${label}" data-tip="${label}">${icon(ico)}</button>`;
const alink = (label, href, ico, cls = '') => `<a class="btn sm icon-btn ${cls}" href="${escape(href)}" target="_blank" rel="noopener noreferrer" title="${label}" aria-label="${label}" data-tip="${label}">${icon(ico)}</a>`;

export function billingPage() {
  return `${head('Administration', `${btn('Statistiques', 'data-nav="Statistics"', 'up')}${btn('Nouveau rappel', 'id="bill-new-reminder"', 'clock')}${btn('Nouvelle facture', 'id="bill-new-invoice"', 'plus', 'primary')}`)}<div id="bill-root">${bill ? billingHtml() : '<div class="empty"><h2>Chargement…</h2></div>'}</div>`;
}

function billingHtml() {
  const t = totals();
  const rows = balances();
  const list = bill.invoices.filter((i) => (invFilter === 'all' ? true : invFilter === 'open' ? i.status === 'unpaid' || i.status === 'partial' : i.status === invFilter));
  const counts = (s) => bill.invoices.filter((i) => (s === 'open' ? i.status === 'unpaid' || i.status === 'partial' : s === 'all' ? true : i.status === s)).length;
  const chip = (k, l) => `<button class="chip ${invFilter === k ? 'active' : ''}" data-inv-filter="${k}">${l} <small>${counts(k)}</small></button>`;
  return `${currencyChips()}
  <div class="stats">
    <div class="stat">${icon('albums')}<p>Facturé</p><strong>${escape(money(t.billed, currency))}</strong></div>
    <div class="stat">${icon('check')}<p>Encaissé</p><strong>${escape(money(t.collected, currency))}</strong></div>
    <div class="stat">${icon('clock')}<p>Reste à payer</p><strong>${escape(money(t.due, currency))}</strong><span class="small">${t.openCount} facture${t.openCount > 1 ? 's' : ''} ouverte${t.openCount > 1 ? 's' : ''}</span></div>
    <div class="stat stat-late">${icon('bell')}<p>En retard</p><strong>${escape(money(t.overdue, currency))}</strong><span class="small">${t.overdueCount} facture${t.overdueCount > 1 ? 's' : ''}</span></div>
  </div>

  ${reminderSection()}

  <section class="settings bill-block"><h2>Soldes des clients</h2>
  ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Client</th><th>Facturé</th><th>Payé</th><th>Solde</th><th>Statut</th><th>Contact</th></tr></thead><tbody>${rows.map((r) => {
    const num = r.client.whatsapp || r.client.phone;
    const worst = r.open.sort((a, b) => (b.status === 'overdue') - (a.status === 'overdue'))[0];
    const status = r.balance <= 0 ? '<span class="badge is-live">Soldé</span>' : r.overdue > 0 ? pill('overdue') : '<span class="badge is-draft">Solde dû</span>';
    return `<tr><td>${person(r.client.name, num || r.client.email, clientOf(r.client.id)?.avatar)}</td><td>${escape(money(r.billed, currency))}</td><td>${escape(money(r.paid, currency))}</td><td><strong class="${r.overdue > 0 ? 'amt-late' : ''}">${escape(money(r.balance, currency))}</strong></td><td>${status}</td><td class="actions">${worst && waLink(num, reminderText(worst)) ? alink('WhatsApp (message de rappel prêt)', waLink(num, reminderText(worst)), 'chat') : ''}${num ? alink('Appeler', `tel:${num.replace(/[^0-9+]/g, '')}`, 'phone') : ''}${worst ? ibtn('Rappel par e-mail', `data-remind="${worst.id}"`, 'mail') : ''}${ibtn('Nouvelle facture', `data-new-invoice-for="${r.client.id}"`, 'plus')}</td></tr>`;
  }).join('')}</tbody></table></div>` : '<div class="empty small"><p>Aucun solde pour le moment : créez une facture pour un client.</p></div>'}
  </section>

  <section class="settings bill-block"><h2>Factures</h2>
  <div class="type-chips" role="group" aria-label="Filtrer les factures">${chip('all', 'Toutes')}${chip('open', 'À payer')}${chip('overdue', 'En retard')}${chip('paid', 'Payées')}${chip('cancelled', 'Annulées')}</div>
  ${list.length ? `<div class="inv-grid">${list.map(invoiceCard).join('')}</div>` : '<div class="empty small"><p>Aucune facture ici.</p></div>'}
  </section>`;
}

function invoiceCard(i) {
  const num = i.client.whatsapp;
  const wa = waLink(num || i.client.phone, i.status === 'paid' ? invoiceText(i) : reminderText(i));
  const open = i.status !== 'cancelled' && i.status !== 'paid';
  return `<article class="inv-card ${i.status === 'overdue' ? 'is-late' : ''} ${i.status === 'cancelled' ? 'is-off' : ''}">
    <header><span class="inv-ico">${icon('file')}</span><div><strong>${escape(i.number)}</strong><span>${escape(i.title)}</span></div>${pill(i.status)}</header>
    <p class="inv-type"><span class="badge ${i.paymentType === 'cash' ? 'is-live' : 'is-draft'}">${i.paymentType === 'cash' ? 'Cash' : 'Crédit'}</span>${i.paymentType === 'credit' && i.paid > 0 ? `<span>Avance reçue : ${escape(money(i.paid, i.currency))}</span>` : ''}</p>
    <p class="inv-client">${icon('users')} ${escape(i.client.name)}${i.eventName ? ` · ${escape(i.eventName)}` : ''}</p>
    <dl class="inv-amounts"><div><dt>Total</dt><dd>${escape(money(i.total, i.currency))}</dd></div><div><dt>Payé</dt><dd>${escape(money(i.paid, i.currency))}</dd></div><div><dt>Solde</dt><dd class="${i.status === 'overdue' ? 'amt-late' : ''}">${escape(money(Math.max(0, i.balance), i.currency))}</dd></div></dl>
    <p class="inv-foot"><span>Échéance : ${fday(i.dueDate)}</span>${i.sentAt ? '<span>Envoyée par e-mail</span>' : ''}</p>
    <div class="actions">${alink('Voir la facture', i.url, 'eye')}${open ? ibtn('Enregistrer un paiement', `data-pay="${i.id}"`, 'check') : ''}${i.status !== 'cancelled' ? ibtn('Envoyer par e-mail', `data-send="${i.id}"`, 'send') : ''}${open ? ibtn('Rappel par e-mail', `data-remind="${i.id}"`, 'mail') : ''}${wa ? alink('WhatsApp', wa, 'chat') : ''}${ibtn('Gérer', `data-manage-invoice="${i.id}"`, 'more')}</div>
  </article>`;
}

function reminderSection() {
  const today = bill.today;
  // Suggestions automatiques : factures en retard ou qui arrivent à échéance dans 3 jours.
  const auto = bill.invoices.filter((i) => i.currency === currency && i.balance > 0 && i.status !== 'cancelled' && i.dueDate && daysBetween(i.dueDate, today) <= 3)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const own = bill.reminders;
  const autoHtml = auto.map((i) => {
    const d = daysBetween(today, i.dueDate);
    const when = d > 0 ? `en retard de ${d} jour${d > 1 ? 's' : ''}` : d === 0 ? 'échéance aujourd’hui' : `échéance dans ${-d} jour${d < -1 ? 's' : ''}`;
    const wa = waLink(i.client.whatsapp, reminderText(i));
    return `<li class="rem-row ${d > 0 ? 'is-late' : ''}"><span class="rem-ico">${icon(d > 0 ? 'bell' : 'clock')}</span><div><strong>${escape(i.client.name)}</strong><span>${escape(i.number)} · reste ${escape(money(i.balance, i.currency))} · ${when}</span></div><div class="actions">${wa ? alink('WhatsApp', wa, 'chat') : ''}${ibtn('Rappel par e-mail', `data-remind="${i.id}"`, 'mail')}</div></li>`;
  }).join('');
  const ownHtml = own.map((r) => {
    const late = !r.done && r.dueAt < today;
    return `<li class="rem-row ${r.done ? 'is-done' : ''} ${late ? 'is-late' : ''}"><label class="rem-check"><input type="checkbox" data-rem-done="${r.id}" ${r.done ? 'checked' : ''} aria-label="Terminé"></label><div><strong>${escape(r.title)}</strong><span>${fday(r.dueAt)}${r.clientName ? ` · ${escape(r.clientName)}` : ''}${late ? ' · en retard' : ''}</span></div><div class="actions">${ibtn('Supprimer', `data-rem-del="${r.id}"`, 'trash')}</div></li>`;
  }).join('');
  return `<section class="settings bill-block"><h2>Rappels</h2>
    ${autoHtml || ownHtml ? `<ul class="rem-list">${autoHtml}${ownHtml}</ul>` : '<div class="empty small"><p>Aucun rappel. Les factures en retard ou bientôt échues apparaissent ici automatiquement.</p></div>'}</section>`;
}

export async function bindBilling(c) {
  ctx = c;
  const root = document.getElementById('bill-root');
  if (!root) return;
  if (!bill) { try { await load(); } catch (e) { root.innerHTML = `<div class="empty"><h2>${escape(e.message)}</h2></div>`; return; } }
  const redraw = () => { const r = document.getElementById('bill-root'); if (r) { r.innerHTML = billingHtml(); wire(); } };
  const act = (fn) => async (...a) => { try { await fn(...a); } catch (e) { ctx.toast(e.message); } };
  const refreshAll = async () => { await load(); redraw(); };
  const find = (id) => bill.invoices.find((i) => i.id === id);
  const mailResult = (r, ok) => ctx.toast(r.email.status === 'sent' ? ok : r.email.status === 'skipped' ? 'E-mail non envoyé : l’envoi d’e-mails n’est pas actif sur ce serveur.' : `E-mail non envoyé : ${r.email.error || 'erreur'}`);

  function wire() {
    const r = document.getElementById('bill-root');
    if (!r) return;
    r.querySelectorAll('[data-cur]').forEach((b) => { b.onclick = () => { currency = b.dataset.cur; redraw(); }; });
    r.querySelectorAll('[data-inv-filter]').forEach((b) => { b.onclick = () => { invFilter = b.dataset.invFilter; redraw(); }; });
    r.querySelectorAll('[data-nav]').forEach((b) => { b.onclick = () => ctx.navigate(b.dataset.nav); });
    r.querySelectorAll('[data-pay]').forEach((b) => { b.onclick = () => payModal(find(b.dataset.pay)); });
    r.querySelectorAll('[data-manage-invoice]').forEach((b) => { b.onclick = () => manageModal(find(b.dataset.manageInvoice)); });
    r.querySelectorAll('[data-send]').forEach((b) => { b.onclick = act(async () => {
      const inv = find(b.dataset.send);
      if (!confirm(`Envoyer la facture ${inv.number} à ${inv.client.name} (${inv.client.email}) ?`)) return;
      b.disabled = true; const res = await api(`/api/admin/invoices/${inv.id}/send`, { method: 'POST' }); mailResult(res, 'Facture envoyée par e-mail.'); await refreshAll();
    }); });
    r.querySelectorAll('[data-remind]').forEach((b) => { b.onclick = act(async () => {
      const inv = find(b.dataset.remind);
      if (!confirm(`Envoyer un rappel de paiement à ${inv.client.name} (reste ${money(inv.balance, inv.currency)}) ?`)) return;
      b.disabled = true; const res = await api(`/api/admin/invoices/${inv.id}/remind`, { method: 'POST' }); mailResult(res, 'Rappel envoyé par e-mail.'); await refreshAll();
    }); });
    r.querySelectorAll('[data-new-invoice-for]').forEach((b) => { b.onclick = () => invoiceModal(b.dataset.newInvoiceFor); });
    r.querySelectorAll('[data-rem-done]').forEach((b) => { b.onchange = act(async () => { await api(`/api/admin/reminders/${b.dataset.remDone}`, { method: 'PATCH', body: { done: b.checked } }); await refreshAll(); }); });
    r.querySelectorAll('[data-rem-del]').forEach((b) => { b.onclick = act(async () => { await api(`/api/admin/reminders/${b.dataset.remDel}`, { method: 'DELETE' }); await refreshAll(); }); });
  }

  // ---- Fenêtres ----
  function clientOptions(selected) {
    const list = clients().filter((c) => c.active !== false);
    return list.map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${escape(c.name)}${c.email ? ` — ${escape(c.email)}` : ''}</option>`).join('');
  }
  function invoiceModal(clientId) {
    if (!clients().length) return ctx.toast('Ajoutez d’abord un client.');
    const evs = service.data.events || [];
    ctx.modal('Nouvelle facture', `
      <label>Client<select name="clientId" id="inv-client" required>${clientOptions(clientId)}</select></label>
      <label>Galerie <span class="optional">(facultatif)</span><select name="eventId" id="inv-event"><option value="">Aucune</option>${evs.map((e) => `<option value="${e.id}" data-c="${e.clientId}">${escape(e.name)}</option>`).join('')}</select></label>
      <label>Titre de la facture<input name="title" required maxlength="200" placeholder="Ex. Mariage — forfait complet"></label>
      <div class="row2"><label>Montant<input name="amount" type="number" min="0.01" step="0.01" required></label>
      <label>Devise<select name="currency">${Object.entries(CURRENCIES).map(([k, v]) => `<option value="${k}" ${k === currency ? 'selected' : ''}>${k} — ${v}</option>`).join('')}</select></label></div>
      <label>Type de paiement<select name="paymentType" id="inv-type"><option value="credit">Crédit — avance maintenant, solde plus tard</option><option value="cash">Cash — payé en totalité maintenant</option></select></label>
      <div class="row2" id="inv-advance-row"><label>Avance reçue <span class="optional">(facultatif)</span><input name="advance" type="number" min="0" step="0.01" placeholder="0"></label>
      <label>Mode de paiement<select name="advanceMethod">${Object.entries(METHODS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label></div>
      <label>Échéance du solde <span class="optional">(facultatif)</span><input name="dueDate" type="date"></label>
      <label>Notes <span class="optional">(visibles sur la facture)</span><input name="notes" maxlength="1000" placeholder="Ex. Acompte de 50 % à la réservation"></label>`,
    async (v) => {
      const res = await api('/api/admin/invoices', { method: 'POST', body: { clientId: v.clientId, eventId: v.eventId || '', title: v.title, amount: v.amount, currency: v.currency, dueDate: v.dueDate || '', notes: v.notes || '', paymentType: v.paymentType, advance: v.paymentType === 'credit' ? (v.advance || '') : '', advanceMethod: v.advanceMethod } });
      await refreshAll();
      ctx.toast(`Facture ${res.invoice.number} créée.`);
    }, { submit: 'Créer la facture' });
    const sel = document.getElementById('inv-client'), ev = document.getElementById('inv-event');
    const filter = () => { ev.querySelectorAll('option[data-c]').forEach((o) => { o.hidden = o.dataset.c !== sel.value; o.disabled = o.hidden; }); if (ev.selectedOptions[0]?.disabled) ev.value = ''; };
    sel?.addEventListener('change', filter); filter();
    // Cash : tout est payé maintenant ; Crédit : on peut noter une avance et l'échéance du solde.
    const type = document.getElementById('inv-type'), adv = document.getElementById('inv-advance-row');
    const sync = () => { const cash = type.value === 'cash'; adv.querySelector('label:first-child').hidden = cash; adv.querySelector('input').disabled = cash; };
    type?.addEventListener('change', sync); sync();
  }
  function payModal(inv) {
    ctx.modal(`Paiement — ${inv.number}`, `
      <p class="small">${escape(inv.client.name)} · reste <strong>${escape(money(inv.balance, inv.currency))}</strong> sur ${escape(money(inv.total, inv.currency))}.</p>
      <label>Montant reçu (${inv.currency})<input name="amount" type="number" min="0.01" max="${inv.balance}" step="0.01" value="${inv.balance}" required></label>
      <label>Mode de paiement<select name="method">${Object.entries(METHODS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <label>Date<input name="paidAt" type="date" value="${bill.today}"></label>
      <label>Note <span class="optional">(facultatif)</span><input name="note" maxlength="200" placeholder="Ex. Reçu en main propre"></label>`,
    async (v) => {
      await api(`/api/admin/invoices/${inv.id}/payments`, { method: 'POST', body: { amount: v.amount, method: v.method, paidAt: v.paidAt, note: v.note || '' } });
      await refreshAll(); ctx.toast('Paiement enregistré.');
    }, { submit: 'Enregistrer le paiement' });
  }
  function manageModal(inv) {
    const pays = inv.payments.length
      ? `<ul class="rem-list">${inv.payments.map((p) => `<li class="rem-row"><span class="rem-ico">${icon('check')}</span><div><strong>${escape(money(p.amount, inv.currency))}</strong><span>${fday(p.paidAt)} · ${escape(METHODS[p.method] || p.method)}${p.note ? ` · ${escape(p.note)}` : ''}</span></div><div class="actions">${ibtn('Annuler ce paiement', `data-del-pay="${p.id}"`, 'trash')}</div></li>`).join('')}</ul>`
      : '<p class="small">Aucun paiement enregistré.</p>';
    ctx.modal(`Facture ${inv.number}`, `
      <label>Titre<input name="title" required maxlength="200" value="${escape(inv.title)}"></label>
      <div class="row2"><label>Total (${inv.currency})<input name="amount" type="number" min="${inv.paid || 0.01}" step="0.01" value="${inv.total}" required></label>
      <label>Échéance<input name="dueDate" type="date" value="${inv.dueDate || ''}"></label></div>
      <label>Notes<input name="notes" maxlength="1000" value="${escape(inv.notes)}"></label>
      <h3 class="bill-sub">Paiements</h3>${pays}
      <div class="bill-danger"><button type="button" class="btn sm" id="inv-cancel">${inv.status === 'cancelled' ? 'Rétablir la facture' : 'Annuler la facture'}</button><button type="button" class="btn sm danger" id="inv-delete">${icon('trash')} Supprimer</button></div>`,
    async (v) => {
      await api(`/api/admin/invoices/${inv.id}`, { method: 'PATCH', body: { title: v.title, amount: v.amount, dueDate: v.dueDate || '', notes: v.notes || '' } });
      await refreshAll(); ctx.toast('Facture enregistrée.');
    }, { submit: 'Enregistrer' });
    const host = document.getElementById('overlays');
    host.querySelectorAll('[data-del-pay]').forEach((b) => { b.onclick = act(async () => { if (!confirm('Annuler ce paiement ?')) return; await api(`/api/admin/payments/${b.dataset.delPay}`, { method: 'DELETE' }); host.innerHTML = ''; await refreshAll(); ctx.toast('Paiement annulé.'); }); });
    host.querySelector('#inv-cancel')?.addEventListener('click', act(async () => { await api(`/api/admin/invoices/${inv.id}`, { method: 'PATCH', body: { cancelled: inv.status !== 'cancelled' } }); host.innerHTML = ''; await refreshAll(); ctx.toast(inv.status === 'cancelled' ? 'Facture rétablie.' : 'Facture annulée.'); }));
    host.querySelector('#inv-delete')?.addEventListener('click', act(async () => { if (!confirm(`Supprimer définitivement la facture ${inv.number} et ses paiements ?`)) return; await api(`/api/admin/invoices/${inv.id}`, { method: 'DELETE' }); host.innerHTML = ''; await refreshAll(); ctx.toast('Facture supprimée.'); }));
  }
  function reminderModal() {
    ctx.modal('Nouveau rappel', `
      <label>Rappel<input name="title" required maxlength="200" placeholder="Ex. Relancer Marie pour l’album"></label>
      <label>Date<input name="dueAt" type="date" value="${bill.today}" required></label>
      <label>Client <span class="optional">(facultatif)</span><select name="clientId"><option value="">Aucun</option>${clientOptions('')}</select></label>`,
    async (v) => { await api('/api/admin/reminders', { method: 'POST', body: { title: v.title, dueAt: v.dueAt, clientId: v.clientId || '' } }); await refreshAll(); ctx.toast('Rappel ajouté.'); }, { submit: 'Ajouter' });
  }

  document.getElementById('bill-new-invoice').onclick = () => invoiceModal('');
  document.getElementById('bill-new-reminder').onclick = reminderModal;
  document.querySelectorAll('.page-actions [data-nav]').forEach((b) => { b.onclick = () => ctx.navigate(b.dataset.nav); });
  redraw();
}

// ====================================================================================================
//  Page « Statistiques » : graphiques
// ====================================================================================================
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** Les 12 derniers mois (du plus ancien au plus récent) : [{ key: '2026-05', label: 'mai', year }]. */
function lastMonths(n = 12) {
  const out = []; const d = new Date(); d.setUTCDate(1);
  for (let k = n - 1; k >= 0; k--) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - k, 1));
    out.push({ key: `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}`, label: MONTHS[x.getUTCMonth()], year: x.getUTCFullYear() });
  }
  return out;
}
const niceMax = (v) => { if (v <= 0) return 4; const p = 10 ** Math.floor(Math.log10(v)); const m = v / p; const n = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10; return n * p; };
const compact = (n) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(n % 1e3 ? 1 : 0)} k` : String(Math.round(n)));
let chartSeq = 0;

/** Histogramme vertical fin (barres arrondies en haut), grille discrète, zones de survol plus larges que les barres. */
function barChart({ title, sub, data, fmt, whole = false, cls = '' }) {
  const id = `ch${++chartSeq}`;
  const wide = cls.includes('wide') && window.innerWidth > 700; // petit écran : zone de dessin étroite, texte lisible
  const W = wide ? 640 : 380, H = wide ? 250 : 220, L = wide ? 46 : 34, R = 10, T = 12, B = 28;
  const top0 = Math.max(...data.map((d) => d.value), 0);
  const max = whole ? Math.max(4, Math.ceil(top0 / 4) * 4) : niceMax(top0);
  const plotW = W - L - R, plotH = H - T - B, band = plotW / data.length, bw = Math.min(26, band * 0.5);
  const y = (v) => T + plotH - (v / max) * plotH;
  const ticks = [0, 1, 2, 3, 4].map((i) => (max / 4) * i);
  const empty = data.every((d) => !d.value);
  const bars = data.map((d, i) => {
    const x = L + band * i + (band - bw) / 2, top = y(d.value), h = T + plotH - top, r = Math.min(4, h / 2);
    const path = d.value > 0 ? `M${x},${T + plotH} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${T + plotH} Z` : '';
    return `<g class="bar${i === data.length - 1 ? ' is-now' : ''}"><rect x="${L + band * i}" y="${T}" width="${band}" height="${plotH}" fill="transparent" data-vtip="${escape(`${d.full} : ${fmt(d.value)}`)}" tabindex="0" aria-label="${escape(`${d.full} : ${fmt(d.value)}`)}"/><path d="${path}" class="mk"/></g><text x="${L + band * i + band / 2}" y="${H - 9}" class="ax" text-anchor="middle">${i % 2 === 0 || data.length < 8 ? escape(d.label) : ''}</text>`;
  }).join('');
  const grid = ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="gl"/><text x="${L - 8}" y="${y(t) + 4}" class="ax" text-anchor="end">${escape(compact(t))}</text>`).join('');
  return `<figure class="viz ${cls}" id="${id}"><figcaption><strong>${escape(title)}</strong>${sub ? `<span>${escape(sub)}</span>` : ''}<button type="button" class="text-link" data-viz-table="${id}">Voir en tableau</button></figcaption>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escape(title)}">${grid}${bars}${empty ? `<text x="${W / 2}" y="${H / 2}" class="ax" text-anchor="middle">Aucune donnée sur cette période</text>` : ''}</svg>
    <table class="viz-table" hidden><thead><tr><th>Mois</th><th>${escape(sub || title)}</th></tr></thead><tbody>${data.map((d) => `<tr><td>${escape(d.full)}</td><td>${escape(fmt(d.value))}</td></tr>`).join('')}</tbody></table></figure>`;
}
let moneyFmt = (n) => String(n);

/** Anneau : répartition payé / à venir / en retard, étiquettes directes + légende (jamais la couleur seule). */
function donut({ title, parts, centerLabel, centerValue }) {
  const id = `ch${++chartSeq}`;
  const total = parts.reduce((n, p) => n + p.value, 0);
  const R = 70, C = 2 * Math.PI * R, cx = 100, cy = 100;
  let offset = 0;
  const arcs = total > 0 ? parts.filter((p) => p.value > 0).map((p) => {
    const len = Math.max(0, (p.value / total) * C - 2); // 2 px d'écart entre les segments
    const el = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke-width="26" class="seg ${p.cls}" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})" data-vtip="${escape(`${p.label} : ${p.text}`)}" tabindex="0" aria-label="${escape(`${p.label} : ${p.text}`)}"/>`;
    offset += (p.value / total) * C; return el;
  }).join('') : `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke-width="26" class="seg none"/>`;
  return `<figure class="viz donut" id="${id}"><figcaption><strong>${escape(title)}</strong><button type="button" class="text-link" data-viz-table="${id}">Voir en tableau</button></figcaption>
    <div class="donut-row"><svg viewBox="0 0 200 200" role="img" aria-label="${escape(title)}">${arcs}<text x="${cx}" y="${cy - 2}" class="dc-v" text-anchor="middle">${escape(centerValue)}</text><text x="${cx}" y="${cy + 16}" class="ax" text-anchor="middle">${escape(centerLabel)}</text></svg>
    <ul class="legend">${parts.map((p) => `<li><i class="sw ${p.cls}"></i><span>${p.icon ? `${icon(p.icon)} ` : ''}${escape(p.label)}</span><strong>${escape(p.text)}</strong></li>`).join('')}</ul></div>
    <table class="viz-table" hidden><thead><tr><th>État</th><th>Montant</th></tr></thead><tbody>${parts.map((p) => `<tr><td>${escape(p.label)}</td><td>${escape(p.text)}</td></tr>`).join('')}</tbody></table></figure>`;
}

/** Barres horizontales : classement (ex. plus gros soldes à recevoir). */
function hbars({ title, rows, fmt, empty }) {
  const id = `ch${++chartSeq}`;
  const max = Math.max(...rows.map((r) => r.value), 0) || 1;
  return `<figure class="viz hb" id="${id}"><figcaption><strong>${escape(title)}</strong><button type="button" class="text-link" data-viz-table="${id}">Voir en tableau</button></figcaption>
    ${rows.length ? `<ul class="hb-list">${rows.map((r) => `<li data-vtip="${escape(`${r.label} : ${fmt(r.value)}`)}" tabindex="0"><span class="hb-name">${escape(r.label)}</span><span class="hb-track"><i class="hb-bar ${r.cls || ''}" style="width:${Math.max(3, (r.value / max) * 100)}%"></i></span><strong>${escape(fmt(r.value))}</strong></li>`).join('')}</ul>` : `<p class="small viz-empty">${escape(empty)}</p>`}
    <table class="viz-table" hidden><thead><tr><th>Client</th><th>Montant</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${escape(r.label)}</td><td>${escape(fmt(r.value))}</td></tr>`).join('')}</tbody></table></figure>`;
}

function statsHtml() {
  const d = service.data;
  const cur = currency || 'USD';
  const months = lastMonths(12);
  moneyFmt = (n) => money(n, cur);
  const t = totals(cur);
  const monthIdx = Object.fromEntries(months.map((m, i) => [m.key, i]));
  const label = (m) => `${m.label} ${m.year}`;

  // Encaissements par mois (paiements reçus), dans la devise choisie
  const paidBy = months.map(() => 0);
  for (const i of bill.invoices) {
    if (i.currency !== cur || i.status === 'cancelled') continue;
    for (const p of i.payments) { const k = monthIdx[p.paidAt.slice(0, 7)]; if (k !== undefined) paidBy[k] += p.amount; }
  }
  const thisMonth = paidBy[paidBy.length - 1];

  const newClients = months.map(() => 0);
  for (const c of d.clients || []) { const k = monthIdx[String(c.createdAt || '').slice(0, 7)]; if (k !== undefined) newClients[k] += 1; }
  const galleries = months.map(() => 0);
  for (const e of d.events || []) { const k = monthIdx[String(e.date || '').slice(0, 7)]; if (k !== undefined) galleries[k] += 1; }

  const upcoming = Math.max(0, t.due - t.overdue);
  const debtors = balances(cur).filter((r) => r.balance > 0).slice(0, 6).map((r) => ({ label: r.client.name, value: r.balance, cls: r.overdue > 0 ? 'late' : '' }));

  const chips = currencyChips();
  return `${chips}
  <div class="stats">
    <div class="stat">${icon('check')}<p>Encaissé ce mois</p><strong>${escape(money(thisMonth, cur))}</strong></div>
    <div class="stat">${icon('albums')}<p>Facturé (total)</p><strong>${escape(money(t.billed, cur))}</strong></div>
    <div class="stat">${icon('clock')}<p>Reste à recevoir</p><strong>${escape(money(t.due, cur))}</strong></div>
    <div class="stat stat-late">${icon('bell')}<p>En retard</p><strong>${escape(money(t.overdue, cur))}</strong><span class="small">${t.overdueCount} facture${t.overdueCount > 1 ? 's' : ''}</span></div>
  </div>
  <div class="stats stats-mini">
    <div class="stat">${icon('users')}<p>Clients</p><strong>${(d.clients || []).length}</strong></div>
    <div class="stat">${icon('events')}<p>Galeries</p><strong>${(d.events || []).length}</strong></div>
    <div class="stat">${icon('photos')}<p>Photos</p><strong>${(d.photos || []).length}</strong></div>
    <div class="stat">${icon('download')}<p>Espace utilisé</p><strong>${mb(d.stats?.storageBytes || 0)}</strong></div>
  </div>
  <div class="viz-grid">
    ${barChart({ title: 'Encaissements par mois', sub: `Montant reçu (${cur})`, fmt: moneyFmt, data: months.map((m, i) => ({ label: m.label, full: label(m), value: paidBy[i] })), cls: 'wide' })}
    ${donut({ title: 'État des paiements', centerLabel: 'facturé', centerValue: compact(t.billed), parts: [
      { label: 'Payé', value: t.collected, text: money(t.collected, cur), cls: 'paid' },
      { label: 'À venir', value: upcoming, text: money(upcoming, cur), cls: 'due' },
      { label: 'En retard', value: t.overdue, text: money(t.overdue, cur), cls: 'late', icon: 'bell' },
    ] })}
    ${hbars({ title: 'Plus gros soldes à recevoir', rows: debtors, fmt: moneyFmt, empty: 'Aucun solde à recevoir : tous vos clients sont à jour.' })}
    ${barChart({ title: 'Nouveaux clients', sub: 'Clients créés', fmt: (n) => `${n} client${n > 1 ? 's' : ''}`, whole: true, data: months.map((m, i) => ({ label: m.label, full: label(m), value: newClients[i] })) })}
    ${barChart({ title: 'Galeries par mois', sub: 'Galeries (date de l’événement)', fmt: (n) => `${n} galerie${n > 1 ? 's' : ''}`, whole: true, data: months.map((m, i) => ({ label: m.label, full: label(m), value: galleries[i] })) })}
  </div><div id="viz-tip" class="viz-tip" role="tooltip" hidden></div>`;
}

export function statsPage() {
  return `${head('Statistiques', `${btn('Administration', 'data-nav="Billing"', 'star')}`)}<div id="stats-root">${bill ? statsHtml() : '<div class="empty"><h2>Chargement…</h2></div>'}</div>`;
}

export async function bindStats(c) {
  ctx = c;
  const root = document.getElementById('stats-root');
  if (!root) return;
  if (!bill) { try { await load(); } catch (e) { root.innerHTML = `<div class="empty"><h2>${escape(e.message)}</h2></div>`; return; } }
  document.querySelectorAll('.page-actions [data-nav]').forEach((b) => { b.onclick = () => ctx.navigate(b.dataset.nav); });
  const draw = () => {
    root.innerHTML = statsHtml();
    root.querySelectorAll('[data-cur]').forEach((b) => { b.onclick = () => { currency = b.dataset.cur; draw(); }; });
    root.querySelectorAll('[data-viz-table]').forEach((b) => {
      b.onclick = () => {
        const fig = document.getElementById(b.dataset.vizTable);
        const tbl = fig.querySelector('.viz-table');
        const show = tbl.hidden;
        tbl.hidden = !show;
        fig.querySelectorAll('svg, .hb-list, .donut-row').forEach((el) => { el.hidden = show; });
        b.textContent = show ? 'Voir le graphique' : 'Voir en tableau';
      };
    });
    // Infobulle : un seul bloc suivi du pointeur ; aussi au clavier (focus).
    const tip = document.getElementById('viz-tip');
    const place = (el, x, y) => {
      tip.textContent = el.dataset.vtip; tip.hidden = false;
      const box = root.getBoundingClientRect();
      tip.style.left = `${Math.min(Math.max(8, x - box.left + 12), box.width - tip.offsetWidth - 8)}px`;
      tip.style.top = `${Math.max(0, y - box.top - tip.offsetHeight - 12)}px`;
    };
    root.querySelectorAll('[data-vtip]').forEach((el) => {
      el.addEventListener('pointermove', (e) => place(el, e.clientX, e.clientY));
      el.addEventListener('pointerleave', () => { tip.hidden = true; });
      el.addEventListener('focus', () => { const r = el.getBoundingClientRect(); place(el, r.left + r.width / 2, r.top); });
      el.addEventListener('blur', () => { tip.hidden = true; });
    });
  };
  draw();
}

export const resetBilling = () => { bill = null; };
