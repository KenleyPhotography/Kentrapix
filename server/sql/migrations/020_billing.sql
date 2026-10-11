-- Administration : factures, paiements et rappels. Chaque photographe (propriétaire compris) ne gère que ses propres factures.
CREATE TABLE IF NOT EXISTS invoices (
  id           VARCHAR(36)   PRIMARY KEY,
  staff_id     VARCHAR(36)   NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  client_id    VARCHAR(36)   NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  event_id     VARCHAR(36)   NULL REFERENCES events (id) ON DELETE SET NULL,
  number       VARCHAR(30)   NOT NULL,
  title        VARCHAR(200)  NOT NULL,
  notes        VARCHAR(1000) NULL,
  currency     VARCHAR(3)    NOT NULL DEFAULT 'USD',
  total        NUMERIC(12,2) NOT NULL CHECK (total >= 0),
  issued_at    DATE          NOT NULL DEFAULT CURRENT_DATE,
  due_date     DATE          NULL,
  cancelled    SMALLINT      NOT NULL DEFAULT 0,
  public_token VARCHAR(32)   NOT NULL,
  sent_at      TIMESTAMP(0)  NULL,
  reminded_at  TIMESTAMP(0)  NULL,
  created_at   TIMESTAMP(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_invoices_number UNIQUE (staff_id, number),
  CONSTRAINT uq_invoices_token UNIQUE (public_token)
);
CREATE INDEX IF NOT EXISTS idx_invoices_staff ON invoices (staff_id, issued_at);
CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices (client_id);

CREATE TABLE IF NOT EXISTS payments (
  id         VARCHAR(36)   PRIMARY KEY,
  invoice_id VARCHAR(36)   NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  amount     NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  method     VARCHAR(30)   NOT NULL DEFAULT 'especes',
  paid_at    DATE          NOT NULL DEFAULT CURRENT_DATE,
  note       VARCHAR(200)  NULL,
  created_at TIMESTAMP(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments (invoice_id);

CREATE TABLE IF NOT EXISTS reminders (
  id         VARCHAR(36)  PRIMARY KEY,
  staff_id   VARCHAR(36)  NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  client_id  VARCHAR(36)  NULL REFERENCES users (id) ON DELETE SET NULL,
  invoice_id VARCHAR(36)  NULL REFERENCES invoices (id) ON DELETE SET NULL,
  title      VARCHAR(200) NOT NULL,
  due_at     DATE         NOT NULL,
  done       SMALLINT     NOT NULL DEFAULT 0,
  created_at TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_reminders_staff ON reminders (staff_id, done, due_at);

ALTER TABLE invoices  ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;
