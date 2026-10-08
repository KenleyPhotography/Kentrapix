import { Router } from 'express';
import crypto from 'node:crypto';
import archiver from 'archiver';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query, placeholders } from '../db.js';
import { httpError } from '../lib/errors.js';
import { resolveKey, fileExists } from '../lib/storage.js';
import {
  uuid, mapEvent, mapPhoto, mapDownload, mapComment, getPermissions, EVENT_COLUMNS, PHOTO_COLUMNS, COMMENT_SELECT,
  NOT_EXPIRED,
} from '../lib/data.js';
import { audit } from '../lib/audit.js';
import { sendMail } from '../lib/mailer.js';
import { selectionEmail } from '../lib/emails.js';
import { config } from '../config.js';
import { toIso } from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { BCRYPT_COST } from './auth.js';

const router = Router();
router.use(requireRole());

// Une galerie expirée disparaît de l'espace du client (le studio la garde).
const VISIBLE = `e.client_id = ? AND e.published = 1 AND e.archived = 0 AND ${NOT_EXPIRED}`;
const DOWNLOAD_LINK_MINUTES = 10;

/** Tout ce dont l'espace client a besoin, en un seul appel. */
router.get('/bootstrap', async (req, res) => {
  res.json(await clientBootstrap(req.user.id));
});

/**
 * Données de l'espace d'un client, exactement filtrées comme il les voit.
 * Réutilisé par l'aperçu admin (GET /api/admin/clients/:id/preview).
 */
export async function clientBootstrap(id) {
  const [events, photos, favorites, downloads, permissions, picks, sent] = await Promise.all([
    query(`SELECT ${EVENT_COLUMNS} FROM events e WHERE ${VISIBLE} ORDER BY e.event_date DESC, e.created_at DESC`, [id]),
    query(
      `SELECT ${PHOTO_COLUMNS} FROM photos p JOIN events e ON e.id = p.event_id
       WHERE ${VISIBLE} ORDER BY e.event_date DESC, p.position, p.created_at`,
      [id],
    ),
    query(
      `SELECT f.photo_id FROM favorites f JOIN photos p ON p.id = f.photo_id JOIN events e ON e.id = p.event_id
       WHERE f.user_id = ? AND ${VISIBLE} ORDER BY f.created_at`,
      [id, id],
    ),
    query('SELECT * FROM downloads WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', [id]),
    getPermissions(),
    query(
      `SELECT s.photo_id, p.event_id FROM photo_selections s JOIN photos p ON p.id = s.photo_id JOIN events e ON e.id = p.event_id
       WHERE s.user_id = ? AND ${VISIBLE}`,
      [id, id],
    ),
    query('SELECT * FROM event_selections WHERE user_id = ?', [id]),
  ]);
  // Personnes nommées par le studio (et non masquées) : filtre « photos de Marie ».
  const people = permissions.faces && events.length
    ? await query(
      `SELECT pe.id, pe.event_id, pe.name, GROUP_CONCAT(DISTINCT f.photo_id) AS photo_ids,
         SUBSTRING_INDEX(GROUP_CONCAT(f.id ORDER BY f.score DESC), \',\', 1) AS face_id
       FROM people pe JOIN photo_faces f ON f.person_id = pe.id JOIN events e ON e.id = pe.event_id
       WHERE ${VISIBLE} AND pe.name IS NOT NULL AND pe.hidden = 0
       GROUP BY pe.id ORDER BY pe.name`,
      [id],
    )
    : [];
  // Sélection par galerie : photos choisies + dernier envoi au studio.
  const selections = {};
  for (const e of events.filter((e) => e.selection_mode)) {
    const s = sent.find((x) => x.event_id === e.id);
    selections[e.id] = {
      photoIds: picks.filter((p) => p.event_id === e.id).map((p) => p.photo_id),
      note: s?.note || '',
      submittedAt: toIso(s?.submitted_at),
    };
  }
  return {
    events: events.map(mapEvent),
    photos: photos.map(mapPhoto),
    favorites: favorites.map((f) => f.photo_id),
    downloads: downloads.map(mapDownload),
    permissions,
    selections,
    people: people.map((p) => ({
      id: p.id, eventId: p.event_id, name: p.name, face: `/media/face/${p.face_id}`, photoIds: String(p.photo_ids || '').split(',').filter(Boolean),
    })),
  };
}

async function visiblePhotos(userId, ids) {
  if (!ids.length) return [];
  return query(
    `SELECT p.*, e.allow_download, e.selection_mode, e.name AS event_name FROM photos p JOIN events e ON e.id = p.event_id
     WHERE ${VISIBLE} AND p.id IN (${placeholders(ids.length)})
     ORDER BY p.position, p.created_at`,
    [userId, ...ids],
  );
}

