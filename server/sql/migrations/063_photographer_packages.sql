ALTER TABLE photographer_profiles
  ADD COLUMN IF NOT EXISTS packages JSONB NOT NULL DEFAULT '[]'::jsonb;
