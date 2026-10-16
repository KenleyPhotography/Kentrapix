-- Instructions de paiement montrées au client sur ses factures (aucune intégration de paiement : le client envoie l'argent lui-même).
ALTER TABLE users ADD COLUMN IF NOT EXISTS moncash_number VARCHAR(40) NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS natcash_number VARCHAR(40) NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pay_note VARCHAR(300) NULL;
