import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { query } from '../db.js';
import { httpError } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { pushConfigured, fcmConfigured, pushPublicKey, pushTo } from '../lib/push.js';

const router = Router();
router.use(requireAuth);

// Clé publique + état : le navigateur en a besoin pour s'abonner.
router.get('/', async (req, res) => {
  const [{ n }] = await query('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?', [req.user.id]);
  res.json({ enabled: pushConfigured(), android: fcmConfigured(), publicKey: pushPublicKey(), devices: Number(n) });
});

const subSchema = z.object({
  endpoint: z.string().url().max(2000).startsWith('https://'),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(10).max(100) }),
});

router.post('/subscribe', async (req, res) => {
  if (!pushConfigured()) throw httpError(503, 'Les notifications ne sont pas encore activées sur ce serveur.');
  const sub = subSchema.parse(req.body);
  await query(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent`,
    [crypto.randomUUID(), req.user.id, sub.endpoint, sub.keys.p256dh, sub.keys.auth, String(req.get('user-agent') || '').slice(0, 200)],
  );
  res.status(201).json({ ok: true });
});

// Application Android : jeton Firebase (FCM) de l'appareil.
router.post('/fcm', async (req, res) => {
  if (!fcmConfigured()) throw httpError(503, 'Les notifications Android ne sont pas encore activées sur ce serveur.');
  const { token } = z.object({ token: z.string().min(20).max(4096) }).parse(req.body);
  await query(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent) VALUES (?, ?, ?, 'fcm', 'fcm', ?)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, user_agent = EXCLUDED.user_agent`,
    [crypto.randomUUID(), req.user.id, `fcm:${token}`, String(req.get('user-agent') || '').slice(0, 200)],
  );
  res.status(201).json({ ok: true });
});

router.post('/unsubscribe', async (req, res) => {
  const { endpoint } = z.object({ endpoint: z.string().max(2000) }).parse(req.body);
  await query('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?', [endpoint, req.user.id]);
  res.json({ ok: true });
});

// Notification d'essai envoyée à ses propres appareils.
router.post('/test', async (req, res) => {
  if (!pushConfigured() && !fcmConfigured()) throw httpError(503, 'Les notifications ne sont pas encore activées sur ce serveur.');
  const { sent, errors } = await pushTo(req.user.id, { title: 'KentraPix', body: 'Les notifications fonctionnent sur ce téléphone.', url: '/', tag: 'test' });
  if (!sent && errors?.length) throw httpError(502, `Envoi refusé : ${errors[0]}`);
  if (!sent) throw httpError(400, 'Aucun appareil abonné : activez d’abord les notifications.');
  res.json({ sent });
});

export default router;
