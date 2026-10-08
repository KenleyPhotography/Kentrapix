# Migrations

Pour modifier la structure d'une base **déjà en service** (ajouter une colonne, un index…),
ne modifiez pas les tables existantes à la main : créez un fichier ici.

- Nom : `NNN_description.sql`, numéroté dans l'ordre (`001_ajout_colonne_x.sql`, `002_...`).
- Contenu : les `ALTER TABLE ...` / `CREATE ...` nécessaires.
- Appliquer : `npm run db:init` (chaque fichier n'est exécuté qu'une seule fois ; la liste
  est gardée dans la table `schema_migrations`).
- Pensez à reporter aussi le changement dans `../schema.sql` pour les nouvelles installations.
- Faites toujours une sauvegarde (`mysqldump`) avant d'appliquer une migration en production.
