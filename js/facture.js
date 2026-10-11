// Page publique d'une facture : le lien secret (?t=…) donne accès à cette seule facture, sans connexion.
(function () {
  'use strict';
  var sheet = document.getElementById('sheet');
  var token = new URLSearchParams(location.search).get('t') || '';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var money = function (n, cur) { try { return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: cur }).format(n); } catch (e) { return n + ' ' + cur; } };
  var day = function (iso) { return iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : ''; };
  var STATUS = { paid: 'Payée', partial: 'Partiellement payée', unpaid: 'À payer', overdue: 'En retard', cancelled: 'Annulée' };
  var METHOD = { especes: 'Espèces', moncash: 'MonCash', natcash: 'NatCash', virement: 'Virement', carte: 'Carte', cheque: 'Chèque', autre: 'Autre' };

  document.getElementById('print').addEventListener('click', function () { window.print(); });

  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) { sheet.innerHTML = '<p class="error">Lien de facture invalide.</p>'; return; }

  fetch('/api/invoice/' + encodeURIComponent(token), { headers: { Accept: 'application/json' }, cache: 'no-store' })
    .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Facture introuvable.'); return j; }); })
    .then(draw)
    .catch(function (e) { sheet.innerHTML = '<p class="error">' + esc(e.message) + '</p>'; });

  function draw(f) {
    var s = f.studio, cur = f.currency;
    document.title = 'Facture ' + f.number + ' — ' + s.name;
    var contact = [
      s.phone && 'Tél. : <a href="tel:' + esc(s.phone.replace(/[^0-9+]/g, '')) + '">' + esc(s.phone) + '</a>',
      s.whatsapp && 'WhatsApp : <a href="https://wa.me/' + esc(s.whatsapp.replace(/[^0-9]/g, '')) + '" target="_blank" rel="noopener noreferrer">' + esc(s.whatsapp) + '</a>',
      s.email && 'E-mail : <a href="mailto:' + esc(s.email) + '">' + esc(s.email) + '</a>',
      s.website && '<a href="' + esc(s.website) + '" target="_blank" rel="noopener noreferrer">' + esc(s.website) + '</a>',
      s.address && esc(s.address)
    ].filter(Boolean).join('<br>');
    var pays = f.payments.length
      ? '<h3>Paiements reçus</h3><table><thead><tr><th>Date</th><th>Mode</th><th class="num">Montant</th></tr></thead><tbody>' +
        f.payments.map(function (p) { return '<tr><td>' + esc(day(p.paidAt)) + '</td><td>' + esc(METHOD[p.method] || p.method) + '</td><td class="num">' + esc(money(p.amount, cur)) + '</td></tr>'; }).join('') + '</tbody></table>'
      : '';
    sheet.innerHTML =
      '<div class="top"><div><div class="brand">Kentra<b>Pix</b></div><div class="studio"><strong>' + esc(s.name) + '</strong></div></div>' +
      '<div class="meta"><h1>Facture</h1><p><strong>' + esc(f.number) + '</strong></p><p>Émise le ' + esc(day(f.issuedAt)) + '</p>' +
      (f.dueDate ? '<p>Échéance : ' + esc(day(f.dueDate)) + '</p>' : '') +
      '<span class="badge ' + esc(f.status) + '">' + esc(STATUS[f.status] || f.status) + '</span></div></div>' +
      '<div class="parties"><div><h2>Facturé à</h2><p>' + esc(f.client.name) + '</p></div>' + (f.event ? '<div><h2>Galerie</h2><p>' + esc(f.event) + '</p></div>' : '') + '</div>' +
      '<table><thead><tr><th>Description</th><th class="num">Montant</th></tr></thead><tbody><tr><td>' + esc(f.title) + '</td><td class="num">' + esc(money(f.total, cur)) + '</td></tr></tbody></table>' +
      '<div class="totals"><div><span>Total</span><strong>' + esc(money(f.total, cur)) + '</strong></div><div><span>Déjà payé</span><span>' + esc(money(f.paid, cur)) + '</span></div>' +
      '<div class="due' + (f.balance <= 0 ? ' zero' : '') + '"><span>' + (f.balance <= 0 ? 'Facture réglée' : 'Reste à payer') + '</span><span>' + esc(money(Math.max(0, f.balance), cur)) + '</span></div></div>' +
      pays +
      (f.notes ? '<div class="notes">' + esc(f.notes) + '</div>' : '') +
      (contact ? '<div class="contact"><strong>Pour payer ou poser une question :</strong><br>' + contact + '</div>' : '') +
      '<p class="foot">Facture générée avec KentraPix.</p>';
  }
})();
