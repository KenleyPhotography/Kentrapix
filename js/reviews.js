// Avis après livraison : le client note sa galerie (1 à 5 étoiles + commentaire) ; le photographe choisit
// quels avis s'affichent sur la page de connexion.
import { api, escape } from './service.js';
import { icon } from './icons.js';

const fdate = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
export const stars = (n) => `<span class="stars" role="img" aria-label="${n} sur 5">${'★'.repeat(n)}<span class="off">${'★'.repeat(5 - n)}</span></span>`;

// ====================================================================================================
//  Espace client
// ====================================================================================================
export const clientReviewsPage = () => '<div class="greeting"><h1>Mon avis</h1><p>Votre avis aide votre photographe à progresser.</p></div><div id="rvC-root"><div class="empty small"><p>Chargement…</p></div></div>';

export async function bindClientReviews({ toast }) {
  const root = document.getElementById('rvC-root');
  if (!root) return;
  let events;
  try { events = (await api('/api/client/reviews')).events; } catch (e) { root.innerHTML = `<div class="empty"><h2>${escape(e.message)}</h2></div>`; return; }
  if (!events.length) { root.innerHTML = '<div class="empty"><h2>Aucune galerie pour le moment</h2><p>Quand vos photos seront livrées, vous pourrez donner votre avis ici.</p></div>'; return; }
  const card = (e) => `<article class="inv-card review-card" data-ev="${e.id}">
    <header><span class="inv-ico">${icon('star')}</span><div><strong>${escape(e.name)}</strong><span>${escape(e.studio)}${e.date ? ` · ${escape(fdate(`${e.date}T12:00:00`))}` : ''}</span></div>${e.review ? '<span class="badge is-live">Envoyé</span>' : ''}</header>
    <form class="review-form">
      <div class="star-input" role="radiogroup" aria-label="Note">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="star ${e.review && n <= e.review.rating ? 'on' : ''}" data-star="${n}" role="radio" aria-label="${n} étoile${n > 1 ? 's' : ''}">★</button>`).join('')}</div>
      <textarea name="comment" rows="3" maxlength="800" placeholder="Racontez votre expérience (facultatif)">${escape(e.review?.comment || '')}</textarea>
      <button class="btn sm primary" type="submit">${e.review ? 'Modifier mon avis' : 'Envoyer mon avis'}</button>
    </form></article>`;
  root.innerHTML = `<div class="inv-grid">${events.map(card).join('')}</div>`;
  root.querySelectorAll('.review-card').forEach((c) => {
    const ev = events.find((x) => x.id === c.dataset.ev);
    let rating = ev.review?.rating || 0;
    const paint = () => c.querySelectorAll('.star').forEach((s) => s.classList.toggle('on', Number(s.dataset.star) <= rating));
    c.querySelectorAll('.star').forEach((s) => { s.onclick = () => { rating = Number(s.dataset.star); paint(); }; });
    c.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      if (!rating) return toast('Choisissez une note de 1 à 5 étoiles.');
      const btn = c.querySelector('[type=submit]'); btn.disabled = true;
      try {
        await api('/api/client/reviews', { method: 'PUT', body: { eventId: ev.id, rating, comment: c.querySelector('textarea').value } });
        toast('Merci pour votre avis !'); btn.textContent = 'Modifier mon avis';
        if (!c.querySelector('.badge')) c.querySelector('header').insertAdjacentHTML('beforeend', '<span class="badge is-live">Envoyé</span>');
      } catch (err) { toast(err.message); }
      btn.disabled = false;
    };
  });
}

// ====================================================================================================
//  Studio
// ====================================================================================================
export const adminReviewsPage = () => '<div class="greeting"><h1>Avis</h1><p>Choisissez les avis (4 étoiles et plus, avec commentaire) à afficher sur la page de connexion.</p></div><div id="rvA-root"><div class="empty small"><p>Chargement…</p></div></div>';

export async function bindAdminReviews({ toast }) {
  const root = document.getElementById('rvA-root');
  if (!root) return;
  let list;
  const load = async () => { list = (await api('/api/admin/reviews')).reviews; };
  try { await load(); } catch (e) { root.innerHTML = `<div class="empty"><h2>${escape(e.message)}</h2></div>`; return; }
  const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message); } };
  const draw = () => {
    if (!list.length) { root.innerHTML = '<div class="empty"><h2>Aucun avis pour le moment</h2><p>Vos clients peuvent noter leur galerie depuis leur espace (« Mon avis »).</p></div>'; return; }
    const avg = (list.reduce((s, r) => s + r.rating, 0) / list.length).toFixed(1);
    root.innerHTML = `<div class="stats"><div class="stat">${icon('star')}<p>Note moyenne</p><strong>${avg} / 5</strong><span class="small">${list.length} avis</span></div><div class="stat">${icon('eye')}<p>Affichés sur la connexion</p><strong>${list.filter((r) => r.public).length}</strong></div></div>
      <div class="inv-grid">${list.map((r) => `<article class="inv-card">
        <header><span class="inv-ico">${icon('star')}</span><div><strong>${escape(r.client)}</strong><span>${escape(r.event)} · ${escape(fdate(r.at))}</span></div>${r.public ? '<span class="badge is-live">Affiché</span>' : ''}</header>
        <p>${stars(r.rating)}</p>${r.comment ? `<p class="small">« ${escape(r.comment)} »</p>` : '<p class="small">Sans commentaire.</p>'}
        <div class="actions"><button type="button" class="btn sm ${r.public ? '' : 'primary'}" data-rv-pub="${r.id}" ${!r.comment || r.rating < 4 ? 'disabled title="Seuls les avis de 4 étoiles et plus avec commentaire peuvent être affichés."' : ''}>${r.public ? 'Retirer de la connexion' : 'Afficher sur la connexion'}</button>
        <button type="button" class="btn sm icon-btn danger" data-rv-del="${r.id}" aria-label="Supprimer" title="Supprimer">${icon('trash')}</button></div></article>`).join('')}</div>`;
    root.querySelectorAll('[data-rv-pub]').forEach((b) => { b.onclick = guard(async () => {
      const r = list.find((x) => x.id === b.dataset.rvPub);
      await api(`/api/admin/reviews/${r.id}`, { method: 'PATCH', body: { public: !r.public } }); r.public = !r.public; draw();
    }); });
    root.querySelectorAll('[data-rv-del]').forEach((b) => { b.onclick = guard(async () => {
      if (!confirm('Supprimer cet avis ?')) return;
      await api(`/api/admin/reviews/${b.dataset.rvDel}`, { method: 'DELETE' }); await load(); draw();
    }); });
  };
  draw();
}

// ====================================================================================================
//  Page de connexion : avis approuvés (ajoutés sous le formulaire)
// ====================================================================================================
export async function showLoginReviews(panel) {
  try {
    const { reviews } = await api('/api/public/reviews');
    if (!reviews.length || !panel.isConnected) return;
    panel.insertAdjacentHTML('beforeend', `<section class="login-reviews" aria-label="Avis des clients"><h2>Ils nous font confiance</h2>${reviews.slice(0, 3).map((r) => `<figure>${stars(r.rating)}<blockquote>« ${escape(r.comment)} »</blockquote><figcaption>${escape(r.name)} · ${escape(r.studio)}</figcaption></figure>`).join('')}</section>`);
  } catch { /* les avis sont facultatifs : la connexion ne dépend pas d'eux */ }
}
