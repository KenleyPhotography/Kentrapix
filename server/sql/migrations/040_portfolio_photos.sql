-- Photos ajoutées au portfolio public depuis le studio. Le fichier n'est ni sur R2 ni sur Supabase :
-- il est gardé dans le dépôt GitHub (branche portfolio-media) ; ici seulement son nom et sa catégorie.
CREATE TABLE IF NOT EXISTS portfolio_photos (
  id         VARCHAR(36)  PRIMARY KEY,
  staff_id   VARCHAR(36)  NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  category   VARCHAR(40)  NOT NULL,
  file       VARCHAR(80)  NOT NULL UNIQUE,
  sha        VARCHAR(64)  NOT NULL DEFAULT '',
  created_at TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_portfolio_photos_staff ON portfolio_photos (staff_id, category, created_at);
ALTER TABLE portfolio_photos ENABLE ROW LEVEL SECURITY;
