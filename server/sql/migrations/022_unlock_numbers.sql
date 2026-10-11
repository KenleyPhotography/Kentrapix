-- Photos débloquées par numéros (ex. « 1-10, 15, 20-25 »). NULL = règle « N premières » (unlock_limit) ou toutes ; '' = aucune.
ALTER TABLE events ADD COLUMN IF NOT EXISTS unlock_numbers VARCHAR(2000) NULL;
