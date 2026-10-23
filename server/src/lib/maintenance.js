// Site en maintenance : le propriétaire principal ferme le site le temps d'une mise à jour.
// Visiteurs et clients voient une page « en cours de maintenance » (503, avec le temps restant) ;
// l'équipe (propriétaire + admins) garde l'accès au studio pour travailler et rouvrir.
// La durée saisie donne une heure de fin : passé cette heure, le site se rouvre tout seul.
import path from 'node:path';
import { query, toIso } from '../db.js';
import { frontendRoot } from '../config.js';

export const DEFAULT_TITLE = 'Site en cours de maintenance';
export const DEFAULT_MESSAGE = 'KentraPix est momentanément fermé le temps d’une mise à jour. '
  + 'Vos photos et vos galeries sont en sécurité : tout revient dès la fin des travaux.';

const OFF = { enabled: false, title: '', message: '', startedAt: null, endsAt: null };

const shape = (row) => ({
  enabled: !!row.enabled,
  title: row.title || '',
  message: row.message || '',
  startedAt: toIso(row.started_at),
  endsAt: toIso(row.ends_at),
});

// Lu à chaque requête : une copie de 5 s évite d'interroger la base en boucle.
// Deux serveurs en parallèle (PC + Render) voient donc le changement au bout de 5 s au plus.
const TTL = 5000;
let cache = null;
let cacheAt = 0;
const forget = () => { cache = null; cacheAt = 0; };

/** Réglage enregistré, tel quel (sans tenir compte de l'heure de fin). */
export async function readMaintenance() {
  if (cache && Date.now() - cacheAt < TTL) return cache;
  try {
    const [row] = await query('SELECT enabled, title, message, started_at, ends_at FROM site_maintenance WHERE id = 1');
    cache = row ? shape(row) : { ...OFF };
  } catch {
    cache = { ...OFF }; // migration pas encore appliquée : le site reste ouvert
  }
  cacheAt = Date.now();
  return cache;
}

/** Durée dépassée : le site se rouvre tout seul (et le réglage est remis à zéro en base). */
const over = (m) => !!m.endsAt && Date.parse(m.endsAt) <= Date.now();

/** État réel : { enabled } tient compte de la durée écoulée. */
export async function maintenanceState() {
  const m = await readMaintenance();
  if (!m.enabled || !over(m)) return m;
  // Durée écoulée : le site est rouvert tout de suite (la copie en mémoire évite de relire la base),
  // et le réglage est remis à zéro sans faire attendre la requête en cours.
  cache = { ...m, enabled: false };
  cacheAt = Date.now();
  query('UPDATE site_maintenance SET enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE id = 1 AND enabled = 1').catch(() => {});
  return cache;
}

/**
 * Ferme ou rouvre le site. minutes : durée à partir de maintenant (0 / null = jusqu'à nouvel ordre).
 * L'heure de fin est calculée par la base, pour ne pas dépendre de l'horloge du serveur.
 */
export async function setMaintenance({ enabled, title = '', message = '', minutes = null, userId = null }) {
  const on = enabled ? 1 : 0;
  const timed = !!(enabled && minutes);
  const [row] = await query(
    `UPDATE site_maintenance SET enabled = ?, title = ?, message = ?,
       started_at = CASE WHEN ? = 1 THEN COALESCE(started_at, CURRENT_TIMESTAMP) ELSE NULL END,
       ends_at = ${timed ? "CURRENT_TIMESTAMP + (?::int * INTERVAL '1 minute')" : 'NULL'},
       updated_by = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = 1
     RETURNING enabled, title, message, started_at, ends_at`,
    // started_at garde l'heure de la première fermeture tant que le site reste fermé.
    [on, title.slice(0, 120), message.slice(0, 600), on, ...(timed ? [minutes] : []), userId],
  );
  forget();
  return row ? shape(row) : { ...OFF };
}

// ---------- Blocage des pages et de l'API ----------

const staff = (user) => ['owner', 'admin'].includes(user?.role);
// Restent joignables : les fichiers de la page de maintenance, la connexion, le studio
// (pour rouvrir le site) et la surveillance de l'hébergeur.
const OPEN_PAGE = /^\/(?:css|js|img|logo)\/|^\/(?:login|admin|maintenance|conditions|sitemap\.xml|robots\.txt|manifest\.webmanifest|sw\.js|favicon\.ico)$/;
const OPEN_API = /^\/api\/(?:health$|app-version$|auth\/|admin\/)/;
// Lecture seule : ce qui alimente la page de maintenance et la page de connexion (avis affichés).
const OPEN_READ_API = /^\/api\/public\//;

/** Secondes restantes, pour l'en-tête Retry-After (1 h par défaut). */
const retryAfter = (m) => (m.endsAt ? Math.max(30, Math.round((Date.parse(m.endsAt) - Date.now()) / 1000)) : 3600);

/** Porte d'entrée du site : posée avant toutes les routes. */
export async function maintenanceGate(req, res, next) {
  const read = ['GET', 'HEAD'].includes(req.method);
  if (OPEN_PAGE.test(req.path) || OPEN_API.test(req.path)) return next();
  if (read && OPEN_READ_API.test(req.path)) return next();
  const m = await maintenanceState();
  if (!m.enabled || staff(req.user)) return next();
  res.set('Retry-After', String(retryAfter(m)));
  // L'application déjà ouverte chez un client reconnaît cet en-tête et affiche la page de maintenance.
  if (req.path.startsWith('/api/') || req.path.startsWith('/media/')) {
    return res.status(503).set('X-Maintenance', '1').json({ error: 'Site en maintenance. Revenez dans un instant.', maintenance: true });
  }
  if (!read) return res.status(503).type('text').send('Site en maintenance.');
  res.status(503).set({ 'Cache-Control': 'no-store', Vary: 'Cookie' }).sendFile(path.join(frontendRoot, 'maintenance.html'));
}

/** Données de la page de maintenance (publique, sans compte). */
export async function maintenanceStatus(req, res) {
  const m = await maintenanceState();
  res.set('Cache-Control', 'no-store').json({
    enabled: m.enabled,
    title: m.title || DEFAULT_TITLE,
    message: m.message || DEFAULT_MESSAGE,
    startedAt: m.startedAt,
    endsAt: m.endsAt,
    now: new Date().toISOString(),
  });
}
