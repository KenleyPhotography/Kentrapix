ALTER TABLE portfolio_requests ADD COLUMN IF NOT EXISTS tracking_token VARCHAR(64) UNIQUE,
  ADD COLUMN IF NOT EXISTS proposed_date VARCHAR(10),
  ADD COLUMN IF NOT EXISTS proposed_time VARCHAR(5);
ALTER TABLE photographer_applications ADD COLUMN IF NOT EXISTS tracking_token VARCHAR(64) UNIQUE;
CREATE TABLE IF NOT EXISTS photographer_subscriptions (
  id UUID PRIMARY KEY,
  email VARCHAR(190) NOT NULL,
  plan VARCHAR(12) NOT NULL CHECK (plan IN ('portfolio','studio')),
  period VARCHAR(8) NOT NULL CHECK (period IN ('month','year')),
  amount INTEGER NOT NULL,
  method VARCHAR(12) NOT NULL CHECK (method IN ('moncash','natcash')),
  transfer_code VARCHAR(60) NOT NULL,
  tracking_token VARCHAR(64) NOT NULL UNIQUE,
  staff_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  activated_at TIMESTAMP,
  expires_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS photographer_subscription_transfer
  ON photographer_subscriptions (method, lower(transfer_code));
ALTER TABLE photographer_subscriptions ENABLE ROW LEVEL SECURITY;
