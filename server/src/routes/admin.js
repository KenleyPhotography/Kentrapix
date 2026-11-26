import { publicServices, bookingStaff, publicPhotographers } from '../lib/public-services.js';
import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { query, transaction, toIso } from '../db.js';
import { httpError } from '../lib/errors.js';
import {
  upload, uploadAudio, readFile, storePhoto, storeCover, storeMusic, removeKeys, removeWatermarks, isRemote, prepareDirectUpload, confirmDirectUpload,
  storedName,
} from '../lib/storage.js';
import {
  uuid, mapClient, mapEvent, mapPhoto, mapDownload, mapComment, getPermissions, PERMISSION_KEYS, EVENT_COLUMNS,
  PHOTO_COLUMNS, COMMENT_SELECT, avatarUrl,
} from '../lib/data.js';
import { audit } from '../lib/audit.js';
import { pushLater } from '../lib/push.js';
import { sendMail, mailConfigured, fromLine, LOGO_CID } from '../lib/mailer.js';
import {
  welcomeEmail, galleryReadyEmail, passwordResetEmail, adminInviteEmail, messageEmail, expiryEmail, announcementEmail,
  clientLinkedEmail,
} from '../lib/emails.js';
import { kickAnnouncements } from '../lib/announcements.js';
import { requireStaff, requireOwner, STAFF_ROLES, requireStudio } from '../middleware/auth.js';
import { freshCode } from '../lib/accessCode.js';
import { scanOrphans, cleanOrphans } from '../lib/cleanup.js';
import {
  isPlatformOwner, listBackups, createBackup, pruneBackups, openBackup, deleteBackup, restoreBackup, mirrorConfig, mirrorFiles,
} from '../lib/backup.js';
import { normalizeNumbers } from '../lib/unlock.js';
const LOCK_LEVELS = [2.5, 6, 12]; // niveaux de flou proposés pour les photos verrouillées
import { isOwner, accountScope, clientScope, eventScope } from '../lib/scope.js';
import { billingRouter } from './billing.js';
import { staffContracts, staffWebContracts } from './contracts.js';
import { staffReviews } from './reviews.js';
import { staffTodo } from './todo.js';
import { staffBooking } from './booking.js';
import { staffPortfolio } from './portfolio.js';
import { visitStats } from '../lib/visits.js';
import { maintenanceState, setMaintenance, DEFAULT_TITLE, DEFAULT_MESSAGE } from '../lib/maintenance.js';
import { staffOrders } from './orders.js';
import { config } from '../config.js';
import { passwordRule } from './auth.js';
import { hashPassword } from '../lib/passwords.js';
import { clientBootstrap } from './client.js';
import { staffNotifications } from '../lib/notifications.js';
import {
  SHARE_SELECT, mapShare, shareCreateSchema, shareUpdateSchema, createShare, updateShare, FAMILY_COMMENT_SELECT, mapFamilyComment, byDate,
} from '../lib/shares.js';

// Studio : propriétaire + admins. La gestion de l'équipe (/team) est réservée au propriétaire.
const router = Router();
router.use(requireStudio);
// Administration : factures, paiements, rappels (billing.js).
router.use(billingRouter);
router.use('/booking', staffBooking);
router.use('/portfolio', staffPortfolio);
// Visites du site public : réservé au propriétaire.
router.get('/visits', requireOwner, async (req, res) => { res.set('Cache-Control', 'no-store').json(await visitStats()); });
router.use('/contracts', staffContracts);
// Contrats de site internet : liste indépendante (la signature, elle, reste celle du studio : /contracts/signature).
router.use('/websites', staffWebContracts);
router.use('/reviews', staffReviews);
router.use('/todo', staffTodo);
router.use('/orders', staffOrders);

const flag = z.enum(['0', '1']).transform((v) => v === '1');
const text = (max, message) => z.string().trim().min(1, message).max(max);
const optionalText = (max) => z.string().trim().max(max).optional().transform((v) => v || null);
const sendFlag = z.boolean().optional().default(true);

/** Modification partielle : valeur envoyée, sinon valeur actuelle en base (jamais undefined). */
const keep = (data, row, key, column = key) => (data[key] !== undefined ? data[key] : row[column] ?? null);

/** Seules les couvertures dédiées (covers/) sont supprimées ; un aperçu de photo reste en place. */
const ownCover = (key) => (key?.startsWith('covers/') ? key : null);

// ---------- Photographes : chacun ne voit que ce qu'il a créé ----------
// Chaque photographe — propriétaire compris — ne voit que ses clients (ceux qui ont saisi son code), ses galeries
// et ce qui en dépend (photos, commentaires, visages, e-mails envoyés). Le propriétaire voit en plus l'équipe
// et les comptes encore sans photographe (inscrits qui n'ont pas validé de code).
/** Nom d'expéditeur des e-mails : celui choisi dans « Mon profil », sinon le nom du compte. */
export const senderOf = (user) => ({ fromName: user.sender_name || user.name, replyTo: user.email });
const studioName = (req) => req.user.sender_name || req.user.name;

/** Envoie un modèle d'e-mail à un compte et renvoie le résultat ({status, error}) au frontend. */
const mailTo = (req, account, template, extra = {}) =>
  sendMail({ to: account.email, userId: account.id, sentBy: req.user.id, ...senderOf(req.user), ...template, ...extra });

/**
 * Compte tel que le studio le voit, avec sa place dans « Mes clients » :
 *  - mine   : je peux gérer son compte (je l'ai créé, ou il n'a pas encore de photographe principal) —
 *             même règle que findOwnClient ;
 *  - linked : il est dans mes clients (code saisi, ou je l'ai ajouté).
 * linked accepte un Set d'identifiants (liste complète) ou un booléen (compte seul).
 */
const asClient = (req, u, linked) => ({
  ...mapClient(u),
  mine: u.role === 'client' && (!u.created_by || u.created_by === req.user.id),
  linked: linked instanceof Set ? linked.has(u.id) : !!linked,
});

/** Ce compte est-il déjà dans mes clients ? */
const isLinked = async (req, clientId) =>
  (await query('SELECT 1 FROM client_photographers WHERE client_id = ? AND staff_id = ?', [clientId, req.user.id])).length > 0;

