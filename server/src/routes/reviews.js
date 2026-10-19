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
import { settingsOf, slotConflict, studioToday } from '../lib/booking.js';

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
  name: oneLine(80).min(2, 'Entrez votre nom.'),
  email: z.union([z.literal(''), z.string().trim().toLowerCase().email('E-mail invalide.').max(190)]).optional().default(''), // facultatif
  phone: oneLine(40).refine((v) => v.replace(/\D/g, '').length >= 6, 'Entrez votre numéro de téléphone.'), // obligatoire
  sessionType: oneLine(80).optional().default(''),
  location: oneLine(120).optional().default(''), // lieu de la séance : obligatoire sauf portrait / studio
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

publicApi.post('/inquiry', inquiryLimiter, async (req, res) => {
  const d = inquiry.parse(req.body);
  if (d.website) return res.status(201).json({ ok: true }); // robot : on fait semblant
  const o = await owner();
  if (!o) throw httpError(503, 'Studio indisponible.');
  if (!d.sessionType) throw httpError(400, 'Choisissez le type de séance.');
  if (!/portrait|studio|anniv|birthday/i.test(d.sessionType) && d.location.length < 2) throw httpError(400, 'Indiquez le lieu de la séance.');
  if (d.date) {
    const today = studioToday();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date) || d.date < today) throw httpError(400, 'Choisissez une date à venir.');
    if (!d.time) throw httpError(400, 'Choisissez aussi une heure.');
    const c = await slotConflict(o.id, d.date, d.time);
    if (c) return res.status(409).json({ error: 'Cette date et cette heure sont déjà prises. Choisissez un autre moment.', ...c });
  }
  try {
    await query(
      'INSERT INTO portfolio_requests (id, staff_id, name, email, phone, session_type, location, wished_date, wished_time, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [crypto.randomUUID(), o.id, d.name, d.email, d.phone, d.sessionType, d.location, d.date, d.time, d.message],
    );
  } catch (err) { console.error('Demande portfolio non enregistrée (migration 039 appliquée ?) :', err.message); }
  pushLater(o.id, { title: 'Nouvelle demande de séance', body: `${d.name}${d.sessionType ? ` · ${d.sessionType}` : ''}`, url: '/admin', tag: `inquiry-${Date.now()}` });
  sendMail({ to: o.email, userId: o.id, kind: 'inquiry', replyTo: d.email || undefined, ...inquiryEmail({ staffName: o.name, ...d }) })
    .catch((err) => console.error('E-mail demande portfolio :', err.message));
  res.status(201).json({ ok: true });
});
