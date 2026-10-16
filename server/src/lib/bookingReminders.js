import { query } from '../db.js';
import { sendMail } from './mailer.js';
import { pushTo } from './push.js';
import { bookingReminderEmail } from './emails.js';
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
    const p1 = await pushTo(row.client_id, { ...note, body: `${studio} · ${booking.start} – ${booking.end}`, url: '/client' });
    const p2 = await pushTo(row.staff_id, { ...note, body: `${row.client_name} · ${booking.start} – ${booking.end}`, url: '/admin' });
    // Au moins un e-mail parti : rappel fait. Sinon (e-mails non configurés ou échec) on réessaiera.
    if (results.some((r) => r.status === 'sent') || p1.sent || p2.sent) {
      await query('UPDATE bookings SET reminded_at = CURRENT_TIMESTAMP WHERE id = ?', [row.id]);
      sent += 1;
    }
  }
  return sent;
}

export function startBookingReminders() {
  const run = () => sendBookingReminders().then((n) => { if (n) console.log(`Rappels de rendez-vous envoyés : ${n}`); }).catch((err) => console.error('Rappels de rendez-vous :', err.message));
  setTimeout(run, 40_000).unref();
  setInterval(run, EVERY).unref();
}
