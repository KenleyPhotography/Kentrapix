-- Mode de règlement d'une facture : 'cash' (payée tout de suite) ou 'credit' (avance reçue, solde à payer plus tard).
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_type VARCHAR(10) NOT NULL DEFAULT 'credit';
