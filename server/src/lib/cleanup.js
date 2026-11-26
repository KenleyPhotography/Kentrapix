import { query } from '../db.js';
import { listStoredFiles, removeKeys } from './storage.js';

// Nettoyage de l'espace : fichiers (stockage local ou bucket) qui ne servent plus à aucune photo, galerie ou compte.
// Prudence : un fichier de moins de 24 h n'est jamais touché (import en cours), et un dossier inconnu est ignoré.
const MIN_AGE_MS = 24 * 3600 * 1000;
const REFERENCED_FOLDERS = ['originals', 'previews', 'thumbs', 'covers', 'avatars', 'music', 'portfolios'];

/** Liste les fichiers orphelins : [{ key, size, folder }]. */
export async function findOrphans() {
  const [photos, events, users, files, orderCovers, portfolios] = await Promise.all([
    query('SELECT p.id, p.original_key, p.preview_key, p.thumb_key, e.lock_blur FROM photos p JOIN events e ON e.id = p.event_id'),
    query('SELECT cover_key, music_key FROM events'),
    query('SELECT avatar_key FROM users'),
    listStoredFiles(),
    query('SELECT cover_key FROM print_orders WHERE cover_key IS NOT NULL'),
    query('SELECT storage_key FROM portfolio_photos WHERE storage_key IS NOT NULL'),
  ]);
  const used = new Set([
    ...photos.flatMap((p) => [p.original_key, p.preview_key, p.thumb_key]),
    ...events.flatMap((e) => [e.cover_key, e.music_key]),
    ...users.map((u) => u.avatar_key),
    ...orderCovers.map((o) => o.cover_key),
    ...portfolios.map((p) => p.storage_key),
  ].filter(Boolean));
  const photoIds = new Set(photos.map((p) => p.id));
  // locks/<id>-b25.webp : seul le fichier du niveau de flou actuel de la galerie est utile
  const lockKeys = new Set(photos.map((p) => `locks/${p.id}-b${Math.round(Number(p.lock_blur ?? 2.5) * 10)}.webp`));
  const now = Date.now();

  return files
    .filter((f) => now - f.modified.getTime() > MIN_AGE_MS)
    .map((f) => ({ ...f, folder: f.key.split('/')[0] }))
    .filter((f) => {
      if (REFERENCED_FOLDERS.includes(f.folder)) return !used.has(f.key);
      if (f.folder === 'watermarks') return !photoIds.has(f.key.split('/')[1]?.slice(0, 36)); // watermarks/<id photo>-…
      if (f.folder === 'locks') return !lockKeys.has(f.key);
      return f.folder === 'faces' || f.folder === 'tmp'; // anciennes miniatures de visages, restes d'imports
    });
}

const summary = (orphans) => {
  const byFolder = {};
  for (const o of orphans) {
    byFolder[o.folder] ??= { count: 0, bytes: 0 };
    byFolder[o.folder].count += 1;
    byFolder[o.folder].bytes += o.size;
  }
  return { count: orphans.length, bytes: orphans.reduce((n, o) => n + o.size, 0), byFolder };
};

export async function scanOrphans() {
  return summary(await findOrphans());
}

/** Supprime les orphelins (par paquets) et renvoie ce qui a été libéré. */
export async function cleanOrphans() {
  const orphans = await findOrphans();
  for (let i = 0; i < orphans.length; i += 50) await removeKeys(orphans.slice(i, i + 50).map((o) => o.key));
  return summary(orphans);
}
