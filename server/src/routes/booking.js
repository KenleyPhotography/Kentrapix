import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { query } from '../db.js';
import { httpError } from '../lib/errors.js';
import { uuid } from '../lib/data.js';
import { audit } from '../lib/audit.js';
import { sendMail } from '../lib/mailer.js';
import { accountScope } from '../lib/scope.js';
import { bookingRequestEmail, bookingStatusEmail } from '../lib/emails.js';
import {
  settingsOf, mapSettings, monthSlots, slotsForDay, mapBooking, BOOKING_SELECT, studioToday, addDays, minutesOf, hhmm,
} from '../lib/booking.js';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide.');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure invalide.');
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mois invalide.');
const studioName = (u) => u.sender_name || u.name;
const fire = (promise) => promise.catch((err) => console.error('E-mail rendez-vous :', err.message));

// ====================================================================================================
//  Photographe : réglages, jours bloqués, demandes (monté dans le routeur du studio)
// ====================================================================================================
export const staffBooking = Router();

const settingsSchema = z.object({
  enabled: z.boolean(),
  days: z.array(z.number().int().min(0).max(6)).max(7),
  start: time,
  end: time,
  durationMin: z.number().int().min(15).max(720),
  minNoticeDays: z.number().int().min(0).max(60),
  horizonDays: z.number().int().min(1).max(365),
  autoConfirm: z.boolean(),
  sessionTypes: z.array(z.string().trim().min(1).max(40)).min(1).max(12),
});

staffBooking.get('/', async (req, res) => {
  const today = studioToday();
  const [settings, blocked, rows] = await Promise.all([
    settingsOf(req.user.id),
    query('SELECT day FROM booking_blocked_days WHERE staff_id = ? AND day >= ? ORDER BY day', [req.user.id, today]),
    query(`${BOOKING_SELECT} WHERE b.staff_id = ? AND b.day >= ? ORDER BY b.day, b.start_time`, [req.user.id, addDays(today, -30)]),
  ]);
  res.json({ today, settings, blocked: blocked.map((b) => String(b.day).slice(0, 10)), bookings: rows.map(mapBooking) });
});

staffBooking.put('/settings', async (req, res) => {
  const s = settingsSchema.parse(req.body);
  if (minutesOf(s.end) - minutesOf(s.start) < s.durationMin) throw httpError(400, 'L’heure de fin doit laisser au moins une séance.');
  await query(
    `INSERT INTO booking_settings (staff_id, enabled, days, start_time, end_time, duration_min, min_notice_days, horizon_days, auto_confirm, session_types, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT (staff_id) DO UPDATE SET enabled = EXCLUDED.enabled, days = EXCLUDED.days, start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time,
       duration_min = EXCLUDED.duration_min, min_notice_days = EXCLUDED.min_notice_days, horizon_days = EXCLUDED.horizon_days,
       auto_confirm = EXCLUDED.auto_confirm, session_types = EXCLUDED.session_types, updated_at = EXCLUDED.updated_at`,
    [req.user.id, s.enabled ? 1 : 0, [...new Set(s.days)].sort().join(','), s.start, s.end, s.durationMin, s.minNoticeDays, s.horizonDays, s.autoConfirm ? 1 : 0, s.sessionTypes.join(',')],
  );
  res.json({ settings: await settingsOf(req.user.id) });
});

staffBooking.post('/blocked', async (req, res) => {
  const { day: d } = z.object({ day }).parse(req.body);
  await query('INSERT INTO booking_blocked_days (staff_id, day) VALUES (?, ?) ON CONFLICT DO NOTHING', [req.user.id, d]);
  res.status(201).json({ day: d });
});

staffBooking.delete('/blocked/:day', async (req, res) => {
  await query('DELETE FROM booking_blocked_days WHERE staff_id = ? AND day = ?', [req.user.id, day.parse(req.params.day)]);
  res.status(204).end();
});

async function loadOwn(req, id) {
  const [row] = await query(`${BOOKING_SELECT} WHERE b.id = ? AND b.staff_id = ?`, [uuid.parse(id), req.user.id]);
  if (!row) throw httpError(404, 'Rendez-vous introuvable.');
  return row;
}

