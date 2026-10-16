-- Le photographe peut proposer une autre date quand il refuse un créneau : la réservation change de jour (statut « proposed »)
-- et garde l'ancienne date ; le client accepte ou refuse. Un créneau proposé reste réservé tant que le client n'a pas répondu.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS orig_day DATE NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS orig_start VARCHAR(5) NULL;
DROP INDEX IF EXISTS uq_bookings_slot;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bookings_slot ON bookings (staff_id, day, start_time) WHERE status IN ('pending', 'confirmed', 'proposed');