// ---------- Commentaires ----------
// Le propriétaire de la galerie commente ses photos ; l'équipe les voit et répond depuis le studio.
const commentBody = z.object({
  body: z.string().trim().min(1, 'Le commentaire est vide.').max(1000, 'Commentaire trop long (1000 caractères max).'),
});

router.get('/photos/:photoId/comments', async (req, res) => {
  const photoId = uuid.parse(req.params.photoId);
  const [photo] = await visiblePhotos(req.user.id, [photoId]);
  if (!photo) throw httpError(404, 'Photo introuvable.');
  const rows = await query(`${COMMENT_SELECT} WHERE c.photo_id = ? ORDER BY c.created_at`, [photoId]);
  res.json({ comments: rows.map((c) => mapComment(c, req.user)) });
});

router.post('/photos/:photoId/comments', async (req, res) => {
  const photoId = uuid.parse(req.params.photoId);
  if (!(await getPermissions()).comments) throw httpError(403, 'Les commentaires sont désactivés.');
  const [photo] = await visiblePhotos(req.user.id, [photoId]);
  if (!photo) throw httpError(404, 'Photo introuvable.');
  const { body } = commentBody.parse(req.body);
  const id = crypto.randomUUID();
  await query('INSERT INTO photo_comments (id, photo_id, user_id, body) VALUES (?, ?, ?, ?)', [id, photoId, req.user.id, body]);
  audit(req, 'comment.create', { entity: 'photo', entityId: photoId });
  const [row] = await query(`${COMMENT_SELECT} WHERE c.id = ?`, [id]);
  res.status(201).json({ comment: mapComment(row, req.user) });
});

// Chacun peut supprimer ses propres commentaires.
router.delete('/comments/:id', async (req, res) => {
  const result = await query('DELETE FROM photo_comments WHERE id = ? AND user_id = ?', [uuid.parse(req.params.id), req.user.id]);
  if (!result.affectedRows) throw httpError(404, 'Commentaire introuvable.');
  res.status(204).end();
});

// ---------- Mode sélection ----------
async function selectionEvent(userId, id) {
  const [event] = await query(`SELECT e.* FROM events e WHERE e.id = ? AND ${VISIBLE}`, [uuid.parse(id), userId]);
  if (!event) throw httpError(404, 'Galerie introuvable.');
  if (!event.selection_mode) throw httpError(400, 'Cette galerie n’est pas en mode sélection.');
  return event;
}

// Remplace la sélection du client pour cette galerie (enregistrée à chaque clic).
router.put('/events/:id/selection', async (req, res) => {
  const event = await selectionEvent(req.user.id, req.params.id);
  const { photoIds } = z.object({ photoIds: z.array(uuid).max(5000) }).parse(req.body);
  const ids = [...new Set(photoIds)];
  if (event.selection_limit && ids.length > event.selection_limit) {
    throw httpError(400, `Vous pouvez choisir ${event.selection_limit} photos au maximum.`);
  }
  if (ids.length) {
    const [{ n }] = await query(
      `SELECT COUNT(*) AS n FROM photos WHERE event_id = ? AND id IN (${placeholders(ids.length)})`,
      [event.id, ...ids],
    );
    if (Number(n) !== ids.length) throw httpError(400, 'Certaines photos n’appartiennent pas à cette galerie.');
  }
  await query(
    'DELETE s FROM photo_selections s JOIN photos p ON p.id = s.photo_id WHERE s.user_id = ? AND p.event_id = ?',
    [req.user.id, event.id],
  );
  if (ids.length) {
    await query(`INSERT INTO photo_selections (user_id, photo_id) VALUES ${ids.map(() => '(?, ?)').join(', ')}`,
      ids.flatMap((pid) => [req.user.id, pid]));
  }
  res.json({ count: ids.length });
});

