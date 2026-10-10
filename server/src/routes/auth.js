import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { query, utcStamp, toIso } from '../db.js';
import { httpError } from '../lib/errors.js';
import { publicUser, getPermissions } from '../lib/data.js';
import { config } from '../config.js';
import { sendMail } from '../lib/mailer.js';
import { resetLinkEmail, signupEmail } from '../lib/emails.js';
import { audit } from '../lib/audit.js';
import { upload, storeAvatar, removeKeys } from '../lib/storage.js';
import { issueSession, clearSession, requireAuth, requireRole, requireStaff, issueStudioUnlock, studioUnlocked } from '../middleware/auth.js';
import { codeRule } from '../lib/accessCode.js';

export const BCRYPT_COST = 12;
export const passwordRule = z
  .string()
  .min(8, 'Le mot de passe doit contenir au moins 8 caractères.')
  .max(200, 'Mot de passe trop long.');

const router = Router();

// Max 10 tentatives de connexion par IP toutes les 15 minutes.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Trop de tentatives. Réessayez dans 15 minutes.' },
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('E-mail ou mot de passe incorrect.').max(190),
  password: z.string().min(1, 'E-mail ou mot de passe incorrect.').max(200),
  remember: z.boolean().optional(),
});

// Hash factice : la réponse prend le même temps que l'e-mail existe ou non.
const DUMMY_HASH = bcrypt.hashSync('kentrapix-timing-guard', BCRYPT_COST);

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password, remember } = loginSchema.parse(req.body);
  const [user] = await query('SELECT * FROM users WHERE email = ?', [email]);
  const valid = await bcrypt.compare(password, user?.password_hash || DUMMY_HASH);
  if (!user || !valid) {
    audit(req, 'auth.login_failed', { userId: user?.id ?? null, details: { email } });
    throw httpError(401, 'E-mail ou mot de passe incorrect.');
  }
  if (!user.active) {
    audit(req, 'auth.login_blocked', { userId: user.id });
    throw httpError(403, 'Ce compte est en pause. Contactez votre photographe.');
  }

  await query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
  audit(req, 'auth.login', { userId: user.id });
  issueSession(res, user, remember);
  res.json({ user: publicUser(user) });
});

// ---------- Options publiques de la page de connexion ----------
router.get('/options', async (req, res) => {
  res.json({ signup: (await getPermissions()).signup });
});

// ---------- Créer un compte (inscription libre) ----------
// Le nouveau compte est un client sans galerie. Il n'a aucun accès tant qu'il n'a pas saisi le code d'un photographe
// (POST /access-code) : ce code le rattache à ce photographe, qui sera le seul à voir son compte.
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Trop de comptes créés depuis cette connexion. Réessayez plus tard.' },
});

router.post('/signup', signupLimiter, async (req, res) => {
  if (!(await getPermissions()).signup) throw httpError(403, 'La création de compte est fermée. Contactez votre photographe.');
  const data = z
    .object({
      name: z.string().trim().min(2, 'Entrez votre nom complet.').max(120),
      email: z.string().trim().toLowerCase().email('Adresse e-mail invalide.').max(190),
      phone: z.string().trim().max(40).optional().transform((v) => v || null),
      password: passwordRule,
    })
    .parse(req.body);
  const [exists] = await query('SELECT id FROM users WHERE email = ?', [data.email]);
  if (exists) throw httpError(409, 'Un compte existe déjà avec cet e-mail. Connectez-vous ou utilisez « Mot de passe oublié ».');
  const id = crypto.randomUUID();
  const hash = await bcrypt.hash(data.password, BCRYPT_COST);
  await query(
    "INSERT INTO users (id, role, name, email, phone, password_hash, last_login_at, access_granted) VALUES (?, 'client', ?, ?, ?, ?, CURRENT_TIMESTAMP, 0)",
    [id, data.name, data.email, data.phone, hash],
  );
  audit(req, 'auth.signup', { userId: id, details: { email: data.email } });
  const [user] = await query('SELECT * FROM users WHERE id = ?', [id]);
  sendMail({ to: user.email, userId: user.id, kind: 'welcome', ...signupEmail(user) });
  issueSession(res, user);
  res.status(201).json({ user: publicUser(user) });
});

