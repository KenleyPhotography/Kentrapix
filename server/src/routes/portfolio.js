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
import { requireOwner } from '../middleware/auth.js';
import { githubReady, putFile, deleteFile, readFile } from '../lib/github.js';
import { isRawName, rawJpeg } from '../lib/raw.js';

export const CATEGORIES = ['Studio', 'Outdoor', 'Événement', 'Graduation', 'Mariage'];
const MAX_FILES = 12;

// Photos en mémoire le temps de les réduire ; rien n'est écrit sur le disque du serveur.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: MAX_FILES, fields: 5 } });
const mapPhoto = (r) => ({ id: r.id, category: r.category, src: `/portfolio-media/${r.file}`, createdAt: r.created_at });

// ---------- Studio (propriétaire) ----------
export const staffPortfolio = Router();
staffPortfolio.use(requireOwner);

staffPortfolio.get('/', async (req, res) => {
  const rows = await query('SELECT id, category, file, created_at FROM portfolio_photos WHERE staff_id = ? ORDER BY created_at DESC', [req.user.id]).catch(() => null);
  res.json({ ready: githubReady(), tableReady: rows !== null, categories: CATEGORIES, photos: (rows || []).map(mapPhoto) });
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
  const rows = await query('SELECT id, category, file, created_at FROM portfolio_photos ORDER BY created_at DESC').catch(() => []);
  res.set('Cache-Control', 'public, max-age=60').json({ photos: rows.map(mapPhoto) });
});

// Fichier d'une photo : lu sur GitHub une fois, puis gardé par Cloudflare et le navigateur (nom unique = jamais modifié).
const mediaLimiter = rateLimit({ windowMs: 60 * 1000, limit: 240, standardHeaders: 'draft-7', legacyHeaders: false });
const cache = new Map(); // petites photos gardées en mémoire (évite de rappeler GitHub)
const CACHE_MAX = 40;
export const portfolioMedia = [mediaLimiter, async (req, res) => {
  const file = req.params.file;
  if (!/^[0-9a-f-]{36}\.jpg$/.test(file) || !githubReady()) return res.status(404).end();
  // Seulement les photos enregistrées : un visiteur ne peut pas faire appeler GitHub avec des noms inventés.
  const [known] = await query('SELECT 1 AS ok FROM portfolio_photos WHERE file = ?', [file]);
  if (!known) return res.status(404).end();
  let buf = cache.get(file);
  if (!buf) {
    buf = await readFile(file);
    if (!buf) return res.status(404).end();
    cache.set(file, buf);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }
  res.set({ 'Content-Type': 'image/jpeg', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=31536000, immutable' }).send(buf);
}];
