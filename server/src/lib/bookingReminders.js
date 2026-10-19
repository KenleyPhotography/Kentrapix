import { query } from '../db.js';
import { sendMail } from './mailer.js';
import { pushTo } from './push.js';
import { bookingReminderEmail, deliveryReminderEmail } from './emails.js';
import { BOOKING_SELECT, mapBooking, studioToday, addDays, minutesOf, STUDIO_TZ } from './booking.js';

// Rappel la veille : un e-mail et une notification sur téléphone au client et au photographe pour chaque rendez-vous confirmé du lendemain.
// Vérifié au démarrage puis toutes les heures ; un seul rappel par rendez-vous (reminded_at).
const EVERY = 60 * 60 * 1000;

export async function sendBookingReminders() {
  const tomorrow = addDays(studioToday(), 1);
  const rows = await query(`${BOOKING_SELECT} WHERE b.status = 'confirmed' AND b.reminded_at IS NULL AND b.day = ?`, [tomorrow]);
  let sent = 0;
  for (const row of rows) {
    const booking = mapBooking(row);
    const [staff] = await query('SELECT id, name, sender_name, email FROM users WHERE id = ?', [row.staff_id]);
    const studio = row.staff_name;
    const results = [];
    if (row.client_email) {
      results.push(await sendMail({
        to: row.client_email, userId: row.client_id, sentBy: row.staff_id, kind: 'booking', fromName: studio, replyTo: staff?.email || null,
        ...bookingReminderEmail({ name: row.client_name, studio, booking }),
      }));
    }
    if (staff?.email) {
      results.push(await sendMail({
        to: staff.email, userId: staff.id, kind: 'booking',
        ...bookingReminderEmail({ name: staff.name, studio, booking, forStaff: true, clientName: row.client_name }),
      }));
    }
    const note = { title: 'Rappel : rendez-vous demain', body: `${booking.start} – ${booking.end}`, tag: `booking-${row.id}` };
    const p1 = row.client_id ? await pushTo(row.client_id, { ...note, body: `${studio} · ${booking.start} – ${booking.end}`, url: '/client' }) : { sent: 0 };
    const p2 = { sent: 0 }; // la notification du photographe est envoyée par sendStaffReminders (2 jours avant, la veille, le jour même, 1 h avant)
    // Au moins un e-mail parti : rappel fait. Sinon (e-mails non configurés ou échec) on réessaiera.
    if (results.some((r) => r.status === 'sent') || p1.sent || p2.sent) {
      await query('UPDATE bookings SET reminded_at = CURRENT_TIMESTAMP WHERE id = ?', [row.id]);
      sent += 1;
    }
  }
  return sent;
}

// ---------- Rappels du photographe : 2 jours avant, la veille, le jour même (matin), puis 1 heure avant ----------
// Pour chaque rendez-vous confirmé (et chaque demande du portfolio acceptée avec une heure), une notification par étape.
const STAGES = { d2: 'dans 2 jours', d1: 'demain', d0: 'aujourd’hui', h1: 'dans 1 heure' };
const MORNING = 7 * 60; // pas de notification avant 7 h (heure du studio)

function studioNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: STUDIO_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
const daysBetween = (a, b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000);

/** Quelle étape de rappel est due maintenant pour un rendez-vous (jour + heure de début) ? null si aucune. */
export function stageDue(now, day, start) {
  const diff = daysBetween(now.day, day), from = minutesOf(start);
  if (diff === 0) {
    if (now.minutes >= from - 60 && now.minutes < from) return 'h1';
    if (now.minutes >= MORNING && now.minutes < from - 60) return 'd0';
    return null;
  }
  if ((diff === 1 || diff === 2) && now.minutes >= MORNING) return diff === 1 ? 'd1' : 'd2';
  return null;
}

