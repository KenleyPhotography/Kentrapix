-- Rappels de paiement automatiques : réglage par photographe + phase du rappel (un seul envoi par phase et par facture).
ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_reminders SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE reminder_log ADD COLUMN IF NOT EXISTS phase VARCHAR(12) NULL;
ALTER TABLE reminder_log ADD COLUMN IF NOT EXISTS auto SMALLINT NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS uq_reminder_phase ON reminder_log (invoice_id, phase) WHERE phase IS NOT NULL;
