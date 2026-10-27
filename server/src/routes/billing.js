import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { query } from '../db.js';
import { httpError } from '../lib/errors.js';
import { uuid } from '../lib/data.js';
import { audit } from '../lib/audit.js';
import { pushLater } from '../lib/push.js';
import { sendMail } from '../lib/mailer.js';
import { sendPrivate } from '../lib/storage.js';
import { invoiceEmail, paymentReminderEmail } from '../lib/emails.js';
import { accountScope, eventScope } from '../lib/scope.js';
import {
  CURRENCIES, METHODS, INVOICE_SELECT, mapInvoice, nextNumber, newToken, round2, today, invoiceUrl,
} from '../lib/billing.js';

// Administration du photographe : factures, paiements, rappels. Monté dans le routeur du studio (mot de passe du studio requis).
// Un photographe — propriétaire compris — ne voit et ne modifie que SES factures.
export const billingRouter = Router();

const money = z.coerce.number({ invalid_type_error: 'Montant invalide.' }).positive('Le montant doit être supérieur à 0.').max(10_000_000, 'Montant trop élevé.').transform(round2);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide.');
const optionalDay = z.union([day, z.literal('')]).optional().transform((v) => v || null);
// Modification : une date absente du formulaire doit rester `undefined` (« ne pas y toucher »),
// alors qu'une date vide veut dire « enlever l'échéance ».
const patchDay = z.union([day, z.literal('')]).optional().transform((v) => (v === undefined ? undefined : v || null));
const text = (max, msg) => z.string().trim().min(1, msg).max(max);
const sender = (user) => ({ fromName: user.sender_name || user.name, replyTo: user.email });

async function loadInvoice(req, id) {
  const [row] = await query(`${INVOICE_SELECT} WHERE i.id = ? AND i.staff_id = ?`, [uuid.parse(id), req.user.id]);
  if (!row) throw httpError(404, 'Facture introuvable.');
  const payments = await query('SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_at, created_at', [row.id]);
  return { row, invoice: mapInvoice(row, payments) };
}

// ---------- Tout d'un coup : factures + paiements + rappels ----------
billingRouter.get('/billing', async (req, res) => {
  const [rows, payments, reminders, log] = await Promise.all([
    query(`${INVOICE_SELECT} WHERE i.staff_id = ? ORDER BY i.issued_at DESC, i.created_at DESC`, [req.user.id]),
    query('SELECT p.* FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.staff_id = ? ORDER BY p.paid_at, p.created_at', [req.user.id]),
    query(
      `SELECT r.*, u.name AS client_name FROM reminders r LEFT JOIN users u ON u.id = r.client_id
       WHERE r.staff_id = ? ORDER BY r.done, r.due_at`, [req.user.id],
    ),
    query('SELECT id, invoice_id, channel, status, auto, created_at FROM reminder_log WHERE staff_id = ? ORDER BY created_at DESC LIMIT 100', [req.user.id]),
  ]);
  const byInvoice = {};
  for (const p of payments) (byInvoice[p.invoice_id] ??= []).push(p);
  res.json({
    today: today(),
    invoices: rows.map((i) => mapInvoice(i, byInvoice[i.id] || [])),
    reminderLog: log.map((l) => ({ id: l.id, invoiceId: l.invoice_id, channel: l.channel, status: l.status, auto: !!l.auto, at: `${String(l.created_at).replace(' ', 'T')}Z` })),
    autoReminders: !!(await query('SELECT auto_reminders FROM users WHERE id = ?', [req.user.id]))[0]?.auto_reminders,
    reminders: reminders.map((r) => ({
      id: r.id, title: r.title, dueAt: String(r.due_at).slice(0, 10), done: !!r.done, clientId: r.client_id, clientName: r.client_name || '', invoiceId: r.invoice_id,
    })),
  });
});

