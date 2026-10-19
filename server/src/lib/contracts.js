import crypto from 'node:crypto';
import { config } from '../config.js';
import { query } from '../db.js';

// Contrats : un lien secret par contrat ; une fois signé, le texte est figé (empreinte SHA-256).
export const contractUrl = (token) => `${config.appUrl}/c/${token}`; // lien court ; /contrat?t=… (anciens liens) fonctionne toujours
export const newContractToken = () => crypto.randomBytes(9).toString('base64url'); // 12 caractères (72 bits) ; les anciens (32) restent valides

export const bodyHash = (body, name, signedAt) => crypto.createHash('sha256').update(`${body}\n${name}\n${signedAt}`).digest('hex');

// Le client peut ne pas avoir de compte (contrat établi par le studio pour une personne « hors système ») : coordonnées dans guest_*.
export const CONTRACT_SELECT = `SELECT c.*, COALESCE(u.name, c.guest_name) AS client_name, COALESCE(u.email, c.guest_email) AS client_email,
    COALESCE(u.phone, c.guest_phone) AS client_phone, COALESCE(u.whatsapp, c.guest_phone) AS client_whatsapp,
    b.day AS booking_day, b.start_time AS booking_start
  FROM contracts c LEFT JOIN users u ON u.id = c.client_id LEFT JOIN bookings b ON b.id = c.booking_id`;

/** Réserves du client : lignes non acceptées et cases cochées (JSON enregistré avec la signature). */
export const parseChoices = (raw) => {
  try { const j = JSON.parse(raw || 'null'); return j && Array.isArray(j.refused) ? { refused: j.refused, checks: Array.isArray(j.checks) ? j.checks : [], notes: String(j.notes || '') } : null; } catch { return null; }
};

const iso = (v) => (v ? `${String(v).replace(' ', 'T').replace(/Z$/, '')}Z` : null);

export const mapContract = (c) => ({
  id: c.id,
  title: c.title,
  body: c.body,
  status: c.status,
  url: contractUrl(c.public_token),
  client: { id: c.client_id || null, guest: !c.client_id, name: c.client_name, email: c.client_email, phone: c.client_phone || '', whatsapp: c.client_whatsapp || c.client_phone || '' },
  bookingId: c.booking_id,
  bookingDay: c.booking_day ? String(c.booking_day).slice(0, 10) : null,
  bookingStart: c.booking_start || null,
  sentAt: iso(c.sent_at),
  staffSigned: !!c.staff_signature,
  reserves: parseChoices(c.client_choices)?.refused.length || 0,
  signedAt: iso(c.signed_at),
  signedName: c.signed_name || '',
  createdAt: iso(c.created_at),
});

/** Séances confirmées à venir sans contrat signé (« pas de séance sans papier signé »). */
export async function unsignedBookings(staffId, today) {
  return query(
    `SELECT b.id, b.day, b.start_time, b.session_type, b.client_id, u.name AS client_name
     FROM bookings b JOIN users u ON u.id = b.client_id
     WHERE b.staff_id = ? AND b.status = 'confirmed' AND b.day >= ?
       AND NOT EXISTS (SELECT 1 FROM contracts c WHERE c.client_id = b.client_id AND c.staff_id = b.staff_id AND c.status = 'signed' AND (c.booking_id = b.id OR c.booking_id IS NULL))
     ORDER BY b.day, b.start_time`,
    [staffId, today],
  );
}
