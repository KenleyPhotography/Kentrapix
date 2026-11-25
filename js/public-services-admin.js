import { api, escape, service } from './service.js';

export function publicServicesSection() {
  return service.data.platformOwner ? '<section class="settings" id="public-services"><h2>Portfolio et réservations</h2><p role="status">Chargement…</p></section>' : '';
}

export async function bindPublicServices(toast) {
  const section = document.getElementById('public-services');
  if (!section) return;
  try {
    const { portfolioEnabled, staff, selected } = await api('/api/admin/public-services');
    section.innerHTML = `<h2>Portfolio et réservations</h2>
      <form>
        <label><input type="checkbox" name="portfolio" ${portfolioEnabled ? 'checked' : ''}> Afficher le portfolio public</label>
        <fieldset><legend>Photographes autorisés à recevoir des réservations</legend>
          ${staff.map(({ id, name }) => `<div><label><input type="checkbox" name="staff" value="${escape(id)}" ${selected.includes(id) ? 'checked' : ''}> ${escape(name)}</label></div>`).join('')}
        </fieldset>
        <button class="btn primary" type="submit">Enregistrer</button>
      </form>`;
    section.querySelector('form').onsubmit = async (event) => {
      event.preventDefault();
      const data = new FormData(event.target);
      const button = event.target.querySelector('button');
      button.disabled = true;
      try {
        await api('/api/admin/public-services', { method: 'PUT', body: { portfolioEnabled: data.has('portfolio'), selected: data.getAll('staff') } });
        toast('Réglages enregistrés.');
      } catch (error) { toast(error.message); }
      finally { button.disabled = false; }
    };
  } catch (error) { section.querySelector('p').textContent = error.message; }
}
