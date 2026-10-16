// « Sa k pou fè » : tout ce qui attend le photographe, en haut de l'aperçu (contrats, factures en retard, sélections, rendez-vous, commandes, avis).
import { api, escape } from './service.js';
import { icon } from './icons.js';

const fday = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : '');
const money = (n, c) => { try { return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: c, maximumFractionDigits: Number.isInteger(n) ? 0 : 2 }).format(n); } catch { return `${n} ${c}`; } };

export const todoBlock = () => '<section class="settings bill-block todo-block" id="todo-root" hidden></section>';

export async function bindTodo({ navigate }) {
  const root = document.getElementById('todo-root');
  if (!root) return;
  let t;
  try { t = await api('/api/admin/todo'); } catch { return; } // facultatif : l'aperçu reste utilisable sans lui
  if (!root.isConnected) return;
  const groups = [
    { nav: 'Contracts', ico: 'file', late: true, title: 'Séances sans contrat signé', rows: t.unsignedBookings.map((b) => [b.client, `${fday(b.day)} à ${b.start}${b.sessionType ? ` · ${b.sessionType}` : ''}`]) },
    { nav: 'Contracts', ico: 'file', title: 'Contrats en attente de signature', rows: t.contracts.map((c) => [c.client, `${c.title}${c.bookingDay ? ` · séance ${fday(c.bookingDay)}` : ''}`]) },
    { nav: 'Billing', ico: 'bell', late: true, title: 'Factures en retard', rows: t.overdueInvoices.map((i) => [i.client, `${i.number} · reste ${money(i.balance, i.currency)} · échue ${fday(i.dueDate)}`]) },
    { nav: 'Booking', ico: 'clock', title: 'Rendez-vous demain', rows: t.tomorrow.map((b) => [b.client, `${b.start}${b.sessionType ? ` · ${b.sessionType}` : ''}`]) },
    { nav: 'Booking', ico: 'clock', title: 'Demandes de rendez-vous à confirmer', rows: t.bookingRequests.map((b) => [b.client, `${fday(b.day)} à ${b.start}`]) },
    { nav: 'Selections', ico: 'check', title: 'Sélections reçues (14 derniers jours)', rows: t.selections.map((s) => [s.client, `${s.event} · ${s.count} photo${s.count > 1 ? 's' : ''}`]) },
    { nav: 'Orders', ico: 'albums', title: 'Nouvelles commandes', rows: t.newOrders.map((o) => [o.client, 'À accepter']) },
    { nav: 'Reviews', ico: 'star', title: 'Avis à lire', rows: t.reviews.map((r) => [r.client, '★'.repeat(r.rating)]) },
  ].filter((g) => g.rows.length);
  root.hidden = false;
  if (!groups.length) { root.innerHTML = `<h2>Sa k pou fè</h2><div class="empty small"><p>${icon('check')} Tout est à jour. Rien n’attend pour le moment.</p></div>`; return; }
  root.innerHTML = `<h2>Sa k pou fè <span class="badge is-late">${groups.reduce((n, g) => n + g.rows.length, 0)}</span></h2>
    <div class="todo-grid">${groups.map((g, i) => `<article class="todo-card ${g.late ? 'is-late' : ''}">
      <header><span class="rem-ico">${icon(g.ico)}</span><strong>${escape(g.title)}</strong><span class="badge ${g.late ? 'is-late' : 'is-draft'}">${g.rows.length}</span></header>
      <ul>${g.rows.slice(0, 4).map(([a, b]) => `<li><strong>${escape(a)}</strong><span>${escape(b)}</span></li>`).join('')}</ul>
      ${g.rows.length > 4 ? `<p class="small">+ ${g.rows.length - 4} autre${g.rows.length - 4 > 1 ? 's' : ''}</p>` : ''}
      <button type="button" class="text-link" data-todo-go="${i}">Ouvrir</button></article>`).join('')}</div>`;
  root.querySelectorAll('[data-todo-go]').forEach((b) => { b.onclick = () => navigate(groups[Number(b.dataset.todoGo)].nav); });
}
