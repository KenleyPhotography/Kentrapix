import { Router } from 'express';
import archiver from 'archiver';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import crypto from 'node:crypto';
import { query } from '../db.js';
import { config } from '../config.js';
import { httpError } from '../lib/errors.js';
import { getPermissions, NOT_EXPIRED } from '../lib/data.js';
import { sendPrivate, watermarkedPreview, zipOriginals, downloadName } from '../lib/storage.js';
import { FAMILY_COMMENT_SELECT, familyCommentBody, mapFamilyComment } from '../lib/shares.js';

// Lien de partage famille : sans compte, protégé par un mot de passe choisi par le client.
// Aperçus et diaporama ; téléchargement des originaux seulement si le studio l'autorise (réglage
// « share_download ») ET que la galerie autorise les téléchargements (jamais en mode sélection).
// Commentaires de la famille si le lien les autorise (et le réglage « comments » du studio).
export const SHARE_COOKIE = 'kp_share';
const SHARE_HOURS = 12;

const token = z.string().regex(/^[A-Za-z0-9_-]{32}$/, 'Lien invalide.');

/** Lien encore valable : galerie publiée, non archivée, non expirée, toujours au client, partage autorisé. */
async function findShare(rawToken) {
  const [link] = await query(
    `SELECT l.*, e.name AS event_name, e.type, e.event_date, e.location, e.selection_mode, e.music_key, e.allow_download AS event_download,
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

/** Contenu du cookie de partage ({ sid, vid }) s'il est valable, sinon null. */
function shareSession(req) {
  try {
    return jwt.verify(req.cookies?.[SHARE_COOKIE] || '', config.jwtSecret);
  } catch {
    return null;
  }
}

/** Le visiteur a-t-il saisi le mot de passe de ce lien ? */
const unlocked = (req, link) => shareSession(req)?.sid === link.id;

/** Identifiant du visiteur de ce lien (même navigateur = même personne). */
const visitorOf = (req) => shareSession(req)?.vid || null;

/** Téléchargement : autorisé par le client pour ce lien, par la galerie et par le réglage du studio (jamais en mode sélection). */
const canDownload = async (link) =>
  !!link.allow_download && !!link.event_download && !link.selection_mode && (await getPermissions()).share_download;

async function openShare(req, rawToken) {
  const link = await findShare(rawToken);
  if (!unlocked(req, link)) throw httpError(401, 'Mot de passe requis.');
  return link;
}

function setShareCookie(res, sid, vid) {
  const value = jwt.sign({ sid, vid }, config.jwtSecret, { algorithm: 'HS256', expiresIn: `${SHARE_HOURS}h` });
  res.cookie(SHARE_COOKIE, value, {
    httpOnly: true, secure: config.isProd, sameSite: 'lax', path: '/', maxAge: SHARE_HOURS * 60 * 60 * 1000,
  });
}

/** Commentaires permis sur ce lien : réglage du lien ET réglage « comments » du studio. */
const canComment = async (link) => !!link.allow_comments && (await getPermissions()).comments;

const commentLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Beaucoup de messages d’un coup : réessayez dans quelques minutes.' },
});

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
  const comments = await canComment(link);
  const counts = comments
    ? Object.fromEntries((await query('SELECT photo_id, COUNT(*) AS n FROM share_comments WHERE share_id = ? GROUP BY photo_id', [link.id]))
      .map((c) => [c.photo_id, Number(c.n)]))
    : {};
  res.json({
    locked: false,
    studio: link.studio,
    download: (await canDownload(link)) ? `${base}/download` : null,
    comments,
    event: {
      name: link.event_name, type: link.type, date: link.event_date, location: link.location || '',
      music: link.music_key ? `${base}/music` : null,
    },
    photos: photos.map((p) => ({
      id: p.id, preview: `${base}/photo/${p.id}`, width: p.width, height: p.height, number: Number(p.number), commentCount: counts[p.id] || 0,
    })),
  });
});

shareApi.post('/:token/open', tryLimiter, async (req, res) => {
  const link = await findShare(req.params.token);
  const { password } = z.object({ password: z.string().min(1, 'Entrez le mot de passe.').max(200) }).parse(req.body);
  if (!(await bcrypt.compare(password, link.password_hash))) throw httpError(401, 'Mot de passe incorrect.');
  // Même navigateur : on garde l'identifiant de visiteur (ses commentaires restent les siens).
  setShareCookie(res, link.id, visitorOf(req) || crypto.randomUUID());
  await query('UPDATE share_links SET views = views + 1, last_used_at = CURRENT_TIMESTAMP WHERE id = ?', [link.id]);
  res.status(204).end();
});

// ---------- Commentaires de la famille ----------
// Chaque lien a son propre fil : la famille d'un lien ne voit pas les messages d'un autre lien.
// Le client et le studio les lisent (visionneuse, page Commentaires) et peuvent les retirer.
async function sharePhoto(link, rawId) {
  const [photo] = await query('SELECT id FROM photos WHERE id = ? AND event_id = ?', [z.string().uuid().parse(rawId), link.event_id]);
  if (!photo) throw httpError(404, 'Photo introuvable.');
  return photo;
}

shareApi.get('/:token/photos/:id/comments', async (req, res) => {
  const link = await openShare(req, req.params.token);
  if (!(await canComment(link))) throw httpError(403, 'Les commentaires sont désactivés pour ce lien.');
  const photo = await sharePhoto(link, req.params.id);
  const rows = await query(`${FAMILY_COMMENT_SELECT} WHERE sc.share_id = ? AND sc.photo_id = ? ORDER BY sc.created_at`, [link.id, photo.id]);
  const vid = visitorOf(req);
  res.json({ comments: rows.map((c) => mapFamilyComment(c, { visitorId: vid })) });
});

shareApi.post('/:token/photos/:id/comments', commentLimiter, async (req, res) => {
  const link = await openShare(req, req.params.token);
  if (!(await canComment(link))) throw httpError(403, 'Les commentaires sont désactivés pour ce lien.');
  const photo = await sharePhoto(link, req.params.id);
  const { name, body } = familyCommentBody.parse(req.body);
  const id = crypto.randomUUID();
  // Lien ouvert avant l'arrivée des commentaires : le cookie n'a pas encore d'identifiant de visiteur.
  let vid = visitorOf(req);
  if (!vid) setShareCookie(res, link.id, (vid = crypto.randomUUID()));
  await query('INSERT INTO share_comments (id, share_id, photo_id, visitor_id, author_name, body) VALUES (?, ?, ?, ?, ?, ?)', [
    id, link.id, photo.id, vid, name, body,
  ]);
  await query('UPDATE share_links SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?', [link.id]);
  const [row] = await query(`${FAMILY_COMMENT_SELECT} WHERE sc.id = ?`, [id]);
  res.status(201).json({ comment: mapFamilyComment(row, { visitorId: vid }) });
});

// Un visiteur supprime seulement ses propres messages.
shareApi.delete('/:token/comments/:id', async (req, res) => {
  const link = await openShare(req, req.params.token);
  const result = await query('DELETE FROM share_comments WHERE id = ? AND share_id = ? AND visitor_id = ?', [
    z.string().uuid().parse(req.params.id), link.id, visitorOf(req),
  ]);
  if (!result.affectedRows) throw httpError(404, 'Commentaire introuvable.');
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
  await sendPrivate(res, photo.preview_key);
});

shareMedia.get('/:token/music', async (req, res) => {
  const link = await openShare(req, req.params.token);
  if (!link.music_key) throw httpError(404, 'Pas de musique.');
  await sendPrivate(res, link.music_key);
});

// ---------- Téléchargement (si autorisé) ----------
async function downloadableShare(req, rawToken) {
  const link = await openShare(req, rawToken);
  if (!(await canDownload(link))) throw httpError(403, 'Le téléchargement n’est pas autorisé pour ce lien.');
  return link;
}

// Une photo : l'original, sous son nom de fichier.
shareMedia.get('/:token/download/:id', async (req, res) => {
  const link = await downloadableShare(req, req.params.token);
  const [photo] = await query('SELECT original_key, filename FROM photos WHERE id = ? AND event_id = ?', [
    z.string().uuid().parse(req.params.id), link.event_id,
  ]);
  if (!photo) throw httpError(404, 'Photo introuvable.');
  await query('UPDATE share_links SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?', [link.id]);
  await sendPrivate(res, photo.original_key, downloadName(photo));
});

// Toute la galerie : un ZIP des originaux (sans compression, les photos le sont déjà).
shareMedia.get('/:token/download', async (req, res) => {
  const link = await downloadableShare(req, req.params.token);
  const photos = await query('SELECT original_key, filename FROM photos WHERE event_id = ? ORDER BY position, created_at', [link.event_id]);
  if (!photos.length) throw httpError(404, 'Aucune photo.');
  const name = `${link.event_name}`.replace(/[^\p{L}\p{N} ._-]+/gu, '').trim().slice(0, 80) || 'photos';
  res.attachment(`${name}.zip`);
  const zip = archiver('zip', { store: true });
  zip.on('error', (err) => res.destroy(err));
  zip.pipe(res);
  await zipOriginals(zip, photos);
});
