ALTER TABLE photographer_applications ADD COLUMN IF NOT EXISTS logo_key VARCHAR(160);
ALTER TABLE photographer_profiles ADD COLUMN IF NOT EXISTS logo_key VARCHAR(160);
