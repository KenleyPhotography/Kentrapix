-- Lieu de la séance demandé depuis le portfolio (obligatoire sauf portrait / studio).
ALTER TABLE portfolio_requests ADD COLUMN IF NOT EXISTS location VARCHAR(120) NOT NULL DEFAULT '';
