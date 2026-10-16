-- Commandes d'albums : le photographe peut composer l'album lui-même (page de couverture + photos) et créer une commande pour un client.
ALTER TABLE print_orders ADD COLUMN IF NOT EXISTS cover_key VARCHAR(255) NULL;
ALTER TABLE print_orders ADD COLUMN IF NOT EXISTS cover_photo_id VARCHAR(36) NULL REFERENCES photos (id) ON DELETE SET NULL;
ALTER TABLE print_orders ADD COLUMN IF NOT EXISTS source VARCHAR(10) NOT NULL DEFAULT 'client'; -- client | studio
