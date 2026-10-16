import { Router } from 'express';
import crypto from 'node:crypto';
import archiver from 'archiver';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { codeRule } from '../lib/accessCode.js';
import { query, placeholders, utcStamp } from '../db.js';
import { httpError } from '../lib/errors.js';
import { fileExists, sendPrivate, zipOriginals, downloadName } from '../lib/storage.js';
import {
  uuid, mapEvent, mapPhoto, isLockedFor, LOCK_DEFAULT_REASON, mapPhotographer, mapDownload, mapComment, getPermissions, EVENT_COLUMNS, PHOTO_COLUMNS, COMMENT_SELECT,
  NOT_EXPIRED,
  CLIENT_HAS,
} from '../lib/data.js';
import { audit } from '../lib/audit.js';
import { sendMail } from '../lib/mailer.js';
import { selectionEmail } from '../lib/emails.js';
import { config } from '../config.js';
import { toIso } from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { BCRYPT_COST } from './auth.js';
import { clientNotifications } from '../lib/notifications.js';
import { clientBooking } from './booking.js';
import { pushLater } from '../lib/push.js';
import { clientOrders } from './orders.js';
import {
  SHARE_SELECT, mapShare, shareCreateSchema, shareUpdateSchema, createShare, updateShare, FAMILY_COMMENT_SELECT, mapFamilyComment, byDate,
} from '../lib/shares.js';

const router = Router();
router.use(requireRole());
router.use('/booking', (req, res, next) => clientBookingRouter(req, res, next));
router.use('/orders', (req, res, next) => clientOrdersRouter(req, res, next));

// Une galerie expirée disparaît de l'espace du client (le studio la garde).
const VISIBLE = `${CLIENT_HAS()} AND e.published = 1 AND e.archived = 0 AND ${NOT_EXPIRED}`;
const DOWNLOAD_LINK_MINUTES = 10;

/** Tout ce dont l'espace client a besoin, en un seul appel. */
router.get('/bootstrap', async (req, res) => {
  res.json(await clientBootstrap(req.user.id));
});

/**
 * Tous les photographes d'un client, avec leur profil : ceux dont il a saisi le code, celui qui a créé son compte
 * et tout photographe qui lui a publié une galerie (même sans code saisi).
 */
async function photographersOf(clientId) {
  return query(
    `SELECT s.* FROM (
       SELECT staff_id AS sid, created_at AS since FROM client_photographers WHERE client_id = ?
       UNION ALL SELECT created_by, created_at FROM users WHERE id = ? AND created_by IS NOT NULL
       UNION ALL SELECT e.created_by, e.created_at FROM events e WHERE ${CLIENT_HAS()} AND e.published = 1 AND e.archived = 0 AND e.created_by IS NOT NULL
     ) x JOIN users s ON s.id = x.sid
     WHERE s.role IN ('owner', 'admin') AND s.active = 1
     GROUP BY s.id ORDER BY MIN(x.since)`,
    [clientId, clientId, clientId],
  );
}

// Rendez-vous : le client réserve un créneau chez l'un de ses photographes.
const clientBookingRouter = clientBooking({ photographersOf });
// Albums et tirages : commandes du client (catalogue du photographe).
const clientOrdersRouter = clientOrders({ photographersOf, visiblePhotos });

/**
 * Données de l'espace d'un client, exactement filtrées comme il les voit.
 * Réutilisé par l'aperçu admin (GET /api/admin/clients/:id/preview).
 */
