// Propriétaire : combien de personnes visitent le site (portfolio et page de connexion). Comptage anonyme.
import { api, escape } from './service.js';

const LABELS = { '/': 'Page de connexion', '/studio': 'Portfolio', '/studio/outdoor': 'Portfolio · Outdoor', '/studio/graduation': 'Portfolio · Graduation', '/studio/evenement': 'Portfolio · Événement', '/studio/mariage': 'Portfolio · Mariage', '/studio/studio': 'Portfolio · Studio' };
const n = (v) => Number(v).toLocaleString('fr-FR');
const dayLabel = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export const visitsBlock = () => '<section class="settings bill-block" id="visits-root"><h2>Visites du site</h2><p class="small">Chargement…</p></section>';

export async function bindVisits() {
  const root = document.getElementById('visits-root');
  if (!root) return;
  let v;
  try { v = await api('/api/admin/visits'); } catch { root.remove(); return; } // réservé au propriétaire
  const max = Math.max(1, ...v.series.map((d) => d.visitors));
  root.innerHTML = `<h2>Visites du site</h2>
    <div class="vis-tiles">
      <div><strong>${n(v.today)}</strong><span>Aujourd’hui</span></div>
      <div><strong>${n(v.week)}</strong><span>7 derniers jours</span></div>
      <div><strong>${n(v.month)}</strong><span>30 derniers jours</span></div>
      <div><strong>${n(v.allVisits)}</strong><span>Depuis le début</span></div>
    </div>
    <div class="vis-bars" role="img" aria-label="Visiteurs par jour sur 30 jours">${v.series.map((d) => `<i style="height:${Math.max(3, Math.round((d.visitors / max) * 100))}%" title="${escape(dayLabel(d.day))} : ${d.visitors} visiteur${d.visitors > 1 ? 's' : ''}"></i>`).join('')}</div>
    <p class="small vis-axis"><span>${escape(dayLabel(v.series[0].day))}</span><span>Visiteurs par jour</span><span>${escape(dayLabel(v.series[29].day))}</span></p>
    ${v.pages.length ? `<h3 class="small" style="margin:16px 0 8px">Pages les plus vues (30 jours)</h3><ul class="rem-list">${v.pages.map((p) => `<li class="rem-row"><div><strong>${escape(LABELS[p.path] || p.path)}</strong><span>${n(p.visitors)} visiteur${p.visitors > 1 ? 's' : ''} · ${n(p.views)} vue${p.views > 1 ? 's' : ''}</span></div></li>`).join('')}</ul>` : '<p class="small">Aucune visite enregistrée pour l’instant.</p>'}
    <p class="small">Comptage anonyme : aucune adresse n’est gardée, et vos propres visites connectées ne comptent pas.</p>`;
}
