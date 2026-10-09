# Base de données KentraPix (PostgreSQL / Supabase)

## 1. Installation

1. Supabase : créez un projet, puis bouton **Connect** > *Connection string* > **Session pooler** (IPv4).
   Copiez l'adresse `postgresql://postgres.<projet>:[YOUR-PASSWORD]@aws-0-<région>.pooler.supabase.com:5432/postgres`
   et remplacez `[YOUR-PASSWORD]` par le mot de passe de la base (*Project Settings > Database*).
   L'adresse « Direct connection » (`db.<projet>.supabase.co`) ne marche qu'en IPv6.
2. Dans `server/.env` : `DATABASE_URL=` + cette adresse.
3. Créer tables et vues :

```bash
cd server
npm run db:init
```

Le script applique `schema.sql`, les migrations en attente, puis affiche toutes les tables. Il peut être relancé
sans risque. La colonne « API Supabase bloquée (RLS) » doit indiquer **oui** partout.

## 2. Schéma

| Table | Rôle | Lien | Suppression |
|---|---|---|---|
| `users` | Comptes (owner, admin, client) | — | — |
| `events` | Galeries livrées à un client | `client_id → users` | **RESTRICT** : impossible de supprimer un client qui a des galeries |
| `photos` | Métadonnées des photos (fichiers sur R2) | `event_id → events` | **CASCADE** avec la galerie |
| `favorites` | Coups de cœur d'un client | `user_id`, `photo_id` | CASCADE |
| `downloads` | Historique + lien temporaire (10 min) | `user_id`, `event_id` | CASCADE / SET NULL |
| `permissions` | Autorisations globales (page Réglages) | — | — |
| `audit_log` | Journal : qui a fait quoi, quand, quelle IP | `user_id` | SET NULL (le journal reste) |
| `email_log` | E-mails envoyés (Resend) | `user_id`, `event_id`, `sent_by` | SET NULL |
| `photo_comments` | Commentaires sous les photos | `photo_id`, `user_id` | CASCADE |
| `password_resets` | Liens « mot de passe oublié » (hash du jeton) | `user_id` | CASCADE |
| `photo_selections` / `event_selections` | Mode sélection : choix et envoi au studio | `user_id`, `photo_id` / `event_id` | CASCADE |
| `people` / `photo_faces` | Reconnaissance des visages | `event_id` / `photo_id`, `person_id` | CASCADE / SET NULL |
| `share_links` | Liens de partage famille | `event_id`, `user_id` | CASCADE |
| `schema_migrations` | Migrations déjà appliquées | — | — |

### Règles de conception

- **UUID** en texte comme identifiants : impossible de deviner l'adresse d'une photo d'un autre client.
- **UTC** pour toutes les dates (`TIMESTAMP(0)`) ; l'affichage en heure locale est fait par le navigateur.
- **Booléens en 0/1** (`SMALLINT`).
- **Pas d'images dans la base** : seuls les chemins (`originals/…`, `previews/…`) sont stockés, les fichiers sont sur R2.
- **Sécurité Supabase** : RLS activé sans aucune règle et droits retirés à `anon` / `authenticated` : l'API publique
  de Supabase ne voit rien, seul le serveur KentraPix lit la base.

### Ce que voit un client

Un client voit une galerie **uniquement si** `client_id` = son compte **et** `published = 1` **et** `archived = 0`
**et** elle n'est pas expirée. Ce filtre est appliqué par le serveur sur chaque requête (API et images).

## 3. Vues prêtes à l'emploi (Supabase > SQL Editor)

```sql
SELECT * FROM v_event_stats ORDER BY event_date DESC;   -- par galerie : photos, Go, favoris, téléchargements
SELECT * FROM v_client_overview ORDER BY name;          -- par client : galeries, activité, dernière connexion
SELECT * FROM v_storage_usage;                          -- espace total des photos
```

## 4. Requêtes utiles

```sql
-- Derniers événements du journal
SELECT a.created_at, u.name, a.action, a.entity, a.details, a.ip
FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
ORDER BY a.id DESC LIMIT 50;

-- Tentatives de connexion échouées des dernières 24 h
SELECT ip, details->>'email' AS email, COUNT(*) AS essais
FROM audit_log
WHERE action = 'auth.login_failed' AND created_at > CURRENT_TIMESTAMP - INTERVAL '1 day'
GROUP BY ip, email ORDER BY essais DESC;

-- Clients jamais connectés (mot de passe temporaire pas encore changé)
SELECT name, email, created_at FROM users WHERE role = 'client' AND must_change_password = 1;

-- Photos les plus aimées
SELECT p.filename, e.name AS galerie, COUNT(*) AS favoris
FROM favorites f JOIN photos p ON p.id = f.photo_id JOIN events e ON e.id = p.event_id
GROUP BY p.id, e.name ORDER BY favoris DESC LIMIT 20;

-- Purger le journal de plus d'un an
DELETE FROM audit_log WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '1 year';
```

> Ne modifiez pas `password_hash` à la main : utilisez « Nouveau mot de passe » dans le studio
> ou `npm run create-admin` pour un admin.

## 5. Sauvegarde

- Supabase garde des sauvegardes automatiques (*Database > Backups* ; quotidiennes sur les offres payantes).
- Copie manuelle à garder ailleurs : `pg_dump "<DATABASE_URL>" > kentrapix-AAAA-MM-JJ.sql`
  (outil `pg_dump` de PostgreSQL 17).
- Les photos sont sur Cloudflare R2 : la base sans le bucket (ou l'inverse) est inutilisable.

## 6. Faire évoluer la structure

Voir [migrations/README.md](migrations/README.md) : un fichier `NNN_description.sql` par changement,
appliqué automatiquement par `npm run db:init`.