export async function clientBootstrap(id, onlyBy = null) {
  let [events, photos, favorites, downloads, permissions, picks, sent] = await Promise.all([
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
      `SELECT s.photo_id, s.note, p.event_id FROM photo_selections s JOIN photos p ON p.id = s.photo_id JOIN events e ON e.id = p.event_id
       WHERE s.user_id = ? AND ${VISIBLE}`,
      [id, id],
    ),
    query('SELECT * FROM event_selections WHERE user_id = ?', [id]),
  ]);
  // Aperçu par un photographe : seulement les galeries qu'il a créées pour ce client.
  if (onlyBy) {
    events = events.filter((e) => e.created_by === onlyBy);
    const ok = new Set(events.map((e) => e.id));
    photos = photos.filter((p) => ok.has(p.event_id));
    const okPhotos = new Set(photos.map((p) => p.id));
    favorites = favorites.filter((f) => okPhotos.has(f.photo_id));
    picks = picks.filter((p) => ok.has(p.event_id));
    sent = sent.filter((x) => ok.has(x.event_id));
  }
  // Sélection par galerie : photos choisies + dernier envoi au studio.
  const selections = {};
  for (const e of events.filter((e) => e.selection_mode)) {
    const s = sent.find((x) => x.event_id === e.id);
    selections[e.id] = {
      photoIds: picks.filter((p) => p.event_id === e.id).map((p) => p.photo_id),
      notes: Object.fromEntries(picks.filter((p) => p.event_id === e.id && p.note).map((p) => [p.photo_id, p.note])),
      note: s?.note || '',
      submittedAt: toIso(s?.submitted_at),
    };
  }
  // Ses photographes : ceux dont il a saisi le code (ou qui l'ont créé), avec leurs coordonnées.
  // Photos que le photographe n'a pas encore débloquées : cachées ou renvoyées « verrouillées » (sans image ni nom de fichier).
  const totals = {};
  const opened = {};
  for (const p of photos) totals[p.event_id] = (totals[p.event_id] || 0) + 1;
  const evById = Object.fromEntries(events.map((e) => [e.id, e]));
  photos = photos.flatMap((p) => {
    const e = evById[p.event_id];
    if (!e || !isLockedFor(e, p.number)) { opened[p.event_id] = (opened[p.event_id] || 0) + 1; return [p]; }
    return e.lock_mode === 'hidden' ? [] : [{ ...p, __locked: true }];
  });
  const photographers = await photographersOf(id);
  // Nom du photographe qui a créé chaque galerie (affiché « Par … » chez le client).
  const creators = [...new Set(events.map((e) => e.created_by).filter(Boolean))];
  const names = creators.length
    ? Object.fromEntries((await query(`SELECT id, name FROM users WHERE id IN (${placeholders(creators.length)})`, creators)).map((u) => [u.id, u.name]))
    : {};
  return {
    photographers: photographers.map(mapPhotographer),
    events: events.map((e) => {
      const m = mapEvent(e);
      // Pas de couverture choisie : la première photo ouverte au client sert de couverture (jamais une photo verrouillée).
      const firstOpen = !e.cover_key && photos.find((p) => p.event_id === e.id && !p.__locked);
      return { ...m, cover: e.cover_key ? m.cover : firstOpen ? `/media/preview/${firstOpen.id}` : null, photographer: names[e.created_by] || '', photographerId: e.created_by || null, totalPhotos: totals[e.id] || 0, openPhotos: opened[e.id] || 0 };
    }),
    photos: photos.map(mapPhoto),
    notifications: await clientNotifications(id, events),
    favorites: favorites.map((f) => f.photo_id),
    downloads: downloads.map(mapDownload),
    permissions,
    selections,
  };
}

async function visiblePhotos(userId, ids) {
  if (!ids.length) return [];
  return query(
    `SELECT p.*, e.allow_download, e.selection_mode, e.name AS event_name, e.created_by AS event_created_by, e.unlock_limit, e.unlock_numbers,
       (SELECT COUNT(*) FROM photos q WHERE q.event_id = p.event_id
          AND (q.position < p.position OR (q.position = p.position AND q.created_at <= p.created_at))) AS number
     FROM photos p JOIN events e ON e.id = p.event_id
     WHERE ${VISIBLE} AND p.id IN (${placeholders(ids.length)})
     ORDER BY p.position, p.created_at`,
    [userId, ...ids],
  ).then((rows) => rows.filter((p) => !isLockedFor(p, p.number)));
}

