-- ==========================================================================
-- 002 — Profil (photo de profil) et commentaires sous les photos
-- ==========================================================================

ALTER TABLE users
  ADD COLUMN avatar_key VARCHAR(255) NULL COMMENT 'Photo de profil : avatars/<uuid>.webp (fichier privé)' AFTER phone;

-- Commentaires : visibles par le propriétaire de la galerie et par l'équipe.
CREATE TABLE IF NOT EXISTS photo_comments (
  id         CHAR(36)      NOT NULL COMMENT 'UUID du commentaire',
  photo_id   CHAR(36)      NOT NULL COMMENT 'Photo commentée',
  user_id    CHAR(36)      NOT NULL COMMENT 'Auteur (client ou équipe)',
  body       VARCHAR(1000) NOT NULL COMMENT 'Texte du commentaire',
  created_at TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_comments_photo (photo_id, created_at),
  KEY idx_comments_created (created_at),
  CONSTRAINT chk_comments_body CHECK (CHAR_LENGTH(TRIM(body)) > 0),
  CONSTRAINT fk_comments_photo FOREIGN KEY (photo_id) REFERENCES photos (id) ON DELETE CASCADE,
  CONSTRAINT fk_comments_user  FOREIGN KEY (user_id)  REFERENCES users (id)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Commentaires sous les photos';

-- Nouvelle autorisation (page Réglages) : commenter les photos.
INSERT IGNORE INTO permissions (perm_key, enabled) VALUES ('comments', 1);
