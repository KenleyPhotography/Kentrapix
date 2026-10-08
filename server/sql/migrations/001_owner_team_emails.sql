-- ==========================================================================
-- 001 — Équipe (propriétaire + admins) et e-mails automatiques (Resend)
-- ==========================================================================

-- Trois rôles :
--   owner  = propriétaire du studio : tout, y compris nommer/retirer des admins
--   admin  = membre de l'équipe : clients, événements, photos
--   client = voit ses galeries
-- Tout compte (même admin/owner) peut recevoir des galeries.
ALTER TABLE users
  MODIFY role ENUM('owner','admin','client') NOT NULL DEFAULT 'client'
  COMMENT 'owner = propriétaire (gère l''équipe), admin = équipe du studio, client = accès à ses galeries';

-- Les admins existants (créés par npm run create-admin) deviennent propriétaires.
UPDATE users SET role = 'owner' WHERE role = 'admin';

-- Date du dernier e-mail « Vos photos sont prêtes » pour l'événement.
ALTER TABLE events
  ADD COLUMN notified_at TIMESTAMP NULL COMMENT 'Dernier e-mail « photos prêtes » envoyé au client (UTC)' AFTER archived;

-- Journal de tous les e-mails (envoyés, échoués ou non envoyés faute de configuration).
CREATE TABLE IF NOT EXISTS email_log (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     CHAR(36)     NULL     COMMENT 'Compte destinataire',
  event_id    CHAR(36)     NULL     COMMENT 'Événement concerné (e-mail « photos prêtes »)',
  kind        VARCHAR(40)  NOT NULL COMMENT 'welcome | gallery_ready | password_reset | admin_invite | message',
  to_email    VARCHAR(190) NOT NULL COMMENT 'Adresse destinataire au moment de l''envoi',
  subject     VARCHAR(200) NOT NULL,
  status      ENUM('sent','failed','skipped') NOT NULL COMMENT 'skipped = Resend non configuré',
  provider_id VARCHAR(100) NULL     COMMENT 'Identifiant de l''e-mail chez Resend',
  error       VARCHAR(500) NULL     COMMENT 'Message d''erreur si échec',
  sent_by     CHAR(36)     NULL     COMMENT 'Membre de l''équipe à l''origine de l''envoi',
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_email_created (created_at),
  KEY idx_email_user (user_id, created_at),
  CONSTRAINT fk_email_user    FOREIGN KEY (user_id)  REFERENCES users (id)  ON DELETE SET NULL,
  CONSTRAINT fk_email_event   FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE SET NULL,
  CONSTRAINT fk_email_sent_by FOREIGN KEY (sent_by)  REFERENCES users (id)  ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='E-mails envoyés par KentraPix (via Resend)';

-- La vue des clients tient compte des nouveaux rôles (tout compte peut avoir des galeries).
CREATE OR REPLACE VIEW v_client_overview AS
SELECT
  u.id          AS client_id,
  u.name,
  u.email,
  u.role,
  u.active,
  u.must_change_password,
  u.last_login_at,
  (SELECT COUNT(*) FROM events e WHERE e.client_id = u.id)                                         AS event_count,
  (SELECT COUNT(*) FROM events e WHERE e.client_id = u.id AND e.published = 1 AND e.archived = 0)  AS visible_event_count,
  (SELECT COUNT(*) FROM photos p JOIN events e ON e.id = p.event_id WHERE e.client_id = u.id)      AS photo_count,
  (SELECT COUNT(*) FROM favorites f WHERE f.user_id = u.id)                                        AS favorite_count,
  (SELECT COALESCE(SUM(d.photo_count), 0) FROM downloads d WHERE d.user_id = u.id)                 AS downloaded_photos
FROM users u;
