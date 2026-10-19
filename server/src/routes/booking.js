import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query } from '../db.js';
import { httpError } from '../lib/errors.js';
import { uuid } from '../lib/data.js';
import { audit } from '../lib/audit.js';
import { pushLater } from '../lib/push.js';
import { sendMail } from '../lib/mailer.js';
import { accountScope } from '../lib/scope.js';
import { bookingRequestEmail, bookingStatusEmail, inquiryReplyEmail } from '../lib/emails.js';
import {
  slotConflict, settingsOf, mapSettings, monthSlots, slotsForDay, mapBooking, BOOKING_SELECT, studioToday, addDays, minutesOf, hhmm,
} from '../lib/booking.js';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide.');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure invalide.');
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mois invalide.');
const studioName = (u) => u.sender_name || u.name;
// Mot de passe temporaire d'un compte créé à l'acceptation d'une demande du portfolio : aléatoire, envoyé seulement à l'e-mail de la personne,
// à changer à la première connexion (un mot de passe fixe permettrait de prendre le compte de quelqu'un en saisissant son e-mail).
const tempPassword = () => crypto.randomBytes(9).toString('base64url');
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
  const [settings, blocked, rows, requests] = await Promise.all([
    settingsOf(req.user.id),
    query('SELECT day FROM booking_blocked_days WHERE staff_id = ? AND day >= ? ORDER BY day', [req.user.id, today]),
    query(`${BOOKING_SELECT} WHERE b.staff_id = ? AND (b.day >= ? OR (b.status = 'confirmed' AND b.delivery_date IS NOT NULL AND b.delivered_at IS NULL)) ORDER BY b.day, b.start_time`, [req.user.id, addDays(today, -30)]),
    // Demandes du portfolio public (visiteurs sans compte) ; vide si la migration n'est pas encore appliquée.
    query(`SELECT id, name, email, phone, session_type, location, wished_date, wished_time, message, status, reply, created_at FROM portfolio_requests
           WHERE staff_id = ? AND (status = 'pending' OR created_at > CURRENT_TIMESTAMP - INTERVAL '30 days') ORDER BY created_at DESC LIMIT 50`, [req.user.id]).catch(() => []),
  ]);
  res.json({
    today, settings, blocked: blocked.map((b) => String(b.day).slice(0, 10)), bookings: rows.map(mapBooking),
    requests: requests.map((r) => ({ id: r.id, name: r.name, email: r.email, phone: r.phone, sessionType: r.session_type, location: r.location || '', date: r.wished_date, time: r.wished_time || '', message: r.message, status: r.status, reply: r.reply, createdAt: r.created_at })),
  });
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

