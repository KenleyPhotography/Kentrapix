# KentraPix — by Kenley Photography

Espace photo privé pour les clients de Kenley Photography.

- **Frontend** : HTML/CSS/JavaScript sans build (`*.html`, `css/`, `js/`).
- **Backend** : Node.js + Express + PostgreSQL/Supabase (`server/`). Il sert aussi le frontend. Photos sur Cloudflare R2, hébergement Render.

Installation, architecture, API, sécurité et mise en production : voir [server/README.md](server/README.md).

```bash
cd server && npm install && cp .env.example .env   # remplir .env
npm run db:init && npm run create-admin && npm run dev
# http://localhost:3000
```
