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
  // « Tout » : les catégories alternent (studio, outdoor, événement…) au lieu d'afficher tout un genre d'un coup.
  var MIX = [];
  function rebuildMix() {
    MIX = [];
    var cols = Object.keys(SETS).map(function (c) { return PHOTOS.filter(function (p) { return p.cat === c; }); });
    for (var i = 0, more = true; more; i++) { more = false; cols.forEach(function (col) { if (col[i]) { MIX.push(col[i]); more = true; } }); }
  }
  rebuildMix();
  var PAGE = 12, shown = PAGE;
  var $ = function (id) { return document.getElementById(id); };
  var url = function (p) { return p.charAt(0) === '/' ? p : BASE + p.split('/').map(encodeURIComponent).join('/'); }; // « /… » = photo ajoutée depuis le studio
  var SLUGS = { outdoor: 'Outdoor', evenement: 'Événement', graduation: 'Graduation', mariage: 'Mariage', studio: 'Studio' };
  var slugOf = function (cat) { return Object.keys(SLUGS).filter(function (k) { return SLUGS[k] === cat; })[0]; };
  var m = location.pathname.match(/^\/studio\/([a-z]+)\/?$/);
  var current = (m && SLUGS[m[1]]) || 'Tout';
  var baseTitle = document.title;
  function syncUrl() {
    document.title = current === 'Tout' ? baseTitle : current + ' — ' + baseTitle;
    try { history.replaceState(null, '', current === 'Tout' ? '/studio' : '/studio/' + slugOf(current)); } catch (e) {}
  }

  $('year').textContent = new Date().getFullYear();

  function renderFilters() {
    var cats = ['Tout'].concat(PHOTOS.map(function (p) { return p.cat; }).filter(function (c, i, a) { return a.indexOf(c) === i; }));
    $('filters').innerHTML = '';
    cats.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = c; if (c !== 'Tout') { var n = document.createElement('small'); n.textContent = PHOTOS.filter(function (p) { return p.cat === c; }).length; b.appendChild(n); } b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', c === current);
      b.onclick = function () { current = c; shown = PAGE; syncUrl(); renderFilters(); renderGrid(); };
      $('filters').appendChild(b);
    });
  }
  function renderGrid() {
    $('grid').innerHTML = '';
    var list = current === 'Tout' ? MIX : PHOTOS.filter(function (p) { return p.cat === current; });
    $('more').hidden = shown >= list.length;
    list.slice(0, shown).forEach(function (p, n) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'pf-item' + (n % 7 === 0 ? ' pf-big' : ''); b.setAttribute('aria-label', 'Agrandir : ' + p.alt);
      var img = document.createElement('img');
      img.src = url(p.src); img.alt = p.alt; img.loading = 'lazy'; img.decoding = 'async';
      img.onerror = function () { b.remove(); };
      var tag = document.createElement('span'); tag.textContent = p.cat;
      b.appendChild(img); b.appendChild(tag);
      b.onclick = function () { openAt(list, n); };
      $('grid').appendChild(b);
    });
  }
  var lbList = [], lbAt = 0;
  function openAt(list, n) {
    lbList = list; lbAt = (n + list.length) % list.length;
    var p = lbList[lbAt]; $('lb-img').src = url(p.src); $('lb-img').alt = p.alt; $('lb').hidden = false;
  }
  $('lb-prev').onclick = function (e) { e.stopPropagation(); openAt(lbList, lbAt - 1); };
  $('lb-next').onclick = function (e) { e.stopPropagation(); openAt(lbList, lbAt + 1); };
  $('more').onclick = function () { shown += PAGE; renderGrid(); };
  $('lb').onclick = $('lb-close').onclick = function () { $('lb').hidden = true; };
  document.addEventListener('keydown', function (e) {
    if ($('lb').hidden) return;
    if (e.key === 'Escape') $('lb').hidden = true;
    else if (e.key === 'ArrowLeft') openAt(lbList, lbAt - 1);
    else if (e.key === 'ArrowRight') openAt(lbList, lbAt + 1);
  });
  if (current !== 'Tout') document.title = current + ' — ' + baseTitle;
  renderFilters(); renderGrid();

  // Photos ajoutées depuis le studio : elles passent devant celles de kenleyelysee.com.
  fetch('/api/public/portfolio').then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
    if (!j || !j.photos || !j.photos.length) return;
    var mine = j.photos.filter(function (p) { return SETS[p.category]; }).map(function (p, i) { return { cat: p.category, src: p.src, alt: (ALT[p.category] || 'Photo') + ' ' + (i + 1) }; });
    PHOTOS = mine.concat(PHOTOS); rebuildMix(); renderFilters(); renderGrid();
  }).catch(function () {});
  if (current !== 'Tout') $('galerie').scrollIntoView();

  fetch('/api/public/studio').then(function (r) { return r.ok ? r.json() : null; }).then(function (s) {
    if (!s) return;
    (s.sessionTypes || []).forEach(function (t) { var o = document.createElement('option'); o.value = o.textContent = t; $('types').appendChild(o); });
  }).catch(function () {});

  // Date + heure déjà prises : on le dit tout de suite et on propose d'autres moments à choisir d'un clic.
  var frDate = function (d) { return new Date(d + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' }); };
  var checking = 0;
  function showAlt(c, date) {
    var box = $('alt'); box.innerHTML = '';
    var opts = (c.times || []).map(function (t) { return { label: t, day: date, time: t }; })
      .concat((c.dates || []).map(function (d) { return { label: frDate(d.day) + ' à ' + d.time, day: d.day, time: d.time }; }));
    if (!opts.length) { box.hidden = true; return; }
    var t = document.createElement('span'); t.textContent = 'Moments libres :'; box.appendChild(t);
    opts.forEach(function (o) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = o.label;
      b.onclick = function () { $('wish').value = o.day; $('wishtime').value = o.time; checkSlot(); };
      box.appendChild(b);
    });
    box.hidden = false;
  }
  // Vérifie la date et l'heure choisies (promesse : true = libre ou pas encore complet).
  function checkSlot() {
    var d = $('wish').value, t = $('wishtime').value, msg = $('msg'), id = ++checking;
    var clear = function () { if (msg.dataset.taken) { msg.textContent = ''; msg.className = 'pf-msg'; delete msg.dataset.taken; } $('alt').hidden = true; };
    if (!d || !t) { clear(); return Promise.resolve(true); }
    return fetch('/api/public/slot-check?date=' + encodeURIComponent(d) + '&time=' + encodeURIComponent(t))
      .then(function (r) { return r.ok ? r.json() : { ok: true }; })
      .then(function (j) {
        if (id !== checking) return true;
        if (j.ok) { clear(); return true; }
        msg.className = 'pf-msg err'; msg.dataset.taken = '1'; msg.textContent = j.error; showAlt(j, d); return false;
      })
      .catch(function () { return true; });
  }
  // Lieu : obligatoire pour toute séance qui n'est pas un portrait ou une séance studio (anniversaire au studio…).
  var STUDIO = /portrait|studio|anniv|birthday/i;
  function syncPlace() {
    var t = $('types').value, studio = !t || STUDIO.test(t);
    $('placeRow').hidden = studio; $('place').required = !studio; $('placeHint').hidden = !t || !studio;
    if (studio) $('place').value = '';
  }
  $('types').addEventListener('change', syncPlace);
  $('wish').addEventListener('change', checkSlot);
  $('wishtime').addEventListener('change', checkSlot);
  $('wish').min = new Date().toISOString().slice(0, 10);

  $('form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, msg = $('msg'), btn = $('send');
    var data = {}; new FormData(f).forEach(function (v, k) { data[k] = v; });
    if (!data.name || String(data.phone || '').replace(/\D/g, '').length < 6) { msg.className = 'pf-msg err'; msg.textContent = 'Entrez votre nom et votre numéro de téléphone.'; return; }
    if (!data.sessionType) { msg.className = 'pf-msg err'; msg.textContent = 'Choisissez le type de séance.'; return; }
    if (!STUDIO.test(data.sessionType) && !String(data.location || '').trim()) { msg.className = 'pf-msg err'; msg.textContent = 'Indiquez le lieu de la séance.'; $('place').focus(); return; }
    if (data.date && !data.time) { msg.className = 'pf-msg err'; msg.textContent = 'Choisissez aussi l’heure souhaitée.'; return; }
    btn.disabled = true; msg.className = 'pf-msg'; msg.textContent = 'Envoi…';
    fetch('/api/public/inquiry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (r) {
        if (r.ok) { f.reset(); msg.className = 'pf-msg ok'; msg.textContent = 'Merci ! Votre demande est envoyée, on vous répond très vite.'; }
        else { msg.className = 'pf-msg err'; msg.textContent = (r.j && (r.j.error || r.j.message)) || 'Envoi impossible. Écrivez-nous sur WhatsApp.'; if (r.j && (r.j.times || r.j.dates)) showAlt(r.j, data.date); }
      })
      .catch(function () { msg.className = 'pf-msg err'; msg.textContent = 'Connexion impossible. Réessayez.'; })
      .then(function () { btn.disabled = false; });
  });
})();