// ---------- Factures ----------
const invoiceSchema = z.object({
  // Soit un client inscrit (clientId), soit un client hors système (guest : nom obligatoire, e-mail et téléphone facultatifs).
  clientId: z.union([uuid, z.literal('')]).optional().transform((v) => v || null),
  guest: z.object({
    name: z.string().trim().min(2, 'Entrez le nom du client.').max(120),
    email: z.union([z.literal(''), z.string().trim().toLowerCase().email('Adresse e-mail invalide.').max(190)]).optional().transform((v) => v || null),
    phone: z.string().trim().max(40).optional().transform((v) => v || null),
  }).optional(),
  eventId: z.union([uuid, z.literal('')]).optional().transform((v) => v || null),
  title: text(200, 'Le titre de la facture est obligatoire.'),
  amount: money,
  currency: z.enum(CURRENCIES).default('USD'),
  issuedAt: optionalDay,
  dueDate: optionalDay,
  notes: z.string().trim().max(1000, 'Notes trop longues (1000 caractères max).').optional().transform((v) => v || null),
  // cash : payée en totalité tout de suite. credit : une avance (facultative) maintenant, le solde plus tard.
  paymentType: z.enum(['cash', 'credit']).default('credit'),
  advance: z.union([z.literal(''), z.literal(null), money]).optional().transform((v) => (v === '' || v == null ? 0 : v)),
  advanceMethod: z.enum(METHODS).default('especes'),
});

billingRouter.post('/invoices', async (req, res) => {
  const data = invoiceSchema.parse(req.body);
  if (data.paymentType === 'credit' && data.advance > data.amount) throw httpError(400, 'L’avance ne peut pas dépasser le total de la facture.');
  if (!data.clientId === !data.guest) throw httpError(400, 'Choisissez un client existant, ou entrez un nouveau client.');
  if (data.clientId) {
    const [as, ap] = accountScope(req);
    const [client] = await query(`SELECT u.id FROM users u WHERE u.id = ? AND u.role = 'client' AND ${as}`, [data.clientId, ...ap]);
    if (!client) throw httpError(404, 'Client introuvable.');
  } else if (data.eventId) {
    throw httpError(400, 'Une galerie ne peut être liée qu’à un client inscrit.');
  }
  if (data.eventId) {
    const [es, ep] = eventScope(req);
    const [event] = await query(`SELECT e.id FROM events e WHERE e.id = ? AND e.client_id = ? AND ${es}`, [data.eventId, data.clientId, ...ep]);
    if (!event) throw httpError(404, 'Galerie introuvable pour ce client.');
  }
  let id;
  for (let attempt = 0; attempt < 5; attempt++) {
    id = crypto.randomUUID();
    try {
      await query(
        `INSERT INTO invoices (id, staff_id, client_id, event_id, number, title, notes, currency, total, issued_at, due_date, public_token, payment_type, guest_name, guest_email, guest_phone)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_DATE), ?, ?, ?, ?, ?, ?)`,
        [id, req.user.id, data.clientId, data.eventId, await nextNumber(req.user.id), data.title, data.notes, data.currency, data.amount, data.issuedAt, data.dueDate, newToken(), data.paymentType,
          data.guest?.name ?? null, data.guest?.email ?? null, data.guest?.phone ?? null],
      );
      break;
    } catch (err) {
      if (err.code !== '23505' || attempt === 4) throw err; // numéro déjà pris (deux créations en même temps) : on réessaie
    }
  }
  // Cash : payée en totalité maintenant. Crédit : l'avance éventuelle est enregistrée comme premier paiement.
  const first = data.paymentType === 'cash' ? data.amount : data.advance;
  if (first > 0) {
    await query('INSERT INTO payments (id, invoice_id, amount, method, paid_at, note) VALUES (?, ?, ?, ?, COALESCE(?, CURRENT_DATE), ?)', [
      crypto.randomUUID(), id, first, data.advanceMethod, data.issuedAt, data.paymentType === 'cash' ? 'Paiement comptant' : 'Avance à la commande',
    ]);
  }
  audit(req, 'invoice.create', { entity: 'invoice', entityId: id, details: { client: data.clientId || `hors système : ${data.guest?.name}`, amount: data.amount, currency: data.currency, type: data.paymentType, advance: first } });
  res.status(201).json({ invoice: (await loadInvoice(req, id)).invoice });
});

