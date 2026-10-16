-- Rappels de contrat pas signé, modèles de contrat du photographe, avis des clients après livraison.
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMP(0) NULL;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS reminded_phase VARCHAR(10) NULL; -- after2 | before3 : dernière étape de rappel envoyée

CREATE TABLE IF NOT EXISTS contract_templates (
  id         VARCHAR(36)  PRIMARY KEY,
  staff_id   VARCHAR(36)  NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name       VARCHAR(80)  NOT NULL,
  body       TEXT         NOT NULL, -- peut contenir {{client}} {{studio}} {{session}} {{date}} {{place}} {{price}} {{deposit}}
  created_at TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_contract_templates_staff ON contract_templates (staff_id);
ALTER TABLE contract_templates ENABLE ROW LEVEL SECURITY;

-- Avis : un par client et par galerie (modifiable). Affiché sur la page de connexion seulement si le photographe l'a approuvé.
CREATE TABLE IF NOT EXISTS reviews (
  id         VARCHAR(36)  PRIMARY KEY,
  staff_id   VARCHAR(36)  NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  client_id  VARCHAR(36)  NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  event_id   VARCHAR(36)  NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  rating     SMALLINT     NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment    VARCHAR(800) NULL,
  is_public  SMALLINT     NOT NULL DEFAULT 0,
  created_at TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_reviews_client_event ON reviews (client_id, event_id);
CREATE INDEX IF NOT EXISTS idx_reviews_staff ON reviews (staff_id, created_at DESC);
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
