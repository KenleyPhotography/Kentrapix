import crypto from 'node:crypto';
import { query } from '../db.js';
import { config } from '../config.js';

// Factures : le solde et le statut sont toujours calculés (jamais stockés) à partir du total et des paiements.
export const CURRENCIES = ['USD', 'HTG', 'EUR', 'CAD'];
export const METHODS = ['especes', 'moncash', 'natcash', 'virement', 'carte', 'cheque', 'autre'];

export const round2 = (n) => Math.round(Number(n) * 100) / 100;
export const today = () => new Date().toISOString().slice(0, 10);

/** paid | partial | unpaid | overdue | cancelled */
export function invoiceStatus(i, day = today()) {
  if (i.cancelled) return 'cancelled';
  const balance = round2(Number(i.total) - Number(i.paid || 0));
  if (balance <= 0) return 'paid';
  if (i.due_date && String(i.due_date).slice(0, 10) < day) return 'overdue';
  return Number(i.paid) > 0 ? 'partial' : 'unpaid';
}

export const invoiceUrl = (token) => `${config.appUrl}/facture?t=${token}`;

export const INVOICE_SELECT = `SELECT i.*, u.name AS client_name, u.email AS client_email, u.phone AS client_phone, u.whatsapp AS client_whatsapp,
    e.name AS event_name,
    COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id), 0) AS paid
  FROM invoices i JOIN users u ON u.id = i.client_id LEFT JOIN events e ON e.id = i.event_id`;

export const mapPayment = (p) => ({
  id: p.id, invoiceId: p.invoice_id, amount: Number(p.amount), method: p.method, paidAt: String(p.paid_at).slice(0, 10), note: p.note || '',
});

export function mapInvoice(i, payments = []) {
  const paid = round2(i.paid || 0);
  return {
    id: i.id,
    number: i.number,
    title: i.title,
    notes: i.notes || '',
    paymentType: i.payment_type === 'cash' ? 'cash' : 'credit',
    currency: i.currency,
    total: Number(i.total),
    paid,
    balance: round2(Number(i.total) - paid),
    status: invoiceStatus(i),
    issuedAt: String(i.issued_at).slice(0, 10),
    dueDate: i.due_date ? String(i.due_date).slice(0, 10) : null,
    eventId: i.event_id || null,
    eventName: i.event_name || '',
    sentAt: i.sent_at ? `${i.sent_at.replace(' ', 'T')}Z` : null,
    remindedAt: i.reminded_at ? `${i.reminded_at.replace(' ', 'T')}Z` : null,
    url: invoiceUrl(i.public_token),
    client: { id: i.client_id, name: i.client_name, email: i.client_email, phone: i.client_phone || '', whatsapp: i.client_whatsapp || i.client_phone || '' },
    payments: payments.map(mapPayment),
  };
}

/** Numéro suivant du photographe pour l'année en cours : F-2026-0001, F-2026-0002… */
export async function nextNumber(staffId) {
  const year = new Date().getUTCFullYear();
  const [{ n }] = await query('SELECT COUNT(*) AS n FROM invoices WHERE staff_id = ? AND number LIKE ?', [staffId, `F-${year}-%`]);
  return `F-${year}-${String(Number(n) + 1).padStart(4, '0')}`;
}

export const newToken = () => crypto.randomBytes(24).toString('base64url'); // 32 caractères
