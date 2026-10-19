import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { query } from '../db.js';

// Envoi d'e-mails via l'API Resend (https://resend.com/docs/api-reference/emails/send-email).
// La clé reste sur le serveur ; chaque envoi est noté dans email_log.

// Logo KentraPix joint à chaque e-mail (image intégrée « cid: », affichée sans dépendre du site).
export const LOGO_CID = 'kentrapix-logo';
const LOGO_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../logo/kentrapix-email.png');
let logo;
const logoAttachment = () => {
  if (logo === undefined) {
    try { logo = fs.readFileSync(LOGO_FILE).toString('base64'); } catch { logo = null; }
  }
  return logo ? [{ filename: 'kentrapix.png', content: logo, content_id: LOGO_CID, content_type: 'image/png' }] : [];
};

/** « Nom du photographe <adresse du domaine vérifié> » : seul le nom change, l'adresse reste celle de MAIL_FROM. */
export function fromLine(name) {
  const address = (config.mail.from.match(/<([^>]+)>/)?.[1] || config.mail.from).trim();
  const clean = String(name || '').replace(/["<>,;\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return clean && address ? `${clean} <${address}>` : config.mail.from;
}

export const mailConfigured = () => Boolean(config.mail.resendKey && config.mail.from);

/**
 * @returns {Promise<{status: 'sent'|'failed'|'skipped', error: string|null}>}
 * Ne lève jamais d'erreur : un e-mail raté ne doit pas annuler l'action (création de client, publication…).
 */
export async function sendMail({ to, subject, html, text, kind, userId = null, eventId = null, sentBy = null, fromName = null, replyTo = null }) {
  let status = 'skipped';
  let providerId = null;
  let error = null;

  if (!mailConfigured()) {
    error = 'E-mails désactivés pour le moment.'; // détail technique : RESEND_API_KEY ou MAIL_FROM manquant
  } else {
    try {
      const reply = replyTo || config.mail.replyTo;
      const payload = {
        from: fromName ? fromLine(fromName) : config.mail.from,
        to: [to],
        subject,
        html,
        text,
        ...(reply ? { reply_to: reply } : {}),
      };
      const post = (body) => fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.mail.resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      const attachments = html?.includes(`cid:${LOGO_CID}`) ? logoAttachment() : [];
      let res = await post(attachments.length ? { ...payload, attachments } : payload);
      // Logo refusé par le service : on renvoie l'e-mail sans pièce jointe plutôt que de l'abandonner.
      if (res.status === 422 && attachments.length) res = await post(payload);
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
