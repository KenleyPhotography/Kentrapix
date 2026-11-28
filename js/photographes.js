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
    if (person.logo) {
      const logo = element('img', '', 'photographer-logo');
      logo.src = person.logo;
      logo.alt = person.name;
      logo.width = 80;
      logo.height = 80;
      intro.append(logo);
    }
    intro.append(heading);
    if (person.fullName && person.fullName !== person.name) {
      intro.append(element('p', person.fullName, 'profile-full-name'));
    }
    if (person.location) intro.append(element('p', person.location, 'profile-location'));
    if (person.bio) {
      const about = element('section', '', 'photographer-about');
      about.append(element('h3', 'À propos'), element('p', person.bio, 'profile-bio'));
      intro.append(about);
    }
    const reserve = person.bookable ? element('button', 'Réserver une date', 'primary') : null;
    if (reserve) { reserve.type = 'button'; intro.append(reserve); }
    header.append(intro);
    if (person.photos.length) header.append(image(person.photos[0]));
    profile.append(header);

    const digits = (person.phone || '').replace(/\D/g, '');
    const whatsapp = digits.length >= 8 ? 'https://wa.me/' + (digits.length === 8 ? '509' + digits : digits) : '';
    if (whatsapp) {
      const mobileContact = link('WhatsApp', whatsapp, 'public-mobile-whatsapp');
      mobileContact.target = '_blank';
      mobileContact.rel = 'noopener noreferrer';
      mobileContact.setAttribute('aria-label', 'Contacter ' + person.name + ' sur WhatsApp');
      document.body.append(mobileContact);
    }
    const instagram = person.instagram ? 'https://www.instagram.com/' + encodeURIComponent(person.instagram) + '/' : '';
    const contacts = element('section', '', 'profile-contacts');
    const items = [
      ['WhatsApp', person.phone, whatsapp],
      ['Téléphone', person.phone, person.phone ? 'tel:' + person.phone.replace(/[^+0-9]/g, '') : ''],
      ['E-mail', person.email, person.email ? 'mailto:' + encodeURIComponent(person.email) : ''],
      ['Instagram', person.instagram ? '@' + person.instagram : '', instagram],
      ['Site web', person.website, /^https?:\/\//i.test(person.website || '') ? person.website : ''],
      ['Facebook', 'Facebook', /^https?:\/\//i.test(person.facebook || '') ? person.facebook : ''],
      ...(person.otherLinks || []).filter(item => item && typeof item.label === 'string' && /^https?:\/\//i.test(item.url || '')).slice(0, 3).map(item => [item.label, item.label, item.url]),
    ].filter(([, value, href]) => value && href);
    if (items.length) {
      contacts.append(element('h2', 'Contact'));
      const grid = element('div', '', 'contact-grid');
      for (const [label, value, href] of items) {
        const item = link('', href, 'contact-card');
        if (href.startsWith('https://')) { item.target = '_blank'; item.rel = 'noopener noreferrer'; }
        item.append(element('strong', label), element('span', value));
        grid.append(item);
      }
      contacts.append(grid);
      profile.append(contacts);
    }

    if (person.packages?.length) {
      const packages = element('section', '', 'profile-packages');
      packages.append(element('h2', 'Forfaits et tarifs'));
      const grid = element('div', '', 'cards');
      for (const item of person.packages) {
        const box = element('article', '', 'package-card');
        const price = new Intl.NumberFormat('fr-HT', { maximumFractionDigits: 0 }).format(item.price) + ' ' + item.currency;
        box.append(element('h3', item.name), element('strong', price, 'package-price'));
        if (item.description) box.append(element('p', item.description));
        const actions = element('div', '', 'actions');
        const useBooking = reserve ? message => reserve.dispatchEvent(new CustomEvent('quote-reserve', { detail: message })) : null;
        if (useBooking) {
          const choose = element('button', 'Réserver ce forfait', 'primary');
          choose.type = 'button';
          choose.onclick = () => useBooking('Forfait souhaité : ' + item.name + ' · tarif affiché : ' + price);
          actions.append(choose);
        }
        if (whatsapp || person.email || useBooking) {
          import('./quote-assistant.js').then(({ quoteButton }) => {
            const negotiate = quoteButton(person, useBooking, item.name + ' · ' + price);
            negotiate.textContent = 'Négocier ce forfait';
            actions.append(negotiate);
          }).catch(() => {});
        }
        box.append(actions);
        grid.append(box);
      }
      packages.append(grid);
      profile.append(packages);
    }

    const portfolio = element('section', '', 'profile-portfolio');
    portfolio.id = 'portfolio';
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
    const personalFooter = element('footer', '', 'photographer-footer');
    if (person.logo) {
      const logo = element('img', '', 'photographer-footer-logo');
      logo.src = person.logo;
      logo.alt = person.name;
      logo.width = 56;
      logo.height = 56;
      logo.loading = 'lazy';
      personalFooter.append(logo);
    }
    personalFooter.append(element('strong', person.name));
    if (person.location) personalFooter.append(element('span', person.location));
    if (items.length) {
      const nav = element('nav');
      nav.setAttribute('aria-label', 'Coordonnées du photographe');
      for (const [label, , href] of items) {
        const contact = link(label, href);
        if (href.startsWith('https://')) { contact.target = '_blank'; contact.rel = 'noopener noreferrer'; }
        nav.append(contact);
      }
      personalFooter.append(nav);
    }
    profile.append(personalFooter);
    list.before(profile);
    if (location.hash === '#portfolio') portfolio.scrollIntoView({ block: 'start' });
    if (person.phone || person.email || reserve) {
      import('./quote-assistant.js').then(({ quoteButton }) => {
        intro.append(quoteButton(person, reserve ? message => {
          reserve.dispatchEvent(new CustomEvent('quote-reserve', { detail: message }));
        } : null));
      }).catch(() => {});
    }
    if (reserve) {
      const dialog = element('dialog', '', 'booking-screen reservation-page');
      dialog.setAttribute('aria-labelledby', 'booking-screen-title');
      const bar = element('header', '', 'booking-screen-bar');
      const close = element('button', 'Fermer ×', 'outline');
      close.type = 'button';
      close.onclick = () => dialog.close();
      const title = element('strong', 'Réserver avec ' + person.name);
      title.id = 'booking-screen-title';
      const actions = element('div', '', 'actions');
      for (const [label, href] of [['WhatsApp', whatsapp], ['Instagram', instagram]]) {
        if (!href) continue;
        const contact = link(label, href, 'outline');
        contact.target = '_blank';
        contact.rel = 'noopener noreferrer';
        actions.append(contact);
      }
      actions.append(close);
      bar.append(title, actions);
      const section = element('section', '', 'booking-screen-content');
      section.append(element('p', 'Chargement du formulaire…'));
      dialog.append(bar, section);
      document.body.append(dialog);
      let loaded = false;
      let loading;
      reserve.onclick = () => {
        dialog.showModal();
        if (!loaded) {
          loaded = true;
          loading = mountReservation(section, person);
        }
      };
      reserve.addEventListener('quote-reserve', async event => {
        if (!dialog.open) reserve.click();
        await loading;
        const field = section.querySelector('textarea[name="message"]');
        if (field) field.value = [field.value.trim(), event.detail].filter(Boolean).join('\n\n').slice(0, field.maxLength);
      });
      if (location.hash === '#reserver') reserve.click();
    }
  }

  if (id) {
    document.querySelector('.site-footer').hidden = true;
    document.querySelector('.team-banner').hidden = true;
    document.querySelector('.directory > .public-eyebrow').hidden = true;
    document.querySelector('.directory > .public-section-lead').hidden = true;
    document.getElementById('application-dialog').remove();
    document.querySelector('.public-mobile-whatsapp').remove();
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
