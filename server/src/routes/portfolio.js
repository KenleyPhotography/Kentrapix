import { Router } from 'express';
import crypto from 'node:crypto';
import multer from 'multer';
import sharp from 'sharp';
import { z } from 'zod';
import { query } from '../db.js';
import { httpError } from '../lib/errors.js';
import { uuid } from '../lib/data.js';
import { audit } from '../lib/audit.js';
import { requireOwner } from '../middleware/auth.js';
import { githubReady, putFile, deleteFile, readFile } from '../lib/github.js';

export const CATEGORIES = ['Studio', 'Outdoor', 'Événement', 'Graduation', 'Mariage'];
const MAX_FILES = 12;

// Photos en mémoire le temps de les réduire ; rien n'est écrit sur le disque du serveur.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: MAX_FILES } });
const mapPhoto = (r) => ({ id: r.id, category: r.category, src: `/portfolio-media/${r.file}`, createdAt: r.created_at });

// ---------- Studio (propriétaire) ----------
export const staffPortfolio = Router();
staffPortfolio.use(requireOwner);

staffPortfolio.get('/', async (req, res) => {
  const rows = await query('SELECT id, category, file, created_at FROM portfolio_photos WHERE staff_id = ? ORDER BY created_at DESC', [req.user.id]).catch(() => null);
  res.json({ ready: githubReady(), tableReady: rows !== null, categories: CATEGORIES, photos: (rows || []).map(mapPhoto) });
});

staffPortfolio.post('/', upload.array('photos', MAX_FILES), async (req, res) => {
  if (!githubReady()) throw httpError(503, 'GitHub n’est pas configuré (variable GITHUB_TOKEN manquante sur le serveur).');
  const { category } = z.object({ category: z.enum(CATEGORIES) }).parse(req.body);
  const files = req.files || [];
  if (!files.length) throw httpError(400, 'Choisissez au moins une photo.');
  const added = [];
  for (const f of files) {
    if (!/^image\//.test(f.mimetype)) throw httpError(400, `« ${f.originalname} » n’est pas une image.`);
    // Réduction : 1600 px max, JPEG léger (le dépôt et la bande passante restent petits).
    const buf = await sharp(f.buffer).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
    const id = crypto.randomUUID();
    const file = `${id}.jpg`;
    const sha = await putFile(file, buf, `Portfolio : ${category}`);
    await query('INSERT INTO portfolio_photos (id, staff_id, category, file, sha) VALUES (?, ?, ?, ?, ?)', [id, req.user.id, category, file, sha]);
    added.push({ id, category, src: `/portfolio-media/${file}` });
  }
  audit(req, 'portfolio.add', { entity: 'portfolio', details: { category, count: added.length } });
  res.status(201).json({ photos: added });
});

staffPortfolio.delete('/:id', async (req, res) => {
  const [row] = await query('SELECT * FROM portfolio_photos WHERE id = ? AND staff_id = ?', [uuid.parse(req.params.id), req.user.id]);
  if (!row) throw httpError(404, 'Photo introuvable.');
  if (githubReady()) await deleteFile(row.file, row.sha);
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
export const portfolioMedia = async (req, res) => {
  const file = req.params.file;
  if (!/^[0-9a-f-]{36}\.jpg$/.test(file) || !githubReady()) return res.status(404).end();
  const buf = await readFile(file);
  if (!buf) return res.status(404).end();
  res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' }).send(buf);
};
