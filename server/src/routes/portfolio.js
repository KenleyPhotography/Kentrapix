import { publicServices, publicPhotographers } from '../lib/public-services.js';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import multer from 'multer';
import sharp from 'sharp';
import { z } from 'zod';
import { query } from '../db.js';
import { httpError } from '../lib/errors.js';
import { uuid } from '../lib/data.js';
import { audit } from '../lib/audit.js';
import { config } from '../config.js';
import { githubReady, putFile, deleteFile, readFile } from '../lib/github.js';
import { isRawName, rawJpeg } from '../lib/raw.js';

export const CATEGORIES = ['Studio', 'Outdoor', 'Événement', 'Graduation', 'Mariage'];
const MAX_FILES = 12;

// Photos en mémoire le temps de les réduire ; rien n'est écrit sur le disque du serveur.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: MAX_FILES, fields: 5 } });
const mapPhoto = (r) => ({ id: r.id, category: r.category, src: `/portfolio-media/${r.file}`, createdAt: r.created_at });

// ---------- Studio (propriétaire) ----------
export const staffPortfolio = Router();
const profileDefaults = { published: false, bio: '', location: '' };
staffPortfolio.put('/profile', async (req, res) => {
  const profile = z.object({
    published: z.boolean(),
    bio: z.string().trim().max(700),
    location: z.string().trim().max(100),
  }).strict().parse(req.body);
  await query(`INSERT INTO photographer_profiles (staff_id, published, bio, location) VALUES (?, ?, ?, ?)
    ON CONFLICT (staff_id) DO UPDATE SET published = EXCLUDED.published, bio = EXCLUDED.bio, location = EXCLUDED.location`,
  [req.user.id, profile.published, profile.bio, profile.location]);
  res.json({ profile });
});

staffPortfolio.get('/', async (req, res) => {
  const rows = await query('SELECT id, category, file, created_at FROM portfolio_photos WHERE staff_id = ? ORDER BY created_at DESC', [req.user.id]).catch(() => null);
  const [profile] = await query('SELECT published, bio, location FROM photographer_profiles WHERE staff_id = ?', [req.user.id]);
  res.json({ profile: profile || profileDefaults, ready: githubReady(), tableReady: rows !== null, categories: CATEGORIES, photos: (rows || []).map(mapPhoto) });
});

staffPortfolio.post('/', upload.array('photos', MAX_FILES), async (req, res) => {
  if (!githubReady()) throw httpError(503, 'L’ajout de photos n’est pas disponible pour le moment.');
  const { category } = z.object({ category: z.enum(CATEGORIES) }).parse(req.body);
  const files = req.files || [];
  if (!files.length) throw httpError(400, 'Choisissez au moins une photo.');
  const added = [];
  for (const f of files) {
    const raw = isRawName(f.originalname);
    if (!raw && !/^image\//.test(f.mimetype)) throw httpError(400, `« ${f.originalname} » n’est pas une image.`);
    // RAW (NEF, CR2, ARW…) : on travaille sur le JPEG pleine taille que l’appareil a enregistré dedans.
    const source = raw ? (await rawJpeg(f.buffer))?.data : f.buffer;
    if (!source) throw httpError(400, `« ${f.originalname} » : aucune image lisible dans ce fichier RAW.`);
    // Réduction : 2048 px max, JPEG haute qualité (le dépôt et la bande passante restent raisonnables).
    const buf = await sharp(source).rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 86, mozjpeg: true, chromaSubsampling: '4:4:4' }).toBuffer();
    const id = crypto.randomUUID();
    const file = `${id}.jpg`;
    const sha = await putFile(file, buf, `Portfolio : ${category}`).catch((err) => { console.error('Portfolio :', err.message); throw httpError(502, 'Envoi impossible pour le moment. Réessayez dans un instant.'); });
    await query('INSERT INTO portfolio_photos (id, staff_id, category, file, sha) VALUES (?, ?, ?, ?, ?)', [id, req.user.id, category, file, sha]);
    added.push({ id, category, src: `/portfolio-media/${file}` });
  }
  audit(req, 'portfolio.add', { entity: 'portfolio', details: { category, count: added.length } });
  res.status(201).json({ photos: added });
});

