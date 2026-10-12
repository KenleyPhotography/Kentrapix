import { query } from '../db.js';
import { daysUntil, isoDate } from './data.js';
import { sendMail } from './mailer.js';
import { expiryEmail } from './emails.js';

// Rappel automatique : « votre galerie ferme dans 7 jours ».
// Vérifié au démarrage puis toutes les heures ; un seul e-mail par galerie et par date d'expiration.
export const EXPIRY_NOTICE_DAYS = 7;
const EVERY = 60 * 60 * 1000;

export async function sendExpiryReminders() {
  const events = await query(
    `SELECT e.id, e.name, e.expires_at,
       c.id AS client_id, c.name AS client_name, c.email AS client_email,
       s.name AS studio_name, s.sender_name, s.email AS studio_email
     FROM events e
     JOIN users c ON c.id = e.client_id AND c.active = 1
     LEFT JOIN users s ON s.id = e.created_by
     WHERE e.published = 1 AND e.archived = 0 AND e.expiry_notified_at IS NULL
       AND e.expires_at BETWEEN CURRENT_DATE AND ?`,
    [isoDate(Date.now() + EXPIRY_NOTICE_DAYS * 86400000)],
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
      ...expiryEmail({ name: e.client_name, eventName: e.name, expiresAt: e.expires_at, daysLeft: daysUntil(e.expires_at), studio }),
    });
    // Envoi raté (ou e-mails non configurés) : on réessaiera à la prochaine vérification.
    if (result.status === 'sent') await query('UPDATE events SET expiry_notified_at = CURRENT_TIMESTAMP WHERE id = ?', [e.id]);
  }
  return events.length;
}

/** Galerie dont la date d'expiration est passée : archivée automatiquement. Rien n'est supprimé (photos et fichiers gardés). */
export async function archiveExpired() {
  const res = await query('UPDATE events SET archived = 1 WHERE archived = 0 AND expires_at IS NOT NULL AND expires_at < CURRENT_DATE');
  return res.affectedRows || 0;
}

export function startExpiryReminders() {
  const run = () => {
    sendExpiryReminders().catch((err) => console.error('Rappels d’expiration :', err.message));
    archiveExpired().then((n) => { if (n) console.log(`Galeries expirées archivées : ${n}`); }).catch((err) => console.error('Archivage des galeries expirées :', err.message));
  };
  run();
  setInterval(run, EVERY).unref();
}
