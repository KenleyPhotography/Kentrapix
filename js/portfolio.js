// Portfolio public : photos du portfolio kenleyelysee.com + demande de séance sans compte.
(function () {
  var BASE = 'https://kenleyelysee.com/';
  // Ajoutez ici d'autres photos : { cat, src (chemin sur kenleyelysee.com), alt }.
  var PHOTOS = [
    { cat: 'Studio', src: 'image/shoot-studio/DSC_1065 copie.jpg', alt: 'Séance de photographie en studio' },
    { cat: 'Outdoor', src: 'image/outdoor/optimized/outdoor-14.jpg', alt: 'Séance de photographie en extérieur' },
    { cat: 'Événement', src: 'image/event/optimized/event-25.jpg', alt: 'Photographie d’un événement' },
    { cat: 'Graduation', src: 'image/Gaduation/optimized/graduation-01.jpg', alt: 'Portrait de graduation' },
    { cat: 'Mariage', src: 'image/mariage/_SKE0276-Edit.jpg', alt: 'Photographie de mariage' }
  ];
  var $ = function (id) { return document.getElementById(id); };
  var url = function (p) { return BASE + encodeURI(p); };
  var current = 'Tout';

  $('year').textContent = new Date().getFullYear();

  function renderFilters() {
    var cats = ['Tout'].concat(PHOTOS.map(function (p) { return p.cat; }).filter(function (c, i, a) { return a.indexOf(c) === i; }));
    $('filters').innerHTML = '';
    cats.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = c; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', c === current);
      b.onclick = function () { current = c; renderFilters(); renderGrid(); };
      $('filters').appendChild(b);
    });
  }
  function renderGrid() {
    $('grid').innerHTML = '';
    PHOTOS.filter(function (p) { return current === 'Tout' || p.cat === current; }).forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'pf-item'; b.setAttribute('aria-label', 'Agrandir : ' + p.alt);
      var img = document.createElement('img');
      img.src = url(p.src); img.alt = p.alt; img.loading = 'lazy'; img.decoding = 'async';
      img.onerror = function () { b.remove(); };
      var tag = document.createElement('span'); tag.textContent = p.cat;
      b.appendChild(img); b.appendChild(tag);
      b.onclick = function () { $('lb-img').src = img.src; $('lb-img').alt = p.alt; $('lb').hidden = false; };
      $('grid').appendChild(b);
    });
  }
  $('lb').onclick = $('lb-close').onclick = function () { $('lb').hidden = true; };
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') $('lb').hidden = true; });
  renderFilters(); renderGrid();

  fetch('/api/public/studio').then(function (r) { return r.ok ? r.json() : null; }).then(function (s) {
    if (!s) return;
    (s.sessionTypes || []).forEach(function (t) { var o = document.createElement('option'); o.value = o.textContent = t; $('types').appendChild(o); });
  }).catch(function () {});

  $('form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, msg = $('msg'), btn = $('send');
    var data = {}; new FormData(f).forEach(function (v, k) { data[k] = v; });
    if (!data.name || !data.email) { msg.className = 'pf-msg err'; msg.textContent = 'Entrez votre nom et votre e-mail.'; return; }
    btn.disabled = true; msg.className = 'pf-msg'; msg.textContent = 'Envoi…';
    fetch('/api/public/inquiry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (r) {
        if (r.ok) { f.reset(); msg.className = 'pf-msg ok'; msg.textContent = 'Merci ! Votre demande est envoyée, on vous répond très vite.'; }
        else { msg.className = 'pf-msg err'; msg.textContent = (r.j && (r.j.error || r.j.message)) || 'Envoi impossible. Écrivez-nous sur WhatsApp.'; }
      })
      .catch(function () { msg.className = 'pf-msg err'; msg.textContent = 'Connexion impossible. Réessayez.'; })
      .then(function () { btn.disabled = false; });
  });
})();