billingRouter.patch('/invoices/:id', async (req, res) => {
  const { row, invoice } = await loadInvoice(req, req.params.id);
  const data = z.object({
    title: text(200, 'Le titre de la facture est obligatoire.').optional(),
    amount: money.optional(),
    dueDate: patchDay,
    notes: z.string().trim().max(1000).optional().transform((v) => (v === undefined ? undefined : v || null)),
    cancelled: z.boolean().optional(),
  }).parse(req.body);
  if (data.amount !== undefined && data.amount < invoice.paid) throw httpError(400, `Le total ne peut pas être inférieur à ce qui est déjà payé (${invoice.paid}).`);
  await query(
    'UPDATE invoices SET title = ?, total = ?, due_date = ?, notes = ?, cancelled = ? WHERE id = ?',
    [
      data.title ?? row.title,
      data.amount ?? row.total,
      data.dueDate !== undefined ? data.dueDate : row.due_date,
      data.notes !== undefined ? data.notes : row.notes,
      data.cancelled === undefined ? row.cancelled : data.cancelled ? 1 : 0,
      row.id,
    ],
  );
  audit(req, 'invoice.update', { entity: 'invoice', entityId: row.id });
  res.json({ invoice: (await loadInvoice(req, row.id)).invoice });
});

billingRouter.delete('/invoices/:id', async (req, res) => {
  const { row } = await loadInvoice(req, req.params.id);
  await query('DELETE FROM invoices WHERE id = ?', [row.id]); // paiements : ON DELETE CASCADE
  audit(req, 'invoice.delete', { entity: 'invoice', entityId: row.id, details: { number: row.number } });
  res.status(204).end();
});

// ---------- Paiements ----------
billingRouter.post('/invoices/:id/payments', async (req, res) => {
  const { row, invoice } = await loadInvoice(req, req.params.id);
  if (invoice.status === 'cancelled') throw httpError(400, 'Cette facture est annulée.');
  const data = z.object({
    amount: money,
    method: z.enum(METHODS).default('especes'),
    paidAt: optionalDay,
    note: z.string().trim().max(200).optional().transform((v) => v || null),
  }).parse(req.body);
  if (data.amount > invoice.balance + 0.004) throw httpError(400, `Le paiement dépasse le solde restant (${invoice.balance} ${invoice.currency}).`);
  const id = crypto.randomUUID();
  await query('INSERT INTO payments (id, invoice_id, amount, method, paid_at, note) VALUES (?, ?, ?, ?, COALESCE(?, CURRENT_DATE), ?)', [
    id, row.id, data.amount, data.method, data.paidAt, data.note,
  ]);
  audit(req, 'payment.create', { entity: 'invoice', entityId: row.id, details: { amount: data.amount, method: data.method } });
  res.status(201).json({ invoice: (await loadInvoice(req, row.id)).invoice });
});

billingRouter.delete('/payments/:id', async (req, res) => {
  const [p] = await query(
    'SELECT p.id, p.invoice_id FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE p.id = ? AND i.staff_id = ?',
    [uuid.parse(req.params.id), req.user.id],
  );
  if (!p) throw httpError(404, 'Paiement introuvable.');
  await query('DELETE FROM payments WHERE id = ?', [p.id]);
  audit(req, 'payment.delete', { entity: 'invoice', entityId: p.invoice_id });
  res.json({ invoice: (await loadInvoice(req, p.invoice_id)).invoice });
});

// Rappels automatiques par e-mail (3 jours avant l'échéance, puis après) : réglage du photographe.
billingRouter.patch('/billing/settings', async (req, res) => {
  const { autoReminders } = z.object({ autoReminders: z.boolean() }).parse(req.body);
  await query('UPDATE users SET auto_reminders = ? WHERE id = ?', [autoReminders ? 1 : 0, req.user.id]);
  res.json({ autoReminders });
});

// ---------- Historique des rappels de paiement (e-mail, WhatsApp, appel) ----------
async function logReminder(staffId, invoiceId, channel, status = 'sent') {
  await query('INSERT INTO reminder_log (id, staff_id, invoice_id, channel, status) VALUES (?, ?, ?, ?, ?)', [crypto.randomUUID(), staffId, invoiceId, channel, status]);
  if (status === 'sent') await query('UPDATE invoices SET reminded_at = CURRENT_TIMESTAMP WHERE id = ?', [invoiceId]);
}
// WhatsApp et appel se font hors du site : le photographe enregistre le rappel d'un clic.
billingRouter.post('/invoices/:id/reminded', async (req, res) => {
  const { channel } = z.object({ channel: z.enum(['whatsapp', 'call', 'sms']) }).parse(req.body);
  const { row } = await loadInvoice(req, req.params.id);
  await logReminder(req.user.id, row.id, channel);
  res.json({ invoice: (await loadInvoice(req, row.id)).invoice });
});

