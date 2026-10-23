// Fermer le site (page « Réglages », propriétaire principal) : le site passe en maintenance,
// visiteurs et clients voient /maintenance avec le temps restant. L'équipe garde l'accès au studio.
// La durée saisie donne l'heure de réouverture : passé cette heure, le site se rouvre tout seul.
import { service, api, escape } from './service.js';
import { icon } from './icons.js';

const PRESETS = [
  ['15', '15 minutes'], ['30', '30 minutes'], ['60', '1 heure'], ['120', '2 heures'],
  ['240', '4 heures'], ['480', '8 heures'], ['1440', '1 journée'],
];
const UNITS = [['60', 'heures'], ['1', 'minutes'], ['1440', 'jours']];
const MAX_MINUTES = 30 * 24 * 60; // 30 jours, comme le serveur

const DEFAULT_TITLE = 'Site en cours de maintenance';
const DEFAULT_MESSAGE = 'KentraPix est momentanément fermé le temps d’une mise à jour. '
  + 'Vos photos et vos galeries sont en sécurité : tout revient dès la fin des travaux.';

const state = () => service.data.maintenance || { enabled: false };
const hour = (d) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const today = (d) => d.toDateString() === new Date().toDateString();
/** « aujourd'hui à 18:30 » ou « lundi 3 mars à 09:00 ». */
const when = (iso) => {
  const d = new Date(iso);
  return today(d) ? `aujourd’hui à ${hour(d)}` : `${d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} à ${hour(d)}`;
};
/** Durée en minutes -> [nombre, unité] pour les champs « autre durée » (90 min -> 90 minutes, 180 -> 3 heures). */
const split = (min) => {
  if (min && min % 1440 === 0) return [min / 1440, '1440'];
  if (min && min % 60 === 0) return [min / 60, '60'];
  return [Math.max(1, min || 120), '1'];
};

