import { Router } from 'express';
import { query } from '../db.js';
import { httpError } from '../lib/errors.js';
import { sendPrivate, watermarkedPreview, makeThumb } from '../lib/storage.js';
import { faceThumbnail } from '../lib/faces.js';
import { uuid, canSeeEvent } from '../lib/data.js';
import { requireAuth, blockPending } from '../middleware/auth.js';

// Images privées : chaque requête vérifie que l'utilisateur a le droit de voir la photo.
const router = Router();
router.use(requireAuth, blockPending);

/** Photo visible par l'utilisateur (droits vérifiés), avec son numéro dans la galerie. */
async function visiblePhoto(req) {
  const [photo] = await query(
    `SELECT p.id, p.preview_key, p.thumb_key, p.event_id, e.client_id, e.created_by, e.expires_at, e.published, e.archived, e.selection_mode,
       (SELECT COUNT(*) FROM photos q WHERE q.event_id = p.event_id
          AND (q.position < p.position OR (q.position = p.position AND q.created_at <= p.created_at))) AS number
     FROM photos p JOIN events e ON e.id = p.event_id WHERE p.id = ?`,
    [uuid.parse(req.params.id)],
  );
  if (!photo || !canSeeEvent(req.user, photo)) throw httpError(404, 'Photo introuvable.');
  return photo;
}

// Mode sélection : le client ne reçoit qu'une version filigranée et numérotée (l'équipe voit l'original).
const mustWatermark = (user, photo) =>
  photo.selection_mode && !(user.role === 'owner' || (user.role === 'admin' && photo.created_by === user.id));

router.get('/preview/:id', async (req, res) => {
  const photo = await visiblePhoto(req);
  if (mustWatermark(req.user, photo)) {
    return sendPrivate(res, await watermarkedPreview(photo.preview_key, photo.id, Number(photo.number)));
  }
  await sendPrivate(res, photo.preview_key);
});

// Miniature de la grille. Mode sélection : la version filigranée (jamais de miniature sans filigrane).
router.get('/thumb/:id', async (req, res) => {
  const photo = await visiblePhoto(req);
  if (mustWatermark(req.user, photo)) {
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
  const [event] = await query('SELECT id, cover_key, client_id, created_by, expires_at, published, archived, selection_mode FROM events WHERE id = ?', [
    uuid.parse(req.params.id),
  ]);
  if (!event?.cover_key || !canSeeEvent(req.user, event)) throw httpError(404, 'Image introuvable.');
  if (event.selection_mode && !(req.user.role === 'owner' || (req.user.role === 'admin' && event.created_by === req.user.id))) {
    const name = event.cover_key.split('/').pop().split('.')[0];
    return sendPrivate(res, await watermarkedPreview(event.cover_key, `cover-${name}`, null));
  }
  await sendPrivate(res, event.cover_key);
});

// Vignette d'un visage (filtre « personnes »).
router.get('/face/:id', async (req, res) => {
  const [face] = await query(
    `SELECT f.*, p.preview_key, e.client_id, e.created_by, e.expires_at, e.published, e.archived
     FROM photo_faces f JOIN photos p ON p.id = f.photo_id JOIN events e ON e.id = p.event_id WHERE f.id = ?`,
    [uuid.parse(req.params.id)],
  );
  if (!face || !canSeeEvent(req.user, face)) throw httpError(404, 'Image introuvable.');
  await sendPrivate(res, await faceThumbnail(face));
});

// Musique du diaporama d'une galerie.
router.get('/music/:id', async (req, res) => {
  const [event] = await query('SELECT id, music_key, client_id, created_by, expires_at, published, archived FROM events WHERE id = ?', [
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
