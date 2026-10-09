-- ==========================================================================
-- 011 — Notifications écrites par le studio (cloche des clients + e-mail automatique)
-- ==========================================================================

CREATE TABLE IF NOT EXISTS announcements (
  id         VARCHAR(36)   PRIMARY KEY,
  created_by VARCHAR(36)   NULL REFERENCES users (id) ON DELETE SET NULL,
  title      VARCHAR(150)  NOT NULL,
  body       VARCHAR(5000) NOT NULL,
  event_id   VARCHAR(36)   NULL REFERENCES events (id) ON DELETE SET NULL, -- galerie ouverte au clic
  audience   VARCHAR(10)   NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'some')),
  send_email SMALLINT      NOT NULL DEFAULT 1,
  send_at    TIMESTAMP(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP, -- visible et envoyée à partir de cette date
  created_at TIMESTAMP(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_announcements_author ON announcements (created_by, send_at);

-- Destinataires figés à la création. email_status : NULL = à envoyer, puis sending / sent / failed / skipped.
CREATE TABLE IF NOT EXISTS announcement_recipients (
  announcement_id VARCHAR(36) NOT NULL REFERENCES announcements (id) ON DELETE CASCADE,
  user_id         VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  email_status    VARCHAR(10) NULL,
  PRIMARY KEY (announcement_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_announcement_recipients_user ON announcement_recipients (user_id);

-- Comme les autres tables : rien n'est accessible par l'API publique de Supabase.
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement_recipients ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON announcements, announcement_recipients FROM anon, authenticated;
  END IF;
END $$;
