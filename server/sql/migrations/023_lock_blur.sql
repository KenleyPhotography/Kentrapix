-- Niveau de flou des photos verrouillées (écart-type du flou) : 2.5 léger (par défaut), 6 moyen, 12 fort.
ALTER TABLE events ADD COLUMN IF NOT EXISTS lock_blur NUMERIC(3,1) NOT NULL DEFAULT 2.5;