export async function sendStaffReminders() {
  const now = studioNow();
  const to = addDays(now.day, 2);
  const [bookings, requests] = await Promise.all([
    query(`${BOOKING_SELECT} WHERE b.status = 'confirmed' AND b.day BETWEEN ? AND ?`, [now.day, to]),
    query("SELECT id, staff_id, name, wished_date, wished_time, location, session_type, staff_reminders FROM portfolio_requests WHERE status = 'accepted' AND wished_time <> '' AND wished_date BETWEEN ? AND ?", [now.day, to]).catch(() => []),
  ]);
  const items = [
    ...bookings.map((b) => ({ table: 'bookings', id: b.id, staffId: b.staff_id, who: b.client_name, day: String(b.day).slice(0, 10), start: b.start_time, place: b.location || '', sent: b.staff_reminders || '' })),
    ...requests.map((r) => ({ table: 'portfolio_requests', id: r.id, staffId: r.staff_id, who: r.name, day: r.wished_date, start: r.wished_time, place: r.location || '', sent: r.staff_reminders || '' })),
  ];
  let n = 0;
  for (const it of items) {
    const stage = stageDue(now, it.day, it.start);
    if (!stage || it.sent.split(',').includes(stage)) continue;
    // Étapes déjà dépassées le même jour (ex. rendez-vous créé tard) : on ne rattrape pas ; on marque pour ne pas répéter.
    const skip = stage === 'h1' ? ['d0'] : [];
    await query(`UPDATE ${it.table} SET staff_reminders = ? WHERE id = ?`, [[...it.sent.split(',').filter(Boolean), ...skip, stage].join(','), it.id]);
    await pushTo(it.staffId, {
      title: `Rendez-vous ${STAGES[stage]}`,
      body: `${it.who} · ${stage === 'd2' || stage === 'd1' ? `${new Date(`${it.day}T12:00:00Z`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })} à ` : ''}${it.start}${it.place ? ` · ${it.place}` : ''}`,
      tag: `apt-${it.id}-${stage}`, url: '/admin',
    });
    n += 1;
  }
  return n;
}

// Rappel au photographe le jour prévu de remise des photos (et si elle est en retard), une seule fois par rendez-vous.
export async function sendDeliveryReminders() {
  const rows = await query(`${BOOKING_SELECT} WHERE b.status = 'confirmed' AND b.delivery_date IS NOT NULL AND b.delivery_date <= ? AND b.delivered_at IS NULL AND b.delivery_reminded_at IS NULL`, [studioToday()]);
  let sent = 0;
  for (const row of rows) {
    const [staff] = await query('SELECT id, name, email FROM users WHERE id = ?', [row.staff_id]);
    const delivery = String(row.delivery_date).slice(0, 10);
    const mail = staff?.email ? await sendMail({ to: staff.email, userId: staff.id, kind: 'booking', ...deliveryReminderEmail({ staffName: staff.name, clientName: row.client_name, bookingDay: String(row.day).slice(0, 10), deliveryDate: delivery }) }) : { status: 'skipped' };
    const push = await pushTo(row.staff_id, { title: 'Photos à remettre', body: row.client_name, tag: `delivery-${row.id}`, url: '/admin' });
    if (mail.status === 'sent' || push.sent) { await query('UPDATE bookings SET delivery_reminded_at = CURRENT_TIMESTAMP WHERE id = ?', [row.id]); sent += 1; }
  }
  return sent;
}

export function startBookingReminders() {
  // Rappels du photographe : vérifiés toutes les 5 minutes (la notification « 1 h avant » doit partir à temps).
  const runStaff = () => sendStaffReminders().then((n) => { if (n) console.log(`Rappels de rendez-vous (photographe) : ${n}`); }).catch((err) => console.error('Rappels du photographe :', err.message));
  setTimeout(runStaff, 20_000).unref();
  setInterval(runStaff, 5 * 60 * 1000).unref();
  const run = () => Promise.all([sendBookingReminders(), sendDeliveryReminders()]).then(([n, m]) => { if (n) console.log(`Rappels de rendez-vous envoyés : ${n}`); if (m) console.log(`Rappels de remise de photos envoyés : ${m}`); }).catch((err) => console.error('Rappels de rendez-vous :', err.message));
  setTimeout(run, 40_000).unref();
  setInterval(run, EVERY).unref();
}
