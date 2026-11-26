import multer from 'multer';
import sharp from 'sharp';
import { isRemote, putFile, removeKeys } from '../lib/storage.js';
import { publicServices, publicPhotographers } from '../lib/public-services.js';
import { monthSlots } from '../lib/booking.js';
import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { query } from '../db.js';
import { httpError } from '../lib/errors.js';
import { uuid, CLIENT_HAS, NOT_EXPIRED } from '../lib/data.js';
import rateLimit from 'express-rate-limit';
import { pushLater } from '../lib/push.js';
import { sendMail } from '../lib/mailer.js';
import { inquiryEmail } from '../lib/emails.js';
import { needsPlace, settingsOf, slotConflict, studioToday } from '../lib/booking.js';

// Avis des clients après livraison : 1 à 5 étoiles + commentaire, un par galerie (modifiable).
// Le photographe décide de montrer ou non un avis sur la page de connexion.

const iso = (v) => (v ? `${String(v).replace(' ', 'T').replace(/Z$/, '')}Z` : null);
const reviewBody = z.object({
  eventId: uuid,
  rating: z.number().int().min(1, 'Choisissez une note de 1 à 5.').max(5, 'Choisissez une note de 1 à 5.'),
  comment: z.string().trim().max(800, 'Commentaire trop long (800 caractères max).').optional().default(''),
});

// ---------- Espace client ----------
export const clientReviews = Router();

clientReviews.get('/', async (req, res) => {
  const events = await query(
    `SELECT e.id, e.name, e.event_date, COALESCE(s.sender_name, s.name) AS studio,
            r.rating, r.comment, r.updated_at
     FROM events e LEFT JOIN users s ON s.id = e.created_by
     LEFT JOIN reviews r ON r.event_id = e.id AND r.client_id = ?
     WHERE ${CLIENT_HAS()} AND e.published = 1 AND e.archived = 0 AND ${NOT_EXPIRED}
     ORDER BY e.event_date DESC NULLS LAST, e.created_at DESC`,
    [req.user.id, req.user.id],
  );
  res.json({
    events: events.map((e) => ({
      id: e.id, name: e.name, date: e.event_date ? String(e.event_date).slice(0, 10) : null, studio: e.studio || '',
      review: e.rating ? { rating: Number(e.rating), comment: e.comment || '', at: iso(e.updated_at) } : null,
    })),
  });
});

clientReviews.put('/', async (req, res) => {
  const data = reviewBody.parse(req.body);
  const [event] = await query(
    `SELECT e.id, e.name, COALESCE(e.created_by, (SELECT id FROM users WHERE role = 'owner' ORDER BY created_at LIMIT 1)) AS staff_id
     FROM events e WHERE e.id = ? AND ${CLIENT_HAS()} AND e.published = 1 AND e.archived = 0`,
    [data.eventId, req.user.id],
  );
  if (!event?.staff_id) throw httpError(404, 'Galerie introuvable.');
  // Un avis modifié repasse en attente d'approbation (le texte a pu changer).
  await query(
    `INSERT INTO reviews (id, staff_id, client_id, event_id, rating, comment) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (client_id, event_id) DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, is_public = 0, updated_at = CURRENT_TIMESTAMP`,
    [crypto.randomUUID(), event.staff_id, req.user.id, event.id, data.rating, data.comment || null],
  );
  pushLater(event.staff_id, { title: `Nouvel avis · ${'★'.repeat(data.rating)}`, body: `${req.user.name} · ${event.name}`, url: '/admin', tag: `review-${event.id}` });
  res.json({ review: { rating: data.rating, comment: data.comment } });
});

// ---------- Studio ----------
export const staffReviews = Router();

staffReviews.get('/', async (req, res) => {
  const rows = await query(
    `SELECT r.*, u.name AS client_name, e.name AS event_name FROM reviews r
     JOIN users u ON u.id = r.client_id JOIN events e ON e.id = r.event_id
     WHERE r.staff_id = ? ORDER BY r.updated_at DESC`,
    [req.user.id],
  );
  res.json({
    reviews: rows.map((r) => ({
      id: r.id, client: r.client_name, event: r.event_name, rating: Number(r.rating), comment: r.comment || '', public: !!r.is_public, at: iso(r.updated_at),
    })),
  });
});

staffReviews.patch('/:id', async (req, res) => {
  const { public: isPublic } = z.object({ public: z.boolean() }).parse(req.body);
  const done = await query('UPDATE reviews SET is_public = ? WHERE id = ? AND staff_id = ?', [isPublic ? 1 : 0, uuid.parse(req.params.id), req.user.id]);
  if (!done.affectedRows) throw httpError(404, 'Avis introuvable.');
  res.json({ ok: true });
});

staffReviews.delete('/:id', async (req, res) => {
  const done = await query('DELETE FROM reviews WHERE id = ? AND staff_id = ?', [uuid.parse(req.params.id), req.user.id]);
  if (!done.affectedRows) throw httpError(404, 'Avis introuvable.');
  res.status(204).end();
});

// ---------- Page de connexion : avis approuvés (prénom + initiale seulement) ----------
export const publicApi = Router();