// Envoie la sélection au studio (e-mail à l'équipe). Peut être renvoyée après modification.
router.post('/events/:id/selection/submit', async (req, res) => {
  const event = await selectionEvent(req.user.id, req.params.id);
  const { note } = z.object({ note: z.string().trim().max(2000).optional().default('') }).parse(req.body);
  const rows = await query(
    `SELECT n.number FROM photo_selections s JOIN (
       SELECT id, ROW_NUMBER() OVER (ORDER BY position, created_at) AS number FROM photos WHERE event_id = ?
     ) n ON n.id = s.photo_id WHERE s.user_id = ? ORDER BY n.number`,
    [event.id, req.user.id],
  );
  if (!rows.length) throw httpError(400, 'Choisissez au moins une photo.');
  const numbers = rows.map((r) => Number(r.number));
  await query(
    `INSERT INTO event_selections (event_id, user_id, note, photo_count, submitted_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE note = VALUES(note), photo_count = VALUES(photo_count), submitted_at = CURRENT_TIMESTAMP`,
    [event.id, req.user.id, note || null, numbers.length],
  );
  audit(req, 'selection.submit', { entity: 'event', entityId: event.id, details: { count: numbers.length } });
  // Prévenir le photographe de la galerie ; à défaut, l'adresse de réponse du studio ou les propriétaires.
  const [photographer] = event.created_by
    ? await query("SELECT id, email FROM users WHERE id = ? AND active = 1 AND role IN ('owner', 'admin')", [event.created_by])
    : [];
  const studio = photographer
    ? [photographer]
    : config.mail.replyTo
      ? [{ email: config.mail.replyTo.replace(/^.*<|>.*$/g, ''), id: null }]
      : await query("SELECT id, email FROM users WHERE role = 'owner' AND active = 1");
  const tpl = selectionEmail({ clientName: req.user.name, eventName: event.name, numbers, note });
  await Promise.all(studio.map((s) => sendMail({ to: s.email, userId: s.id, eventId: event.id, kind: 'selection', ...tpl })));
  const [saved] = await query('SELECT submitted_at FROM event_selections WHERE event_id = ? AND user_id = ?', [event.id, req.user.id]);
  res.json({ numbers, submittedAt: toIso(saved.submitted_at) });
});

// ---------- Favoris ----------
router.put('/favorites/:photoId', async (req, res) => {
  const photoId = uuid.parse(req.params.photoId);
  if (!(await getPermissions()).favorites) throw httpError(403, 'Les favoris sont désactivés.');
  const [photo] = await visiblePhotos(req.user.id, [photoId]);
  if (!photo) throw httpError(404, 'Photo introuvable.');
  await query('INSERT IGNORE INTO favorites (user_id, photo_id) VALUES (?, ?)', [req.user.id, photoId]);
  res.status(204).end();
});

router.delete('/favorites/:photoId', async (req, res) => {
  const photoId = uuid.parse(req.params.photoId);
  await query('DELETE FROM favorites WHERE user_id = ? AND photo_id = ?', [req.user.id, photoId]);
  res.status(204).end();
});

// ---------- Téléchargements ----------
const downloadSchema = z.union([
  z.object({ eventId: uuid }),
  z.object({ photoIds: z.array(uuid).min(1, 'Choisissez au moins une photo.').max(1000, 'Maximum 1000 photos à la fois.') }),
]);

const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'photos';

/**
 * Étape 1 : vérifie les droits, enregistre l'historique et renvoie un lien
 * valable 10 minutes. Étape 2 (GET .../file) : envoie la photo ou le ZIP.
 */
router.post('/downloads', async (req, res) => {
  const body = downloadSchema.parse(req.body);
  const perms = await getPermissions();
  let photos;
  let eventId = null;
  let name;

  if ('eventId' in body) {
    const [event] = await query(`SELECT e.* FROM events e WHERE e.id = ? AND ${VISIBLE}`, [body.eventId, req.user.id]);
    if (!event) throw httpError(404, 'Événement introuvable.');
    if (event.selection_mode) throw httpError(403, 'Galerie en mode sélection : le téléchargement est impossible.');
    if (!perms.event || !event.allow_download) throw httpError(403, 'Le téléchargement de cet événement est désactivé.');
    photos = await query('SELECT * FROM photos WHERE event_id = ? ORDER BY position, created_at', [event.id]);
    eventId = event.id;
    name = `KentraPix-${slug(event.name)}.zip`;
  } else {
    const ids = [...new Set(body.photoIds)];
    photos = await visiblePhotos(req.user.id, ids);
    if (photos.length !== ids.length) throw httpError(404, 'Certaines photos sont introuvables.');
    if (photos.some((p) => p.selection_mode)) throw httpError(403, 'Galerie en mode sélection : le téléchargement est impossible.');
    if (photos.some((p) => !p.allow_download)) throw httpError(403, 'Le téléchargement est désactivé pour cet événement.');
    if (photos.length === 1 && !perms.individual) throw httpError(403, 'Le téléchargement des photos est désactivé.');
    if (photos.length > 1 && !perms.selection) throw httpError(403, 'Le téléchargement de sélections est désactivé.');
    eventId = new Set(photos.map((p) => p.event_id)).size === 1 ? photos[0].event_id : null;
    name = photos.length === 1 ? photos[0].filename : `KentraPix-selection-${photos.length}-photos.zip`;
  }
  if (!photos.length) throw httpError(400, 'Aucune photo à télécharger.');

  const id = crypto.randomUUID();
  await query(
    `INSERT INTO downloads (id, user_id, event_id, name, photo_count, photo_ids, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP + INTERVAL ${DOWNLOAD_LINK_MINUTES} MINUTE)`,
    [id, req.user.id, eventId, name, photos.length, JSON.stringify(photos.map((p) => p.id))],
  );
  audit(req, 'download.create', { entity: 'download', entityId: id, details: { name, count: photos.length } });
  const [row] = await query('SELECT * FROM downloads WHERE id = ?', [id]);
  res.status(201).json({ url: `/api/client/downloads/${id}/file`, download: mapDownload(row) });
});

