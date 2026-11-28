ALTER TABLE site_public_services
  ADD COLUMN IF NOT EXISTS booking_payment JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE portfolio_requests
  ADD COLUMN IF NOT EXISTS payment_code VARCHAR(24),
  ADD COLUMN IF NOT EXISTS payment_amount INTEGER,
  ADD COLUMN IF NOT EXISTS payment_verified_at TIMESTAMP;
CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_requests_payment_code ON portfolio_requests(payment_code);

CREATE TABLE IF NOT EXISTS photographer_applications (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  email VARCHAR(190) NOT NULL,
  phone VARCHAR(40) NOT NULL,
  message VARCHAR(1000) NOT NULL DEFAULT '',
  reviewed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE photographer_applications ENABLE ROW LEVEL SECURITY;