// ---------- Tableau de bord ----------
router.get('/bootstrap', async (req, res) => {
  const [as, ap] = accountScope(req);
  const [cs, cpar] = clientScope(req);
  const [es, ep] = eventScope(req);
  const [people, events, photos, downloads, activity, [storage], permissions, selections, maintenance, platformOwner, links] = await Promise.all([
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
       FROM users u WHERE ${cs} AND ${as} ORDER BY u.name`, [...cpar, ...ap],
    ),
    query(`SELECT COALESCE(SUM(p.size_bytes), 0) AS originals, COALESCE(SUM(p.preview_bytes), 0) AS previews
       FROM photos p JOIN events e ON e.id = p.event_id WHERE ${es}`, ep),
    getPermissions(),
    query(
      `SELECT s.event_id, s.user_id, s.photo_count, s.submitted_at, u.name
       FROM event_selections s JOIN users u ON u.id = s.user_id JOIN events e ON e.id = s.event_id
       WHERE s.submitted_at IS NOT NULL AND ${es} ORDER BY s.submitted_at DESC`, ep,
    ),
    maintenanceState(),
    isPlatformOwner(req.user),
    query('SELECT client_id FROM client_photographers WHERE staff_id = ?', [req.user.id]),
  ]);
  // Mes clients : ceux que j'ai créés, ceux qui ont saisi mon code et ceux que j'ai ajoutés — un
  // photographe (ou le propriétaire) peut être le client d'un autre photographe, et apparaît donc ici.
  const linked = new Set(links.map((l) => l.client_id));
  const accounts = people.map((u) => asClient(req, u, linked));
  res.json({
    accounts, // tous les comptes : peuvent tous recevoir des galeries
    clients: accounts.filter((a) => (a.role === 'client' || a.linked) && a.id !== req.user.id),
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
    // Site fermé pour maintenance : visible par toute l'équipe, réglable par le propriétaire principal.
    maintenance,
    platformOwner,
    // Photos en ligne : le navigateur les envoie directement au bucket (sans passer par ce serveur).
    upload: { direct: isRemote, maxMb: config.maxUploadMb, previewWidth: config.previewWidth },
    mail: { configured: mailConfigured(), from: fromLine(studioName(req)) },
    selections: selections.map((s) => ({
      eventId: s.event_id, userId: s.user_id, name: s.name, count: s.photo_count, submittedAt: toIso(s.submitted_at),
    })),
    notifications: await staffNotifications({ scope: [es, ep], owner: isOwner(req), userId: req.user.id, events, selections }),
  });
});

// ---------- Comptes ----------
const accountSchema = z.object({
  name: text(120, 'Le nom est obligatoire.'),
  email: z.string().trim().toLowerCase().email('Adresse e-mail invalide.').max(190),
  phone: optionalText(40),
  // Numéro WhatsApp du client (facultatif : à défaut, son téléphone sert pour WhatsApp).
  whatsapp: optionalText(40),
});

async function findAccount(req, id, roles) {
  const [as, ap] = accountScope(req);
  const [user] = await query(`SELECT * FROM users u WHERE u.id = ? AND ${as}`, [uuid.parse(id), ...ap]);
  if (!user || (roles && !roles.includes(user.role))) throw httpError(404, 'Compte introuvable.');
  return user;
}
const findClient = (req, id) => findAccount(req, id, ['client']);
/** Modifier, mettre en pause, supprimer ou réinitialiser le mot de passe : réservé au photographe principal du client. */
async function findOwnClient(req, id) {
  const client = await findClient(req, id);
  if (client.created_by && client.created_by !== req.user.id) {
    throw httpError(403, 'Ce client est aussi suivi par un autre photographe : seul son photographe principal peut modifier son compte.');
  }
  return client;
}

// Mot de passe temporaire remplacé à la première connexion.
/** Envoie un e-mail en arrière-plan : la réponse part tout de suite (l'envoi prend ~1 s). */
const queueMail = (promise) => {
  Promise.resolve(promise).catch((err) => console.error('E-mail :', err.message));
  return { status: 'queued', error: null };
};

async function createAccount(req, role, data) {
  const id = crypto.randomUUID();
  const hash = await hashPassword(data.password);
  // Mot de passe temporaire : à changer à la première connexion. Un membre de l'équipe reçoit un code d'accès.
  await query(
    `INSERT INTO users (id, role, created_by, name, email, phone, whatsapp, password_hash, must_change_password, access_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [id, role, req.user.id, data.name, data.email, data.phone ?? null, data.whatsapp ?? null, hash, role === 'admin' ? await freshCode() : null],
  );
  return findAccount(req, id);
}

async function setTemporaryPassword(account, password) {
  const hash = await hashPassword(password);
  await query(
    'UPDATE users SET password_hash = ?, must_change_password = 1, token_version = token_version + 1 WHERE id = ?',
    [hash, account.id],
  );
}

// ---------- Clients (propriétaire et admins) ----------
// Un nouveau compte n'est créé que pour quelqu'un qui n'en a pas encore. Si l'adresse existe déjà
// (client d'un autre photographe, ou un photographe lui-même), on le dit et la page propose de
// l'ajouter à ses clients : un seul compte, un seul mot de passe, plusieurs photographes.
router.post('/clients', async (req, res) => {
  const data = accountSchema.extend({ password: passwordRule, sendEmail: sendFlag }).parse(req.body);
  const [exists] = await query('SELECT id, name, email, created_by FROM users WHERE email = ?', [data.email]);
  if (exists) {
    if (exists.created_by === req.user.id || await isLinked(req, exists.id)) {
      throw httpError(409, `${exists.name} (${exists.email}) est déjà dans vos clients.`);
    }
    const err = httpError(409, `${exists.name} a déjà un compte avec cette adresse. Ajoutez-le à vos clients : il garde son mot de passe et vous le verrez ici.`);
    err.existing = { id: exists.id, name: exists.name, email: exists.email };
    throw err;
  }
  const client = await createAccount(req, 'client', data);
  audit(req, 'client.create', { entity: 'user', entityId: client.id, details: { email: data.email } });
  // E-mail attendu (et non mis en file) : le photographe sait tout de suite s'il est bien parti.
  const email = data.sendEmail
    ? await mailTo(req, client, welcomeEmail({ ...client, password: data.password, studio: studioName(req) }), { kind: 'welcome' })
    : null;
  res.status(201).json({ client: asClient(req, client, false), email });
});

// Ajouter à ses clients quelqu'un qui a déjà un compte KentraPix : un client suivi par un autre
// photographe, un autre photographe, ou le propriétaire. Aucun compte n'est créé, aucun mot de passe
// n'est touché — c'est la même chose que si la personne avait saisi le code du photographe.
const linkSchema = z.object({
  email: z.string().trim().toLowerCase().email('Adresse e-mail invalide.').max(190),
  sendEmail: sendFlag,
});

// La réponse dit si une adresse a un compte : plafond par photographe, pour qu'on ne puisse pas
// essayer des adresses en série.
const linkLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  keyGenerator: (req) => `${req.user?.id || 'anon'}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Trop d’adresses essayées. Réessayez dans une heure.' },
});

// La fenêtre « Ajouter un client » interroge cette adresse pendant la frappe : si elle a déjà un compte,
// il n'y a ni nom ni mot de passe à saisir, seulement un rattachement. Plafond plus large (lecture seule).
const lookupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  keyGenerator: (req) => `${req.user?.id || 'anon'}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Trop d’adresses essayées. Réessayez dans une heure.' },
});

router.get('/clients/lookup', lookupLimiter, async (req, res) => {
  const email = z.string().trim().toLowerCase().email('Adresse e-mail invalide.').max(190).parse(req.query.email);
  const [account] = await query('SELECT id, name, email, role, active, created_by FROM users WHERE email = ?', [email]);
  res.set('Cache-Control', 'no-store');
  // Son propre compte : traité comme inconnu, la création dira que l'adresse est prise.
  if (!account || account.id === req.user.id) return res.json({ found: false });
  res.json({
    found: true,
    name: account.name,
    email: account.email,
    role: account.role,
    active: !!account.active,
    linked: account.created_by === req.user.id || await isLinked(req, account.id),
  });
});

router.post('/clients/link', linkLimiter, async (req, res) => {
  const { email, sendEmail } = linkSchema.parse(req.body);
  const [account] = await query('SELECT * FROM users WHERE email = ?', [email]);
  if (!account) throw httpError(404, 'Aucun compte avec cette adresse. Utilisez « Nouveau client » pour lui en créer un.');
  if (account.id === req.user.id) throw httpError(400, 'C’est votre propre compte.');
  if (!account.active) throw httpError(400, `Le compte de ${account.name} est en pause : son photographe principal doit le réactiver.`);
  const added = await query('INSERT INTO client_photographers (client_id, staff_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [account.id, req.user.id]);
  if (!added.affectedRows) throw httpError(409, `${account.name} est déjà dans vos clients.`);
  // Client inscrit seul qui attendait un code : ce rattachement lui ouvre son espace.
  if (account.role === 'client' && !account.access_granted) {
    await query('UPDATE users SET access_granted = 1, created_by = COALESCE(created_by, ?) WHERE id = ?', [req.user.id, account.id]);
  }
  audit(req, 'client.link', { entity: 'user', entityId: account.id, details: { email } });
  pushLater(account.id, { title: 'Nouveau photographe', body: `${studioName(req)} vous a ajouté à ses clients.`, url: '/client', tag: `photographer-${req.user.id}` });
  const mail = sendEmail
    ? await mailTo(req, account, clientLinkedEmail({ name: account.name, studio: studioName(req) }), { kind: 'message' })
    : null;
  const fresh = await findAccount(req, account.id);
  res.status(201).json({ client: asClient(req, fresh, true), email: mail });
});

// Retirer quelqu'un de ses clients, sans toucher à son compte : il garde son mot de passe, ses autres
// photographes et ses galeries. Réservé aux comptes qu'un autre photographe suit déjà (sinon : « Supprimer »).
router.delete('/clients/:id/link', async (req, res) => {
  const account = await findAccount(req, req.params.id);
  if (account.id === req.user.id) throw httpError(400, 'C’est votre propre compte.');
  const mine = await query('SELECT COUNT(*) AS n FROM events WHERE client_id = ? AND created_by = ?', [account.id, req.user.id]);
  const n = Number(mine[0].n);
  if (n) throw httpError(400, `Vous avez encore ${n > 1 ? `${n} galeries` : 'une galerie'} pour ${account.name}. Supprimez-${n > 1 ? 'les' : 'la'} d’abord, ou utilisez « Supprimer le client ».`);
  const others = await query('SELECT staff_id FROM client_photographers WHERE client_id = ? AND staff_id <> ?', [account.id, req.user.id]);
  const primary = account.role === 'client' && account.created_by === req.user.id;
  // Compte client que j'avais créé et que personne d'autre ne suit : il resterait sans photographe, on refuse.
  if (primary && !others.length) throw httpError(400, `Vous êtes le seul photographe de ${account.name} : utilisez « Supprimer le client ».`);
  const removed = await query('DELETE FROM client_photographers WHERE client_id = ? AND staff_id = ?', [account.id, req.user.id]);
  if (primary) {
    // La place de photographe principal passe au suivant.
    await query('UPDATE users SET created_by = ? WHERE id = ?', [others[0].staff_id, account.id]);
  } else if (!removed.affectedRows) {
    throw httpError(404, `${account.name} n’est pas dans vos clients.`);
  }
  audit(req, 'client.unlink', { entity: 'user', entityId: account.id });
  res.json({ removed: true, name: account.name });
});

router.patch('/clients/:id', async (req, res) => {
  const client = await findOwnClient(req, req.params.id);
  const data = accountSchema.extend({ active: z.boolean() }).partial().parse(req.body);
  const active = keep(data, client, 'active');
  // Désactiver un compte ferme immédiatement ses sessions.
  const revoke = !active && client.active ? 1 : 0;
  await query(
    'UPDATE users SET name = ?, email = ?, phone = ?, whatsapp = ?, active = ?, token_version = token_version + ? WHERE id = ?',
    [keep(data, client, 'name'), keep(data, client, 'email'), keep(data, client, 'phone'), keep(data, client, 'whatsapp'), active ? 1 : 0, revoke, client.id],
  );
  audit(req, data.active === undefined ? 'client.update' : active ? 'client.activate' : 'client.deactivate', { entity: 'user', entityId: client.id });
  res.json({ client: asClient(req, await findClient(req, client.id), await isLinked(req, client.id)) });
});

// Supprimer un client. Ses galeries : supprimées avec leurs photos (galleries = 'delete'),
// ou gardées par le studio en brouillon (galleries = 'keep' : le client n'y a plus accès).
// Favoris, sélections, commentaires, liens de partage et notifications du client : supprimés avec le compte.
router.delete('/clients/:id', async (req, res) => {
  const client = await findOwnClient(req, req.params.id);
  const { galleries } = z.object({ galleries: z.enum(['delete', 'keep']) }).parse(req.body ?? {});
  // Client suivi par d'autres photographes : on ne retire que SES galeries et son lien, le compte reste.
  const others = await query('SELECT staff_id FROM client_photographers WHERE client_id = ? AND staff_id <> ?', [client.id, req.user.id]);
  // Galerie partagée avec d'autres clients : elle reste, un autre client devient le principal.
  for (const s of await query('SELECT e.id, (SELECT ec.client_id FROM event_clients ec WHERE ec.event_id = e.id AND ec.client_id <> e.client_id LIMIT 1) AS other FROM events e WHERE e.client_id = ?', [client.id])) {
    if (!s.other) continue;
    await query('UPDATE events SET client_id = ? WHERE id = ?', [s.other, s.id]);
    await query('DELETE FROM event_clients WHERE event_id = ? AND client_id = ?', [s.id, s.other]);
  }
  const events = others.length
    ? await query('SELECT id, cover_key, music_key FROM events WHERE client_id = ? AND created_by = ?', [client.id, req.user.id])
    : await query('SELECT id, cover_key, music_key FROM events WHERE client_id = ?', [client.id]);
  if (galleries === 'delete') {
    for (const e of events) {
      await deletePhotos(await query('SELECT * FROM photos WHERE event_id = ?', [e.id]), { background: true });
      await query('DELETE FROM events WHERE id = ?', [e.id]);
      await removeKeys([ownCover(e.cover_key), e.music_key]);
    }
  } else if (events.length) {
    const ids = events.map((e) => e.id);
    await query(`UPDATE events SET client_id = ?, published = 0 WHERE id IN (${inList(ids)})`, [req.user.id, ...ids]);
  }
  if (others.length) {
    await query('DELETE FROM client_photographers WHERE client_id = ? AND staff_id = ?', [client.id, req.user.id]);
    await query('UPDATE users SET created_by = ? WHERE id = ?', [others[0].staff_id, client.id]);
  } else {
    await query('DELETE FROM users WHERE id = ?', [client.id]);
    await removeKeys([client.avatar_key]);
  }
  audit(req, 'client.delete', { entity: 'user', entityId: client.id, details: { email: client.email, galleries, count: events.length } });
  res.json({ deleted: true, galleries, count: events.length });
});

router.post('/clients/:id/password', async (req, res) => {
  const client = await findOwnClient(req, req.params.id);
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
  // Client suivi par plusieurs photographes : l'aperçu ne montre que les galeries de ce photographe.
  const boot = await clientBootstrap(account.id, req.user.id);
  // Aperçu « vue du client » : dans une galerie en mode sélection, on montre aussi le filigrane.
  const wm = (u) => (u ? `${u}${u.includes('?') ? '&' : '?'}wm=1` : u);
  const sel = new Set(boot.events.filter((e) => e.selectionMode).map((e) => e.id));
  boot.events = boot.events.map((e) => (sel.has(e.id) ? { ...e, cover: wm(e.cover) } : e));
  boot.photos = boot.photos.map((p) => (sel.has(p.eventId) ? { ...p, preview: wm(p.preview), thumb: wm(p.thumb) } : p));
  res.json({ client: mapClient(account), hiddenEvents: Number(hidden), ...boot });
});

// ---------- Équipe (propriétaire uniquement) ----------
// Nouvel admin : compte créé avec un mot de passe temporaire.
router.post('/team', requireOwner, async (req, res) => {
  const data = accountSchema.extend({ password: passwordRule, sendEmail: sendFlag }).parse(req.body);
  const admin = await createAccount(req, 'admin', data);
  audit(req, 'team.create', { entity: 'user', entityId: admin.id, details: { email: data.email } });
  const email = data.sendEmail ? queueMail(mailTo(req, admin, adminInviteEmail({ ...admin, password: data.password }), { kind: 'admin_invite' })) : null;
  res.status(201).json({ account: mapClient(admin), email });
});

// Nommer admin ou propriétaire un compte existant, le repasser client / admin, ou (dés)activer un admin.
// Plusieurs propriétaires possibles ; chacun ne voit que ses propres clients.
router.patch('/team/:id', requireOwner, async (req, res) => {
  const account = await findAccount(req, req.params.id);
  const data = z
    .object({ role: z.enum(['owner', 'admin', 'client']).optional(), active: z.boolean().optional(), sendEmail: sendFlag })
    .parse(req.body);
  const role = data.role ?? account.role;
  if (account.id === req.user.id) throw httpError(403, 'Vous ne pouvez pas modifier votre propre compte ici.');
  if (account.role === 'owner' && role !== 'admin') throw httpError(400, 'Un propriétaire ne peut redevenir qu’admin.');
  if (role === 'owner' && account.role !== 'admin' && account.role !== 'owner') throw httpError(400, 'Nommez d’abord cette personne admin, puis propriétaire.');
  const active = data.active ?? !!account.active;
  // Changer de rôle ou désactiver ferme les sessions ouvertes.
  const revoke = role !== account.role || (!active && account.active) ? 1 : 0;
  if (role === 'client' && account.access_code) await query('UPDATE users SET access_code = NULL WHERE id = ?', [account.id]);
  await query('UPDATE users SET role = ?, active = ?, token_version = token_version + ? WHERE id = ?', [
    role, active ? 1 : 0, revoke, account.id,
  ]);
  const promoted = account.role === 'client' && role === 'admin';
  if (promoted && !account.access_code) await query('UPDATE users SET access_code = ? WHERE id = ?', [await freshCode(), account.id]);
  audit(req, role === 'owner' && account.role !== 'owner' ? 'team.make_owner' : account.role === 'owner' && role !== 'owner' ? 'team.remove_owner' : promoted ? 'team.promote' : role !== account.role ? 'team.demote' : active ? 'team.activate' : 'team.deactivate', {
    entity: 'user', entityId: account.id,
  });
  const email = promoted && data.sendEmail ? await mailTo(req, account, adminInviteEmail({ ...account }), { kind: 'admin_invite' }) : null;
  res.json({ account: mapClient(await findAccount(req, account.id)), email });
});

// Mot de passe du studio oublié : le propriétaire l'efface, le membre en recrée un à sa prochaine ouverture.
router.post('/team/:id/studio-reset', requireOwner, async (req, res) => {
  const account = await findAccount(req, req.params.id, ['admin']);
  await query('UPDATE users SET studio_password_hash = NULL WHERE id = ?', [account.id]);
  audit(req, 'team.studio_reset', { entity: 'user', entityId: account.id });
  res.status(204).end();
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
  announcement: (name, studio) => announcementEmail({ name, studio, title: 'Séances photo de Noël', body: 'Les réservations pour les séances de Noël sont ouvertes !\nRépondez à cet e-mail pour choisir votre date.', eventName: 'Mariage de Marie & Jean' }),
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
  const [{ count }] = await query('SELECT COUNT(*) AS count FROM photos WHERE event_id = ?', [event.id]);
  let result;
  for (const cid of [event.client_id, ...String(event.extra_client_ids || '').split(',').filter(Boolean)]) {
    const owner = await findAccount(req, cid);
    const r = await mailTo(req, owner, galleryReadyEmail({ name: owner.name, eventName: event.name, count: Number(count), studio: studioName(req) }), {
      kind: 'gallery_ready', eventId: event.id,
    });
    pushLater(cid, { title: 'Vos photos sont prêtes', body: `« ${event.name} » est en ligne.`, url: '/client', tag: `gallery-${event.id}` });
    if (!result || r.status === 'sent') result = r;
  }
  if (result.status === 'sent') await query('UPDATE events SET notified_at = CURRENT_TIMESTAMP WHERE id = ?', [event.id]);
  return result;
}

// Une galerie peut appartenir à n'importe quel compte actif : client, admin ou propriétaire.
// Plusieurs clients cochés : « id,id,id » (le premier est le client principal de la galerie).
const clientIdsField = z.string().trim().max(2000).optional();
function clientsOf(body) {
  if (!body || body.clientIds === undefined) return null;
  const ids = [...new Set(String(body.clientIds).split(',').map((s) => s.trim()).filter(Boolean))];
  // Aucun client coché : la galerie reste au compte du photographe (elle se partage ensuite par lien).
  if (!ids.length) return [body.__self];
  if (ids.length > 50) throw httpError(400, 'Cinquante clients au maximum par galerie.');
  return ids.map((id) => uuid.parse(id));
}
async function saveExtraClients(eventId, ids) {
  await query('DELETE FROM event_clients WHERE event_id = ?', [eventId]);
  for (const id of ids.slice(1)) await query('INSERT INTO event_clients (event_id, client_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [eventId, id]);
}
const eventSchema = z.object({
  clientId: uuid,
  clientIds: clientIdsField,
  name: text(160, 'Le nom est obligatoire.'),
  type: text(80, 'Le type est obligatoire.'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide.'),
  location: optionalText(160),
  description: optionalText(5000),
});

router.post('/events', upload.single('coverFile'), async (req, res) => {
  let coverKey = null;
  try {
    const ids = clientsOf({ ...req.body, __self: req.user.id });
    const data = eventSchema.parse(ids ? { ...req.body, clientId: ids[0] } : req.body);
    for (const cid of ids || [data.clientId]) await findAccount(req, cid);
    if (req.file) coverKey = await storeCover(req.file);
    const id = crypto.randomUUID();
    await query(
      `INSERT INTO events (id, client_id, created_by, name, type, event_date, location, description, cover_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.clientId, req.user.id, data.name, data.type, data.date, data.location, data.description, coverKey],
    );
    if (ids && ids.length > 1) await saveExtraClients(id, ids);
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
    // Photos débloquées pour le client : vide = toutes ; sinon les N premières. Les autres : verrouillées ou cachées.
    unlockLimit: z.string().trim().regex(/^\d*$/, 'Nombre de photos débloquées invalide.').transform((v) => (v === '' ? null : Number(v))),
    // Photos débloquées : 'all' = toutes ; 'some' + unlockNumbers (« 1-10, 15, 20-25 », vide = aucune).
    unlockMode: z.enum(['all', 'some']),
    unlockNumbers: z.string().trim().max(2000, 'Liste de numéros trop longue.'),
    lockMode: z.enum(['locked', 'hidden']),
    lockBlur: z.enum(['2.5', '6', '12']).transform(Number),
    lockReason: z.string().trim().max(300, 'Message trop long (300 caractères max).').transform((v) => v || null),
  })
  .partial();

router.patch('/events/:id', upload.single('coverFile'), async (req, res) => {
  const event = await findEvent(req, req.params.id);
  const ids = clientsOf({ ...req.body, __self: req.user.id });
  const data = eventPatchSchema.parse(ids ? { ...req.body, clientId: ids[0] } : req.body);
  for (const cid of ids || (data.clientId ? [data.clientId] : [])) await findAccount(req, cid);
  const coverKey = req.file ? await storeCover(req.file) : event.cover_key;
  const published = !!keep(data, event, 'published');
  let archived = !!keep(data, event, 'archived');
  // Galerie archivée automatiquement à son expiration : une nouvelle date (ou plus de date) la rouvre.
  const wasExpired = event.archived && event.expires_at && String(event.expires_at).slice(0, 10) < new Date().toISOString().slice(0, 10);
  if (wasExpired && data.expiresAt !== undefined && (data.expiresAt === null || data.expiresAt >= new Date().toISOString().slice(0, 10))) archived = false;
  // Règle des photos débloquées : une seule des trois formes à la fois (numéros, N premières, toutes).
  let unlock = { limit: event.unlock_limit, numbers: event.unlock_numbers };
  if (data.unlockMode === 'all') unlock = { limit: null, numbers: null };
  else if (data.unlockMode === 'some') {
    try { unlock = { limit: null, numbers: normalizeNumbers(data.unlockNumbers ?? '') }; } catch (err) { throw httpError(400, err.message); }
  } else if (data.unlockLimit !== undefined) unlock = { limit: data.unlockLimit, numbers: null };
  await query(
    `UPDATE events SET client_id = ?, name = ?, type = ?, event_date = ?, location = ?, description = ?,
       cover_key = ?, published = ?, allow_download = ?, archived = ?, selection_mode = ?, selection_limit = ?, unlock_limit = ?, unlock_numbers = ?, lock_mode = ?, lock_reason = ?, lock_blur = ?,
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
      unlock.limit,
      unlock.numbers,
      data.lockMode ?? event.lock_mode ?? 'locked',
      data.lockReason !== undefined ? data.lockReason : event.lock_reason,
      data.lockBlur ?? Number(event.lock_blur ?? 2.5),
      published ? 1 : 0, // première publication : notification « nouvelle galerie »
      // Nouvelle date d'expiration : le rappel « 7 jours » pourra repartir.
      keep(data, event, 'expiresAt', 'expires_at'), keep(data, event, 'expiresAt', 'expires_at'),
      event.id,
    ],
  );
  if (ids) await saveExtraClients(event.id, ids);
  if (req.file) await removeKeys([ownCover(event.cover_key)]);
  const { notify, ...changes } = data;
  audit(req, 'event.update', { entity: 'event', entityId: event.id, details: { ...changes, cover: !!req.file } });
  const updated = await findEvent(req, event.id);
  // Galerie qui devient visible : e-mail automatique « Vos photos sont prêtes ».
  const becameVisible = published && !archived && !(event.published && !event.archived);
  // E-mails envoyés en arrière-plan : la réponse part tout de suite.
  const sendMail = becameVisible && notify !== false;
  if (sendMail) notifyGallery(req, updated).catch((err) => console.error('notifyGallery', err.message));
  res.json({ event: mapEvent(updated), email: sendMail ? { status: 'queued' } : null });
});

// ---------- Partage famille (liens + mot de passe) ----------
// Le studio voit et gère tous les liens d'une galerie, y compris ceux créés par le client.
// Un lien appartient toujours au propriétaire de la galerie (c'est sa famille qui le reçoit).
router.get('/events/:id/shares', async (req, res) => {
  const event = await findEvent(req, req.params.id);
  const rows = await query(`${SHARE_SELECT} WHERE l.event_id = ? AND l.user_id = ? ORDER BY l.created_at DESC`, [event.id, event.client_id]);
  res.json({ shares: rows.map(mapShare), enabled: (await getPermissions()).sharing });
});

router.post('/events/:id/shares', async (req, res) => {
  const event = await findEvent(req, req.params.id);
  const share = await createShare({
    eventId: event.id, ownerId: event.client_id, createdBy: req.user.id, data: shareCreateSchema.parse(req.body),
  });
  audit(req, 'share.create', { entity: 'event', entityId: event.id, details: { byStudio: true } });
  res.status(201).json({ share });
});

/** Lien d'une galerie de ce photographe. */
async function findShareLink(req, id) {
  const [es, ep] = eventScope(req);
  const [link] = await query(`SELECT l.id FROM share_links l JOIN events e ON e.id = l.event_id WHERE l.id = ? AND ${es}`, [uuid.parse(id), ...ep]);
  if (!link) throw httpError(404, 'Lien introuvable.');
  return link;
}

router.patch('/shares/:id', async (req, res) => {
  const link = await findShareLink(req, req.params.id);
  res.json({ share: await updateShare(link.id, shareUpdateSchema.parse(req.body)) });
});

router.delete('/shares/:id', async (req, res) => {
  const link = await findShareLink(req, req.params.id);
  await query('DELETE FROM share_links WHERE id = ?', [link.id]);
  audit(req, 'share.delete', { entity: 'share', entityId: link.id });
  res.status(204).end();
});

// Page « Sélections » : toutes les sélections des galeries de ce photographe, envoyées ou en cours.
router.get('/selections', async (req, res) => {
  const [es, ep] = eventScope(req);
  const [picks, sent] = await Promise.all([
    query(
      `SELECT s.user_id, s.created_at, s.note, n.id, n.event_id, n.number, n.filename FROM photo_selections s JOIN (
         SELECT p.id, p.event_id, p.filename, ROW_NUMBER() OVER (PARTITION BY p.event_id ORDER BY p.position, p.created_at) AS number
         FROM photos p JOIN events e ON e.id = p.event_id WHERE ${es}
       ) n ON n.id = s.photo_id ORDER BY n.number`,
      ep,
    ),
    query(`SELECT s.* FROM event_selections s JOIN events e ON e.id = s.event_id WHERE ${es}`, ep),
  ]);
  // Une sélection = un client dans une galerie (photos cochées et/ou envoi au studio).
  const groups = new Map();
  const group = (eventId, userId) => {
    const key = `${eventId}:${userId}`;
    if (!groups.has(key)) groups.set(key, { eventId, userId, photos: [], lastPickAt: null, sent: null });
    return groups.get(key);
  };
  for (const p of picks) {
    const g = group(p.event_id, p.user_id);
    g.photos.push({ id: p.id, number: Number(p.number), filename: p.filename, thumb: `/media/thumb/${p.id}`, note: p.note || '' });
    if (!g.lastPickAt || p.created_at > g.lastPickAt) g.lastPickAt = p.created_at;
  }
  for (const s of sent) group(s.event_id, s.user_id).sent = s;
  const userIds = [...new Set([...groups.values()].map((g) => g.userId))];
  const users = userIds.length ? await query(`SELECT * FROM users WHERE id IN (${inList(userIds)})`, userIds) : [];
  const userOf = Object.fromEntries(users.map((u) => [u.id, u]));
  const list = [...groups.values()]
    .filter((g) => g.photos.length || g.sent?.submitted_at)
    .map((g) => {
      const u = userOf[g.userId];
      const submittedAt = toIso(g.sent?.submitted_at);
      const lastPickAt = toIso(g.lastPickAt);
      return {
        eventId: g.eventId, userId: g.userId, name: u?.name || '—', email: u?.email || '', avatar: u ? avatarUrl(u) : null,
        note: g.sent?.note || '', submittedAt, lastPickAt, photos: g.photos,
        // Photos cochées après l'envoi : le client a changé d'avis depuis.
        changedSince: Boolean(submittedAt && lastPickAt && lastPickAt > submittedAt),
        date: [submittedAt, lastPickAt].filter(Boolean).sort().pop() || null,
      };
    })
    .sort((a, b) => (Boolean(b.submittedAt) - Boolean(a.submittedAt)) || String(b.date).localeCompare(String(a.date)));
  res.json({ selections: list });
});

// Sélection reçue pour une galerie : numéros + aperçus + message.
router.get('/events/:id/selection', async (req, res) => {
  const event = await findEvent(req, req.params.id);
  const photos = await query(
    `SELECT n.id, n.number, n.filename, s.user_id, s.note FROM photo_selections s JOIN (
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
        photos: mine.map((p) => ({ id: p.id, number: Number(p.number), filename: p.filename, preview: `/media/preview/${p.id}`, note: p.note || '' })),
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
  // Photos d'abord (fichiers original, aperçu, miniature, visages, filigranes + lignes en base), puis la galerie, sa couverture et sa musique.
  const photos = await query('SELECT * FROM photos WHERE event_id = ?', [event.id]);
  await deletePhotos(photos, { background: photos.length > 20 });
  await query('DELETE FROM events WHERE id = ?', [event.id]);
  await removeKeys([ownCover(event.cover_key), event.music_key]);
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
    return mapPhoto(photo);
  } catch (err) {
    await removeKeys([stored.originalKey, stored.previewKey]);
    throw err;
  }
}

const albumName = (v) => z.string().trim().max(80).optional().parse(v) || 'Nouveaux imports';

// Import par le serveur (mode local, ou formats que le navigateur ne sait pas lire : HEIC, RAW…).
router.post('/events/:id/photos', upload.single('photo'), async (req, res) => {
  const event = await findEvent(req, req.params.id);
  if (!req.file) throw httpError(400, 'Choisissez une image.');
  const album = albumName(req.body.album);
  const stored = await storePhoto(req.file, { previewOnly: !!event.selection_mode });
  const name = Buffer.from(req.file.originalname, 'latin1').toString('utf8').slice(0, 255);
  res.status(201).json({ photo: await insertPhoto(event, album, storedName(name, stored), stored) });
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

const inList = (ids) => ids.map(() => '?').join(', ');

/**
 * Supprime des photos (lignes déjà vérifiées par le filtre du photographe) : la base d'abord,
 * puis les fichiers (original, aperçu, miniature, visages, filigranes) par petits paquets.
 * background : les fichiers sont effacés après la réponse (suppression de centaines de photos).
 */
async function deletePhotos(photos, { background = false } = {}) {
  if (!photos.length) return;
  const ids = photos.map((p) => p.id);
  const keys = [];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const chunkPhotos = photos.slice(i, i + 500);
    // Couverture tirée d'une de ces photos : la galerie revient à « sans couverture ».
    await query(`UPDATE events SET cover_key = NULL WHERE cover_key IN (${inList(chunkPhotos)})`, chunkPhotos.map((p) => p.preview_key));
    await query(`DELETE FROM photos WHERE id IN (${inList(chunk)})`, chunk); // favoris, commentaires, visages : ON DELETE CASCADE
    keys.push(...chunkPhotos.flatMap((p) => [p.original_key, p.preview_key, p.thumb_key, ...LOCK_LEVELS.map((s) => `locks/${p.id}-b${Math.round(s * 10)}.webp`)]));
  }
  const files = async () => {
    for (let i = 0; i < keys.length; i += 50) await removeKeys(keys.slice(i, i + 50));
    for (let i = 0; i < ids.length; i += 20) await Promise.all(ids.slice(i, i + 20).map((id) => removeWatermarks(id)));
  };
  if (background) files().catch((err) => console.error('Suppression des fichiers :', err.message));
  else await files();
}

// Remplace une photo par sa version retouchée : le fichier est gardé octet pour octet (aucune recompression),
// c'est exactement ce que le client téléchargera. L'aperçu et la miniature sont refaits à partir du nouveau fichier.
router.post('/photos/:id/original', upload.single('photo'), async (req, res) => {
  if (!req.file) throw httpError(400, 'Choisissez l’image retouchée.');
  let photo;
  try { photo = await findPhoto(req, req.params.id); } catch (err) { await fs.rm(req.file.path, { force: true }); throw err; }
  const stored = await storePhoto(req.file, { previewOnly: false });
  const filename = storedName(Buffer.from(req.file.originalname, 'latin1').toString('utf8').slice(0, 255), stored);
  try {
    const [oldThumb] = [photo.thumb_key];
    await query(
      `UPDATE photos SET original_key = ?, preview_key = ?, thumb_key = NULL, mime = ?, size_bytes = ?, preview_bytes = ?, width = ?, height = ?, filename = ? WHERE id = ?`,
      [stored.originalKey, stored.previewKey, stored.mime, stored.sizeBytes, stored.previewBytes, stored.width, stored.height, filename, photo.id],
    );
    await query('UPDATE events SET cover_key = ? WHERE cover_key = ?', [stored.previewKey, photo.preview_key]);
    await removeKeys([photo.original_key, photo.preview_key, oldThumb, `thumbs/${photo.id}.webp`, ...LOCK_LEVELS.map((l) => `locks/${photo.id}-b${Math.round(l * 10)}.webp`)].filter(Boolean));
    await removeWatermarks(photo.id);
  } catch (err) {
    await removeKeys([stored.originalKey, stored.previewKey]);
    throw err;
  }
  audit(req, 'photo.replace_original', { entity: 'photo', entityId: photo.id, details: { filename, eventId: photo.event_id } });
  const [row] = await query('SELECT * FROM photos WHERE id = ?', [photo.id]);
  res.json({ photo: mapPhoto(row) });
});

router.delete('/photos/:id', async (req, res) => {
  const photo = await findPhoto(req, req.params.id);
  await deletePhotos([photo]);
  audit(req, 'photo.delete', { entity: 'photo', entityId: photo.id, details: { filename: photo.filename, eventId: photo.event_id } });
  res.status(204).end();
});

// Album de plusieurs photos à la fois (sélection dans la page « Photos » du studio).
router.post('/photos/album', async (req, res) => {
  const { photoIds, album } = z
    .object({ photoIds: z.array(uuid).min(1).max(5000), album: text(80, 'Le nom de l’album est obligatoire.') })
    .parse(req.body);
  const ids = [...new Set(photoIds)];
  const [es, ep] = eventScope(req);
  const result = await query(
    `UPDATE photos p SET album = ? FROM events e WHERE e.id = p.event_id AND p.id IN (${inList(ids)}) AND ${es}`,
    [album, ...ids, ...ep],
  );
  res.json({ updated: result.affectedRows, album });
});

// Suppression groupée : les photos cochées (photoIds), ou toutes celles d'une galerie (eventId).
router.post('/photos/delete', async (req, res) => {
  const data = z
    .object({ photoIds: z.array(uuid).min(1).max(5000).optional(), eventId: uuid.optional() })
    .refine((d) => Boolean(d.photoIds) !== Boolean(d.eventId), 'Choisissez des photos ou une galerie.')
    .parse(req.body);
  const [es, ep] = eventScope(req);
  let photos;
  if (data.eventId) {
    const event = await findEvent(req, data.eventId);
    photos = await query('SELECT * FROM photos WHERE event_id = ?', [event.id]);
  } else {
    const ids = [...new Set(data.photoIds)];
    photos = await query(`SELECT p.* FROM photos p JOIN events e ON e.id = p.event_id WHERE p.id IN (${inList(ids)}) AND ${es}`, [...ids, ...ep]);
    if (photos.length !== ids.length) throw httpError(404, 'Certaines photos sont introuvables (déjà supprimées ?). Actualisez la page.');
  }
  await deletePhotos(photos, { background: photos.length > 20 });
  audit(req, 'photo.delete_many', {
    entity: data.eventId ? 'event' : 'photo', entityId: data.eventId ?? null,
    details: { count: photos.length, events: [...new Set(photos.map((p) => p.event_id))] },
  });
  res.json({ deleted: photos.length });
});

// ---------- Notifications : cloche des clients + e-mail automatique ----------
// Les e-mails partent en arrière-plan (lib/announcements.js) : tout de suite, ou à l'heure programmée.
// Offre gratuite Resend : 100 e-mails par jour (MAIL_DAILY_LIMIT pour une autre offre).
const MAIL_DAILY_LIMIT = Number(process.env.MAIL_DAILY_LIMIT || 100);
const announcementScope = (req) => ['a.created_by = ?', [req.user.id]];

router.get('/announcements', async (req, res) => {
  const [sc, sp] = announcementScope(req);
  const [rows, [{ n }]] = await Promise.all([
    query(
      `SELECT a.id, a.title, a.body, a.event_id, a.audience, a.send_email, a.send_at, e.name AS event_name, u.name AS author,
         COUNT(r.user_id) AS recipients,
         COUNT(*) FILTER (WHERE r.email_status = 'sent') AS sent,
         COUNT(*) FILTER (WHERE r.email_status IN ('failed', 'skipped')) AS failed,
         STRING_AGG(c.name, ', ' ORDER BY c.name) FILTER (WHERE a.audience = 'some') AS names
       FROM announcements a
       LEFT JOIN announcement_recipients r ON r.announcement_id = a.id
       LEFT JOIN users c ON c.id = r.user_id
       LEFT JOIN events e ON e.id = a.event_id
       LEFT JOIN users u ON u.id = a.created_by
       WHERE ${sc} GROUP BY a.id, e.name, u.name ORDER BY a.send_at DESC LIMIT 100`,
      sp,
    ),
    query("SELECT COUNT(*) AS n FROM email_log WHERE status = 'sent' AND created_at >= CURRENT_DATE"),
  ]);
  res.json({
    announcements: rows.map((a) => ({
      id: a.id, title: a.title, body: a.body, eventId: a.event_id, eventName: a.event_name || null, audience: a.audience,
      names: a.names || null, recipients: Number(a.recipients), sendEmail: !!a.send_email,
      emailsSent: Number(a.sent), emailsFailed: Number(a.failed), author: a.author || null, sendAt: toIso(a.send_at),
    })),
    mail: { configured: mailConfigured(), sentToday: Number(n), dailyLimit: MAIL_DAILY_LIMIT },
  });
});

const announcementSchema = z.object({
  title: text(150, 'Le titre est obligatoire.'),
  body: text(5000, 'Le message est vide.'),
  audience: z.enum(['all', 'some']),
  clientIds: z.array(uuid).max(1000).optional().default([]),
  eventId: uuid.nullable().optional(),
  sendEmail: sendFlag,
  // Absent : tout de suite. Sinon date ISO (UTC) dans l'année qui vient.
  sendAt: z.string().datetime({ offset: true, message: 'Date d’envoi invalide.' }).nullable().optional(),
});

router.post('/announcements', async (req, res) => {
  const data = announcementSchema.parse(req.body);
  const event = data.eventId ? await findEvent(req, data.eventId) : null;
  let sendAt = null;
  if (data.sendAt) {
    const t = Date.parse(data.sendAt);
    if (t < Date.now() - 60000) throw httpError(400, 'La date d’envoi est déjà passée.');
    if (t > Date.now() + 366 * 86400000) throw httpError(400, 'Programmez l’envoi dans l’année qui vient.');
    sendAt = new Date(t).toISOString().slice(0, 19).replace('T', ' ');
  }
  // Tous : les clients actifs de ce photographe. Choix : les clients cochés (parmi les siens).
  const [as, ap] = accountScope(req);
  const [cs, cpar] = clientScope(req);
  let recipients;
  if (data.audience === 'all') {
    recipients = await query(`SELECT u.id FROM users u WHERE u.active = 1 AND ${cs} AND ${as}`, [...cpar, ...ap]);
  } else {
    const ids = [...new Set(data.clientIds)];
    recipients = ids.length
      ? await query(`SELECT u.id FROM users u WHERE u.id IN (${ids.map(() => '?').join(', ')}) AND u.active = 1 AND ${cs} AND ${as}`, [...ids, ...cpar, ...ap])
      : [];
    if (recipients.length !== ids.length) throw httpError(400, 'Certains clients sont introuvables ou désactivés.');
  }
  if (!recipients.length) throw httpError(400, data.audience === 'all' ? 'Aucun client actif à prévenir.' : 'Choisissez au moins un client.');

  const id = crypto.randomUUID();
  await transaction(async (conn) => {
    await conn.execute(
      `INSERT INTO announcements (id, created_by, title, body, event_id, audience, send_email, send_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?::timestamp, CURRENT_TIMESTAMP))`,
      [id, req.user.id, data.title, data.body, event?.id ?? null, data.audience, data.sendEmail ? 1 : 0, sendAt],
    );
    for (let i = 0; i < recipients.length; i += 200) {
      const chunk = recipients.slice(i, i + 200);
      await conn.execute(
        `INSERT INTO announcement_recipients (announcement_id, user_id) VALUES ${chunk.map(() => '(?, ?)').join(', ')}`,
        chunk.flatMap((u) => [id, u.id]),
      );
    }
  });
  audit(req, 'announcement.create', {
    entity: 'announcement', entityId: id, details: { title: data.title, recipients: recipients.length, email: data.sendEmail, sendAt },
  });
  if (data.sendEmail && !sendAt) kickAnnouncements();
  res.status(201).json({ id, recipients: recipients.length, scheduled: Boolean(sendAt), mail: mailConfigured() });
});

// Supprimer : la notification disparaît des cloches ; programmée, elle n'est jamais envoyée.
// Les e-mails déjà partis ne peuvent pas être repris.
router.delete('/announcements/:id', async (req, res) => {
  const [sc, sp] = announcementScope(req);
  const result = await query(`DELETE FROM announcements a WHERE a.id = ? AND ${sc}`, [uuid.parse(req.params.id), ...sp]);
  if (!result.affectedRows) throw httpError(404, 'Notification introuvable.');
  audit(req, 'announcement.delete', { entity: 'announcement', entityId: req.params.id });
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
  // Commentaires de la famille (liens de partage), sur les mêmes galeries.
  const family = await query(
    `SELECT sc.*, l.label AS share_label, p.filename, p.event_id, e.name AS event_name, o.name AS owner_name
     FROM share_comments sc
     JOIN share_links l ON l.id = sc.share_id
     JOIN photos p ON p.id = sc.photo_id
     JOIN events e ON e.id = p.event_id
     JOIN users o ON o.id = e.client_id
     WHERE ${eventScope(req)[0]} ORDER BY sc.created_at DESC LIMIT 200`,
    eventScope(req)[1],
  );
  const context = (c) => ({
    photo: { id: c.photo_id, filename: c.filename, preview: `/media/preview/${c.photo_id}` },
    event: { id: c.event_id, name: c.event_name, owner: c.owner_name },
  });
  res.json({
    comments: [
      ...rows.map((c) => ({ ...mapComment(c, req.user), ...context(c) })),
      ...family.map((c) => ({ ...mapFamilyComment(c, { canDelete: true }), ...context(c) })),
    ].sort(byDate).reverse().slice(0, 200),
  });
});

router.get('/photos/:id/comments', async (req, res) => {
  const photo = await findPhoto(req, req.params.id);
  const [rows, family] = await Promise.all([
    query(`${COMMENT_SELECT} WHERE c.photo_id = ? ORDER BY c.created_at`, [photo.id]),
    query(`${FAMILY_COMMENT_SELECT} WHERE sc.photo_id = ?`, [photo.id]),
  ]);
  res.json({
    comments: [...rows.map((c) => mapComment(c, req.user)), ...family.map((c) => mapFamilyComment(c, { canDelete: true }))].sort(byDate),
  });
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
  const inScope = `photo_id IN (SELECT p.id FROM photos p JOIN events e ON e.id = p.event_id WHERE ${es})`;
  const id = uuid.parse(req.params.id);
  let result = await query(`DELETE FROM photo_comments WHERE id = ? AND ${inScope}`, [id, ...ep]);
  // Sinon : un commentaire de la famille (lien de partage).
  if (!result.affectedRows) result = await query(`DELETE FROM share_comments WHERE id = ? AND ${inScope}`, [id, ...ep]);
  if (!result.affectedRows) throw httpError(404, 'Commentaire introuvable.');
  audit(req, 'comment.delete', { entity: 'comment', entityId: req.params.id });
  res.status(204).end();
});

// ---------- Nettoyer l'espace (propriétaire) ----------
// Fichiers qui n'appartiennent plus à aucune photo, galerie ou compte (anciens essais, suppressions interrompues,
// miniatures de visages d'avant leur retrait). Analyse d'abord, suppression seulement sur demande.
router.get('/storage/orphans', requireOwner, async (req, res) => {
  res.json(await scanOrphans());
});

router.post('/storage/cleanup', requireOwner, async (req, res) => {
  if (config.keepFiles) throw httpError(400, 'Cette copie de test partage le stockage de la production : nettoyage désactivé.');
  const done = await cleanOrphans();
  audit(req, 'storage.cleanup', { details: { files: done.count, bytes: done.bytes } });
  res.json(done);
});

// ---------- Sauvegardes (propriétaire principal uniquement : elles contiennent les données de tous les photographes) ----------
const requirePlatformOwner = async (req, res, next) => {
  if (req.user.role !== 'owner' || !(await isPlatformOwner(req.user))) throw httpError(403, 'Seul le propriétaire principal gère les sauvegardes.');
  next();
};
const backupInfo = async () => {
  const mirror = mirrorConfig();
  return { backups: await listBackups(), mirror: mirror ? { enabled: true, kind: mirror.kind } : { enabled: false }, keep: 14 };
};

router.get('/backups', requirePlatformOwner, async (req, res) => {
  res.json(await backupInfo());
});

router.post('/backups', requirePlatformOwner, async (req, res) => {
  const made = await createBackup({ reason: 'manuelle' });
  await pruneBackups();
  audit(req, 'backup.create', { details: { name: made.name, rows: made.rows } });
  res.status(201).json({ made, ...(await backupInfo()) });
});

router.post('/backups/mirror', requirePlatformOwner, async (req, res) => {
  const done = await mirrorFiles();
  audit(req, 'backup.mirror', { details: { copied: done.copied, remaining: done.remaining } });
  res.json({ ...done, ...(await backupInfo()) });
});

router.get('/backups/download', requirePlatformOwner, async (req, res) => {
  const key = z.string().max(200).parse(req.query.key);
  const stream = await openBackup(key);
  audit(req, 'backup.download', { details: { key } });
  res.set({ 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="${key.split('/').pop()}"`, 'Cache-Control': 'no-store' });
  stream.pipe(res);
});

router.post('/backups/restore', requirePlatformOwner, async (req, res) => {
  const { key, confirm } = z.object({ key: z.string().max(200), confirm: z.string() }).parse(req.body);
  if (confirm !== 'RESTAURER') throw httpError(400, 'Tapez RESTAURER pour confirmer.');
  const result = await restoreBackup(key);
  audit(req, 'backup.restore', { details: { key, safety: result.safety } });
  res.json({ ...result, ...(await backupInfo()) });
});

router.delete('/backups', requirePlatformOwner, async (req, res) => {
  const key = z.string().max(200).parse(req.query.key);
  await deleteBackup(key);
  audit(req, 'backup.delete', { details: { key } });
  res.json(await backupInfo());
});

// ---------- Site en maintenance ----------
// Fermer le site aux visiteurs et aux clients le temps d'une mise à jour. L'équipe garde le studio.
const MAX_MAINTENANCE_MINUTES = 30 * 24 * 60; // 30 jours

router.get('/maintenance', requirePlatformOwner, async (req, res) => {
  res.json({ maintenance: await maintenanceState(), defaults: { title: DEFAULT_TITLE, message: DEFAULT_MESSAGE } });
});

router.put('/maintenance', requirePlatformOwner, async (req, res) => {
  const data = z.object({
    enabled: z.boolean(),
    title: z.string().trim().max(120).optional(),
    message: z.string().trim().max(600).optional(),
    // Durée en minutes à partir de maintenant ; 0 ou absent = jusqu'à nouvel ordre.
    minutes: z.number().int().min(0).max(MAX_MAINTENANCE_MINUTES).nullable().optional(),
  }).strict().parse(req.body);
  // Réouverture : on garde le titre et le message enregistrés, prêts pour la prochaine fois.
  const kept = data.enabled ? null : await maintenanceState();
  const maintenance = await setMaintenance({
    enabled: data.enabled,
    title: data.enabled ? data.title || DEFAULT_TITLE : kept.title,
    message: data.enabled ? data.message || DEFAULT_MESSAGE : kept.message,
    minutes: data.enabled ? data.minutes || null : null,
    userId: req.user.id,
  });
  audit(req, data.enabled ? 'site.maintenance_on' : 'site.maintenance_off', {
    entity: 'site', details: { minutes: data.minutes || null, endsAt: maintenance.endsAt },
  });
  res.json({ maintenance });
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

router.get('/public-services', requirePlatformOwner, async (_req, res) => {
  const [settings, staff, selected] = await Promise.all([publicServices(), bookingStaff(), publicPhotographers()]);
  res.json({ portfolioEnabled: settings.portfolio_enabled, staff: staff.map(({ id, name, portfolio_photo_limit }) => ({ id, name, portfolioPhotoLimit: portfolio_photo_limit })), selected: selected.map(({ id }) => id), teamSelected: staff.filter(({ id }) => settings.team_staff.includes(id)).map(({ id }) => id) });
});

router.put('/public-services', requirePlatformOwner, async (req, res) => {
  const { portfolioEnabled, selected, teamSelected } = z.object({ portfolioEnabled: z.boolean(), selected: z.array(uuid).max(100), teamSelected: z.array(uuid).max(100).optional() }).strict().parse(req.body);
  const allowed = new Set((await bookingStaff()).map(({ id }) => id));
  if ([...selected, ...(teamSelected || [])].some((id) => !allowed.has(id))) throw httpError(400, 'Sélectionnez uniquement des photographes actifs.');
  await query('UPDATE site_public_services SET portfolio_enabled = ?, booking_staff = ?::jsonb, team_staff = COALESCE(?::jsonb, team_staff) WHERE id = 1', [portfolioEnabled, JSON.stringify([...new Set(selected)]), teamSelected === undefined ? null : JSON.stringify([...new Set(teamSelected)])]);
  audit(req, 'site.public_services', { entity: 'site', details: { portfolioEnabled, selected, teamSelected } });
  res.json({ ok: true });
});

router.put('/public-services/:id/portfolio-limit', requirePlatformOwner, async (req, res) => {
  const id = uuid.parse(req.params.id);
  const { limit } = z.object({ limit: z.number().int().min(10).max(2147483647) }).strict().parse(req.body);
  const [staff] = await query("UPDATE users SET portfolio_photo_limit = ? WHERE id = ? AND active = 1 AND role IN ('owner', 'admin') RETURNING id", [limit, id]);
  if (!staff) throw httpError(404, 'Photographe actif introuvable.');
  audit(req, 'portfolio.limit', { entity: 'user', entityId: id, details: { limit } });
  res.json({ limit });
});

router.get('/booking-operations', requirePlatformOwner, async (_req, res) => {
  const [[settings], applications, payments, team] = await Promise.all([
    query('SELECT booking_payment FROM site_public_services WHERE id = 1'),
    query('SELECT id, name, email, phone, message, reviewed_at, payment_method, transfer_code, payment_amount, logo_key IS NOT NULL AS has_logo FROM photographer_applications ORDER BY reviewed_at NULLS FIRST, created_at DESC LIMIT 100'),
    query('SELECT id, name, payment_code, payment_amount, payment_verified_at FROM portfolio_requests WHERE payment_code IS NOT NULL ORDER BY payment_verified_at NULLS FIRST, created_at DESC LIMIT 100'),
    bookingStaff(),
  ]);
  res.set('Cache-Control', 'no-store').json({ settings: settings.booking_payment, applications, payments, team: team.map(({ id, name }) => ({ id, name })) });
});

router.put('/booking-operations/payment', requirePlatformOwner, async (req, res) => {
  const number = z.string().trim().regex(/^(?:\+?509)?[0-9]{8}$|^$/, 'Saisissez 8 chiffres, avec ou sans indicatif +509.');
  const settings = z.object({ moncash: number, natcash: number, amount: z.number().int().min(0).max(10000000), applicationAmount: z.number().int().min(0).max(10000000).optional().default(0) }).strict().parse(req.body);
  if (settings.applicationAmount && !settings.moncash && !settings.natcash) throw httpError(400, 'Ajoutez un numéro MonCash ou NatCash pour les frais de candidature.');
  await query('UPDATE site_public_services SET booking_payment = ?::jsonb WHERE id = 1', [JSON.stringify(settings)]);
  res.json({ ok: true });
});

router.put('/booking-operations/applications/:id/review', requirePlatformOwner, async (req, res) => {
  const [row] = await query('UPDATE photographer_applications SET reviewed_at = COALESCE(reviewed_at, CURRENT_TIMESTAMP) WHERE id = ? RETURNING id', [uuid.parse(req.params.id)]);
  if (!row) throw httpError(404, 'Candidature introuvable.');
  res.json({ ok: true });
});

router.put('/booking-operations/payments/:id/verify', requirePlatformOwner, async (req, res) => {
  const [row] = await query('UPDATE portfolio_requests SET payment_verified_at = COALESCE(payment_verified_at, CURRENT_TIMESTAMP) WHERE id = ? AND payment_code IS NOT NULL RETURNING id', [uuid.parse(req.params.id)]);
  if (!row) throw httpError(404, 'Paiement introuvable.');
  audit(req, 'booking.payment_verified', { entity: 'portfolio_request', entityId: row.id });
  res.json({ ok: true });
});

router.get('/booking-operations/applications/:id/logo', requirePlatformOwner, async (req, res) => {
  const [application] = await query('SELECT logo_key FROM photographer_applications WHERE id = ?', [uuid.parse(req.params.id)]);
  if (!application?.logo_key) throw httpError(404, 'Logo introuvable.');
  res.set('Cache-Control', 'private, no-store').type('image/png').send(await readFile(application.logo_key));
});

router.put('/booking-operations/applications/:id/logo', requirePlatformOwner, async (req, res) => {
  const id = uuid.parse(req.params.id);
  const { staffId } = z.object({ staffId: uuid }).strict().parse(req.body);
  const [result] = await query(`INSERT INTO photographer_profiles (staff_id, logo_key)
    SELECT u.id, a.logo_key FROM users u CROSS JOIN photographer_applications a
    WHERE u.id = ? AND u.active = 1 AND u.role IN ('owner', 'admin')
      AND a.id = ? AND a.logo_key IS NOT NULL
    ON CONFLICT (staff_id) DO UPDATE SET logo_key = EXCLUDED.logo_key RETURNING staff_id`, [staffId, id]);
  if (!result) throw httpError(404, 'Logo ou photographe introuvable.');
  audit(req, 'photographer.logo_assigned', { entity: 'user', entityId: staffId });
  res.json({ ok: true });
});
