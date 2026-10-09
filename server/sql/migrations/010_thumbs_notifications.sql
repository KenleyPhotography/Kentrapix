-- ==========================================================================
-- 010 — Miniatures de la grille et notifications des clients
-- ==========================================================================

-- Miniature WEBP 800 px (grille), créée au premier affichage : thumbs/<id-photo>.webp
ALTER TABLE photos ADD COLUMN IF NOT EXISTS thumb_key VARCHAR(255) NULL;

-- Date de publication d'une galerie (notification « nouvelle galerie »).
ALTER TABLE events ADD COLUMN IF NOT EXISTS published_at TIMESTAMP(0) NULL;
UPDATE events SET published_at = COALESCE(notified_at, updated_at, created_at)
  WHERE published = 1 AND published_at IS NULL;

-- Dernière ouverture de la cloche : ce qui est plus récent est « non lu ».
ALTER TABLE users ADD COLUMN IF NOT EXISTS notifications_seen_at TIMESTAMP(0) NULL;
