import { query, toIso } from '../db.js';
import { NOT_EXPIRED, CLIENT_HAS, daysUntil } from './data.js';
import { EXPIRY_NOTICE_DAYS } from './expiry.js';

// Cloche : ce qui s'est passé ces 60 derniers jours. Rien n'est stocké : la liste est recalculée,
// et users.notifications_seen_at indique ce que la personne a déjà vu.
const WINDOW = "CURRENT_TIMESTAMP - INTERVAL '60 days'";
const LIMIT = 30;
const excerpt = (s, n = 110) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const sortRecent = (items) => items.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, LIMIT);

/**
 * Notifications d'un client : nouvelle galerie, nouvelles photos, réponse du studio, galerie qui ferme bientôt,
 * et messages écrits par le studio (page « Notifications », visibles même sans galerie).
 */
export async function clientNotifications(userId, events) {
  const notices = await query(
    `SELECT a.id, a.title, a.body, a.event_id, a.send_at FROM announcement_recipients r JOIN announcements a ON a.id = r.announcement_id
     WHERE r.user_id = ? AND a.send_at <= CURRENT_TIMESTAMP AND a.send_at > ${WINDOW}
     ORDER BY a.send_at DESC LIMIT ${LIMIT}`,
    [userId],
  );
  const studioItems = notices.map((a) => ({
    id: `announcement-${a.id}`, kind: 'announcement', date: toIso(a.send_at), title: a.title, text: excerpt(a.body), body: a.body,
    // Galerie liée : seulement si le client la voit encore.
    eventId: events.some((e) => e.id === a.event_id) ? a.event_id : null,
  }));
  if (!events.length) return sortRecent(studioItems);
  const visible = `${CLIENT_HAS()} AND e.published = 1 AND e.archived = 0 AND ${NOT_EXPIRED}`;
  const [added, replies, family] = await Promise.all([
    // Photos ajoutées après la publication (un envoi = une notification par galerie).
    query(
      `SELECT p.event_id, COUNT(*) AS n, MAX(p.created_at) AS last FROM photos p JOIN events e ON e.id = p.event_id
       WHERE ${visible} AND e.published_at IS NOT NULL AND p.created_at > e.published_at + INTERVAL '30 minutes'
         AND p.created_at > ${WINDOW}
       GROUP BY p.event_id`,
      [userId],
    ),
    query(
      `SELECT c.id, c.body, c.created_at, c.photo_id, p.event_id, u.name AS author FROM photo_comments c
       JOIN users u ON u.id = c.user_id JOIN photos p ON p.id = c.photo_id JOIN events e ON e.id = p.event_id
       WHERE ${visible} AND u.role IN ('owner', 'admin') AND c.user_id <> ? AND c.created_at > ${WINDOW}
       ORDER BY c.created_at DESC LIMIT ${LIMIT}`,
      [userId, userId],
    ),
    // La famille a commenté une photo d'un lien de partage de ce client.
    query(
      `SELECT sc.id, sc.body, sc.created_at, sc.photo_id, sc.author_name, p.event_id FROM share_comments sc
       JOIN share_links l ON l.id = sc.share_id JOIN photos p ON p.id = sc.photo_id JOIN events e ON e.id = p.event_id
       WHERE ${visible} AND l.user_id = ? AND sc.created_at > ${WINDOW}
       ORDER BY sc.created_at DESC LIMIT ${LIMIT}`,
      [userId, userId],
    ),
  ]);
  const nameOf = Object.fromEntries(events.map((e) => [e.id, e.name]));
  const since = Date.now() - 60 * 86400000;
  const items = studioItems;
  for (const e of events) {
    if (e.published_at && Date.parse(toIso(e.published_at)) > since) {
      items.push({
        id: `gallery-${e.id}`, kind: 'gallery', eventId: e.id, date: toIso(e.published_at),
        title: e.selection_mode ? 'Vos photos à choisir sont prêtes' : 'Nouvelle galerie',
        text: e.name,
      });
    }
    // Galerie qui ferme dans 7 jours ou moins : signalée dès le début de cette période.
    const left = e.expires_at ? daysUntil(e.expires_at) : null;
    if (left !== null && left >= 0 && left <= EXPIRY_NOTICE_DAYS) {
      const start = new Date(Date.parse(String(e.expires_at).slice(0, 10)) - EXPIRY_NOTICE_DAYS * 86400000).toISOString();
      items.push({
        id: `expiry-${e.id}-${String(e.expires_at).slice(0, 10)}`, kind: 'expiry', eventId: e.id,
        date: e.published_at && toIso(e.published_at) > start ? toIso(e.published_at) : start,
        title: left === 0 ? 'Votre galerie ferme aujourd’hui' : `Votre galerie ferme dans ${plural(left, 'jour', 'jours')}`,
        text: `${e.name} — pensez à télécharger vos photos préférées.`,
      });
    }
  }
  for (const a of added) {
    items.push({
      id: `photos-${a.event_id}-${a.last}`, kind: 'photos', eventId: a.event_id, date: toIso(a.last),
      title: plural(Number(a.n), 'nouvelle photo', 'nouvelles photos'), text: nameOf[a.event_id] || '',
    });
  }
  for (const f of family) {
    items.push({
      id: `family-${f.id}`, kind: 'comment', eventId: f.event_id, photoId: f.photo_id, date: toIso(f.created_at),
      title: `${f.author_name} (famille) a commenté`, text: excerpt(f.body),
    });
  }
  for (const r of replies) {
    items.push({
      id: `comment-${r.id}`, kind: 'comment', eventId: r.event_id, photoId: r.photo_id, date: toIso(r.created_at),
      title: `${r.author} vous a répondu`, text: excerpt(r.body),
    });
  }
  return sortRecent(items);
}

