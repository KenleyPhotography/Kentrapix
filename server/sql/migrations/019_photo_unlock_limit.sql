-- Photos débloquées : le photographe n'ouvre au client que les N premières photos de la galerie (ex. jusqu'à paiement du solde).
-- unlock_limit NULL = toutes les photos. lock_mode : 'locked' (visibles mais verrouillées) ou 'hidden' (cachées).
ALTER TABLE events ADD COLUMN IF NOT EXISTS unlock_limit INTEGER      NULL;
ALTER TABLE events ADD COLUMN IF NOT EXISTS lock_mode    VARCHAR(10)  NOT NULL DEFAULT 'locked';
ALTER TABLE events ADD COLUMN IF NOT EXISTS lock_reason  VARCHAR(300) NULL;