// Confirmer, refuser ou annuler : le client est prévenu par e-mail.
staffBooking.patch('/bookings/:id', async (req, res) => {
  const { status, reply } = z.object({
    status: z.enum(['confirmed', 'declined', 'cancelled']),
    reply: z.string().trim().max(500).optional().default(''),
  }).parse(req.body);
  const row = await loadOwn(req, req.params.id);
  if (['declined', 'cancelled'].includes(row.status)) throw httpError(400, 'Ce rendez-vous est déjà clos.');
  if (status === 'confirmed' && row.status === 'confirmed') throw httpError(400, 'Ce rendez-vous est déjà confirmé.');
  await query('UPDATE bookings SET status = ?, reply = ? WHERE id = ?', [status, reply || null, row.id]);
  const booking = mapBooking({ ...row, status, reply });
  if (row.client_email) {
    fire(sendMail({
      to: row.client_email, userId: row.client_id, sentBy: req.user.id, kind: 'booking',
      fromName: studioName(req.user), replyTo: req.user.email,
      ...bookingStatusEmail({ clientName: row.client_name, studio: studioName(req.user), booking, status, reply }),
    }));
  }
  audit(req, `booking.${status}`, { entity: 'booking', entityId: row.id });
  res.json({ booking });
});

// Le photographe ajoute lui-même un rendez-vous (appel, WhatsApp…) : confirmé tout de suite.
staffBooking.post('/bookings', async (req, res) => {
  const data = z.object({
    clientId: uuid, day, start: time, durationMin: z.number().int().min(15).max(720).optional(),
    sessionType: z.string().trim().max(80).optional().default(''), note: z.string().trim().max(500).optional().default(''),
  }).parse(req.body);
  const [as, ap] = accountScope(req);
  const [client] = await query(`SELECT u.* FROM users u WHERE u.id = ? AND u.role = 'client' AND ${as}`, [data.clientId, ...ap]);
  if (!client) throw httpError(404, 'Client introuvable.');
  const settings = await settingsOf(req.user.id);
  const id = crypto.randomUUID();
  try {
    await query(
      `INSERT INTO bookings (id, staff_id, client_id, day, start_time, duration_min, session_type, note, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')`,
      [id, req.user.id, client.id, data.day, data.start, data.durationMin || settings.durationMin, data.sessionType, data.note || null],
    );
  } catch (err) {
    if (err.code === '23505') throw httpError(409, 'Ce créneau est déjà pris.');
    throw err;
  }
  const [row] = await query(`${BOOKING_SELECT} WHERE b.id = ?`, [id]);
  audit(req, 'booking.create', { entity: 'booking', entityId: id });
  res.status(201).json({ booking: mapBooking(row) });
});

