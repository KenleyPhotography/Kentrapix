-- ==========================================================================
-- KentraPix — base de données MySQL
-- Dans MySQL Workbench : File > Open SQL Script, puis l'éclair (Execute).
-- Les photos elles-mêmes vont sur Cloudflare R2 ; ici on garde seulement
-- les informations (nom, clé de stockage, album, etc.).
-- ==========================================================================

CREATE DATABASE IF NOT EXISTS kentrapix
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE kentrapix;

-- Comptes de connexion (admin = studio, client = clients du photographe).
-- Le mot de passe est toujours stocké haché (password_hash en PHP / bcrypt), jamais en clair.
CREATE TABLE users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email         VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('admin','client') NOT NULL DEFAULT 'client',
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE clients (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNSIGNED NULL UNIQUE,
  name       VARCHAR(150) NOT NULL,
  email      VARCHAR(190) NOT NULL,
  phone      VARCHAR(40)  NULL,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE events (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id       INT UNSIGNED NOT NULL,
  name            VARCHAR(150) NOT NULL,
  type            VARCHAR(80)  NULL,
  event_date      DATE NULL,
  location        VARCHAR(150) NULL,
  cover_photo_id  INT UNSIGNED NULL,
  published       BOOLEAN NOT NULL DEFAULT FALSE,
  allow_download  BOOLEAN NOT NULL DEFAULT TRUE,
  archived        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE TABLE photos (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_id    INT UNSIGNED NOT NULL,
  album       VARCHAR(80)  NULL,
  filename    VARCHAR(190) NOT NULL,
  storage_key VARCHAR(255) NOT NULL,   -- original sur R2, ex. events/12/KP_0001.jpg
  preview_key VARCHAR(255) NULL,       -- version compressée pour la galerie
  width       INT UNSIGNED NULL,
  height      INT UNSIGNED NULL,
  size_bytes  BIGINT UNSIGNED NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  INDEX (event_id, album)
);

ALTER TABLE events
  ADD FOREIGN KEY (cover_photo_id) REFERENCES photos(id) ON DELETE SET NULL;

CREATE TABLE favorites (
  client_id  INT UNSIGNED NOT NULL,
  photo_id   INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, photo_id),
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  FOREIGN KEY (photo_id)  REFERENCES photos(id)  ON DELETE CASCADE
);

CREATE TABLE downloads (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id   INT UNSIGNED NOT NULL,
  event_id    INT UNSIGNED NULL,
  photo_count INT UNSIGNED NOT NULL,
  file_name   VARCHAR(190) NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  FOREIGN KEY (event_id)  REFERENCES events(id)  ON DELETE SET NULL
);

-- Réglages globaux (une seule ligne), comme data.permissions dans service.js.
CREATE TABLE permissions (
  id                 TINYINT UNSIGNED PRIMARY KEY DEFAULT 1,
  individual         BOOLEAN NOT NULL DEFAULT TRUE,
  selection          BOOLEAN NOT NULL DEFAULT TRUE,
  event_download     BOOLEAN NOT NULL DEFAULT TRUE,
  favorites          BOOLEAN NOT NULL DEFAULT TRUE,
  sharing            BOOLEAN NOT NULL DEFAULT FALSE,
  CHECK (id = 1)
);
INSERT INTO permissions (id) VALUES (1);

-- Données de démonstration (même cliente que la démo actuelle). Supprimez si inutile.
INSERT INTO clients (name, email) VALUES ('Marie Jean', 'marie@example.com');
INSERT INTO events (client_id, name, type, event_date, location, published) VALUES
  (1, 'Remise de diplômes 2026', 'Remise de diplômes', '2026-10-18', 'Port-au-Prince', TRUE),
  (1, 'Anniversaire',            'Anniversaire',       '2026-09-24', NULL,             TRUE),
  (1, 'Séance famille',          'Séance famille',     '2026-08-16', NULL,             TRUE);