// ---------- Mes photographes ----------
// Un client peut recevoir ses photos de plusieurs photographes : il ajoute le code de chacun.
// Le code ne donne accès à aucune photo : le photographe doit encore lui publier une galerie.
const codeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 8,
  keyGenerator: (req) => `${req.user?.id || 'anon'}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Trop d’essais. Réessayez dans une heure ou demandez le bon code à votre photographe.' },
});

router.post('/photographers', codeLimiter, async (req, res) => {
  const { code } = z.object({ code: codeRule }).parse(req.body);
  const [staff] = await query("SELECT * FROM users WHERE access_code = ? AND role IN ('owner', 'admin') AND active = 1", [code]);
  if (!staff) {
    audit(req, 'client.photographer_code_failed');
    throw httpError(400, 'Code incorrect. Vérifiez-le auprès de votre photographe.');
  }
  const added = await query('INSERT INTO client_photographers (client_id, staff_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [req.user.id, staff.id]);
  if (!added.affectedRows) throw httpError(409, 'Ce photographe est déjà dans votre liste.');
  audit(req, 'client.photographer_add', { details: { photographer: staff.id } });
  const rows = await photographersOf(req.user.id);
  res.status(201).json({ photographers: rows.map(mapPhotographer), added: staff.name });
});

// ---------- Commentaires ----------
// Le propriétaire de la galerie commente ses photos ; l'équipe les voit et répond depuis le studio.
const commentBody = z.object({
  body: z.string().trim().min(1, 'Le commentaire est vide.').max(1000, 'Commentaire trop long (1000 caractères max).'),
});

router.get('/photos/:photoId/comments', async (req, res) => {
  const photoId = uuid.parse(req.params.photoId);
  const [photo] = await visiblePhotos(req.user.id, [photoId]);
  if (!photo) throw httpError(404, 'Photo introuvable.');
  const [rows, family] = await Promise.all([
    query(`${COMMENT_SELECT} WHERE c.photo_id = ? ORDER BY c.created_at`, [photoId]),
    query(`${FAMILY_COMMENT_SELECT} WHERE sc.photo_id = ? AND l.user_id = ?`, [photoId, req.user.id]),
  ]);
  res.json({
    comments: [...rows.map((c) => mapComment(c, req.user)), ...family.map((c) => mapFamilyComment(c, { canDelete: true }))].sort(byDate),
  });
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

// Espace « Commentaires » du client : les mots laissés par sa famille (liens de partage), toutes galeries confondues.
router.get('/comments', async (req, res) => {
  const [rows, [{ links }]] = await Promise.all([
    query(
      `SELECT sc.*, l.label AS share_label, p.filename, p.event_id, e.name AS event_name,
         (SELECT COUNT(*) FROM photos q WHERE q.event_id = p.event_id
            AND (q.position < p.position OR (q.position = p.position AND q.created_at <= p.created_at))) AS number
       FROM share_comments sc
       JOIN share_links l ON l.id = sc.share_id
       JOIN photos p ON p.id = sc.photo_id
       JOIN events e ON e.id = p.event_id
       WHERE l.user_id = ? AND ${VISIBLE}
       ORDER BY sc.created_at DESC LIMIT 300`,
      [req.user.id, req.user.id],
    ),
    query('SELECT COUNT(*) AS links FROM share_links WHERE user_id = ?', [req.user.id]),
  ]);
  res.json({
    links: Number(links),
    comments: rows.map((c) => ({
      ...mapFamilyComment(c, { canDelete: true }),
      photo: { id: c.photo_id, filename: c.filename, number: Number(c.number), thumb: `/media/thumb/${c.photo_id}` },
      event: { id: c.event_id, name: c.event_name },
    })),
  });
});

// Chacun peut supprimer ses propres commentaires, et le client ceux de sa famille (liens de partage).
router.delete('/comments/:id', async (req, res) => {
  const id = uuid.parse(req.params.id);
  let result = await query('DELETE FROM photo_comments WHERE id = ? AND user_id = ?', [id, req.user.id]);
  if (!result.affectedRows) {
    result = await query('DELETE FROM share_comments WHERE id = ? AND share_id IN (SELECT id FROM share_links WHERE user_id = ?)', [id, req.user.id]);
  }
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
    if (event.unlock_limit != null || event.unlock_numbers != null) {
      const all = await query('SELECT id FROM photos WHERE event_id = ? ORDER BY position, created_at', [event.id]);
      const open = new Set(all.filter((_, i) => !isLockedFor(event, i + 1)).map((p) => p.id));
      if (ids.some((pid) => !open.has(pid))) throw httpError(400, event.lock_reason || LOCK_DEFAULT_REASON);
    }
  }
  // Les demandes de retouche déjà écrites restent attachées aux photos gardées.
  const kept = Object.fromEntries((await query(
    'SELECT s.photo_id, s.note FROM photo_selections s JOIN photos p ON p.id = s.photo_id WHERE s.user_id = ? AND p.event_id = ? AND s.note IS NOT NULL',
    [req.user.id, event.id],
  )).map((r) => [r.photo_id, r.note]));
  await query(
    'DELETE FROM photo_selections WHERE user_id = ? AND photo_id IN (SELECT id FROM photos WHERE event_id = ?)',
    [req.user.id, event.id],
  );
  if (ids.length) {
    await query(`INSERT INTO photo_selections (user_id, photo_id, note) VALUES ${ids.map(() => '(?, ?, ?)').join(', ')}`,
      ids.flatMap((pid) => [req.user.id, pid, kept[pid] || null]));
  }
  res.json({ count: ids.length });
});

// Demande de retouche / commentaire du client sur une photo choisie (enregistré à la frappe). Texte vide = effacé.
router.put('/events/:id/selection/notes', async (req, res) => {
  const event = await selectionEvent(req.user.id, req.params.id);
  const { notes } = z.object({ notes: z.record(uuid, z.string().trim().max(300)) }).parse(req.body);
  for (const [photoId, text] of Object.entries(notes)) {
    await query(
      'UPDATE photo_selections SET note = ? WHERE user_id = ? AND photo_id = ? AND photo_id IN (SELECT id FROM photos WHERE event_id = ?)',
      [text || null, req.user.id, photoId, event.id],
    );
  }
  res.json({ ok: true });
});

// Envoie la sélection au studio (e-mail à l'équipe). Peut être renvoyée après modification.
router.post('/events/:id/selection/submit', async (req, res) => {
  const event = await selectionEvent(req.user.id, req.params.id);
  const { note } = z.object({ note: z.string().trim().max(2000).optional().default('') }).parse(req.body);
  const rows = await query(
    `SELECT n.number, s.note FROM photo_selections s JOIN (
       SELECT id, ROW_NUMBER() OVER (ORDER BY position, created_at) AS number FROM photos WHERE event_id = ?
     ) n ON n.id = s.photo_id WHERE s.user_id = ? ORDER BY n.number`,
    [event.id, req.user.id],
  );
  if (!rows.length) throw httpError(400, 'Choisissez au moins une photo.');
  const numbers = rows.map((r) => Number(r.number));
  await query(
    `INSERT INTO event_selections (event_id, user_id, note, photo_count, submitted_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT (event_id, user_id) DO UPDATE SET note = EXCLUDED.note, photo_count = EXCLUDED.photo_count, submitted_at = EXCLUDED.submitted_at`,
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
  for (const s of studio) if (s.id) pushLater(s.id, { title: 'Sélection reçue', body: `${req.user.name} · ${event.name} · ${numbers.length} photo${numbers.length > 1 ? 's' : ''}`, url: '/admin', tag: `selection-${event.id}` });
  const tpl = selectionEmail({ clientName: req.user.name, eventName: event.name, numbers, note, requests: rows.filter((r) => r.note).map((r) => ({ number: Number(r.number), note: r.note })) });
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
  await query('INSERT INTO favorites (user_id, photo_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [req.user.id, photoId]);
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
    photos = photos.filter((_, i) => !isLockedFor(event, i + 1));
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
    name = photos.length === 1 ? downloadName(photos[0]) : `KentraPix-selection-${photos.length}-photos.zip`;
  }
  if (!photos.length) throw httpError(400, 'Aucune photo à télécharger.');

  const id = crypto.randomUUID();
  await query(
    `INSERT INTO downloads (id, user_id, event_id, name, photo_count, photo_ids, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, req.user.id, eventId, name, photos.length, JSON.stringify(photos.map((p) => p.id)),
      utcStamp(new Date(Date.now() + DOWNLOAD_LINK_MINUTES * 60000))],
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
    return sendPrivate(res, photos[0].original_key, downloadName(photos[0]));
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
  await zipOriginals(zip, available);
});

