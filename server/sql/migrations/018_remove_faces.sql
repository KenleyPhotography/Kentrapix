-- Reconnaissance des visages retirée : on supprime ses tables, colonnes et réglages (libère de l'espace en base).
DROP TABLE IF EXISTS photo_faces;
DROP TABLE IF EXISTS people;
DROP INDEX IF EXISTS idx_photos_faces;
ALTER TABLE photos DROP COLUMN IF EXISTS faces_status;
DELETE FROM permissions WHERE perm_key = 'faces';
