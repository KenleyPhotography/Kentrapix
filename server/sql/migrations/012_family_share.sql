-- ==========================================================================
-- 012 — Partage famille : liens gérés aussi par le studio, commentaires de la famille
-- ==========================================================================

-- Lien créé par le studio pour le client (NULL : créé par le client lui-même).
ALTER TABLE share_links ADD COLUMN IF NOT EXISTS created_by VARCHAR(36) NULL REFERENCES users (id) ON DELETE SET NULL;
-- La famille peut commenter les photos de ce lien.
ALTER TABLE share_links ADD COLUMN IF NOT EXISTS allow_comments SMALLINT NOT NULL DEFAULT 1;

-- Commentaires laissés par la famille (sans compte) : un prénom + le texte.
-- visitor_id : visiteur qui a ouvert le lien (cookie), pour qu'il puisse supprimer ses propres messages.
CREATE TABLE IF NOT EXISTS share_comments (
  id          VARCHAR(36)   PRIMARY KEY,
  share_id    VARCHAR(36)   NOT NULL REFERENCES share_links (id) ON DELETE CASCADE,
  photo_id    VARCHAR(36)   NOT NULL REFERENCES photos (id) ON DELETE CASCADE,
  visitor_id  VARCHAR(36)   NOT NULL,
  author_name VARCHAR(80)   NOT NULL,
  body        VARCHAR(1000) NOT NULL,
  created_at  TIMESTAMP(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_share_comments_photo ON share_comments (photo_id, created_at);
CREATE INDEX IF NOT EXISTS idx_share_comments_share ON share_comments (share_id, created_at);

-- Le partage famille est activé (le propriétaire peut toujours le couper dans Réglages).
UPDATE permissions SET enabled = 1 WHERE perm_key = 'sharing';

-- Comme les autres tables : rien n'est accessible par l'API publique de Supabase.
ALTER TABLE share_comments ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON share_comments FROM anon, authenticated;
  END IF;
END $$;