publicApi.get('/reviews', async (req, res) => {
  const rows = await query(
    `SELECT r.rating, r.comment, u.name AS client_name, COALESCE(s.sender_name, s.name) AS studio
     FROM reviews r JOIN users u ON u.id = r.client_id JOIN users s ON s.id = r.staff_id
     WHERE r.is_public = 1 AND r.comment IS NOT NULL AND r.comment <> '' AND r.rating >= 4
     ORDER BY r.updated_at DESC LIMIT 6`,
  );
  const short = (n) => { const [a, b] = String(n || '').trim().split(/\s+/); return b ? `${a} ${b[0].toUpperCase()}.` : a || 'Client'; };
  res.set('Cache-Control', 'public, max-age=300').json({
    reviews: rows.map((r) => ({ rating: Number(r.rating), comment: r.comment, name: short(r.client_name), studio: r.studio })),
  });
});

// ---------- Portfolio public : infos du studio + demande de séance (sans compte) ----------
const owner = async () => (await query("SELECT id, name, sender_name, email FROM users WHERE role = 'owner' ORDER BY created_at LIMIT 1"))[0];

publicApi.get('/studio', async (req, res) => {
  const o = await owner();
  if (!o) throw httpError(404, 'Studio introuvable.');
  const settings = await settingsOf(o.id);
  res.set('Cache-Control', 'public, max-age=300').json({ name: o.sender_name || o.name, sessionTypes: settings.sessionTypes });
});

publicApi.get('/public-services', async (_req, res) => {
  const [{ portfolio_enabled }, staff] = await Promise.all([publicServices(), publicPhotographers()]);
  res.set('Cache-Control', 'no-store').json({
    portfolioEnabled: portfolio_enabled,
    photographers: staff.map(({ id, name, sender_name }) => ({ id, name: sender_name || name })),
  });
});

async function bookingPhotographer(id) {
  const staff = await publicPhotographers();
  const person = id ? staff.find((member) => member.id === id) : staff[0];
  if (!person) throw httpError(400, 'Ce photographe ne reçoit pas de réservations.');
  return person;
}

publicApi.get('/reservation/:id', async (req, res) => {
  const person = await bookingPhotographer(z.string().uuid().parse(req.params.id));
  const { month } = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).parse(req.query);
  const { settings, days } = await monthSlots(person.id, month, { includePublic: true });
  res.set('Cache-Control', 'no-store').json({ days, sessionTypes: settings.sessionTypes });
});

const inquiryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Trop de demandes. Réessayez plus tard ou écrivez-nous sur WhatsApp.' },
});
// Pas de retours à la ligne ni de caractères de contrôle dans les champs courts (objet d'e-mail, journaux).
const oneLine = (max) => z.string().trim().max(max).regex(/^[^\u0000-\u001f\u007f]*$/, 'Caractères non valides.');
const inquiry = z.object({
  staffId: z.string().uuid().optional(),
  manual: z.boolean().optional().default(false),
  name: oneLine(80).min(2, 'Entrez votre nom.'),
  email: z.union([z.literal(''), z.string().trim().toLowerCase().email('E-mail invalide.').max(190)]).optional().default(''), // facultatif
  phone: oneLine(40).refine((v) => v.replace(/\D/g, '').length >= 6, 'Entrez votre numéro de téléphone.'), // obligatoire
  sessionType: oneLine(80).optional().default(''),
  location: oneLine(120).optional().default(''), // lieu de la séance : obligatoire sauf portrait / shoot studio
  date: oneLine(40).optional().default(''),
  time: z.union([z.literal(''), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure invalide.')]).optional().default(''),
  message: z.string().trim().max(1000).optional().default(''),
  website: z.string().max(200).optional().default(''), // piège anti-robots : doit rester vide
});

// Cette date et cette heure sont-elles libres ? Le formulaire du portfolio le demande avant l'envoi et propose d'autres choix.
publicApi.get('/slot-check', async (req, res) => {
  const { date, time } = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }).parse(req.query);
  const o = await owner();
  if (!o) throw httpError(404, 'Studio introuvable.');
  const today = studioToday();
  if (date < today) return res.json({ ok: false, error: 'Choisissez une date à venir.', times: [], dates: [], today });
  const c = await slotConflict(o.id, date, time);
  res.set('Cache-Control', 'no-store').json(c ? { ok: false, error: 'Cette date et cette heure sont déjà prises. Choisissez un autre moment.', ...c, today } : { ok: true, today });
});

async function applicationPayment() {
  const [row] = await query('SELECT booking_payment FROM site_public_services WHERE id = 1');
  const { applicationAmount, moncash, natcash } = row.booking_payment;
  return applicationAmount && (moncash || natcash) ? { amount: applicationAmount, moncash, natcash } : null;
}

publicApi.get('/photographer-applications/payment', async (_req, res) => {
  res.set('Cache-Control', 'no-store').json({ payment: await applicationPayment() });
});

const applicationLogo = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 1, fields: 8 } }).single('logo');

