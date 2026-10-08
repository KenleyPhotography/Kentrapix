import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { query } from '../db.js';
import { httpError } from '../lib/errors.js';
import { publicUser, getPermissions } from '../lib/data.js';
import { config } from '../config.js';
import { sendMail } from '../lib/mailer.js';
import { resetLinkEmail, signupEmail } from '../lib/emails.js';
import { audit } from '../lib/audit.js';
import { upload, storeAvatar, removeKeys } from '../lib/storage.js';
import { issueSession, clearSession, requireAuth, requireRole } from '../middleware/auth.js';

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
    throw httpError(403, 'Ce compte est désactivé. Contactez Kenley Photography.');
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
// Le nouveau compte est un client sans galerie : il ne voit rien tant que le studio ne lui a rien publié.
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Trop de comptes créés depuis cette connexion. Réessayez plus tard.' },
});

router.post('/signup', signupLimiter, async (req, res) => {
  if (!(await getPermissions()).signup) throw httpError(403, 'La création de compte est fermée. Contactez Kenley Photography.');
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
    "INSERT INTO users (id, role, name, email, phone, password_hash, last_login_at) VALUES (?, 'client', ?, ?, ?, ?, CURRENT_TIMESTAMP)",
    [id, data.name, data.email, data.phone, hash],
  );
  audit(req, 'auth.signup', { userId: id, details: { email: data.email } });
  const [user] = await query('SELECT * FROM users WHERE id = ?', [id]);
  sendMail({ to: user.email, userId: user.id, kind: 'welcome', ...signupEmail(user) });
  issueSession(res, user);
  res.status(201).json({ user: publicUser(user) });
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
       VALUES (?, ?, ?, CURRENT_TIMESTAMP + INTERVAL ${RESET_MINUTES} MINUTE)`,
      [crypto.randomUUID(), user.id, sha256(token)],
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
    'UPDATE users SET password_hash = ?, must_change_password = 0, token_version = token_version + 1 WHERE id = ?',
    [hash, reset.user_id],
  );
  audit(req, 'auth.reset_done', { userId: reset.user_id });
  const [user] = await query('SELECT * FROM users WHERE id = ? AND active = 1', [reset.user_id]);
  if (!user) throw httpError(403, 'Ce compte est désactivé. Contactez Kenley Photography.');
  issueSession(res, user);
  res.json({ user: publicUser(user) });
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
});

router.patch('/profile', requireRole(), async (req, res) => {
  const { name, phone, senderName } = profileSchema.parse(req.body);
  const staff = ['owner', 'admin'].includes(req.user.role);
  const sender = staff && senderName !== undefined ? senderName || null : req.user.sender_name ?? null;
  await query('UPDATE users SET name = ?, phone = ?, sender_name = ? WHERE id = ?', [name, phone, sender, req.user.id]);
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
