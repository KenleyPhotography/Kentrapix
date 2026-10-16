import crypto from 'node:crypto';
import { query } from '../db.js';
import { sendMail } from './mailer.js';
import { paymentReminderEmail } from './emails.js';
import { INVOICE_SELECT, mapInvoice, invoiceUrl, today } from './billing.js';

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
    // Envoi raté ou e-mails non configurés : rien n'est enregistré, on réessaiera à la prochaine vérification.
    if (result.status !== 'sent') continue;
    await query(
      `INSERT INTO reminder_log (id, staff_id, invoice_id, channel, status, phase, auto) VALUES (?, ?, ?, 'email', 'sent', ?, 1) ON CONFLICT DO NOTHING`,
      [crypto.randomUUID(), staff.id, row.id, phase],
    );
    await query('UPDATE invoices SET reminded_at = CURRENT_TIMESTAMP WHERE id = ?', [row.id]);
    sent += 1;
  }
  return sent;
}

export function startAutoReminders() {
  const run = () => sendAutoReminders().then((n) => { if (n) console.log(`Rappels de paiement automatiques envoyés : ${n}`); }).catch((err) => console.error('Rappels automatiques :', err.message));
  setTimeout(run, 20_000).unref(); // laisse le serveur démarrer d'abord
  setInterval(run, EVERY).unref();
}
