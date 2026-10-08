import { query } from '../db.js';

/**
 * Écrit une ligne dans audit_log. Ne bloque jamais la requête : une erreur
 * de journalisation est affichée dans la console mais n'empêche pas l'action.
 * Ne jamais mettre de mot de passe dans `details`.
 */
export function audit(req, action, { userId = req.user?.id ?? null, entity = null, entityId = null, details = null } = {}) {
  query(
    'INSERT INTO audit_log (user_id, action, entity, entity_id, details, ip) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, action, entity, entityId, details ? JSON.stringify(details) : null, req.ip ?? null],
  ).catch((err) => console.error('audit_log :', err.message));
}
