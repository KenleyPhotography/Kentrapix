-- Site en maintenance : le propriétaire principal peut fermer le site aux visiteurs et aux clients
-- (l'équipe garde l'accès au studio pour travailler et rouvrir). Une seule ligne, id = 1.
-- ends_at : fin prévue, calculée à partir de la durée saisie. Passé cette heure, le site se rouvre tout seul.
CREATE TABLE IF NOT EXISTS site_maintenance (
  id         SMALLINT     PRIMARY KEY,
  enabled    SMALLINT     NOT NULL DEFAULT 0,
  title      VARCHAR(120) NOT NULL DEFAULT '',
  message    VARCHAR(600) NOT NULL DEFAULT '',
  started_at TIMESTAMP(0) NULL,
  ends_at    TIMESTAMP(0) NULL,
  updated_by VARCHAR(36)  NULL REFERENCES users (id) ON DELETE SET NULL,
  updated_at TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT site_maintenance_one_row CHECK (id = 1)
);
INSERT INTO site_maintenance (id, enabled) VALUES (1, 0) ON CONFLICT DO NOTHING;
ALTER TABLE site_maintenance ENABLE ROW LEVEL SECURITY;