// ====================================================================================================
//  Client : choisir un jour et une heure chez l'un de ses photographes (monté dans le routeur client)
// ====================================================================================================
export function clientBooking({ photographersOf }) {
  const router = Router();

  const myStaff = async (req, staffId) => {
    const list = await photographersOf(req.user.id);
    const s = list.find((x) => x.id === uuid.parse(staffId));
    if (!s) throw httpError(404, 'Photographe introuvable.');
    return s;
  };

  // Photographes chez qui l'on peut réserver + mes rendez-vous.
  router.get('/', async (req, res) => {
    const staff = await photographersOf(req.user.id);
    const settings = staff.length
      ? await query(`SELECT * FROM booking_settings WHERE staff_id IN (${staff.map(() => '?').join(', ')})`, staff.map((s) => s.id))
      : [];
    const bySid = Object.fromEntries(settings.map((s) => [s.staff_id, mapSettings(s)]));
    const mine = await query(`${BOOKING_SELECT} WHERE b.client_id = ? AND b.day >= ? ORDER BY b.day, b.start_time`, [req.user.id, addDays(studioToday(), -30)]);
    res.json({
      today: studioToday(),
      photographers: staff.map((s) => ({
        id: s.id, name: studioName(s), avatar: s.avatar_key ? `/media/avatar/${s.id}` : null,
        open: !!bySid[s.id]?.enabled, sessionTypes: bySid[s.id]?.sessionTypes || [], durationMin: bySid[s.id]?.durationMin || null,
        autoConfirm: !!bySid[s.id]?.autoConfirm, horizonDays: bySid[s.id]?.horizonDays || null,
      })),
      bookings: mine.map(mapBooking),
    });
  });

  // Jours libres d'un mois chez un photographe : { days: { '2026-11-03': ['09:00', '11:00'] } }.
  router.get('/:staffId/month', async (req, res) => {
    await myStaff(req, req.params.staffId);
    const { days, settings } = await monthSlots(req.params.staffId, month.parse(req.query.month));
    res.json({ days, durationMin: settings.durationMin, today: studioToday() });
  });

  router.post('/', async (req, res) => {
    const data = z.object({
      staffId: uuid, day, start: time,
      sessionType: z.string().trim().max(80).optional().default(''), note: z.string().trim().max(500).optional().default(''),
    }).parse(req.body);
    const staff = await myStaff(req, data.staffId);
    const settings = await settingsOf(staff.id);
    const [blocked] = await query('SELECT 1 FROM booking_blocked_days WHERE staff_id = ? AND day = ?', [staff.id, data.day]);
    const taken = await query("SELECT start_time, duration_min FROM bookings WHERE staff_id = ? AND day = ? AND status IN ('pending', 'confirmed')", [staff.id, data.day]);
    if (!slotsForDay(settings, data.day, { blocked: !!blocked, taken }).includes(data.start)) throw httpError(409, 'Ce créneau n’est plus disponible. Choisissez-en un autre.');
    if (settings.sessionTypes.length && data.sessionType && !settings.sessionTypes.includes(data.sessionType)) throw httpError(400, 'Type de séance invalide.');
    const id = crypto.randomUUID();
    const status = settings.autoConfirm ? 'confirmed' : 'pending';
    try {
      await query(
        'INSERT INTO bookings (id, staff_id, client_id, day, start_time, duration_min, session_type, note, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, staff.id, req.user.id, data.day, data.start, settings.durationMin, data.sessionType, data.note || null, status],
      );
    } catch (err) {
      if (err.code === '23505') throw httpError(409, 'Ce créneau vient d’être pris. Choisissez-en un autre.');
      throw err;
    }
    const [row] = await query(`${BOOKING_SELECT} WHERE b.id = ?`, [id]);
    const booking = mapBooking(row);
    if (staff.email) {
      fire(sendMail({
        to: staff.email, userId: staff.id, sentBy: req.user.id, kind: 'booking', replyTo: req.user.email,
        ...bookingRequestEmail({ staffName: staff.name, clientName: req.user.name, booking, auto: settings.autoConfirm }),
      }));
    }
    audit(req, 'booking.request', { entity: 'booking', entityId: id });
    res.status(201).json({ booking });
  });

  // Le client annule sa demande ou son rendez-vous (le photographe est prévenu).
  router.delete('/:id', async (req, res) => {
    const [row] = await query(`${BOOKING_SELECT} WHERE b.id = ? AND b.client_id = ?`, [uuid.parse(req.params.id), req.user.id]);
    if (!row) throw httpError(404, 'Rendez-vous introuvable.');
    if (['declined', 'cancelled'].includes(row.status)) throw httpError(400, 'Ce rendez-vous est déjà clos.');
    await query("UPDATE bookings SET status = 'cancelled' WHERE id = ?", [row.id]);
    const [staff] = await query('SELECT id, name, email FROM users WHERE id = ?', [row.staff_id]);
    if (staff?.email) {
      const booking = mapBooking({ ...row, status: 'cancelled' });
      fire(sendMail({
        to: staff.email, userId: staff.id, sentBy: req.user.id, kind: 'booking', replyTo: req.user.email,
        ...bookingStatusEmail({ clientName: staff.name, studio: req.user.name, booking, status: 'cancelled' }),
      }));
    }
    audit(req, 'booking.client_cancel', { entity: 'booking', entityId: row.id });
    res.status(204).end();
  });

  return router;
}

export { hhmm };