// ---------- Envoi par e-mail : facture et rappel de paiement ----------
async function mailInvoice(req, res, kind, template) {
  const { row, invoice } = await loadInvoice(req, req.params.id);
  if (invoice.status === 'cancelled') throw httpError(400, 'Cette facture est annulée.');
  if (kind === 'invoice_reminder' && invoice.status === 'paid') throw httpError(400, 'Cette facture est déjà payée : aucun rappel à envoyer.');
  if (!invoice.client.email) throw httpError(400, 'Ce client n’a pas d’adresse e-mail : envoyez le lien de la facture par WhatsApp.');
  const tpl = template({
    name: invoice.client.name, studio: req.user.sender_name || req.user.name, invoice, url: invoiceUrl(row.public_token),
  });
  pushLater(row.client_id, { title: kind === 'invoice' ? 'Nouvelle facture' : 'Rappel de paiement', body: `${invoice.number} · reste ${invoice.balance} ${invoice.currency}`, url: invoiceUrl(row.public_token).replace(/^https?:\/\/[^/]+/, ''), tag: `invoice-${row.id}` });
  const email = await sendMail({ to: invoice.client.email, userId: row.client_id, sentBy: req.user.id, kind, ...sender(req.user), ...tpl });
  if (email.status === 'sent') {
    await query(`UPDATE invoices SET ${kind === 'invoice' ? 'sent_at' : 'reminded_at'} = CURRENT_TIMESTAMP WHERE id = ?`, [row.id]);
  }
  if (kind === 'invoice_reminder') await logReminder(req.user.id, row.id, 'email', email.status === 'sent' ? 'sent' : 'failed');
  audit(req, kind === 'invoice' ? 'invoice.send' : 'invoice.remind', { entity: 'invoice', entityId: row.id, details: { status: email.status } });
  res.json({ email, invoice: (await loadInvoice(req, row.id)).invoice });
}
billingRouter.post('/invoices/:id/send', (req, res) => mailInvoice(req, res, 'invoice', invoiceEmail));
billingRouter.post('/invoices/:id/remind', (req, res) => mailInvoice(req, res, 'invoice_reminder', paymentReminderEmail));

// ---------- Rappels (mémos du photographe) ----------
billingRouter.post('/reminders', async (req, res) => {
  const data = z.object({
    title: text(200, 'Écrivez le rappel.'),
    dueAt: day,
    clientId: z.union([uuid, z.literal('')]).optional().transform((v) => v || null),
    invoiceId: z.union([uuid, z.literal('')]).optional().transform((v) => v || null),
  }).parse(req.body);
  if (data.clientId) {
    const [as, ap] = accountScope(req);
    const [c] = await query(`SELECT u.id FROM users u WHERE u.id = ? AND u.role = 'client' AND ${as}`, [data.clientId, ...ap]);
    if (!c) throw httpError(404, 'Client introuvable.');
  }
  if (data.invoiceId) {
    const [i] = await query('SELECT id FROM invoices WHERE id = ? AND staff_id = ?', [data.invoiceId, req.user.id]);
    if (!i) throw httpError(404, 'Facture introuvable.');
  }
  const id = crypto.randomUUID();
  await query('INSERT INTO reminders (id, staff_id, client_id, invoice_id, title, due_at) VALUES (?, ?, ?, ?, ?, ?)', [
    id, req.user.id, data.clientId, data.invoiceId, data.title, data.dueAt,
  ]);
  res.status(201).json({ id });
});

billingRouter.patch('/reminders/:id', async (req, res) => {
  const { done } = z.object({ done: z.boolean() }).parse(req.body);
  const result = await query('UPDATE reminders SET done = ? WHERE id = ? AND staff_id = ?', [done ? 1 : 0, uuid.parse(req.params.id), req.user.id]);
  if (!result.affectedRows) throw httpError(404, 'Rappel introuvable.');
  res.status(204).end();
});

billingRouter.delete('/reminders/:id', async (req, res) => {
  const result = await query('DELETE FROM reminders WHERE id = ? AND staff_id = ?', [uuid.parse(req.params.id), req.user.id]);
  if (!result.affectedRows) throw httpError(404, 'Rappel introuvable.');
  res.status(204).end();
});

// ---------- Page publique d'une facture (lien secret envoyé au client, sans connexion) ----------
export const invoiceApi = Router();

