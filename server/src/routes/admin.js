import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query, transaction, toIso } from '../db.js';
import { httpError } from '../lib/errors.js';
import {
  upload, uploadAudio, storePhoto, storeCover, storeMusic, removeKeys, removeWatermarks, isRemote, prepareDirectUpload, confirmDirectUpload,
} from '../lib/storage.js';
import {
  uuid, mapClient, mapEvent, mapPhoto, mapDownload, mapComment, getPermissions, PERMISSION_KEYS, EVENT_COLUMNS,
  PHOTO_COLUMNS, COMMENT_SELECT, avatarUrl,
} from '../lib/data.js';
import { audit } from '../lib/audit.js';
import { sendMail, mailConfigured, fromLine, LOGO_CID } from '../lib/mailer.js';
import {
  welcomeEmail, galleryReadyEmail, passwordResetEmail, adminInviteEmail, messageEmail, expiryEmail,
} from '../lib/emails.js';
import { requireStaff, requireOwner, STAFF_ROLES } from '../middleware/auth.js';
import { kickFaces, mergePeople, rescanEvent, removeEmptyPeople } from '../lib/faces.js';
import { config } from '../config.js';
import { BCRYPT_COST, passwordRule } from './auth.js';
import { clientBootstrap } from './client.js';
import { staffNotifications } from '../lib/notifications.js';

// Studio : propriétaire + admins. La gestion de l'équipe (/team) est réservée au propriétaire.
const router = Router();
router.use(requireStaff);

const flag = z.enum(['0', '1']).transform((v) => v === '1');
const text = (max, message) => z.string().trim().min(1, message).max(max);
const optionalText = (max) => z.string().trim().max(max).optional().transform((v) => v || null);
const sendFlag = z.boolean().optional().default(true);

/** Modification partielle : valeur envoyée, sinon valeur actuelle en base (jamais undefined). */
const keep = (data, row, key, column = key) => (data[key] !== undefined ? data[key] : row[column] ?? null);

/** Seules les couvertures dédiées (covers/) sont supprimées ; un aperçu de photo reste en place. */
const ownCover = (key) => (key?.startsWith('covers/') ? key : null);

// ---------- Photographes : chacun ne voit que ce qu'il a créé ----------
// Le propriétaire voit tout. Un admin (photographe abonné) voit ses clients, ses galeries
// et ce qui en dépend (photos, commentaires, visages, e-mails envoyés).
const isOwner = (req) => req.user.role === 'owner';
/** Filtre SQL des comptes visibles : [condition, paramètres]. */
const accountScope = (req, a = 'u') => (isOwner(req) ? ['1=1', []] : [`(${a}.created_by = ? OR ${a}.id = ?)`, [req.user.id, req.user.id]]);
/** Filtre SQL des galeries visibles. */
const eventScope = (req, e = 'e') => (isOwner(req) ? ['1=1', []] : [`${e}.created_by = ?`, [req.user.id]]);

/** Nom d'expéditeur des e-mails : celui choisi dans « Mon profil », sinon le nom du compte. */
export const senderOf = (user) => ({ fromName: user.sender_name || user.name, replyTo: user.email });
const studioName = (req) => req.user.sender_name || req.user.name;

/** Envoie un modèle d'e-mail à un compte et renvoie le résultat ({status, error}) au frontend. */
const mailTo = (req, account, template, extra = {}) =>
  sendMail({ to: account.email, userId: account.id, sentBy: req.user.id, ...senderOf(req.user), ...template, ...extra });

