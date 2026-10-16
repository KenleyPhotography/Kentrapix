import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { z } from 'zod';
import { query } from '../db.js';
import { httpError } from '../lib/errors.js';
import { uuid, CLIENT_HAS } from '../lib/data.js';
import { accountScope } from '../lib/scope.js';
import { upload, storeCover, removeKeys } from '../lib/storage.js';
import { audit } from '../lib/audit.js';
import { sendMail } from '../lib/mailer.js';
import { CURRENCIES, round2 } from '../lib/billing.js';
import { orderRequestEmail, orderStatusEmail } from '../lib/emails.js';

const studioName = (u) => u.sender_name || u.name;
const fire = (promise) => promise.catch((err) => console.error('E-mail commande :', err.message));
export const ORDER_STATUS = ['new', 'accepted', 'production', 'ready', 'delivered', 'cancelled'];
const money = z.coerce.number({ invalid_type_error: 'Prix invalide.' }).min(0, 'Prix invalide.').max(10_000_000).transform(round2);

const mapProduct = (p) => ({
  id: p.id, name: p.name, description: p.description || '', price: Number(p.price), currency: p.currency,
  minPhotos: Number(p.min_photos), maxPhotos: Number(p.max_photos), active: !!p.active,
});

const ORDER_SELECT = `SELECT o.*, c.name AS client_name, c.email AS client_email, c.phone AS client_phone, c.whatsapp AS client_whatsapp,
    COALESCE(NULLIF(s.sender_name, ''), s.name) AS staff_name
  FROM print_orders o JOIN users c ON c.id = o.client_id JOIN users s ON s.id = o.staff_id`;

// Page de couverture de l'album : image envoyée par le photographe, sinon l'une des photos de la commande.
const coverOf = (o) => (o.cover_key
  ? { url: `/media/order-cover/${o.id}?v=${String(o.cover_key).split('/').pop().split('.')[0]}`, custom: true, photoId: null }
  : o.cover_photo_id ? { url: `/media/preview/${o.cover_photo_id}`, custom: false, photoId: o.cover_photo_id } : null);

async function mapOrders(rows) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const photos = await query(
    `SELECT order_id, photo_id, number, filename, event_name FROM print_order_photos WHERE order_id IN (${ids.map(() => '?').join(', ')}) ORDER BY position`,
    ids,
  );
  const byOrder = {};
  for (const p of photos) (byOrder[p.order_id] ??= []).push({ id: p.photo_id, number: Number(p.number), filename: p.filename, event: p.event_name, thumb: p.photo_id ? `/media/thumb/${p.photo_id}` : null });
  return rows.map((o) => ({
    id: o.id, product: o.product_name, unitPrice: Number(o.unit_price), currency: o.currency, quantity: Number(o.quantity),
    total: round2(Number(o.unit_price) * Number(o.quantity)), delivery: o.delivery, address: o.address || '', note: o.note || '',
    status: o.status, reply: o.reply || '', source: o.source || 'client', cover: coverOf(o), createdAt: `${String(o.created_at).replace(' ', 'T')}Z`,
    staff: { id: o.staff_id, name: o.staff_name },
    client: { id: o.client_id, name: o.client_name, email: o.client_email || '', phone: o.client_phone || '', whatsapp: o.client_whatsapp || o.client_phone || '' },
    photos: byOrder[o.id] || [],
  }));
}

// ====================================================================================================
//  Photographe : catalogue et commandes reçues
// ====================================================================================================
export const staffOrders = Router();

staffOrders.get('/', async (req, res) => {
  const [products, rows] = await Promise.all([
    query('SELECT * FROM print_products WHERE staff_id = ? ORDER BY position, created_at', [req.user.id]),
    query(`${ORDER_SELECT} WHERE o.staff_id = ? ORDER BY o.created_at DESC LIMIT 200`, [req.user.id]),
  ]);
  res.json({ products: products.map(mapProduct), orders: await mapOrders(rows), currencies: CURRENCIES });
});

const productSchema = z.object({
  name: z.string().trim().min(1, 'Donnez un nom au produit.').max(120),
  description: z.string().trim().max(400).optional().default(''),
  price: money,
  currency: z.enum(CURRENCIES),
  minPhotos: z.coerce.number().int().min(1).max(500),
  maxPhotos: z.coerce.number().int().min(1).max(500),
  active: z.boolean().optional().default(true),
}).refine((p) => p.maxPhotos >= p.minPhotos, { message: 'Le maximum doit être au moins égal au minimum.' });

