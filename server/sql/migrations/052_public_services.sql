CREATE TABLE IF NOT EXISTS site_public_services (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  portfolio_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  booking_staff JSONB
);
INSERT INTO site_public_services (id) VALUES (1) ON CONFLICT DO NOTHING;
ALTER TABLE site_public_services ENABLE ROW LEVEL SECURITY;
