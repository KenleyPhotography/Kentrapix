-- Le photographe signe lui aussi : sa signature est dessinée une fois (profil) puis apposée sur chaque contrat qu'il crée.
ALTER TABLE users ADD COLUMN IF NOT EXISTS contract_signature TEXT NULL;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS staff_signature TEXT NULL;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS staff_signed_at TIMESTAMP(0) NULL;