// ---------- Tableau de bord ----------
router.get('/bootstrap', async (req, res) => {
  const [as, ap] = accountScope(req);
  const [es, ep] = eventScope(req);
  const [people, events, photos, downloads, activity, [storage], permissions, selections] = await Promise.all([
    query(`SELECT * FROM users u WHERE ${as} ORDER BY name`, ap),
    query(`SELECT ${EVENT_COLUMNS} FROM events e WHERE ${es} ORDER BY e.event_date DESC, e.created_at DESC`, ep),
    query(
      `SELECT ${PHOTO_COLUMNS} FROM photos p JOIN events e ON e.id = p.event_id WHERE ${es}
       ORDER BY e.event_date DESC, e.created_at DESC, p.position, p.created_at`, ep,
    ),
    query(
      `SELECT d.*, u.name AS client_name FROM downloads d JOIN users u ON u.id = d.user_id
       WHERE ${as} ORDER BY d.created_at DESC LIMIT 100`, ap,
    ),
    query(
      `SELECT u.id, u.name, u.avatar_key,
         (SELECT COUNT(*) FROM favorites f WHERE f.user_id = u.id) AS favorites,
         (SELECT COALESCE(SUM(d.photo_count), 0) FROM downloads d WHERE d.user_id = u.id) AS downloads,
         u.last_login_at
       FROM users u WHERE u.role = 'client' AND ${as} ORDER BY u.name`, ap,
    ),
    query(`SELECT COALESCE(SUM(p.size_bytes), 0) AS originals, COALESCE(SUM(p.preview_bytes), 0) AS previews
       FROM photos p JOIN events e ON e.id = p.event_id WHERE ${es}`, ep),
    getPermissions(),
    query(
      `SELECT s.event_id, s.user_id, s.photo_count, s.submitted_at, u.name
       FROM event_selections s JOIN users u ON u.id = s.user_id JOIN events e ON e.id = s.event_id
       WHERE s.submitted_at IS NOT NULL AND ${es} ORDER BY s.submitted_at DESC`, ep,
    ),
  ]);
  const accounts = people.map(mapClient);
  res.json({
    accounts, // tous les comptes : peuvent tous recevoir des galeries
    clients: accounts.filter((a) => a.role === 'client'),
    // L'équipe n'est visible que par le propriétaire.
    team: isOwner(req) ? accounts.filter((a) => STAFF_ROLES.includes(a.role)) : [],
    events: events.map(mapEvent),
    photos: photos.map(mapPhoto),
    downloads: downloads.map(mapDownload),
    favorites: [],
    activity: activity.map((a) => ({
      id: a.id, name: a.name, avatar: avatarUrl(a), favorites: Number(a.favorites), downloads: Number(a.downloads), lastLoginAt: toIso(a.last_login_at),
    })),
    stats: { storageBytes: Number(storage.originals) + Number(storage.previews) },
    permissions,
    // Photos en ligne : le navigateur les envoie directement au bucket (sans passer par ce serveur).
    upload: { direct: isRemote, maxMb: config.maxUploadMb, previewWidth: config.previewWidth },
    mail: { configured: mailConfigured(), from: fromLine(studioName(req)) },
    selections: selections.map((s) => ({
      eventId: s.event_id, userId: s.user_id, name: s.name, count: s.photo_count, submittedAt: toIso(s.submitted_at),
    })),
    notifications: await staffNotifications({ scope: [es, ep], owner: isOwner(req), events, selections }),
  });
});

// ---------- Comptes ----------
const accountSchema = z.object({
  name: text(120, 'Le nom est obligatoire.'),
  email: z.string().trim().toLowerCase().email('Adresse e-mail invalide.').max(190),
  phone: optionalText(40),
});

async function findAccount(req, id, roles) {
  const [as, ap] = accountScope(req);
  const [user] = await query(`SELECT * FROM users u WHERE u.id = ? AND ${as}`, [uuid.parse(id), ...ap]);
  if (!user || (roles && !roles.includes(user.role))) throw httpError(404, 'Compte introuvable.');
  return user;
}
const findClient = (req, id) => findAccount(req, id, ['client']);