// Demande du portfolio : accepter ou refuser ; le visiteur reçoit un e-mail (réponse directe au studio).
staffBooking.patch('/requests/:id', async (req, res) => {
  const { status, reply, proposedDate, proposedTime } = z.object({ status: z.enum(['accepted', 'declined', 'cancelled']), reply: z.string().trim().max(500).optional().default(''), proposedDate: day.optional(), proposedTime: time.optional() }).parse(req.body);
  const [row] = await query('SELECT * FROM portfolio_requests WHERE id = ? AND staff_id = ?', [uuid.parse(req.params.id), req.user.id]);
  if (!row) throw httpError(404, 'Demande introuvable.');
  // Annuler : seulement une demande déjà acceptée ; l'heure redevient libre tout de suite.
  if (status === 'cancelled' ? row.status !== 'accepted' : row.status !== 'pending') throw httpError(400, status === 'cancelled' ? 'Seule une demande acceptée peut être annulée.' : 'Cette demande a déjà reçu une réponse.');
  // Accepter une heure déjà prise (séance confirmée, autre demande acceptée, jour bloqué) : refusé, avec des propositions.
  if (status === 'accepted' && /^\d{4}-\d{2}-\d{2}$/.test(row.wished_date) && row.wished_time) {
    const c = await slotConflict(req.user.id, row.wished_date, row.wished_time, { excludeRequestId: row.id });
    if (c) {
      const hint = [...c.times.map((t) => `${row.wished_date} à ${t}`), ...c.dates.map((d) => `${d.day} à ${d.time}`)].slice(0, 4).join(' · ');
      throw httpError(409, `Cette heure est déjà prise. Refusez la demande en proposant un autre moment${hint ? ` (libres : ${hint})` : ''}.`);
    }
  }
  await query('UPDATE portfolio_requests SET status = ?, reply = ? WHERE id = ?', [status, reply || null, row.id]);
  // Acceptée : si la personne n'a pas encore de compte, on lui en crée un (mot de passe initial à changer à la première connexion).
  let password;
  if (status === 'accepted' && row.email) {
    const [known] = await query('SELECT id FROM users WHERE lower(email) = ?', [row.email.toLowerCase()]);
    if (!known) {
      const id = crypto.randomUUID();
      password = tempPassword();
      await query(
        `INSERT INTO users (id, role, created_by, name, email, phone, password_hash, must_change_password) VALUES (?, 'client', ?, ?, ?, ?, ?, 1)`,
        [id, req.user.id, row.name, row.email.toLowerCase(), row.phone || null, await bcrypt.hash(password, 10)],
      );
      await query('INSERT INTO client_photographers (client_id, staff_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [id, req.user.id]);
    }
  }
  if (row.email) fire(sendMail({
    to: row.email, userId: req.user.id, sentBy: req.user.id, kind: 'inquiry-reply',
    fromName: studioName(req.user), replyTo: req.user.email,
    ...inquiryReplyEmail({ name: row.name, email: row.email, password, studio: studioName(req.user), accepted: status === 'accepted', cancelled: status === 'cancelled', sessionType: row.session_type, date: row.wished_date, time: row.wished_time, reply, proposedDate, proposedTime }),
  }));
  audit(req, `inquiry.${status}`, { entity: 'portfolio_request', entityId: row.id });
  res.json({ ok: true, status, accountCreated: !!password });
});

async function loadOwn(req, id) {
  const [row] = await query(`${BOOKING_SELECT} WHERE b.id = ? AND b.staff_id = ?`, [uuid.parse(id), req.user.id]);
  if (!row) throw httpError(404, 'Rendez-vous introuvable.');
  return row;
}

// Confirmer, refuser ou annuler : le client est prévenu par e-mail.
staffBooking.patch('/bookings/:id', async (req, res) => {
  const { status: asked, reply, proposal } = z.object({
    status: z.enum(['confirmed', 'declined', 'cancelled']),
    reply: z.string().trim().max(500).optional().default(''),
    // Refus avec une autre date proposée : le client accepte ou refuse la nouvelle date.
    proposal: z.object({ day, start: time }).optional(),
  }).parse(req.body);
  const row = await loadOwn(req, req.params.id);
  if (['declined', 'cancelled'].includes(row.status)) throw httpError(400, 'Ce rendez-vous est déjà clos.');
  if (asked === 'confirmed' && row.status === 'confirmed') throw httpError(400, 'Ce rendez-vous est déjà confirmé.');
  if (proposal && asked !== 'declined') throw httpError(400, 'Une autre date ne peut être proposée qu’en refusant.');
  let status = asked;
  let moved = {};
  if (proposal) {
    if (proposal.day < studioToday()) throw httpError(400, 'Proposez une date à venir.');
    const others = await query(
      "SELECT start_time, duration_min FROM bookings WHERE staff_id = ? AND day = ? AND id <> ? AND status IN ('pending', 'confirmed', 'proposed')",
      [req.user.id, proposal.day, row.id],
    );
    const from = minutesOf(proposal.start);
    const to = from + Number(row.duration_min);
    if (others.some((o) => from < minutesOf(o.start_time) + Number(o.duration_min) && to > minutesOf(o.start_time))) throw httpError(409, 'Un autre rendez-vous occupe déjà ce créneau.');
    status = 'proposed';
    moved = { day: proposal.day, start_time: proposal.start, orig_day: String(row.day).slice(0, 10), orig_start: row.start_time };
    try {
      await query(
        'UPDATE bookings SET status = ?, reply = ?, day = ?, start_time = ?, orig_day = ?, orig_start = ? WHERE id = ?',
        [status, reply || null, proposal.day, proposal.start, moved.orig_day, moved.orig_start, row.id],
      );
    } catch (err) {
      if (err.code === '23505') throw httpError(409, 'Ce créneau est déjà pris.');
      throw err;
    }
  } else {
    await query('UPDATE bookings SET status = ?, reply = ? WHERE id = ?', [status, reply || null, row.id]);
  }
  const booking = mapBooking({ ...row, ...moved, status, reply });
  if (row.client_id) pushLater(row.client_id, { title: { confirmed: 'Rendez-vous confirmé', declined: 'Rendez-vous non disponible', cancelled: 'Rendez-vous annulé', proposed: 'Autre date proposée' }[status], body: `${studioName(req.user)} · ${booking.day} à ${booking.start}`, url: '/client', tag: `booking-${row.id}` });
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

// Date de remise des photos d'un rendez-vous (ou « photos remises ») : sert aux rappels du studio.
staffBooking.patch('/bookings/:id/delivery', async (req, res) => {
  const body = z.object({ deliveryDate: day.nullable().optional(), delivered: z.boolean().optional() }).parse(req.body);
  const row = await loadOwn(req, req.params.id);
  if (body.deliveryDate !== undefined) {
    if (body.deliveryDate && body.deliveryDate < String(row.day).slice(0, 10)) throw httpError(400, 'La remise des photos doit être après la séance.');
    await query('UPDATE bookings SET delivery_date = ?, delivery_reminded_at = NULL WHERE id = ?', [body.deliveryDate, row.id]);
  }
  if (body.delivered !== undefined) await query(`UPDATE bookings SET delivered_at = ${body.delivered ? 'CURRENT_TIMESTAMP' : 'NULL'} WHERE id = ?`, [row.id]);
  const [fresh] = await query(`${BOOKING_SELECT} WHERE b.id = ?`, [row.id]);
  res.json({ booking: mapBooking(fresh) });
});

// Le photographe ajoute lui-même un rendez-vous (appel, WhatsApp…) : confirmé tout de suite.
staffBooking.post('/bookings', async (req, res) => {
  const data = z.object({
    clientId: uuid.optional(), day, start: time, durationMin: z.number().int().min(15).max(720).optional(),
    sessionType: z.string().trim().max(80).optional().default(''), note: z.string().trim().max(500).optional().default(''),
    deliveryDate: day.optional(),
    location: z.string().trim().max(120).optional().default(''), // lieu du rendez-vous : obligatoire sauf portrait / studio
    // Personne sans compte : nom et téléphone suffisent (l'e-mail est facultatif).
    guest: z.object({
      name: z.string().trim().min(2, 'Entrez le nom de la personne.').max(80),
      phone: z.string().trim().max(40).optional().default(''),
      email: z.union([z.literal(''), z.string().trim().toLowerCase().email('E-mail invalide.').max(190)]).optional().default(''),
    }).optional(),
  }).parse(req.body);
  if (!data.clientId && !data.guest) throw httpError(400, 'Choisissez un client ou entrez le nom de la personne.');
  if (data.deliveryDate && data.deliveryDate < data.day) throw httpError(400, 'La remise des photos doit être après la séance.');
  if (!data.location && !/portrait|studio|anniv|birthday/i.test(data.sessionType)) throw httpError(400, 'Indiquez le lieu du rendez-vous (ex. « Au studio »).');
  let client = null;
  if (data.clientId) {
    const [as, ap] = accountScope(req);
    [client] = await query(`SELECT u.* FROM users u WHERE u.id = ? AND u.role = 'client' AND ${as}`, [data.clientId, ...ap]);
    if (!client) throw httpError(404, 'Client introuvable.');
  }
  const settings = await settingsOf(req.user.id);
  const id = crypto.randomUUID();
  try {
    await query(
      `INSERT INTO bookings (id, staff_id, client_id, guest_name, guest_phone, guest_email, day, start_time, duration_min, session_type, note, delivery_date, location, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')`,
      [id, req.user.id, client?.id || null, client ? null : data.guest.name, client ? null : data.guest.phone || null, client ? null : data.guest.email || null, data.day, data.start, data.durationMin || settings.durationMin, data.sessionType, data.note || null, data.deliveryDate || null, data.location || null],
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
    const taken = await query("SELECT start_time, duration_min FROM bookings WHERE staff_id = ? AND day = ? AND status IN ('pending', 'confirmed', 'proposed')", [staff.id, data.day]);
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
    pushLater(staff.id, { title: settings.autoConfirm ? 'Nouveau rendez-vous' : 'Demande de rendez-vous', body: `${req.user.name} · ${booking.day} à ${booking.start}`, url: '/admin', tag: `booking-${id}` });
    if (staff.email) {
      fire(sendMail({
        to: staff.email, userId: staff.id, sentBy: req.user.id, kind: 'booking', replyTo: req.user.email,
        ...bookingRequestEmail({ staffName: staff.name, clientName: req.user.name, booking, auto: settings.autoConfirm }),
      }));
    }
    audit(req, 'booking.request', { entity: 'booking', entityId: id });
    res.status(201).json({ booking });
  });

  // Le client répond à une autre date proposée : accepter (confirmé) ou refuser (annulé).
  router.post('/:id/respond', async (req, res) => {
    const { accept } = z.object({ accept: z.boolean() }).parse(req.body);
    const [row] = await query(`${BOOKING_SELECT} WHERE b.id = ? AND b.client_id = ?`, [uuid.parse(req.params.id), req.user.id]);
    if (!row) throw httpError(404, 'Rendez-vous introuvable.');
    if (row.status !== 'proposed') throw httpError(400, 'Aucune nouvelle date à confirmer pour ce rendez-vous.');
    const status = accept ? 'confirmed' : 'cancelled';
    await query('UPDATE bookings SET status = ? WHERE id = ?', [status, row.id]);
    const [staff] = await query('SELECT id, name, email FROM users WHERE id = ?', [row.staff_id]);
    const booking = mapBooking({ ...row, status });
    pushLater(row.staff_id, { title: accept ? 'Nouvelle date acceptée' : 'Nouvelle date refusée', body: `${req.user.name} · ${booking.day} à ${booking.start}`, url: '/admin', tag: `booking-${row.id}` });
    if (staff?.email) {
      fire(sendMail({
        to: staff.email, userId: staff.id, sentBy: req.user.id, kind: 'booking', replyTo: req.user.email,
        ...(accept
          ? bookingRequestEmail({ staffName: staff.name, clientName: req.user.name, booking, auto: true })
          : bookingStatusEmail({ clientName: staff.name, studio: req.user.name, booking, status: 'cancelled' })),
      }));
    }
    audit(req, accept ? 'booking.proposal_accept' : 'booking.proposal_decline', { entity: 'booking', entityId: row.id });
    res.json({ booking });
  });

  // Le client annule sa demande ou son rendez-vous (le photographe est prévenu).
  router.delete('/:id', async (req, res) => {
    const [row] = await query(`${BOOKING_SELECT} WHERE b.id = ? AND b.client_id = ?`, [uuid.parse(req.params.id), req.user.id]);
    if (!row) throw httpError(404, 'Rendez-vous introuvable.');
    if (['declined', 'cancelled'].includes(row.status)) throw httpError(400, 'Ce rendez-vous est déjà clos.');
    await query("UPDATE bookings SET status = 'cancelled' WHERE id = ?", [row.id]);
    const [staff] = await query('SELECT id, name, email FROM users WHERE id = ?', [row.staff_id]);
    pushLater(row.staff_id, { title: 'Rendez-vous annulé', body: `${req.user.name} · ${String(row.day).slice(0, 10)} à ${row.start_time}`, url: '/admin', tag: `booking-${row.id}` });
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
