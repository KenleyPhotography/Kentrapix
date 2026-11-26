(() => {
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.getElementById('site-nav');
  if (toggle && nav) {
    document.querySelector('.top').classList.add('nav-ready');
    const closeNav = () => toggle.setAttribute('aria-expanded', 'false');
    toggle.onclick = () => toggle.setAttribute('aria-expanded', String(toggle.getAttribute('aria-expanded') !== 'true'));
    nav.addEventListener('click', closeNav);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
        closeNav();
        toggle.focus();
      }
    });
  }
  const applicationDialog = document.getElementById('application-dialog');
  const applicationContent = document.getElementById('application-content');
  let applicationReady = false;
  let applicationLoading = false;
  document.querySelectorAll('[data-open-application]').forEach(trigger => {
    trigger.addEventListener('click', async event => {
      event.preventDefault();
      applicationDialog.showModal();
      if (applicationReady || applicationLoading) return;
      applicationLoading = true;
      applicationContent.textContent = 'Chargement du formulaire…';
      try {
        const [response, module] = await Promise.all([fetch('/reservation'), import('./reservation.js')]);
        if (!response.ok) throw new Error();
        const source = new DOMParser().parseFromString(await response.text(), 'text/html');
        const form = source.querySelector('#photographer-application');
        if (!form) throw new Error();
        applicationContent.replaceChildren(form);
        module.initPhotographerApplication(form);
        applicationReady = true;
      } catch {
        applicationContent.textContent = 'Impossible de charger le formulaire. Fermez cette fenêtre puis réessayez.';
      } finally { applicationLoading = false; }
    });
  });
  const id = new URLSearchParams(location.search).get('id');
  const list = document.getElementById('profiles');
  const status = document.getElementById('status');
  const search = document.getElementById('search');
  const specialty = document.getElementById('specialty-filter');
  const slotLabel = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });

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
    return link('Réserver une date', '/photographes?id=' + encodeURIComponent(person.id) + '#reserver', 'primary');
  }

  async function mountReservation(section, person) {
    try {
      const [response, { initReservation }] = await Promise.all([fetch('/reservation'), import('./reservation.js')]);
      if (!response.ok) throw new Error();
      const source = new DOMParser().parseFromString(await response.text(), 'text/html');
      const form = source.querySelector('#form');
      form.querySelector('h2')?.remove();
      section.lastElementChild.replaceWith(form, source.querySelector('#payment-details'));
      initReservation(section, person);
    } catch {
      section.lastElementChild.textContent = 'Impossible de charger le formulaire. Rechargez la page pour réessayer.';
    }
  }

  function card(person) {
    const article = element('article', '', 'card');
    const shape = Array.from(person.id).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 3;
    const cover = element('div', '', 'card-visual shape-' + shape);
    cover.append(person.photos[0] ? image(person.photos[0]) : element('div', person.name[0] || '', 'cover'));
    const details = element('div', '', 'details');
    details.append(element('h3', person.name));
    if (person.location) details.append(element('p', person.location));
    if (person.specialties?.length) {
      const tags = element('ul', '', 'specialty-tags');
      for (const name of person.specialties.slice(0, 3)) tags.append(element('li', name));
      details.append(tags);
    }
    if (person.bookable && person.nextSlot) {
      const day = slotLabel.format(new Date(person.nextSlot.day + 'T12:00:00Z'));
      details.append(element('p', 'Prochain créneau : ' + day + ' à ' + person.nextSlot.time, 'next-slot'));
    }
    const actions = element('div', '', 'actions');
    actions.append(link('Voir le profil', '/photographes?id=' + encodeURIComponent(person.id), 'outline'));
    if (person.bookable) actions.append(bookingLink(person));
    details.append(actions);
    article.append(cover, details);
    return article;
  }

  function showProfile(person) {
    const heading = document.getElementById('directory-title');
    heading.textContent = person.name;
    document.title = person.name + ' — Kentra Pix';
    const profile = element('article', '', 'profile-page');
    const header = element('div', '', 'profile-header');
    const intro = element('div', '', 'profile-intro');
    intro.append(heading);
    if (person.fullName && person.fullName !== person.name) {
      intro.append(element('p', person.fullName, 'profile-full-name'));
    }
    if (person.location) intro.append(element('p', person.location, 'profile-location'));
    if (person.bio) intro.append(element('p', person.bio, 'profile-bio'));
    const reserve = person.bookable ? element('button', 'Réserver une date', 'primary') : null;
    if (reserve) { reserve.type = 'button'; intro.append(reserve); }
    header.append(intro);
    if (person.photos.length) header.append(image(person.photos[0]));
    profile.append(header);

    const contacts = element('section', '', 'profile-contacts');
    const items = [
      ['Téléphone', person.phone, person.phone ? 'tel:' + person.phone.replace(/[^+0-9]/g, '') : ''],
      ['E-mail', person.email, person.email ? 'mailto:' + encodeURIComponent(person.email) : ''],
      ['Instagram', person.instagram ? '@' + person.instagram : '', 'https://www.instagram.com/' + encodeURIComponent(person.instagram || '') + '/'],
      ['Site web', person.website, /^https?:\/\//i.test(person.website || '') ? person.website : ''],
    ].filter(([, value, href]) => value && href);
    if (items.length) {
      contacts.append(element('h2', 'Contact'));
      const grid = element('div', '', 'contact-grid');
      for (const [label, value, href] of items) {
        const item = link('', href, 'contact-card');
        item.append(element('strong', label), element('span', value));
        grid.append(item);
      }
      contacts.append(grid);
      profile.append(contacts);
    }

    const portfolio = element('section', '', 'profile-portfolio');
    portfolio.append(element('h2', 'Portfolio'));
    if (/^https?:\/\//i.test(person.portfolioUrl || '')) {
      const external = link('Voir le portfolio externe', person.portfolioUrl, 'outline');
      external.target = '_blank';
      external.rel = 'noopener noreferrer';
      portfolio.append(external);
    }
    if (!person.photos.length) portfolio.append(element('p', 'Aucune photo disponible pour le moment.'));
    const works = element('div', '', 'works');
    for (const photo of person.photos) {
      const figure = element('figure', '');
      const open = link('', photo.src);
      open.target = '_blank';
      open.rel = 'noopener';
      open.setAttribute('aria-label', 'Agrandir la photo · ' + photo.category);
      open.append(image(photo));
      figure.append(open, element('figcaption', photo.category));
      works.append(figure);
    }
    portfolio.append(works);
    profile.append(portfolio);
    list.before(profile);
    if (reserve) {
      const dialog = element('dialog', '', 'booking-screen reservation-page');
      dialog.setAttribute('aria-labelledby', 'booking-screen-title');
      const bar = element('header', '', 'booking-screen-bar');
      const close = element('button', 'Fermer ×', 'outline');
      close.type = 'button';
      close.onclick = () => dialog.close();
      const title = element('strong', 'Réserver avec ' + person.name);
      title.id = 'booking-screen-title';
      bar.append(title, close);
      const section = element('section', '', 'booking-screen-content');
      section.append(element('p', 'Chargement du formulaire…'));
      dialog.append(bar, section);
      document.body.append(dialog);
      let loaded = false;
      reserve.onclick = () => {
        dialog.showModal();
        if (!loaded) {
          loaded = true;
          mountReservation(section, person);
        }
      };
      if (location.hash === '#reserver') reserve.click();
    }
  }

  if (id) {
    document.getElementById('intro').hidden = true;
    document.getElementById('directory-filters').hidden = true;
    document.getElementById('how-it-works').hidden = true;
    list.before(link('Tous les photographes', '/photographes', 'outline'));
  }

  function renderPartners(people) {
    const logos = document.getElementById('partner-logos');
    const withLogo = people.filter(person => person.logo);
    logos.replaceChildren(...withLogo.map(person => {
      const item = link('', '/photographes?id=' + encodeURIComponent(person.id), 'partner-logo');
      item.setAttribute('aria-label', person.name);
      const img = document.createElement('img');
      img.src = person.logo;
      img.alt = '';
      img.loading = 'lazy';
      img.onerror = () => item.remove();
      item.append(img);
      return item;
    }));
    document.getElementById('partner-status').textContent = withLogo.length ? '' : 'Aucun logo publié pour le moment.';
  }

  fetch('/api/public/photographers' + (id ? '?id=' + encodeURIComponent(id) : ''))
    .then(async (response) => {
      if (!response.ok) throw new Error(response.status === 404 ? 'Profil introuvable.' : 'Impossible de charger les photographes.');
      return response.json();
    })
    .then(({ photographers }) => {
      status.textContent = '';
      if (id) {
        document.getElementById('partenaires').hidden = true;
        return showProfile(photographers[0]);
      }
      renderPartners(photographers);
      const services = [...new Set(photographers.flatMap(person => person.specialties || []))].sort((a, b) => a.localeCompare(b, 'fr'));
      for (const service of services) specialty.add(new Option(service, service));
      const draw = () => {
        const term = search.value.trim().toLocaleLowerCase('fr');
        const matches = photographers.filter(person => (person.name + ' ' + person.location).toLocaleLowerCase('fr').includes(term) && (!specialty.value || person.specialties?.includes(specialty.value)));
        list.replaceChildren(...matches.map(card));
        status.textContent = matches.length ? '' : 'Aucun photographe à afficher.';
      };
      search.addEventListener('input', draw);
      specialty.addEventListener('change', draw);
      draw();
    })
    .catch(error => { status.textContent = error.message; document.getElementById('partner-status').textContent = 'Partenaires indisponibles.'; });
})();