async function createAccount(req, role, data) {
  const id = crypto.randomUUID();
  const hash = await bcrypt.hash(data.password, BCRYPT_COST);
  // Mot de passe temporaire : à changer à la première connexion.
  await query(
    `INSERT INTO users (id, role, created_by, name, email, phone, password_hash, must_change_password)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    [id, role, req.user.id, data.name, data.email, data.phone ?? null, hash],
  );
  return findAccount(req, id);
}

async function setTemporaryPassword(account, password) {
  const hash = await bcrypt.hash(password, BCRYPT_COST);
  await query(
    'UPDATE users SET password_hash = ?, must_change_password = 1, token_version = token_version + 1 WHERE id = ?',
    [hash, account.id],
  );
}

// ---------- Clients (propriétaire et admins) ----------
router.post('/clients', async (req, res) => {
  const data = accountSchema.extend({ password: passwordRule, sendEmail: sendFlag }).parse(req.body);
  const client = await createAccount(req, 'client', data);
  audit(req, 'client.create', { entity: 'user', entityId: client.id, details: { email: data.email } });
  const email = data.sendEmail ? await mailTo(req, client, welcomeEmail({ ...client, password: data.password, studio: studioName(req) }), { kind: 'welcome' }) : null;
  res.status(201).json({ client: mapClient(client), email });
});

router.patch('/clients/:id', async (req, res) => {
  const client = await findClient(req, req.params.id);
  const data = accountSchema.extend({ active: z.boolean() }).partial().parse(req.body);
  const active = keep(data, client, 'active');
  // Désactiver un compte ferme immédiatement ses sessions.
  const revoke = !active && client.active ? 1 : 0;
  await query(
    'UPDATE users SET name = ?, email = ?, phone = ?, active = ?, token_version = token_version + ? WHERE id = ?',
    [keep(data, client, 'name'), keep(data, client, 'email'), keep(data, client, 'phone'), active ? 1 : 0, revoke, client.id],
  );
  audit(req, data.active === undefined ? 'client.update' : active ? 'client.activate' : 'client.deactivate', { entity: 'user', entityId: client.id });
  res.json({ client: mapClient(await findClient(req, client.id)) });
});

router.post('/clients/:id/password', async (req, res) => {
  const client = await findClient(req, req.params.id);
  const { password, sendEmail } = z.object({ password: passwordRule, sendEmail: sendFlag }).parse(req.body);
  await setTemporaryPassword(client, password);
  audit(req, 'client.password_reset', { entity: 'user', entityId: client.id });
  const email = sendEmail ? await mailTo(req, client, passwordResetEmail({ ...client, password, studio: studioName(req) }), { kind: 'password_reset' }) : null;
  res.json({ email });
});

// Message libre à n'importe quel compte.
router.post('/accounts/:id/message', async (req, res) => {
  const account = await findAccount(req, req.params.id);
  const { subject, message } = z
    .object({ subject: text(150, 'L’objet est obligatoire.'), message: text(5000, 'Le message est vide.') })
    .parse(req.body);
  const email = await mailTo(req, account, messageEmail({ name: account.name, subject, message, studio: studioName(req) }), { kind: 'message' });
  audit(req, 'email.message', { entity: 'user', entityId: account.id, details: { subject, status: email.status } });
  res.json({ email });
});

// Aperçu : l'espace d'un compte exactement comme il le voit (lecture seule côté frontend).
router.get('/clients/:id/preview', async (req, res) => {
  const account = await findAccount(req, req.params.id);
  const [{ hidden }] = await query(
    'SELECT COUNT(*) AS hidden FROM events WHERE client_id = ? AND (published = 0 OR archived = 1)',
    [account.id],
  );
  res.json({ client: mapClient(account), hiddenEvents: Number(hidden), ...(await clientBootstrap(account.id)) });
});

// ---------- Équipe (propriétaire uniquement) ----------
// Nouvel admin : compte créé avec un mot de passe temporaire.
router.post('/team', requireOwner, async (req, res) => {
  const data = accountSchema.extend({ password: passwordRule, sendEmail: sendFlag }).parse(req.body);
  const admin = await createAccount(req, 'admin', data);
  audit(req, 'team.create', { entity: 'user', entityId: admin.id, details: { email: data.email } });
  const email = data.sendEmail ? await mailTo(req, admin, adminInviteEmail({ ...admin, password: data.password }), { kind: 'admin_invite' }) : null;
  res.status(201).json({ account: mapClient(admin), email });
});

// Nommer admin un compte existant, le repasser client, ou (dés)activer un admin.
router.patch('/team/:id', requireOwner, async (req, res) => {
  const account = await findAccount(req, req.params.id);
  if (account.role === 'owner') throw httpError(403, 'Le compte propriétaire ne peut pas être modifié ici.');
  const data = z
    .object({ role: z.enum(['admin', 'client']).optional(), active: z.boolean().optional(), sendEmail: sendFlag })
    .parse(req.body);
  const role = data.role ?? account.role;
  const active = data.active ?? !!account.active;
  // Changer de rôle ou désactiver ferme les sessions ouvertes.
  const revoke = role !== account.role || (!active && account.active) ? 1 : 0;
  await query('UPDATE users SET role = ?, active = ?, token_version = token_version + ? WHERE id = ?', [
    role, active ? 1 : 0, revoke, account.id,
  ]);
  const promoted = account.role !== 'admin' && role === 'admin';
  audit(req, promoted ? 'team.promote' : role !== account.role ? 'team.demote' : active ? 'team.activate' : 'team.deactivate', {
    entity: 'user', entityId: account.id,
  });
  const email = promoted && data.sendEmail ? await mailTo(req, account, adminInviteEmail({ ...account }), { kind: 'admin_invite' }) : null;
  res.json({ account: mapClient(await findAccount(req, account.id)), email });
});

router.post('/team/:id/password', requireOwner, async (req, res) => {
  const account = await findAccount(req, req.params.id, ['admin']);
  const { password, sendEmail } = z.object({ password: passwordRule, sendEmail: sendFlag }).parse(req.body);
  await setTemporaryPassword(account, password);
  audit(req, 'team.password_reset', { entity: 'user', entityId: account.id });
  const email = sendEmail ? await mailTo(req, account, passwordResetEmail({ ...account, password }), { kind: 'password_reset' }) : null;
  res.json({ email });
});

// ---------- E-mails ----------
router.get('/emails', async (req, res) => {
  const rows = await query(
    `SELECT l.*, u.name AS user_name, s.name AS sender_name FROM email_log l
     LEFT JOIN users u ON u.id = l.user_id LEFT JOIN users s ON s.id = l.sent_by
     ${isOwner(req) ? '' : 'WHERE l.sent_by = ?'} ORDER BY l.id DESC LIMIT 100`,
    isOwner(req) ? [] : [req.user.id],
  );
  res.json({
    configured: mailConfigured(),
    from: fromLine(studioName(req)),
    emails: rows.map((r) => ({
      id: Number(r.id), kind: r.kind, to: r.to_email, name: r.user_name, subject: r.subject,
      status: r.status, error: r.error, sender: r.sender_name, date: toIso(r.created_at),
    })),
  });
});

// Espace de test : aperçu et envoi d'un modèle avec des données d'exemple.
const SAMPLES = {
  welcome: (name, studio) => welcomeEmail({ name, studio, email: 'client@exemple.com', password: 'Exemple-2026' }),
  gallery_ready: (name, studio) => galleryReadyEmail({ name, studio, eventName: 'Mariage de Marie & Jean', count: 248 }),
  expiry: (name, studio) => expiryEmail({ name, studio, eventName: 'Mariage de Marie & Jean', expiresAt: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10), daysLeft: 7 }),
  password_reset: (name, studio) => passwordResetEmail({ name, studio, email: 'client@exemple.com', password: 'Exemple-2026' }),
  admin_invite: (name, studio) => adminInviteEmail({ name, studio, email: 'admin@exemple.com', password: 'Exemple-2026' }),
  message: (name, studio) => messageEmail({ name, studio, subject: `Un message de ${studio}`, message: 'Merci pour votre confiance !\nVos photos arrivent très bientôt.' }),
};
const sampleKind = z.enum(Object.keys(SAMPLES), { message: 'Modèle inconnu.' });

router.get('/emails/preview/:kind', async (req, res) => {
  const tpl = SAMPLES[sampleKind.parse(req.params.kind)](req.user.name, studioName(req));
  // Aperçu dans le navigateur : le logo joint (cid:) est remplacé par le fichier du site.
  res.json({ subject: tpl.subject, html: tpl.html.replaceAll(`cid:${LOGO_CID}`, '/logo/kentrapix-email.png') });
});

router.post('/emails/test', async (req, res) => {
  const { kind, to } = z
    .object({ kind: sampleKind, to: z.string().trim().toLowerCase().email('Adresse e-mail invalide.').max(190) })
    .parse(req.body);
  const tpl = SAMPLES[kind](req.user.name, studioName(req));
  const email = await sendMail({ to, ...senderOf(req.user), ...tpl, subject: `[Test] ${tpl.subject}`, kind: 'test', sentBy: req.user.id });
  res.json({ email });
});

// ---------- Événements ----------
async function findEvent(req, id) {
  const [es, ep] = eventScope(req);
  const [event] = await query(`SELECT ${EVENT_COLUMNS} FROM events e WHERE e.id = ? AND ${es}`, [uuid.parse(id), ...ep]);
  if (!event) throw httpError(404, 'Événement introuvable.');
  return event;
}

/** E-mail « Vos photos sont prêtes » au propriétaire de la galerie. */
async function notifyGallery(req, event) {
  const owner = await findAccount(req, event.client_id);
  const [{ count }] = await query('SELECT COUNT(*) AS count FROM photos WHERE event_id = ?', [event.id]);
  const result = await mailTo(req, owner, galleryReadyEmail({ name: owner.name, eventName: event.name, count: Number(count), studio: studioName(req) }), {
    kind: 'gallery_ready', eventId: event.id,
  });
  if (result.status === 'sent') await query('UPDATE events SET notified_at = CURRENT_TIMESTAMP WHERE id = ?', [event.id]);
  return result;
}

// Une galerie peut appartenir à n'importe quel compte actif : client, admin ou propriétaire.
const eventSchema = z.object({
  clientId: uuid,
  name: text(160, 'Le nom est obligatoire.'),
  type: text(80, 'Le type est obligatoire.'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide.'),
  location: optionalText(160),
  description: optionalText(5000),
});

router.post('/events', upload.single('coverFile'), async (req, res) => {
  let coverKey = null;
  try {
    const data = eventSchema.parse(req.body);
    await findAccount(req, data.clientId);
    if (req.file) coverKey = await storeCover(req.file);
    const id = crypto.randomUUID();
    await query(
      `INSERT INTO events (id, client_id, created_by, name, type, event_date, location, description, cover_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.clientId, req.user.id, data.name, data.type, data.date, data.location, data.description, coverKey],
    );
    audit(req, 'event.create', { entity: 'event', entityId: id, details: { name: data.name } });
    res.status(201).json({ event: mapEvent(await findEvent(req, id)) });
  } catch (err) {
    await removeKeys([coverKey]);
    throw err;
  }
});

