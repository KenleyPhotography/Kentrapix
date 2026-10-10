-- Les liens « mot de passe du studio oublié » partagent la table des liens de réinitialisation : on les distingue.
ALTER TABLE password_resets ADD COLUMN IF NOT EXISTS kind VARCHAR(10) NOT NULL DEFAULT 'login';
