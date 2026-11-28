import { api, escape } from './service.js';

const labels = { unpaid: 'Non payé', active: 'Actif', expiring: 'Expire bientôt', expired: 'Expiré', suspended: 'Suspendu', exempt: 'Accès gratuit' };
const date = value => value ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeZone: 'America/Port-au-Prince' }).format(new Date(value)) : '—';
const period = value => value === 'year' ? '1 an' : '1 mois';

export async function bindSubscriptions(root, toast) {
  if (!root) return;
  try {
    const { subscriptions, photographers = [] } = await api('/api/admin/subscriptions');
    root.innerHTML = `<h2>Abonnements photographes</h2>
      <p>Vérifiez le montant et le TransCode avant d’activer un paiement. Un renouvellement du même forfait conserve les jours restants.</p>
      <label>Afficher<select data-subscription-filter><option value="all">Tous les photographes</option>${Object.entries(labels).map(([key, text]) => `<option value="${key}">${text}</option>`).join('')}</select></label>
      <div class="table-wrap"><table><thead><tr><th>Photographe</th><th>Forfait</th><th>Statut</th><th>Échéance</th><th>Actions</th></tr></thead><tbody>
      ${photographers.map(person => `<tr data-subscription-status="${escape(person.status)}"><td><strong>${escape(person.name)}</strong><br>${escape(person.email)}</td>
        <td>${person.plan ? escape(person.plan === 'studio' ? 'Studio' : 'Portfolio') + ' · ' + period(person.period) : 'Aucun'}</td>
        <td>${labels[person.status] || escape(person.status)}</td><td>${date(person.expires_at)}${person.days_left != null ? `<br><small>${person.days_left > 0 ? person.days_left + ' jour(s) restant(s)' : 'Échéance dépassée'}</small>` : ''}</td>
        <td><div class="row"><button type="button" class="btn sm" data-access="${escape(person.id)}" data-action="${person.suspended ? 'restore' : 'suspend'}">${person.suspended ? 'Rétablir' : 'Suspendre'}</button>
        <button type="button" class="btn sm" data-access="${escape(person.id)}" data-action="${person.exempt ? 'paid' : 'free'}">${person.exempt ? 'Exiger un abonnement' : 'Accorder un accès gratuit'}</button>
        <a class="btn sm" href="mailto:${escape(encodeURIComponent(person.email))}?subject=${encodeURIComponent('Renouvellement KentraPix')}&body=${encodeURIComponent(`Bonjour ${person.name}, votre abonnement KentraPix ${person.expires_at ? 'arrive à échéance le ' + date(person.expires_at) : 'doit être activé'}. Vous pouvez payer ou renouveler sur ${location.origin}/tarifs#souscrire.`)}">Rappeler par e-mail</a></div></td></tr>`).join('') || '<tr><td colspan="5">Aucun compte photographe.</td></tr>'}
      </tbody></table></div><p data-subscription-empty hidden>Aucun photographe avec ce statut.</p>
      <h3>Paiements à vérifier <span class="count-pill">${subscriptions.filter(item => !item.activated_at).length}</span></h3>
      ${subscriptions.map(item => `<article class="settings"><strong>${escape(item.email)}</strong><p>${escape(item.plan === 'studio' ? 'Studio' : 'Portfolio')} · ${period(item.period)} · ${item.amount} GDS · ${escape(item.method)}</p><p>TransCode : <strong>${escape(item.transfer_code)}</strong></p>
        ${item.activated_at ? `<p>Activé le ${date(item.activated_at)} · Échéance : ${date(item.expires_at)}</p>` : `<p>En attente de vérification</p><button type="button" class="btn primary" data-activate-subscription="${escape(item.id)}">Vérifier et activer ${period(item.period)}</button>`}</article>`).join('') || '<p>Aucune demande de paiement.</p>'}`;
    root.querySelector('[data-subscription-filter]').onchange = event => {
      let visible = 0;
      root.querySelectorAll('[data-subscription-status]').forEach(row => {
        row.hidden = event.target.value !== 'all' && row.dataset.subscriptionStatus !== event.target.value;
        if (!row.hidden) visible++;
      });
      root.querySelector('[data-subscription-empty]').hidden = visible > 0;
    };
    root.querySelectorAll('[data-access]').forEach(button => {
      button.onclick = async () => {
        const person = photographers.find(item => item.id === button.dataset.access);
        const action = button.dataset.action;
        if (!confirm(`${button.textContent} pour ${person.name} ?`)) return;
        button.disabled = true;
        try {
          await api('/api/admin/subscriptions/access/' + encodeURIComponent(person.id), { method: 'PUT', body: {
            suspended: action === 'suspend' ? true : action === 'restore' ? false : person.suspended,
            exempt: action === 'free' ? true : action === 'paid' ? false : person.exempt,
          } });
          toast('Accès mis à jour.');
          await bindSubscriptions(root, toast);
        } catch (error) { toast(error.message); }
        finally { button.disabled = false; }
      };
    });
    root.querySelectorAll('[data-activate-subscription]').forEach(button => {
      button.onclick = async () => {
        if (!confirm('Confirmez-vous avoir vérifié le montant et le TransCode dans votre compte ?')) return;
        button.disabled = true;
        try {
          await api('/api/admin/subscriptions/' + encodeURIComponent(button.dataset.activateSubscription) + '/activate', { method: 'PUT', body: {} });
          toast('Abonnement activé.');
          await bindSubscriptions(root, toast);
        } catch (error) { toast(error.message); }
        finally { button.disabled = false; }
      };
    });
  } catch (error) { root.textContent = error.message; }
}
