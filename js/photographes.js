(() => {
  const id = new URLSearchParams(location.search).get('id');
  const list = document.getElementById('profiles');
  const status = document.getElementById('status');
  const search = document.getElementById('search');

  function element(tag, text, className) {
    const item = document.createElement(tag);
    item.textContent = text;
    if (className) item.className = className;
    return item;
  }

  function link(text, href, className) {
    const item = element('a', text, className);
    item.href = href;
    return item;
  }

  function image(photo) {
    const img = element('img', '');
    img.src = photo.src;
    img.alt = photo.category;
    img.loading = 'lazy';
    return img;
  }

  function bookingLink(person) {
    return link('Réserver une séance', '/reservation?photographe=' + encodeURIComponent(person.id), 'primary');
  }

  function card(person) {
    const article = element('article', '', 'card');
    const cover = person.photos[0] ? image(person.photos[0]) : element('div', person.name[0] || '', 'cover');
    const details = element('div', '', 'details');
    details.append(element('h3', person.name));
    if (person.location) details.append(element('p', person.location));
    const actions = element('div', '', 'actions');
    actions.append(link('Voir le profil', '/photographes?id=' + encodeURIComponent(person.id), 'outline'));
    if (person.bookable) actions.append(bookingLink(person));
    details.append(actions);
    article.append(cover, details);
    return article;
  }

  function showProfile(person) {
    document.getElementById('directory-title').textContent = person.name;
    document.title = person.name + ' — Kentra Pix';
    const details = element('article', '');
    if (person.location) details.append(element('p', person.location));
    if (person.bio) details.append(element('p', person.bio, 'details'));
    if (person.bookable) details.append(bookingLink(person));
    const works = element('div', '', 'works');
    for (const photo of person.photos) {
      const figure = element('figure', '');
      figure.append(image(photo), element('figcaption', photo.category));
      works.append(figure);
    }
    details.append(works);
    list.before(details);
  }

  if (id) {
    document.getElementById('intro').hidden = true;
    document.getElementById('search-label').hidden = true;
    list.before(link('Tous les photographes', '/photographes', 'outline'));
  }

  fetch('/api/public/photographers' + (id ? '?id=' + encodeURIComponent(id) : ''))
    .then(async (response) => {
      if (!response.ok) throw new Error(response.status === 404 ? 'Profil introuvable.' : 'Impossible de charger les photographes.');
      return response.json();
    })
    .then(({ photographers }) => {
      status.textContent = '';
      if (id) return showProfile(photographers[0]);
      const draw = () => {
        const term = search.value.trim().toLocaleLowerCase('fr');
        const matches = photographers.filter(person => (person.name + ' ' + person.location).toLocaleLowerCase('fr').includes(term));
        list.replaceChildren(...matches.map(card));
        status.textContent = matches.length ? '' : 'Aucun photographe à afficher.';
      };
      search.addEventListener('input', draw);
      draw();
    })
    .catch(error => { status.textContent = error.message; });
})();
