-- En-tête et métier du photographe sur ses fiches (factures et contrats).
-- Vides : la fiche garde l'en-tête « KentraPix » et le mot « Photographe ».
ALTER TABLE users ADD COLUMN IF NOT EXISTS doc_title    VARCHAR(80) NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS doc_subtitle VARCHAR(80) NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title    VARCHAR(60) NULL;
