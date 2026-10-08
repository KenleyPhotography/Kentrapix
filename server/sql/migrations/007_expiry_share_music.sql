-- ==========================================================================
-- 007 — Expiration des galeries, liens de partage famille, musique du diaporama
-- ==========================================================================

ALTER TABLE events
  ADD COLUMN expires_at         DATE         NULL COMMENT 'Dernier jour de disponibilité (NULL = jamais)' AFTER archived,
  ADD COLUMN expiry_notified_at TIMESTAMP    NULL COMMENT 'E-mail « votre galerie ferme bientôt » envoyé' AFTER expires_at,
  ADD COLUMN music_key          VARCHAR(255) NULL COMMENT 'Musique du diaporama (music/…)' AFTER cover_key,
  ADD KEY idx_events_expires (expires_at);

-- Lien envoyé par le client à sa famille : lecture seule, protégé par un mot de passe.
CREATE TABLE IF NOT EXISTS share_links (
  id            CHAR(36)     NOT NULL,
  event_id      CHAR(36)     NOT NULL COMMENT 'Galerie partagée',
  user_id       CHAR(36)     NOT NULL COMMENT 'Client qui a créé le lien',
  token         CHAR(32)     NOT NULL COMMENT 'Partie secrète de l’adresse du lien',
  password_hash VARCHAR(255) NOT NULL,
  label         VARCHAR(120) NULL     COMMENT 'Pour qui (ex. « Famille »)',
  views         INT UNSIGNED NOT NULL DEFAULT 0,
  last_used_at  TIMESTAMP    NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_share_token (token),
  KEY idx_share_event (event_id),
  CONSTRAINT fk_share_event FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE,
  CONSTRAINT fk_share_user  FOREIGN KEY (user_id)  REFERENCES users (id)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Liens de partage famille (lecture seule, sans téléchargement)';