// ---------- Partage famille ----------
// Le client crée un lien + mot de passe pour une de ses galeries (le studio peut aussi en créer pour lui) ;
// la famille regarde, télécharge si c'est permis, et commente si le lien l'autorise.
async function shareableEvent(req, id) {
  if (!(await getPermissions()).sharing) throw httpError(403, 'Le partage est désactivé.');
  const [event] = await query(`SELECT e.id FROM events e WHERE e.id = ? AND ${VISIBLE}`, [uuid.parse(id), req.user.id]);
  if (!event) throw httpError(404, 'Galerie introuvable.');
  return event;
}

router.get('/events/:id/shares', async (req, res) => {
  const event = await shareableEvent(req, req.params.id);
  const rows = await query(`${SHARE_SELECT} WHERE l.event_id = ? AND l.user_id = ? ORDER BY l.created_at DESC`, [event.id, req.user.id]);
  res.json({ shares: rows.map(mapShare) });
});

router.post('/events/:id/shares', async (req, res) => {
  const event = await shareableEvent(req, req.params.id);
  const share = await createShare({ eventId: event.id, ownerId: req.user.id, data: shareCreateSchema.parse(req.body), bcryptCost: BCRYPT_COST });
  audit(req, 'share.create', { entity: 'event', entityId: event.id });
  res.status(201).json({ share });
});

// Autoriser / retirer le téléchargement ou les commentaires sur un lien existant.
router.patch('/shares/:id', async (req, res) => {
  const data = shareUpdateSchema.parse(req.body);
  const [link] = await query('SELECT id FROM share_links WHERE id = ? AND user_id = ?', [uuid.parse(req.params.id), req.user.id]);
  if (!link) throw httpError(404, 'Lien introuvable.');
  res.json({ share: await updateShare(link.id, data) });
});

router.delete('/shares/:id', async (req, res) => {
  const result = await query('DELETE FROM share_links WHERE id = ? AND user_id = ?', [uuid.parse(req.params.id), req.user.id]);
  if (!result.affectedRows) throw httpError(404, 'Lien introuvable.');
  audit(req, 'share.delete', { entity: 'share', entityId: req.params.id });
  res.status(204).end();
});

export default router;
