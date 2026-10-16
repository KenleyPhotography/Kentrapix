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
import { contractEmail } from '../lib/emails.js';
import { accountScope } from '../lib/scope.js';
import { studioToday } from '../lib/booking.js';
import { CONTRACT_SELECT, mapContract, contractUrl, newContractToken, bodyHash, unsignedBookings } from '../lib/contracts.js';

// ====================================================================================================
//  Photographe : rédiger, envoyer et suivre les contrats (monté dans le routeur du studio)
// ====================================================================================================
export const staffContracts = Router();

const PNG = 'data:image/png;base64,';
const pngData = z.string().max(150_000, 'Signature trop lourde.').startsWith(PNG, 'Signature invalide.').refine((v) => {
  const png = Buffer.from(v.slice(PNG.length), 'base64');
  return png.length >= 300 && png.subarray(0, 4).toString('hex') === '89504e47';
}, 'Dessinez votre signature dans le cadre.');
const mySignature = async (userId) => (await query('SELECT contract_signature FROM users WHERE id = ?', [userId]))[0]?.contract_signature || null;

// Signature du photographe : dessinée une fois, apposée sur chacun de ses contrats et de ses factures.
staffContracts.get('/signature', async (req, res) => {
  res.json({ signature: await mySignature(req.user.id) });
});
staffContracts.put('/signature', async (req, res) => {
  const { signature } = z.object({ signature: pngData }).parse(req.body);
  await query('UPDATE users SET contract_signature = ? WHERE id = ?', [signature, req.user.id]);
  res.json({ signature });
});

async function loadContract(req, id) {
  const [row] = await query(`${CONTRACT_SELECT} WHERE c.id = ? AND c.staff_id = ?`, [uuid.parse(id), req.user.id]);
  if (!row) throw httpError(404, 'Contrat introuvable.');
  return row;
}

// Contrats + séances confirmées à venir qui n'ont toujours pas de contrat signé (« pas de séance sans papier signé »).
staffContracts.get('/', async (req, res) => {
  const [rows, missing, templates] = await Promise.all([
    query(`${CONTRACT_SELECT} WHERE c.staff_id = ? ORDER BY c.created_at DESC`, [req.user.id]),
    unsignedBookings(req.user.id, studioToday()),
    query('SELECT id, name, body FROM contract_templates WHERE staff_id = ? ORDER BY name', [req.user.id]),
  ]);
  res.json({
    mySignature: await mySignature(req.user.id),
    templates,
    contracts: rows.map(mapContract),
    unsigned: missing.map((b) => ({
      bookingId: b.id, day: String(b.day).slice(0, 10), start: b.start_time, sessionType: b.session_type, clientId: b.client_id, clientName: b.client_name,
      hasPending: rows.some((c) => c.client_id === b.client_id && c.status === 'pending'),
    })),
  });
});

const createSchema = z.object({
  clientId: uuid,
  bookingId: z.union([uuid, z.literal('')]).optional().transform((v) => v || null),
  title: z.string().trim().min(1, 'Le titre du contrat est obligatoire.').max(200),
  body: z.string().trim().min(30, 'Le contrat est trop court.').max(20000, 'Le contrat est trop long (20 000 caractères max).'),
});

staffContracts.post('/', async (req, res) => {
  const data = createSchema.parse(req.body);
  const [as, ap] = accountScope(req);
  const [client] = await query(`SELECT u.id FROM users u WHERE u.id = ? AND u.role = 'client' AND ${as}`, [data.clientId, ...ap]);
  if (!client) throw httpError(404, 'Client introuvable.');
  if (data.bookingId) {
    const [b] = await query('SELECT id FROM bookings WHERE id = ? AND staff_id = ? AND client_id = ?', [data.bookingId, req.user.id, data.clientId]);
    if (!b) throw httpError(404, 'Rendez-vous introuvable pour ce client.');
  }
  const signature = await mySignature(req.user.id);
  if (!signature) throw httpError(400, 'Dessinez d’abord votre signature (bouton « Ma signature »).');
  const id = crypto.randomUUID();
  await query('INSERT INTO contracts (id, staff_id, client_id, booking_id, title, body, public_token, staff_signature, staff_signed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)', [
    id, req.user.id, data.clientId, data.bookingId, data.title, data.body, newContractToken(), signature,
  ]);
  audit(req, 'contract.create', { entity: 'contract', entityId: id, details: { client: data.clientId } });
  res.status(201).json({ contract: mapContract(await loadContract(req, id)) });
});

