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

const ready = (user) => user && !user.must_change_password;

router.get('/login.html', (req, res) => {
  if (ready(req.user)) return res.redirect(home(req.user));
  res.sendFile(page('login.html'));
});

// Espace client : connexion obligatoire ; un admin est envoyé vers le studio.
// L'équipe arrive sur le studio depuis « / », mais peut ouvrir client.html pour ses propres
// photos (« Mes photos ») ou l'aperçu d'un client (?preview=<id>).
router.get(['/', '/index.html', '/client.html', '/gallery.html'], (req, res) => {
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