async function validateLogo(file) {
  const message = 'Ajoutez un logo PNG transparent et non entièrement blanc.';
  if (!file) throw httpError(400, message);
  try {
    const source = sharp(file.buffer, { limitInputPixels: 16_000_000 });
    const info = await source.metadata();
    if (info.format !== 'png' || !info.hasAlpha) throw new Error();
    const logo = await source.resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    const pixels = await sharp(logo).ensureAlpha().toColourspace('srgb').raw().toBuffer();
    let transparent = false, colored = false;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] === 0) transparent = true;
      if (pixels[i + 3] >= 32 && Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) < 245) colored = true;
    }
    if (!transparent || !colored) throw new Error();
    return logo;
  } catch { throw httpError(400, message); }
}

publicApi.post('/photographer-applications', inquiryLimiter, applicationLogo, async (req, res) => {
  const data = z.object({
    name: oneLine(80).min(2),
    email: z.string().trim().email().max(190),
    phone: oneLine(40).refine(value => value.replace(/\D/g, '').length >= 6),
    message: z.string().trim().max(1000),
    website: z.string().max(200).optional(),
    method: z.enum(['moncash', 'natcash']).optional(),
    transferCode: z.string().trim().regex(/^[A-Za-z0-9-]{3,60}$/).optional(),
  }).parse(req.body);
  if (!data.website) {
    const payment = await applicationPayment();
    if (payment && (!data.method || !payment[data.method] || !data.transferCode)) {
      throw httpError(400, 'Choisissez le service de paiement et indiquez le TransCode.');
    }
    if (!isRemote) throw httpError(503, 'Le stockage des logos est indisponible.');
    const logo = await validateLogo(req.file);
    const id = crypto.randomUUID();
    const logoKey = `photographer-logos/${id}.png`;
    await putFile(logoKey, logo, 'image/png');
    try {
      const [saved] = await query(`INSERT INTO photographer_applications
        (id, name, email, phone, message, payment_method, transfer_code, payment_amount, logo_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING id`,
      [id, data.name, data.email, data.phone, data.message,
        payment ? data.method : null, payment ? data.transferCode : null, payment?.amount ?? null, logoKey]);
      if (!saved) throw httpError(409, 'Ce TransCode a déjà été utilisé.');
    } catch (error) {
      await removeKeys([logoKey]);
      throw error;
    }
  }
  res.status(201).json({ ok: true });
});

publicApi.post('/inquiry', inquiryLimiter, async (req, res) => {
  const d = inquiry.parse(req.body);
  if (d.website) return res.status(201).json({ ok: true }); // robot : on fait semblant
  const o = await bookingPhotographer(d.staffId);
  if (d.staffId && (!d.date || !d.time)) throw httpError(400, 'Choisissez une date et une heure disponibles.');
  if (d.staffId) {
    const date = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/).parse(d.date);
    const { days, settings } = await monthSlots(o.id, date.slice(0, 7), { includePublic: true });
    if (!d.manual && !days[date]?.includes(d.time)) throw httpError(409, 'Ce créneau n’est plus disponible.');
    if (!settings.sessionTypes.includes(d.sessionType)) throw httpError(400, 'Choisissez un type de séance proposé par ce photographe.');
  }
  if (!d.sessionType) throw httpError(400, 'Choisissez le type de séance.');
  if (needsPlace(d.sessionType) && d.location.length < 2) throw httpError(400, 'Indiquez le lieu de la séance.');
  if (d.date) {
    const today = studioToday();
    const parsed = new Date(d.date + 'T12:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date) || !Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== d.date || d.date < today) throw httpError(400, 'Choisissez une date à venir.');
    if (!d.time) throw httpError(400, 'Choisissez aussi une heure.');
    const c = await slotConflict(o.id, d.date, d.time);
    if (c) return res.status(409).json({ error: 'Cette date et cette heure sont déjà prises. Choisissez un autre moment.', ...c });
  }
  const [settings] = await query('SELECT booking_payment FROM site_public_services WHERE id = 1');
  const methods = settings.booking_payment;
  const payment = methods.amount && (methods.moncash || methods.natcash)
    ? { ...methods, code: 'KP-' + crypto.randomBytes(8).toString('hex').toUpperCase() }
    : null;
  await query(
    'INSERT INTO portfolio_requests (id, staff_id, name, email, phone, session_type, location, wished_date, wished_time, message, payment_code, payment_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [crypto.randomUUID(), o.id, d.name, d.email, d.phone, d.sessionType, d.location, d.date, d.time, d.message, payment?.code ?? null, payment?.amount ?? null],
  );
  pushLater(o.id, { title: 'Nouvelle demande de séance', body: `${d.name}${d.sessionType ? ` · ${d.sessionType}` : ''}`, url: '/admin', tag: `inquiry-${Date.now()}` });
  sendMail({ to: o.email, userId: o.id, kind: 'inquiry', replyTo: d.email || undefined, ...inquiryEmail({ staffName: o.name, ...d }) })
    .catch((err) => console.error('E-mail demande portfolio :', err.message));
  res.set('Cache-Control', 'no-store').status(201).json({ ok: true, payment });
});