const eventPatchSchema = eventSchema
  .extend({
    published: flag, download: flag, archived: flag, notify: flag, selectionMode: flag,
    selectionLimit: z.string().trim().regex(/^\d*$/, 'Nombre maximum invalide.').transform((v) => (v ? Number(v) : null)),
    // Dernier jour de disponibilité ('' = pas d'expiration).
    expiresAt: z.string().trim().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Date d’expiration invalide.').transform((v) => v || null),
  })
  .partial();

router.patch('/events/:id', upload.single('coverFile'), async (req, res) => {
  const event = await findEvent(req, req.params.id);
  const data = eventPatchSchema.parse(req.body);
  if (data.clientId) await findAccount(req, data.clientId);
  const coverKey = req.file ? await storeCover(req.file) : event.cover_key;
  const published = !!keep(data, event, 'published');
  const archived = !!keep(data, event, 'archived');
  await query(
    `UPDATE events SET client_id = ?, name = ?, type = ?, event_date = ?, location = ?, description = ?,
       cover_key = ?, published = ?, allow_download = ?, archived = ?, selection_mode = ?, selection_limit = ?,
       published_at = CASE WHEN ? = 1 AND published_at IS NULL THEN CURRENT_TIMESTAMP ELSE published_at END,
       expiry_notified_at = CASE WHEN expires_at IS NOT DISTINCT FROM ? THEN expiry_notified_at END, expires_at = ? WHERE id = ?`,
    [
      keep(data, event, 'clientId', 'client_id'), keep(data, event, 'name'), keep(data, event, 'type'),
      keep(data, event, 'date', 'event_date'), keep(data, event, 'location'), keep(data, event, 'description'),
      coverKey,
      published ? 1 : 0,
      keep(data, event, 'download', 'allow_download') ? 1 : 0,
      archived ? 1 : 0,
      keep(data, event, 'selectionMode', 'selection_mode') ? 1 : 0,
      data.selectionLimit !== undefined ? data.selectionLimit || null : event.selection_limit,
      published ? 1 : 0, // première publication : notification « nouvelle galerie »
      // Nouvelle date d'expiration : le rappel « 7 jours » pourra repartir.
      keep(data, event, 'expiresAt', 'expires_at'), keep(data, event, 'expiresAt', 'expires_at'),
      event.id,
    ],
  );
  if (req.file) await removeKeys([ownCover(event.cover_key)]);
  const { notify, ...changes } = data;
  audit(req, 'event.update', { entity: 'event', entityId: event.id, details: { ...changes, cover: !!req.file } });
  const updated = await findEvent(req, event.id);
  // Galerie qui devient visible : e-mail automatique « Vos photos sont prêtes ».
  const becameVisible = published && !archived && !(event.published && !event.archived);
  const email = becameVisible && notify !== false ? await notifyGallery(req, updated) : null;
  res.json({ event: mapEvent(updated), email });
});

