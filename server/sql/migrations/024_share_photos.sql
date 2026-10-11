-- Lien de partage famille limité à certaines photos (numéros « 1-10, 15 »). NULL = toutes les photos ouvertes au client.
ALTER TABLE share_links ADD COLUMN IF NOT EXISTS photo_numbers VARCHAR(2000) NULL;