// ---------- Code du photographe (clients inscrits seuls) ----------
// Peu de combinaisons possibles : essais limités par compte et par connexion.
const codeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 8,
  keyGenerator: (req) => `${req.user?.id || 'anon'}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Trop d’essais. Réessayez dans une heure ou demandez le bon code à votre photographe.' },
});

router.post('/access-code', requireAuth, codeLimiter, async (req, res) => {
  if (req.user.role !== 'client' || req.user.access_granted) throw httpError(400, 'Votre accès est déjà actif.');
  const { code } = z.object({ code: codeRule }).parse(req.body);
  const [staff] = await query("SELECT id, name FROM users WHERE access_code = ? AND role IN ('owner', 'admin') AND active = 1", [code]);
  if (!staff) {
    audit(req, 'auth.code_failed');
    throw httpError(400, 'Code incorrect. Vérifiez-le auprès de votre photographe.');
  }
  await query('UPDATE users SET created_by = ?, access_granted = 1 WHERE id = ? AND access_granted = 0', [staff.id, req.user.id]);
  audit(req, 'auth.code_ok', { details: { photographer: staff.id } });
  const [user] = await query('SELECT * FROM users WHERE id = ?', [req.user.id]);
  res.json({ user: publicUser(user) });
});

// Le membre de l'équipe change son propre code (2 à 4 caractères, unique).
router.patch('/my-code', requireRole('owner', 'admin'), async (req, res) => {
  const { code } = z.object({ code: codeRule }).parse(req.body);
  const [used] = await query('SELECT id FROM users WHERE access_code = ? AND id <> ?', [code, req.user.id]);
  if (used) throw httpError(409, 'Ce code est déjà utilisé par quelqu’un d’autre. Choisissez-en un autre.');
  await query('UPDATE users SET access_code = ? WHERE id = ?', [code, req.user.id]);
  audit(req, 'profile.code_change');
  const [user] = await query('SELECT * FROM users WHERE id = ?', [req.user.id]);
  res.json({ user: publicUser(user) });
});

// ---------- Mot de passe du studio (équipe) ----------
const studioLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  keyGenerator: (req) => `${req.user?.id || 'anon'}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Trop d’essais. Réessayez dans 15 minutes.' },
});
const studioRule = z.string().min(6, 'Le mot de passe du studio doit contenir au moins 6 caractères.').max(200, 'Mot de passe trop long.');

router.get('/studio', requireStaff, async (req, res) => {
  const [row] = await query('SELECT studio_password_hash FROM users WHERE id = ?', [req.user.id]);
  res.json({ hasPassword: !!row.studio_password_hash, unlocked: studioUnlocked(req) });
});

router.post('/studio/unlock', requireStaff, studioLimiter, async (req, res) => {
  const { password } = z.object({ password: z.string().min(1, 'Entrez le mot de passe du studio.').max(200) }).parse(req.body);
  const [row] = await query('SELECT studio_password_hash FROM users WHERE id = ?', [req.user.id]);
  if (!row.studio_password_hash) throw httpError(400, 'Créez d’abord le mot de passe de votre studio.');
  if (!(await bcrypt.compare(password, row.studio_password_hash))) {
    audit(req, 'studio.unlock_failed');
    throw httpError(401, 'Mot de passe du studio incorrect.');
  }
  audit(req, 'studio.unlock');
  issueStudioUnlock(res, req.user);
  res.json({ ok: true });
});