// Modèles de contrat du photographe : texte réutilisable ({{client}}, {{studio}}, {{session}}, {{date}}, {{place}}, {{price}}, {{deposit}}).
const templateSchema = z.object({
  name: z.string().trim().min(1, 'Donnez un nom au modèle.').max(80),
  body: z.string().trim().min(30, 'Le modèle est trop court.').max(20000),
});
staffContracts.post('/templates', async (req, res) => {
  const data = templateSchema.parse(req.body);
  const [{ n }] = await query('SELECT COUNT(*) AS n FROM contract_templates WHERE staff_id = ?', [req.user.id]);
  if (Number(n) >= 30) throw httpError(400, '30 modèles maximum : supprimez-en un d’abord.');
  const id = crypto.randomUUID();
  await query('INSERT INTO contract_templates (id, staff_id, name, body) VALUES (?, ?, ?, ?)', [id, req.user.id, data.name, data.body]);
  res.status(201).json({ template: { id, name: data.name, body: data.body } });
});
staffContracts.put('/templates/:id', async (req, res) => {
  const data = templateSchema.parse(req.body);
  const done = await query('UPDATE contract_templates SET name = ?, body = ? WHERE id = ? AND staff_id = ?', [data.name, data.body, uuid.parse(req.params.id), req.user.id]);
  if (!done.affectedRows) throw httpError(404, 'Modèle introuvable.');
  res.json({ template: { id: req.params.id, name: data.name, body: data.body } });
});
staffContracts.delete('/templates/:id', async (req, res) => {
  const done = await query('DELETE FROM contract_templates WHERE id = ? AND staff_id = ?', [uuid.parse(req.params.id), req.user.id]);
  if (!done.affectedRows) throw httpError(404, 'Modèle introuvable.');
  res.status(204).end();
});

// Un contrat signé ne se modifie jamais : on l'annule et on en rédige un nouveau.
staffContracts.patch('/:id', async (req, res) => {
  const row = await loadContract(req, req.params.id);
  if (row.status === 'signed') throw httpError(400, 'Ce contrat est déjà signé : il ne peut plus être modifié.');
  const data = z.object({
    title: createSchema.shape.title.optional(),
    body: createSchema.shape.body.optional(),
    cancelled: z.boolean().optional(),
  }).parse(req.body);
  await query('UPDATE contracts SET title = ?, body = ?, status = ? WHERE id = ?', [
    data.title ?? row.title, data.body ?? row.body, data.cancelled === undefined ? row.status : data.cancelled ? 'cancelled' : 'pending', row.id,
  ]);
  audit(req, 'contract.update', { entity: 'contract', entityId: row.id });
  res.json({ contract: mapContract(await loadContract(req, row.id)) });
});

staffContracts.delete('/:id', async (req, res) => {
  const row = await loadContract(req, req.params.id);
  if (row.status === 'signed') throw httpError(400, 'Un contrat signé ne peut pas être supprimé (preuve de l’accord).');
  await query('DELETE FROM contracts WHERE id = ?', [row.id]);
  audit(req, 'contract.delete', { entity: 'contract', entityId: row.id });
  res.status(204).end();
});

staffContracts.post('/:id/send', async (req, res) => {
  const row = await loadContract(req, req.params.id);
  if (row.status !== 'pending') throw httpError(400, 'Seul un contrat en attente de signature peut être envoyé.');
  const studio = req.user.sender_name || req.user.name;
  const url = contractUrl(row.public_token);
  pushLater(row.client_id, { title: 'Contrat à signer', body: `${studio} · ${row.title}`, url: url.replace(/^https?:\/\/[^/]+/, ''), tag: `contract-${row.id}` });
  const email = await sendMail({
    to: row.client_email, userId: row.client_id, sentBy: req.user.id, kind: 'contract', fromName: studio, replyTo: req.user.email,
    ...contractEmail({ name: row.client_name, studio, title: row.title, url }),
  });
  if (email.status === 'sent') await query('UPDATE contracts SET sent_at = CURRENT_TIMESTAMP WHERE id = ?', [row.id]);
  audit(req, 'contract.send', { entity: 'contract', entityId: row.id, details: { status: email.status } });
  res.json({ email, contract: mapContract(await loadContract(req, row.id)) });
});

// ====================================================================================================
//  Page publique d'un contrat (lien secret envoyé au client, sans connexion)
// ====================================================================================================
export const contractApi = Router();
const tokenOf = (req) => z.string().regex(/^[A-Za-z0-9_-]{32}$/, 'Lien invalide.').parse(req.params.token);

// Le lien seul ne suffit pas : il faut être connecté avec le compte du client destinataire (ou celui du photographe auteur).
// Un client qui transmet le lien à un proche ne lui donne donc aucun accès, et personne d'autre ne peut signer à sa place.
function guard(req, row) {
  if (!req.user) throw httpError(401, 'Connectez-vous avec votre compte pour ouvrir ce contrat.');
  if (req.user.id !== row.client_id && req.user.id !== row.staff_id) throw httpError(403, 'Ce contrat est réservé à son destinataire. Connectez-vous avec le compte à qui il a été envoyé.');
}

