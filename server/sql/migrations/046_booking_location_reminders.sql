-- Lieu du rendez-vous (saisi par le studio) et rappels du photographe : 2 jours avant, la veille, le jour même, 1 h avant.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS location VARCHAR(120) NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS staff_reminders VARCHAR(30) NOT NULL DEFAULT '';          -- étapes déjà envoyées : d2,d1,d0,h1
ALTER TABLE portfolio_requests ADD COLUMN IF NOT EXISTS staff_reminders VARCHAR(30) NOT NULL DEFAULT '';
