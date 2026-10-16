-- Contrats avec signature électronique : le photographe rédige, le client lit et signe depuis un lien secret.
-- Une fois signé, le texte ne change plus (empreinte SHA-256 gardée avec la date, l'adresse IP et l'appareil du signataire).
CREATE TABLE IF NOT EXISTS contracts (
  id           VARCHAR(36)  PRIMARY KEY,
  staff_id     VARCHAR(36)  NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  client_id    VARCHAR(36)  NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  booking_id   VARCHAR(36)  NULL REFERENCES bookings (id) ON DELETE SET NULL,
  title        VARCHAR(200) NOT NULL,
  body         TEXT         NOT NULL,
  public_token VARCHAR(40)  NOT NULL UNIQUE,
  status       VARCHAR(10)  NOT NULL DEFAULT 'pending', -- pending | signed | cancelled
  sent_at      TIMESTAMP(0) NULL,
  signed_name  VARCHAR(120) NULL,
  signature    TEXT         NULL,                       -- image PNG du tracé (data URL)
  signed_at    TIMESTAMP(0) NULL,
  signed_ip    VARCHAR(64)  NULL,
  signed_agent VARCHAR(300) NULL,
  body_hash    VARCHAR(64)  NULL,
  created_at   TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_contracts_staff ON contracts (staff_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contracts_client ON contracts (client_id);
CREATE INDEX IF NOT EXISTS idx_contracts_booking ON contracts (booking_id);
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