invoiceApi.get('/:token', async (req, res) => {
  const token = z.string().regex(/^[A-Za-z0-9_-]{12,32}$/, 'Lien invalide.').parse(req.params.token);
  const [row] = await query(
    `${INVOICE_SELECT} WHERE i.public_token = ?`, [token],
  );
  if (!row) throw httpError(404, 'Facture introuvable.');
  const [studio] = await query('SELECT name, sender_name, email, phone, whatsapp, website, address, instagram, bio, avatar_key, moncash_number, natcash_number, pay_note, contract_signature, doc_title, doc_subtitle, job_title FROM users WHERE id = ?', [row.staff_id]);
  const payments = await query('SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_at, created_at', [row.id]);
  const inv = mapInvoice(row, payments);
  res.set('Cache-Control', 'no-store').json({
    number: inv.number, title: inv.title, notes: inv.notes, paymentType: inv.paymentType, currency: inv.currency, total: inv.total, paid: inv.paid, balance: inv.balance,
    status: inv.status, issuedAt: inv.issuedAt, dueDate: inv.dueDate, event: inv.eventName,
    client: { name: inv.client.name },
    payments: inv.payments.map((p) => ({ amount: p.amount, method: p.method, paidAt: p.paidAt })),
    studio: {
      name: studio?.sender_name || studio?.name || 'KentraPix', person: studio?.name || '', email: studio?.email || '', phone: studio?.phone || '',
      whatsapp: studio?.whatsapp || studio?.phone || '', website: studio?.website || '', address: studio?.address || '',
      instagram: studio?.instagram || '', bio: studio?.bio || '',
      // En-tête de la fiche et métier : choisis par le photographe dans son profil (vides = KentraPix / Photographe).
      docTitle: studio?.doc_title || '', docSubtitle: studio?.doc_subtitle || '', jobTitle: studio?.job_title || '',
      avatar: studio?.avatar_key ? `/api/invoice/${token}/avatar` : null, pay: payInfo(studio), signature: studio?.contract_signature || null,
    },
  });
});

// Logo / photo du photographe sur la facture (accessible seulement avec le lien secret de cette facture).
invoiceApi.get('/:token/avatar', async (req, res) => {
  const token = z.string().regex(/^[A-Za-z0-9_-]{12,32}$/, 'Lien invalide.').parse(req.params.token);
  const [row] = await query('SELECT u.avatar_key FROM invoices i JOIN users u ON u.id = i.staff_id WHERE i.public_token = ?', [token]);
  if (!row?.avatar_key) throw httpError(404, 'Image introuvable.');
  await sendPrivate(res, row.avatar_key);
});

// ---------- Espace client : ses factures + où envoyer le paiement (MonCash / NatCash : instructions seulement) ----------
export const clientInvoices = Router();

export const payInfo = (s) => ({
  moncash: s?.moncash_number || '', natcash: s?.natcash_number || '', note: s?.pay_note || '', whatsapp: s?.whatsapp || s?.phone || '',
});

clientInvoices.get('/', async (req, res) => {
  const rows = await query(`${INVOICE_SELECT} WHERE i.client_id = ? AND i.cancelled = 0 ORDER BY i.issued_at DESC, i.created_at DESC`, [req.user.id]);
  const payments = rows.length
    ? await query(`SELECT * FROM payments WHERE invoice_id IN (${rows.map(() => '?').join(', ')}) ORDER BY paid_at, created_at`, rows.map((r) => r.id))
    : [];
  const studios = rows.length
    ? await query(`SELECT id, name, sender_name, phone, whatsapp, moncash_number, natcash_number, pay_note FROM users WHERE id IN (${[...new Set(rows.map((r) => r.staff_id))].map(() => '?').join(', ')})`, [...new Set(rows.map((r) => r.staff_id))])
    : [];
  const byStudio = Object.fromEntries(studios.map((s) => [s.id, s]));
  res.json({
    invoices: rows.map((r) => {
      const inv = mapInvoice(r, payments.filter((p) => p.invoice_id === r.id));
      const s = byStudio[r.staff_id];
      return {
        id: inv.id, number: inv.number, title: inv.title, currency: inv.currency, total: inv.total, paid: inv.paid, balance: inv.balance, status: inv.status,
        issuedAt: inv.issuedAt, dueDate: inv.dueDate, url: inv.url, event: inv.eventName || '',
        studio: s?.sender_name || s?.name || '', pay: payInfo(s),
      };
    }),
  });
});
