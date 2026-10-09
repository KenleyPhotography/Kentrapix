# Migrations (PostgreSQL / Supabase)

Pour modifier la structure de la base **en service** (ajouter une colonne, un index…),
ne modifiez pas les tables à la main : créez un fichier ici.

- Nom : `NNN_description.sql`, numéroté dans l'ordre. Commencez à `010_` (001 à 009 étaient les anciennes
  migrations MySQL, déjà incluses dans `../schema.sql`).
- Contenu : les `ALTER TABLE …` / `CREATE …` nécessaires, écrits pour être relancés sans erreur
  (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`…).
- Appliquer : `npm run db:init`. Chaque fichier n'est exécuté qu'une fois, dans une transaction
  (la liste est gardée dans la table `schema_migrations`).
- Reportez aussi le changement dans `../schema.sql` pour les nouvelles installations.
- Avant une migration en production : sauvegarde depuis Supabase (Database > Backups) ou `pg_dump`.