staffPortfolio.delete('/:id', async (req, res) => {
  const [row] = await query('SELECT * FROM portfolio_photos WHERE id = ? AND staff_id = ?', [uuid.parse(req.params.id), req.user.id]);
  if (!row) throw httpError(404, 'Photo introuvable.');
  if (githubReady()) await deleteFile(row.file, row.sha).catch((err) => { console.error('Portfolio :', err.message); throw httpError(502, 'Suppression impossible pour le moment. Réessayez dans un instant.'); });
  await query('DELETE FROM portfolio_photos WHERE id = ?', [row.id]);
  audit(req, 'portfolio.delete', { entity: 'portfolio', entityId: row.id });
  res.status(204).end();
});

// ---------- Public ----------
export const publicPortfolio = Router();

// Photos ajoutées depuis le studio (le portfolio les affiche avec celles de kenleyelysee.com).
publicPortfolio.get('/portfolio', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!(await publicServices()).portfolio_enabled) return res.status(404).json({ error: 'Portfolio indisponible.' });
  const rows = await query(`SELECT photo.id, photo.category, photo.file, photo.created_at
    FROM portfolio_photos photo JOIN users u ON u.id = photo.staff_id
    LEFT JOIN photographer_profiles p ON p.staff_id = u.id
    WHERE u.active = 1 AND (u.role = 'owner' OR (u.role = 'admin' AND p.published = TRUE))
    ORDER BY photo.created_at DESC`);
  res.json({ photos: rows.map(mapPhoto) });
});

// Fichier d'une photo : lu sur GitHub une fois, puis gardé par Cloudflare et le navigateur (nom unique = jamais modifié).
const mediaLimiter = rateLimit({ windowMs: 60 * 1000, limit: 240, standardHeaders: 'draft-7', legacyHeaders: false });
const cache = new Map(); // petites photos gardées en mémoire (évite de rappeler GitHub)
const CACHE_MAX = 40;
export const portfolioMedia = [mediaLimiter, async (req, res) => {
  const file = req.params.file;
  if (!/^[0-9a-f-]{36}\.jpg$/.test(file) || !githubReady()) return res.status(404).end();
  // Seulement les photos enregistrées : un visiteur ne peut pas faire appeler GitHub avec des noms inventés.
  const [known] = await query(`SELECT 1 AS ok FROM portfolio_photos photo
    JOIN users u ON u.id = photo.staff_id
    LEFT JOIN photographer_profiles p ON p.staff_id = u.id
    WHERE photo.file = ? AND (u.id = ? OR (u.active = 1 AND
      (u.role = 'owner' OR (u.role = 'admin' AND p.published = TRUE))))`, [file, req.user?.id || null]);
  if (!known) return res.status(404).end();
  let buf = cache.get(file);
  if (!buf) {
    buf = await readFile(file);
    if (!buf) return res.status(404).end();
    cache.set(file, buf);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }
  res.set({ 'Content-Type': 'image/jpeg', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' }).send(buf);
}];

publicPortfolio.get('/photographers', async (req, res) => {
  const id = req.query.id === undefined ? null : uuid.parse(req.query.id);
  const [{ portfolio_enabled }, bookable, profiles] = await Promise.all([
    publicServices(), publicPhotographers(),
    query(`SELECT u.id, COALESCE(NULLIF(u.sender_name, ''), u.name) AS name, p.bio, p.location
      FROM photographer_profiles p JOIN users u ON u.id = p.staff_id
      WHERE p.published = TRUE AND u.active = 1 AND u.role IN ('owner', 'admin')
      AND (?::varchar IS NULL OR u.id = ?) ORDER BY name, u.id`, [id, id]),
  ]);
  if (id && !profiles.length) throw httpError(404, 'Profil introuvable.');
  const photos = portfolio_enabled && profiles.length ? await query(`SELECT * FROM (
    SELECT id, staff_id, category, file, created_at,
      row_number() OVER (PARTITION BY staff_id ORDER BY created_at DESC, id) AS position
    FROM portfolio_photos
    WHERE staff_id = ANY(?::varchar[])
  ) AS ranked WHERE position <= ? ORDER BY position`, [profiles.map(profile => profile.id), id ? 100 : 1]) : [];
  const photosByStaff = new Map();
  for (const photo of photos) {
    if (!photosByStaff.has(photo.staff_id)) photosByStaff.set(photo.staff_id, []);
    photosByStaff.get(photo.staff_id).push(mapPhoto(photo));
  }
  const eligible = new Set(bookable.map(person => person.id));
  res.set('Cache-Control', 'no-store').json({ photographers: profiles.map(profile => ({
    ...profile, bookable: eligible.has(profile.id), photos: photosByStaff.get(profile.id) || [],
  })) });
});
