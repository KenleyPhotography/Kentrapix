import { bindSubscriptions } from './subscriptions-admin.js';
import { api, escape, service } from './service.js';

export function publicServicesSection() {
  return service.data.platformOwner ? '<section class="settings" id="public-services"><h2>Portfolio, équipe et réservations</h2><p role="status">Chargement…</p></section>' : '';
}

export async function bindPublicServices(toast) {
  const section = document.getElementById('public-services');
  if (!section) return;
  try {
    const { portfolioEnabled, staff, selected, teamSelected } = await api('/api/admin/public-services');
    section.innerHTML = `<h2>Portfolio, équipe et réservations</h2>
      <form>
        <label><input type="checkbox" name="portfolio" ${portfolioEnabled ? 'checked' : ''}> Afficher le portfolio public</label>
        <fieldset><legend>Photographes autorisés à recevoir des réservations</legend>
          ${staff.map(({ id, name }) => `<div><label><input type="checkbox" name="staff" value="${escape(id)}" ${selected.includes(id) ? 'checked' : ''}> ${escape(name)}</label></div>`).join('')}
        </fieldset>
        <fieldset><legend>Photographes visibles dans l’équipe publique</legend>
          ${staff.map(({ id, name }) => `<div><label><input type="checkbox" name="team" value="${escape(id)}" ${teamSelected.includes(id) ? 'checked' : ''}> ${escape(name)}</label></div>`).join('')}
        </fieldset>
        <button class="btn primary" type="submit">Enregistrer</button>
      </form>
      <h3>Limites des portfolios</h3>
      ${staff.map(({ id, name, portfolioPhotoLimit }) => `<form class="bk-form" data-quota="${escape(id)}">
        <label>${escape(name)}<input name="limit" type="number" min="10" max="2147483647" step="1" required value="${portfolioPhotoLimit}"></label>
        <button class="btn" type="submit">Enregistrer la limite</button>
      </form>`).join('')}`;
    const operations = document.createElement('div');
    section.append(operations);
    bindBookingOperations(operations, toast);
    const subscriptions = document.createElement('section');
    section.append(subscriptions);
    bindSubscriptions(subscriptions, toast);
    section.querySelectorAll('[data-quota]').forEach(form => {
      form.onsubmit = async (event) => {
        event.preventDefault();
        const button = form.querySelector('button');
        button.disabled = true;
        try {
          await api('/api/admin/public-services/' + encodeURIComponent(form.dataset.quota) + '/portfolio-limit', {
            method: 'PUT', body: { limit: form.elements.limit.valueAsNumber },
          });
          toast('Limite enregistrée.');
        } catch (error) { toast(error.message); }
        finally { button.disabled = false; }
      };
    });
    section.querySelector('form').onsubmit = async (event) => {
      event.preventDefault();
      const data = new FormData(event.target);
      const button = event.target.querySelector('button');
      button.disabled = true;
      try {
        await api('/api/admin/public-services', { method: 'PUT', body: { portfolioEnabled: data.has('portfolio'), selected: data.getAll('staff'), teamSelected: data.getAll('team') } });
        toast('Réglages enregistrés.');
      } catch (error) { toast(error.message); }
      finally { button.disabled = false; }
    };
  } catch (error) { section.querySelector('p').textContent = error.message; }
}

