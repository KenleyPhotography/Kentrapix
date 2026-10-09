import express from 'express';
import path from 'node:path';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { config, frontendRoot } from './config.js';
import { query } from './db.js';
import { loadUser } from './middleware/auth.js';
import { apiNotFound, errorHandler } from './lib/errors.js';
import authRoutes from './routes/auth.js';
import clientRoutes from './routes/client.js';
import adminRoutes from './routes/admin.js';
import mediaRoutes from './routes/media.js';
import pageRoutes from './routes/pages.js';
import { shareApi, shareMedia } from './routes/share.js';

export function createApp() {
  const app = express();
  // Photos en ligne : liens signés vers le bucket (affichage, musique, envoi direct).
  const bucket = config.s3 ? [config.s3.origin] : [];
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'blob:', 'https://images.unsplash.com', ...bucket],
          mediaSrc: ["'self'", 'blob:', ...bucket],
          connectSrc: ["'self'", ...bucket],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: config.isProd ? [] : null,
        },
      },
      hsts: config.isProd,
    }),
  );
  // Une seule adresse publique (APP_URL) : l'adresse Render (…onrender.com) y renvoie,
  // sinon Google voit deux copies du site. localhost (PC du studio) n'est jamais redirigé ;
  // /api/health reste joignable pour la surveillance de Render.
  const site = new URL(config.appUrl);
  app.use((req, res, next) => {
    const duplicate = req.hostname.endsWith('.onrender.com') && req.hostname !== site.hostname;
    if (!duplicate || req.path === '/api/health' || !['GET', 'HEAD'].includes(req.method)) return next();
    res.redirect(301, `${site.origin}${req.originalUrl}`);
  });
  // Seule la page d'accueil / connexion est indexée. Galeries, studio, API, photos et liens
  // de partage : jamais dans Google, même si un lien fuit.
  const indexable = (p) => p === '/' || p === '/conditions.html' || p === '/sitemap.xml' || p === '/robots.txt' || /^\/(css|js|img|logo)\//.test(p);
  app.use((req, res, next) => {
    if (!indexable(req.path)) res.set('X-Robots-Tag', 'noindex, nofollow');
    next();
  });
  app.use(morgan(config.isProd ? 'combined' : 'dev'));
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());
  app.use(loadUser);

  app.get('/api/health', async (req, res) => {
    await query('SELECT 1');
    res.json({ ok: true });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/client', clientRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/share', shareApi); // lien de partage famille (sans compte)
  app.use('/api', apiNotFound);
  app.use('/media/share', shareMedia);
  app.use('/media', mediaRoutes);
  app.use(pageRoutes);
  app.use((req, res) => res.status(404).sendFile(path.join(frontendRoot, '404.html')));
  app.use(errorHandler);
  return app;
}
