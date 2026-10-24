// Studio : ajouter ou retirer des photos du portfolio public. Les fichiers ne vont ni sur R2 ni sur Supabase (GitHub, côté serveur).
import { api, escape } from './service.js';
import { ACCEPT_PHOTO, isRaw, rawImage } from './raw.js';
import { icon } from './icons.js';

// Réduit la photo dans le navigateur avant l'envoi : 2048 px max, JPEG qualité 92 (visuellement identique, 10 à 20 fois plus léger).
// Si le navigateur ne sait pas la lire (HEIC…), la photo originale part telle quelle.
async function shrink(file) {
  // RAW (NEF, CR2, ARW…) : on repart du JPEG pleine taille enregistré dans le fichier, puis on le réduit comme les autres.
  if (isRaw(file)) {
    try { const raw = await rawImage(file); raw.bmp.close?.(); return shrink(raw.file); } catch { return file; }
  }
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, 2048 / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(bmp, 0, 0, w, h); bmp.close?.();
    const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.92));
    return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch { return file; }
}

export const adminPortfolioPage = () => '<div class="greeting"><h1>Portfolio</h1></div><div id="pfa-root"><div class="empty small"><p>Chargement…</p></div></div>';

export async function bindAdminPortfolio({ toast }) {
  const root = document.getElementById('pfa-root');
  if (!root) return;
  let d;
  const load = async () => { d = await api('/api/admin/portfolio'); draw(); };
  const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message); } };

  const draw = () => {
    if (!d.tableReady) { root.innerHTML = '<section class="settings bill-block"><h2>Portfolio</h2><p class="small">Cette section n’est pas disponible pour le moment. Réessayez plus tard.</p></section>'; return; }
    const by = {};
    for (const p of d.photos) (by[p.category] ??= []).push(p);
    root.innerHTML = `<section class="settings bill-block"><h2>${icon('upload')} Ajouter des photos</h2>
      ${d.ready ? '' : '<p class="small" style="color:#c2410c">L’ajout de photos n’est pas disponible pour le moment.</p>'}
      <form id="pfa-form" class="bk-form">
        <label>Catégorie<select name="category">${d.categories.map((c) => `<option>${escape(c)}</option>`).join('')}</select></label>
        <label>Photos <span class="optional">(jusqu’à 12 à la fois)</span><input type="file" name="photos" accept="${ACCEPT_PHOTO}" multiple required></label>
        <button class="btn primary" ${d.ready ? '' : 'disabled'}>${icon('upload')} Ajouter au portfolio</button>
      </form></section>
      <section class="settings bill-block"><h2>Photos ajoutées ${d.photos.length ? `<span class="count-pill">${d.photos.length}</span>` : ''}</h2>
      ${d.photos.length ? Object.keys(by).map((c) => `<h3 class="small" style="margin:14px 0 8px">${escape(c)}</h3><div class="pfa-grid">${by[c].map((p) => `<figure class="pfa-item"><img src="${escape(p.src)}" alt="" loading="lazy"><button type="button" class="btn sm" data-pfa-del="${p.id}" aria-label="Retirer cette photo">${icon('trash')}</button></figure>`).join('')}</div>`).join('') : '<p class="small">Aucune photo ajoutée pour l’instant.</p>'}
      </section>`;
    root.querySelector('#pfa-form').addEventListener('submit', guard(async (e) => {
      e.preventDefault();
      const f = e.currentTarget, btn = f.querySelector('button'), files = f.photos.files;
      if (files.length > 12) { toast('12 photos au maximum à la fois.'); return; }
      const form = new FormData(); form.append('category', f.category.value);
      btn.disabled = true; btn.textContent = 'Préparation…';
      for (const file of files) form.append('photos', await shrink(file));
      btn.textContent = 'Envoi…';
      try { await api('/api/admin/portfolio', { method: 'POST', form }); toast('Photos ajoutées au portfolio.'); await load(); }
      finally { btn.disabled = false; }
    }));
    root.querySelectorAll('[data-pfa-del]').forEach((b) => { b.onclick = guard(async () => {
      if (!confirm('Retirer cette photo du portfolio ?')) return;
      await api(`/api/admin/portfolio/${b.dataset.pfaDel}`, { method: 'DELETE' }); await load();
    }); });
  };

  try { await load(); } catch (e) { root.innerHTML = `<div class="empty"><h2>${escape(e.message)}</h2></div>`; }
}
