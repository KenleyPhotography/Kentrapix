import { service } from './service.js';
import { bindAdminBooking } from './booking.js';
import { bindBookingOperations } from './public-services-admin.js';
import { bindSubscriptions } from './subscriptions-admin.js';

export function adminRequestsPage() {
  const tabs = [['reservations', 'Réservations']];
  if (service.data.platformOwner) tabs.push(['applications', 'Candidatures'], ['payments', 'Paiements'], ['subscriptions', 'Abonnements']);
  return `<header class="page-head"><h1>Demandes</h1></header><p>Consultez les demandes reçues et choisissez la réponse à apporter.</p>
    <div class="filterbar" role="group" aria-label="Types de demandes">${tabs.map(([key, label], i) => `<button type="button" class="chip${i ? '' : ' active'}" data-request-tab="${key}" aria-pressed="${!i}">${label}</button>`).join('')}</div>
    <div class="row between"><p class="small" id="requests-description"></p><button type="button" class="btn" id="requests-refresh">Actualiser</button></div>
    <div id="requests-content" aria-live="polite"></div>`;
}

export function bindAdminRequests({ toast, modal, clients, refresh }) {
  const host = document.getElementById('requests-content');
  const reload = document.getElementById('requests-refresh');
  const description = document.getElementById('requests-description');
  const tabs = [...document.querySelectorAll('[data-request-tab]')];
  let current = 'reservations';
  let generation = 0;
  async function load(key = current) {
    if (key !== 'reservations' && !service.data.platformOwner) return;
    current = key;
    const run = ++generation;
    tabs.forEach(tab => {
      tab.classList.toggle('active', tab.dataset.requestTab === key);
      tab.setAttribute('aria-pressed', String(tab.dataset.requestTab === key));
    });
    const root = document.createElement('section');
    root.innerHTML = '<p role="status">Chargement…</p>';
    host.replaceChildren(root);
    reload.disabled = true;
    try {
      if (key === 'reservations') {
        description.textContent = 'Acceptez, refusez ou proposez une autre date aux clients.';
        root.id = 'bka-root';
        await bindAdminBooking({ toast, modal, clients, requestsOnly: true });
      } else if (key === 'applications') {
        description.textContent = 'Examinez les candidatures et approuvez les photographes après vérification.';
        await bindBookingOperations(root, toast, true, async () => { await refresh(); });
      } else if (key === 'payments') {
        description.textContent = 'Vérifiez les TransCodes dans votre compte de paiement avant validation.';
        await bindBookingOperations(root, toast);
      } else {
        description.textContent = 'Vérifiez les règlements et activez les abonnements photographes.';
        await bindSubscriptions(root, toast);
      }
    } catch (error) { root.textContent = error.message; }
    finally { if (run === generation) reload.disabled = false; }
  }
  tabs.forEach(tab => tab.addEventListener('click', () => load(tab.dataset.requestTab)));
  reload.addEventListener('click', () => load());
  load();
}
