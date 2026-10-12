-- Une galerie peut être partagée avec plusieurs clients : events.client_id reste le client principal,
-- les autres clients cochés sont listés ici (chacun garde ses propres favoris, sélections et téléchargements).
CREATE TABLE IF NOT EXISTS event_clients (
  event_id  VARCHAR(36) NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  client_id VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_event_clients_client ON event_clients (client_id);
ALTER TABLE event_clients ENABLE ROW LEVEL SECURITY;
