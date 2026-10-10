import { query } from '../db.js';
import { listStoredFiles, removeKeys } from './storage.js';

// Nettoyage de l'espace : fichiers (stockage local ou bucket) qui ne servent plus à aucune photo, galerie ou compte.
// Prudence : un fichier de moins de 24 h n'est jamais touché (import en cours), et un dossier inconnu est ignoré.
const MIN_AGE_MS = 24 * 3600 * 1000;
const REFERENCED_FOLDERS = ['originals', 'previews', 'thumbs', 'covers', 'avatars', 'music'];

/** Liste les fichiers orphelins : [{ key, size, folder }]. */
export async function findOrphans() {
  const [photos, events, users, files] = await Promise.all([
    query('SELECT id, original_key, preview_key, thumb_key FROM photos'),
    query('SELECT cover_key, music_key FROM events'),
    query('SELECT avatar_key FROM users'),
    listStoredFiles(),
  ]);
  const used = new Set([
    ...photos.flatMap((p) => [p.original_key, p.preview_key, p.thumb_key]),
    ...events.flatMap((e) => [e.cover_key, e.music_key]),
    ...users.map((u) => u.avatar_key),
  ].filter(Boolean));
  const photoIds = new Set(photos.map((p) => p.id));
  const now = Date.now();

  return files
    .filter((f) => now - f.modified.getTime() > MIN_AGE_MS)
    .map((f) => ({ ...f, folder: f.key.split('/')[0] }))
    .filter((f) => {
      if (REFERENCED_FOLDERS.includes(f.folder)) return !used.has(f.key);
      if (f.folder === 'watermarks') return !photoIds.has(f.key.split('/')[1]?.slice(0, 36)); // watermarks/<id photo>-…
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
