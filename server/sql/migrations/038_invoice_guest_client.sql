-- Facture pour un client qui n'a pas de compte sur le système : nom / e-mail / téléphone saisis sur la facture elle-même.
ALTER TABLE invoices ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS guest_name  VARCHAR(120) NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS guest_email VARCHAR(190) NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS guest_phone VARCHAR(40)  NULL;
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS ck_invoices_client_or_guest;
ALTER TABLE invoices ADD CONSTRAINT ck_invoices_client_or_guest CHECK (client_id IS NOT NULL OR guest_name IS NOT NULL);
