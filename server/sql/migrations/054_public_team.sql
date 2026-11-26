ALTER TABLE site_public_services
  ADD COLUMN IF NOT EXISTS team_staff JSONB NOT NULL DEFAULT '[]'::jsonb;
