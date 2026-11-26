import { mapSettings, nextPublicSlot } from '../lib/booking.js';
import { publicServices, publicPhotographers } from '../lib/public-services.js';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import multer from 'multer';
import sharp from 'sharp';
import { z } from 'zod';
import { query, transaction } from '../db.js';
import { httpError } from '../lib/errors.js';
import { uuid } from '../lib/data.js';
import { audit } from '../lib/audit.js';
import { config } from '../config.js';
import { githubReady, deleteFile, readFile as readLegacyPhoto } from '../lib/github.js';
import { isRemote, putFile, readFile, removeKeys } from '../lib/storage.js';
import { isRawName, rawJpeg } from '../lib/raw.js';

export const CATEGORIES = ['Studio', 'Outdoor', 'Événement', 'Graduation', 'Mariage'];
const MAX_FILES = 12;

// Photos en mémoire le temps de les réduire ; rien n'est écrit sur le disque du serveur.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: MAX_FILES, fields: 5 } });
const mapPhoto = (r) => ({ id: r.id, category: r.category, src: `/portfolio-media/${r.file}`, createdAt: r.created_at });

// ---------- Studio (propriétaire) ----------
export const staffPortfolio = Router();
const profileDefaults = { bio: '', location: '', phone: '', email: '', instagram: '', website: '', portfolioUrl: '' };
staffPortfolio.put('/profile', async (req, res) => {
  const profile = z.object({
    published: z.boolean().optional(),
    bio: z.string().trim().max(700),
    location: z.string().trim().max(100),
    phone: z.string().trim().max(40).regex(/^[+0-9 .()-]*$/).optional(),
    email: z.union([z.literal(''), z.string().email().max(190)]).optional(),
    instagram: z.string().trim().regex(/^@?[A-Za-z0-9._]{0,30}$/).transform(value => value.replace(/^@/, '')).optional(),
    website: z.string().trim().max(250).refine(value => value === '' || /^https?:\/\//i.test(value) && URL.canParse(value), 'Utilisez une adresse http ou https.').optional(),
    portfolioUrl: z.string().trim().max(250).refine(value => value === '' || /^https?:\/\//i.test(value) && URL.canParse(value), 'Utilisez une adresse http ou https.').optional(),
  }).strict().parse(req.body);
  const [saved] = await query(`INSERT INTO photographer_profiles
    (staff_id, bio, location, public_phone, public_email, instagram, website, portfolio_url)
    VALUES (?, ?, ?, COALESCE(?, ''), COALESCE(?, ''), COALESCE(?, ''), COALESCE(?, ''), COALESCE(?, ''))
    ON CONFLICT (staff_id) DO UPDATE SET bio = EXCLUDED.bio, location = EXCLUDED.location,
      public_phone = COALESCE(?, photographer_profiles.public_phone),
      public_email = COALESCE(?, photographer_profiles.public_email),
      instagram = COALESCE(?, photographer_profiles.instagram),
      website = COALESCE(?, photographer_profiles.website),
      portfolio_url = COALESCE(?, photographer_profiles.portfolio_url)
    RETURNING bio, location, public_phone AS phone, public_email AS email, instagram, website, portfolio_url AS "portfolioUrl"`,
  [req.user.id, profile.bio, profile.location, profile.phone ?? null, profile.email ?? null,
    profile.instagram ?? null, profile.website ?? null, profile.portfolioUrl ?? null, profile.phone ?? null, profile.email ?? null,
    profile.instagram ?? null, profile.website ?? null, profile.portfolioUrl ?? null]);
  res.json({ profile: saved });
});

staffPortfolio.get('/', async (req, res) => {
  const rows = await query('SELECT id, category, file, created_at FROM portfolio_photos WHERE staff_id = ? ORDER BY created_at DESC', [req.user.id]).catch(() => null);
  const [profile] = await query('SELECT bio, location, public_phone AS phone, public_email AS email, instagram, website, portfolio_url AS "portfolioUrl" FROM photographer_profiles WHERE staff_id = ?', [req.user.id]);
  const [staff] = await query('SELECT portfolio_photo_limit FROM users WHERE id = ?', [req.user.id]);
  res.json({ photoLimit: staff.portfolio_photo_limit, profile: profile || profileDefaults, ready: isRemote, tableReady: rows !== null, categories: CATEGORIES, photos: (rows || []).map(mapPhoto) });
});

staffPortfolio.post('/', upload.array('photos', MAX_FILES), async (req, res) => {
  if (!isRemote) throw httpError(503, 'Le stockage du portfolio n’est pas configuré.');
  const { category } = z.object({ category: z.enum(CATEGORIES) }).parse(req.body);
  const files = req.files || [];
  if (!files.length) throw httpError(400, 'Choisissez au moins une photo.');
  const added = [];
  const uploaded = [];
  try {
    await transaction(async (conn) => {
      const [[staff]] = await conn.execute('SELECT portfolio_photo_limit FROM users WHERE id = ? FOR UPDATE', [req.user.id]);
      const [[usage]] = await conn.execute('SELECT COUNT(*)::int AS count FROM portfolio_photos WHERE staff_id = ?', [req.user.id]);
      const remaining = Math.max(0, staff.portfolio_photo_limit - usage.count);
      if (files.length > remaining) throw httpError(409, `Limite du portfolio atteinte. Places restantes : ${remaining}.`);
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
        const key = `portfolios/${req.user.id}/${file}`;
        uploaded.push(key);
        await putFile(key, buf, 'image/jpeg').catch((err) => { console.error('Portfolio R2 :', err.name); throw httpError(502, 'Envoi impossible pour le moment. Réessayez dans un instant.'); });
        await conn.execute('INSERT INTO portfolio_photos (id, staff_id, category, file, storage_key) VALUES (?, ?, ?, ?, ?)', [id, req.user.id, category, file, key]);
        added.push({ id, category, src: `/portfolio-media/${file}` });
      }
    });
  } catch (error) {
    await removeKeys(uploaded);
    throw error;
  }
  audit(req, 'portfolio.add', { entity: 'portfolio', details: { category, count: added.length } });
  res.status(201).json({ photos: added });
});

staffPortfolio.delete('/:id', async (req, res) => {
  const [row] = await query('SELECT * FROM portfolio_photos WHERE id = ? AND staff_id = ?', [uuid.parse(req.params.id), req.user.id]);
  if (!row) throw httpError(404, 'Photo introuvable.');
  if (!row.storage_key && githubReady()) await deleteFile(row.file, row.sha).catch((err) => { console.error('Portfolio :', err.message); throw httpError(502, 'Suppression impossible pour le moment. Réessayez dans un instant.'); });
  await query('DELETE FROM portfolio_photos WHERE id = ?', [row.id]);
  if (row.storage_key) await removeKeys([row.storage_key]);
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
    CROSS JOIN site_public_services settings
    WHERE settings.id = 1 AND u.active = 1 AND (u.role = 'owner' OR (u.role = 'admin' AND settings.team_staff @> jsonb_build_array(u.id)))
    ORDER BY photo.created_at DESC`);
  res.json({ photos: rows.map(mapPhoto) });
});

// Photos R2 et anciens fichiers GitHub : vérifier la visibilité avant chaque réponse.
const mediaLimiter = rateLimit({ windowMs: 60 * 1000, limit: 240, standardHeaders: 'draft-7', legacyHeaders: false });
const cache = new Map(); // petites photos gardées en mémoire (évite de rappeler GitHub)
const CACHE_MAX = 40;
export const portfolioMedia = [mediaLimiter, async (req, res) => {
  const file = req.params.file;
  if (!/^[0-9a-f-]{36}\.jpg$/.test(file)) return res.status(404).end();
  // Seulement les photos enregistrées : un visiteur ne peut pas faire appeler GitHub avec des noms inventés.
  const [known] = await query(`SELECT photo.storage_key FROM portfolio_photos photo
    JOIN users u ON u.id = photo.staff_id
    CROSS JOIN site_public_services settings
    WHERE settings.id = 1 AND photo.file = ? AND (u.id = ? OR (u.active = 1 AND
      (u.role = 'owner' OR (u.role = 'admin' AND settings.team_staff @> jsonb_build_array(u.id)))))`, [file, req.user?.id || null]);
  if (!known) return res.status(404).end();
  let buf = cache.get(file);
  if (!buf) {
    if (known.storage_key && !isRemote) return res.status(404).end();
    if (!known.storage_key && !githubReady()) return res.status(404).end();
    try {
      buf = known.storage_key ? await readFile(known.storage_key) : await readLegacyPhoto(file);
    } catch (error) {
      if (error.$metadata?.httpStatusCode === 404 || error.name === 'NoSuchKey') return res.status(404).end();
      throw error;
    }
    if (!buf) return res.status(404).end();
    cache.set(file, buf);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }
  res.set({ 'Content-Type': 'image/jpeg', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' }).send(buf);
}];

publicPortfolio.get('/photographers/:id/logo', mediaLimiter, async (req, res) => {
  const [row] = await query(`SELECT p.logo_key FROM users u JOIN photographer_profiles p ON p.staff_id = u.id CROSS JOIN site_public_services settings
    WHERE settings.id = 1 AND u.id = ? AND u.active = 1 AND u.role IN ('owner', 'admin')
      AND settings.team_staff @> jsonb_build_array(u.id)`, [uuid.parse(req.params.id)]);
  if (!row?.logo_key?.startsWith('photographer-logos/')) return res.status(404).end();
  let image;
  try { image = await readFile(row.logo_key); }
  catch (error) {
    if (error.code === 'ENOENT' || error.$metadata?.httpStatusCode === 404) return res.status(404).end();
    throw error;
  }
  res.set('Cache-Control', 'private, no-store').type('image/png').send(image);
});

publicPortfolio.get('/photographers', async (req, res) => {
  const id = req.query.id === undefined ? null : uuid.parse(req.query.id);
  const [{ portfolio_enabled }, bookable, profiles] = await Promise.all([
    publicServices(), publicPhotographers(),
    query(`SELECT u.id, COALESCE(NULLIF(BTRIM(u.sender_name), ''), u.name) AS name, u.name AS full_name, COALESCE(p.bio, '') AS bio, COALESCE(p.location, '') AS location,
      p.public_phone AS phone, p.public_email AS email, p.instagram, p.website, p.portfolio_url, p.logo_key, row_to_json(booking) AS booking_settings
      FROM users u LEFT JOIN photographer_profiles p ON p.staff_id = u.id
      LEFT JOIN booking_settings booking ON booking.staff_id = u.id
      CROSS JOIN site_public_services settings
      WHERE settings.id = 1 AND settings.team_staff @> jsonb_build_array(u.id)
      AND u.active = 1 AND u.role IN ('owner', 'admin')
      AND (?::varchar IS NULL OR u.id = ?) ORDER BY name, u.id`, [id, id]),
  ]);
  if (id && !profiles.length) throw httpError(404, 'Profil introuvable.');
  const photos = portfolio_enabled && profiles.length ? await query(`SELECT * FROM (
    SELECT id, staff_id, category, file, created_at,
      row_number() OVER (PARTITION BY staff_id ORDER BY created_at DESC, id) AS position
    FROM portfolio_photos
    WHERE staff_id = ANY(?::varchar[])
  ) AS ranked WHERE (?::boolean OR position = 1) ORDER BY position`, [profiles.map(profile => profile.id), !!id]) : [];
  const photosByStaff = new Map();
  for (const photo of photos) {
    if (!photosByStaff.has(photo.staff_id)) photosByStaff.set(photo.staff_id, []);
    photosByStaff.get(photo.staff_id).push(mapPhoto(photo));
  }
  const eligible = new Set(bookable.map(person => person.id));
  const photographers = await Promise.all(profiles.map(async profile => {
    const bookable = eligible.has(profile.id);
    const settings = mapSettings(profile.booking_settings);
    const photos = photosByStaff.get(profile.id) || [];
    return {
      id: profile.id, name: profile.name, bio: profile.bio, location: profile.location,
      specialties: [...new Set(profile.booking_settings ? settings.sessionTypes : photos.map(photo => photo.category))],
      nextSlot: !id && bookable ? await nextPublicSlot(profile.id, settings).catch(error => {
        console.error('Disponibilités publiques :', error.message);
        return null;
      }) : null,
      logo: profile.logo_key ? `/api/public/photographers/${profile.id}/logo` : null,
      ...(id ? { fullName: profile.full_name, phone: profile.phone, email: profile.email, instagram: profile.instagram, website: profile.website, portfolioUrl: profile.portfolio_url } : {}),
      bookable, photos,
    };
  }));
  res.set('Cache-Control', 'no-store').json({ photographers });
});
