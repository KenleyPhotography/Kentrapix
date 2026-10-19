-- Contrat pour une personne sans compte (nom et contact saisis par le studio) + réserves du client (points non acceptés, cases cochées).
ALTER TABLE contracts ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS guest_name  VARCHAR(80)  NULL;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS guest_phone VARCHAR(40)  NULL;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS guest_email VARCHAR(190) NULL;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS client_choices TEXT NULL; -- JSON : { refused: [n° de lignes], checks: [true|false], notes }
