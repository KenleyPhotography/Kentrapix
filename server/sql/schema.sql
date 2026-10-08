-- ==========================================================================
-- KentraPix — schéma MySQL 8.0.16+ (compatible MariaDB 10.6+)
--
-- Exécuté par : npm run db:init   (peut être relancé sans risque :
-- CREATE ... IF NOT EXISTS / CREATE OR REPLACE VIEW)
-- Base v1. Les évolutions (rôle owner, e-mails…) sont dans sql/migrations/,
-- appliquées automatiquement juste après ce fichier.
--
-- Conventions
--   * Identifiants : UUID v4 en CHAR(36) — impossibles à deviner dans une URL.
--   * Texte : utf8mb4 (accents, créole, emojis).
--   * Dates : TIMESTAMP en UTC (la connexion force time_zone = '+00:00').
--   * Booléens : TINYINT(1) 0/1.
--   * Les fichiers photo ne sont PAS dans la base : seule leur clé
--     (ex. 'originals/<uuid>.jpg') est stockée ; le fichier est dans server/storage/.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. users — comptes du studio (admin) et des clients
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                   CHAR(36)      NOT NULL COMMENT 'UUID du compte',
  role                 ENUM('admin','client') NOT NULL DEFAULT 'client' COMMENT 'admin = studio, client = accès à ses galeries',
  name                 VARCHAR(120)  NOT NULL COMMENT 'Nom affiché',
  email                VARCHAR(190)  NOT NULL COMMENT 'Identifiant de connexion, toujours en minuscules',
  phone                VARCHAR(40)   NULL     COMMENT 'Téléphone (facultatif)',
  password_hash        VARCHAR(100)  NOT NULL COMMENT 'Hash bcrypt (coût 12) — jamais le mot de passe en clair',
  active               TINYINT(1)    NOT NULL DEFAULT 1 COMMENT '0 = compte désactivé, connexion refusée',
  must_change_password TINYINT(1)    NOT NULL DEFAULT 0 COMMENT '1 = mot de passe temporaire à changer à la prochaine connexion',
  token_version        INT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '+1 à chaque changement de mot de passe/désactivation : ferme toutes les sessions',
  last_login_at        TIMESTAMP     NULL     COMMENT 'Dernière connexion réussie (UTC)',
  created_at           TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_role_name (role, name),
  CONSTRAINT chk_users_email_lower CHECK (email = LOWER(email)),
  CONSTRAINT chk_users_email_format CHECK (email LIKE '_%@_%._%')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Comptes admin et clients';

