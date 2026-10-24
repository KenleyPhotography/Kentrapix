import { query } from '../db.js';

// Rendez-vous : jours et heures sont des heures locales du studio (Haïti), sans fuseau stocké.
export const STUDIO_TZ = process.env.STUDIO_TZ || 'America/Port-au-Prince';
export const ACTIVE = ['pending', 'confirmed', 'proposed'];

const pad = (n) => String(n).padStart(2, '0');
export const minutesOf = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};
export const hhmm = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

/** Date du jour au studio : 'YYYY-MM-DD'. */
export const studioToday = (now = new Date()) => now.toLocaleDateString('en-CA', { timeZone: STUDIO_TZ });
export const addDays = (day, n) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const weekdayOf = (day) => new Date(`${day}T12:00:00Z`).getUTCDay();

/**
 * Lieu de la séance selon le type :
 * 'studio'  portrait, shoot studio : toujours au studio, on ne demande rien ;
 * 'choice'  anniversaire : au studio ou ailleurs, au choix du client ;
 * 'outdoor' shoot dehors : le lieu peut rester à déterminer ;
 * 'away'    graduation, mariage, baptême, autre : le lieu est obligatoire.
 */
export const placeKind = (type) => {
  const t = String(type || '').trim();
  if (!t) return '';
  if (/portrait|studio/i.test(t)) return 'studio';
  if (/anniv|birthday/i.test(t)) return 'choice';
  if (/outdoor|ext[ée]rieur|dehors|plein air/i.test(t)) return 'outdoor';
  return 'away';
};
/** Faut-il indiquer un lieu ? Seules les séances toujours au studio en dispensent. */
export const needsPlace = (type) => placeKind(type) !== 'studio';

export const DEFAULTS = {
  enabled: false, days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', durationMin: 120, minNoticeDays: 2, horizonDays: 60, autoConfirm: false,
  sessionTypes: ['Portrait', 'Shoot studio', 'Shoot outdoor', 'Anniversaire', 'Graduation', 'Mariage', 'Baptême', 'Autre'],
};

export const mapSettings = (r) => (r ? {
  enabled: !!r.enabled,
  days: String(r.days).split(',').filter((x) => x !== '').map(Number),
  start: r.start_time,
  end: r.end_time,
  durationMin: Number(r.duration_min),
  minNoticeDays: Number(r.min_notice_days),
  horizonDays: Number(r.horizon_days),
  autoConfirm: !!r.auto_confirm,
  sessionTypes: String(r.session_types).split(',').map((s) => s.trim()).filter(Boolean),
} : { ...DEFAULTS });

export async function settingsOf(staffId) {
  const [r] = await query('SELECT * FROM booking_settings WHERE staff_id = ?', [staffId]);
  return mapSettings(r);
}

/** Créneaux libres d'un jour : ['09:00', '11:00', …]. `taken` : réservations actives du jour [{ start_time, duration_min }]. */
export function slotsForDay(settings, day, { blocked = false, taken = [], today = studioToday() } = {}) {
  if (!settings.enabled || blocked) return [];
  if (!settings.days.includes(weekdayOf(day))) return [];
  if (day < addDays(today, settings.minNoticeDays) || day > addDays(today, settings.horizonDays)) return [];
  const from = minutesOf(settings.start);
  const to = minutesOf(settings.end);
  const busy = taken.map((t) => [minutesOf(t.start_time), minutesOf(t.start_time) + Number(t.duration_min)]);
  const out = [];
  for (let t = from; t + settings.durationMin <= to; t += settings.durationMin) {
    if (!busy.some(([a, b]) => t < b && t + settings.durationMin > a)) out.push(hhmm(t));
  }
  return out;
}

