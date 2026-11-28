ALTER TABLE users
  ADD COLUMN IF NOT EXISTS portfolio_photo_limit INTEGER NOT NULL DEFAULT 10
  CHECK (portfolio_photo_limit >= 10);
