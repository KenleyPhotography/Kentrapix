// Qui voit quoi : chaque photographe — propriétaire compris — ne voit que ses clients (ceux qui ont saisi son code,
// ou qu'il a créés) et ses galeries. Le propriétaire voit en plus l'équipe et les comptes encore sans photographe.
export const isOwner = (req) => req.user.role === 'owner';

const linked = (a) => `EXISTS (SELECT 1 FROM client_photographers cp WHERE cp.client_id = ${a}.id AND cp.staff_id = ?)`;

/** Filtre SQL des comptes visibles : [condition, paramètres]. */
export const accountScope = (req, a = 'u') => (isOwner(req)
  ? [`(${a}.role <> 'client' OR ${a}.created_by IS NULL OR ${a}.created_by = ? OR ${linked(a)})`, [req.user.id, req.user.id]]
  : [`(${a}.created_by = ? OR ${a}.id = ? OR ${linked(a)})`, [req.user.id, req.user.id, req.user.id]]);

/** Filtre SQL des galeries visibles. */
export const eventScope = (req, e = 'e') => (isOwner(req)
  ? [`(${e}.created_by = ? OR ${e}.created_by IS NULL)`, [req.user.id]]
  : [`${e}.created_by = ?`, [req.user.id]]);