// Création (avec le mot de passe de connexion, pour prouver que c'est bien la personne) ou changement
// (avec l'actuel mot de passe du studio). Déverrouille le studio dans les deux cas.
router.post('/studio/password', requireStaff, studioLimiter, async (req, res) => {
  const { current, login, password } = z.object({
    current: z.string().max(200).optional(),
    login: z.string().max(200).optional(),
    password: studioRule,
  }).parse(req.body);
  const [row] = await query('SELECT password_hash, studio_password_hash FROM users WHERE id = ?', [req.user.id]);
  if (row.studio_password_hash) {
    if (!current || !(await bcrypt.compare(current, row.studio_password_hash))) throw httpError(400, 'Mot de passe actuel du studio incorrect.');
  } else if (!login || !(await bcrypt.compare(login, row.password_hash))) {
    throw httpError(400, 'Mot de passe de connexion incorrect.');
  }
  if (await bcrypt.compare(password, row.password_hash)) throw httpError(400, 'Choisissez un mot de passe du studio différent de votre mot de passe de connexion.');
  await query('UPDATE users SET studio_password_hash = ? WHERE id = ?', [await bcrypt.hash(password, BCRYPT_COST), req.user.id]);
  audit(req, row.studio_password_hash ? 'studio.password_change' : 'studio.password_create');
  issueStudioUnlock(res, req.user);
  res.json({ ok: true });
});

// ---------- Mot de passe oublié ----------
const RESET_MINUTES = 60;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Trop de demandes. Réessayez dans 15 minutes.' },
});

// Réponse identique que l'e-mail existe ou non (on ne révèle pas qui a un compte).
router.post('/forgot', resetLimiter, async (req, res) => {
  const { email } = z.object({ email: z.string().trim().toLowerCase().email('Adresse e-mail invalide.').max(190) }).parse(req.body);
  const [user] = await query('SELECT * FROM users WHERE email = ? AND active = 1', [email]);
  if (user) {
    const token = crypto.randomBytes(32).toString('base64url');
    await query('UPDATE password_resets SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND used_at IS NULL', [user.id]);
    await query(
      `INSERT INTO password_resets (id, user_id, token_hash, expires_at)
       VALUES (?, ?, ?, ?)`,
      [crypto.randomUUID(), user.id, sha256(token), utcStamp(new Date(Date.now() + RESET_MINUTES * 60000))],
    );
    audit(req, 'auth.reset_request', { userId: user.id });
    await sendMail({
      to: user.email, userId: user.id, kind: 'password_reset',
      ...resetLinkEmail({ name: user.name, url: `${config.appUrl}/login.html?reset=${token}` }),
    });
  }
  res.json({ ok: true, message: 'Si un compte existe avec cet e-mail, un lien vient de lui être envoyé.' });
});

router.post('/reset', resetLimiter, async (req, res) => {
  const { token, password } = z.object({ token: z.string().min(20).max(200), password: passwordRule }).parse(req.body);
  const [reset] = await query(
    'SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP',
    [sha256(token)],
  );
  if (!reset) throw httpError(400, 'Ce lien n’est plus valable. Refaites une demande « Mot de passe oublié ».');
  const hash = await bcrypt.hash(password, BCRYPT_COST);
  await query('UPDATE password_resets SET used_at = CURRENT_TIMESTAMP WHERE id = ?', [reset.id]);
  await query(
    'UPDATE users SET password_hash = ?, must_change_password = 0, token_version = token_version + 1, studio_password_hash = NULL WHERE id = ?',
    [hash, reset.user_id],
  );
  audit(req, 'auth.reset_done', { userId: reset.user_id });
  const [user] = await query('SELECT * FROM users WHERE id = ? AND active = 1', [reset.user_id]);
  if (!user) throw httpError(403, 'Ce compte est en pause. Contactez votre photographe.');
  issueSession(res, user);
  res.json({ user: publicUser(user) });
});

// Cloche ouverte : tout ce qui précède est marqué comme vu.
router.post('/notifications/seen', requireAuth, async (req, res) => {
  const [row] = await query('UPDATE users SET notifications_seen_at = CURRENT_TIMESTAMP WHERE id = ? RETURNING notifications_seen_at', [req.user.id]);
  res.json({ seenAt: toIso(row.notifications_seen_at) });
});

