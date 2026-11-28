(() => {
  const sections = document.querySelectorAll('.public-showcase, .public-testimonials, .public-photographer-payment');
  if (new URLSearchParams(location.search).has('id')) {
    sections.forEach(section => { section.hidden = true; });
    return;
  }
  const node = (tag, text, className) => {
    const item = document.createElement(tag);
    if (text) item.textContent = text;
    if (className) item.className = className;
    return item;
  };
  async function load(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Unavailable');
    return response.json();
  }
  load('/api/public/photographers').then(({ photographers }) => {
    const grid = document.getElementById('featured-photos');
    const status = document.getElementById('featured-status');
    const latestLink = document.getElementById('latest-portfolio');
    const photos = photographers.flatMap(person => (person.photos || []).map(photo => ({ ...photo, photographerId: person.id, photographerName: person.name })))
      .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
    const selected = [...new Map(photos.map(photo => [photo.src, photo])).values()]
      .filter(photo => typeof photo.src === 'string' && photo.src.startsWith('/portfolio-media/')).slice(0, 6);
    if (selected.length) {
      latestLink.href = '/photographes?id=' + encodeURIComponent(selected[0].photographerId) + '#portfolio';
      latestLink.hidden = false;
    }
    selected.forEach(photo => {
      const figure = node('figure');
      const anchor = node('a');
      anchor.href = '/photographes?id=' + encodeURIComponent(photo.photographerId) + '#portfolio';
      anchor.setAttribute('aria-label', 'Voir le portfolio de ' + photo.photographerName);
      const img = node('img');
      img.src = photo.src;
      img.alt = photo.category || 'Photo du portfolio KentraPix';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.width = 640;
      img.height = 800;
      img.addEventListener('error', () => {
        figure.remove();
        if (!grid.childElementCount) status.textContent = 'Les photos sont indisponibles pour le moment. Retrouvez nos portfolios depuis les profils des photographes.';
      }, { once: true });
      anchor.append(img);
      figure.append(anchor, node('figcaption', photo.category || 'Portfolio'));
      grid.append(figure);
    });
    status.textContent = selected.length ? '' : 'Les prochaines photos publiées apparaîtront ici. Découvrez aussi les portfolios depuis les profils des photographes.';
  }).catch(() => {
    document.getElementById('featured-status').textContent = 'Les photos sont indisponibles pour le moment. Retrouvez nos portfolios depuis les profils des photographes.';
  });
  load('/api/public/reviews').then(({ reviews }) => {
    const grid = document.getElementById('client-testimonials');
    const selected = reviews.filter(review => typeof review.comment === 'string' && review.comment.trim());
    selected.slice(0, 6).forEach(review => {
      const card = node('figure', '', 'public-review');
      const rating = Math.max(1, Math.min(5, Math.round(Number(review.rating) || 1)));
      const stars = node('span', '★'.repeat(rating), 'public-review-rating');
      stars.setAttribute('aria-label', `${rating} sur 5 étoiles`);
      const quote = node('blockquote', review.comment);
      const caption = node('figcaption');
      caption.append(node('strong', review.name || 'Client'));
      if (review.studio) caption.append(node('span', review.studio));
      card.append(stars, quote, caption);
      grid.append(card);
    });
    document.getElementById('testimonials-status').textContent = selected.length ? '' : 'Les témoignages de nos clients seront affichés ici après leur publication.';
  }).catch(() => {
    document.getElementById('testimonials-status').textContent = 'Les témoignages sont indisponibles pour le moment. Réessayez plus tard.';
  });
})();
