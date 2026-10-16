// Page publique d'un contrat : le lien secret (?t=…) donne accès à ce seul contrat.
// Papier à en-tête du photographe, texte, puis deux signatures (photographe déjà apposée, client à signer).
(function () {
  'use strict';
  var sheet = document.getElementById('sheet');
  var token = new URLSearchParams(location.search).get('t') || '';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var stamp = function (iso) { return iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' }) : '—'; };
  var date = function (iso) { return iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : ''; };
  var initials = function (n) { return String(n || '').split(/\s+/).filter(Boolean).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase(); };

  document.getElementById('print').addEventListener('click', function () { window.print(); });
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) { sheet.innerHTML = '<p class="error">Lien de contrat invalide.</p>'; return; }

  function load() {
    return fetch('/api/contract/' + encodeURIComponent(token), { headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Contrat introuvable.'); return j; }); })
      .then(draw)
      .catch(function (e) { sheet.innerHTML = '<p class="error">' + esc(e.message) + '</p>'; });
  }
  load();

  function draw(c) {
    var s = c.studio, signed = c.status === 'signed';
    document.title = c.title + ' — ' + s.name;
    var avatar = s.avatar ? '<img class="avatar" src="' + esc(s.avatar) + '" alt="">' : '<span class="avatar ini">' + esc(initials(s.name)) + '</span>';
    var site = s.website ? s.website.replace(/^https?:\/\//, '') : '';
    var contacts = [s.phone, s.email, s.address, site, s.instagram && '@' + s.instagram].filter(Boolean).map(esc).join(' · ');
    var person = s.person && s.person !== s.name ? esc(s.person) + ' · Photographe' : 'Photographe';

    var clientSign = signed
      ? '<div class="sig-area"><img src="' + esc(c.signature) + '" alt="Signature de ' + esc(c.signedName) + '"></div><p class="sig-name">' + esc(c.signedName) + '</p><p class="sig-date">Signé le ' + esc(stamp(c.signedAt)) + '</p>'
      : '<form id="sign-form" novalidate><div class="sig-area pad-wrap" id="pad-wrap"><canvas id="pad" aria-label="Zone de signature"></canvas><span class="pad-hint">Signez ici avec le doigt ou la souris</span></div>' +
        '<div class="pad-tools"><button type="button" id="pad-clear">Effacer</button></div>' +
        '<label class="field">Votre nom complet<input type="text" id="sg-name" autocomplete="name" maxlength="120" placeholder="Prénom et nom" value="' + esc(c.clientName) + '"></label></form>';

    sheet.innerHTML =
      '<header class="letterhead">' + avatar +
        '<div class="lh-name"><h1>' + esc(s.name) + '</h1><p class="lh-person">' + person + '</p>' + (contacts ? '<p class="lh-contact">' + contacts + '</p>' : '') + '</div>' +
      '</header>' +
      '<div class="body">' +
        (signed ? '<div class="stamp signed">Signé</div>' : '') +
        '<div class="doc-title"><span>Contrat de prestation photographique</span><h2>' + esc(c.title) + '</h2><p>Rédigé le ' + esc(date(c.createdAt)) + ' · pour <strong>' + esc(c.clientName) + '</strong></p></div>' +
        '<div class="contract-text">' + esc(c.body) + '</div>' +
        '<div class="sigs">' +
          '<section class="sig"><h3>Le photographe</h3><div class="sig-area">' + (c.staffSignature ? '<img src="' + esc(c.staffSignature) + '" alt="Signature du photographe">' : '<span class="sig-empty">—</span>') + '</div>' +
            '<p class="sig-name">' + esc(s.person || s.name) + '</p><p class="sig-date">' + (c.staffSignedAt ? 'Signé le ' + esc(date(c.staffSignedAt)) : '') + '</p></section>' +
          '<section class="sig"><h3>Le client</h3>' + clientSign + '</section>' +
        '</div>' +
        (signed
          ? '<p class="hash">✓ Contrat signé électroniquement par les deux parties.<br>Empreinte SHA-256 : ' + esc(c.hash) + '</p>'
          : '<div class="signbox"><label class="agree"><input type="checkbox" id="sg-agree"><span>J’ai lu le contrat ci-dessus et je l’accepte. Je reconnais que ma signature électronique a la même valeur qu’une signature sur papier.</span></label>' +
            '<button class="sign-btn" type="button" id="sg-go">Signer le contrat</button><p class="sign-error" id="sg-err" role="alert" hidden></p></div>') +
        '<p class="powered">Contrat établi avec KentraPix</p>' +
      '</div>';
    if (!signed) bindForm();
  }

  function bindForm() {
    var canvas = document.getElementById('pad'), wrap = document.getElementById('pad-wrap'), ctx = canvas.getContext('2d');
    var drawing = false, last = null, ink = 0;
    function fit() {
      var r = canvas.getBoundingClientRect(), ratio = Math.max(1, window.devicePixelRatio || 1);
      canvas.width = Math.round(r.width * ratio); canvas.height = Math.round(r.height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#082445';
      ink = 0; wrap.classList.remove('has-ink');
    }
    fit();
    window.addEventListener('resize', function () { if (!ink) fit(); });
    function pos(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    canvas.addEventListener('pointerdown', function (e) {
      e.preventDefault(); canvas.setPointerCapture(e.pointerId); drawing = true; last = pos(e);
      ctx.beginPath(); ctx.arc(last.x, last.y, 1.2, 0, 6.3); ctx.fillStyle = '#082445'; ctx.fill(); ink += 2; wrap.classList.add('has-ink');
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!drawing) return; e.preventDefault(); var p = pos(e);
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      ink += Math.abs(p.x - last.x) + Math.abs(p.y - last.y); last = p;
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) { canvas.addEventListener(t, function () { drawing = false; }); });
    document.getElementById('pad-clear').addEventListener('click', function () { ctx.clearRect(0, 0, canvas.width, canvas.height); ink = 0; wrap.classList.remove('has-ink'); });

    var err = document.getElementById('sg-err');
    var fail = function (m) { err.textContent = m; err.hidden = false; };
    var btn = document.getElementById('sg-go');
    var submit = function () {
      err.hidden = true;
      var name = document.getElementById('sg-name').value.trim();
      if (name.length < 3) return fail('Écrivez votre nom complet.');
      if (ink < 60) return fail('Dessinez votre signature dans le cadre.');
      if (!document.getElementById('sg-agree').checked) return fail('Cochez la case pour accepter le contrat.');
      btn.disabled = true; btn.textContent = 'Envoi…';
      fetch('/api/contract/' + encodeURIComponent(token) + '/sign', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ name: name, agree: true, signature: canvas.toDataURL('image/png') })
      }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'Signature impossible.'); }); })
        .then(function () { return load().then(function () { window.scrollTo({ top: 0, behavior: 'smooth' }); }); })
        .catch(function (x) { btn.disabled = false; btn.textContent = 'Signer le contrat'; fail(x.message); });
    };
    btn.addEventListener('click', submit);
    document.getElementById('sign-form').addEventListener('submit', function (e) { e.preventDefault(); submit(); });
  }
})();
