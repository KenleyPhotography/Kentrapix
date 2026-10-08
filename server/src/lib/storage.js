import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import multer from 'multer';
import { config } from '../config.js';
import { httpError } from './errors.js';

// Fichiers privés : jamais servis directement, uniquement via /media et
// /api/client/downloads après vérification des droits.
const FOLDERS = ['originals', 'previews', 'covers', 'avatars', 'watermarks', 'tmp'];
// Sans cache libvips : sinon Windows garde les images ouvertes et refuse de les supprimer (EBUSY).
sharp.cache(false);

const FORMATS = { jpeg: 'jpg', png: 'png', webp: 'webp', tiff: 'tif', avif: 'avif' };

export async function ensureStorage() {
  await Promise.all(FOLDERS.map((f) => fs.mkdir(path.join(config.storageDir, f), { recursive: true })));
}

/** Clé de stockage (ex. 'previews/abc.webp') -> chemin absolu, sans sortie du dossier. */
export function resolveKey(key) {
  const abs = path.resolve(config.storageDir, key);
  if (!abs.startsWith(config.storageDir + path.sep)) throw httpError(400, 'Chemin de fichier invalide.');
  return abs;
}

export async function fileExists(key) {
  try {
    await fs.access(resolveKey(key));
    return true;
  } catch {
    return false;
  }
}

/** Supprime des fichiers privés. Un fichier verrouillé est signalé mais ne fait pas échouer l'action. */
export async function removeKeys(keys) {
  await Promise.all(
    keys.filter(Boolean).map((k) => fs.rm(resolveKey(k), { force: true, maxRetries: 3 }).catch((err) => console.error(`Suppression impossible (${k}) : ${err.code}`))),
  );
}

/** Upload multipart vers storage/tmp, avant traitement. */
export const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(config.storageDir, 'tmp')),
    filename: (req, file, cb) => cb(null, crypto.randomUUID()),
  }),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1, fields: 20 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith('image/')),
});

async function inspect(tmpPath) {
  let meta;
  try {
    meta = await sharp(tmpPath).metadata();
  } catch {
    throw httpError(400, 'Ce fichier n’est pas une image valide.');
  }
  if (!FORMATS[meta.format]) throw httpError(400, 'Format non pris en charge (JPG, PNG, WEBP, TIFF ou AVIF).');
  return meta;
}

const makePreview = (input, output) =>
  sharp(input)
    .rotate() // respecte l'orientation EXIF
    .resize({ width: config.previewWidth, height: config.previewWidth, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(output);

/** Garde l'original intact et génère un aperçu WEBP léger. */
export async function storePhoto(file) {
  try {
    const meta = await inspect(file.path);
    const id = crypto.randomUUID();
    const originalKey = `originals/${id}.${FORMATS[meta.format]}`;
    const previewKey = `previews/${id}.webp`;
    await fs.rename(file.path, resolveKey(originalKey));
    const preview = await makePreview(resolveKey(originalKey), resolveKey(previewKey));
    return {
      originalKey,
      previewKey,
      mime: `image/${meta.format}`,
      sizeBytes: file.size,
      previewBytes: preview.size,
      width: preview.width,
      height: preview.height,
    };
  } finally {
    await fs.rm(file.path, { force: true });
  }
}

/** Photo de couverture d'un événement : seul l'aperçu est conservé. */
export async function storeCover(file) {
  try {
    await inspect(file.path);
    const coverKey = `covers/${crypto.randomUUID()}.webp`;
    await makePreview(file.path, resolveKey(coverKey));
    return coverKey;
  } finally {
    await fs.rm(file.path, { force: true });
  }
}

/** Photo de profil : carré 256 px WEBP. */
export async function storeAvatar(file) {
  try {
    await inspect(file.path);
    const key = `avatars/${crypto.randomUUID()}.webp`;
    await sharp(file.path).rotate().resize(256, 256, { fit: 'cover' }).webp({ quality: 85 }).toFile(resolveKey(key));
    return key;
  } finally {
    await fs.rm(file.path, { force: true });
  }
}

/**
 * Aperçu filigrané (mode sélection) : « KentraPix » en diagonale + numéro de la photo.
 * Généré à la demande puis gardé en cache dans watermarks/<photo>-<numéro>.webp.
 */
export async function watermarkedPreview(previewKey, photoId, number) {
  const key = `watermarks/${photoId}-${number || 'x'}.webp`;
  if (await fileExists(key)) return key;
  const image = sharp(resolveKey(previewKey));
  const { width, height } = await image.metadata();
  const size = Math.round(Math.max(width, height) / 11);
  const tiles = [];
  for (let y = -height; y < height * 2; y += size * 3) {
    for (let x = -width; x < width * 2; x += size * 6) {
      tiles.push(`<text x="${x}" y="${y}">KentraPix</text>`);
    }
  }
  const badge = Math.round(size * 0.9);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <g transform="rotate(-28 ${width / 2} ${height / 2})" font-family="Segoe UI, Arial, sans-serif" font-weight="800"
       font-size="${size}" fill="#ffffff" fill-opacity="0.22" stroke="#0c4088" stroke-opacity="0.18" stroke-width="2">${tiles.join('')}</g>
    ${number ? `<rect x="${badge * 0.4}" y="${height - badge * 1.7}" rx="${badge * 0.4}" width="${badge * 3.2}" height="${badge * 1.3}" fill="#1265d8" fill-opacity="0.9"/>
    <text x="${badge * 2}" y="${height - badge * 0.78}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif"
       font-weight="800" font-size="${badge * 0.8}" fill="#ffffff">N° ${number}</text>` : ''}
  </svg>`;
  await image.composite([{ input: Buffer.from(svg) }]).webp({ quality: 78 }).toFile(resolveKey(key));
  return key;
}

/** Supprime les aperçus filigranés d'une photo (tous numéros). */
export async function removeWatermarks(photoId) {
  const dir = path.join(config.storageDir, 'watermarks');
  const files = await fs.readdir(dir).catch(() => []);
  await removeKeys(files.filter((f) => f.startsWith(`${photoId}-`)).map((f) => `watermarks/${f}`));
}

/** Envoie un fichier privé avec un cache navigateur limité à l'utilisateur. */
export function sendPrivate(res, key) {
  res.set('Cache-Control', 'private, max-age=3600');
  res.sendFile(resolveKey(key));
}
