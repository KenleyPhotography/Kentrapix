import { config } from '../config.js';
import { query } from '../db.js';

// Envoi d'e-mails via l'API Resend (https://resend.com/docs/api-reference/emails/send-email).
// La clé reste sur le serveur ; chaque envoi est noté dans email_log.

export const mailConfigured = () => Boolean(config.mail.resendKey && config.mail.from);

/**
 * @returns {Promise<{status: 'sent'|'failed'|'skipped', error: string|null}>}
 * Ne lève jamais d'erreur : un e-mail raté ne doit pas annuler l'action (création de client, publication…).
 */
export async function sendMail({ to, subject, html, text, kind, userId = null, eventId = null, sentBy = null }) {
  let status = 'skipped';
  let providerId = null;
  let error = null;

  if (!mailConfigured()) {
    error = 'E-mails désactivés : RESEND_API_KEY ou MAIL_FROM manquant dans server/.env.';
  } else {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.mail.resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: config.mail.from,
          to: [to],
          subject,
          html,
          text,
          ...(config.mail.replyTo ? { reply_to: config.mail.replyTo } : {}),
        }),
        signal: AbortSignal.timeout(15000),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        status = 'sent';
        providerId = body.id ?? null;
      } else {
        status = 'failed';
        error = body.message || `Resend a répondu HTTP ${res.status}`;
      }
    } catch (err) {
      status = 'failed';
      error = err.name === 'TimeoutError' ? 'Resend ne répond pas (délai dépassé).' : err.message;
    }
  }

  await query(
    `INSERT INTO email_log (user_id, event_id, kind, to_email, subject, status, provider_id, error, sent_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, eventId, kind, to, subject.slice(0, 200), status, providerId, error?.slice(0, 500) ?? null, sentBy],
  ).catch((err) => console.error('email_log :', err.message));

  if (status === 'failed') console.error(`E-mail « ${kind} » vers ${to} : ${error}`);
  return { status, error };
}
