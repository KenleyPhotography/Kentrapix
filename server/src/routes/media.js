import { Router } from 'express';
import { query } from '../db.js';
import { httpError } from '../lib/errors.js';
import sharp from 'sharp';
import { sendPrivate, watermarkedPreview, makeThumb, fileExists, readFile, putFile } from '../lib/storage.js';
import { uuid, canSeeEvent, isLockedFor, seesEverything, LOCK_DEFAULT_REASON } from '../lib/data.js';
import { requireAuth, blockPending } from '../middleware/auth.js';

// Images privées : chaque requête vérifie que l'utilisateur a le droit de voir la photo.
const router = Router();
router.use(requireAuth, blockPending);

/** Photo visible par l'utilisateur (droits vérifiés), avec son numéro dans la galerie. */
async function visiblePhoto(req) {
  const [photo] = await query(
    `SELECT p.id, p.preview_key, p.thumb_key, p.event_id, e.client_id, (SELECT STRING_AGG(ec.client_id, ',') FROM event_clients ec WHERE ec.event_id = e.id) AS extra_client_ids, e.created_by, e.expires_at, e.published, e.archived, e.selection_mode, e.unlock_limit, e.unlock_numbers, e.lock_reason,
       (SELECT COUNT(*) FROM photos q WHERE q.event_id = p.event_id
          AND (q.position < p.position OR (q.position = p.position AND q.created_at <= p.created_at))) AS number
     FROM photos p JOIN events e ON e.id = p.event_id WHERE p.id = ?`,
    [uuid.parse(req.params.id)],
  );
  if (!photo || !canSeeEvent(req.user, photo)) throw httpError(404, 'Photo introuvable.');
  // Photo pas encore débloquée par le photographe : le client ne peut ni l'afficher ni la télécharger.
  if (!seesEverything(req.user, photo) && isLockedFor(photo, photo.number)) throw httpError(403, photo.lock_reason || LOCK_DEFAULT_REASON);
  return photo;
}

/**
 * Photo verrouillée (« visible mais verrouillée ») : seulement une version réduite (320 px) et floue (niveau choisi par le photographe), de quoi deviner les
 * couleurs derrière le cadenas — jamais la photo. Calculée une fois puis gardée (locks/<id>-b25.webp…).
 */
router.get('/lockthumb/:id', async (req, res) => {
  const [photo] = await query(
    `SELECT p.id, p.preview_key, p.thumb_key, p.event_id, e.client_id, (SELECT STRING_AGG(ec.client_id, ',') FROM event_clients ec WHERE ec.event_id = e.id) AS extra_client_ids, e.created_by, e.expires_at, e.published, e.archived, e.lock_mode, e.lock_blur, e.unlock_limit, e.unlock_numbers,
       (SELECT COUNT(*) FROM photos q WHERE q.event_id = p.event_id
          AND (q.position < p.position OR (q.position = p.position AND q.created_at <= p.created_at))) AS number
     FROM photos p JOIN events e ON e.id = p.event_id WHERE p.id = ?`,
    [uuid.parse(req.params.id)],
  );
  // Seulement pour une photo réellement verrouillée en mode « visible mais verrouillée » ; sinon, rien à montrer ici.
  if (!photo || !canSeeEvent(req.user, photo) || seesEverything(req.user, photo) || photo.lock_mode === 'hidden' || !isLockedFor(photo, photo.number)) {
    throw httpError(404, 'Image introuvable.');
  }
  const sigma = Number(photo.lock_blur ?? 2.5);
  const key = `locks/${photo.id}-b${Math.round(sigma * 10)}.webp`; // un fichier par niveau de flou
  if (!(await fileExists(key))) {
    const source = await readFile(photo.thumb_key || photo.preview_key);
    await putFile(key, await sharp(source).rotate().resize({ width: 320, withoutEnlargement: true }).blur(sigma).webp({ quality: 62 }).toBuffer(), 'image/webp');
  }
  res.set('Cache-Control', 'private, max-age=300');
  await sendPrivate(res, key);
});

