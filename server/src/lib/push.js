import webpush from 'web-push';
import jwt from 'jsonwebtoken';
import { query } from '../db.js';
import { config } from '../config.js';

// Notifications sur téléphone (Web Push) : fonctionne sans service payant. Clés VAPID dans l'environnement
// (npm run push:keys pour les générer) ; sans clés, tout est simplement désactivé.
const publicKey = () => process.env.VAPID_PUBLIC_KEY || '';
const privateKey = () => process.env.VAPID_PRIVATE_KEY || '';
const subject = () => process.env.VAPID_SUBJECT || `mailto:${config.mail?.replyTo?.replace(/^.*<|>.*$/g, '') || 'contact@kentrapix.com'}`;

export const pushConfigured = () => Boolean(publicKey() && privateKey());
export const pushPublicKey = () => publicKey();

// ---------- Application Android (Firebase Cloud Messaging, API HTTP v1) ----------
// FIREBASE_SERVICE_ACCOUNT : contenu du fichier JSON de la clé de compte de service (ou ce contenu encodé en base64).
// Les jetons FCM sont rangés dans push_subscriptions avec endpoint « fcm:<jeton> ».
function serviceAccount() {
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
    return sa.client_email && sa.private_key && sa.project_id ? sa : null;
  } catch {
    return null;
  }
}
export const fcmConfigured = () => Boolean(serviceAccount());

let fcmToken = { value: '', exp: 0 };
async function fcmAccessToken(sa) {
  if (fcmToken.value && Date.now() < fcmToken.exp - 60_000) return fcmToken.value;
  const assertion = jwt.sign(
    { scope: 'https://www.googleapis.com/auth/firebase.messaging' },
    sa.private_key.replace(/\\n/g, '\n'),
    { algorithm: 'RS256', issuer: sa.client_email, audience: 'https://oauth2.googleapis.com/token', expiresIn: '1h' },
  );
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`FCM auth : ${data.error_description || data.error || res.status}`);
  fcmToken = { value: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
  return fcmToken.value;
}

/** Envoie à un appareil Android. Retourne false si le jeton n'existe plus (à supprimer). */
async function sendFcm(token, { title, body, url = '/', tag }) {
  const sa = serviceAccount();
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await fcmAccessToken(sa)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: title || 'KentraPix', body: body || '' },
        data: { url: String(url) },
        android: {
          priority: 'HIGH',
          ...(tag ? { collapse_key: String(tag).slice(0, 60) } : {}),
          notification: { ...(tag ? { tag: String(tag).slice(0, 60) } : {}), color: '#1265d8' },
        },
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.ok) return true;
  const err = await res.json().catch(() => ({}));
  if (res.status === 404 || err?.error?.details?.some?.((d) => d.errorCode === 'UNREGISTERED')) return false;
  throw new Error(`FCM ${res.status} : ${String(err?.error?.message || '').slice(0, 120)}`);
}

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
  const web = init();
  if (!userId || (!web && !fcmConfigured())) return { sent: 0 };
  let sent = 0;
  try {
    const subs = await query('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?', [userId]);
    const body = JSON.stringify({ url: '/', ...payload });
    await Promise.all(subs.map(async (s) => {
      if (s.endpoint.startsWith('fcm:')) {
        if (!fcmConfigured()) return;
        try {
          if (await sendFcm(s.endpoint.slice(4), { url: '/', ...payload })) sent += 1;
          else await query('DELETE FROM push_subscriptions WHERE id = ?', [s.id]).catch(() => {});
        } catch (err) { console.error('Notification Android :', err.message); }
        return;
      }
      if (!web) return;
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
