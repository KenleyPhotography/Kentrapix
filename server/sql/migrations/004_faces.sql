-- ==========================================================================
-- 004 — Reconnaissance des visages
-- Chaque photo importée est analysée en arrière-plan : les visages trouvés
-- sont regroupés par personne (par galerie). Le studio nomme les personnes,
-- le client peut filtrer la galerie « photos de Marie ».
-- Données biométriques : supprimées avec la photo / la galerie (CASCADE).
-- ==========================================================================

ALTER TABLE photos
  ADD COLUMN faces_status ENUM('pending','done','failed') NOT NULL DEFAULT 'pending'
    COMMENT 'Analyse des visages : en attente, terminée, échouée' AFTER position,
  ADD KEY idx_photos_faces (faces_status, created_at);

-- Une « personne » = un groupe de visages semblables dans une galerie.
CREATE TABLE IF NOT EXISTS people (
  id          CHAR(36)     NOT NULL,
  event_id    CHAR(36)     NOT NULL COMMENT 'Galerie',
  name        VARCHAR(120) NULL     COMMENT 'Nom donné par le studio (NULL = pas encore nommée)',
  hidden      TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '1 = jamais proposée au client',
  embedding   BLOB         NOT NULL COMMENT 'Empreinte moyenne du visage (1024 float32)',
  face_count  INT UNSIGNED NOT NULL DEFAULT 0,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_people_event (event_id),
  CONSTRAINT fk_people_event FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Personnes reconnues dans les galeries';

CREATE TABLE IF NOT EXISTS photo_faces (
  id         CHAR(36)  NOT NULL,
  photo_id   CHAR(36)  NOT NULL,
  person_id  CHAR(36)  NULL     COMMENT 'Personne à laquelle ce visage est rattaché',
  box_x      FLOAT     NOT NULL COMMENT 'Cadre du visage, en proportion de l''image (0 à 1)',
  box_y      FLOAT     NOT NULL,
  box_w      FLOAT     NOT NULL,
  box_h      FLOAT     NOT NULL,
  score      FLOAT     NOT NULL COMMENT 'Confiance de la détection (0 à 1)',
  embedding  BLOB      NOT NULL COMMENT 'Empreinte du visage (1024 float32)',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_faces_photo (photo_id),
  KEY idx_faces_person (person_id),
  CONSTRAINT fk_faces_photo  FOREIGN KEY (photo_id)  REFERENCES photos (id) ON DELETE CASCADE,
  CONSTRAINT fk_faces_person FOREIGN KEY (person_id) REFERENCES people (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Visages détectés dans les photos';

-- Afficher le filtre « personnes » aux clients (désactivable dans Réglages).
INSERT IGNORE INTO permissions (perm_key, enabled) VALUES ('faces', 1);
