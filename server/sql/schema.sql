-- ==========================================================================
-- KentraPix — schéma PostgreSQL (Supabase)
--
-- Exécuté par : npm run db:init  (avec DATABASE_URL dans .env). Relançable sans risque.
-- Contient tout l'historique (anciennes migrations MySQL 001 à 009 comprises).
-- Les évolutions futures vont dans sql/migrations/.
--
-- Conventions
--   * Identifiants : UUID v4 en texte VARCHAR(36).
--   * Dates : TIMESTAMP(0) en UTC (la connexion force TIME ZONE 'UTC').
--   * Booléens : SMALLINT 0/1.
--   * Sécurité Supabase : RLS activé sans aucune règle + droits retirés à anon/authenticated :
--     l'API publique de Supabase ne voit RIEN ; seul le serveur KentraPix (rôle postgres) lit la base.
-- ==========================================================================

SET TIME ZONE 'UTC';

-- updated_at mis à jour automatiquement (équivalent de ON UPDATE CURRENT_TIMESTAMP).
CREATE OR REPLACE FUNCTION kp_touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END $$;

-- 1. users — comptes (owner = propriétaire, admin = photographe, client)
CREATE TABLE IF NOT EXISTS users (
  id                   VARCHAR(36)  PRIMARY KEY,
  role                 VARCHAR(10)  NOT NULL DEFAULT 'client' CHECK (role IN ('owner', 'admin', 'client')),
  created_by           VARCHAR(36)  NULL,
  name                 VARCHAR(120) NOT NULL,
  email                VARCHAR(190) NOT NULL,
  phone                VARCHAR(40)  NULL,
  sender_name          VARCHAR(120) NULL,
  avatar_key           VARCHAR(255) NULL,
  password_hash        VARCHAR(100) NOT NULL,
  active               SMALLINT     NOT NULL DEFAULT 1,
  must_change_password SMALLINT     NOT NULL DEFAULT 0,
  token_version        INTEGER      NOT NULL DEFAULT 0,
  last_login_at        TIMESTAMP(0) NULL,
  created_at           TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_users_email UNIQUE (email),
  CONSTRAINT chk_users_email_lower CHECK (email = LOWER(email)),
  CONSTRAINT chk_users_email_format CHECK (email LIKE '_%@_%._%')
);
CREATE INDEX IF NOT EXISTS idx_users_role_name ON users (role, name);
CREATE INDEX IF NOT EXISTS idx_users_created_by ON users (created_by);

-- 2. events — galeries
CREATE TABLE IF NOT EXISTS events (
  id                 VARCHAR(36)  PRIMARY KEY,
  client_id          VARCHAR(36)  NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_by         VARCHAR(36)  NULL,
  name               VARCHAR(160) NOT NULL,
  type               VARCHAR(80)  NOT NULL,
  event_date         DATE         NOT NULL,
  location           VARCHAR(160) NULL,
  description        TEXT         NULL,
  cover_key          VARCHAR(255) NULL,
  music_key          VARCHAR(255) NULL,
  published          SMALLINT     NOT NULL DEFAULT 0,
  allow_download     SMALLINT     NOT NULL DEFAULT 1,
  selection_mode     SMALLINT     NOT NULL DEFAULT 0,
  selection_limit    INTEGER      NULL,
  archived           SMALLINT     NOT NULL DEFAULT 0,
  expires_at         DATE         NULL,
  expiry_notified_at TIMESTAMP(0) NULL,
  notified_at        TIMESTAMP(0) NULL,
  created_at         TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_events_client ON events (client_id, published, archived, event_date);
CREATE INDEX IF NOT EXISTS idx_events_date ON events (event_date, created_at);
CREATE INDEX IF NOT EXISTS idx_events_created_by ON events (created_by);
CREATE INDEX IF NOT EXISTS idx_events_expires ON events (expires_at);

-- 3. photos
CREATE TABLE IF NOT EXISTS photos (
  id            VARCHAR(36)  PRIMARY KEY,
  event_id      VARCHAR(36)  NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  album         VARCHAR(80)  NOT NULL DEFAULT 'Général',
  filename      VARCHAR(255) NOT NULL,
  original_key  VARCHAR(255) NOT NULL,
  preview_key   VARCHAR(255) NOT NULL,
  mime          VARCHAR(60)  NOT NULL CHECK (mime LIKE 'image/%'),
  size_bytes    BIGINT       NOT NULL DEFAULT 0,
  preview_bytes INTEGER      NOT NULL DEFAULT 0,
  width         INTEGER      NOT NULL DEFAULT 0,
  height        INTEGER      NOT NULL DEFAULT 0,
  position      INTEGER      NOT NULL DEFAULT 0,
  faces_status  VARCHAR(10)  NOT NULL DEFAULT 'pending' CHECK (faces_status IN ('pending', 'processing', 'done', 'failed')),
  created_at    TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_photos_original UNIQUE (original_key)
);
CREATE INDEX IF NOT EXISTS idx_photos_event ON photos (event_id, position);
CREATE INDEX IF NOT EXISTS idx_photos_event_album ON photos (event_id, album);
CREATE INDEX IF NOT EXISTS idx_photos_faces ON photos (faces_status, created_at);

-- 4. favorites
CREATE TABLE IF NOT EXISTS favorites (
  user_id    VARCHAR(36)  NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  photo_id   VARCHAR(36)  NOT NULL REFERENCES photos (id) ON DELETE CASCADE,
  created_at TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, photo_id)
);
CREATE INDEX IF NOT EXISTS idx_favorites_photo ON favorites (photo_id);

