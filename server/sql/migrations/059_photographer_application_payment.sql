ALTER TABLE photographer_applications
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(12),
  ADD COLUMN IF NOT EXISTS transfer_code VARCHAR(60),
  ADD COLUMN IF NOT EXISTS payment_amount INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_photographer_application_transfer
  ON photographer_applications (payment_method, lower(transfer_code))
  WHERE transfer_code IS NOT NULL;
