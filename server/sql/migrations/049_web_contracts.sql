-- Contrats « site internet » : fiche indépendante, sans aucun lien avec les séances photo ni les rendez-vous.
-- Même table que les contrats photo (lien secret, signature électronique, empreinte SHA-256 : tout est déjà là) ;
-- la colonne kind sépare les deux listes, et web_sheet garde la fiche du projet pour pouvoir la corriger plus tard.
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS kind VARCHAR(10) NOT NULL DEFAULT 'photo'; -- photo | web
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS web_sheet TEXT NULL; -- JSON : { company, domain, siteType, pages, price, delay… }
CREATE INDEX IF NOT EXISTS idx_contracts_kind ON contracts (staff_id, kind, created_at DESC);

-- Les modèles enregistrés restent dans leur propre liste : un modèle de site web n'apparaît pas dans les contrats photo.
ALTER TABLE contract_templates ADD COLUMN IF NOT EXISTS kind VARCHAR(10) NOT NULL DEFAULT 'photo';
