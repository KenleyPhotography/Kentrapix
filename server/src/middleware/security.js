// Qui peut appeler l'API, et à quelle vitesse.
//  - CORS : seules les pages de ce site (et celles listées dans CORS_ORIGINS) peuvent appeler l'API.
//  - Limitation du débit : plafond de requêtes par minute, pour que personne ne puisse marteler le serveur.
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { httpError } from '../lib/errors.js';

// ====================================================================================================
//  CORS
// ====================================================================================================
// Le site, l'application Android (Capacitor) et l'application de bureau (Electron) ouvrent tous la même
// adresse : les requêtes partent donc de la même origine et il n'y a aucun autre site à autoriser.
// CORS_ORIGINS sert à en ajouter (copie de test, outil interne) sans toucher au code.
const ALLOWED = new Set([config.appUrl, ...config.corsOrigins]);
// Ce qui est protégé : l'API et les photos privées. Les pages publiques restent ouvertes.
const PRIVATE = /^\/(?:api|media)(?:\/|$)/;

/** Même origine : le navigateur appelle l'adresse par laquelle il a chargé la page (quel que soit le domaine utilisé). */
const sameOrigin = (origin, req) => {
  try { return new URL(origin).host === req.get('host'); } catch { return false; }
};

const allowed = (origin, req) => sameOrigin(origin, req) || ALLOWED.has(origin.replace(/\/$/, ''));

/**
 * Posé avant toutes les routes. Origine autorisée : en-têtes CORS (et réponse immédiate au « préflight »).
 * Autre site : aucun en-tête CORS — et pour l'API, requête refusée tout de suite.
 */
export function corsGate(req, res, next) {
  const origin = req.get('origin');
  // Réponse qui dépend de l'origine : les caches (Cloudflare…) doivent en tenir compte.
  // Les fichiers du site (CSS, images) n'ont pas d'origine et gardent donc un cache unique.
  if (origin) res.vary('Origin');
  if (origin && allowed(origin, req)) {
    res.set({
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, PATCH, DELETE',
      'Access-Control-Allow-Headers': 'Content-Type, Accept',
      'Access-Control-Max-Age': '600',
    });
    return req.method === 'OPTIONS' ? res.status(204).end() : next();
  }
  if (!PRIVATE.test(req.path)) return next();
  // Sans en-tête CORS, un autre site ne peut pas lire la réponse — mais une requête « simple »
  // (formulaire, image) partirait quand même : on la refuse. C'est la serrure principale contre les
  // requêtes montées depuis un autre site ; le cookie de session (SameSite=lax) en est la seconde.
  if (req.method === 'OPTIONS') return res.status(403).end();
  if (origin || req.get('sec-fetch-site') === 'cross-site') throw httpError(403, 'Requête refusée : elle ne vient pas de ce site.');
  next();
}

// ====================================================================================================
//  Limitation du débit
// ====================================================================================================
// Les plafonds précis (connexion, code du photographe, mot de passe du studio…) restent dans leurs
// routes. Ceux-ci sont les plafonds généraux : ils n'arrêtent qu'un usage anormal.
const limiter = (opts) => rateLimit({ standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Trop de requêtes. Patientez une minute.' }, ...opts });

// Surveillance de l'hébergeur et numéro de version de l'application : jamais limités.
const SERVICE = /^(?:\/api)?\/(?:health|app-version)$/;
const service = (req) => SERVICE.test(req.path);

/** Sans compte : plafond par connexion internet. */
export const apiGuestLimiter = limiter({
  windowMs: 60 * 1000,
  limit: 120,
  skip: (req) => !!req.user || service(req),
});

/** Compte connecté : plafond par compte, large — un import de photos enchaîne les requêtes. */
export const apiUserLimiter = limiter({
  windowMs: 60 * 1000,
  limit: 900,
  skip: (req) => !req.user || service(req),
  keyGenerator: (req) => req.user.id,
});

/** Écritures sans compte (inscription, signature d'un contrat, commentaires d'un partage…) : bien plus rares. */
export const guestWriteLimiter = limiter({
  windowMs: 60 * 1000,
  limit: 40,
  skip: (req) => !!req.user || ['GET', 'HEAD', 'OPTIONS'].includes(req.method),
});

/** Pages ouvertes par un lien secret (facture, contrat) : ralentit la recherche d'un lien au hasard. */
export const publicLinkLimiter = limiter({ windowMs: 60 * 1000, limit: 60 });

/** Photos d'un lien de partage famille (sans compte) : une galerie charge beaucoup d'images d'un coup. */
export const shareMediaLimiter = limiter({ windowMs: 60 * 1000, limit: 600 });
