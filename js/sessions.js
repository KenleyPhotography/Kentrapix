// Profil : les appareils connectés au compte, et le moyen de les déconnecter.
import { api, escape } from './service.js';
import { icon } from './icons.js';

export const sessionsSection = () => '<section class="settings profile-panel" id="sessions-box"><header><h2>Appareils connectés</h2><p class="small">Chargement…</p></header></section>';

const ago = (iso) => {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 2) return 'Actif à l’instant';
  if (min < 60) return `Actif il y a ${min} min`;
  if (min < 60 * 24) return `Actif il y a ${Math.round(min / 60)} h`;
  return `Actif le ${new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`;
};
const kind = (d) => (/Android|iPhone|iPad|Application/i.test(d) ? 'phone' : 'desktop');

export async function bindSessions({ toast }) {
  const box = document.getElementById('sessions-box');
  if (!box) return;
  const load = async () => {
    let list;
    try { list = (await api('/api/auth/sessions')).sessions; } catch { box.remove(); return; }
    const others = list.filter((s) => !s.current).length;
    box.innerHTML = `<header><h2>Appareils connectés <span class="count-pill">${list.length}</span></h2><p class="small">Voici les appareils où votre compte est ouvert. Si vous ne reconnaissez pas l’un d’eux, déconnectez-le.</p></header>
      <ul class="rem-list">${list.map((s) => `<li class="rem-row ${s.current ? '' : ''}"><span class="rem-ico">${icon(kind(s.device) === 'phone' ? 'phone' : 'user')}</span><div><strong>${escape(s.device)}${s.current ? ' <span class="badge is-live">Cet appareil</span>' : ''}</strong><span>${escape(ago(s.lastSeenAt))}${s.ip ? ` · ${escape(s.ip)}` : ''}</span></div><div class="actions"><button type="button" class="btn sm ${s.current ? '' : 'danger'}" data-ses-out="${s.id}">${s.current ? 'Me déconnecter' : 'Déconnecter'}</button></div></li>`).join('')}</ul>
      ${others ? `<button type="button" class="btn" id="ses-all">${icon('close')} Déconnecter tous les autres appareils</button>` : '<p class="small">Aucun autre appareil connecté.</p>'}`;
    box.querySelectorAll('[data-ses-out]').forEach((b) => { b.onclick = async () => {
      const s = list.find((x) => x.id === b.dataset.sesOut);
      if (!confirm(s.current ? 'Vous déconnecter de cet appareil ?' : `Déconnecter « ${s.device} » ?`)) return;
      try { await api(`/api/auth/sessions/${s.id}`, { method: 'DELETE' }); if (s.current) { location.href = '/login'; return; } toast('Appareil déconnecté.'); await load(); } catch (e) { toast(e.message); }
    }; });
    box.querySelector('#ses-all')?.addEventListener('click', async () => {
      if (!confirm('Déconnecter tous les autres appareils ? Vous restez connecté ici.')) return;
      try { await api('/api/auth/sessions/revoke-others', { method: 'POST' }); toast('Les autres appareils sont déconnectés.'); await load(); } catch (e) { toast(e.message); }
    });
  };
  await load();
}