-- 5. downloads — historique + lien temporaire
CREATE TABLE IF NOT EXISTS downloads (
  id          VARCHAR(36)  PRIMARY KEY,
  user_id     VARCHAR(36)  NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  event_id    VARCHAR(36)  NULL REFERENCES events (id) ON DELETE SET NULL,
  name        VARCHAR(255) NOT NULL,
  photo_count INTEGER      NOT NULL CHECK (photo_count > 0),
  photo_ids   JSONB        NOT NULL,
  expires_at  TIMESTAMP(0) NOT NULL,
  created_at  TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_downloads_user ON downloads (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_downloads_event ON downloads (event_id);

-- 6. permissions — réglages globaux
CREATE TABLE IF NOT EXISTS permissions (
  perm_key   VARCHAR(40)  PRIMARY KEY,
  enabled    SMALLINT     NOT NULL,
  updated_at TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO permissions (perm_key, enabled) VALUES
  ('individual', 1), ('selection', 1), ('event', 1), ('favorites', 1), ('sharing', 0),
  ('comments', 1), ('signup', 1), ('faces', 1), ('share_download', 0)
ON CONFLICT DO NOTHING;

-- 7. audit_log — journal
CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id    VARCHAR(36)  NULL REFERENCES users (id) ON DELETE SET NULL,
  action     VARCHAR(60)  NOT NULL,
  entity     VARCHAR(30)  NULL,
  entity_id  VARCHAR(36)  NULL,
  details    JSONB        NULL,
  ip         VARCHAR(45)  NULL,
  created_at TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log (action, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log (entity, entity_id);

-- 8. schema_migrations — fichiers de sql/migrations/ déjà appliqués
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    VARCHAR(120) PRIMARY KEY,
  applied_at TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 9. email_log — e-mails envoyés (Resend)
CREATE TABLE IF NOT EXISTS email_log (
  id          BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id     VARCHAR(36)  NULL REFERENCES users (id) ON DELETE SET NULL,
  event_id    VARCHAR(36)  NULL REFERENCES events (id) ON DELETE SET NULL,
  kind        VARCHAR(40)  NOT NULL,
  to_email    VARCHAR(190) NOT NULL,
  subject     VARCHAR(200) NOT NULL,
  status      VARCHAR(10)  NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  provider_id VARCHAR(100) NULL,
  error       VARCHAR(500) NULL,
  sent_by     VARCHAR(36)  NULL REFERENCES users (id) ON DELETE SET NULL,
  created_at  TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_email_created ON email_log (created_at);
CREATE INDEX IF NOT EXISTS idx_email_user ON email_log (user_id, created_at);

-- 10. photo_comments
CREATE TABLE IF NOT EXISTS photo_comments (
  id         VARCHAR(36)   PRIMARY KEY,
  photo_id   VARCHAR(36)   NOT NULL REFERENCES photos (id) ON DELETE CASCADE,
  user_id    VARCHAR(36)   NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body       VARCHAR(1000) NOT NULL CHECK (CHAR_LENGTH(TRIM(body)) > 0),
  created_at TIMESTAMP(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_comments_photo ON photo_comments (photo_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_created ON photo_comments (created_at);

-- 11. password_resets
CREATE TABLE IF NOT EXISTS password_resets (
  id         VARCHAR(36)  PRIMARY KEY,
  user_id    VARCHAR(36)  NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash CHAR(64)     NOT NULL,
  expires_at TIMESTAMP(0) NOT NULL,
  used_at    TIMESTAMP(0) NULL,
  created_at TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_resets_token UNIQUE (token_hash)
);
CREATE INDEX IF NOT EXISTS idx_resets_user ON password_resets (user_id, created_at);

-- 12. photo_selections — mode sélection (brouillon du client)
CREATE TABLE IF NOT EXISTS photo_selections (
  user_id    VARCHAR(36)  NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  photo_id   VARCHAR(36)  NOT NULL REFERENCES photos (id) ON DELETE CASCADE,
  created_at TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, photo_id)
);
CREATE INDEX IF NOT EXISTS idx_selections_photo ON photo_selections (photo_id);

-- 13. event_selections — sélection envoyée au studio
CREATE TABLE IF NOT EXISTS event_selections (
  event_id     VARCHAR(36)   NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  user_id      VARCHAR(36)   NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  note         VARCHAR(2000) NULL,
  photo_count  INTEGER       NOT NULL DEFAULT 0,
  submitted_at TIMESTAMP(0)  NULL,
  updated_at   TIMESTAMP(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id, user_id)
);

-- 14. people — personnes reconnues (visages)
CREATE TABLE IF NOT EXISTS people (
  id         VARCHAR(36)  PRIMARY KEY,
  event_id   VARCHAR(36)  NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  name       VARCHAR(120) NULL,
  hidden     SMALLINT     NOT NULL DEFAULT 0,
  embedding  BYTEA        NOT NULL,
  face_count INTEGER      NOT NULL DEFAULT 0,
  created_at TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_people_event ON people (event_id);

-- 15. photo_faces — visages détectés
CREATE TABLE IF NOT EXISTS photo_faces (
  id         VARCHAR(36)  PRIMARY KEY,
  photo_id   VARCHAR(36)  NOT NULL REFERENCES photos (id) ON DELETE CASCADE,
  person_id  VARCHAR(36)  NULL REFERENCES people (id) ON DELETE SET NULL,
  box_x      REAL         NOT NULL,
  box_y      REAL         NOT NULL,
  box_w      REAL         NOT NULL,
  box_h      REAL         NOT NULL,
  score      REAL         NOT NULL,
  embedding  BYTEA        NOT NULL,
  created_at TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_faces_photo ON photo_faces (photo_id);
CREATE INDEX IF NOT EXISTS idx_faces_person ON photo_faces (person_id);

-- 16. share_links — liens de partage famille
CREATE TABLE IF NOT EXISTS share_links (
  id             VARCHAR(36)  PRIMARY KEY,
  event_id       VARCHAR(36)  NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  user_id        VARCHAR(36)  NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token          VARCHAR(32)  NOT NULL,
  password_hash  VARCHAR(255) NOT NULL,
  label          VARCHAR(120) NULL,
  allow_download SMALLINT     NOT NULL DEFAULT 0,
  views          INTEGER      NOT NULL DEFAULT 0,
  last_used_at   TIMESTAMP(0) NULL,
  created_at     TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_share_token UNIQUE (token)
);
CREATE INDEX IF NOT EXISTS idx_share_event ON share_links (event_id);

-- Déclencheurs updated_at
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users', 'events', 'permissions', 'event_selections', 'people'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON %1$I', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$I FOR EACH ROW EXECUTE FUNCTION kp_touch_updated_at()', t);
  END LOOP;
END $$;

-- ==========================================================================
-- Vues (lecture seule) — tableaux de bord à consulter dans Supabase (Table Editor / SQL)
-- security_invoker : la vue respecte les droits de celui qui la lit (pas de fuite via l'API).
-- ==========================================================================
CREATE OR REPLACE VIEW v_event_stats WITH (security_invoker = true) AS
SELECT
  e.id AS event_id, e.name AS event_name, e.event_date, u.name AS client_name, e.published, e.archived,
  (SELECT COUNT(*) FROM photos p WHERE p.event_id = e.id) AS photo_count,
  (SELECT COALESCE(SUM(p.size_bytes + p.preview_bytes), 0) FROM photos p WHERE p.event_id = e.id) AS storage_bytes,
  (SELECT COUNT(*) FROM favorites f JOIN photos p ON p.id = f.photo_id WHERE p.event_id = e.id) AS favorite_count,
  (SELECT COALESCE(SUM(d.photo_count), 0) FROM downloads d WHERE d.event_id = e.id) AS downloaded_photos
FROM events e
JOIN users u ON u.id = e.client_id;

CREATE OR REPLACE VIEW v_client_overview WITH (security_invoker = true) AS
SELECT
  u.id AS client_id, u.name, u.email, u.role, u.active, u.must_change_password, u.last_login_at,
  (SELECT COUNT(*) FROM events e WHERE e.client_id = u.id) AS event_count,
  (SELECT COUNT(*) FROM events e WHERE e.client_id = u.id AND e.published = 1 AND e.archived = 0) AS visible_event_count,
  (SELECT COUNT(*) FROM photos p JOIN events e ON e.id = p.event_id WHERE e.client_id = u.id) AS photo_count,
  (SELECT COUNT(*) FROM favorites f WHERE f.user_id = u.id) AS favorite_count,
  (SELECT COALESCE(SUM(d.photo_count), 0) FROM downloads d WHERE d.user_id = u.id) AS downloaded_photos
FROM users u;

CREATE OR REPLACE VIEW v_storage_usage WITH (security_invoker = true) AS
SELECT
  COUNT(*) AS photo_count,
  COALESCE(SUM(size_bytes), 0) AS originals_bytes,
  COALESCE(SUM(preview_bytes), 0) AS previews_bytes,
  ROUND(COALESCE(SUM(size_bytes + preview_bytes), 0) / 1024.0 / 1024 / 1024, 2) AS total_gb
FROM photos;

-- ==========================================================================
-- Sécurité Supabase : rien n'est accessible par l'API publique (clé anon / utilisateurs Supabase).
-- ==========================================================================
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
    REVOKE EXECUTE ON FUNCTION kp_touch_updated_at() FROM anon, authenticated;
  END IF;
END $$;