/** Créneaux libres de chaque jour d'un mois 'YYYY-MM' : { '2026-11-03': ['09:00', …], … } (jours sans créneau absents). */
export async function monthSlots(staffId, month) {
  const settings = await settingsOf(staffId);
  const first = `${month}-01`;
  const end = (() => { const d = new Date(`${first}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return d.toISOString().slice(0, 10); })();
  const [blocked, taken] = await Promise.all([
    query('SELECT day FROM booking_blocked_days WHERE staff_id = ? AND day BETWEEN ? AND ?', [staffId, first, end]),
    query("SELECT day, start_time, duration_min FROM bookings WHERE staff_id = ? AND status IN ('pending', 'confirmed', 'proposed') AND day BETWEEN ? AND ?", [staffId, first, end]),
  ]);
  const blockedSet = new Set(blocked.map((b) => String(b.day).slice(0, 10)));
  const byDay = {};
  for (const t of taken) (byDay[String(t.day).slice(0, 10)] ??= []).push(t);
  const days = {};
  for (let day = first; day <= end; day = addDays(day, 1)) {
    const slots = slotsForDay(settings, day, { blocked: blockedSet.has(day), taken: byDay[day] || [] });
    if (slots.length) days[day] = slots;
  }
  return { settings, days };
}

/** Heures déjà prises entre deux dates : séances confirmées, demandes du portfolio acceptées (jour entier si sans heure), jours bloqués. */
async function busyBetween(staffId, from, to, dur, excludeRequestId) {
  const [booked, blocked, accepted] = await Promise.all([
    query("SELECT day, start_time, duration_min FROM bookings WHERE staff_id = ? AND status = 'confirmed' AND day BETWEEN ? AND ?", [staffId, from, to]),
    query('SELECT day FROM booking_blocked_days WHERE staff_id = ? AND day BETWEEN ? AND ?', [staffId, from, to]),
    query("SELECT id, wished_date, wished_time FROM portfolio_requests WHERE staff_id = ? AND status = 'accepted' AND wished_date BETWEEN ? AND ?", [staffId, from, to]).catch(() => []),
  ]);
  const byDay = {};
  const add = (day, a, b) => (byDay[day] ??= []).push([a, b]);
  for (const b of booked) add(String(b.day).slice(0, 10), minutesOf(b.start_time), minutesOf(b.start_time) + Number(b.duration_min));
  for (const r of accepted) if (r.id !== excludeRequestId) (r.wished_time ? add(r.wished_date, minutesOf(r.wished_time), minutesOf(r.wished_time) + dur) : add(r.wished_date, 0, 1440));
  return { byDay, blocked: new Set(blocked.map((b) => String(b.day).slice(0, 10))) };
}

const isFree = (busy, day, from, dur) => !busy.blocked.has(day) && !(busy.byDay[day] || []).some(([a, b]) => from < b && from + dur > a);

/**
 * Une heure précise est-elle libre ? null si oui ; sinon des propositions : autres heures le même jour, puis prochains jours.
 * (Se base sur la durée d'une séance et les heures d'ouverture réglées dans les disponibilités.)
 */
export async function slotConflict(staffId, day, time, { excludeRequestId = null } = {}) {
  const settings = await settingsOf(staffId);
  const dur = settings.durationMin;
  const from = minutesOf(time);
  const busy = await busyBetween(staffId, day, addDays(day, 60), dur, excludeRequestId);
  if (isFree(busy, day, from, dur)) return null;
  const open = settings.days.length ? settings.days : [0, 1, 2, 3, 4, 5, 6];
  const first = minutesOf(settings.start), last = minutesOf(settings.end);
  const times = [];
  for (let t = first; t + dur <= last && times.length < 4; t += dur) if (isFree(busy, day, t, dur)) times.push(hhmm(t));
  const dates = [];
  for (let n = 1; n <= 60 && dates.length < 3; n++) {
    const d = addDays(day, n);
    if (!open.includes(weekdayOf(d))) continue;
    for (let t = first; t + dur <= last; t += dur) if (isFree(busy, d, t, dur)) { dates.push({ day: d, time: hhmm(t) }); break; }
  }
  return { times, dates };
}

export const mapBooking = (b) => ({
  id: b.id,
  day: String(b.day).slice(0, 10),
  start: b.start_time,
  end: hhmm(minutesOf(b.start_time) + Number(b.duration_min)),
  durationMin: Number(b.duration_min),
  sessionType: b.session_type || '',
  note: b.note || '',
  status: b.status,
  reply: b.reply || '',
  originalDay: b.orig_day ? String(b.orig_day).slice(0, 10) : null,
  originalStart: b.orig_start || null,
  staff: b.staff_name ? { id: b.staff_id, name: b.staff_name } : undefined,
  location: b.location || '',
  deliveryDate: b.delivery_date ? String(b.delivery_date).slice(0, 10) : null,
  delivered: !!b.delivered_at,
  client: b.client_name ? { id: b.client_id || null, guest: !b.client_id, name: b.client_name, email: b.client_email || '', phone: b.client_phone || '', whatsapp: b.client_whatsapp || b.client_phone || '' } : undefined,
});

// Le client peut ne pas avoir de compte (rendez-vous ajouté par le studio) : ses coordonnées sont alors dans guest_*.
export const BOOKING_SELECT = `SELECT b.*, COALESCE(c.name, b.guest_name) AS client_name, COALESCE(c.email, b.guest_email) AS client_email,
    COALESCE(c.phone, b.guest_phone) AS client_phone, COALESCE(c.whatsapp, b.guest_phone) AS client_whatsapp,
    COALESCE(NULLIF(s.sender_name, ''), s.name) AS staff_name
  FROM bookings b LEFT JOIN users c ON c.id = b.client_id JOIN users s ON s.id = b.staff_id`;
