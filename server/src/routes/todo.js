import { Router } from 'express';
import { query } from '../db.js';
import { studioToday, addDays } from '../lib/booking.js';
import { unsignedBookings, CONTRACT_SELECT, mapContract } from '../lib/contracts.js';
import { INVOICE_SELECT, mapInvoice } from '../lib/billing.js';
import { eventScope } from '../lib/scope.js';

// « Sa k pou fè » : tout ce qui attend le photographe, au même endroit (une poignée de requêtes légères).
export const staffTodo = Router();

const iso = (v) => (v ? `${String(v).replace(' ', 'T').replace(/Z$/, '')}Z` : null);

staffTodo.get('/', async (req, res) => {
  const today = studioToday();
  const tomorrow = addDays(today, 1);
  const [es, ep] = eventScope(req);
  const [pending, unsigned, invoices, selections, tomorrowRows, requests, orders, reviews] = await Promise.all([
    query(`${CONTRACT_SELECT} WHERE c.staff_id = ? AND c.status = 'pending' ORDER BY c.created_at`, [req.user.id]),
    unsignedBookings(req.user.id, today),
    query(`${INVOICE_SELECT} WHERE i.staff_id = ? AND i.cancelled = 0 AND i.due_date IS NOT NULL AND i.due_date < ?`, [req.user.id, today]),
    query(
      `SELECT s.event_id, s.photo_count, s.submitted_at, e.name AS event_name, u.name AS client_name
       FROM event_selections s JOIN events e ON e.id = s.event_id JOIN users u ON u.id = s.user_id
       WHERE s.submitted_at IS NOT NULL AND s.submitted_at >= CURRENT_TIMESTAMP - INTERVAL '14 days' AND ${es}
       ORDER BY s.submitted_at DESC LIMIT 20`,
      ep,
    ),
    query(
      `SELECT b.id, b.start_time, b.session_type, u.name AS client_name FROM bookings b JOIN users u ON u.id = b.client_id
       WHERE b.staff_id = ? AND b.day = ? AND b.status = 'confirmed' ORDER BY b.start_time`,
      [req.user.id, tomorrow],
    ),
    query(
      `SELECT b.id, b.day, b.start_time, u.name AS client_name FROM bookings b JOIN users u ON u.id = b.client_id
       WHERE b.staff_id = ? AND b.status = 'pending' AND b.day >= ? ORDER BY b.day, b.start_time LIMIT 20`,
      [req.user.id, today],
    ),
    query(
      `SELECT o.id, o.created_at, u.name AS client_name FROM print_orders o JOIN users u ON u.id = o.client_id
       WHERE o.staff_id = ? AND o.status = 'new' ORDER BY o.created_at LIMIT 20`,
      [req.user.id],
    ),
    query(
      `SELECT r.id, r.rating, u.name AS client_name FROM reviews r JOIN users u ON u.id = r.client_id
       WHERE r.staff_id = ? AND r.is_public = 0 ORDER BY r.updated_at DESC LIMIT 20`,
      [req.user.id],
    ),
  ]);
  const late = invoices.map((i) => mapInvoice(i)).filter((i) => i.balance > 0);
  res.json({
    today,
    contracts: pending.map(mapContract).map((c) => ({ id: c.id, title: c.title, client: c.client.name, sentAt: c.sentAt, createdAt: c.createdAt, bookingDay: c.bookingDay })),
    unsignedBookings: unsigned.map((b) => ({ id: b.id, day: String(b.day).slice(0, 10), start: b.start_time, client: b.client_name, sessionType: b.session_type })),
    overdueInvoices: late.map((i) => ({ id: i.id, number: i.number, client: i.client.name, balance: i.balance, currency: i.currency, dueDate: i.dueDate })),
    selections: selections.map((s) => ({ eventId: s.event_id, event: s.event_name, client: s.client_name, count: Number(s.photo_count), at: iso(s.submitted_at) })),
    tomorrow: tomorrowRows.map((b) => ({ id: b.id, start: b.start_time, client: b.client_name, sessionType: b.session_type })),
    bookingRequests: requests.map((b) => ({ id: b.id, day: String(b.day).slice(0, 10), start: b.start_time, client: b.client_name })),
    newOrders: orders.map((o) => ({ id: o.id, client: o.client_name, at: iso(o.created_at) })),
    reviews: reviews.map((r) => ({ id: r.id, rating: Number(r.rating), client: r.client_name })),
  });
});
