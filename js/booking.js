// Rendez-vous : le client choisit un jour et une heure ; le photographe confirme, bloque des jours et règle ses horaires.
import { api, escape, hello } from './service.js';
import { icon } from './icons.js';
import { waBtn, firstName, siteUrl } from './whatsapp.js';

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const WEEK = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const DAYS_LONG = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const STATUS = { pending: 'En attente', confirmed: 'Confirmé', declined: 'Refusé', cancelled: 'Annulé', proposed: 'Autre date proposée' };
const fday = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const pill = (s) => `<span class="bk-pill is-${s}">${STATUS[s] || s}</span>`;
const ym = (y, m) => `${y}-${String(m + 1).padStart(2, '0')}`;
const pad = (n) => String(n).padStart(2, '0');

/** Grille d'un mois : cellules { day: 'YYYY-MM-DD' | null }, la semaine commence le lundi. */
function grid(year, month) {
  const first = new Date(Date.UTC(year, month, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells = Array(lead).fill({ day: null });
  for (let d = 1; d <= count; d += 1) cells.push({ day: `${year}-${pad(month + 1)}-${pad(d)}`, n: d });
  while (cells.length % 7) cells.push({ day: null });
  return cells;
}

const monthNav = (year, month, canPrev) => `<div class="bk-month"><button type="button" class="btn sm icon-btn" data-bk-prev ${canPrev ? '' : 'disabled'} aria-label="Mois précédent">‹</button><strong>${MONTHS[month]} ${year}</strong><button type="button" class="btn sm icon-btn" data-bk-next aria-label="Mois suivant">›</button></div>`;

// ====================================================================================================
//  Espace client
// ====================================================================================================
export const clientBookingPage = () => '<div class="greeting"><h1>Rendez-vous</h1></div><div id="bk-root"><div class="empty small"><p>Chargement…</p></div></div>';

export async function bindClientBooking({ toast }) {
  const root = document.getElementById('bk-root');
  if (!root) return;
  let data;
  try { data = await api('/api/client/booking'); } catch (e) { root.innerHTML = `<div class="empty"><h2>${escape(e.message)}</h2></div>`; return; }
  const open = data.photographers.filter((p) => p.open);
  const now = new Date(`${data.today}T12:00:00Z`);
  const st = { staffId: open[0]?.id || null, year: now.getUTCFullYear(), month: now.getUTCMonth(), days: {}, day: null, slot: null, loading: false };

  const load = async () => {
    if (!st.staffId) return;
    st.loading = true; draw();
    try { st.days = (await api(`/api/client/booking/${st.staffId}/month?month=${ym(st.year, st.month)}`)).days; } catch (e) { toast(e.message); st.days = {}; }
    st.loading = false; draw();
  };

  const mine = () => {
    const list = data.bookings.filter((b) => b.day >= data.today || b.status === 'pending');
    if (!list.length) return '';
    return `<section class="settings bill-block"><h2>Mes rendez-vous</h2><ul class="rem-list">${list.map((b) => `<li class="rem-row"><span class="rem-ico">${icon('events')}</span><div><strong style="text-transform:capitalize">${escape(fday(b.day))}</strong><span>${escape(b.start)} – ${escape(b.end)}${b.sessionType ? ` · ${escape(b.sessionType)}` : ''} · ${escape(b.staff?.name || '')}${b.reply ? ` · « ${escape(b.reply)} »` : ''}</span>${b.status === 'proposed' && b.originalDay ? `<span>Vous aviez demandé : ${escape(fday(b.originalDay))}, ${escape(b.originalStart || '')}</span>` : ''}</div><div class="actions">${pill(b.status)}${b.status === 'proposed' ? `<button type="button" class="btn sm primary" data-bk-yes="${b.id}">Accepter</button><button type="button" class="btn sm" data-bk-no="${b.id}">Refuser</button>` : ''}${['pending', 'confirmed'].includes(b.status) ? `<button type="button" class="btn sm" data-bk-cancel="${b.id}">Annuler</button>` : ''}</div></li>`).join('')}</ul></section>`;
  };

  const draw = () => {
    if (!data.photographers.length) {
      root.innerHTML = `<div class="empty">${icon('events')}<h2>Aucun photographe pour le moment</h2><p class="small">Ajoutez le code de votre photographe dans « Mes photographes » pour réserver un rendez-vous.</p></div>`;
      return;
    }
    if (!open.length) {
      root.innerHTML = `${mine()}<div class="empty">${icon('events')}<h2>Les réservations ne sont pas encore ouvertes</h2><p class="small">Votre photographe n’a pas encore ouvert de créneaux. Revenez bientôt ou écrivez-lui directement.</p></div>`;
      wire(); return;
    }
    const p = open.find((x) => x.id === st.staffId) || open[0];
    const todayY = now.getUTCFullYear(); const todayM = now.getUTCMonth();
    const canPrev = st.year > todayY || (st.year === todayY && st.month > todayM);
    const cells = grid(st.year, st.month).map((c) => {
      if (!c.day) return '<span class="bk-cell is-empty"></span>';
      const free = st.days[c.day];
      return `<button type="button" class="bk-cell ${free ? 'is-free' : ''} ${st.day === c.day ? 'is-picked' : ''} ${c.day === data.today ? 'is-today' : ''}" ${free ? `data-bk-day="${c.day}"` : 'disabled'} ${free ? `aria-label="${escape(fday(c.day))}, ${free.length} créneaux"` : ''}>${c.n}</button>`;
    }).join('');
    const slots = st.day ? (st.days[st.day] || []) : [];
    root.innerHTML = `${mine()}
      <section class="settings bill-block bk-book">
        <h2>Réserver une séance</h2>
        ${open.length > 1 ? `<label>Photographe<select id="bk-staff">${open.map((x) => `<option value="${x.id}" ${x.id === p.id ? 'selected' : ''}>${escape(x.name)}</option>`).join('')}</select></label>` : `<p class="small">${icon('camera')} ${escape(p.name)} · séance de ${Math.round(p.durationMin / 60 * 10) / 10} h</p>`}
        ${monthNav(st.year, st.month, canPrev)}
        <div class="bk-week">${WEEK.map((w) => `<span>${w}</span>`).join('')}</div>
        <div class="bk-grid ${st.loading ? 'is-loading' : ''}">${cells}</div>
        ${Object.keys(st.days).length || st.loading ? '' : '<p class="small bk-none">Aucun créneau libre ce mois-ci. Essayez le mois suivant.</p>'}
        ${st.day ? `<div class="bk-slots"><strong style="text-transform:capitalize">${escape(fday(st.day))}</strong><div class="bk-chips">${slots.map((s) => `<button type="button" class="chip ${st.slot === s ? 'active' : ''}" data-bk-slot="${s}">${s}</button>`).join('')}</div></div>` : ''}
        ${st.day && st.slot ? `<form id="bk-form" class="bk-form">
          ${p.sessionTypes.length ? `<label>Type de séance<select name="sessionType">${p.sessionTypes.map((t) => `<option>${escape(t)}</option>`).join('')}</select></label>` : ''}
          <label>Message <input name="note" maxlength="500" placeholder="Lieu, nombre de personnes…"></label>
          <button class="btn primary">${icon('check')} ${p.autoConfirm ? 'Réserver' : 'Envoyer ma demande'} · ${escape(st.slot)}</button></form>` : ''}
      </section>`;
    wire();
  };

  const wire = () => {
    root.querySelector('#bk-staff')?.addEventListener('change', (e) => { st.staffId = e.target.value; st.day = null; st.slot = null; load(); });
    root.querySelector('[data-bk-prev]')?.addEventListener('click', () => { st.month -= 1; if (st.month < 0) { st.month = 11; st.year -= 1; } st.day = null; st.slot = null; load(); });
    root.querySelector('[data-bk-next]')?.addEventListener('click', () => { st.month += 1; if (st.month > 11) { st.month = 0; st.year += 1; } st.day = null; st.slot = null; load(); });
    root.querySelectorAll('[data-bk-day]').forEach((b) => b.addEventListener('click', () => { st.day = b.dataset.bkDay; st.slot = null; draw(); }));
    root.querySelectorAll('[data-bk-slot]').forEach((b) => b.addEventListener('click', () => { st.slot = b.dataset.bkSlot; draw(); root.querySelector('#bk-form')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }));
    root.querySelectorAll('[data-bk-yes],[data-bk-no]').forEach((b) => b.addEventListener('click', async () => {
      const accept = b.hasAttribute('data-bk-yes'); const id = b.getAttribute(accept ? 'data-bk-yes' : 'data-bk-no');
      if (!accept && !confirm('Refuser cette nouvelle date ? Le rendez-vous sera annulé.')) return;
      try { await api(`/api/client/booking/${id}/respond`, { method: 'POST', body: { accept } }); data = await api('/api/client/booking'); toast(accept ? 'Rendez-vous confirmé pour la nouvelle date.' : 'Nouvelle date refusée.'); await load(); } catch (e) { toast(e.message); }
    }));
    root.querySelectorAll('[data-bk-cancel]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Annuler ce rendez-vous ?')) return;
      try { await api(`/api/client/booking/${b.dataset.bkCancel}`, { method: 'DELETE' }); data = await api('/api/client/booking'); toast('Rendez-vous annulé.'); draw(); } catch (e) { toast(e.message); }
    }));
    root.querySelector('#bk-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(e.target)); const btn = e.target.querySelector('.btn.primary'); btn.disabled = true;
      try {
        const r = await api('/api/client/booking', { method: 'POST', body: { staffId: st.staffId, day: st.day, start: st.slot, sessionType: v.sessionType || '', note: v.note || '' } });
        toast(r.booking.status === 'confirmed' ? 'Rendez-vous confirmé !' : 'Demande envoyée : votre photographe va la confirmer.');
        st.day = null; st.slot = null; data = await api('/api/client/booking'); await load();
      } catch (err) { toast(err.message); btn.disabled = false; await load(); }
    });
  };

  if (open.length) await load(); else draw();
}