contractApi.get('/:token', async (req, res) => {
  const token = tokenOf(req);
  const [row] = await query(`${CONTRACT_SELECT} WHERE c.public_token = ?`, [token]);
  if (!row || row.status === 'cancelled') throw httpError(404, 'Contrat introuvable ou annulé.');
  guard(req, row);
  const [studio] = await query('SELECT name, sender_name, email, phone, whatsapp, website, address, instagram, avatar_key FROM users WHERE id = ?', [row.staff_id]);
  const c = mapContract(row);
  res.set('Cache-Control', 'no-store').json({
    title: row.title, body: row.body, status: row.status, clientName: row.client_name, canSign: req.user.id === row.client_id,
    createdAt: c.createdAt, signedAt: c.signedAt, signedName: c.signedName,
    signature: row.status === 'signed' ? row.signature : null,
    staffSignature: row.staff_signature || null, staffSignedAt: mapContract({ ...row, signed_at: row.staff_signed_at }).signedAt,
    hash: row.status === 'signed' ? row.body_hash : null,
    studio: {
      name: studio?.sender_name || studio?.name || 'KentraPix', person: studio?.name || '', email: studio?.email || '', phone: studio?.phone || '',
      whatsapp: studio?.whatsapp || studio?.phone || '', website: studio?.website || '', address: studio?.address || '', instagram: studio?.instagram || '',
      avatar: studio?.avatar_key ? `/api/contract/${token}/avatar` : null,
    },
  });
});

contractApi.get('/:token/avatar', async (req, res) => {
  const [row] = await query('SELECT u.avatar_key, c.client_id, c.staff_id FROM contracts c JOIN users u ON u.id = c.staff_id WHERE c.public_token = ?', [tokenOf(req)]);
  if (!row) throw httpError(404, 'Image introuvable.');
  guard(req, row);
  if (!row.avatar_key) throw httpError(404, 'Image introuvable.');
  await sendPrivate(res, row.avatar_key);
});

const signSchema = z.object({
  name: z.string().trim().min(3, 'Écrivez votre nom complet.').max(120),
  agree: z.literal(true, { errorMap: () => ({ message: 'Cochez la case pour accepter le contrat.' }) }),
  signature: pngData,
});

contractApi.post('/:token/sign', async (req, res) => {
  const token = tokenOf(req);
  const data = signSchema.parse(req.body);
  const [row] = await query('SELECT * FROM contracts WHERE public_token = ?', [token]);
  if (!row || row.status === 'cancelled') throw httpError(404, 'Contrat introuvable ou annulé.');
  guard(req, row);
  if (req.user.id !== row.client_id) throw httpError(403, 'Seul le client destinataire peut signer ce contrat.');
  if (row.status === 'signed') throw httpError(409, 'Ce contrat est déjà signé.');
  const signedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const done = await query(
    `UPDATE contracts SET status = 'signed', signed_name = ?, signature = ?, signed_at = ?, signed_ip = ?, signed_agent = ?, body_hash = ?
     WHERE id = ? AND status = 'pending'`,
    [data.name, data.signature, signedAt, req.ip ?? null, String(req.get('user-agent') || '').slice(0, 300), bodyHash(row.body, data.name, signedAt), row.id],
  );
  if (!done.affectedRows) throw httpError(409, 'Ce contrat est déjà signé.');
  pushLater(row.staff_id, { title: 'Contrat signé', body: `${data.name} · ${row.title}`, url: '/admin', tag: `contract-${row.id}` });
  res.json({ ok: true });
});

// ====================================================================================================
//  Espace client : ses contrats (lecture seule ; la signature se fait sur la page du contrat)
// ====================================================================================================
export const clientContracts = Router();
clientContracts.get('/', async (req, res) => {
  const rows = await query(
    `SELECT c.*, u.name AS client_name, u.email AS client_email, u.phone AS client_phone, u.whatsapp AS client_whatsapp, b.day AS booking_day, b.start_time AS booking_start,
            s.name AS staff_name, s.sender_name AS staff_sender
     FROM contracts c JOIN users u ON u.id = c.client_id JOIN users s ON s.id = c.staff_id LEFT JOIN bookings b ON b.id = c.booking_id
     WHERE c.client_id = ? AND c.status <> 'cancelled' ORDER BY c.created_at DESC`,
    [req.user.id],
  );
  res.json({ contracts: rows.map((r) => ({ ...mapContract(r), studio: r.staff_sender || r.staff_name })) });
});
