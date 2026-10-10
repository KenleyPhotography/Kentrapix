-- Un client peut recevoir ses photos de plusieurs photographes : chaque code saisi ajoute un lien.
CREATE TABLE IF NOT EXISTS client_photographers (
  client_id  VARCHAR(36)  NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  staff_id   VARCHAR(36)  NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, staff_id)
);
CREATE INDEX IF NOT EXISTS idx_client_photographers_staff ON client_photographers (staff_id);
ALTER TABLE client_photographers ENABLE ROW LEVEL SECURITY;
-- Les clients déjà rattachés à un photographe gardent ce lien.
INSERT INTO client_photographers (client_id, staff_id)
  SELECT id, created_by FROM users WHERE role = 'client' AND created_by IS NOT NULL
  ON CONFLICT DO NOTHING;