// ====================================================================================================
//  Studio
// ====================================================================================================
export const adminBookingPage = () => '<div class="greeting"><h1>Rendez-vous</h1></div><div id="bka-root"><div class="empty small"><p>Chargement…</p></div></div>';

export async function bindAdminBooking({ toast, modal, clients }) {
  const root = document.getElementById('bka-root');
  if (!root) return;
  let d;
  try { d = await api('/api/admin/booking'); } catch (e) { root.innerHTML = `<div class="empty"><h2>${escape(e.message)}</h2></div>`; return; }
  const now = new Date(`${d.today}T12:00:00Z`);
  const st = { year: now.getUTCFullYear(), month: now.getUTCMonth(), day: null };
  const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message); } };
  const reload = async () => { d = await api('/api/admin/booking'); draw(); };

  const pendingHtml = () => {
    const list = d.bookings.filter((b) => b.status === 'pending' && b.day >= d.today);
    if (!list.length) return '';
    return `<section class="settings bill-block"><h2>Demandes à confirmer <span class="count-pill">${list.length}</span></h2><ul class="rem-list">${list.map((b) => `<li class="rem-row is-late"><span class="rem-ico">${icon('bell')}</span><div><strong>${escape(b.client.name)}</strong><span style="text-transform:capitalize">${escape(fday(b.day))}</span><span>${escape(b.start)} – ${escape(b.end)}${b.sessionType ? ` · ${escape(b.sessionType)}` : ''}${b.note ? ` · « ${escape(b.note)} »` : ''}</span></div><div class="actions"><button type="button" class="btn sm primary" data-bka-ok="${b.id}">Confirmer</button><button type="button" class="btn sm" data-bka-no="${b.id}">Refuser</button>${waBtn(b.client.whatsapp, `${hello()} ${firstName(b.client.name)}, à propos de votre demande de rendez-vous du ${fday(b.day)} à ${b.start}.`)}</div></li>`).join('')}</ul></section>`;
  };

  const calendarHtml = () => {
    const key = ym(st.year, st.month);
    const byDay = {};
    for (const b of d.bookings) if (b.day.startsWith(key) && ['pending', 'confirmed', 'proposed'].includes(b.status)) (byDay[b.day] ??= []).push(b);
    const cells = grid(st.year, st.month).map((c) => {
      if (!c.day) return '<span class="bk-cell is-empty"></span>';
      const list = byDay[c.day] || []; const blocked = d.blocked.includes(c.day);
      return `<button type="button" class="bk-cell bk-adm ${list.length ? 'has-bk' : ''} ${blocked ? 'is-blocked' : ''} ${st.day === c.day ? 'is-picked' : ''} ${c.day === d.today ? 'is-today' : ''}" data-bka-day="${c.day}">${c.n}${list.length ? `<i>${list.length}</i>` : ''}</button>`;
    }).join('');
    const sel = st.day;
    const dayList = sel ? d.bookings.filter((b) => b.day === sel && ['pending', 'confirmed', 'proposed'].includes(b.status)) : [];
    return `<section class="settings bill-block"><h2>Calendrier</h2>${monthNav(st.year, st.month, true)}<div class="bk-week">${WEEK.map((w) => `<span>${w}</span>`).join('')}</div><div class="bk-grid">${cells}</div>
      <p class="small bk-legend"><span class="bk-dot has"></span> rendez-vous <span class="bk-dot blk"></span> jour bloqué</p>
      ${sel ? `<div class="bk-slots"><strong style="text-transform:capitalize">${escape(fday(sel))}</strong>
        ${dayList.length ? `<ul class="rem-list">${dayList.map((b) => `<li class="rem-row"><span class="rem-ico">${icon('clock')}</span><div><strong>${escape(b.start)} – ${escape(b.end)} · ${escape(b.client.name)}</strong><span>${escape(b.sessionType || '')}${b.client.whatsapp ? ` · ${escape(b.client.whatsapp)}` : ''}</span></div><div class="actions">${pill(b.status)}${waBtn(b.client.whatsapp, `${hello()} ${firstName(b.client.name)}, rappel de votre rendez-vous le ${fday(b.day)} à ${b.start}. À bientôt !`, 'Rappeler par WhatsApp')}<button type="button" class="btn sm" data-bka-cancel="${b.id}">Annuler</button></div></li>`).join('')}</ul>` : '<p class="small">Aucun rendez-vous ce jour-là.</p>'}
        <div class="row"><button type="button" class="btn sm" data-bka-toggle="${sel}">${d.blocked.includes(sel) ? 'Débloquer ce jour' : 'Bloquer ce jour'}</button><button type="button" class="btn sm" data-bka-add="${sel}">${icon('plus')} Ajouter un rendez-vous</button></div></div>` : '<p class="small">Touchez un jour pour le bloquer ou voir ses rendez-vous.</p>'}
      </section>`;
  };

  const settingsHtml = () => {
    const s = d.settings;
    return `<section class="settings bill-block"><h2>Mes disponibilités</h2>
      <form id="bka-form" class="bk-form">
        <label class="share-toggle"><span><strong>Réservations ouvertes</strong></span><input class="switch" type="checkbox" name="enabled" ${s.enabled ? 'checked' : ''}></label>
        <div class="bk-days" role="group" aria-label="Jours ouverts">${[1, 2, 3, 4, 5, 6, 0].map((n) => `<label class="chip ${s.days.includes(n) ? 'active' : ''}"><input type="checkbox" name="day" value="${n}" ${s.days.includes(n) ? 'checked' : ''} hidden>${DAYS_LONG[n].slice(0, 3)}</label>`).join('')}</div>
        <div class="row2"><label>De<input type="time" name="start" value="${s.start}" required></label><label>À<input type="time" name="end" value="${s.end}" required></label></div>
        <div class="row2"><label>Durée d’une séance (min)<input type="number" name="durationMin" min="15" max="720" step="15" value="${s.durationMin}" required></label><label>Prévenir au moins (jours)<input type="number" name="minNoticeDays" min="0" max="60" value="${s.minNoticeDays}" required></label></div>
        <div class="row2"><label>Réservable jusqu’à (jours)<input type="number" name="horizonDays" min="1" max="365" value="${s.horizonDays}" required></label><label>Types de séance<input name="sessionTypes" value="${escape(s.sessionTypes.join(', '))}" maxlength="400"></label></div>
        <label class="share-toggle"><span><strong>Confirmer automatiquement</strong></span><input class="switch" type="checkbox" name="autoConfirm" ${s.autoConfirm ? 'checked' : ''}></label>
        <button class="btn primary">${icon('check')} Enregistrer</button></form></section>`;
  };

  const draw = () => {
    root.innerHTML = `${pendingHtml()}${calendarHtml()}${settingsHtml()}`;
    root.querySelector('[data-bk-prev]')?.addEventListener('click', () => { st.month -= 1; if (st.month < 0) { st.month = 11; st.year -= 1; } draw(); });
    root.querySelector('[data-bk-next]')?.addEventListener('click', () => { st.month += 1; if (st.month > 11) { st.month = 0; st.year += 1; } draw(); });
    root.querySelectorAll('[data-bka-day]').forEach((b) => b.addEventListener('click', () => { st.day = b.dataset.bkaDay; draw(); }));
    root.querySelectorAll('[data-bka-ok]').forEach((b) => { b.onclick = guard(async () => { b.disabled = true; await api(`/api/admin/booking/bookings/${b.dataset.bkaOk}`, { method: 'PATCH', body: { status: 'confirmed' } }); toast('Rendez-vous confirmé : le client est prévenu.'); await reload(); }); });
    root.querySelectorAll('[data-bka-no]').forEach((b) => { b.onclick = () => {
      const id = b.dataset.bkaNo; const bk = d.bookings.find((x) => x.id === id);
      modal('Refuser ce créneau', `<p class="small">${escape(bk.client.name)} · ${escape(fday(bk.day))}, ${escape(bk.start)}</p>
        <label class="share-toggle"><span><strong>Proposer une autre date</strong></span><input class="switch" type="checkbox" name="propose" id="bka-propose" checked></label>
        <div id="bka-prop" class="row2"><label>Date<input type="date" name="pday" min="${d.today}" value="${bk.day}" required></label><label>Heure<input type="time" name="pstart" value="${bk.start}" required></label></div>
        <label>Message <span class="optional">(facultatif)</span><input name="reply" maxlength="500" placeholder="Ex. Je suis pris ce jour-là, je vous propose…"></label>`,
      async (v) => {
        const body = { status: 'declined', reply: v.reply || '' };
        if (v.propose === 'on') body.proposal = { day: v.pday, start: v.pstart };
        await api(`/api/admin/booking/bookings/${id}`, { method: 'PATCH', body });
        toast(body.proposal ? 'Nouvelle date proposée : le client est prévenu.' : 'Demande refusée : le client est prévenu.'); await reload();
      }, { submit: 'Envoyer' });
      const host = document.getElementById('overlays');
      const sync = () => { const on = host.querySelector('#bka-propose').checked; host.querySelector('#bka-prop').hidden = !on; host.querySelectorAll('#bka-prop input').forEach((i) => { i.disabled = !on; }); };
      host.querySelector('#bka-propose').addEventListener('change', sync); sync();
    }; });
    root.querySelectorAll('[data-bka-cancel]').forEach((b) => { b.onclick = guard(async () => {
      if (!confirm('Annuler ce rendez-vous ? Le client sera prévenu.')) return;
      await api(`/api/admin/booking/bookings/${b.dataset.bkaCancel}`, { method: 'PATCH', body: { status: 'cancelled' } }); await reload();
    }); });
    root.querySelector('[data-bka-toggle]')?.addEventListener('click', guard(async (e) => {
      const day = e.currentTarget.dataset.bkaToggle;
      if (d.blocked.includes(day)) await api(`/api/admin/booking/blocked/${day}`, { method: 'DELETE' }); else await api('/api/admin/booking/blocked', { method: 'POST', body: { day } });
      await reload();
    }));
    root.querySelector('[data-bka-add]')?.addEventListener('click', () => {
      const day = st.day; const list = clients();
      if (!list.length) return toast('Ajoutez d’abord un client.');
      modal('Ajouter un rendez-vous', `<label>Client<select name="clientId">${list.map((c) => `<option value="${c.id}">${escape(c.name)}</option>`).join('')}</select></label><label>Heure<input type="time" name="start" value="${d.settings.start}" required></label><label>Type de séance <span class="optional">(facultatif)</span><input name="sessionType" maxlength="80"></label>`,
        async (v) => { await api('/api/admin/booking/bookings', { method: 'POST', body: { clientId: v.clientId, day, start: v.start, sessionType: v.sessionType || '' } }); toast('Rendez-vous ajouté.'); await reload(); }, { submit: 'Ajouter' });
    });
    root.querySelectorAll('.bk-days .chip').forEach((c) => c.addEventListener('click', (e) => { e.preventDefault(); const i = c.querySelector('input'); i.checked = !i.checked; c.classList.toggle('active', i.checked); }));
    root.querySelector('#bka-form')?.addEventListener('submit', guard(async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const body = {
        enabled: f.get('enabled') === 'on', days: f.getAll('day').map(Number), start: f.get('start'), end: f.get('end'),
        durationMin: Number(f.get('durationMin')), minNoticeDays: Number(f.get('minNoticeDays')), horizonDays: Number(f.get('horizonDays')),
        autoConfirm: f.get('autoConfirm') === 'on', sessionTypes: String(f.get('sessionTypes')).split(',').map((x) => x.trim()).filter(Boolean),
      };
      if (!body.sessionTypes.length) body.sessionTypes = ['Séance'];
      d.settings = (await api('/api/admin/booking/settings', { method: 'PUT', body })).settings; toast('Disponibilités enregistrées.'); draw();
    }));
  };
  draw();
}
