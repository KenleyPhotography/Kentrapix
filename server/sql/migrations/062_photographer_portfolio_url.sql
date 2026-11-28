ALTER TABLE photographer_profiles
  ADD COLUMN IF NOT EXISTS portfolio_url VARCHAR(250) NOT NULL DEFAULT '';