// Sélection reçue pour une galerie : numéros + aperçus + message.
router.get('/events/:id/selection', async (req, res) => {
  const event = await findEvent(req, req.params.id);
  const photos = await query(
    `SELECT n.id, n.number, n.filename, s.user_id FROM photo_selections s JOIN (
       SELECT id, filename, ROW_NUMBER() OVER (ORDER BY position, created_at) AS number FROM photos WHERE event_id = ?
     ) n ON n.id = s.photo_id ORDER BY n.number`,
    [event.id],
  );
  const sent = await query(
    'SELECT s.*, u.name FROM event_selections s JOIN users u ON u.id = s.user_id WHERE s.event_id = ?',
    [event.id],
  );
  const people = [...new Set(photos.map((p) => p.user_id).concat(sent.map((s) => s.user_id)))];
  res.json({
    selections: await Promise.all(people.map(async (uid) => {
      const s = sent.find((x) => x.user_id === uid);
      const [u] = s ? [s] : await query('SELECT name FROM users WHERE id = ?', [uid]);
      const mine = photos.filter((p) => p.user_id === uid);
      return {
        userId: uid, name: u?.name || '—', note: s?.note || '', submittedAt: toIso(s?.submitted_at),
        photos: mine.map((p) => ({ id: p.id, number: Number(p.number), filename: p.filename, preview: `/media/preview/${p.id}` })),
      };
    })),
  });
});

// Renvoyer l'e-mail « Vos photos sont prêtes » (galerie déjà publiée).
router.post('/events/:id/notify', async (req, res) => {
  const event = await findEvent(req, req.params.id);
  if (!event.published || event.archived) throw httpError(400, 'Publiez d’abord la galerie.');
  res.json({ email: await notifyGallery(req, event) });
});

