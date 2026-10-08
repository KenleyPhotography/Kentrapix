-- ==========================================================================
-- 006 — Plusieurs photographes (abonnés) dans un même KentraPix
-- Chaque admin (photographe) ne voit que ses clients, ses galeries, ses
-- e-mails et ses commentaires. Le propriétaire voit tout.
-- Chaque compte peut choisir le nom d'expéditeur de ses e-mails.
-- ==========================================================================

ALTER TABLE users
  ADD COLUMN created_by  CHAR(36)     NULL COMMENT 'Photographe qui a créé ce client (NULL = inscription libre)' AFTER role,
  ADD COLUMN sender_name VARCHAR(120) NULL COMMENT 'Nom affiché comme expéditeur des e-mails' AFTER phone,
  ADD KEY idx_users_created_by (created_by);

ALTER TABLE events
  ADD COLUMN created_by CHAR(36) NULL COMMENT 'Photographe propriétaire de la galerie' AFTER client_id,
  ADD KEY idx_events_created_by (created_by);

-- Données existantes : rattachées au propriétaire.
UPDATE users u JOIN (SELECT id FROM users WHERE role = 'owner' ORDER BY created_at LIMIT 1) o
  SET u.created_by = o.id WHERE u.role = 'client' AND u.created_by IS NULL;

UPDATE events e JOIN (SELECT id FROM users WHERE role = 'owner' ORDER BY created_at LIMIT 1) o
  SET e.created_by = o.id WHERE e.created_by IS NULL;
