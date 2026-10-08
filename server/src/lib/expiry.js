import { query } from '../db.js';
import { sendMail } from './mailer.js';
import { expiryEmail } from './emails.js';

// Rappel automatique : « votre galerie ferme dans 7 jours ».
// Vérifié au démarrage puis toutes les heures ; un seul e-mail par galerie et par date d'expiration.
export const EXPIRY_NOTICE_DAYS = 7;
const EVERY = 60 * 60 * 1000;

export async function sendExpiryReminders() {
  const events = await query(
    `SELECT e.id, e.name, e.expires_at, DATEDIFF(e.expires_at, UTC_DATE()) AS days_left,
       c.id AS client_id, c.name AS client_name, c.email AS client_email,
       s.name AS studio_name, s.sender_name, s.email AS studio_email
     FROM events e
     JOIN users c ON c.id = e.client_id AND c.active = 1
     LEFT JOIN users s ON s.id = e.created_by
     WHERE e.published = 1 AND e.archived = 0 AND e.expiry_notified_at IS NULL
       AND e.expires_at BETWEEN UTC_DATE() AND UTC_DATE() + INTERVAL ? DAY`,
    [EXPIRY_NOTICE_DAYS],
  );
  for (const e of events) {
    const studio = e.sender_name || e.studio_name || undefined;
    const result = await sendMail({
      to: e.client_email,
      userId: e.client_id,
      eventId: e.id,
      kind: 'expiry',
      sentBy: null,
      fromName: studio || null,
      replyTo: e.studio_email || null,
      ...expiryEmail({ name: e.client_name, eventName: e.name, expiresAt: e.expires_at, daysLeft: Number(e.days_left), studio }),
    });
    // Envoi raté (ou e-mails non configurés) : on réessaiera à la prochaine vérification.
    if (result.status === 'sent') await query('UPDATE events SET expiry_notified_at = CURRENT_TIMESTAMP WHERE id = ?', [e.id]);
  }
  return events.length;
}

export function startExpiryReminders() {
  const run = () => sendExpiryReminders().catch((err) => console.error('Rappels d’expiration :', err.message));
  run();
  setInterval(run, EVERY).unref();
}
