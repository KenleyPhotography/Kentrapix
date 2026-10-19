-- Appareils connectés : chaque connexion est une session que l'on peut voir et déconnecter (Profil > Appareils connectés).
CREATE TABLE IF NOT EXISTS user_sessions (
  id           VARCHAR(36)  PRIMARY KEY,
  user_id      VARCHAR(36)  NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  device       VARCHAR(120) NOT NULL DEFAULT '',
  ip           VARCHAR(64)  NULL,                -- masquée (dernier groupe retiré)
  created_at   TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at   TIMESTAMP(0) NULL
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions (user_id, last_seen_at DESC) WHERE revoked_at IS NULL;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
-- Connexions antérieures à cette fonction : coupées par « Déconnecter tous les autres appareils » tant qu'elles n'ont pas été rattachées à une session.
ALTER TABLE users ADD COLUMN IF NOT EXISTS legacy_revoked_at TIMESTAMP(0) NULL;
