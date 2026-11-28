import { initApplication } from './application-steps.js';
import { initReservationSteps } from './reservation-steps.js';

export function initReservation(root = document, person = null) {
  const $ = (id) => root.querySelector('#' + id);
  if ($('year')) $('year').textContent = new Date().getFullYear();

  const photographer = $('photographer');
  const month = $('booking-month');
  const date = $('wish');
  const time = $('wishtime');
  const manual = $('manual-slot');
  const manualDate = $('manual-date');
  const manualTime = $('manual-time');
  const types = $('types');
  const send = $('send');
  const resetSteps = initReservationSteps($('form'));
  const msg = $('msg');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Port-au-Prince', year: 'numeric', month: '2-digit' }).formatToParts();
  manualDate.min = new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Port-au-Prince', year: 'numeric', month: '2-digit', day: '2-digit' }).format();
  month.value = month.min = ['year', 'month'].map(type => today.find(part => part.type === type).value).join('-');
  const frDate = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const selection = new URLSearchParams(location.search);
  let presetDate = selection.get('date');
  const presetTime = selection.get('heure');
  if (/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(presetDate || '') && presetDate.slice(0, 7) >= month.min) month.value = presetDate.slice(0, 7);
  let days = {};
  let request = 0;

  function options(select, entries, placeholder) {
    select.replaceChildren(new Option(placeholder, ''));
    for (const [value, label] of entries) select.add(new Option(label, value));
    select.disabled = !entries.length;
  }
  function syncSubmit() {
    send.disabled = !(photographer.value && !types.disabled && (manual.checked ? manualDate.value && manualTime.value : date.value && time.value));
  }
  function syncMode() {
    $('available-slots').hidden = manual.checked;
    $('manual-slots').hidden = !manual.checked;
    month.disabled = manual.checked;
    date.disabled = manual.checked || !Object.keys(days).length;
    time.disabled = manual.checked || !(days[date.value] || []).length;
    manualDate.disabled = manualTime.disabled = !manual.checked;
    syncSubmit();
  }
  function syncTime() {
    options(time, (days[date.value] || []).map(hour => [hour, hour]), 'Choisir…');
    syncMode();
  }
  async function loadCalendar() {
    const id = ++request;
    days = {};
    syncTime();
    options(date, [], 'Aucune date');
    options(types, [], 'Choisir…');
    syncSubmit();
    if (!month.value || !photographer.value) return;
    msg.className = 'pf-msg';
    msg.textContent = 'Chargement des disponibilités…';
    try {
      const response = await fetch('/api/public/reservation/' + encodeURIComponent(photographer.value) + '?month=' + encodeURIComponent(month.value));
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (id !== request) return;
      days = data.days;
      options(date, Object.keys(days).map(day => [day, frDate.format(new Date(day + 'T12:00:00Z'))]), 'Choisir…');
      options(types, data.sessionTypes.map(type => [type, type]), 'Choisir…');
      if (presetDate && days[presetDate]?.includes(presetTime)) {
        date.value = presetDate;
        syncTime();
        time.value = presetTime;
        send.disabled = false;
      }
      presetDate = null;
      syncPlace();
      syncMode();
      msg.textContent = Object.keys(days).length ? '' : 'Aucun créneau ce mois-ci. Choisissez un autre mois.';
    } catch {
      if (id === request) msg.textContent = 'Impossible de charger les disponibilités.';
    }
  }
  photographer.addEventListener('change', loadCalendar);
  month.addEventListener('change', loadCalendar);
  date.addEventListener('change', syncTime);
  time.addEventListener('change', syncSubmit);
  manual.addEventListener('change', syncMode);
  manualDate.addEventListener('input', syncSubmit);
  manualTime.addEventListener('input', syncSubmit);
  if (person) {
    options(photographer, [[person.id, person.name]], 'Choisir…');
    photographer.value = person.id;
    photographer.closest('label').hidden = true;
    loadCalendar();
  } else {
    fetch('/api/public/public-services').then(response => {
      if (!response.ok) throw new Error();
      return response.json();
    }).then(({ photographers }) => {
      options(photographer, photographers.map(person => [person.id, person.name]), 'Choisir…');
      if (photographers.length) {
        const selected = new URLSearchParams(location.search).get('photographe');
        photographer.value = photographers.find(person => person.id === selected)?.id || photographers[0].id;
        loadCalendar();
      } else msg.textContent = 'Aucun photographe ne reçoit de réservations actuellement.';
    }).catch(() => { msg.textContent = 'Impossible de charger les photographes.'; });
  }

  // Lieu de la séance selon le type : portrait et shoot studio se passent toujours au studio ;
  // l'anniversaire a le choix (studio ou ailleurs) ; le shoot dehors peut rester « à déterminer » ;
  // graduation, mariage, baptême, autre : la personne doit dire où.
  var AT_STUDIO = 'Au studio', TBD = 'Lieu à déterminer';
  function placeKind(t) {
    if (!t) return '';
    if (/portrait|studio/i.test(t)) return 'studio';
    if (/anniv|birthday/i.test(t)) return 'choice';
    if (/outdoor|ext[ée]rieur|dehors|plein air/i.test(t)) return 'outdoor';
    return 'away';
  }
  var pickedStudio = function () { return $('placePick').querySelector('input[value="studio"]').checked; };
  // Lieu envoyé au studio : « Au studio », « Lieu à déterminer » ou l'adresse écrite.
  function placeValue() {
    var kind = placeKind($('types').value);
    if (kind === 'studio' || (kind === 'choice' && pickedStudio())) return AT_STUDIO;
    if (kind === 'outdoor' && $('placeTbd').checked) return TBD;
    return String($('place').value || '').trim();
  }
  function syncPlace() {
    var kind = placeKind($('types').value);
    var studio = kind === 'studio' || (kind === 'choice' && pickedStudio());
    var tbd = kind === 'outdoor' && $('placeTbd').checked;
    var ask = !!kind && !studio && !tbd;
    $('placePick').hidden = kind !== 'choice';
    $('placeTbdRow').hidden = kind !== 'outdoor';
    if (kind !== 'outdoor') $('placeTbd').checked = false;
    $('placeRow').hidden = !ask; $('place').required = ask;
    if (!ask) $('place').value = '';
    $('placeHint').textContent = kind === 'studio' ? 'Cette séance se passe au studio.'
      : kind === 'outdoor' ? 'Shoot dehors : dites où, ou cochez « à déterminer » si ce n’est pas encore décidé.' : '';
    $('placeHint').hidden = !$('placeHint').textContent;
  }
  $('types').addEventListener('change', syncPlace);
  $('placePick').addEventListener('change', syncPlace);
  $('placeTbd').addEventListener('change', syncPlace);
  syncPlace();
  const application = $('photographer-application');
  if (application) initPhotographerApplication(application);

  function showPayment(payment) {
    const box = $('payment-details');
    box.replaceChildren();
    box.hidden = !payment;
    if (!payment) return;
    const lines = [
      ['h2', 'Acompte de réservation'],
      ['p', payment.amount + ' HTG'],
      ...[['MonCash', payment.moncash], ['NatCash', payment.natcash]].filter(([, number]) => number).map(([method, number]) => ['p', method + ' · ' + number]),
      ['p', 'Code à inscrire dans la description du transfert :'],
      ['strong', payment.code],
      ['p', 'Conservez ce code. Le propriétaire vérifiera le transfert.'],
    ];
    for (const [tag, text] of lines) {
      const item = document.createElement(tag);
      item.textContent = text;
      box.append(item);
    }
    box.scrollIntoView({ block: 'nearest' });
  }

  $('form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, msg = $('msg'), btn = $('send');
    var data = {}; new FormData(f).forEach(function (v, k) { data[k] = v; });
    if (manual.checked) Object.assign(data, { date: manualDate.value, time: manualTime.value, manual: true });
    if (!data.name || String(data.phone || '').replace(/\D/g, '').length < 6) { msg.className = 'pf-msg err'; msg.textContent = 'Entrez votre nom et votre numéro de téléphone.'; return; }
    if (!data.sessionType) { msg.className = 'pf-msg err'; msg.textContent = 'Choisissez le type de séance.'; return; }
    delete data.placeMode; data.location = placeValue();
    if (!data.location) { msg.className = 'pf-msg err'; msg.textContent = 'Indiquez le lieu de la séance.'; $('place').focus(); return; }
    if (!data.staffId || !data.date || !data.time) { msg.className = 'pf-msg err'; msg.textContent = 'Choisissez aussi l’heure souhaitée.'; return; }
    btn.disabled = true; msg.className = 'pf-msg'; msg.textContent = 'Envoi…';
    fetch('/api/public/inquiry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (r) {
        if (r.ok) { showPayment(r.j.payment); const staff = photographer.value; f.reset(); resetSteps(); photographer.value = staff; syncTime(); syncPlace(); msg.className = 'pf-msg ok'; msg.textContent = 'Votre demande a été envoyée. '; if (r.j.tracking) { const link = document.createElement('a'); link.href = r.j.tracking; link.textContent = 'Suivre ma réservation'; msg.append(link); } }
        else { msg.className = 'pf-msg err'; msg.textContent = (r.j && (r.j.error || r.j.message)) || 'Envoi impossible. Écrivez-nous sur WhatsApp.'; }
      })
      .catch(function () { msg.className = 'pf-msg err'; msg.textContent = 'Connexion impossible. Réessayez.'; })
      .then(function () { syncSubmit(); });
  });
}

if (document.body.classList.contains('reservation-page')) initReservation();

export function initPhotographerApplication(form) {
  initApplication(form, async () => {
    const response = await fetch('/api/public/photographer-applications/payment');
    if (!response.ok) throw new Error('Impossible de charger les moyens de paiement.');
    return (await response.json()).payment;
  }, async data => {
    const response = await fetch('/api/public/photographer-applications', {
      method: 'POST', body: Object.entries(data).reduce((body, [key, value]) => { body.append(key, value); return body; }, new FormData()),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || 'Impossible d’envoyer la candidature.');
    }
    return response.json();
  });}
