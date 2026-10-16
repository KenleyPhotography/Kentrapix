import webpush from 'web-push';
import { query } from '../db.js';
import { config } from '../config.js';

// Notifications sur téléphone (Web Push) : fonctionne sans service payant. Clés VAPID dans l'environnement
// (npm run push:keys pour les générer) ; sans clés, tout est simplement désactivé.
const publicKey = () => process.env.VAPID_PUBLIC_KEY || '';
const privateKey = () => process.env.VAPID_PRIVATE_KEY || '';
const subject = () => process.env.VAPID_SUBJECT || `mailto:${config.mail?.replyTo?.replace(/^.*<|>.*$/g, '') || 'contact@kentrapix.com'}`;

export const pushConfigured = () => Boolean(publicKey() && privateKey());
export const pushPublicKey = () => publicKey();

let ready = false;
function init() {
  if (ready || !pushConfigured()) return pushConfigured();
  webpush.setVapidDetails(subject(), publicKey(), privateKey());
  ready = true;
  return true;
}

/**
 * Envoie une notification à tous les appareils d'un compte. Ne lève jamais d'erreur : une notification ratée ne doit
 * rien annuler. Les appareils qui ne répondent plus (désinstallés, permission retirée) sont retirés.
 * payload : { title, body, url = '/', tag }
 */
export async function pushTo(userId, payload) {
  if (!userId || !init()) return { sent: 0 };
  let sent = 0;
  try {
    const subs = await query('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?', [userId]);
    const body = JSON.stringify({ url: '/', ...payload });
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 24 * 3600, urgency: 'normal' });
        sent += 1;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) await query('DELETE FROM push_subscriptions WHERE id = ?', [s.id]).catch(() => {});
        else console.error(`Notification (${err.statusCode || err.code || 'erreur'}) :`, String(err.body || err.message).slice(0, 120));
      }
    }));
  } catch (err) {
    console.error('Notifications :', err.message);
  }
  return { sent };
}

/** Plusieurs destinataires (galerie partagée par plusieurs clients…). */
export const pushToMany = (userIds, payload) => Promise.all([...new Set(userIds.filter(Boolean))].map((id) => pushTo(id, payload)));

/** Version « tire et oublie » pour les routes. */
export const pushLater = (userId, payload) => { pushTo(userId, payload).catch(() => {}); };
