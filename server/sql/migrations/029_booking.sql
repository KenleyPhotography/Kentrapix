-- Rendez-vous : le photographe ouvre des créneaux, le client choisit un jour et une heure.
CREATE TABLE IF NOT EXISTS booking_settings (
  staff_id        VARCHAR(36)  PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  enabled         SMALLINT     NOT NULL DEFAULT 0,
  days            VARCHAR(20)  NOT NULL DEFAULT '1,2,3,4,5', -- jours ouverts : 0 = dimanche … 6 = samedi
  start_time      VARCHAR(5)   NOT NULL DEFAULT '09:00',
  end_time        VARCHAR(5)   NOT NULL DEFAULT '17:00',
  duration_min    INTEGER      NOT NULL DEFAULT 120,
  min_notice_days INTEGER      NOT NULL DEFAULT 2,
  horizon_days    INTEGER      NOT NULL DEFAULT 60,
  auto_confirm    SMALLINT     NOT NULL DEFAULT 0,
  session_types   VARCHAR(400) NOT NULL DEFAULT 'Portrait,Famille,Couple,Mariage,Événement,Autre',
  updated_at      TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS booking_blocked_days (
  staff_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day      DATE        NOT NULL,
  PRIMARY KEY (staff_id, day)
);

CREATE TABLE IF NOT EXISTS bookings (
  id            VARCHAR(36)  PRIMARY KEY,
  staff_id      VARCHAR(36)  NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  client_id     VARCHAR(36)  NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day           DATE         NOT NULL,
  start_time    VARCHAR(5)   NOT NULL,
  duration_min  INTEGER      NOT NULL,
  session_type  VARCHAR(80)  NOT NULL DEFAULT '',
  note          VARCHAR(500) NULL,
  status        VARCHAR(12)  NOT NULL DEFAULT 'pending', -- pending | confirmed | declined | cancelled
  reply         VARCHAR(500) NULL,
  reminded_at   TIMESTAMP(0) NULL,
  created_at    TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bookings_staff_day ON bookings (staff_id, day);
CREATE INDEX IF NOT EXISTS idx_bookings_client ON bookings (client_id, day);
-- Un même créneau ne peut pas être pris deux fois (demandes en attente et confirmées).
CREATE UNIQUE INDEX IF NOT EXISTS uq_bookings_slot ON bookings (staff_id, day, start_time) WHERE status IN ('pending', 'confirmed');

ALTER TABLE booking_settings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_blocked_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings             ENABLE ROW LEVEL SECURITY;
