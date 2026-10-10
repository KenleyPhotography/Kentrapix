-- Coordonnées du photographe, montrées à ses clients (page d'accueil et profil).
ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp  VARCHAR(40)  NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS website   VARCHAR(200) NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS instagram VARCHAR(80)  NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS address   VARCHAR(200) NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio       VARCHAR(500) NULL;
