-- Code d'accès de chaque membre de l'équipe (2 à 4 caractères) + validation du code par les nouveaux clients.
ALTER TABLE users ADD COLUMN IF NOT EXISTS access_code VARCHAR(4) NULL;
-- 1 = accès accordé (tous les comptes existants) ; 0 = inscription libre en attente du code d'un photographe.
ALTER TABLE users ADD COLUMN IF NOT EXISTS access_granted SMALLINT NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_access_code ON users (access_code) WHERE access_code IS NOT NULL;

-- Codes de départ pour les comptes de l'équipe existants (4 caractères, sans I, L, O, 0, 1).
DO $$
DECLARE r RECORD; c TEXT;
BEGIN
  FOR r IN SELECT id FROM users WHERE role IN ('owner', 'admin') AND access_code IS NULL LOOP
    LOOP
      c := '';
      FOR i IN 1..4 LOOP
        c := c || substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1);
      END LOOP;
      BEGIN
        UPDATE users SET access_code = c WHERE id = r.id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN NULL;
      END;
    END LOOP;
  END LOOP;
END $$;
