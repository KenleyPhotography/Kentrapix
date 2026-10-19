// Dans la galerie du client : cinq étoiles toujours sous les yeux. Un toucher sur une étoile envoie l'avis tout de suite
// (le commentaire déjà écrit, lui, est conservé ; on peut le compléter dans « Mon avis »).
import { api, escape } from './service.js';

let cache = null;

export async function bindGalleryRate({ toast, navigate }) {
  const box = document.getElementById('gallery-rate');
  if (!box) return;
  const eventId = box.dataset.event;
  let events;
  try { events = cache || (cache = (await api('/api/client/reviews')).events); } catch { box.remove(); return; }
  const ev = events.find((e) => e.id === eventId);
  if (!ev) { box.remove(); return; }
  let rating = ev.review?.rating || 0;

  const draw = () => {
    box.innerHTML = `<div class="gr-text"><strong>${rating ? 'Merci pour votre avis !' : 'Que pensez-vous de ces photos ?'}</strong><span>${rating ? 'Touchez une autre étoile pour changer votre note.' : 'Touchez une étoile pour donner votre avis.'}</span></div>
      <div class="star-input" role="radiogroup" aria-label="Votre note">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="star ${n <= rating ? 'on' : ''}" data-star="${n}" role="radio" aria-checked="${n === rating}" aria-label="${n} étoile${n > 1 ? 's' : ''}">★</button>`).join('')}</div>
      ${rating ? `<button type="button" class="text-link" id="gr-more">${ev.review?.comment ? 'Modifier mon commentaire' : 'Ajouter un commentaire'}</button>` : ''}`;
    box.querySelectorAll('.star').forEach((s) => {
      s.onclick = async () => {
        const n = Number(s.dataset.star), before = rating;
        rating = n; draw();
        try {
          await api('/api/client/reviews', { method: 'PUT', body: { eventId, rating: n, comment: ev.review?.comment || '' } });
          ev.review = { ...(ev.review || {}), rating: n }; toast('Merci pour votre avis !');
        } catch (e) { rating = before; draw(); toast(e.message); }
      };
    });
    box.querySelector('#gr-more')?.addEventListener('click', () => navigate('Reviews'));
  };
  draw();
}
