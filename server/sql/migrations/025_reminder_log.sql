-- Historique des rappels de paiement envoyés (e-mail, WhatsApp, appel) : qui, quand, par quel moyen.
CREATE TABLE IF NOT EXISTS reminder_log (
  id         VARCHAR(36)  PRIMARY KEY,
  staff_id   VARCHAR(36)  NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  invoice_id VARCHAR(36)  NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  channel    VARCHAR(12)  NOT NULL,
  status     VARCHAR(12)  NOT NULL DEFAULT 'sent',
  created_at TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_reminder_log_staff ON reminder_log (staff_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reminder_log_invoice ON reminder_log (invoice_id, created_at DESC);
ALTER TABLE reminder_log ENABLE ROW LEVEL SECURITY;