/**
 * Notifications de l'équipe : sélections envoyées, commentaires des clients, nouveaux clients
 * (code saisi par la personne elle-même) et inscriptions libres (propriétaire).
 * scope : condition SQL sur les galeries visibles par ce membre (alias e) et ses paramètres.
 */
export async function staffNotifications({ scope: [es, ep], owner, userId, events, selections }) {
  const [comments, family, signups, joined] = await Promise.all([
    query(
      `SELECT c.id, c.body, c.created_at, c.photo_id, p.event_id, u.name AS author FROM photo_comments c
       JOIN users u ON u.id = c.user_id JOIN photos p ON p.id = c.photo_id JOIN events e ON e.id = p.event_id
       WHERE ${es} AND u.role = 'client' AND c.created_at > ${WINDOW}
       ORDER BY c.created_at DESC LIMIT ${LIMIT}`,
      ep,
    ),
    query(
      `SELECT sc.id, sc.body, sc.created_at, sc.photo_id, sc.author_name, p.event_id FROM share_comments sc
       JOIN photos p ON p.id = sc.photo_id JOIN events e ON e.id = p.event_id
       WHERE ${es} AND sc.created_at > ${WINDOW}
       ORDER BY sc.created_at DESC LIMIT ${LIMIT}`,
      ep,
    ),
    owner
      ? query(`SELECT id, name, created_at FROM users WHERE role = 'client' AND created_by IS NULL AND created_at > ${WINDOW}
          ORDER BY created_at DESC LIMIT ${LIMIT}`)
      : [],
    // Comptes qui se sont rattachés à ce photographe par son code (pas ceux qu'il a créés ou ajoutés lui-même).
    userId
      ? query(
        `SELECT u.id, u.name, u.role, cp.created_at FROM client_photographers cp JOIN users u ON u.id = cp.client_id
         WHERE cp.staff_id = ? AND cp.created_at > ${WINDOW} AND (u.created_by IS NULL OR u.created_by <> cp.staff_id)
         ORDER BY cp.created_at DESC LIMIT ${LIMIT}`,
        [userId],
      )
      : [],
  ]);
  const nameOf = Object.fromEntries(events.map((e) => [e.id, e.name]));
  const since = Date.now() - 60 * 86400000;
  const items = [];
  for (const s of selections) {
    if (!s.submitted_at || Date.parse(toIso(s.submitted_at)) < since) continue;
    items.push({
      id: `selection-${s.event_id}-${s.user_id}-${s.submitted_at}`, kind: 'selection', eventId: s.event_id, date: toIso(s.submitted_at),
      title: `${s.name} a envoyé sa sélection`, text: `${plural(Number(s.photo_count), 'photo', 'photos')} · ${nameOf[s.event_id] || ''}`,
    });
  }
  for (const c of comments) {
    items.push({
      id: `comment-${c.id}`, kind: 'comment', eventId: c.event_id, photoId: c.photo_id, date: toIso(c.created_at),
      title: `${c.author} a commenté`, text: `${excerpt(c.body)} — ${nameOf[c.event_id] || ''}`,
    });
  }
  for (const f of family) {
    items.push({
      id: `family-${f.id}`, kind: 'comment', eventId: f.event_id, photoId: f.photo_id, date: toIso(f.created_at),
      title: `${f.author_name} (famille) a commenté`, text: `${excerpt(f.body)} — ${nameOf[f.event_id] || ''}`,
    });
  }
  for (const u of signups) {
    items.push({ id: `signup-${u.id}`, kind: 'signup', date: toIso(u.created_at), title: 'Nouveau compte client', text: u.name });
  }
  for (const u of joined) {
    items.push({
      id: `joined-${u.id}`, kind: 'signup', date: toIso(u.created_at),
      title: 'Nouveau client', text: `${u.name} vous a ajouté comme photographe${u.role === 'client' ? '' : ' (photographe)'}`,
    });
  }
  return sortRecent(items);
}
