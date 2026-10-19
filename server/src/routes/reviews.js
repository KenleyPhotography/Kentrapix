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
import { settingsOf, takenDays, nextFreeDays, studioToday, addDays } from '../lib/booking.js';

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
const inquiry = z.object({
  name: z.string().trim().min(2, 'Entrez votre nom.').max(80),
  email: z.union([z.literal(''), z.string().trim().toLowerCase().email('E-mail invalide.').max(190)]).optional().default(''), // facultatif
  phone: z.string().trim().max(40).refine((v) => v.replace(/\D/g, '').length >= 6, 'Entrez votre numéro de téléphone.'), // obligatoire
  sessionType: z.string().trim().max(80).optional().default(''),
  date: z.string().trim().max(40).optional().default(''),
  message: z.string().trim().max(1000).optional().default(''),
  website: z.string().max(200).optional().default(''), // piège anti-robots : doit rester vide
});

// Jours déjà pris dans les 6 prochains mois : le formulaire du portfolio les refuse et propose les prochaines dates libres.
publicApi.get('/taken-days', async (req, res) => {
  const o = await owner();
  if (!o) throw httpError(404, 'Studio introuvable.');
  const today = studioToday();
  const taken = await takenDays(o.id, today, addDays(today, 183));
  res.set('Cache-Control', 'no-store').json({ today, taken: [...taken].sort(), next: nextFreeDays(taken, today, 3) });
});

publicApi.post('/inquiry', inquiryLimiter, async (req, res) => {
  const d = inquiry.parse(req.body);
  if (d.website) return res.status(201).json({ ok: true }); // robot : on fait semblant
  const o = await owner();
  if (!o) throw httpError(503, 'Studio indisponible.');
  if (d.date) {
    const today = studioToday();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date) || d.date < today) throw httpError(400, 'Choisissez une date à venir.');
    const taken = await takenDays(o.id, d.date, d.date);
    if (taken.has(d.date)) {
      const all = await takenDays(o.id, d.date, addDays(d.date, 120));
      return res.status(409).json({ error: 'Cette date est déjà réservée. Choisissez une autre date.', suggestions: nextFreeDays(all, addDays(d.date, 1), 3) });
    }
  }
  try {
    await query(
      'INSERT INTO portfolio_requests (id, staff_id, name, email, phone, session_type, wished_date, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [crypto.randomUUID(), o.id, d.name, d.email, d.phone, d.sessionType, d.date, d.message],
    );
  } catch (err) { console.error('Demande portfolio non enregistrée (migration 039 appliquée ?) :', err.message); }
  pushLater(o.id, { title: 'Nouvelle demande de séance', body: `${d.name}${d.sessionType ? ` · ${d.sessionType}` : ''}`, url: '/admin', tag: `inquiry-${Date.now()}` });
  sendMail({ to: o.email, userId: o.id, kind: 'inquiry', replyTo: d.email || undefined, ...inquiryEmail({ staffName: o.name, ...d }) })
    .catch((err) => console.error('E-mail demande portfolio :', err.message));
  res.status(201).json({ ok: true });
});