router.delete('/events/:id', async (req, res) => {
  const event = await findEvent(req, req.params.id);
  const photos = await query('SELECT id, original_key, preview_key, thumb_key FROM photos WHERE event_id = ?', [event.id]);
  await query('DELETE FROM events WHERE id = ?', [event.id]); // photos et favoris : ON DELETE CASCADE
  await removeKeys([ownCover(event.cover_key), event.music_key, ...photos.flatMap((p) => [p.original_key, p.preview_key, p.thumb_key])]);
  await Promise.all(photos.map((p) => removeWatermarks(p.id)));
  audit(req, 'event.delete', { entity: 'event', entityId: event.id, details: { name: event.name, photos: photos.length } });
  res.status(204).end();
});

router.post('/events/:id/cover', async (req, res) => {
  const event = await findEvent(req, req.params.id);
  const { photoId } = z.object({ photoId: uuid }).parse(req.body);
  const [photo] = await query('SELECT preview_key FROM photos WHERE id = ? AND event_id = ?', [photoId, event.id]);
  if (!photo) throw httpError(404, 'Photo introuvable dans cet événement.');
  await query('UPDATE events SET cover_key = ? WHERE id = ?', [photo.preview_key, event.id]);
  await removeKeys([ownCover(event.cover_key)]);
  res.json({ event: mapEvent(await findEvent(req, event.id)) });
});

// Musique du diaporama : un fichier audio par galerie.
router.post('/events/:id/music', uploadAudio.single('music'), async (req, res) => {
  const event = await findEvent(req, req.params.id);
  if (!req.file) throw httpError(400, 'Choisissez un fichier audio (MP3, M4A, AAC, OGG, WAV — 20 Mo max).');
  const key = await storeMusic(req.file);
  await query('UPDATE events SET music_key = ? WHERE id = ?', [key, event.id]);
  await removeKeys([event.music_key]);
  audit(req, 'event.music', { entity: 'event', entityId: event.id });
  res.json({ event: mapEvent(await findEvent(req, event.id)) });
});

router.delete('/events/:id/music', async (req, res) => {
  const event = await findEvent(req, req.params.id);
  await query('UPDATE events SET music_key = NULL WHERE id = ?', [event.id]);
  await removeKeys([event.music_key]);
  res.json({ event: mapEvent(await findEvent(req, event.id)) });
});

// ---------- Photos ----------
/** Enregistre une photo déjà stockée (originale + aperçu) dans la galerie. */
async function insertPhoto(event, album, filename, stored) {
  try {
    const id = crypto.randomUUID();
    await query(
      `INSERT INTO photos (id, event_id, album, filename, original_key, preview_key, mime, size_bytes,
         preview_bytes, width, height, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM photos WHERE event_id = ?))`,
      [id, event.id, album, filename, stored.originalKey, stored.previewKey, stored.mime, stored.sizeBytes,
        stored.previewBytes, stored.width, stored.height, event.id],
    );
    const [photo] = await query('SELECT * FROM photos WHERE id = ?', [id]);
    kickFaces(); // analyse des visages en arrière-plan
    return mapPhoto(photo);
  } catch (err) {
    await removeKeys([stored.originalKey, stored.previewKey]);
    throw err;
  }
}

const albumName = (v) => z.string().trim().max(80).optional().parse(v) || 'Nouveaux imports';

// Import par le serveur (mode local, ou formats que le navigateur ne sait pas lire).
router.post('/events/:id/photos', upload.single('photo'), async (req, res) => {
  const event = await findEvent(req, req.params.id);
  if (!req.file) throw httpError(400, 'Choisissez une image.');
  const album = albumName(req.body.album);
  const stored = await storePhoto(req.file, { previewOnly: !!event.selection_mode });
  const filename = Buffer.from(req.file.originalname, 'latin1').toString('utf8').slice(0, 255);
  res.status(201).json({ photo: await insertPhoto(event, album, filename, stored) });
});

// Import direct (photos en ligne) : 1) adresses signées, 2) le navigateur envoie au bucket, 3) confirmation.
const directSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  type: z.string().max(40),
  size: z.number().int().positive(),
});

router.post('/events/:id/uploads', async (req, res) => {
  if (!isRemote) throw httpError(400, 'Envoi direct indisponible : stockage local.');
  const event = await findEvent(req, req.params.id);
  // Mode sélection : photos compressées dans le navigateur, l'original (souvent un RAW) n'est pas envoyé.
  res.json(await prepareDirectUpload(directSchema.parse(req.body), { previewOnly: !!event.selection_mode }));
});