/** « 2 h 30 », « 45 min », « 3 jours ». */
const human = (min) => {
  if (!min) return 'jusqu’à nouvel ordre';
  if (min < 60) return `${min} min`;
  if (min % 1440 === 0) return `${min / 1440} jour${min > 1440 ? 's' : ''}`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${h} h ${String(min % 60).padStart(2, '0')}` : `${h} h`;
};

/** Bandeau de la page d'accueil du studio : l'équipe voit tout de suite que le site est fermé. */
export function maintenanceCallout() {
  const m = state();
  if (!m.enabled) return '';
  const end = m.endsAt ? `Réouverture automatique ${when(m.endsAt)}.` : 'Il restera fermé jusqu’à ce que vous le rouvriez.';
  return `<div class="callout is-maint">${icon('power')}<span><strong>Le site est fermé pour maintenance.</strong> Vos visiteurs et vos clients voient la page « en cours de maintenance ». ${end}</span>${service.data.platformOwner ? '<button class="text-link" data-nav="Settings">Gérer</button>' : ''}</div>`;
}

/** Section « Fermer le site » de la page Réglages (propriétaire principal uniquement). */
export function maintenanceSection() {
  if (!service.data.platformOwner) return '';
  const m = state();
  const on = !!m.enabled;
  const since = m.startedAt ? ` Fermé depuis ${when(m.startedAt)}.` : '';
  return `<section class="settings maint${on ? ' is-on' : ''}">
    <header><h2>${icon('power')} Fermer le site</h2></header>
    <div class="maint-state"><span class="maint-dot"></span><div><strong>${on ? 'Site fermé pour maintenance' : 'Site ouvert au public'}</strong>
      ${on ? `<p class="small">${m.endsAt ? `Réouverture automatique ${when(m.endsAt)}.` : 'Aucune durée : il reste fermé jusqu’à ce que vous le rouvriez.'}${since}</p>` : ''}</div></div>
    <div class="row maint-actions">
      ${on
    ? `<button class="btn primary" id="maint-off">${icon('power')} Rouvrir le site</button><button class="btn" id="maint-edit">${icon('clock')} Changer la durée ou le message</button>`
    : `<button class="btn danger-fill" id="maint-on">${icon('power')} Fermer le site</button>`}
      <a class="btn" href="/maintenance" target="_blank" rel="noopener">${icon('eye')} Voir la page</a>
    </div>
  </section>`;
}

/** Formulaire de fermeture : durée, titre et message, avec l'heure de réouverture calculée en direct. */
function form(m) {
  const minutes = m.enabled && m.endsAt ? Math.max(1, Math.round((Date.parse(m.endsAt) - Date.now()) / 60000)) : 60;
  const preset = PRESETS.some(([v]) => Number(v) === minutes) ? String(minutes) : (m.enabled && !m.endsAt ? '0' : 'custom');
  const [amount, unit] = split(preset === 'custom' ? minutes : 120);
  return `<label>Combien de temps le site reste-t-il fermé ?
    <select name="preset" id="maint-preset">
      ${PRESETS.map(([v, l]) => `<option value="${v}" ${preset === v ? 'selected' : ''}>${l}</option>`).join('')}
      <option value="custom" ${preset === 'custom' ? 'selected' : ''}>Autre durée…</option>
      <option value="0" ${preset === '0' ? 'selected' : ''}>Jusqu’à ce que je rouvre moi-même</option>
    </select></label>
  <div class="maint-custom" id="maint-custom" ${preset === 'custom' ? '' : 'hidden'}>
    <label>Durée<input name="amount" type="number" min="1" max="999" step="1" value="${amount}"></label>
    <label>Unité<select name="unit">${UNITS.map(([v, l]) => `<option value="${v}" ${unit === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
  </div>
  <p class="small maint-when" id="maint-when" role="status"></p>
  <label>Titre affiché<input name="title" maxlength="120" value="${escape(m.title || DEFAULT_TITLE)}"></label>
  <label>Message affiché<textarea name="message" rows="3" maxlength="600">${escape(m.message || DEFAULT_MESSAGE)}</textarea></label>
  <p class="small">Vos clients déjà connectés basculent aussi sur cette page. Le studio, lui, reste ouvert pour vous.</p>`;
}

/** Minutes choisies dans le formulaire (0 = jusqu'à nouvel ordre). */
const chosen = (values) => {
  if (values.preset !== 'custom') return Number(values.preset) || 0;
  return Math.min(MAX_MINUTES, Math.max(1, (Number(values.amount) || 1) * (Number(values.unit) || 60)));
};

/** Aperçu « Réouverture prévue … » mis à jour à chaque changement, et bloc « autre durée » affiché au besoin. */
function liveForm() {
  const host = document.getElementById('overlays');
  const f = host.querySelector('form');
  if (!f) return;
  const custom = document.getElementById('maint-custom');
  const out = document.getElementById('maint-when');
  const show = () => {
    custom.hidden = f.elements.preset.value !== 'custom';
    const min = chosen(Object.fromEntries(new FormData(f)));
    out.textContent = min
      ? `Fermé ${human(min)} : réouverture automatique ${when(new Date(Date.now() + min * 60000).toISOString())}.`
      : 'Le site restera fermé jusqu’à ce que vous le rouvriez vous-même.';
  };
  f.addEventListener('change', show);
  f.addEventListener('input', show);
  show();
}

export function bindMaintenance({ toast, modal, render }) {
  const save = async (body) => {
    service.data.maintenance = (await api('/api/admin/maintenance', { method: 'PUT', body })).maintenance;
    render();
  };
  const edit = (m, { submit, done }) => {
    modal(m.enabled ? 'Maintenance du site' : 'Fermer le site', form(m), async (values) => {
      const minutes = chosen(values);
      await save({ enabled: true, minutes, title: values.title.trim(), message: values.message.trim() });
      toast(done(minutes));
    }, { submit, danger: !m.enabled });
    liveForm();
  };

  document.getElementById('maint-on')?.addEventListener('click', () => edit(state(), {
    submit: 'Fermer le site',
    done: (min) => (min ? `Site fermé. Réouverture automatique ${when(new Date(Date.now() + min * 60000).toISOString())}.` : 'Site fermé jusqu’à ce que vous le rouvriez.'),
  }));
  document.getElementById('maint-edit')?.addEventListener('click', () => edit(state(), {
    submit: 'Enregistrer',
    done: (min) => (min ? `Durée mise à jour : réouverture ${when(new Date(Date.now() + min * 60000).toISOString())}.` : 'Le site reste fermé jusqu’à ce que vous le rouvriez.'),
  }));
  document.getElementById('maint-off')?.addEventListener('click', async () => {
    try {
      await save({ enabled: false });
      toast('Site rouvert. Vos clients retrouvent leurs photos.');
    } catch (e) { toast(e.message); }
  });
}