staffOrders.post('/products', async (req, res) => {
  const p = productSchema.parse(req.body);
  const id = crypto.randomUUID();
  const [{ n }] = await query('SELECT COALESCE(MAX(position), 0) + 1 AS n FROM print_products WHERE staff_id = ?', [req.user.id]);
  await query(
    'INSERT INTO print_products (id, staff_id, name, description, price, currency, min_photos, max_photos, active, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, req.user.id, p.name, p.description || null, p.price, p.currency, p.minPhotos, p.maxPhotos, p.active ? 1 : 0, n],
  );
  const [row] = await query('SELECT * FROM print_products WHERE id = ?', [id]);
  res.status(201).json({ product: mapProduct(row) });
});

staffOrders.put('/products/:id', async (req, res) => {
  const p = productSchema.parse(req.body);
  const r = await query(
    'UPDATE print_products SET name = ?, description = ?, price = ?, currency = ?, min_photos = ?, max_photos = ?, active = ? WHERE id = ? AND staff_id = ?',
    [p.name, p.description || null, p.price, p.currency, p.minPhotos, p.maxPhotos, p.active ? 1 : 0, uuid.parse(req.params.id), req.user.id],
  );
  if (!r.affectedRows) throw httpError(404, 'Produit introuvable.');
  const [row] = await query('SELECT * FROM print_products WHERE id = ?', [req.params.id]);
  res.json({ product: mapProduct(row) });
});

staffOrders.delete('/products/:id', async (req, res) => {
  const r = await query('DELETE FROM print_products WHERE id = ? AND staff_id = ?', [uuid.parse(req.params.id), req.user.id]);
  if (!r.affectedRows) throw httpError(404, 'Produit introuvable.');
  res.status(204).end();
});

// Changer l'état d'une commande : le client est prévenu par e-mail (sauf retour à « nouvelle »).
staffOrders.patch('/:id', async (req, res) => {
  const { status, reply } = z.object({ status: z.enum(ORDER_STATUS), reply: z.string().trim().max(500).optional().default('') }).parse(req.body);
  const [row] = await query(`${ORDER_SELECT} WHERE o.id = ? AND o.staff_id = ?`, [uuid.parse(req.params.id), req.user.id]);
  if (!row) throw httpError(404, 'Commande introuvable.');
  await query('UPDATE print_orders SET status = ?, reply = ? WHERE id = ?', [status, reply || null, row.id]);
  const [order] = await mapOrders([{ ...row, status, reply }]);
  if (status !== 'new' && row.client_email && status !== row.status) {
    fire(sendMail({
      to: row.client_email, userId: row.client_id, sentBy: req.user.id, kind: 'order', fromName: studioName(req.user), replyTo: req.user.email,
      ...orderStatusEmail({ clientName: row.client_name, studio: studioName(req.user), order, status, reply }),
    }));
  }
  audit(req, 'order.status', { entity: 'order', entityId: row.id, details: { status } });
  res.json({ order });
});

// ---------- Composer l'album soi-même : couverture, photos, commande créée pour un client ----------
const LIBRARY = `SELECT p.id, p.filename, e.name AS event_name,
    (SELECT COUNT(*) FROM photos q WHERE q.event_id = p.event_id AND (q.position < p.position OR (q.position = p.position AND q.created_at <= p.created_at))) AS number
  FROM photos p JOIN events e ON e.id = p.event_id
  WHERE e.created_by = ? AND ${CLIENT_HAS()}
  ORDER BY e.event_date DESC, e.created_at DESC, p.position, p.created_at`;

async function ownOrder(req, id) {
  const [row] = await query(`${ORDER_SELECT} WHERE o.id = ? AND o.staff_id = ?`, [uuid.parse(id), req.user.id]);
  if (!row) throw httpError(404, 'Commande introuvable.');
  return row;
}
const fullOrder = async (req, id) => (await mapOrders([await ownOrder(req, id)]))[0];

/** Photos que le photographe peut mettre dans l'album : celles des galeries qu'il a faites pour ce client. */
staffOrders.get('/:id/library', async (req, res) => {
  const order = await ownOrder(req, req.params.id);
  const rows = await query(LIBRARY, [req.user.id, order.client_id]);
  res.json({ photos: rows.map((p) => ({ id: p.id, number: Number(p.number), filename: p.filename, event: p.event_name, thumb: `/media/thumb/${p.id}` })) });
});

