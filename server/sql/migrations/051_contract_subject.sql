-- Objet du contrat : la ligne en tête de la fiche, au-dessus du titre
-- (« CONTRAT DE PRESTATION PHOTOGRAPHIQUE », « CONTRAT DE CRÉATION DE SITE INTERNET »…).
-- Écrite par le photographe pour chaque contrat ; vide = le texte par défaut du type (photo / site internet).
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS subject VARCHAR(120) NULL;