router.post('/logout', (req, res) => {
  if (req.user) audit(req, 'auth.logout');
  clearSession(res);
  res.status(204).end();
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// ---------- Profil (tout compte connecté) ----------
// L'e-mail sert d'identifiant : seul le studio peut le modifier.
const profileSchema = z.object({
  name: z.string().trim().min(1, 'Le nom est obligatoire.').max(120),
  phone: z.string().trim().max(40).optional().transform((v) => v || null),
  // Photographes : nom affiché comme expéditeur de leurs e-mails (vide = nom du compte).
  senderName: z.string().trim().max(80).optional(),
  // Photographes : coordonnées montrées à leurs clients.
  whatsapp: z.string().trim().max(40).optional(),
  website: z.string().trim().max(200).optional(),
  instagram: z.string().trim().max(80).optional(),
  address: z.string().trim().max(200).optional(),
  bio: z.string().trim().max(500).optional(),
});

// Adresse de site : https:// ajouté si absent ; refus de tout autre schéma (javascript:…).
const cleanWebsite = (v) => {
  if (!v) return null;
  const url = v.toLowerCase().startsWith('http://') || v.toLowerCase().startsWith('https://') ? v : `https://${v}`;
  try { return ['http:', 'https:'].includes(new URL(url).protocol) ? url : null; } catch { return null; }
};
// Identifiant Instagram : accepte « @nom » ou le lien du profil.
const cleanInstagram = (v) => {
  if (!v) return null;
  const handle = v.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').split(/[/?#]/)[0].replace(/[^A-Za-z0-9._]/g, '');
  return handle || null;
};

router.patch('/profile', requireRole(), async (req, res) => {
  const { name, phone, senderName, whatsapp, website, instagram, address, bio } = profileSchema.parse(req.body);
  const staff = ['owner', 'admin'].includes(req.user.role);
  const sender = staff && senderName !== undefined ? senderName || null : req.user.sender_name ?? null;
  await query('UPDATE users SET name = ?, phone = ?, sender_name = ? WHERE id = ?', [name, phone, sender, req.user.id]);
  if (staff) {
    await query('UPDATE users SET whatsapp = ?, website = ?, instagram = ?, address = ?, bio = ? WHERE id = ?', [
      whatsapp || null, cleanWebsite(website), cleanInstagram(instagram), address || null, bio || null, req.user.id,
    ]);
  }
  audit(req, 'profile.update');
  const [user] = await query('SELECT * FROM users WHERE id = ?', [req.user.id]);
  res.json({ user: publicUser(user) });
});

router.post('/avatar', requireRole(), upload.single('avatar'), async (req, res) => {
  if (!req.file) throw httpError(400, 'Choisissez une image.');
  const key = await storeAvatar(req.file);
  const [old] = await query('SELECT avatar_key FROM users WHERE id = ?', [req.user.id]);
  await query('UPDATE users SET avatar_key = ? WHERE id = ?', [key, req.user.id]);
  await removeKeys([old?.avatar_key]);
  const [user] = await query('SELECT * FROM users WHERE id = ?', [req.user.id]);
  res.json({ user: publicUser(user) });
});

router.delete('/avatar', requireRole(), async (req, res) => {
  const [old] = await query('SELECT avatar_key FROM users WHERE id = ?', [req.user.id]);
  await query('UPDATE users SET avatar_key = NULL WHERE id = ?', [req.user.id]);
  await removeKeys([old?.avatar_key]);
  const [user] = await query('SELECT * FROM users WHERE id = ?', [req.user.id]);
  res.json({ user: publicUser(user) });
});

const changeSchema = z.object({
  currentPassword: z.string().min(1, 'Entrez votre mot de passe actuel.').max(200),
  newPassword: passwordRule,
});

router.post('/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = changeSchema.parse(req.body);
  if (currentPassword === newPassword) throw httpError(400, 'Choisissez un mot de passe différent de l’actuel.');
  const [row] = await query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  if (!(await bcrypt.compare(currentPassword, row.password_hash))) throw httpError(400, 'Mot de passe actuel incorrect.');

  const hash = await bcrypt.hash(newPassword, BCRYPT_COST);
  // token_version + 1 : déconnecte les autres appareils.
  await query(
    'UPDATE users SET password_hash = ?, must_change_password = 0, token_version = token_version + 1 WHERE id = ?',
    [hash, req.user.id],
  );
  audit(req, 'auth.password_change');
  const [user] = await query('SELECT * FROM users WHERE id = ?', [req.user.id]);
  issueSession(res, user);
  res.json({ user: publicUser(user) });
});

export default router;
