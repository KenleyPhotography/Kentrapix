import { z } from 'zod';
import { isOpen, effectiveNumbers } from './unlock.js';
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
  notificationsSeenAt: toIso(u.notifications_seen_at),
  // Code d'accès : visible seulement par son propriétaire (équipe) ; client sans code : écran de saisie.
  accessCode: ['owner', 'admin'].includes(u.role) ? u.access_code || '' : undefined,
  whatsapp: u.whatsapp || '',
  website: u.website || '',
  instagram: u.instagram || '',
  address: u.address || '',
  bio: u.bio || '',
  needsCode: u.role === 'client' && !u.access_granted,
});

/** Photographe tel que son client le voit : profil et coordonnées qu'il a choisi de renseigner. */
export const mapPhotographer = (u) => ({
  name: u.name,
  studio: u.sender_name || '',
  avatar: avatarUrl(u),
  email: u.email,
  phone: u.phone || '',
  whatsapp: u.whatsapp || u.phone || '',
  website: u.website || '',
  instagram: u.instagram || '',
  address: u.address || '',
  bio: u.bio || '',
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
  whatsapp: u.whatsapp || '',
  pendingCode: u.role === 'client' && !u.access_granted,
  accessCode: ['owner', 'admin'].includes(u.role) ? u.access_code || '' : undefined,
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
  unlockLimit: e.unlock_limit ?? null,
  unlockNumbers: effectiveNumbers(e), // « 1-10, 15 », '' (aucune) ou null (toutes)
  lockMode: e.lock_mode || 'locked',
  lockReason: e.lock_reason || '',
  music: e.music_key ? `/media/music/${e.id}?v=${e.music_key.split('/').pop().split('.')[0]}` : null,
});

/** Galerie expirée : le dernier jour de disponibilité est passé (dates en UTC, format AAAA-MM-JJ). */
export const isExpired = (e) => !!e.expires_at && String(e.expires_at).slice(0, 10) < new Date().toISOString().slice(0, 10);
/** Date UTC 'AAAA-MM-JJ' (aujourd'hui par défaut). */
export const isoDate = (time = Date.now()) => new Date(time).toISOString().slice(0, 10);
/** Jours restants jusqu'à une date 'AAAA-MM-JJ' (0 = aujourd'hui). */
export const daysUntil = (date) => Math.round((Date.parse(String(date).slice(0, 10)) - Date.parse(isoDate())) / 86400000);
/** Condition SQL équivalente. */
export const NOT_EXPIRED = '(e.expires_at IS NULL OR e.expires_at >= CURRENT_DATE)';

/** Photo n° `number` de la galerie `e` : verrouillée par le photographe (au-delà de unlock_limit) ? */
export const isLockedFor = (e, number) => !isOpen(e, Number(number));
/** Le photographe de la galerie (et le propriétaire) voient tout ; le client, lui, est limité par unlock_limit. */
export const seesEverything = (user, e) => user.role === 'owner' || (user.role === 'admin' && e.created_by === user.id);
export const LOCK_DEFAULT_REASON = 'Votre photographe n’a pas encore débloqué ces photos.';

export const mapPhoto = (p) => (p.__locked ? {
  id: p.id, eventId: p.event_id, album: '', filename: '', preview: null, thumb: null, lockThumb: `/media/lockthumb/${p.id}`,
  width: p.width, height: p.height, size: 0, commentCount: 0, number: Number(p.number || 0), locked: true,
} : {
  id: p.id,
  eventId: p.event_id,
  album: p.album,
  filename: p.filename,
  preview: `/media/preview/${p.id}`,
  thumb: `/media/thumb/${p.id}`,
  width: p.width,
  height: p.height,
  size: Number(p.size_bytes),
  commentCount: Number(p.comment_count || 0),
  number: Number(p.number || 0),
  locked: false,
});

/** Colonnes photo + nombre de commentaires. */
// number : numéro de la photo dans sa galerie (1, 2, 3…), utilisé par le mode sélection.
// Commentaires = ceux des comptes + ceux de la famille (liens de partage).
export const PHOTO_COLUMNS = `p.*, (SELECT COUNT(*) FROM photo_comments c WHERE c.photo_id = p.id)
    + (SELECT COUNT(*) FROM share_comments sc WHERE sc.photo_id = p.id) AS comment_count,
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
export const PERMISSION_KEYS = ['individual', 'selection', 'event', 'favorites', 'comments', 'signup', 'sharing', 'share_download'];

export async function getPermissions() {
  const rows = await query('SELECT perm_key, enabled FROM permissions');
  const perms = Object.fromEntries(PERMISSION_KEYS.map((k) => [k, false]));
  for (const r of rows) if (r.perm_key in perms) perms[r.perm_key] = !!r.enabled;
  return perms;
}

// Photographe (propriétaire ou admin) : les galeries qu'il a créées. Client : ses galeries publiées.
export const canSeeEvent = (user, e) =>
  // Chaque photographe (propriétaire compris) ne voit que les galeries de ses propres clients.
  (user.role === 'owner' && (e.created_by === user.id || e.created_by == null)) ||
  (user.role === 'admin' && e.created_by === user.id) ||
  (e.client_id === user.id && !!e.published && !e.archived && !isExpired(e));
