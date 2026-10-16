import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { query } from '../db.js';
import { httpError } from '../lib/errors.js';
import { uuid, CLIENT_HAS, NOT_EXPIRED } from '../lib/data.js';
import { pushLater } from '../lib/push.js';

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