// Mode sélection : le client ne reçoit qu'une version filigranée et numérotée (l'équipe voit l'original).
// ?wm=1 : l'aperçu « vue du client » du studio montre le filigrane tel que le client le verra.
const mustWatermark = (user, photo, req) =>
  photo.selection_mode && (req?.query?.wm === '1' || !(user.role === 'owner' || (user.role === 'admin' && photo.created_by === user.id)));

router.get('/preview/:id', async (req, res) => {
  const photo = await visiblePhoto(req);
  if (mustWatermark(req.user, photo, req)) {
    return sendPrivate(res, await watermarkedPreview(photo.preview_key, photo.id, Number(photo.number)));
  }
  await sendPrivate(res, photo.preview_key);
});

// Miniature de la grille. Mode sélection : la version filigranée (jamais de miniature sans filigrane).
router.get('/thumb/:id', async (req, res) => {
  const photo = await visiblePhoto(req);
  if (mustWatermark(req.user, photo, req)) {
    return sendPrivate(res, await watermarkedPreview(photo.preview_key, photo.id, Number(photo.number)));
  }
  let key = photo.thumb_key;
  if (!key) {
    try {
      key = await makeThumb(photo.preview_key, photo.id);
      await query('UPDATE photos SET thumb_key = ? WHERE id = ?', [key, photo.id]);
    } catch (err) {
      console.error(`Miniature ${photo.id} : ${err.message}`);
      key = photo.preview_key; // la grille s'affiche quand même
    }
  }
  await sendPrivate(res, key);
});

router.get('/cover/:id', async (req, res) => {
  const [event] = await query(`SELECT e.id, e.cover_key, e.client_id, (SELECT STRING_AGG(ec.client_id, ',') FROM event_clients ec WHERE ec.event_id = e.id) AS extra_client_ids, e.created_by, e.expires_at, e.published, e.archived, e.selection_mode FROM events e WHERE e.id = ?`, [
    uuid.parse(req.params.id),
  ]);
  if (!event?.cover_key || !canSeeEvent(req.user, event)) throw httpError(404, 'Image introuvable.');
  if (event.selection_mode && (req.query.wm === '1' || !(req.user.role === 'owner' || (req.user.role === 'admin' && event.created_by === req.user.id)))) {
    const name = event.cover_key.split('/').pop().split('.')[0];
    return sendPrivate(res, await watermarkedPreview(event.cover_key, `cover-${name}`, null));
  }
  await sendPrivate(res, event.cover_key);
});

// Musique du diaporama d'une galerie.
router.get('/music/:id', async (req, res) => {
  const [event] = await query(`SELECT e.id, e.music_key, e.client_id, (SELECT STRING_AGG(ec.client_id, ',') FROM event_clients ec WHERE ec.event_id = e.id) AS extra_client_ids, e.created_by, e.expires_at, e.published, e.archived FROM events e WHERE e.id = ?`, [
    uuid.parse(req.params.id),
  ]);
  if (!event?.music_key || !canSeeEvent(req.user, event)) throw httpError(404, 'Musique introuvable.');
  await sendPrivate(res, event.music_key);
});

// Photo de profil : la sienne, toutes pour le propriétaire, celles de ses clients pour un photographe,
// et celles de l'équipe pour tous (commentaires).
router.get('/avatar/:id', async (req, res) => {
  const [user] = await query('SELECT id, role, created_by, avatar_key FROM users WHERE id = ?', [uuid.parse(req.params.id)]);
  const staff = (u) => ['owner', 'admin'].includes(u.role);
  const allowed = user && (user.id === req.user.id || req.user.role === 'owner' || staff(user)
    || (req.user.role === 'admin' && user.created_by === req.user.id));
  if (!user?.avatar_key || !allowed) throw httpError(404, 'Image introuvable.');
  await sendPrivate(res, user.avatar_key);
});

export default router;
