import crypto from 'node:crypto';
import { query } from '../db.js';
import { sendMail } from './mailer.js';
import { pushTo } from './push.js';
import { paymentReminderEmail, contractReminderEmail } from './emails.js';
import { contractUrl } from './contracts.js';
import { INVOICE_SELECT, mapInvoice, invoiceUrl, today } from './billing.js';
import { config } from '../config.js';

// Rappels de paiement automatiques (par e-mail), une seule fois par étape et par facture :
//   before : 3 jours avant l'échéance (jusqu'au jour J) · late1 : dès le lendemain · late2 : 8 jours après · late3 : 15 jours après.
// Vérifié au démarrage puis toutes les heures. Désactivable par photographe (users.auto_reminders).
const EVERY = 60 * 60 * 1000;
const dayMs = 86400000;
const daysBetween = (a, b) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / dayMs);

/** Étape de rappel d'une facture selon son échéance (null = rien à envoyer aujourd'hui). */
export function reminderPhase(dueDate, day = today()) {
  if (!dueDate) return null;
  const left = daysBetween(String(dueDate).slice(0, 10), day); // > 0 : jours restants ; < 0 : jours de retard
  if (left >= 0 && left <= 3) return 'before';
  if (left < 0) {
    const late = -left;
    if (late >= 15) return 'late3';
    if (late >= 8) return 'late2';
    return 'late1';
  }
  return null;
}

export async function sendAutoReminders() {
  const rows = await query(
    `${INVOICE_SELECT} JOIN users s ON s.id = i.staff_id AND s.active = 1 AND s.auto_reminders = 1
     WHERE i.cancelled = 0 AND i.due_date IS NOT NULL AND u.active = 1 AND u.email IS NOT NULL`,
  );
  let sent = 0;
  for (const row of rows) {
    const invoice = mapInvoice(row);
    if (invoice.status === 'paid' || invoice.status === 'cancelled') continue;
    const phase = reminderPhase(invoice.dueDate);
    if (!phase) continue;
    const [done] = await query('SELECT 1 FROM reminder_log WHERE invoice_id = ? AND phase = ?', [row.id, phase]);
    if (done) continue;
    const [staff] = await query('SELECT id, name, sender_name, email FROM users WHERE id = ?', [row.staff_id]);
    if (!staff) continue;
    const studio = staff.sender_name || staff.name;
    const result = await sendMail({
      to: invoice.client.email, userId: row.client_id, sentBy: staff.id, kind: 'invoice_reminder',
      fromName: studio, replyTo: staff.email,
      ...paymentReminderEmail({ name: invoice.client.name, studio, invoice, url: invoiceUrl(row.public_token) }),
    });
    const pushed = await pushTo(row.client_id, { title: 'Rappel de paiement', body: `${invoice.number} · reste ${invoice.balance} ${invoice.currency}`, url: invoiceUrl(row.public_token).replace(config.appUrl, ''), tag: `invoice-${row.id}` });
    // Envoi raté ou e-mails non configurés : rien n'est enregistré, on réessaiera à la prochaine vérification.
    if (result.status !== 'sent' && !pushed.sent) continue;
    await query(
      `INSERT INTO reminder_log (id, staff_id, invoice_id, channel, status, phase, auto) VALUES (?, ?, ?, 'email', 'sent', ?, 1) ON CONFLICT DO NOTHING`,
      [crypto.randomUUID(), staff.id, row.id, phase],
    );
    await query('UPDATE invoices SET reminded_at = CURRENT_TIMESTAMP WHERE id = ?', [row.id]);
    sent += 1;
  }
  return sent;
}

/** Étape de rappel d'un contrat pas signé : 3 jours (ou moins) avant la séance, sinon 2 jours après la création. */
export function contractPhase({ bookingDay, createdAt }, day = today()) {
  if (bookingDay) {
    const left = daysBetween(String(bookingDay).slice(0, 10), day);
    if (left >= 0 && left <= 3) return 'before3';
    if (left < 0) return null; // séance passée
  }
  return daysBetween(day, String(createdAt).slice(0, 10)) >= 2 ? 'after2' : null;
}

// Contrats envoyés mais pas encore signés : un rappel (e-mail + notification) par étape, jamais deux fois la même.
export async function sendContractReminders() {
  const rows = await query(
    `SELECT c.id, c.title, c.public_token, c.client_id, c.staff_id, c.created_at, c.reminded_phase, b.day AS booking_day,
            u.name AS client_name, u.email AS client_email, COALESCE(s.sender_name, s.name) AS studio, s.email AS staff_email
     FROM contracts c JOIN users u ON u.id = c.client_id AND u.active = 1 JOIN users s ON s.id = c.staff_id AND s.active = 1 AND s.auto_reminders = 1
     LEFT JOIN bookings b ON b.id = c.booking_id AND b.status = 'confirmed'
     WHERE c.status = 'pending' AND u.email IS NOT NULL`,
  );
  let sent = 0;
  for (const c of rows) {
    const phase = contractPhase({ bookingDay: c.booking_day, createdAt: c.created_at });
    if (!phase || c.reminded_phase === phase || (phase === 'after2' && c.reminded_phase === 'before3')) continue;
    const url = contractUrl(c.public_token);
    const result = await sendMail({
      to: c.client_email, userId: c.client_id, sentBy: c.staff_id, kind: 'contract_reminder', fromName: c.studio, replyTo: c.staff_email,
      ...contractReminderEmail({ name: c.client_name, studio: c.studio, title: c.title, url, bookingDay: c.booking_day ? String(c.booking_day).slice(0, 10) : null }),
    });
    const pushed = await pushTo(c.client_id, { title: 'Contrat à signer', body: `${c.studio} · ${c.title}`, url: url.replace(config.appUrl, ''), tag: `contract-${c.id}` });
    if (result.status !== 'sent' && !pushed.sent) continue; // on réessaiera à la prochaine vérification
    await query('UPDATE contracts SET reminded_at = CURRENT_TIMESTAMP, reminded_phase = ? WHERE id = ?', [phase, c.id]);
    sent += 1;
  }
  return sent;
}

export function startAutoReminders() {
  const run = () => Promise.all([
    sendAutoReminders().then((n) => { if (n) console.log(`Rappels de paiement automatiques envoyés : ${n}`); }),
    sendContractReminders().then((n) => { if (n) console.log(`Rappels de contrat automatiques envoyés : ${n}`); }),
  ]).catch((err) => console.error('Rappels automatiques :', err.message));
  setTimeout(run, 20_000).unref(); // laisse le serveur démarrer d'abord
  setInterval(run, EVERY).unref();
}
