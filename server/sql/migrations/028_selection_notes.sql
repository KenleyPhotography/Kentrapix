-- Demande de retouche (ou commentaire) du client sur chaque photo choisie.
ALTER TABLE photo_selections ADD COLUMN IF NOT EXISTS note VARCHAR(300) NULL;
