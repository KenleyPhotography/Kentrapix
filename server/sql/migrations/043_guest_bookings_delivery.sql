-- Rendez-vous pour une personne qui n'a pas de compte (nom et contact saisis par le studio) + date de remise des photos.
ALTER TABLE bookings ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guest_name  VARCHAR(80)  NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guest_phone VARCHAR(40)  NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guest_email VARCHAR(190) NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS delivery_date DATE NULL;               -- date prévue de remise des photos
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP(0) NULL;        -- photos remises
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS delivery_reminded_at TIMESTAMP(0) NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_delivery ON bookings (staff_id, delivery_date) WHERE delivery_date IS NOT NULL AND delivered_at IS NULL;
