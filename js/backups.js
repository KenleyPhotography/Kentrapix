// Sauvegardes (page « Stockage », propriétaire principal) : liste, sauvegarde immédiate, téléchargement, restauration.
import { api, escape } from './service.js';
import { icon } from './icons.js';

const mb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);
const when = (iso) => new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const REASON = { auto: 'Automatique', manuelle: 'Manuelle', 'avant-restauration': 'Avant restauration' };

function html(info) {
  const rows = info.backups.map((b) => `<li class="bk-row"><div><strong>${escape(when(b.createdAt))}</strong><span>${escape(REASON[b.reason] || b.reason)} · ${mb(b.size)}</span></div><div class="actions">
    <a class="btn sm icon-btn" href="/api/admin/backups/download?key=${encodeURIComponent(b.key)}" title="Télécharger" aria-label="Télécharger">${icon('download')}</a>
    <button type="button" class="btn sm" data-bk-restore="${escape(b.key)}">Restaurer</button>
    <button type="button" class="btn sm icon-btn danger" data-bk-del="${escape(b.key)}" title="Supprimer" aria-label="Supprimer">${icon('trash')}</button></div></li>`).join('');
  return `<h2>Sauvegardes</h2>
    <p class="small">Une sauvegarde de toute la base (clients, galeries, factures, sélections) est faite automatiquement chaque jour. Les ${info.keep} dernières sont gardées.</p>
    <div class="row"><button class="btn primary" id="bk-now">Sauvegarder maintenant</button>${info.mirror.enabled ? `<button class="btn" id="bk-mirror">${icon('copy')} Copier les photos</button>` : ''}</div>
    <p class="small" id="bk-msg" role="status">${info.mirror.enabled ? 'Copie des photos vers un 2e emplacement : activée.' : 'Copie des photos vers un 2e emplacement : désactivée.'}</p>
    ${rows ? `<ul class="rem-list bk-list">${rows}</ul>` : '<div class="empty small"><p>Aucune sauvegarde pour le moment.</p></div>'}`;
}

export async function bindBackups({ toast }) {
  const box = document.getElementById('backup-box');
  if (!box) return;
  let info;
  try { info = await api('/api/admin/backups'); } catch { return; } // pas le propriétaire principal : section cachée
  const draw = () => {
    box.hidden = false;
    box.innerHTML = html(info);
    const msg = box.querySelector('#bk-msg');
    const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message); } };
    box.querySelector('#bk-now').onclick = guard(async (e) => {
      const b = e.currentTarget; b.disabled = true; msg.textContent = 'Sauvegarde en cours…';
      try { const r = await api('/api/admin/backups', { method: 'POST' }); info = r; toast(`Sauvegarde faite : ${r.made.rows} lignes, ${mb(r.made.size)}.`); draw(); } finally { b.disabled = false; }
    });
    box.querySelector('#bk-mirror')?.addEventListener('click', guard(async (e) => {
      const b = e.currentTarget; b.disabled = true; msg.textContent = 'Copie des photos…';
      try { const r = await api('/api/admin/backups/mirror', { method: 'POST' }); info = r; toast(r.remaining ? `${r.copied} fichier(s) copiés, ${r.remaining} restant(s) : relancez.` : `${r.copied} fichier(s) copiés. Tout est à jour.`); draw(); } finally { b.disabled = false; }
    }));
    box.querySelectorAll('[data-bk-del]').forEach((b) => { b.onclick = guard(async () => {
      if (!confirm('Supprimer cette sauvegarde ?')) return;
      info = await api(`/api/admin/backups?key=${encodeURIComponent(b.dataset.bkDel)}`, { method: 'DELETE' }); draw();
    }); });
    box.querySelectorAll('[data-bk-restore]').forEach((b) => { b.onclick = guard(async () => {
      const key = b.dataset.bkRestore;
      const typed = prompt('ATTENTION : toute la base sera remplacée par cette sauvegarde (une sauvegarde de sécurité de l’état actuel est faite avant).\n\nTapez RESTAURER pour confirmer.');
      if (typed !== 'RESTAURER') return;
      msg.textContent = 'Restauration en cours… ne fermez pas la page.';
      const r = await api('/api/admin/backups/restore', { method: 'POST', body: { key, confirm: 'RESTAURER' } });
      info = r; toast('Base restaurée. La page va se recharger.'); setTimeout(() => location.reload(), 1500);
    }); });
  };
  draw();
}