router.post('/events/:id/uploads/complete', async (req, res) => {
  if (!isRemote) throw httpError(400, 'Envoi direct indisponible : stockage local.');
  const event = await findEvent(req, req.params.id);
  const data = directSchema.extend({
    id: uuid, ext: z.enum(['jpg', 'png', 'webp', 'avif']).optional(), ticket: z.string().max(100), album: z.string().optional(),
    previewOnly: z.boolean().optional(),
  }).parse(req.body);
  const stored = await confirmDirectUpload(data);
  res.status(201).json({ photo: await insertPhoto(event, albumName(data.album), data.filename, stored) });
});

async function findPhoto(req, id) {
  const [es, ep] = eventScope(req);
  const [photo] = await query(`SELECT p.* FROM photos p JOIN events e ON e.id = p.event_id WHERE p.id = ? AND ${es}`, [uuid.parse(id), ...ep]);
  if (!photo) throw httpError(404, 'Photo introuvable.');
  return photo;
}

router.patch('/photos/:id', async (req, res) => {
  const photo = await findPhoto(req, req.params.id);
  const { album } = z.object({ album: text(80, 'Le nom de l’album est obligatoire.') }).parse(req.body);
  await query('UPDATE photos SET album = ? WHERE id = ?', [album, photo.id]);
  res.json({ photo: mapPhoto({ ...photo, album }) });
});

router.post('/photos/:id/move-up', async (req, res) => {
  await findPhoto(req, req.params.id);
  await transaction(async (conn) => {
    const [[photo]] = await conn.execute('SELECT id, event_id, position FROM photos WHERE id = ? FOR UPDATE', [uuid.parse(req.params.id)]);
    if (!photo) throw httpError(404, 'Photo introuvable.');
    const [[prev]] = await conn.execute(
      'SELECT id, position FROM photos WHERE event_id = ? AND position < ? ORDER BY position DESC LIMIT 1 FOR UPDATE',
      [photo.event_id, photo.position],
    );
    if (!prev) return;
    await conn.execute('UPDATE photos SET position = ? WHERE id = ?', [prev.position, photo.id]);
    await conn.execute('UPDATE photos SET position = ? WHERE id = ?', [photo.position, prev.id]);
  });
  res.status(204).end();
});

router.delete('/photos/:id', async (req, res) => {
  const photo = await findPhoto(req, req.params.id);
  await query('UPDATE events SET cover_key = NULL WHERE id = ? AND cover_key = ?', [photo.event_id, photo.preview_key]);
  const faces = await query('SELECT id FROM photo_faces WHERE photo_id = ?', [photo.id]);
  await query('DELETE FROM photos WHERE id = ?', [photo.id]);
  await removeKeys([photo.original_key, photo.preview_key, photo.thumb_key, ...faces.map((f) => `faces/${f.id}.webp`)]);
  await removeEmptyPeople();
  await removeWatermarks(photo.id);
  audit(req, 'photo.delete', { entity: 'photo', entityId: photo.id, details: { filename: photo.filename, eventId: photo.event_id } });
  res.status(204).end();
});

// ---------- Commentaires ----------
router.get('/comments', async (req, res) => {
  const rows = await query(
    `SELECT c.*, u.name AS author_name, u.avatar_key AS author_avatar, u.role AS author_role,
       p.filename, p.event_id, e.name AS event_name, o.name AS owner_name
     FROM photo_comments c
     JOIN users u ON u.id = c.user_id
     JOIN photos p ON p.id = c.photo_id
     JOIN events e ON e.id = p.event_id
     JOIN users o ON o.id = e.client_id
     WHERE ${eventScope(req)[0]} ORDER BY c.created_at DESC LIMIT 200`,
    eventScope(req)[1],
  );
  res.json({
    comments: rows.map((c) => ({
      ...mapComment(c, req.user),
      photo: { id: c.photo_id, filename: c.filename, preview: `/media/preview/${c.photo_id}` },
      event: { id: c.event_id, name: c.event_name, owner: c.owner_name },
    })),
  });
});

router.get('/photos/:id/comments', async (req, res) => {
  const photo = await findPhoto(req, req.params.id);
  const rows = await query(`${COMMENT_SELECT} WHERE c.photo_id = ? ORDER BY c.created_at`, [photo.id]);
  res.json({ comments: rows.map((c) => mapComment(c, req.user)) });
});

// Réponse du studio sous une photo.
router.post('/photos/:id/comments', async (req, res) => {
  const photo = await findPhoto(req, req.params.id);
  const { body } = z.object({ body: text(1000, 'Le commentaire est vide.') }).parse(req.body);
  const id = crypto.randomUUID();
  await query('INSERT INTO photo_comments (id, photo_id, user_id, body) VALUES (?, ?, ?, ?)', [id, photo.id, req.user.id, body]);
  audit(req, 'comment.reply', { entity: 'photo', entityId: photo.id });
  const [row] = await query(`${COMMENT_SELECT} WHERE c.id = ?`, [id]);
  res.status(201).json({ comment: mapComment(row, req.user) });
});

