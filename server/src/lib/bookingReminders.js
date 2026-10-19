import { query } from '../db.js';
import { sendMail } from './mailer.js';
import { pushTo } from './push.js';
import { bookingReminderEmail, deliveryReminderEmail } from './emails.js';
import { BOOKING_SELECT, mapBooking, studioToday, addDays } from './booking.js';

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
    const p2 = await pushTo(row.staff_id, { ...note, body: `${row.client_name} · ${booking.start} – ${booking.end}`, url: '/admin' });
    // Au moins un e-mail parti : rappel fait. Sinon (e-mails non configurés ou échec) on réessaiera.
    if (results.some((r) => r.status === 'sent') || p1.sent || p2.sent) {
      await query('UPDATE bookings SET reminded_at = CURRENT_TIMESTAMP WHERE id = ?', [row.id]);
      sent += 1;
    }
  }
  return sent;
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
  const run = () => Promise.all([sendBookingReminders(), sendDeliveryReminders()]).then(([n, m]) => { if (n) console.log(`Rappels de rendez-vous envoyés : ${n}`); if (m) console.log(`Rappels de remise de photos envoyés : ${m}`); }).catch((err) => console.error('Rappels de rendez-vous :', err.message));
  setTimeout(run, 40_000).unref();
  setInterval(run, EVERY).unref();
}
