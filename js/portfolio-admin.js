// Studio : ajouter ou retirer les photos du portfolio public.
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
    const remaining = Math.max(0, d.photoLimit - d.photos.length);
    const batchLimit = Math.min(12, remaining);
    const by = {};
    for (const p of d.photos) (by[p.category] ??= []).push(p);
    root.innerHTML = `<section class="settings bill-block">
      <h2>Mon profil public</h2>
      <form id="pfa-profile" class="bk-form">
        <p>Le propriétaire choisit les profils qui apparaissent dans l’équipe publique.</p>
        <label>Ville ou zone d’intervention<input name="location" maxlength="100" value="${escape(d.profile.location)}"></label>
        <label>Présentation<textarea name="bio" maxlength="700" rows="4">${escape(d.profile.bio)}</textarea></label>
        <fieldset><legend>Coordonnées publiques</legend>
          <label>Téléphone<input name="phone" type="tel" maxlength="40" value="${escape(d.profile.phone)}"></label>
          <label>E-mail<input name="email" type="email" maxlength="190" value="${escape(d.profile.email)}"></label>
          <label>Nom d’utilisateur Instagram<input name="instagram" maxlength="31" placeholder="@votrecompte" value="${escape(d.profile.instagram)}"></label>
          <label>Site web<input name="website" type="url" maxlength="250" placeholder="https://…" value="${escape(d.profile.website)}"></label>
          <label>Lien du portfolio<input name="portfolioUrl" type="url" maxlength="250" placeholder="https://…" value="${escape(d.profile.portfolioUrl)}"></label>
          <label>Facebook<input name="facebook" type="url" maxlength="250" placeholder="https://www.facebook.com/…" value="${escape(d.profile.facebook || '')}"></label>
          ${Array.from({ length: 3 }, (_, i) => {
            const item = d.profile.otherLinks?.[i] || {};
            return `<div class="row"><label>Nom du lien ${i + 1}<input name="linkLabel${i}" maxlength="40" placeholder="TikTok, YouTube…" value="${escape(item.label || '')}"></label><label>Adresse du lien ${i + 1}<input name="linkUrl${i}" type="url" maxlength="250" placeholder="https://…" value="${escape(item.url || '')}"></label></div>`;
          }).join('')}
        </fieldset>
        <button class="btn primary" type="submit">Enregistrer le profil</button>
      </form>
    </section><section class="settings bill-block"><h2>Forfaits et tarifs</h2>
      <form id="pfa-packages" class="bk-form">
        <div data-package-list></div>
        <div class="row"><button type="button" class="btn" data-package-add>Ajouter un forfait</button>
        <button class="btn primary" type="submit">Enregistrer les forfaits</button></div>
      </form>
    </section><section class="settings bill-block"><h2>${icon('upload')} Ajouter des photos</h2>
      ${d.ready ? '' : '<p class="small" style="color:#c2410c">L’ajout de photos n’est pas disponible pour le moment.</p>'}
      <p>${d.photos.length} / ${d.photoLimit} photos · ${remaining} place(s) disponible(s).</p>
      <form id="pfa-form" class="bk-form">
        <label>Catégorie<select name="category">${d.categories.map((c) => `<option>${escape(c)}</option>`).join('')}</select></label>
        <label>Photos <span class="optional">(jusqu’à ${batchLimit} à la fois)</span><input type="file" name="photos" accept="${ACCEPT_PHOTO}" multiple required></label>
        <button class="btn primary" ${d.ready && remaining ? '' : 'disabled'}>${icon('upload')} Ajouter au portfolio</button>
      </form></section>
      <section class="settings bill-block"><h2>Photos ajoutées ${d.photos.length ? `<span class="count-pill">${d.photos.length}</span>` : ''}</h2>
      ${d.photos.length ? Object.keys(by).map((c) => `<h3 class="small" style="margin:14px 0 8px">${escape(c)}</h3><div class="pfa-grid">${by[c].map((p) => `<figure class="pfa-item"><img src="${escape(p.src)}" alt="" loading="lazy"><button type="button" class="btn sm" data-pfa-del="${p.id}" aria-label="Retirer cette photo">${icon('trash')}</button></figure>`).join('')}</div>`).join('') : '<p class="small">Aucune photo ajoutée pour l’instant.</p>'}
      </section>`;
    const packageForm = root.querySelector('#pfa-packages');
    const packageList = packageForm.querySelector('[data-package-list]');
    const addButton = packageForm.querySelector('[data-package-add]');
    function addPackage(item = { name: '', price: '', currency: 'HTG', description: '' }) {
      const row = document.createElement('fieldset');
      row.className = 'bk-form';
      row.dataset.package = '';
      row.innerHTML = `<label>Nom du forfait<input name="name" required maxlength="80" value="${escape(String(item.name))}"></label>
        <div class="row2"><label>Prix<input name="price" type="number" min="0" max="10000000" step="1" required value="${escape(String(item.price))}"></label>
        <label>Devise<select name="currency"><option>HTG</option><option ${item.currency === 'USD' ? 'selected' : ''}>USD</option></select></label></div>
        <label>Ce que comprend le forfait<textarea name="description" maxlength="400" rows="2">${escape(item.description)}</textarea></label>
        <button type="button" class="btn">Retirer ce forfait</button>`;
      row.querySelector('button').onclick = () => { row.remove(); addButton.disabled = false; };
      packageList.append(row);
      addButton.disabled = packageList.children.length >= 12;
    }
    d.packages.forEach(addPackage);
    addButton.onclick = () => addPackage();
    packageForm.onsubmit = guard(async event => {
      event.preventDefault();
      const button = packageForm.querySelector('[type=submit]');
      const packages = Array.from(packageList.children, row => ({
        name: row.querySelector('[name=name]').value,
        price: row.querySelector('[name=price]').valueAsNumber,
        currency: row.querySelector('[name=currency]').value,
        description: row.querySelector('[name=description]').value,
      }));
      button.disabled = true;
      try {
        const result = await api('/api/admin/portfolio/packages', { method: 'PUT', body: { packages } });
        d.packages = result.packages;
        toast('Forfaits enregistrés.');
      } finally { button.disabled = false; }
    });
    root.querySelector('#pfa-profile').onsubmit = guard(async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const otherLinks = Array.from({ length: 3 }, (_, i) => ({ label: data.get(`linkLabel${i}`).trim(), url: data.get(`linkUrl${i}`).trim() })).filter(item => item.label || item.url);
      if (otherLinks.some(item => !item.label || !item.url)) throw new Error('Indiquez un nom et une adresse pour chaque lien supplémentaire.');
      const button = event.currentTarget.querySelector('button');
      button.disabled = true;
      try {
        const { profile } = await api('/api/admin/portfolio/profile', { method: 'PUT', body: {
          location: data.get('location'), bio: data.get('bio'), phone: data.get('phone'), email: data.get('email').trim(),
          instagram: data.get('instagram'), website: data.get('website'), portfolioUrl: data.get('portfolioUrl'),
          facebook: data.get('facebook'), otherLinks,
        } });
        d.profile = profile;
        toast('Profil enregistré.');
      } finally { button.disabled = false; }
    });
    root.querySelector('#pfa-form').addEventListener('submit', guard(async (e) => {
      e.preventDefault();
      const f = e.currentTarget, btn = f.querySelector('button'), files = f.photos.files;
      if (files.length > batchLimit) { toast(`Nombre de photos autorisé pour cet envoi : ${batchLimit}.`); return; }
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
