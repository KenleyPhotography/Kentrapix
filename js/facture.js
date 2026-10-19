// Page publique d'une facture : le lien secret (?t=…) donne accès à cette seule facture, sans connexion.
(function () {
  'use strict';
  var sheet = document.getElementById('sheet');
  var token = (location.pathname.match(/^\/f\/([A-Za-z0-9_-]+)/) || [])[1] || new URLSearchParams(location.search).get('t') || '';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var money = function (n, cur) { try { return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: cur, minimumFractionDigits: 0, maximumFractionDigits: Number.isInteger(n) ? 0 : 2 }).format(n); } catch (e) { return n + ' ' + cur; } };
  var day = function (iso) { return iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '—'; };
  var STATUS = { paid: 'Payée', partial: 'Partiellement payée', unpaid: 'À payer', overdue: 'En retard', cancelled: 'Annulée' };
  var STAMP = { paid: 'Payée', overdue: 'En retard', cancelled: 'Annulée' };
  var METHOD = { especes: 'Espèces', moncash: 'MonCash', natcash: 'NatCash', virement: 'Virement', carte: 'Carte', cheque: 'Chèque', autre: 'Autre' };
  // Petites icônes de contact (traits, couleur du thème)
  var ICON = {
    cash: '<svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 10v.01M18 14v.01"/></svg>',
    card: '<svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20M6 15h4"/></svg>',
    file: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
    phone: '<svg viewBox="0 0 24 24"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/></svg>',
    chat: '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
    mail: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
    link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    cam: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="14" rx="3"/><circle cx="12" cy="13" r="3.5"/><path d="M8 6l1.5-2h5L16 6"/></svg>'
  };
  var initials = function (n) { return String(n || '').split(/\s+/).filter(Boolean).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase(); };

  document.getElementById('print').addEventListener('click', function () { window.print(); });
  if (!/^[A-Za-z0-9_-]{12,32}$/.test(token)) { sheet.innerHTML = '<p class="error">Lien de facture invalide.</p>'; return; }

  fetch('/api/invoice/' + encodeURIComponent(token), { headers: { Accept: 'application/json' }, cache: 'no-store' })
    .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Facture introuvable.'); return j; }); })
    .then(draw)
    .catch(function (e) { sheet.innerHTML = '<p class="error">' + esc(e.message) + '</p>'; });

  function payBox(f) {
    var p = f.studio.pay || {};
    if (f.balance <= 0 || f.status === 'cancelled' || (!p.moncash && !p.natcash)) return '';
    return '<div class="notes"><strong>Comment payer</strong><br>Envoyez ' + esc(money(f.balance, f.currency)) + ' par ' +
      [p.moncash && 'MonCash au ' + esc(p.moncash), p.natcash && 'NatCash au ' + esc(p.natcash)].filter(Boolean).join(' ou ') +
      ', avec la référence ' + esc(f.number) + '.' + (p.note ? '<br>' + esc(p.note) : '') + '</div>';
  }

  function draw(f) {
    var s = f.studio, cur = f.currency;
    document.title = 'Facture ' + f.number + ' — ' + s.name;
    var contacts = [
      s.phone && ICON.phone + '<a href="tel:' + esc(s.phone.replace(/[^0-9+]/g, '')) + '">' + esc(s.phone) + '</a>',
      s.whatsapp && ICON.chat + '<span>WhatsApp : <a href="https://wa.me/' + esc(s.whatsapp.replace(/[^0-9]/g, '')) + '" target="_blank" rel="noopener noreferrer">' + esc(s.whatsapp) + '</a></span>',
      s.email && ICON.mail + '<a href="mailto:' + esc(s.email) + '">' + esc(s.email) + '</a>',
      s.instagram && ICON.cam + '<a href="https://instagram.com/' + esc(s.instagram) + '" target="_blank" rel="noopener noreferrer">@' + esc(s.instagram) + '</a>',
      s.website && ICON.link + '<a href="' + esc(s.website) + '" target="_blank" rel="noopener noreferrer">' + esc(s.website.replace(/^https?:\/\//, '')) + '</a>',
      s.address && ICON.pin + '<span>' + esc(s.address) + '</span>'
    ].filter(Boolean).map(function (x) { return '<li>' + x + '</li>'; }).join('');

    var avatar = s.avatar
      ? '<img class="avatar" src="' + esc(s.avatar) + '" alt="">'
      : '<span class="avatar ini">' + esc(initials(s.name)) + '</span>';
    var pays = f.payments.length
      ? '<h3>Paiements reçus</h3><table><thead><tr><th>Date</th><th>Mode</th><th class="num">Montant</th></tr></thead><tbody>' +
        f.payments.map(function (p) { return '<tr><td>' + esc(day(p.paidAt)) + '</td><td>' + esc(METHOD[p.method] || p.method) + '</td><td class="num">' + esc(money(p.amount, cur)) + '</td></tr>'; }).join('') + '</tbody></table>'
      : '';
    var person = s.person && s.person !== s.name ? s.person : s.person || s.name;

    sheet.innerHTML =
      '<header class="band">' +
        '<div class="brand"><img src="/logo/kentrapix-icon.svg" alt="" width="46" height="46"><div><b>Kentra<span>Pix</span></b><small>Galeries photo privées</small></div></div>' +
        '<div class="docmeta"><h1><span class="fiche">' + ICON.file + '</span>Facture</h1><p><strong>' + esc(f.number) + '</strong></p><p>Émise le ' + esc(day(f.issuedAt)) + '</p></div>' +
      '</header>' +
      '<div class="body">' +
        (STAMP[f.status] ? '<div class="stamp ' + esc(f.status) + '">' + esc(STAMP[f.status]) + '</div>' : '') +
        '<div class="parties">' +
          '<section class="card"><h2>Photographe</h2><div class="who">' + avatar + '<div><strong>' + esc(s.name) + '</strong><span>' + (person ? 'Photographe : ' + esc(person) : '') + '</span></div></div>' +
          (contacts ? '<ul class="contacts">' + contacts + '</ul>' : '') + '</section>' +
          '<section class="card to"><h2>Facturé à</h2><strong>' + esc(f.client.name) + '</strong>' + (f.event ? '<p>Galerie : ' + esc(f.event) + '</p>' : '') + '<p><span class="badge ' + esc(f.status) + '">' + esc(STATUS[f.status] || f.status) + '</span></p></section>' +
        '</div>' +
        '<dl class="dates"><div><dt>Date d’émission</dt><dd>' + esc(day(f.issuedAt)) + '</dd></div><div><dt>Échéance</dt><dd>' + esc(day(f.dueDate)) + '</dd></div><div><dt>Paiement</dt><dd><span class="ptype ' + esc(f.paymentType) + '">' + (f.paymentType === 'cash' ? ICON.cash + 'Cash' : ICON.card + 'Crédit') + '</span>' + (f.paymentType === 'credit' && f.paid > 0 ? ' · avance ' + esc(money(f.paid, cur)) : '') + '</dd></div></dl>' +
        '<table><thead><tr><th>Description</th><th class="num">Montant</th></tr></thead><tbody><tr><td>' + esc(f.title) + '</td><td class="num">' + esc(money(f.total, cur)) + '</td></tr></tbody></table>' +
        '<div class="totals"><div><span>Total</span><strong>' + esc(money(f.total, cur)) + '</strong></div><div><span>Déjà payé</span><span>' + esc(money(f.paid, cur)) + '</span></div>' +
        '<div class="due' + (f.balance <= 0 ? ' zero' : '') + '"><span>' + (f.balance <= 0 ? 'Facture réglée' : 'Reste à payer') + '</span><span>' + esc(money(Math.max(0, f.balance), cur)) + '</span></div></div>' +
        pays +
        payBox(f) +
        (f.notes ? '<div class="notes">' + esc(f.notes) + '</div>' : '') +
        '<div class="sign"><div>' + (s.signature ? '<img class="sig-img" src="' + esc(s.signature) + '" alt="Signature du photographe">' : '') + '<strong>Le photographe</strong><span>' + esc(person || s.name) + '</span></div></div>' +
      '</div>';
  }
})();
