import { Router } from 'express';
import { query } from '../db.js';
import { httpError } from '../lib/errors.js';
import { sendPrivate, watermarkedPreview } from '../lib/storage.js';
import { uuid, canSeeEvent } from '../lib/data.js';
import { requireAuth } from '../middleware/auth.js';

// Images privées : chaque requête vérifie que l'utilisateur a le droit de voir la photo.
const router = Router();
router.use(requireAuth);

router.get('/preview/:id', async (req, res) => {
  const [photo] = await query(
    `SELECT p.id, p.preview_key, p.event_id, e.client_id, e.published, e.archived, e.selection_mode,
       (SELECT COUNT(*) FROM photos q WHERE q.event_id = p.event_id
          AND (q.position < p.position OR (q.position = p.position AND q.created_at <= p.created_at))) AS number
     FROM photos p JOIN events e ON e.id = p.event_id WHERE p.id = ?`,
    [uuid.parse(req.params.id)],
  );
  if (!photo || !canSeeEvent(req.user, photo)) throw httpError(404, 'Photo introuvable.');
  // Mode sélection : le client ne reçoit qu'une version filigranée et numérotée (l'équipe voit l'original).
  const staff = ['owner', 'admin'].includes(req.user.role);
  if (photo.selection_mode && !staff) {
    return sendPrivate(res, await watermarkedPreview(photo.preview_key, photo.id, Number(photo.number)));
  }
  sendPrivate(res, photo.preview_key);
});

router.get('/cover/:id', async (req, res) => {
  const [event] = await query('SELECT id, cover_key, client_id, published, archived, selection_mode FROM events WHERE id = ?', [
    uuid.parse(req.params.id),
  ]);
  if (!event?.cover_key || !canSeeEvent(req.user, event)) throw httpError(404, 'Image introuvable.');
  if (event.selection_mode && !['owner', 'admin'].includes(req.user.role)) {
    const name = event.cover_key.split('/').pop().split('.')[0];
    return sendPrivate(res, await watermarkedPreview(event.cover_key, `cover-${name}`, null));
  }
  sendPrivate(res, event.cover_key);
});

// Photo de profil : la sienne, toutes pour l'équipe, et celles de l'équipe pour tous (commentaires).
router.get('/avatar/:id', async (req, res) => {
  const [user] = await query('SELECT id, role, avatar_key FROM users WHERE id = ?', [uuid.parse(req.params.id)]);
  const staff = (u) => ['owner', 'admin'].includes(u.role);
  if (!user?.avatar_key || !(user.id === req.user.id || staff(req.user) || staff(user))) throw httpError(404, 'Image introuvable.');
  sendPrivate(res, user.avatar_key);
});

export default router;