// Remplace les photos de l'album (dans l'ordre choisi).
staffOrders.put('/:id/photos', async (req, res) => {
  const order = await ownOrder(req, req.params.id);
  const { photoIds } = z.object({ photoIds: z.array(uuid).max(500) }).parse(req.body);
  const ids = [...new Set(photoIds)];
  const library = new Map((await query(LIBRARY, [req.user.id, order.client_id])).map((p) => [p.id, p]));
  if (ids.some((id) => !library.has(id))) throw httpError(400, 'Certaines photos ne font pas partie des galeries de ce client.');
  await query('DELETE FROM print_order_photos WHERE order_id = ?', [order.id]);
  let position = 0;
  for (const id of ids) {
    const p = library.get(id);
    await query('INSERT INTO print_order_photos (order_id, photo_id, number, filename, event_name, position) VALUES (?, ?, ?, ?, ?, ?)', [order.id, id, Number(p.number), p.filename, p.event_name || '', position]);
    position += 1;
  }
  // Couverture qui était l'une des photos retirées : on l'enlève.
  if (order.cover_photo_id && !ids.includes(order.cover_photo_id)) await query('UPDATE print_orders SET cover_photo_id = NULL WHERE id = ?', [order.id]);
  audit(req, 'order.photos', { entity: 'order', entityId: order.id, details: { count: ids.length } });
  res.json({ order: await fullOrder(req, order.id) });
});

// Couverture : choisir une photo de l'album (ou aucune)…
staffOrders.put('/:id/cover', async (req, res) => {
  const order = await ownOrder(req, req.params.id);
  const { photoId } = z.object({ photoId: uuid.nullable() }).parse(req.body);
  if (photoId) {
    const [inOrder] = await query('SELECT 1 FROM print_order_photos WHERE order_id = ? AND photo_id = ?', [order.id, photoId]);
    if (!inOrder) throw httpError(400, 'Choisissez une photo de cette commande.');
  }
  await query('UPDATE print_orders SET cover_photo_id = ?, cover_key = NULL WHERE id = ?', [photoId, order.id]);
  await removeKeys([order.cover_key]);
  res.json({ order: await fullOrder(req, order.id) });
});

// … ou envoyer une image de couverture (conçue ailleurs).
staffOrders.post('/:id/cover', upload.single('cover'), async (req, res) => {
  let order;
  try { order = await ownOrder(req, req.params.id); } catch (err) { if (req.file) await fs.rm(req.file.path, { force: true }); throw err; }
  if (!req.file) throw httpError(400, 'Choisissez une image.');
  const key = await storeCover(req.file);
  await query('UPDATE print_orders SET cover_key = ?, cover_photo_id = NULL WHERE id = ?', [key, order.id]);
  await removeKeys([order.cover_key]);
  audit(req, 'order.cover', { entity: 'order', entityId: order.id });
  res.json({ order: await fullOrder(req, order.id) });
});

staffOrders.delete('/:id/cover', async (req, res) => {
  const order = await ownOrder(req, req.params.id);
  await query('UPDATE print_orders SET cover_key = NULL, cover_photo_id = NULL WHERE id = ?', [order.id]);
  await removeKeys([order.cover_key]);
  res.json({ order: await fullOrder(req, order.id) });
});

// Le photographe crée lui-même la commande d'un client (album à composer) : acceptée tout de suite.
staffOrders.post('/', async (req, res) => {
  const data = z.object({
    clientId: uuid,
    productId: uuid.optional().nullable(),
    name: z.string().trim().max(120).optional().default(''),
    price: money.optional().default(0),
    currency: z.enum(CURRENCIES).optional().default('USD'),
    quantity: z.coerce.number().int().min(1).max(50).default(1),
    delivery: z.enum(['pickup', 'delivery']).default('pickup'),
    address: z.string().trim().max(300).optional().default(''),
    note: z.string().trim().max(600).optional().default(''),
  }).parse(req.body);
  const [as, ap] = accountScope(req);
  const [client] = await query(`SELECT u.id FROM users u WHERE u.id = ? AND u.role = 'client' AND ${as}`, [data.clientId, ...ap]);
  if (!client) throw httpError(404, 'Client introuvable.');
  let name = data.name; let price = data.price; let currency = data.currency; let productId = null;
  if (data.productId) {
    const [p] = await query('SELECT * FROM print_products WHERE id = ? AND staff_id = ?', [data.productId, req.user.id]);
    if (!p) throw httpError(404, 'Produit introuvable.');
    name = p.name; price = Number(p.price); currency = p.currency; productId = p.id;
  }
  if (!name) throw httpError(400, 'Choisissez un produit ou donnez un nom à la commande.');
  const id = crypto.randomUUID();
  await query(
    `INSERT INTO print_orders (id, staff_id, client_id, product_id, product_name, unit_price, currency, quantity, delivery, address, note, status, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted', 'studio')`,
    [id, req.user.id, client.id, productId, name, price, currency, data.quantity, data.delivery, data.delivery === 'delivery' ? data.address : null, data.note || null],
  );
  audit(req, 'order.create_studio', { entity: 'order', entityId: id });
  res.status(201).json({ order: await fullOrder(req, id) });
});

