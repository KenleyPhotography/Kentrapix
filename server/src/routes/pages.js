import { Router } from 'express';
import express from 'express';
import path from 'node:path';
import { config, frontendRoot } from '../config.js';

// Sert le frontend. Seuls css/, js/, logo/, img/ et les pages listées sont publics :
// le dossier server/ (code, .env, photos) n'est jamais exposé.
const router = Router();
const page = (file) => path.join(frontendRoot, file);
const staff = (user) => ['owner', 'admin'].includes(user.role);
const home = (user) => (staff(user) ? '/admin.html' : '/client.html');

// En développement : pas de cache, chaque modification est visible tout de suite.
const assetCache = { maxAge: config.isProd ? '1h' : 0 };
router.use('/css', express.static(path.join(frontendRoot, 'css'), assetCache));
router.use('/logo', express.static(path.join(frontendRoot, 'logo'), { maxAge: '7d' }));
router.use('/img', express.static(path.join(frontendRoot, 'img'), { maxAge: '7d' }));
router.use('/js', express.static(path.join(frontendRoot, 'js'), assetCache));

// Application installable (PWA) : manifeste + service worker à la racine du site.
router.get('/manifest.webmanifest', (req, res) => {
  res.type('application/manifest+json').set('Cache-Control', 'no-cache').sendFile(page('manifest.webmanifest'));
});
router.get('/sw.js', (req, res) => {
  res.type('application/javascript').set('Cache-Control', 'no-cache').sendFile(page('sw.js'));
});

// Moteurs de recherche : seule la page d'accueil (connexion) est indexée ; galeries, studio,
// API, photos et liens de partage restent privés (voir aussi X-Robots-Tag dans app.js).
router.get('/robots.txt', (req, res) => res.type('text').send([
  'User-agent: *',
  'Allow: /$',
  'Allow: /login.html',
  'Allow: /conditions.html',
  'Disallow: /api/',
  'Disallow: /media/',
  'Disallow: /admin',
  'Disallow: /client.html',
  'Disallow: /gallery.html',
  'Disallow: /share.html',
  'Disallow: /*?',
  '',
  `Sitemap: ${config.appUrl}/sitemap.xml`,
  '',
].join('\n')));
router.get('/sitemap.xml', (req, res) => res.type('application/xml').send(
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${config.appUrl}/</loc><changefreq>monthly</changefreq><priority>1.0</priority></url>\n  <url><loc>${config.appUrl}/conditions.html</loc><changefreq>yearly</changefreq><priority>0.3</priority></url>\n</urlset>\n`,
));
router.get('/favicon.ico', (req, res) => res.redirect(301, '/logo/kentrapix-icon.png'));

// Conditions d'utilisation : page publique (liée depuis la connexion et la barre latérale).
router.get('/conditions.html', (req, res) => res.sendFile(page('conditions.html')));

// Lien de partage famille : page publique, le mot de passe est vérifié par l'API.
router.get('/share.html', (req, res) => {
  res.set('Referrer-Policy', 'no-referrer').sendFile(page('share.html'));
});

const ready = (user) => user && !user.must_change_password;

router.get('/login.html', (req, res) => {
  if (ready(req.user)) return res.redirect(home(req.user));
  res.set({ 'Cache-Control': 'no-cache', Vary: 'Cookie' }).sendFile(page('login.html'));
});

// Espace client : connexion obligatoire ; un admin est envoyé vers le studio.
// L'équipe arrive sur le studio depuis « / », mais peut ouvrir client.html pour ses propres
// photos (« Mes photos ») ou l'aperçu d'un client (?preview=<id>).
router.get(['/', '/index.html', '/client.html', '/gallery.html'], (req, res) => {
  // Visiteur (et Google) sur « / » : la page de connexion directement, sans redirection,
  // pour que l'adresse principale du site soit celle qui est indexée.
  if (!ready(req.user) && req.path === '/') return res.set({ 'Cache-Control': 'no-cache', Vary: 'Cookie' }).sendFile(page('login.html'));
  if (!ready(req.user)) return res.redirect('/login.html');
  if (staff(req.user) && ['/', '/index.html'].includes(req.path)) return res.redirect('/admin.html');
  res.sendFile(page(req.path === '/' ? 'index.html' : req.path.slice(1)));
});

// Studio : invisible pour tout le monde sauf l'équipe connectée (propriétaire + admins).
router.get(['/admin.html', '/admin/', '/admin/index.html'], (req, res) => {
  // Express ne distingue pas /admin et /admin/ : sans « / » final, les liens ../css de la page casseraient.
  if (!req.originalUrl.split('?')[0].match(/\.html$|\/$/)) return res.redirect('/admin/');
  if (!ready(req.user)) return res.redirect('/login.html');
  if (!staff(req.user)) return res.redirect('/client.html');
  res.sendFile(page(req.path === '/admin.html' ? 'admin.html' : 'admin/index.html'));
});

export default router;
