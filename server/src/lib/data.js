import { z } from 'zod';
import { query, toIso } from '../db.js';

// ---------- Validation partagée ----------
export const uuid = z.string().uuid('Identifiant invalide.');

// ---------- Conversion lignes SQL -> objets attendus par le frontend ----------
export const avatarUrl = (u) => (u.avatar_key ? `/media/avatar/${u.id}?v=${u.avatar_key.split('/').pop().split('.')[0]}` : null);

export const publicUser = (u) => ({
  id: u.id,
  role: u.role,
  name: u.name,
  email: u.email,
  phone: u.phone || '',
  avatar: avatarUrl(u),
  senderName: u.sender_name || '',
  mustChangePassword: !!u.must_change_password,
});

export const mapClient = (u) => ({
  id: u.id,
  role: u.role,
  name: u.name,
  email: u.email,
  phone: u.phone || '',
  avatar: avatarUrl(u),
  active: !!u.active,
  createdAt: toIso(u.created_at),
  lastLoginAt: toIso(u.last_login_at),
});

// La couverture vient soit d'une image dédiée, soit de la première photo.
export const mapEvent = (e) => ({
  id: e.id,
  clientId: e.client_id,
  name: e.name,
  type: e.type,
  date: e.event_date,
  location: e.location || '',
  description: e.description || '',
  cover: e.cover_key
    ? `/media/cover/${e.id}?v=${e.cover_key.split('/').pop().split('.')[0]}`
    : e.first_photo_id ? `/media/preview/${e.first_photo_id}` : null,
  published: !!e.published,
  download: !!e.allow_download && !e.selection_mode,
  allowDownload: !!e.allow_download, // réglage brut (le mode sélection bloque quand même tout téléchargement)
  selectionMode: !!e.selection_mode,
  selectionLimit: e.selection_limit ?? null,
  archived: !!e.archived,
  expiresAt: e.expires_at || null,
  music: e.music_key ? `/media/music/${e.id}?v=${e.music_key.split('/').pop().split('.')[0]}` : null,
});

/** Galerie expirée : le dernier jour de disponibilité est passé (dates en UTC, format AAAA-MM-JJ). */
export const isExpired = (e) => !!e.expires_at && String(e.expires_at).slice(0, 10) < new Date().toISOString().slice(0, 10);
/** Condition SQL équivalente. */
export const NOT_EXPIRED = '(e.expires_at IS NULL OR e.expires_at >= UTC_DATE())';

export const mapPhoto = (p) => ({
  id: p.id,
  eventId: p.event_id,
  album: p.album,
  filename: p.filename,
  preview: `/media/preview/${p.id}`,
  width: p.width,
  height: p.height,
  size: Number(p.size_bytes),
  commentCount: Number(p.comment_count || 0),
  number: Number(p.number || 0),
});

/** Colonnes photo + nombre de commentaires. */
// number : numéro de la photo dans sa galerie (1, 2, 3…), utilisé par le mode sélection.
export const PHOTO_COLUMNS = `p.*, (SELECT COUNT(*) FROM photo_comments c WHERE c.photo_id = p.id) AS comment_count,
  ROW_NUMBER() OVER (PARTITION BY p.event_id ORDER BY p.position, p.created_at) AS number`;

export const mapComment = (c, viewer) => ({
  id: c.id,
  photoId: c.photo_id,
  body: c.body,
  date: toIso(c.created_at),
  author: { id: c.user_id, name: c.author_name, avatar: avatarUrl({ id: c.user_id, avatar_key: c.author_avatar }), staff: ['owner', 'admin'].includes(c.author_role) },
  mine: c.user_id === viewer.id,
});

export const COMMENT_SELECT = `SELECT c.*, u.name AS author_name, u.avatar_key AS author_avatar, u.role AS author_role
  FROM photo_comments c JOIN users u ON u.id = c.user_id`;

export const mapDownload = (d) => ({
  id: d.id,
  name: d.name,
  count: d.photo_count,
  date: toIso(d.created_at),
  ...(d.client_name ? { client: d.client_name } : {}),
});

export const EVENT_COLUMNS = `e.*, (SELECT p.id FROM photos p WHERE p.event_id = e.id ORDER BY p.position, p.created_at LIMIT 1) AS first_photo_id`;

// ---------- Autorisations globales ----------
export const PERMISSION_KEYS = ['individual', 'selection', 'event', 'favorites', 'comments', 'faces', 'signup', 'sharing'];

export async function getPermissions() {
  const rows = await query('SELECT perm_key, enabled FROM permissions');
  const perms = Object.fromEntries(PERMISSION_KEYS.map((k) => [k, false]));
  for (const r of rows) if (r.perm_key in perms) perms[r.perm_key] = !!r.enabled;
  return perms;
}

// Propriétaire : tout. Photographe (admin) : les galeries qu'il a créées. Tous : leurs galeries publiées.
export const canSeeEvent = (user, e) =>
  user.role === 'owner' ||
  (user.role === 'admin' && e.created_by === user.id) ||
  (e.client_id === user.id && !!e.published && !e.archived && !isExpired(e));