// ====================================================================================================
//  Client : commander un album ou des tirages chez l'un de ses photographes
// ====================================================================================================
export function clientOrders({ photographersOf, visiblePhotos }) {
  const router = Router();

  router.get('/', async (req, res) => {
    const staff = await photographersOf(req.user.id);
    const ids = staff.map((s) => s.id);
    const products = ids.length
      ? await query(`SELECT * FROM print_products WHERE active = 1 AND staff_id IN (${ids.map(() => '?').join(', ')}) ORDER BY position, created_at`, ids)
      : [];
    const rows = await query(`${ORDER_SELECT} WHERE o.client_id = ? ORDER BY o.created_at DESC LIMIT 100`, [req.user.id]);
    res.json({
      photographers: staff.map((s) => ({ id: s.id, name: studioName(s), products: products.filter((p) => p.staff_id === s.id).map(mapProduct) })),
      orders: await mapOrders(rows),
    });
  });

  router.post('/', async (req, res) => {
    const data = z.object({
      staffId: uuid, productId: uuid,
      quantity: z.coerce.number().int().min(1, 'Quantité invalide.').max(50, 'Cinquante exemplaires au maximum.'),
      photoIds: z.array(uuid).min(1, 'Choisissez au moins une photo.').max(500),
      delivery: z.enum(['pickup', 'delivery']).default('pickup'),
      address: z.string().trim().max(300).optional().default(''),
      note: z.string().trim().max(600).optional().default(''),
    }).parse(req.body);
    const staff = (await photographersOf(req.user.id)).find((s) => s.id === data.staffId);
    if (!staff) throw httpError(404, 'Photographe introuvable.');
    const [product] = await query('SELECT * FROM print_products WHERE id = ? AND staff_id = ? AND active = 1', [data.productId, staff.id]);
    if (!product) throw httpError(404, 'Ce produit n’est plus proposé.');
    const photoIds = [...new Set(data.photoIds)];
    if (photoIds.length < product.min_photos) throw httpError(400, `Ce produit demande au moins ${product.min_photos} photo(s).`);
    if (photoIds.length > product.max_photos) throw httpError(400, `Ce produit accepte ${product.max_photos} photo(s) au maximum.`);
    if (data.delivery === 'delivery' && !data.address) throw httpError(400, 'Indiquez l’adresse de livraison.');
    // Seules les photos que le client voit (publiées, non verrouillées) et qui viennent de CE photographe.
    const photos = (await visiblePhotos(req.user.id, photoIds)).filter((p) => p.event_created_by === staff.id);
    if (photos.length !== photoIds.length) throw httpError(400, 'Certaines photos ne peuvent pas être commandées chez ce photographe.');
    const id = crypto.randomUUID();
    await query(
      `INSERT INTO print_orders (id, staff_id, client_id, product_id, product_name, unit_price, currency, quantity, delivery, address, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, staff.id, req.user.id, product.id, product.name, product.price, product.currency, data.quantity, data.delivery, data.delivery === 'delivery' ? data.address : null, data.note || null],
    );
    let position = 0;
    for (const p of photos) {
      await query('INSERT INTO print_order_photos (order_id, photo_id, number, filename, event_name, position) VALUES (?, ?, ?, ?, ?, ?)', [id, p.id, Number(p.number), p.filename, p.event_name || '', position]);
      position += 1;
    }
    const [row] = await query(`${ORDER_SELECT} WHERE o.id = ?`, [id]);
    const [order] = await mapOrders([row]);
    if (staff.email) {
      fire(sendMail({
        to: staff.email, userId: staff.id, sentBy: req.user.id, kind: 'order', replyTo: req.user.email,
        ...orderRequestEmail({ staffName: staff.name, order }),
      }));
    }
    audit(req, 'order.create', { entity: 'order', entityId: id });
    res.status(201).json({ order });
  });

  // Le client annule sa commande tant que le photographe ne l'a pas acceptée.
  router.delete('/:id', async (req, res) => {
    const [row] = await query(`${ORDER_SELECT} WHERE o.id = ? AND o.client_id = ?`, [uuid.parse(req.params.id), req.user.id]);
    if (!row) throw httpError(404, 'Commande introuvable.');
    if (row.status !== 'new') throw httpError(400, 'Cette commande est déjà en cours : contactez votre photographe pour l’annuler.');
    await query("UPDATE print_orders SET status = 'cancelled' WHERE id = ?", [row.id]);
    audit(req, 'order.client_cancel', { entity: 'order', entityId: row.id });
    res.status(204).end();
  });

  return router;
}

