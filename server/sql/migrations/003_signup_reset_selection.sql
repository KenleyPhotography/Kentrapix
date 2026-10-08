-- ==========================================================================
-- 003 — Inscription libre, mot de passe oublié, mode sélection (épreuves)
-- ==========================================================================

-- Liens « mot de passe oublié » : seul le hash du jeton est stocké.
CREATE TABLE IF NOT EXISTS password_resets (
  id         CHAR(36)  NOT NULL,
  user_id    CHAR(36)  NOT NULL COMMENT 'Compte concerné',
  token_hash CHAR(64)  NOT NULL COMMENT 'SHA-256 du jeton envoyé par e-mail (le jeton lui-même n''est jamais stocké)',
  expires_at TIMESTAMP NOT NULL COMMENT 'Validité : 1 heure',
  used_at    TIMESTAMP NULL     COMMENT 'Date d''utilisation (un lien ne sert qu''une fois)',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_resets_token (token_hash),
  KEY idx_resets_user (user_id, created_at),
  CONSTRAINT fk_resets_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Demandes de réinitialisation de mot de passe';

-- Mode sélection : le client voit les photos (filigranées, numérotées) et choisit
-- les numéros qu'il veut. Aucun téléchargement possible sur ces galeries.
ALTER TABLE events
  ADD COLUMN selection_mode  TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '1 = galerie d''épreuves : sélection de numéros, aucun téléchargement' AFTER allow_download,
  ADD COLUMN selection_limit INT UNSIGNED NULL     COMMENT 'Nombre maximum de photos à choisir (NULL = illimité)' AFTER selection_mode;

-- Photos choisies par le client (brouillon modifiable jusqu'à l'envoi).
CREATE TABLE IF NOT EXISTS photo_selections (
  user_id    CHAR(36)  NOT NULL,
  photo_id   CHAR(36)  NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, photo_id),
  KEY idx_selections_photo (photo_id),
  CONSTRAINT fk_selections_user  FOREIGN KEY (user_id)  REFERENCES users (id)  ON DELETE CASCADE,
  CONSTRAINT fk_selections_photo FOREIGN KEY (photo_id) REFERENCES photos (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Photos choisies en mode sélection';

-- Envoi de la sélection au studio (une ligne par client et par galerie).
CREATE TABLE IF NOT EXISTS event_selections (
  event_id     CHAR(36)      NOT NULL,
  user_id      CHAR(36)      NOT NULL,
  note         VARCHAR(2000) NULL      COMMENT 'Message du client avec sa sélection',
  photo_count  INT UNSIGNED  NOT NULL DEFAULT 0,
  submitted_at TIMESTAMP     NULL      COMMENT 'Dernier envoi au studio',
  updated_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id, user_id),
  CONSTRAINT fk_evsel_event FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE,
  CONSTRAINT fk_evsel_user  FOREIGN KEY (user_id)  REFERENCES users (id)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Sélections envoyées au studio';

-- Inscription libre depuis la page de connexion (désactivable dans Réglages).
INSERT IGNORE INTO permissions (perm_key, enabled) VALUES ('signup', 1);
