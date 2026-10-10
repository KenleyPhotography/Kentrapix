import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';
import { httpError } from '../lib/errors.js';

export const SESSION_COOKIE = 'kp_session';

const cookieOptions = () => ({
  httpOnly: true, // inaccessible au JavaScript de la page
  secure: config.isProd, // HTTPS obligatoire en production
  sameSite: 'strict', // protège contre les requêtes d'autres sites (CSRF)
  path: '/',
});

export function issueSession(res, user, remember = false) {
  const days = remember ? 30 : config.sessionDays;
  const token = jwt.sign({ sub: user.id, role: user.role, v: user.token_version }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: `${days}d`,
  });
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: days * 24 * 60 * 60 * 1000 });
}

export function clearSession(res) {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

/**
 * Lit le cookie de session et charge l'utilisateur depuis la base à chaque requête :
 * un compte désactivé ou un mot de passe changé coupe l'accès immédiatement.
 */
export async function loadUser(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return next();
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    const [user] = await query(
      'SELECT id, role, name, email, phone, sender_name, avatar_key, active, must_change_password, token_version, notifications_seen_at, access_code, access_granted FROM users WHERE id = ?',
      [payload.sub],
    );
    if (user && user.active && user.role === payload.role && user.token_version === payload.v) req.user = user;
    else clearSession(res);
  } catch {
    clearSession(res);
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) throw httpError(401, 'Veuillez vous connecter.');
  next();
}

export const STAFF_ROLES = ['owner', 'admin'];
export const isStaff = (user) => STAFF_ROLES.includes(user?.role);

/**
 * Exige un compte connecté, au mot de passe définitif (pas temporaire),
 * et — si précisé — l'un des rôles donnés.
 */
export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) throw httpError(401, 'Veuillez vous connecter.');
  if (roles.length && !roles.includes(req.user.role)) throw httpError(403, 'Accès refusé.');
  if (req.user.must_change_password) throw httpError(403, 'Changez votre mot de passe temporaire pour continuer.');
  if (needsCode(req.user)) throw httpError(403, 'Entrez le code de votre photographe pour continuer.');
  next();
};

/** Client inscrit seul, qui n'a pas encore validé le code d'un photographe : aucun accès aux galeries. */
export const needsCode = (user) => user?.role === 'client' && !user.access_granted;

/** Pour les routes qui n'exigent que la connexion (images) : refuse aussi les clients sans code. */
export const blockPending = (req, res, next) => {
  if (needsCode(req.user)) throw httpError(403, 'Entrez le code de votre photographe pour continuer.');
  next();
};

/** Studio : propriétaire et admins. */
export const requireStaff = requireRole(...STAFF_ROLES);
/** Gestion de l'équipe : propriétaire uniquement. */
export const requireOwner = requireRole('owner');
