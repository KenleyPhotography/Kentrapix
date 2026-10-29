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
import { accountScope, clientScope } from '../lib/scope.js';
import { studioToday } from '../lib/booking.js';
import { CONTRACT_SELECT, mapContract, contractUrl, newContractToken, bodyHash, unsignedBookings, parseChoices } from '../lib/contracts.js';

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

async function loadContract(req, id, kind = 'photo') {
  const [row] = await query(`${CONTRACT_SELECT} WHERE c.id = ? AND c.staff_id = ? AND c.kind = ?`, [uuid.parse(id), req.user.id, kind]);
  if (!row) throw httpError(404, 'Contrat introuvable.');
  return row;
}

// Contrats + séances confirmées à venir qui n'ont toujours pas de contrat signé (« pas de séance sans papier signé »).
staffContracts.get('/', async (req, res) => {
  const [rows, missing, templates] = await Promise.all([
    query(`${CONTRACT_SELECT} WHERE c.staff_id = ? AND c.kind = 'photo' ORDER BY c.created_at DESC`, [req.user.id]),
    unsignedBookings(req.user.id, studioToday()),
    query("SELECT id, name, body FROM contract_templates WHERE staff_id = ? AND kind = 'photo' ORDER BY name", [req.user.id]),
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

// Objet : la ligne en tête du contrat, écrite par le photographe. Vide = texte par défaut du type.
const subjectRule = z.string().trim().max(120, 'Objet trop long (120 caractères max).');

const createSchema = z.object({
  clientId: uuid.optional(),
  // Personne sans compte : nom + téléphone suffisent (e-mail facultatif) ; elle signe depuis le lien, sans se connecter.
  guest: z.object({
    name: z.string().trim().min(2, 'Entrez le nom de la personne.').max(80),
    phone: z.string().trim().max(40).optional().default(''),
    email: z.union([z.literal(''), z.string().trim().toLowerCase().email('E-mail invalide.').max(190)]).optional().default(''),
  }).optional(),
  bookingId: z.union([uuid, z.literal('')]).optional().transform((v) => v || null),
  subject: subjectRule.optional().default(''),
  title: z.string().trim().min(1, 'Le titre du contrat est obligatoire.').max(200),
  body: z.string().trim().min(30, 'Le contrat est trop court.').max(20000, 'Le contrat est trop long (20 000 caractères max).'),
});

staffContracts.post('/', async (req, res) => {
  const data = createSchema.parse(req.body);
  if (!data.clientId && !data.guest) throw httpError(400, 'Choisissez un client ou entrez le nom de la personne.');
  if (data.clientId) {
    const [as, ap] = accountScope(req);
    const [cs, cp] = clientScope(req);
    const [client] = await query(`SELECT u.id FROM users u WHERE u.id = ? AND ${cs} AND ${as}`, [data.clientId, ...cp, ...ap]);
    if (!client) throw httpError(404, 'Client introuvable.');
  }
  if (data.bookingId && data.clientId) {
    const [b] = await query('SELECT id FROM bookings WHERE id = ? AND staff_id = ? AND client_id = ?', [data.bookingId, req.user.id, data.clientId]);
    if (!b) throw httpError(404, 'Rendez-vous introuvable pour ce client.');
  }
  // La signature enregistrée du photographe est apposée automatiquement ; sans signature enregistrée, il signe sur la page du contrat.
  const signature = await mySignature(req.user.id);
  const id = crypto.randomUUID();
  await query(
    `INSERT INTO contracts (id, staff_id, client_id, guest_name, guest_phone, guest_email, booking_id, subject, title, body, public_token, staff_signature, staff_signed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${signature ? 'CURRENT_TIMESTAMP' : 'NULL'})`,
    [id, req.user.id, data.clientId || null, data.clientId ? null : data.guest.name, data.clientId ? null : data.guest.phone || null, data.clientId ? null : data.guest.email || null,
      data.clientId ? data.bookingId : null, data.subject || null, data.title, data.body, newContractToken(), signature],
  );
  audit(req, 'contract.create', { entity: 'contract', entityId: id, details: { client: data.clientId || 'hors système' } });
  res.status(201).json({ contract: mapContract(await loadContract(req, id)) });
});

// Fiche d'un projet de site internet : tout est facultatif, le contrat se remplit avec ce qui est saisi.
const sheetSchema = z.object({
  company: z.string().trim().max(120),
  siteType: z.string().trim().max(60),
  domain: z.string().trim().max(120),
  pages: z.string().trim().max(30),
  languages: z.string().trim().max(60),
  features: z.array(z.string().trim().max(90)).max(40),
  price: z.string().trim().max(40),
  deposit: z.string().trim().max(40),
  hosting: z.string().trim().max(40),
  maintenance: z.string().trim().max(40),
  hostingPlan: z.string().trim().max(120),
  delay: z.string().trim().max(30),
  launch: z.string().trim().max(40),
  revisions: z.string().trim().max(20),
  warranty: z.string().trim().max(20),
  content: z.string().trim().max(200),
  training: z.string().trim().max(200),
  notes: z.string().trim().max(300),
}).partial();

// Coordonnées d'un client « site internet » : saisies à la main, aucun compte nécessaire.
const webClientSchema = z.object({
  name: z.string().trim().min(2, 'Entrez le nom du client.').max(80),
  phone: z.string().trim().max(40).optional().default(''),
  email: z.union([z.literal(''), z.string().trim().toLowerCase().email('E-mail invalide.').max(190)]).optional().default(''),
});

// Modèles de contrat enregistrés par le photographe : texte réutilisable ({{client}}, {{studio}}, {{session}}, {{date}}, {{place}}, {{price}}, {{deposit}}…).
// Chaque liste garde ses propres modèles : un modèle de site internet n'apparaît jamais dans les contrats photo.
const templateSchema = z.object({
  name: z.string().trim().min(1, 'Donnez un nom au modèle.').max(80),
  body: z.string().trim().min(30, 'Le modèle est trop court.').max(20000),
});

/** Routes identiques pour les deux listes : modèles, modification, annulation, suppression, envoi par e-mail. */
function mountCommon(r, kind) {
  r.post('/templates', async (req, res) => {
    const data = templateSchema.parse(req.body);
    const [{ n }] = await query('SELECT COUNT(*) AS n FROM contract_templates WHERE staff_id = ? AND kind = ?', [req.user.id, kind]);
    if (Number(n) >= 30) throw httpError(400, '30 modèles maximum : supprimez-en un d’abord.');
    const id = crypto.randomUUID();
    await query('INSERT INTO contract_templates (id, staff_id, kind, name, body) VALUES (?, ?, ?, ?, ?)', [id, req.user.id, kind, data.name, data.body]);
    res.status(201).json({ template: { id, name: data.name, body: data.body } });
  });
  r.put('/templates/:id', async (req, res) => {
    const data = templateSchema.parse(req.body);
    const done = await query('UPDATE contract_templates SET name = ?, body = ? WHERE id = ? AND staff_id = ? AND kind = ?', [data.name, data.body, uuid.parse(req.params.id), req.user.id, kind]);
    if (!done.affectedRows) throw httpError(404, 'Modèle introuvable.');
    res.json({ template: { id: req.params.id, name: data.name, body: data.body } });
  });
  r.delete('/templates/:id', async (req, res) => {
    const done = await query('DELETE FROM contract_templates WHERE id = ? AND staff_id = ? AND kind = ?', [uuid.parse(req.params.id), req.user.id, kind]);
    if (!done.affectedRows) throw httpError(404, 'Modèle introuvable.');
    res.status(204).end();
  });

  // Un contrat signé ne se modifie jamais : on l'annule et on en rédige un nouveau.
  r.patch('/:id', async (req, res) => {
    const row = await loadContract(req, req.params.id, kind);
    if (row.status === 'signed') throw httpError(400, 'Ce contrat est déjà signé : il ne peut plus être modifié.');
    const data = z.object({
      subject: subjectRule.optional(),
      title: createSchema.shape.title.optional(),
      body: createSchema.shape.body.optional(),
      sheet: sheetSchema.optional(),
      client: webClientSchema.optional(),
      cancelled: z.boolean().optional(),
    }).parse(req.body);
    const web = kind === 'web';
    await query(
      `UPDATE contracts SET subject = ?, title = ?, body = ?, status = ?${web ? ', web_sheet = ?, guest_name = ?, guest_phone = ?, guest_email = ?' : ''} WHERE id = ?`,
      [data.subject === undefined ? row.subject : data.subject || null, data.title ?? row.title, data.body ?? row.body,
        data.cancelled === undefined ? row.status : data.cancelled ? 'cancelled' : 'pending',
        ...(web ? [
          data.sheet ? JSON.stringify(data.sheet) : row.web_sheet,
          data.client?.name ?? row.guest_name, data.client?.phone || (data.client ? null : row.guest_phone), data.client?.email || (data.client ? null : row.guest_email),
        ] : []), row.id],
    );
    audit(req, 'contract.update', { entity: 'contract', entityId: row.id, details: { kind } });
    res.json({ contract: mapContract(await loadContract(req, row.id, kind)) });
  });

  r.delete('/:id', async (req, res) => {
    const row = await loadContract(req, req.params.id, kind);
    if (row.status === 'signed') throw httpError(400, 'Un contrat signé ne peut pas être supprimé (preuve de l’accord).');
    await query('DELETE FROM contracts WHERE id = ?', [row.id]);
    audit(req, 'contract.delete', { entity: 'contract', entityId: row.id, details: { kind } });
    res.status(204).end();
  });

  r.post('/:id/send', async (req, res) => {
    const row = await loadContract(req, req.params.id, kind);
    if (row.status !== 'pending') throw httpError(400, 'Seul un contrat en attente de signature peut être envoyé.');
    if (!row.staff_signature) throw httpError(400, 'Signez d’abord le contrat : ouvrez l’aperçu et touchez la zone de signature.');
    if (!row.client_email) throw httpError(400, 'Cette personne n’a pas d’e-mail : envoyez-lui le lien par WhatsApp ou copiez-le.');
    const studio = req.user.sender_name || req.user.name;
    const url = contractUrl(row.public_token);
    if (row.client_id) pushLater(row.client_id, { title: 'Contrat à signer', body: `${studio} · ${row.title}`, url: url.replace(/^https?:\/\/[^/]+/, ''), tag: `contract-${row.id}` });
    const email = await sendMail({
      to: row.client_email, userId: row.client_id, sentBy: req.user.id, kind: 'contract', fromName: studio, replyTo: req.user.email,
      ...contractEmail({ name: row.client_name, studio, title: row.title, url, guest: !row.client_id, web: kind === 'web' }),
    });
    if (email.status === 'sent') await query('UPDATE contracts SET sent_at = CURRENT_TIMESTAMP WHERE id = ?', [row.id]);
    audit(req, 'contract.send', { entity: 'contract', entityId: row.id, details: { kind, status: email.status } });
    res.json({ email, contract: mapContract(await loadContract(req, row.id, kind)) });
  });
}
mountCommon(staffContracts, 'photo');

// ====================================================================================================
//  Contrats de site internet : liste à part, sans aucun lien avec les séances photo ni les rendez-vous
// ====================================================================================================
// La fiche du projet est saisie à la main : le client web n'a pas besoin d'un compte KentraPix.
// Il lit et signe depuis le lien secret, exactement comme une personne « hors système » côté photo.
export const staffWebContracts = Router();

staffWebContracts.get('/', async (req, res) => {
  const [rows, templates] = await Promise.all([
    query(`${CONTRACT_SELECT} WHERE c.staff_id = ? AND c.kind = 'web' ORDER BY c.created_at DESC`, [req.user.id]),
    query("SELECT id, name, body FROM contract_templates WHERE staff_id = ? AND kind = 'web' ORDER BY name", [req.user.id]),
  ]);
  res.json({ mySignature: await mySignature(req.user.id), templates, contracts: rows.map(mapContract) });
});

const webCreateSchema = z.object({
  client: webClientSchema,
  subject: createSchema.shape.subject,
  title: createSchema.shape.title,
  body: createSchema.shape.body,
  sheet: sheetSchema.optional(),
});

staffWebContracts.post('/', async (req, res) => {
  const data = webCreateSchema.parse(req.body);
  // La signature enregistrée du photographe est apposée tout de suite ; sans elle, il signe sur la page du contrat.
  const signature = await mySignature(req.user.id);
  const id = crypto.randomUUID();
  await query(
    `INSERT INTO contracts (id, staff_id, client_id, kind, guest_name, guest_phone, guest_email, subject, title, body, web_sheet, public_token, staff_signature, staff_signed_at)
     VALUES (?, ?, NULL, 'web', ?, ?, ?, ?, ?, ?, ?, ?, ?, ${signature ? 'CURRENT_TIMESTAMP' : 'NULL'})`,
    [id, req.user.id, data.client.name, data.client.phone || null, data.client.email || null, data.subject || null, data.title, data.body,
      data.sheet ? JSON.stringify(data.sheet) : null, newContractToken(), signature],
  );
  audit(req, 'contract.create', { entity: 'contract', entityId: id, details: { kind: 'web', client: data.client.name } });
  res.status(201).json({ contract: mapContract(await loadContract(req, id, 'web')) });
});
mountCommon(staffWebContracts, 'web');

// ====================================================================================================
//  Page publique d'un contrat (lien secret envoyé au client, sans connexion)
// ====================================================================================================
export const contractApi = Router();
const tokenOf = (req) => z.string().regex(/^[A-Za-z0-9_-]{12,32}$/, 'Lien invalide.').parse(req.params.token);

// Le lien seul ne suffit pas : il faut être connecté avec le compte du client destinataire (ou celui du photographe auteur).
// Un client qui transmet le lien à un proche ne lui donne donc aucun accès, et personne d'autre ne peut signer à sa place.
function guard(req, row) {
  if (!row.client_id) return; // personne sans compte : le lien secret (32 caractères) suffit
  if (!req.user) throw httpError(401, 'Connectez-vous avec votre compte pour ouvrir ce contrat.');
  if (req.user.id !== row.client_id && req.user.id !== row.staff_id) throw httpError(403, 'Ce contrat est réservé à son destinataire. Connectez-vous avec le compte à qui il a été envoyé.');
}

// Le signataire : le client connecté, ou toute personne qui ouvre le lien d'un contrat « hors système » (sauf le photographe auteur).
const isClient = (req, row) => (row.client_id ? req.user?.id === row.client_id : req.user?.id !== row.staff_id);

contractApi.get('/:token', async (req, res) => {
  const token = tokenOf(req);
  const [row] = await query(`${CONTRACT_SELECT} WHERE c.public_token = ?`, [token]);
  if (!row || row.status === 'cancelled') throw httpError(404, 'Contrat introuvable ou annulé.');
  guard(req, row);
  const [studio] = await query('SELECT name, sender_name, email, phone, whatsapp, website, address, instagram, avatar_key, job_title FROM users WHERE id = ?', [row.staff_id]);
  const c = mapContract(row);
  res.set('Cache-Control', 'no-store').json({
    subject: row.subject || '', title: row.title, body: row.body, status: row.status, kind: row.kind || 'photo', clientName: row.client_name, guest: !row.client_id,
    canSign: isClient(req, row) && !!row.staff_signature && row.status === 'pending', waitingStaff: isClient(req, row) && !row.staff_signature,
    canStaffSign: req.user?.id === row.staff_id && row.status === 'pending', savedSignature: req.user?.id === row.staff_id && row.status === 'pending' ? await mySignature(req.user.id) : null,
    choices: parseChoices(row.client_choices),
    createdAt: c.createdAt, signedAt: c.signedAt, signedName: c.signedName,
    signature: row.status === 'signed' ? row.signature : null,
    staffSignature: row.staff_signature || null, staffSignedAt: mapContract({ ...row, signed_at: row.staff_signed_at }).signedAt,
    // L'empreinte SHA-256 (body_hash) n'est pas renvoyée : elle reste en base comme preuve du texte signé.
    studio: {
      name: studio?.sender_name || studio?.name || 'KentraPix', person: studio?.name || '', email: studio?.email || '', phone: studio?.phone || '',
      whatsapp: studio?.whatsapp || studio?.phone || '', website: studio?.website || '', address: studio?.address || '', instagram: studio?.instagram || '',
      // Métier choisi dans le profil : remplace « Photographe » sur le contrat (vide = Photographe ; les contrats de site gardent « Prestataire »).
      jobTitle: studio?.job_title || '',
      avatar: studio?.avatar_key ? `/api/contract/${token}/avatar` : null,
    },
  });
});

// Le photographe signe depuis la page du contrat (zone cliquable) : la signature est apposée sur ce contrat.
contractApi.post('/:token/staff-sign', async (req, res) => {
  const token = tokenOf(req);
  const { signature, remember } = z.object({ signature: pngData, remember: z.boolean().optional().default(false) }).parse(req.body);
  const [row] = await query('SELECT * FROM contracts WHERE public_token = ?', [token]);
  if (!row || row.status === 'cancelled') throw httpError(404, 'Contrat introuvable ou annulé.');
  guard(req, row);
  if (req.user?.id !== row.staff_id) throw httpError(403, 'Seul le photographe auteur peut signer ici.');
  if (row.status !== 'pending') throw httpError(409, 'Ce contrat est déjà signé par le client : il ne peut plus être modifié.');
  await query('UPDATE contracts SET staff_signature = ?, staff_signed_at = CURRENT_TIMESTAMP WHERE id = ?', [signature, row.id]);
  if (remember) await query('UPDATE users SET contract_signature = ? WHERE id = ?', [signature, req.user.id]);
  res.json({ ok: true });
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
  // Réserves : lignes que le client n'accepte pas (soulignées), cases cochées / décochées, remarques.
  choices: z.object({
    refused: z.array(z.number().int().min(0).max(1000)).max(300).default([]),
    checks: z.array(z.boolean()).max(100).default([]),
    notes: z.string().trim().max(1000).optional().default(''),
  }).optional(),
});

contractApi.post('/:token/sign', async (req, res) => {
  const token = tokenOf(req);
  const data = signSchema.parse(req.body);
  const [row] = await query('SELECT * FROM contracts WHERE public_token = ?', [token]);
  if (!row || row.status === 'cancelled') throw httpError(404, 'Contrat introuvable ou annulé.');
  guard(req, row);
  if (!isClient(req, row)) throw httpError(403, 'Seul le client destinataire peut signer ce contrat.');
  if (!row.staff_signature) throw httpError(409, 'Le photographe doit d’abord signer ce contrat.');
  if (row.status === 'signed') throw httpError(409, 'Ce contrat est déjà signé.');
  const signedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const choices = data.choices && (data.choices.refused.length || data.choices.checks.length || data.choices.notes) ? JSON.stringify(data.choices) : null;
  const done = await query(
    `UPDATE contracts SET status = 'signed', signed_name = ?, signature = ?, signed_at = ?, signed_ip = ?, signed_agent = ?, body_hash = ?, client_choices = ?
     WHERE id = ? AND status = 'pending'`,
    [data.name, data.signature, signedAt, req.ip ?? null, String(req.get('user-agent') || '').slice(0, 300), bodyHash(`${row.body}\n${choices || ''}`, data.name, signedAt), choices, row.id],
  );
  if (!done.affectedRows) throw httpError(409, 'Ce contrat est déjà signé.');
  pushLater(row.staff_id, { title: 'Contrat signé', body: `${data.name} · ${row.title}${data.choices?.refused.length ? ` · ${data.choices.refused.length} point(s) non accepté(s)` : ''}`, url: '/admin', tag: `contract-${row.id}` });
  res.json({ ok: true });
});

// ====================================================================================================
//  Espace client : ses contrats (lecture seule ; la signature se fait sur la page du contrat)
// ====================================================================================================
export const clientContracts = Router();
clientContracts.get('/', async (req, res) => {
  const rows = await query(
    `SELECT c.*, u.name AS client_name, u.email AS client_email, u.phone AS client_phone, u.whatsapp AS client_whatsapp, b.day AS booking_day, b.start_time AS booking_start, b.orig_day AS booking_orig_day,
            s.name AS staff_name, s.sender_name AS staff_sender
     FROM contracts c JOIN users u ON u.id = c.client_id JOIN users s ON s.id = c.staff_id LEFT JOIN bookings b ON b.id = c.booking_id
     WHERE c.client_id = ? AND c.status <> 'cancelled' ORDER BY c.created_at DESC`,
    [req.user.id],
  );
  res.json({ contracts: rows.map((r) => ({ ...mapContract(r), studio: r.staff_sender || r.staff_name })) });
});
