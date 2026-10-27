// Page publique d'un contrat : le lien secret (?t=…) donne accès à ce seul contrat.
// Papier à en-tête du photographe, texte, puis deux signatures (photographe déjà apposée, client à signer).
(function () {
  'use strict';
  var sheet = document.getElementById('sheet');
  var token = (location.pathname.match(/^\/c\/([A-Za-z0-9_-]+)/) || [])[1] || new URLSearchParams(location.search).get('t') || '';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var stamp = function (iso) { return iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' }) : '—'; };
  var date = function (iso) { return iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : ''; };
  var initials = function (n) { return String(n || '').split(/\s+/).filter(Boolean).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase(); };
  // Un contrat de site internet parle du « prestataire », pas du « photographe ».
  var roleOf = function (c) { return c.kind === 'web' ? 'prestataire' : 'photographe'; };
  // Titre au-dessus de la signature : le métier réglé dans le profil s'il y en a un
  // (« Le photographe » sinon). Les contrats de site gardent « Le prestataire ».
  var signRoleOf = function (c) {
    var job = c.studio && c.studio.jobTitle;
    return c.kind === 'web' || !job ? 'Le ' + roleOf(c) : job;
  };

  // Met le texte brut du contrat en page (aucun symbole à l'écran) :
  //  - titre en majuscules, parties (photographe / client) côte à côte, sections numérotées « 1. … » en cartes,
  //  - lignes « Libellé : valeur » en tableau, puces « • », cases ☐ / ☑.
  // st = { interactive, refused:Set, checks:[…] } : le client peut cocher/décocher les cases et souligner (refuser) une ligne.
  function rich(text, st) {
    st = st || { interactive: false, refused: new Set(), checks: null };
    var KV = /^([^:•☐☑]{2,44}?) : (.+)$/;
    var strong = function (s) { return s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'); };
    var checks = function (s) { return s.replace(/☑/g, '<span class="ck on">☑</span>').replace(/☐/g, '<span class="ck">☐</span>'); };
    var inline = function (s) { return checks(strong(esc(s))); };
    var clause = 0, boxes = 0;
    var tokens = [];
    String(text).split(/\r?\n/).forEach(function (raw) {
      var l = raw.replace(/\s+$/, ''), m, b;
      if (!l.trim()) { tokens.push({ t: 'blank' }); return; }
      if ((m = l.match(/^##\s+(.*)$/))) return tokens.push({ t: 'h', v: m[1] });
      if ((m = l.match(/^#\s+(.*)$/))) return tokens.push({ t: 'title', v: m[1] });
      if ((m = l.match(/^[☐☑]/))) return tokens.push({ t: 'ck', v: l });
      b = l.match(/^[-•]\s+(.*)$/);
      var body = b ? b[1] : l;
      if ((m = body.match(KV)) && !/[.!?]$/.test(m[1])) return tokens.push({ t: 'kv', k: m[1], v: m[2] });
      if (b) return tokens.push({ t: 'li', v: b[1] });
      if (/^\d+\.\s*\S/.test(l) && l.length <= 70 && !/[.:;,]$/.test(l)) return tokens.push({ t: 'h', v: l });
      if (l.length >= 10 && l === l.toUpperCase() && /[A-ZÀÉ]{4}/.test(l)) return tokens.push({ t: 'title', v: l });
      if (/ :$/.test(l) && l.length <= 44) return tokens.push({ t: 'lbl', v: l });
      tokens.push({ t: 'p', v: l });
    });

    // Ligne de clause : numérotée (data-i) pour pouvoir être refusée par le client.
    function line(tag, v, mark) {
      if (!mark) return '<' + tag + '>' + inline(v) + '</' + tag + '>';
      var i = clause++, bad = st.refused.has(i);
      return '<' + tag + ' data-i="' + i + '" class="cl' + (bad ? ' refused' : '') + (st.interactive ? ' tap' : '') + '"' + (st.interactive ? ' tabindex="0" role="button" aria-pressed="' + bad + '"' : '') + '>' + inline(v) + (bad ? '<em class="no-tag">Non accepté</em>' : '') + '</' + tag + '>';
    }
    function box(v) {
      var k = boxes++, on = st.checks && k < st.checks.length ? !!st.checks[k] : v.charAt(0) === '☑';
      var rest = v.replace(/^[☐☑]\s*/, '');
      return '<div class="ck-row' + (on ? ' on' : '') + (st.interactive ? ' tap' : '') + '" data-k="' + k + '"' + (st.interactive ? ' tabindex="0" role="checkbox" aria-checked="' + on + '"' : '') + '><span class="ck' + (on ? ' on' : '') + '">' + (on ? '☑' : '☐') + '</span><span>' + inline(rest) + '</span></div>';
    }
    function render(list, mark) {
      var out = [], i = 0;
      while (i < list.length) {
        var t = list[i], run = [];
        if (t.t === 'kv') { while (i < list.length && list[i].t === 'kv') run.push(list[i++]); out.push(dl(run)); }
        else if (t.t === 'li') { while (i < list.length && list[i].t === 'li') run.push(list[i++]); out.push('<ul>' + run.map(function (x) { return line('li', x.v, mark); }).join('') + '</ul>'); }
        else if (t.t === 'ck') { while (i < list.length && list[i].t === 'ck') run.push(list[i++]); out.push('<div class="ct-checks">' + run.map(function (x) { return box(x.v); }).join('') + '</div>'); }
        else { i++; if (t.t === 'lbl') out.push('<p class="lbl">' + inline(t.v) + '</p>'); else if (t.t === 'p') out.push(line('p', t.v, mark)); }
      }
      return out.join('');
    }
    function dl(rows) { return '<dl class="ct-kv">' + rows.map(function (r) { return '<div><dt>' + esc(r.k) + '</dt><dd>' + checks(strong(esc(r.v))) + '</dd></div>'; }).join('') + '</dl>'; }

    // Préambule (avant la 1re section) : titre, puis les deux parties côte à côte si elles sont reconnues.
    var first = tokens.findIndex(function (x) { return x.t === 'h'; });
    var pre = first < 0 ? tokens : tokens.slice(0, first), rest = first < 0 ? [] : tokens.slice(first);
    var head = '', groups = [], intro = [], cur = null;
    pre.forEach(function (x) {
      if (x.t === 'title') head += '<h3 class="ct-title">' + inline(x.v) + '</h3>';
      else if (x.t === 'kv') { if (!cur) { cur = []; groups.push(cur); } cur.push(x); }
      else if (x.t === 'p' && /^(et|and)$/i.test(x.v.trim())) cur = null;
      else if (x.t !== 'blank') { cur = null; intro.push(x); }
    });
    var preHtml = head + render(intro, false);
    if (groups.length === 2) preHtml += '<div class="ct-parties">' + dl(groups[0]) + '<span class="ct-and">ET</span>' + dl(groups[1]) + '</div>';
    else groups.forEach(function (g) { preHtml += dl(g); });

    // Sections : numéro dans une pastille, titre, contenu.
    var sections = [], s = null;
    rest.forEach(function (x) { if (x.t === 'h') { s = { h: x.v, items: [] }; sections.push(s); } else if (s) s.items.push(x); });
    var secHtml = sections.map(function (sec) {
      var m = sec.h.match(/^(\d+)\.\s*(.*)$/);
      return '<section class="ct-sec"><h4 class="ct-h">' + (m ? '<span class="ct-n">' + esc(m[1]) + '</span><span>' + inline(m[2]) + '</span>' : '<span>' + inline(sec.h) + '</span>') + '</h4><div class="ct-body">' + render(sec.items, true) + '</div></section>';
    }).join('');
    return preHtml + secHtml;
  }

  document.getElementById('print').addEventListener('click', function () { window.print(); });
  if (!/^[A-Za-z0-9_-]{12,32}$/.test(token)) { sheet.innerHTML = '<p class="error">Lien de contrat invalide.</p>'; return; }

  function load() {
    return fetch('/api/contract/' + encodeURIComponent(token), { headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Contrat introuvable.'); return j; }); })
      .then(draw)
      .catch(function (e) { sheet.innerHTML = '<p class="error">' + esc(e.message) + '</p>' + (/Connectez-vous|destinataire/.test(e.message) ? '<p style="text-align:center"><a href="/login" style="color:#1265d8;font-weight:700">Se connecter</a></p>' : ''); });
  }
  load();

  function draw(c) {
    var s = c.studio, signed = c.status === 'signed', web = c.kind === 'web', role = roleOf(c);
    document.title = c.title + ' — ' + s.name;
    var avatar = s.avatar ? '<img class="avatar" src="' + esc(s.avatar) + '" alt="">' : '<span class="avatar ini">' + esc(initials(s.name)) + '</span>';
    var site = s.website ? s.website.replace(/^https?:\/\//, '') : '';
    var contacts = [s.phone, s.email, s.address, site, s.instagram && '@' + s.instagram].filter(Boolean).map(esc).join(' · ');
    var job = web ? 'Prestataire' : esc(s.jobTitle || 'Photographe'); // échappé : il vient du profil, et person est inséré tel quel
    var person = s.person && s.person !== s.name ? esc(s.person) + ' · ' + job : job;

    var clientSign = signed
      ? '<div class="sig-area"><img src="' + esc(c.signature) + '" alt="Signature de ' + esc(c.signedName) + '"></div><p class="sig-name">' + esc(c.signedName) + '</p><p class="sig-date">Signé le ' + esc(stamp(c.signedAt)) + '</p>'
      : !c.canSign
      ? '<div class="sig-area"><span class="sig-empty">' + (c.waitingStaff ? 'Le ' + role + ' doit d’abord signer' : 'En attente de la signature du client') + '</span></div><p class="sig-name">' + esc(c.clientName) + '</p><p class="sig-date"></p>'
      : '<form id="sign-form" novalidate><div class="sig-area pad-wrap" id="pad-wrap"><canvas id="pad" aria-label="Zone de signature"></canvas><span class="pad-hint">Signez ici avec le doigt ou la souris</span></div>' +
        '<div class="pad-tools"><button type="button" id="pad-clear">Effacer</button></div>' +
        '<label class="field">Remarques <span style="font-weight:500">(facultatif)</span><textarea id="sg-notes" maxlength="1000" rows="2" placeholder="Ex. Je souhaite discuter du point 7 avant de signer."></textarea></label>' +
        '<label class="field">Votre nom complet<input type="text" id="sg-name" autocomplete="name" maxlength="120" placeholder="Prénom et nom" value="' + esc(c.clientName) + '"></label></form>';

    var st = { interactive: !signed && !!c.canSign, refused: new Set((c.choices && c.choices.refused) || []), checks: c.choices && c.choices.checks && c.choices.checks.length ? c.choices.checks : null };
    var staffName = esc(s.person || s.name);
    var staffDate = c.staffSignedAt ? 'Signé le ' + esc(date(c.staffSignedAt)) : '';
    var staffSign = c.canStaffSign
      ? (c.staffSignature
        ? '<div class="sig-area"><img src="' + esc(c.staffSignature) + '" alt="Signature du ' + role + '"></div><p class="sig-name">' + staffName + '</p><p class="sig-date">' + staffDate + '</p><button type="button" class="sig-redo" id="staff-open">Refaire ma signature</button>'
        : '<button type="button" class="sig-area sig-click" id="staff-open"><span class="sig-plus">✍</span><b>Touchez ici pour signer</b><small>Votre signature sera apposée sur ce contrat</small></button><p class="sig-name">' + staffName + '</p><p class="sig-date"></p>')
      : '<div class="sig-area">' + (c.staffSignature ? '<img src="' + esc(c.staffSignature) + '" alt="Signature du ' + role + '">' : '<span class="sig-empty">En attente de la signature du ' + role + '</span>') + '</div><p class="sig-name">' + staffName + '</p><p class="sig-date">' + staffDate + '</p>';

    sheet.innerHTML =
      '<header class="letterhead">' + avatar +
        '<div class="lh-name"><h1>' + esc(s.name) + '</h1><p class="lh-person">' + person + '</p>' + (contacts ? '<p class="lh-contact">' + contacts + '</p>' : '') + '</div>' +
      '</header>' +
      '<div class="body">' +
        (signed ? '<div class="stamp signed">Signé</div>' : '') +
        '<div class="doc-title"><span>' + (web ? 'Contrat de création de site internet' : 'Contrat de prestation photographique') + '</span><h2>' + esc(c.title) + '</h2><p>Rédigé le ' + esc(date(c.createdAt)) + ' · pour <strong>' + esc(c.clientName) + '</strong></p></div>' +
        (c.canSign ? '<div class="hint-box"><strong>Avant de signer</strong><span>Touchez une <b>case</b> pour la cocher ou la décocher. Touchez une <b>ligne</b> que vous n’acceptez pas : elle sera soulignée en rouge et le ' + role + ' le verra.</span></div>' : '') +
        '<div class="contract-text" id="ctext">' + rich(c.body, st) + '</div>' + reservesBox(c, st) +
        '<h3 class="sig-head">Signatures</h3><p class="sig-fait">Fait le <strong>' + esc(date(c.createdAt)) + '</strong></p>' +
        '<div class="sigs">' +
          '<section class="sig" id="staff-sig"><h3>' + esc(signRoleOf(c)) + '</h3>' + staffSign + '</section>' +
          '<section class="sig"><h3>Le client</h3>' + clientSign + '</section>' +
        '</div>' +
        (signed
          ? '<p class="hash">✓ Contrat signé électroniquement par les deux parties.<br>Empreinte SHA-256 : ' + esc(c.hash) + '</p>'
          : !c.canSign ? ''
          : '<div class="signbox"><label class="agree"><input type="checkbox" id="sg-agree"><span>J’ai lu le contrat ci-dessus et je l’accepte. Je reconnais que ma signature électronique a la même valeur qu’une signature sur papier.</span></label>' +
            '<button class="sign-btn" type="button" id="sg-go">Signer le contrat</button><p class="sign-error" id="sg-err" role="alert" hidden></p></div>') +
        '<p class="powered">Contrat établi avec KentraPix</p>' +
      '</div>';
    if (!signed && c.canSign) bindForm();
    if (c.canStaffSign) bindStaff(c);
  }

  // Résumé des points non acceptés (visible par le photographe et par le client une fois le contrat signé).
  function reservesBox(c, st) {
    if (!c.choices) return '';
    var tmp = document.createElement('div'); tmp.innerHTML = rich(c.body, st);
    var lines = [].map.call(tmp.querySelectorAll('.cl.refused'), function (n) { var x = n.cloneNode(true); var t = x.querySelector('.no-tag'); if (t) t.remove(); return x.textContent.trim(); });
    if (!lines.length && !c.choices.notes) return '';
    return '<div class="reserves"><h3>Points non acceptés par le client</h3>' + (lines.length ? '<ul>' + lines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>' : '') +
      (c.choices.notes ? '<p><strong>Remarques :</strong> ' + esc(c.choices.notes) + '</p>' : '') + '</div>';
  }

  // Le photographe signe ici, sur le contrat lui-même : un toucher sur la zone ouvre le cadre de dessin (pas de fenêtre).
  function bindStaff(c) {
    var open = document.getElementById('staff-open');
    if (!open) return;
    open.addEventListener('click', function () {
      var box = document.getElementById('staff-sig');
      box.innerHTML = '<h3>' + esc(signRoleOf(c)) + '</h3><div class="sig-area pad-wrap" id="spad-wrap"><canvas id="spad" aria-label="Zone de signature du ' + roleOf(c) + '"></canvas><span class="pad-hint">Signez ici avec le doigt ou la souris</span></div>' +
        '<div class="pad-tools"><button type="button" id="spad-clear">Effacer</button>' + (c.savedSignature ? '<button type="button" id="spad-saved">Utiliser ma signature enregistrée</button>' : '') + '</div>' +
        '<label class="agree sm"><input type="checkbox" id="spad-remember"><span>Garder cette signature pour mes prochains contrats</span></label>' +
        '<button class="sign-btn" type="button" id="spad-go">Valider ma signature</button><p class="sign-error" id="spad-err" role="alert" hidden></p>';
      var canvas = document.getElementById('spad'), wrap = document.getElementById('spad-wrap'), ctx = canvas.getContext('2d');
      var r = canvas.getBoundingClientRect(), ratio = Math.max(1, window.devicePixelRatio || 1), ink = 0, last = null;
      canvas.width = Math.round(r.width * ratio); canvas.height = Math.round(r.height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.lineWidth = 1.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#082445';
      var pos = function (e) { var b = canvas.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
      canvas.addEventListener('pointerdown', function (e) { e.preventDefault(); canvas.setPointerCapture(e.pointerId); last = pos(e); ctx.beginPath(); ctx.arc(last.x, last.y, 0.7, 0, 6.3); ctx.fillStyle = '#082445'; ctx.fill(); ink += 2; wrap.classList.add('has-ink'); });
      canvas.addEventListener('pointermove', function (e) { if (!last) return; e.preventDefault(); var p = pos(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); ink += Math.abs(p.x - last.x) + Math.abs(p.y - last.y); last = p; });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) { canvas.addEventListener(t, function () { last = null; }); });
      document.getElementById('spad-clear').addEventListener('click', function () { ctx.clearRect(0, 0, canvas.width, canvas.height); ink = 0; wrap.classList.remove('has-ink'); });
      var err = document.getElementById('spad-err'), go = document.getElementById('spad-go');
      var send = function (signature) {
        err.hidden = true; go.disabled = true; go.textContent = 'Enregistrement…';
        fetch('/api/contract/' + encodeURIComponent(token) + '/staff-sign', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ signature: signature, remember: document.getElementById('spad-remember').checked }) })
          .then(function (res) { return res.json().catch(function () { return {}; }).then(function (j) { if (!res.ok) throw new Error(j.error || 'Signature impossible.'); }); })
          .then(function () { return load(); })
          .catch(function (x) { go.disabled = false; go.textContent = 'Valider ma signature'; err.textContent = x.message; err.hidden = false; });
      };
      go.addEventListener('click', function () { if (ink < 60) { err.textContent = 'Dessinez votre signature dans le cadre.'; err.hidden = false; return; } send(canvas.toDataURL('image/png')); });
      var saved = document.getElementById('spad-saved');
      if (saved) saved.addEventListener('click', function () { send(c.savedSignature); });
    });
  }

  // Le client touche une case (cocher / décocher) ou une ligne (souligner = refuser).
  function bindChoices() {
    var root = document.getElementById('ctext');
    if (!root) return;
    var act = function (e) {
      var row = e.target.closest('.ck-row[data-k]');
      if (row) { var on = !row.classList.contains('on'); row.classList.toggle('on', on); row.setAttribute('aria-checked', on); var ck = row.querySelector('.ck'); ck.classList.toggle('on', on); ck.textContent = on ? '☑' : '☐'; return; }
      var cl = e.target.closest('.cl[data-i]');
      if (cl) { var bad = !cl.classList.contains('refused'); cl.classList.toggle('refused', bad); cl.setAttribute('aria-pressed', bad); var tag = cl.querySelector('.no-tag'); if (bad && !tag) cl.insertAdjacentHTML('beforeend', '<em class="no-tag">Non accepté</em>'); else if (!bad && tag) tag.remove(); }
    };
    root.addEventListener('click', act);
    root.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(e); } });
  }
  function collectChoices() {
    var refused = [].map.call(document.querySelectorAll('#ctext .cl.refused'), function (n) { return Number(n.dataset.i); });
    var checks = [].map.call(document.querySelectorAll('#ctext .ck-row[data-k]'), function (n) { return n.classList.contains('on'); });
    var notes = document.getElementById('sg-notes');
    return { refused: refused, checks: checks, notes: notes ? notes.value.trim() : '' };
  }

  function bindForm() {
    bindChoices();
    var canvas = document.getElementById('pad'), wrap = document.getElementById('pad-wrap'), ctx = canvas.getContext('2d');
    var drawing = false, last = null, ink = 0;
    function fit() {
      var r = canvas.getBoundingClientRect(), ratio = Math.max(1, window.devicePixelRatio || 1);
      canvas.width = Math.round(r.width * ratio); canvas.height = Math.round(r.height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.lineWidth = 1.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#082445';
      ink = 0; wrap.classList.remove('has-ink');
    }
    fit();
    window.addEventListener('resize', function () { if (!ink) fit(); });
    function pos(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    canvas.addEventListener('pointerdown', function (e) {
      e.preventDefault(); canvas.setPointerCapture(e.pointerId); drawing = true; last = pos(e);
      ctx.beginPath(); ctx.arc(last.x, last.y, 0.7, 0, 6.3); ctx.fillStyle = '#082445'; ctx.fill(); ink += 2; wrap.classList.add('has-ink');
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
        body: JSON.stringify({ name: name, agree: true, signature: canvas.toDataURL('image/png'), choices: collectChoices() })
      }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'Signature impossible.'); }); })
        .then(function () { return load().then(function () { window.scrollTo({ top: 0, behavior: 'smooth' }); }); })
        .catch(function (x) { btn.disabled = false; btn.textContent = 'Signer le contrat'; fail(x.message); });
    };
    btn.addEventListener('click', submit);
    document.getElementById('sign-form').addEventListener('submit', function (e) { e.preventDefault(); submit(); });
  }
})();
