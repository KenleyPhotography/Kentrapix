import { query } from '../db.js';
import { sendMail } from './mailer.js';
import { pushTo } from './push.js';
import { announcementEmail } from './emails.js';

// Notifications écrites dans le studio : visibles dans la cloche des clients à partir de send_at,
// et envoyées par e-mail automatiquement (tout de suite, ou à l'heure programmée).
// Vérifié au démarrage, toutes les minutes, et juste après chaque nouvelle notification.
const EVERY = 60 * 1000;
// Resend accepte peu d'envois par seconde sur l'offre gratuite : on espace les e-mails.
const GAP = 600;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Envoie les e-mails des notifications arrivées à échéance. Chaque destinataire est réservé avant l'envoi (jamais deux fois). */
export async function deliverAnnouncements() {
  const due = await query(
    `SELECT a.id, a.title, a.body, ev.name AS event_name, s.name AS studio_name, s.sender_name, s.email AS studio_email, a.created_by
     FROM announcements a
     LEFT JOIN events ev ON ev.id = a.event_id
     LEFT JOIN users s ON s.id = a.created_by
     WHERE a.send_email = 1 AND a.send_at <= CURRENT_TIMESTAMP
       AND EXISTS (SELECT 1 FROM announcement_recipients r WHERE r.announcement_id = a.id AND r.email_status IS NULL)
     ORDER BY a.send_at`,
  );
  let sent = 0;
  for (const a of due) {
    const studio = a.sender_name || a.studio_name || undefined;
    for (;;) {
      const [r] = await query(
        `UPDATE announcement_recipients SET email_status = 'sending'
         WHERE (announcement_id, user_id) = (
           SELECT announcement_id, user_id FROM announcement_recipients
           WHERE announcement_id = ? AND email_status IS NULL LIMIT 1 FOR UPDATE SKIP LOCKED)
         RETURNING user_id`,
        [a.id],
      );
      if (!r) break;
      const [u] = await query('SELECT id, name, email, active FROM users WHERE id = ?', [r.user_id]);
      let status = 'skipped'; // compte désactivé entre-temps
      if (u?.active) {
        ({ status } = await sendMail({
          to: u.email,
          userId: u.id,
          kind: 'announcement',
          sentBy: a.created_by,
          fromName: studio || null,
          replyTo: a.studio_email || null,
          ...announcementEmail({ name: u.name, title: a.title, body: a.body, eventName: a.event_name, studio }),
        }));
        await pushTo(u.id, { title: a.title, body: String(a.body || '').slice(0, 140), url: '/client', tag: `announcement-${a.id}` });
        sent += 1;
        await pause(GAP);
      }
      await query('UPDATE announcement_recipients SET email_status = ? WHERE announcement_id = ? AND user_id = ?', [status, a.id, r.user_id]);
    }
  }
  return sent;
}

let running = null;
let again = false;
/** Lance un envoi en arrière-plan ; si un envoi tourne déjà, il repasse une fois à la fin. */
export function kickAnnouncements() {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await deliverAnnouncements().catch((err) => console.error('Notifications :', err.message));
    } while (again);
    running = null;
  })();
  return running;
}

export function startAnnouncements() {
  kickAnnouncements();
  setInterval(kickAnnouncements, EVERY).unref();
}
