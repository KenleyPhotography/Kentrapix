// Portfolio public : photos du portfolio kenleyelysee.com + demande de séance sans compte.
(function () {
  var BASE = 'https://www.kenleyelysee.com/';
  // Photos du portfolio kenleyelysee.com (chemin sur le site). Ajoutez ou retirez des fichiers ici.
  var SETS = {
    "Studio": [
      "image/shoot-studio/#3 berte.jpg",
      "image/shoot-studio/b and W.jpg",
      "image/shoot-studio/bg.jpg",
      "image/shoot-studio/DSC_0044 copie.jpg",
      "image/shoot-studio/DSC_0077 copie.jpg",
      "image/shoot-studio/DSC_0304 copy.jpg",
      "image/shoot-studio/DSC_0407 copy.jpg",
      "image/shoot-studio/DSC_0555 copy.jpg",
      "image/shoot-studio/DSC_0772 copie.jpg",
      "image/shoot-studio/DSC_0933 copie.jpg",
      "image/shoot-studio/DSC_0943 copie.jpg",
      "image/shoot-studio/DSC_0957 copie.jpg",
      "image/shoot-studio/DSC_1005 copie.jpg",
      "image/shoot-studio/DSC_1005 copy.jpg",
      "image/shoot-studio/DSC_1044-Récupéré.jpg",
      "image/shoot-studio/DSC_1065 copie.jpg",
      "image/shoot-studio/DSC_1378 copie.jpg",
      "image/shoot-studio/#1  Kp.jpg",
      "image/shoot-studio/Kimie Birthday.jpg",
      "image/shoot-studio/KP45.jpg",
      "image/shoot-studio/WEPE9516 copy.jpg",
      "image/shoot-studio/WEPE9574 copy.jpg",
      "image/shoot-studio/WEPE9577 copy.jpg",
      "image/shoot-studio/_SKE7048 copy.jpg",
      "image/shoot-studio/uuuuuuuuuuuuuuuuuuuuuuuuu.jpg",
      "image/shoot-studio/#1 Suze.jpg",
      "image/shoot-studio/_SKE7044 copy.jpg",
      "image/shoot-studio/DSC_1154 copie.jpg",
      "image/shoot-studio/KP014.jpg",
      "image/shoot-studio/kp09.jpg",
      "image/shoot-studio/KP 3.jpg",
      "image/shoot-studio/KP$4.jpg",
      "image/shoot-studio/KP02.jpg",
      "image/shoot-studio/h.jpg",
      "image/shoot-studio/Sas.jpg",
      "image/shoot-studio/Titi.jpg",
      "image/shoot-studio/DSC_1006 copy.jpg",
      "image/shoot-studio/DSC_0864 copie.jpg",
      "image/shoot-studio/KP013.jpg",
      "image/shoot-studio/DSC_1387 copie 2.jpg",
      "image/shoot-studio/DSC_0944 copie.jpg",
      "image/shoot-studio/Rose Berta copy.jpg",
      "image/shoot-studio/DSC_0343 copie.jpg",
      "image/shoot-studio/DSC_0359 copy copie 1.jpg",
      "image/shoot-studio/DSC_0720 copie.jpg"
    ],
    "Outdoor": [
      "image/outdoor/optimized/outdoor-01.jpg",
      "image/outdoor/optimized/outdoor-02.jpg",
      "image/outdoor/optimized/outdoor-03.jpg",
      "image/outdoor/optimized/outdoor-04.jpg",
      "image/outdoor/optimized/outdoor-05.jpg",
      "image/outdoor/optimized/outdoor-06.jpg",
      "image/outdoor/optimized/outdoor-07.jpg",
      "image/outdoor/optimized/outdoor-08.jpg",
      "image/outdoor/optimized/outdoor-09.jpg",
      "image/outdoor/optimized/outdoor-10.jpg",
      "image/outdoor/optimized/outdoor-11.jpg",
      "image/outdoor/optimized/outdoor-12.jpg",
      "image/outdoor/optimized/outdoor-13.jpg",
      "image/outdoor/optimized/outdoor-14.jpg",
      "image/outdoor/optimized/outdoor-15.jpg",
      "image/outdoor/optimized/outdoor-16.jpg",
      "image/outdoor/optimized/outdoor-17.jpg",
      "image/outdoor/optimized/outdoor-18.jpg"
    ],
    "Événement": [
      "image/event/optimized/event-01.jpg",
      "image/event/optimized/event-02.jpg",
      "image/event/optimized/event-03.jpg",
      "image/event/optimized/event-04.jpg",
      "image/event/optimized/event-05.jpg",
      "image/event/optimized/event-06.jpg",
      "image/event/optimized/event-07.jpg",
      "image/event/optimized/event-08.jpg",
      "image/event/optimized/event-09.jpg",
      "image/event/optimized/event-10.jpg",
      "image/event/optimized/event-11.jpg",
      "image/event/optimized/event-12.jpg",
      "image/event/optimized/event-13.jpg",
      "image/event/optimized/event-14.jpg",
      "image/event/optimized/event-15.jpg",
      "image/event/optimized/event-16.jpg",
      "image/event/optimized/event-17.jpg",
      "image/event/optimized/event-18.jpg",
      "image/event/optimized/event-19.jpg",
      "image/event/optimized/event-20.jpg",
      "image/event/optimized/event-21.jpg",
      "image/event/optimized/event-22.jpg",
      "image/event/optimized/event-23.jpg",
      "image/event/optimized/event-24.jpg",
      "image/event/optimized/event-25.jpg",
      "image/event/optimized/event-26.jpg",
      "image/event/optimized/event-27.jpg",
      "image/event/optimized/event-28.jpg",
      "image/event/optimized/event-29.jpg",
      "image/event/optimized/event-30.jpg",
      "image/event/optimized/event-31.jpg"
    ],
    "Graduation": [
      "image/Gaduation/optimized/graduation-01.jpg",
      "image/Gaduation/optimized/graduation-02.jpg",
      "image/Gaduation/optimized/graduation-03.jpg",
      "image/Gaduation/optimized/graduation-04.jpg",
      "image/Gaduation/optimized/graduation-05.jpg",
      "image/Gaduation/optimized/graduation-06.jpg",
      "image/Gaduation/optimized/graduation-07.jpg",
      "image/Gaduation/optimized/graduation-08.jpg",
      "image/Gaduation/optimized/graduation-09.jpg",
      "image/Gaduation/optimized/graduation-10.jpg",
      "image/Gaduation/optimized/graduation-11.jpg",
      "image/Gaduation/optimized/graduation-12.jpg",
      "image/Gaduation/optimized/graduation-13.jpg",
      "image/Gaduation/optimized/graduation-14.jpg",
      "image/Gaduation/optimized/graduation-15.jpg",
      "image/Gaduation/optimized/graduation-16.jpg"
    ],
    "Mariage": [
      "image/mariage/optimized/mariage-02.jpg",
      "image/mariage/optimized/mariage-03.jpg",
      "image/mariage/optimized/mariage-04.jpg",
      "image/mariage/optimized/mariage-05.jpg",
      "image/mariage/optimized/mariage-06.jpg",
      "image/mariage/optimized/mariage-07.jpg",
      "image/mariage/optimized/mariage-08.jpg",
      "image/mariage/optimized/mariage-09.jpg",
      "image/mariage/optimized/mariage-10.jpg",
      "image/mariage/optimized/mariage-13.jpg",
      "image/mariage/optimized/mariage-15.jpg",
      "image/mariage/optimized/mariage-17.jpg",
      "image/mariage/optimized/mariage-18.jpg",
      "image/mariage/optimized/mariage-19.jpg",
      "image/mariage/optimized/mariage-21.jpg",
      "image/mariage/optimized/mariage-22.jpg",
      "image/mariage/optimized/mariage-23.jpg",
      "image/mariage/optimized/mariage-29.jpg",
      "image/mariage/optimized/mariage-30.jpg",
      "image/mariage/optimized/mariage-31.jpg",
      "image/mariage/optimized/mariage-24.jpg",
      "image/mariage/optimized/mariage-25.jpg",
      "image/mariage/optimized/mariage-11.jpg",
      "image/mariage/optimized/mariage-12.jpg",
      "image/mariage/optimized/mariage-14.jpg",
      "image/mariage/optimized/mariage-16.jpg",
      "image/mariage/optimized/mariage-20.jpg",
      "image/mariage/optimized/mariage-26.jpg",
      "image/mariage/optimized/mariage-27.jpg",
      "image/mariage/optimized/mariage-28.jpg",
      "image/mariage/optimized/mariage-32.jpg"
    ]
  };
  var ALT = {"Studio": "Portrait en studio", "Outdoor": "Séance en extérieur", "Événement": "Photographie d’événement", "Graduation": "Portrait de graduation", "Mariage": "Photographie de mariage"};
  var PHOTOS = [];
  // Mélange les catégories (1 photo de chacune à tour de rôle) pour que « Tout » soit varié.
  (function () { var cats = Object.keys(SETS), max = Math.max.apply(null, cats.map(function (c) { return SETS[c].length; })); for (var i = 0; i < max; i++) cats.forEach(function (cat) { if (SETS[cat][i]) PHOTOS.push({ cat: cat, src: SETS[cat][i], alt: ALT[cat] + ' ' + (i + 1) }); }); })();
  var PAGE = 12, shown = PAGE;
  var $ = function (id) { return document.getElementById(id); };
  var url = function (p) { return BASE + p.split('/').map(encodeURIComponent).join('/'); };
  var current = 'Tout';

  $('year').textContent = new Date().getFullYear();

  function renderFilters() {
    var cats = ['Tout'].concat(PHOTOS.map(function (p) { return p.cat; }).filter(function (c, i, a) { return a.indexOf(c) === i; }));
    $('filters').innerHTML = '';
    cats.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = c; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', c === current);
      b.onclick = function () { current = c; shown = PAGE; renderFilters(); renderGrid(); };
      $('filters').appendChild(b);
    });
  }
  function renderGrid() {
    $('grid').innerHTML = '';
    var list = PHOTOS.filter(function (p) { return current === 'Tout' || p.cat === current; });
    $('more').hidden = shown >= list.length;
    list.slice(0, shown).forEach(function (p) {
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
  $('more').onclick = function () { shown += PAGE; renderGrid(); };
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
