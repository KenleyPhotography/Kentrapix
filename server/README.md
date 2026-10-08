# KentraPix — Backend (Node.js + Express + MySQL)

Le serveur sert le site (HTML/CSS/JS du dossier parent) **et** l'API. Live Server n'est plus utilisé.

## Installation (une seule fois)

Prérequis : Node.js 20.12+ et MySQL 8 (ou MariaDB 10.6+).

```bash
cd server
npm install
cp .env.example .env        # Windows : copy .env.example .env
```

Remplissez `.env` :
- `DB_USER`, `DB_PASSWORD`, `DB_NAME` : votre base MySQL.
- `JWT_SECRET` : générez-le avec
  `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`

Puis :

```bash
npm run db:init         # crée la base et les tables (sql/schema.sql)
npm run create-admin    # crée votre compte studio (mot de passe demandé au clavier)
npm run dev             # http://localhost:3000
```

Ensuite, connectez-vous en admin et créez vos clients depuis **Clients** (mot de passe temporaire : le client choisit le sien à sa première connexion).

Guide MySQL détaillé (installation, schéma, requêtes utiles, sauvegardes) : [sql/README.md](sql/README.md).

## Rôles

| Rôle | Studio | Équipe (nommer/retirer des admins) | Ses propres galeries |
|---|---|---|---|
| **owner** (propriétaire) — créé par `npm run create-admin` | ✅ | ✅ | ✅ « Mes photos » |
| **admin** — nommé par le propriétaire | ✅ | ❌ | ✅ « Mes photos » |
| **client** | ❌ | ❌ | ✅ |

Une galerie peut être livrée à n'importe quel compte (client, admin ou propriétaire).

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

## Reconnaissance des visages

Chaque photo importée est analysée **en arrière-plan** (moteur Human + TensorFlow WASM, sans module natif, environ 5 s par photo) : les visages sont regroupés par personne dans chaque galerie.

- Studio : bouton **Visages** sur une galerie → nommer les personnes, masquer, fusionner deux groupes, réanalyser.
- Client : seules les personnes **nommées** apparaissent dans la rangée « Personnes » de la galerie (filtre). Désactivable dans Réglages.
- Seuil de ressemblance : `FACE_MATCH` (cosinus, défaut 0,78 — strict : une même personne peut apparaître en deux groupes, à fusionner ; deux personnes ne sont pas mélangées).
- Limite : les très petits visages (fond d’une photo de groupe) ne sont pas détectés.
- Données biométriques : supprimées avec la photo ou la galerie ; analyse interrompue ou en échec relancée au démarrage du serveur.

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
    config.js  db.js      Configuration .env, pool MySQL (requêtes préparées, UTC)
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

## Mise en production (VPS)

1. `NODE_ENV=production`, `TRUST_PROXY=true` derrière Nginx, **HTTPS obligatoire** (Let's Encrypt).
2. Lancer avec un gestionnaire de processus : `pm2 start src/server.js --name kentrapix`.
3. Nginx : `client_max_body_size 60m;` (≥ `MAX_UPLOAD_MB`) et `proxy_pass http://127.0.0.1:3000;`.
4. **Sauvegardes** : base (`mysqldump kentrapix`) **et** dossier `storage/`, tous les jours, hors du serveur.
5. Utilisateur MySQL dédié avec droits limités à la base `kentrapix`.

## À prévoir ensuite

- Envoi d'e-mails (bienvenue, mot de passe oublié par lien) via un service SMTP.
- Pour un très grand volume de photos : stockage S3/R2 (seul `lib/storage.js` change) et pagination de la page Albums.
