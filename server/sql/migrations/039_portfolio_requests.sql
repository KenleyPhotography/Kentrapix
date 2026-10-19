-- Demandes de séance venant du portfolio public (visiteur sans compte) : le studio les accepte ou les refuse.
CREATE TABLE IF NOT EXISTS portfolio_requests (
  id           VARCHAR(36)   PRIMARY KEY,
  staff_id     VARCHAR(36)   NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name         VARCHAR(80)   NOT NULL,
  email        VARCHAR(190)  NOT NULL,
  phone        VARCHAR(40)   NOT NULL DEFAULT '',
  session_type VARCHAR(80)   NOT NULL DEFAULT '',
  wished_date  VARCHAR(40)   NOT NULL DEFAULT '',
  message      VARCHAR(1000) NOT NULL DEFAULT '',
  status       VARCHAR(12)   NOT NULL DEFAULT 'pending', -- pending | accepted | declined
  reply        VARCHAR(500)  NULL,
  created_at   TIMESTAMP(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_portfolio_requests_staff ON portfolio_requests (staff_id, status, created_at);
ALTER TABLE portfolio_requests ENABLE ROW LEVEL SECURITY;
