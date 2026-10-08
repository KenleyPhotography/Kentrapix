import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { query } from '../db.js';
import { config } from '../config.js';
import { httpError } from '../lib/errors.js';
import { getPermissions, NOT_EXPIRED } from '../lib/data.js';
import { sendPrivate, watermarkedPreview } from '../lib/storage.js';

// Lien de partage famille : sans compte, protégé par un mot de passe choisi par le client.
// Lecture seule : aperçus et diaporama, jamais de téléchargement ni d'original.
export const SHARE_COOKIE = 'kp_share';
const SHARE_HOURS = 12;

const token = z.string().regex(/^[A-Za-z0-9_-]{32}$/, 'Lien invalide.');

/** Lien encore valable : galerie publiée, non archivée, non expirée, toujours au client, partage autorisé. */
async function findShare(rawToken) {
  const [link] = await query(
    `SELECT l.*, e.name AS event_name, e.type, e.event_date, e.location, e.selection_mode, e.music_key,
       COALESCE(s.sender_name, s.name) AS studio
     FROM share_links l
     JOIN events e ON e.id = l.event_id AND e.client_id = l.user_id
     JOIN users u ON u.id = l.user_id AND u.active = 1
     LEFT JOIN users s ON s.id = e.created_by
     WHERE l.token = ? AND e.published = 1 AND e.archived = 0 AND ${NOT_EXPIRED}`,
    [token.parse(rawToken)],
  );
  if (!link || !(await getPermissions()).sharing) throw httpError(404, 'Ce lien n’existe pas ou n’est plus disponible.');
  return link;
}

/** Le visiteur a-t-il saisi le mot de passe de ce lien ? */
function unlocked(req, link) {
  try {
    return jwt.verify(req.cookies?.[SHARE_COOKIE] || '', config.jwtSecret).sid === link.id;
  } catch {
    return false;
  }
}

async function openShare(req, rawToken) {
  const link = await findShare(rawToken);
  if (!unlocked(req, link)) throw httpError(401, 'Mot de passe requis.');
  return link;
}

const tryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Trop de tentatives. Réessayez dans 15 minutes.' },
});

// ---------- API publique ----------
export const shareApi = Router();

shareApi.get('/:token', async (req, res) => {
  const link = await findShare(req.params.token);
  if (!unlocked(req, link)) return res.json({ locked: true, studio: link.studio });
  const photos = await query(
    `SELECT id, width, height, ROW_NUMBER() OVER (ORDER BY position, created_at) AS number
     FROM photos WHERE event_id = ? ORDER BY position, created_at`,
    [link.event_id],
  );
  const base = `/media/share/${link.token}`;
  res.json({
    locked: false,
    studio: link.studio,
    event: {
      name: link.event_name, type: link.type, date: link.event_date, location: link.location || '',
      music: link.music_key ? `${base}/music` : null,
    },
    photos: photos.map((p) => ({ id: p.id, preview: `${base}/photo/${p.id}`, width: p.width, height: p.height, number: Number(p.number) })),
  });
});

shareApi.post('/:token/open', tryLimiter, async (req, res) => {
  const link = await findShare(req.params.token);
  const { password } = z.object({ password: z.string().min(1, 'Entrez le mot de passe.').max(200) }).parse(req.body);
  if (!(await bcrypt.compare(password, link.password_hash))) throw httpError(401, 'Mot de passe incorrect.');
  const value = jwt.sign({ sid: link.id }, config.jwtSecret, { algorithm: 'HS256', expiresIn: `${SHARE_HOURS}h` });
  res.cookie(SHARE_COOKIE, value, {
    httpOnly: true, secure: config.isProd, sameSite: 'lax', path: '/', maxAge: SHARE_HOURS * 60 * 60 * 1000,
  });
  await query('UPDATE share_links SET views = views + 1, last_used_at = CURRENT_TIMESTAMP WHERE id = ?', [link.id]);
  res.status(204).end();
});

// ---------- Images et musique du lien ----------
export const shareMedia = Router();

shareMedia.get('/:token/photo/:id', async (req, res) => {
  const link = await openShare(req, req.params.token);
  const [photo] = await query(
    `SELECT p.id, p.preview_key,
       (SELECT COUNT(*) FROM photos q WHERE q.event_id = p.event_id
          AND (q.position < p.position OR (q.position = p.position AND q.created_at <= p.created_at))) AS number
     FROM photos p WHERE p.id = ? AND p.event_id = ?`,
    [z.string().uuid().parse(req.params.id), link.event_id],
  );
  if (!photo) throw httpError(404, 'Photo introuvable.');
  // Galerie en mode sélection : la famille voit, comme le client, la version filigranée.
  if (link.selection_mode) return sendPrivate(res, await watermarkedPreview(photo.preview_key, photo.id, Number(photo.number)));
  sendPrivate(res, photo.preview_key);
});

shareMedia.get('/:token/music', async (req, res) => {
  const link = await openShare(req, req.params.token);
  if (!link.music_key) throw httpError(404, 'Pas de musique.');
  sendPrivate(res, link.music_key);
});
