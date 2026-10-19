import { Router } from 'express';
import express from 'express';
import path from 'node:path';
import { config, frontendRoot } from '../config.js';

// Sert le frontend. Seuls css/, js/, logo/, img/ et les pages listées sont publics :
// le dossier server/ (code, .env, photos) n'est jamais exposé.
const router = Router();
const page = (file) => path.join(frontendRoot, file);
const staff = (user) => ['owner', 'admin'].includes(user.role);
const home = (user) => (staff(user) ? '/admin' : '/client');

// En développement : pas de cache, chaque modification est visible tout de suite.
// CSS et JS : le navigateur revérifie à chaque fois (réponse 304 très légère si rien n'a changé), pour qu'une mise à jour
// du site s'affiche tout de suite au lieu de rester cachée plusieurs heures.
const assetCache = { maxAge: 0, setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') };
router.use('/css', express.static(path.join(frontendRoot, 'css'), assetCache));
router.use('/logo', express.static(path.join(frontendRoot, 'logo'), { maxAge: '7d' }));
router.use('/img', express.static(path.join(frontendRoot, 'img'), { maxAge: '7d' }));
router.use('/js', express.static(path.join(frontendRoot, 'js'), assetCache));

// Adresses propres : /admin, /client, /login… (jamais « .html » dans la barre d'adresse).
// Les anciennes adresses en .html (liens déjà envoyés par e-mail, favoris) sont redirigées avec leurs paramètres.
router.get(/^\/(?:(?:admin|client|gallery|login|share|facture|conditions|index)\.html|admin\/(?:index\.html)?)$/, (req, res) => {
  const q = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
  const clean = req.path.replace(/\/index\.html$/, '/').replace(/\.html$/, '').replace(/(.)\/$/, '$1');
  res.redirect(301, (clean === '/index' ? '/' : clean) + q);
});

// Application installable (PWA) : manifeste + service worker à la racine du site.
router.get('/manifest.webmanifest', (req, res) => {
  res.type('application/manifest+json').set('Cache-Control', 'no-cache').sendFile(page('manifest.webmanifest'));
});
router.get('/sw.js', (req, res) => {
  res.type('application/javascript').set('Cache-Control', 'no-cache').sendFile(page('sw.js'));
});

// Application Android : l'APK est construit par GitHub (workflow « Android APK ») qui le dépose dans downloads/.
// Servi d'ici pour que le téléchargement reste sur KentraPix.
router.get('/KentraPix.apk', (req, res) => {
  res.set('Cache-Control', 'no-cache').download(page('downloads/KentraPix.apk'), 'KentraPix.apk', {
    headers: { 'Content-Type': 'application/vnd.android.package-archive' },
  }, (err) => {
    if (err && !res.headersSent) res.status(404).type('text').send('Application pas encore disponible. Réessayez dans quelques minutes.');
  });
});

// Moteurs de recherche : seule la page d'accueil (connexion) est indexée ; galeries, studio,
// API, photos et liens de partage restent privés (voir aussi X-Robots-Tag dans app.js).
router.get('/robots.txt', (req, res) => res.type('text').send([
  'User-agent: *',
  'Allow: /studio',
  'Allow: /studio/',
  'Disallow: /api/',
  'Disallow: /media/',
  'Disallow: /admin',
  'Disallow: /client',
  'Disallow: /gallery',
  'Disallow: /share',
  'Disallow: /facture',
  '',
  `Sitemap: ${config.appUrl}/sitemap.xml`,
  '',
].join('\n')));
router.get('/sitemap.xml', (req, res) => res.type('application/xml').send(
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${config.appUrl}/</loc><changefreq>monthly</changefreq><priority>1.0</priority></url>\n  <url><loc>${config.appUrl}/studio</loc><changefreq>monthly</changefreq><priority>0.9</priority></url>
${['outdoor', 'graduation', 'evenement', 'mariage', 'studio'].map((s) => `  <url><loc>${config.appUrl}/studio/${s}</loc><changefreq>monthly</changefreq><priority>0.8</priority></url>\n`).join('')}  <url><loc>${config.appUrl}/conditions</loc><changefreq>yearly</changefreq><priority>0.3</priority></url>\n</urlset>\n`,
));
router.get('/favicon.ico', (req, res) => res.type('image/png').set('Cache-Control', 'public, max-age=86400').sendFile(page('logo/icon-192.png')));

// Conditions d'utilisation : page publique (liée depuis la connexion et la barre latérale).
// Portfolio public du studio : vitrine + demande de séance (sans compte).
router.get('/studio', (req, res) => res.sendFile(page('portfolio.html')));
// Une page par catégorie (même vitrine, filtre présélectionné par js/portfolio.js).
['outdoor', 'graduation', 'evenement', 'mariage', 'studio'].forEach((slug) => {
  router.get(`/studio/${slug}`, (req, res) => res.sendFile(page('portfolio.html')));
  if (slug !== 'studio') router.get(`/${slug}`, (req, res) => res.redirect(301, `/studio/${slug}`));
});
router.get('/gaduation', (req, res) => res.redirect(301, '/studio/graduation'));
router.get('/conditions', (req, res) => res.sendFile(page('conditions.html')));

// Lien de partage famille : page publique, le mot de passe est vérifié par l'API.
// Facture : page publique ouverte avec le lien secret reçu par e-mail (les données viennent de /api/invoice/:token).
router.get('/facture', (req, res) => {
  res.set('Referrer-Policy', 'no-referrer').sendFile(page('facture.html'));
});

// Contrat : page publique de lecture et de signature (lien secret reçu par e-mail).
router.get('/contrat', (req, res) => {
  if (!ready(req.user)) return res.redirect('/login'); // le contrat n'est lisible que connecté avec le compte du destinataire
  res.set('Referrer-Policy', 'no-referrer').sendFile(page('contrat.html'));
});

router.get('/share', (req, res) => {
  res.set('Referrer-Policy', 'no-referrer').sendFile(page('share.html'));
});

// Prêt = connecté, mot de passe définitif, et (client inscrit seul) code d'un photographe validé.
const ready = (user) => user && !user.must_change_password && !(user.role === 'client' && !user.access_granted);

router.get('/login', (req, res) => {
  if (ready(req.user)) return res.redirect(home(req.user));
  res.set({ 'Cache-Control': 'no-cache', Vary: 'Cookie' }).sendFile(page('login.html'));
});

// Espace client : connexion obligatoire ; un admin est envoyé vers le studio.
// L'équipe arrive sur le studio depuis « / », mais peut ouvrir client.html pour ses propres
// photos (« Mes photos ») ou l'aperçu d'un client (?preview=<id>).
router.get(['/', '/client', '/gallery'], (req, res) => {
  // Visiteur (et Google) sur « / » : la page de connexion directement, sans redirection,
  // pour que l'adresse principale du site soit celle qui est indexée.
  if (!ready(req.user) && req.path === '/') return res.set({ 'Cache-Control': 'no-cache', Vary: 'Cookie' }).sendFile(page('login.html'));
  if (!ready(req.user)) return res.redirect('/login');
  if (staff(req.user) && req.path === '/') return res.redirect('/admin');
  res.sendFile(page(req.path === '/' ? 'index.html' : `${req.path.slice(1)}.html`));
});

// Studio : invisible pour tout le monde sauf l'équipe connectée (propriétaire + admins).
router.get('/admin', (req, res) => {
  // « /admin/ » (avec barre finale) fausserait les liens relatifs css/… de la page : on revient à « /admin ».
  if (req.originalUrl.split('?')[0].endsWith('/')) return res.redirect(301, '/admin');
  if (!ready(req.user)) return res.redirect('/login');
  if (!staff(req.user)) return res.redirect('/client');
  res.sendFile(page('admin.html'));
});

export default router;
