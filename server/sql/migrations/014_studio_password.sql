-- Mot de passe du studio : demandé aux membres de l'équipe avant d'ouvrir le studio (valable 12 h sur l'appareil).
ALTER TABLE users ADD COLUMN IF NOT EXISTS studio_password_hash VARCHAR(100) NULL;