// L'équipe peut supprimer n'importe quel commentaire (modération).
router.delete('/comments/:id', async (req, res) => {
  const [es, ep] = eventScope(req);
  const result = await query(
    `DELETE FROM photo_comments WHERE id = ? AND photo_id IN (SELECT p.id FROM photos p JOIN events e ON e.id = p.event_id WHERE ${es})`,
    [uuid.parse(req.params.id), ...ep],
  );
  if (!result.affectedRows) throw httpError(404, 'Commentaire introuvable.');
  audit(req, 'comment.delete', { entity: 'comment', entityId: req.params.id });
  res.status(204).end();
});

// ---------- Visages ----------
router.get('/events/:id/people', async (req, res) => {
  const event = await findEvent(req, req.params.id);
  const [people, [status]] = await Promise.all([
    query(
      `SELECT pe.id, pe.name, pe.hidden, COUNT(DISTINCT f.photo_id) AS photo_count,
         (SELECT f2.id FROM photo_faces f2 WHERE f2.person_id = pe.id ORDER BY f2.score DESC, f2.created_at, f2.id LIMIT 1) AS face_id
       FROM people pe JOIN photo_faces f ON f.person_id = pe.id
       WHERE pe.event_id = ? GROUP BY pe.id ORDER BY pe.name IS NULL, pe.name, photo_count DESC`,
      [event.id],
    ),
    query(
      `SELECT SUM(CASE WHEN faces_status IN ('pending', 'processing') THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN faces_status = 'done' THEN 1 ELSE 0 END) AS done,
         SUM(CASE WHEN faces_status = 'failed' THEN 1 ELSE 0 END) AS failed, COUNT(*) AS total FROM photos WHERE event_id = ?`,
      [event.id],
    ),
  ]);
  res.json({
    people: people.map((p) => ({
      id: p.id, name: p.name, hidden: !!p.hidden, photoCount: Number(p.photo_count), face: `/media/face/${p.face_id}`,
    })),
    status: { pending: Number(status.pending || 0), done: Number(status.done || 0), failed: Number(status.failed || 0), total: Number(status.total) },
  });
});

async function findPerson(req, id) {
  const [es, ep] = eventScope(req);
  const [person] = await query(`SELECT pe.* FROM people pe JOIN events e ON e.id = pe.event_id WHERE pe.id = ? AND ${es}`, [uuid.parse(id), ...ep]);
  if (!person) throw httpError(404, 'Personne introuvable.');
  return person;
}

router.patch('/people/:id', async (req, res) => {
  const person = await findPerson(req, req.params.id);
  const data = z.object({
    name: z.string().trim().max(120).optional().transform((v) => (v === undefined ? undefined : v || null)),
    hidden: z.boolean().optional(),
  }).parse(req.body);
  await query('UPDATE people SET name = ?, hidden = ? WHERE id = ?', [
    data.name !== undefined ? data.name : person.name,
    (data.hidden ?? !!person.hidden) ? 1 : 0,
    person.id,
  ]);
  audit(req, 'people.update', { entity: 'person', entityId: person.id, details: { name: data.name, hidden: data.hidden } });
  res.status(204).end();
});

router.post('/people/:id/merge', async (req, res) => {
  const from = await findPerson(req, req.params.id);
  const { intoId } = z.object({ intoId: uuid }).parse(req.body);
  const into = await findPerson(req, intoId);
  if (from.event_id !== into.event_id || from.id === into.id) throw httpError(400, 'Fusion impossible entre ces personnes.');
  await mergePeople(from.id, into.id);
  audit(req, 'people.merge', { entity: 'person', entityId: into.id, details: { from: from.id } });
  res.status(204).end();
});

router.post('/events/:id/faces/rescan', async (req, res) => {
  const event = await findEvent(req, req.params.id);
  await rescanEvent(event.id);
  audit(req, 'faces.rescan', { entity: 'event', entityId: event.id });
  res.status(202).json({ ok: true });
});

// ---------- Autorisations ----------
router.put('/permissions', requireOwner, async (req, res) => {
  const shape = Object.fromEntries(PERMISSION_KEYS.map((k) => [k, z.boolean().optional()]));
  const data = z.object(shape).strict().parse(req.body);
  for (const [key, enabled] of Object.entries(data)) {
    if (enabled !== undefined) await query('UPDATE permissions SET enabled = ? WHERE perm_key = ?', [enabled ? 1 : 0, key]);
  }
  audit(req, 'permissions.update', { entity: 'permissions', details: data });
  res.json({ permissions: await getPermissions() });
});

export default router;