router.get('/downloads/:id/file', async (req, res) => {
  const id = uuid.parse(req.params.id);
  const [dl] = await query(
    'SELECT * FROM downloads WHERE id = ? AND user_id = ? AND expires_at > CURRENT_TIMESTAMP',
    [id, req.user.id],
  );
  if (!dl) throw httpError(410, 'Ce lien de téléchargement a expiré. Relancez le téléchargement.');

  // Les droits sont revérifiés : un événement dépublié entre-temps n'est plus servi.
  const ids = typeof dl.photo_ids === 'string' ? JSON.parse(dl.photo_ids) : dl.photo_ids;
  const photos = (await visiblePhotos(req.user.id, ids)).filter((p) => p.allow_download && !p.selection_mode);
  if (!photos.length) throw httpError(404, 'Photos introuvables.');

  if (photos.length === 1 && !dl.name.endsWith('.zip')) {
    return res.download(resolveKey(photos[0].original_key), photos[0].filename);
  }

  const available = [];
  for (const p of photos) if (await fileExists(p.original_key)) available.push(p);
  if (!available.length) throw httpError(404, 'Fichiers originaux introuvables.');

  res.attachment(dl.name);
  // JPG/PNG déjà compressés : on stocke sans recompresser (plus rapide).
  const zip = archiver('zip', { store: true });
  zip.on('error', (err) => {
    console.error(err);
    res.destroy(err);
  });
  zip.pipe(res);
  const used = new Set();
  for (const p of available) {
    let entry = p.filename;
    for (let n = 2; used.has(entry.toLowerCase()); n++) entry = p.filename.replace(/(\.[^.]*)?$/, ` (${n})$1`);
    used.add(entry.toLowerCase());
    zip.file(resolveKey(p.original_key), { name: entry });
  }
  await zip.finalize();
});

// ---------- Partage famille ----------
// Le client crée un lien + mot de passe pour une de ses galeries ; la famille voit sans télécharger.
async function shareableEvent(req, id) {
  if (!(await getPermissions()).sharing) throw httpError(403, 'Le partage est désactivé.');
  const [event] = await query(`SELECT e.id FROM events e WHERE e.id = ? AND ${VISIBLE}`, [uuid.parse(id), req.user.id]);
  if (!event) throw httpError(404, 'Galerie introuvable.');
  return event;
}

const mapShare = (l) => ({
  id: l.id, label: l.label || '', url: `${config.appUrl}/share.html?t=${l.token}`,
  views: Number(l.views), lastUsedAt: toIso(l.last_used_at), createdAt: toIso(l.created_at),
});

router.get('/events/:id/shares', async (req, res) => {
  const event = await shareableEvent(req, req.params.id);
  const rows = await query('SELECT * FROM share_links WHERE event_id = ? AND user_id = ? ORDER BY created_at DESC', [event.id, req.user.id]);
  res.json({ shares: rows.map(mapShare) });
});

router.post('/events/:id/shares', async (req, res) => {
  const event = await shareableEvent(req, req.params.id);
  const { label, password } = z.object({
    label: z.string().trim().max(120).optional(),
    password: z.string().min(6, 'Mot de passe : 6 caractères minimum.').max(100),
  }).parse(req.body);
  const [{ n }] = await query('SELECT COUNT(*) AS n FROM share_links WHERE event_id = ? AND user_id = ?', [event.id, req.user.id]);
  if (Number(n) >= 10) throw httpError(400, '10 liens maximum par galerie : supprimez-en un d’abord.');
  const id = crypto.randomUUID();
  await query('INSERT INTO share_links (id, event_id, user_id, token, password_hash, label) VALUES (?, ?, ?, ?, ?, ?)', [
    id, event.id, req.user.id, crypto.randomBytes(24).toString('base64url'), await bcrypt.hash(password, BCRYPT_COST), label || null,
  ]);
  audit(req, 'share.create', { entity: 'event', entityId: event.id });
  const [row] = await query('SELECT * FROM share_links WHERE id = ?', [id]);
  res.status(201).json({ share: mapShare(row) });
});

router.delete('/shares/:id', async (req, res) => {
  const result = await query('DELETE FROM share_links WHERE id = ? AND user_id = ?', [uuid.parse(req.params.id), req.user.id]);
  if (!result.affectedRows) throw httpError(404, 'Lien introuvable.');
  audit(req, 'share.delete', { entity: 'share', entityId: req.params.id });
  res.status(204).end();
});

export default router;