export async function bindBookingOperations(root, toast, applicationsOnly = false, refresh) {
  if (!root) return;
  try {
    const { settings, applications, payments, team } = await api('/api/admin/booking-operations');
    root.innerHTML = `${applicationsOnly ? '' : `<h3>Paiements des réservations</h3>
      <form class="bk-form" data-payment-settings>
        <p>Ces numéros sont utilisés sur le formulaire public de paiement des abonnements. Laissez un champ vide pour masquer ce moyen de paiement.</p>
        <label>Numéro MonCash<input name="moncash" type="tel" value="${escape(settings.moncash || '')}"></label>
        <label>Numéro NatCash<input name="natcash" type="tel" value="${escape(settings.natcash || '')}"></label>
        <label>Acompte (HTG)<input name="amount" type="number" min="0" max="10000000" required value="${settings.amount || 0}"></label>
        <label>Frais de candidature (HTG, 0 = gratuit)<input name="applicationAmount" type="number" min="0" max="10000000" required value="${settings.applicationAmount || 0}"></label>
        <button class="btn primary">Enregistrer les paiements</button>
      </form>
      <h3>Transferts à vérifier</h3>
      ${payments.map(payment => `<p>${escape(payment.name)} · ${escape(payment.payment_code)} · ${payment.payment_amount} HTG
        ${payment.payment_verified_at ? '· Vérifié' : `<button type="button" class="btn" data-operation="payments/${payment.id}/verify">Marquer vérifié</button>`}</p>`).join('') || '<p>Aucun transfert à vérifier.</p>'}`}
      ${applicationsOnly ? `<h3>Candidatures photographes</h3>
      ${applications.map(person => `<article><p><strong>${escape(person.name)}</strong> · ${escape(person.email)} · ${escape(person.phone)}</p>
        <p>${escape(person.message)}</p>
        <div class="row">
          ${person.email ? `<a class="btn sm" href="mailto:${escape(encodeURIComponent(person.email))}?subject=Candidature%20KentraPix">Répondre par e-mail</a>` : ''}
          ${String(person.phone || '').replace(/\D/g, '').length >= 8 ? `<a class="btn sm" target="_blank" rel="noopener noreferrer" href="https://wa.me/${String(person.phone).replace(/\D/g, '').length === 8 ? '509' : ''}${String(person.phone).replace(/\D/g, '')}">WhatsApp</a>` : ''}
        </div>
        ${person.transfer_code ? `<p>${escape(person.payment_method)} · ${person.payment_amount} HTG · TransCode ${escape(person.transfer_code)}</p>` : ''}
        ${person.has_logo ? `<form class="bk-form" data-assign-logo="${escape(person.id)}">
          <img src="/api/admin/booking-operations/applications/${escape(person.id)}/logo" alt="Logo proposé" width="100" height="100" style="object-fit:contain">
          <label>Attribuer à<select name="staffId" required><option value="">Choisir un photographe</option>${team.map(member => `<option value="${escape(member.id)}">${escape(member.name)}</option>`).join('')}</select></label>
          <button class="btn">Attribuer le logo</button>
        </form>` : ''}
         ${person.approved_staff_id ? '<p>Photographe approuvé et ajouté à l’équipe.</p>' : `<label><input type="checkbox" data-approve="${escape(person.id)}"> Approuver et afficher dans l’équipe publique</label>`}
        ${person.reviewed_at ? '<p>Candidature examinée</p>'  : `<button type="button" class="btn" data-operation="applications/${person.id}/review">Marquer examinée</button>`}
      </article>`).join('') || '<p>Aucune candidature.</p>'}` : ''}`;
    const form = root.querySelector('[data-payment-settings]');
    if (form) form.onsubmit = async (event) => {
      event.preventDefault();
      const { moncash, natcash, amount, applicationAmount } = Object.fromEntries(new FormData(form));
      const button = form.querySelector('button');
      button.disabled = true;
      try {
        await api('/api/admin/booking-operations/payment', { method: 'PUT', body: { moncash, natcash, amount: Number(amount), applicationAmount: Number(applicationAmount) } });
        toast('Réglages de paiement enregistrés.');
      } catch (error) { toast(error.message); }
      finally { button.disabled = false; }
    };
    root.querySelectorAll('[data-approve]').forEach(toggle => {
      toggle.onchange = async () => {
        if (!toggle.checked) return;
        toggle.disabled = true;
        try {
          const { invitation } = await api('/api/admin/team/applications/' + encodeURIComponent(toggle.dataset.approve) + '/approve', { method: 'PUT', body: {} });
          toast(invitation && invitation.status !== 'sent'
            ? 'Photographe approuvé. L’invitation n’a pas été envoyée. Réinitialisez son mot de passe dans Équipe.'
            : 'Photographe approuvé et affiché.');
          if (refresh) await refresh();
          else await bindBookingOperations(root, toast, applicationsOnly, refresh);
        } catch (error) { toggle.checked = false; toast(error.message); }
        finally { toggle.disabled = false; }
      };
    });
    root.querySelectorAll('[data-assign-logo]').forEach(assignment => {
      assignment.onsubmit = async event => {
        event.preventDefault();
        const button = assignment.querySelector('button');
        button.disabled = true;
        try {
          await api('/api/admin/booking-operations/applications/' + encodeURIComponent(assignment.dataset.assignLogo) + '/logo', {
            method: 'PUT', body: { staffId: assignment.elements.staffId.value },
          });
          toast('Logo attribué.');
        } catch (error) { toast(error.message); }
        finally { button.disabled = false; }
      };
    });
    root.querySelectorAll('[data-operation]').forEach(button => {
      button.onclick = async () => {
        if (button.dataset.operation.startsWith('payments/') && !confirm('Avez-vous vérifié le transfert et le montant dans MonCash ou NatCash ?')) return;
        button.disabled = true;
        try {
          await api('/api/admin/booking-operations/' + button.dataset.operation, { method: 'PUT', body: {} });
          await bindBookingOperations(root, toast, applicationsOnly, refresh);
        } catch (error) { toast(error.message); }
        finally { button.disabled = false; }
      };
    });
  } catch (error) { root.textContent = error.message; }
}
