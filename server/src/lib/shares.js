import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query, toIso } from '../db.js';
import { config } from '../config.js';
import { httpError } from './errors.js';
import { normalizeNumbers } from './unlock.js';

// Partage famille : liens + mot de passe d'une galerie, créés par le client ou par le studio,
// et commentaires laissés par la famille (sans compte). Partagé par routes/client.js et routes/admin.js.

export const MAX_LINKS = 10;

/** Liens avec leur nombre de commentaires et le nom du membre du studio qui les a créés. */
export const SHARE_SELECT = `SELECT l.*, s.name AS created_by_name,
    (SELECT COUNT(*) FROM share_comments sc WHERE sc.share_id = l.id) AS comment_count
  FROM share_links l LEFT JOIN users s ON s.id = l.created_by`;

export const mapShare = (l) => ({
  id: l.id,
  label: l.label || '',
  url: `${config.appUrl}/share?t=${l.token}`,
  allowDownload: !!l.allow_download,
  allowComments: !!l.allow_comments,
  photoNumbers: l.photo_numbers || null, // null : toutes les photos ouvertes au client
  views: Number(l.views),
  comments: Number(l.comment_count || 0),
  byStudio: l.created_by_name || null, // null : créé par le client
  lastUsedAt: toIso(l.last_used_at),
  createdAt: toIso(l.created_at),
});

export const shareCreateSchema = z.object({
  label: z.string().trim().max(120).optional(),
  allowDownload: z.boolean().optional().default(false),
  allowComments: z.boolean().optional().default(true),
  password: z.string().min(6, 'Mot de passe : 6 caractères minimum.').max(100),
  // Photos partagées : « 1-10, 15 » ; absent ou vide = toutes.
  photoNumbers: z.string().trim().max(2000).optional(),
});

export const shareUpdateSchema = z
  .object({
    label: z.string().trim().max(120).optional(),
    password: z.string().min(6, 'Mot de passe : 6 caractères minimum.').max(100).optional(), // absent = on garde l'ancien
    allowDownload: z.boolean().optional(),
    allowComments: z.boolean().optional(),
    photoNumbers: z.string().trim().max(2000).optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), 'Rien à modifier.');

/** Crée un lien pour la galerie (appartenant toujours au client : ownerId), noté « créé par le studio » si createdBy. */
export async function createShare({ eventId, ownerId, createdBy = null, data, bcryptCost }) {
  const [{ n }] = await query('SELECT COUNT(*) AS n FROM share_links WHERE event_id = ? AND user_id = ?', [eventId, ownerId]);
  if (Number(n) >= MAX_LINKS) throw httpError(400, `${MAX_LINKS} liens maximum par galerie : supprimez-en un d’abord.`);
  let photoNumbers = null;
  if (data.photoNumbers) {
    try { photoNumbers = normalizeNumbers(data.photoNumbers) || null; } catch (err) { throw httpError(400, err.message); }
  }
  const id = crypto.randomUUID();
  await query(
    `INSERT INTO share_links (id, event_id, user_id, token, password_hash, label, allow_download, allow_comments, created_by, photo_numbers)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, eventId, ownerId, crypto.randomBytes(24).toString('base64url'), await bcrypt.hash(data.password, bcryptCost),
      data.label || null, data.allowDownload ? 1 : 0, data.allowComments ? 1 : 0, createdBy, photoNumbers],
  );
  const [row] = await query(`${SHARE_SELECT} WHERE l.id = ?`, [id]);
  return mapShare(row);
}

/** Modifie un lien déjà vérifié (téléchargement et/ou commentaires). */
export async function updateShare(id, data, bcryptCost = 10) {
  const sets = [];
  const params = [];
  if (data.label !== undefined) { sets.push('label = ?'); params.push(data.label || null); }
  if (data.password !== undefined) { sets.push('password_hash = ?'); params.push(await bcrypt.hash(data.password, bcryptCost)); }
  if (data.allowDownload !== undefined) { sets.push('allow_download = ?'); params.push(data.allowDownload ? 1 : 0); }
  if (data.allowComments !== undefined) { sets.push('allow_comments = ?'); params.push(data.allowComments ? 1 : 0); }
  if (data.photoNumbers !== undefined) {
    let n = null;
    try { n = data.photoNumbers ? normalizeNumbers(data.photoNumbers) || null : null; } catch (err) { throw httpError(400, err.message); }
    sets.push('photo_numbers = ?'); params.push(n);
  }
  await query(`UPDATE share_links SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  const [row] = await query(`${SHARE_SELECT} WHERE l.id = ?`, [id]);
  return mapShare(row);
}

// ---------- Commentaires de la famille ----------
export const FAMILY_COMMENT_SELECT = `SELECT sc.*, l.label AS share_label, l.user_id AS share_owner, l.event_id
  FROM share_comments sc JOIN share_links l ON l.id = sc.share_id`;

export const familyCommentBody = z.object({
  name: z.string().trim().min(1, 'Indiquez votre prénom.').max(80, 'Prénom trop long.'),
  body: z.string().trim().min(1, 'Le commentaire est vide.').max(1000, 'Commentaire trop long (1000 caractères max).'),
});

/**
 * Même forme qu'un commentaire de compte (mapComment), avec author.family.
 * mine : écrit par ce visiteur du lien ; canDelete : le client ou le studio peut le retirer.
 */
export const mapFamilyComment = (c, { visitorId = null, canDelete = false } = {}) => ({
  id: c.id,
  photoId: c.photo_id,
  body: c.body,
  date: toIso(c.created_at),
  author: { id: null, name: c.author_name, avatar: null, staff: false, family: true, via: c.share_label || null },
  mine: Boolean(visitorId && c.visitor_id === visitorId),
  canDelete,
});

/** Commentaires de compte + de la famille, du plus ancien au plus récent. */
export const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