-- --------------------------------------------------------------------------
-- 2. events — une galerie livrée à un client (mariage, séance…)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id             CHAR(36)      NOT NULL COMMENT 'UUID de l''événement',
  client_id      CHAR(36)      NOT NULL COMMENT 'Client propriétaire (users.id, rôle client)',
  name           VARCHAR(160)  NOT NULL COMMENT 'Titre affiché au client',
  type           VARCHAR(80)   NOT NULL COMMENT 'Mariage, Anniversaire, Séance famille…',
  event_date     DATE          NOT NULL COMMENT 'Date de l''événement',
  location       VARCHAR(160)  NULL     COMMENT 'Lieu (facultatif)',
  description    TEXT          NULL     COMMENT 'Texte libre affiché dans « Détails »',
  cover_key      VARCHAR(255)  NULL     COMMENT 'Image de couverture : covers/… (dédiée) ou previews/… (une photo). NULL = 1re photo',
  published      TINYINT(1)    NOT NULL DEFAULT 0 COMMENT '1 = visible par le client',
  allow_download TINYINT(1)    NOT NULL DEFAULT 1 COMMENT '1 = le client peut télécharger les originaux',
  archived       TINYINT(1)    NOT NULL DEFAULT 0 COMMENT '1 = masqué au client même s''il est publié',
  created_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_events_client (client_id, published, archived, event_date),
  KEY idx_events_date (event_date, created_at),
  -- RESTRICT : impossible de supprimer un client qui a encore des événements.
  CONSTRAINT fk_events_client FOREIGN KEY (client_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Galeries (événements) livrées aux clients';

-- --------------------------------------------------------------------------
-- 3. photos — chaque photo d'un événement (fichiers privés dans storage/)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS photos (
  id            CHAR(36)        NOT NULL COMMENT 'UUID de la photo',
  event_id      CHAR(36)        NOT NULL COMMENT 'Événement parent',
  album         VARCHAR(80)     NOT NULL DEFAULT 'Général' COMMENT 'Chapitre dans la galerie (Cérémonie, Portraits…)',
  filename      VARCHAR(255)    NOT NULL COMMENT 'Nom d''origine du fichier, utilisé au téléchargement',
  original_key  VARCHAR(255)    NOT NULL COMMENT 'Fichier original intact : originals/<uuid>.<ext>',
  preview_key   VARCHAR(255)    NOT NULL COMMENT 'Aperçu WEBP ≤ 1600 px : previews/<uuid>.webp',
  mime          VARCHAR(60)     NOT NULL COMMENT 'Type réel détecté (image/jpeg…)',
  size_bytes    BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Poids de l''original (octets)',
  preview_bytes INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT 'Poids de l''aperçu (octets)',
  width         INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT 'Largeur de l''aperçu (px)',
  height        INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT 'Hauteur de l''aperçu (px)',
  position      INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT 'Ordre d''affichage dans l''événement',
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Date d''import',
  PRIMARY KEY (id),
  UNIQUE KEY uq_photos_original (original_key),
  KEY idx_photos_event (event_id, position),
  KEY idx_photos_event_album (event_id, album),
  CONSTRAINT chk_photos_mime CHECK (mime LIKE 'image/%'),
  -- CASCADE : supprimer un événement supprime ses photos (le serveur efface aussi les fichiers).
  CONSTRAINT fk_photos_event FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Photos des événements (métadonnées ; fichiers dans storage/)';

-- --------------------------------------------------------------------------
-- 4. favorites — coups de cœur d'un client
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS favorites (
  user_id    CHAR(36)  NOT NULL COMMENT 'Client',
  photo_id   CHAR(36)  NOT NULL COMMENT 'Photo aimée',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, photo_id),
  KEY idx_favorites_photo (photo_id),
  CONSTRAINT fk_favorites_user  FOREIGN KEY (user_id)  REFERENCES users (id)  ON DELETE CASCADE,
  CONSTRAINT fk_favorites_photo FOREIGN KEY (photo_id) REFERENCES photos (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Photos favorites des clients';

-- --------------------------------------------------------------------------
-- 5. downloads — historique + lien de téléchargement temporaire (10 min)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS downloads (
  id          CHAR(36)     NOT NULL COMMENT 'UUID, sert aussi d''identifiant du lien /api/client/downloads/<id>/file',
  user_id     CHAR(36)     NOT NULL COMMENT 'Client qui télécharge',
  event_id    CHAR(36)     NULL     COMMENT 'Événement concerné (NULL si sélection sur plusieurs événements)',
  name        VARCHAR(255) NOT NULL COMMENT 'Nom du fichier livré (photo ou .zip)',
  photo_count INT UNSIGNED NOT NULL COMMENT 'Nombre de photos',
  photo_ids   JSON         NOT NULL COMMENT 'Liste des UUID de photos incluses',
  expires_at  TIMESTAMP    NOT NULL COMMENT 'Fin de validité du lien (UTC)',
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_downloads_user (user_id, created_at),
  KEY idx_downloads_event (event_id),
  CONSTRAINT chk_downloads_count CHECK (photo_count > 0),
  CONSTRAINT fk_downloads_user  FOREIGN KEY (user_id)  REFERENCES users (id)  ON DELETE CASCADE,
  CONSTRAINT fk_downloads_event FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Téléchargements des clients';

-- --------------------------------------------------------------------------
-- 6. permissions — autorisations globales des clients (page Réglages)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS permissions (
  perm_key   VARCHAR(40) NOT NULL COMMENT 'individual | selection | event | favorites | sharing',
  enabled    TINYINT(1)  NOT NULL COMMENT '1 = autorisé',
  updated_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (perm_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Autorisations globales des clients';

INSERT IGNORE INTO permissions (perm_key, enabled) VALUES
  ('individual', 1),  -- télécharger une photo
  ('selection',  1),  -- télécharger une sélection (ZIP)
  ('event',      1),  -- télécharger tout l'événement (ZIP)
  ('favorites',  1),  -- utiliser les favoris
  ('sharing',    0);  -- partage (réservé pour plus tard)

-- --------------------------------------------------------------------------
-- 7. audit_log — journal : qui a fait quoi, quand, depuis quelle IP
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    CHAR(36)     NULL     COMMENT 'Auteur (NULL = visiteur non connecté, ex. connexion échouée)',
  action     VARCHAR(60)  NOT NULL COMMENT 'Ex. auth.login, auth.login_failed, client.create, event.delete',
  entity     VARCHAR(30)  NULL     COMMENT 'Type d''objet visé : user, event, photo, download, permissions',
  entity_id  CHAR(36)     NULL     COMMENT 'Identifiant de l''objet visé',
  details    JSON         NULL     COMMENT 'Informations utiles (jamais de mot de passe)',
  ip         VARCHAR(45)  NULL     COMMENT 'Adresse IP (IPv4 ou IPv6)',
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_created (created_at),
  KEY idx_audit_user (user_id, created_at),
  KEY idx_audit_action (action, created_at),
  KEY idx_audit_entity (entity, entity_id),
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Journal d''activité (sécurité et suivi)';

-- --------------------------------------------------------------------------
-- 8. schema_migrations — mises à jour de structure déjà appliquées
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    VARCHAR(120) NOT NULL COMMENT 'Nom du fichier dans sql/migrations/',
  applied_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Migrations appliquées par npm run db:init';

-- ==========================================================================
-- Vues (lecture seule) — tableaux de bord prêts à consulter dans MySQL
-- ==========================================================================

-- Une ligne par événement : photos, espace disque, favoris, téléchargements.
CREATE OR REPLACE VIEW v_event_stats AS
SELECT
  e.id          AS event_id,
  e.name        AS event_name,
  e.event_date,
  u.name        AS client_name,
  e.published,
  e.archived,
  (SELECT COUNT(*) FROM photos p WHERE p.event_id = e.id)                                  AS photo_count,
  (SELECT COALESCE(SUM(p.size_bytes + p.preview_bytes), 0) FROM photos p WHERE p.event_id = e.id) AS storage_bytes,
  (SELECT COUNT(*) FROM favorites f JOIN photos p ON p.id = f.photo_id WHERE p.event_id = e.id)    AS favorite_count,
  (SELECT COALESCE(SUM(d.photo_count), 0) FROM downloads d WHERE d.event_id = e.id)        AS downloaded_photos
FROM events e
JOIN users u ON u.id = e.client_id;

-- Une ligne par compte : galeries, photos, activité (tout compte peut recevoir des galeries).
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

-- Une seule ligne : espace disque total utilisé par les photos.
CREATE OR REPLACE VIEW v_storage_usage AS
SELECT
  COUNT(*)                                             AS photo_count,
  COALESCE(SUM(size_bytes), 0)                         AS originals_bytes,
  COALESCE(SUM(preview_bytes), 0)                      AS previews_bytes,
  ROUND(COALESCE(SUM(size_bytes + preview_bytes), 0) / 1024 / 1024 / 1024, 2) AS total_gb
FROM photos;
