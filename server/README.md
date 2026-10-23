# KentraPix — Backend (Node.js + Express + PostgreSQL/Supabase)

Le serveur sert le site (HTML/CSS/JS du dossier parent) **et** l'API. Live Server n'est plus utilisé.

## Installation (une seule fois)

Prérequis : Node.js 20.12+ et un projet [Supabase](https://supabase.com) (base PostgreSQL).

```bash
cd server
npm install
cp .env.example .env        # Windows : copy .env.example .env
```

Remplissez `.env` :
- `DATABASE_URL` : adresse **Session pooler** de Supabase (bouton *Connect*), avec le mot de passe de la base.
- `JWT_SECRET` : générez-le avec
  `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`

Puis :

```bash
npm run db:init         # crée les tables et les vues (sql/schema.sql)
npm run create-admin    # crée votre compte studio (mot de passe demandé au clavier)
npm run dev             # http://localhost:3000
```

Ensuite, connectez-vous en admin et créez vos clients depuis **Clients** (mot de passe temporaire : le client choisit le sien à sa première connexion).

Guide de la base (Supabase, schéma, requêtes utiles, sauvegardes) : [sql/README.md](sql/README.md).

## Rôles

| Rôle | Studio | Équipe (nommer/retirer des admins) | Ses propres galeries |
|---|---|---|---|
| **owner** (propriétaire) — créé par `npm run create-admin` | ✅ | ✅ | ✅ « Mes photos » |
| **admin** — nommé par le propriétaire | ✅ | ❌ | ✅ « Mes photos » |
| **client** | ❌ | ❌ | ✅ |

Une galerie peut être livrée à n'importe quel compte (client, admin ou propriétaire).

### Plusieurs photographes (abonnés)

Chaque **admin** est un photographe indépendant :

- il ne voit que **ses** clients, **ses** galeries, leurs photos, commentaires et **ses** e-mails envoyés
  (colonnes `users.created_by` et `events.created_by`, migration `006_photographers.sql`) ;
- il ne voit ni la page **Équipe** ni les **Réglages** globaux (réservés au propriétaire) ;
- ses e-mails partent avec **son nom** (« Mon profil » → *Nom d’expéditeur des e-mails*), depuis l'adresse
  du domaine vérifié de `MAIL_FROM`, et les réponses arrivent dans **sa** boîte (`reply_to`) ;
- les sélections de ses clients lui sont envoyées directement.

Le propriétaire voit tout. Tous les e-mails portent le logo KentraPix (`logo/kentrapix-email.png`, joint en image intégrée).

## E-mails automatiques (Resend)

1. Créez une clé sur https://resend.com/api-keys et collez-la dans `server/.env` : `RESEND_API_KEY=re_...`
2. `MAIL_FROM` : une adresse d'un domaine **vérifié** dans Resend (ex. `Kenley Photography <photos@votre-domaine.com>`).
   Pour tester sans domaine : `KentraPix <onboarding@resend.dev>` — Resend n'envoie alors **qu'à l'adresse de votre compte Resend**.
3. `APP_URL` : adresse publique du site (liens dans les e-mails).
4. Redémarrez le serveur.

| E-mail | Quand |
|---|---|
| Bienvenue (accès + mot de passe temporaire) | création d'un client (case cochée par défaut) |
| Vos photos sont prêtes | une galerie devient publiée ; bouton « Prévenir » pour renvoyer |
| Nouveau mot de passe | « Mot de passe » sur un client ou un admin |
| Invitation équipe | nouvel admin ou client nommé admin |
| Message libre | bouton « Message » |

Chaque envoi est noté dans la table `email_log` (page **E-mails** du studio). Sans clé, rien n'est envoyé et l'e-mail est noté « Non envoyé ».
La clé Resend reste sur le serveur : elle n'est jamais envoyée au navigateur.

## Mode sélection (épreuves)

Dans « Gérer » une galerie, cochez **Mode sélection** (et éventuellement un nombre maximum). Le client voit des aperçus **filigranés et numérotés**, choisit des photos (clic ou numéros « 3, 7, 12-15 ») et envoie sa sélection : l'équipe reçoit un e-mail et la retrouve via le bouton **Sélection** de la galerie. Sur ces galeries, **aucun téléchargement n'est possible** : l'API refuse toute demande, et les originaux ne sont jamais servis.

## Expiration des galeries

Dans « Gérer », **Disponible jusqu’au** fixe le dernier jour où le client voit la galerie (vide = pour toujours).
Le client voit la date en haut de la galerie (en orange les 7 derniers jours). **7 jours avant**, il reçoit
automatiquement l’e-mail « Votre galerie ferme dans X jours » (vérifié au démarrage puis toutes les heures,
`src/lib/expiry.js`). Après la date, la galerie disparaît de son espace ; le studio la garde. Changer la date relance le rappel.

## Partage famille

Si **Partage** est activé dans les Réglages, le client a un bouton **Partager** dans sa galerie : il crée un lien
+ un mot de passe (10 liens max par galerie) et l’envoie à sa famille. La page `share.html` demande le mot de passe,
puis montre les photos et le diaporama — **jamais de téléchargement ni d’original** (aperçus seulement, filigranés
en mode sélection). Le lien cesse de fonctionner si le client le supprime, si la galerie est dépubliée, archivée ou expirée.

## Diaporama et musique

Bouton **Diaporama** (client et lien de partage) : plein écran, fondu enchaîné, commandes qui s’effacent, glisser
sur mobile. Dans « Gérer », **Musique du diaporama** ajoute un fichier audio (MP3, M4A, AAC, OGG, WAV — 20 Mo max,
stocké dans `storage/music/`). Utilisez une musique dont vous avez les droits.

## Photos en ligne (Backblaze B2 / S3)

Avec `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET` et `B2_ENDPOINT` dans `.env` (bucket **privé**), les photos
ne sont plus enregistrées sur le serveur :

- **import** : le navigateur du studio crée l'aperçu WEBP (orientation EXIF appliquée) puis envoie original + aperçu
  **directement au bucket** via des adresses signées (15 min) ; le serveur vérifie leur arrivée puis enregistre la fiche ;
- **affichage / téléchargement** : `/media/…` vérifie les droits puis redirige vers un lien signé (2 h, identique pendant
  une heure pour profiter du cache du navigateur) — les photos ne transitent pas par le serveur ;
- passent encore par le serveur, sans y être conservés : le ZIP « Tout télécharger », la création des filigranes
  (mode sélection), les couvertures, avatars et musiques envoyés.

Mise en route : `npm run storage:setup` (vérifie la connexion et autorise le site dans les règles CORS du bucket),
puis `npm run storage:migrate` (copie les photos existantes ; `-- --delete-local` supprime ensuite les copies locales).
Sans ces variables, tout reste dans `STORAGE_DIR` comme avant.

## Base PostgreSQL / Supabase

Base : Supabase (`DATABASE_URL`). Les routes écrivent leurs requêtes avec des `?`, numérotés par
[src/db.js](src/db.js). Schéma : [sql/schema.sql](sql/schema.sql), évolutions dans `sql/migrations/`.
L'API publique de Supabase est bloquée (RLS sans règle) : seul ce serveur lit la base.
Ancienne base MySQL : sauvegarde `kentrapix-mysql-2026-10-09.sql` (dossier `backups`, hors du dépôt).

## Application installable (PWA)

`manifest.webmanifest` + `sw.js` : le site s’installe sur l’écran d’accueil (Android/Chrome : bouton **Installer**
dans « Mon profil » ; iPhone : Safari → Partager → Sur l’écran d’accueil). Le service worker ne met en cache que
l’interface (css/js/logo/img) ; photos, musique et API restent toujours privées. **HTTPS obligatoire** en ligne.

## Site en maintenance

Studio > **Réglages** > *Fermer le site* (propriétaire principal). On choisit une **durée** (15 min, 1 h, 2 h…,
« autre durée » en minutes / heures / jours, ou « jusqu'à ce que je rouvre »), le **titre** et le **message** affichés.
Visiteurs et clients reçoivent alors `maintenance.html` en **503** (`Retry-After`) : une page avec le temps restant,
qui se recharge toute seule à la réouverture. L'équipe (propriétaire + admins) n'est jamais bloquée : `/login`,
`/admin`, `/conditions`, les fichiers du site et `/api/auth` · `/api/admin` restent ouverts, pour pouvoir
travailler et rouvrir le site. Les appels d'API refusés portent l'en-tête `X-Maintenance` : l'espace client
déjà ouvert chez un client bascule tout seul sur la page de maintenance.

Passé l'heure de fin, le site **se rouvre tout seul** (`src/lib/maintenance.js`, réglage dans `site_maintenance`).
`/maintenance` montre la page à tout moment, sans rien fermer : c'est l'aperçu du bouton « Voir la page ».

## Architecture

```
server/
  sql/schema.sql          8 tables + 3 vues — détails complets dans sql/README.md
  sql/migrations/         Évolutions futures de la structure
  scripts/                db-init, create-admin
  storage/                Photos PRIVÉES (originals/, previews/, covers/) — jamais publiques
  src/
    server.js             Démarrage, vérifications, arrêt propre
    app.js                Express : sécurité (helmet/CSP), routes, erreurs
    config.js  db.js      Configuration .env, pool PostgreSQL (requêtes préparées, UTC)
    middleware/auth.js    Session (cookie httpOnly signé), rôles
    lib/                  storage (sharp), data (mappers, permissions), errors
    routes/
      auth.js             /api/auth   login, logout, me, password
      client.js           /api/client bootstrap, favoris, téléchargements (ZIP serveur)
      admin.js            /api/admin  clients, événements, photos, autorisations
      media.js            /media      aperçus et couvertures (droits vérifiés)
      pages.js            pages HTML + /css /js
```

## API

| Méthode | Route | Rôle |
|---|---|---|
| POST | `/api/auth/login` · `/logout` · `/password` | tous |
| GET | `/api/auth/me` | connecté |
| GET | `/api/client/bootstrap` | client |
| PUT/DELETE | `/api/client/favorites/:photoId` | client |
| POST | `/api/client/downloads` → `{ url }` (lien valable 10 min) | client |
| GET | `/api/client/downloads/:id/file` | client |
| GET | `/api/admin/bootstrap` | admin |
| POST/PATCH | `/api/admin/clients[/:id]`, POST `/clients/:id/password`, GET `/clients/:id/preview` | équipe |
| POST | `/api/admin/accounts/:id/message` | équipe |
| POST/PATCH | `/api/admin/team[/:id]`, POST `/team/:id/password` | propriétaire |
| GET | `/api/admin/emails` | équipe |
| GET | `/api/auth/options` · POST `/api/auth/signup` · `/forgot` · `/reset` | public (limités) |
| PATCH | `/api/auth/profile` · POST/DELETE `/api/auth/avatar` | connecté |
| GET/POST | `/api/client/photos/:id/comments`, DELETE `/api/client/comments/:id` | connecté |
| PUT | `/api/client/events/:id/selection` · POST `/selection/submit` | connecté (mode sélection) |
| GET | `/api/admin/comments`, `/api/admin/events/:id/selection` | équipe |
| POST | `/api/admin/events/:id/notify` | équipe |
| POST/PATCH/DELETE | `/api/admin/events[/:id]` (multipart), POST `/events/:id/cover` | admin |
| POST | `/api/admin/events/:id/photos` (multipart, champ `photo`) | admin |
| PATCH/DELETE | `/api/admin/photos/:id`, POST `/photos/:id/move-up` | admin |
| PUT | `/api/admin/permissions` | admin |
| GET/PUT | `/api/admin/maintenance` | propriétaire principal |
| GET | `/api/public/maintenance` | public |
| GET | `/media/preview/:photoId`, `/media/cover/:eventId` | connecté + droits |
| GET | `/api/health` | public |

## Sécurité en place

- Mots de passe hachés avec **bcrypt** (coût 12) ; jamais stockés ni renvoyés en clair.
- Session dans un cookie **httpOnly + SameSite=Strict** (+ `Secure` en production) : inaccessible au JavaScript, protégé du CSRF.
- Chaque requête relit l'utilisateur en base : un compte désactivé ou un mot de passe changé coupe toutes ses sessions immédiatement.
- Connexion limitée à 10 essais / 15 min par IP ; réponse identique que l'e-mail existe ou non.
- Mot de passe temporaire obligatoire à changer à la première connexion.
- Toutes les requêtes SQL sont **préparées** (pas d'injection SQL) ; toutes les entrées sont validées (zod).
- Photos dans un dossier privé ; un client ne voit que **ses** événements publiés et non archivés. Le studio (`admin.html`) est refusé par le serveur à tout non-admin.
- Images vérifiées par leur contenu (pas seulement l'extension), originales conservées intactes, aperçus WEBP générés côté serveur.
- En-têtes de sécurité (helmet, CSP stricte, HSTS en production).

## Mise en production (Render)

Le site tourne sur [Render](https://render.com), la base sur Supabase et les photos sur Cloudflare R2 : rien n'est
gardé sur le disque du serveur. Configuration : [render.yaml](../render.yaml) à la racine du dépôt.

1. Render : **New > Blueprint** > dépôt GitHub `KenleyPhotography/Kentrapix` > *Apply*.
2. Renseignez les valeurs demandées (copiées depuis `server/.env`) : `DATABASE_URL`, `JWT_SECRET`,
   `RESEND_API_KEY`, `MAIL_FROM`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_KEY_ID`, `S3_SECRET`.
3. Vérifiez `https://kentrapix.onrender.com/api/health` → `{"ok":true}`.
4. Render : *Settings > Custom Domains* > `kentrapix.kenleyelysee.com`. Cloudflare : supprimez le *Public hostname* du
   tunnel, puis *DNS* > `CNAME kentrapix → kentrapix.onrender.com` (**DNS only**, nuage gris).
5. Chaque `git push` sur `master` redéploie le site.

Offre gratuite : 512 Mo de mémoire et mise en veille après
15 min sans visite (≈ 1 min d'attente pour le visiteur suivant ; les rappels d'expiration ne partent pas pendant la veille).

En attendant Render, le PC peut toujours servir le site : `deploy/windows/run-kentrapix.ps1` (relance automatique)
et `run-tunnel.ps1` (Cloudflare Tunnel, *Public hostname* `kentrapix.kenleyelysee.com` → `HTTP localhost:3000`).

## À prévoir ensuite

- Envoi d'e-mails (bienvenue, mot de passe oublié par lien) via un service SMTP.
- Pour un très grand volume de photos : pagination de la page Albums.
