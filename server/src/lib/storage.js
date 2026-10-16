import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import multer from 'multer';
import {
  S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand, ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config.js';
import { httpError } from './errors.js';

// Fichiers privés : jamais servis directement, uniquement via /media et
// /api/client/downloads après vérification des droits.
//
// Deux modes, choisis automatiquement :
//  - en ligne (B2_* dans .env) : photos dans un bucket privé Backblaze B2 / S3. Les navigateurs envoient
//    et reçoivent les photos directement depuis le bucket via des liens signés à durée limitée :
//    elles ne sont jamais enregistrées sur ce serveur ;
//  - local : photos dans STORAGE_DIR.
// Les clés sont identiques dans les deux modes : 'originals/…', 'previews/…', 'covers/…', etc.
const FOLDERS = ['originals', 'previews', 'thumbs', 'covers', 'avatars', 'watermarks', 'locks', 'music', 'tmp'];
// Sans cache libvips : sinon Windows garde les images ouvertes et refuse de les supprimer (EBUSY).
sharp.cache(false);
// Un seul fil de traitement d'image en production : moins de mémoire utilisée en même temps (petit hébergement).
if (process.env.NODE_ENV === 'production') sharp.concurrency(Number(process.env.SHARP_CONCURRENCY || 1));

const FORMATS = { jpeg: 'jpg', png: 'png', webp: 'webp', tiff: 'tif', avif: 'avif' };
const TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', tif: 'image/tiff', avif: 'image/avif' };

export const isRemote = !!config.s3;
const s3 = isRemote
  ? new S3Client({
    endpoint: config.s3.endpoint,
    region: config.s3.region,
    forcePathStyle: true, // un seul domaine pour tous les liens (CSP simple)
    credentials: { accessKeyId: config.s3.keyId, secretAccessKey: config.s3.secret },
  })
  : null;
const Bucket = config.s3?.bucket;

export async function ensureStorage() {
  // tmp/ sert toujours : fichiers reçus par le serveur (couverture, avatar, musique) avant traitement.
  const folders = isRemote ? ['tmp'] : FOLDERS;
  await Promise.all(folders.map((f) => fs.mkdir(path.join(config.storageDir, f), { recursive: true })));
}

/** Clé de stockage (ex. 'previews/abc.webp') -> chemin absolu, sans sortie du dossier. */
export function resolveKey(key) {
  const abs = path.resolve(config.storageDir, key);
  if (!abs.startsWith(config.storageDir + path.sep)) throw httpError(400, 'Chemin de fichier invalide.');
  return abs;
}

const typeOf = (key) => TYPES[key.split('.').pop()] || (key.startsWith('music/') ? 'audio/mpeg' : 'application/octet-stream');

// ---------- Opérations de base (local ou en ligne) ----------
export async function fileExists(key) {
  if (isRemote) {
    try {
      await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
  try {
    await fs.access(resolveKey(key));
    return true;
  } catch {
    return false;
  }
}

/** Taille d'un fichier stocké (null s'il n'existe pas). */
export async function fileSize(key) {
  if (isRemote) {
    try {
      return (await s3.send(new HeadObjectCommand({ Bucket, Key: key }))).ContentLength ?? null;
    } catch {
      return null;
    }
  }
  return (await fs.stat(resolveKey(key)).catch(() => null))?.size ?? null;
}

/** Enregistre un Buffer ou un fichier local sous une clé. */
export async function putFile(key, source, contentType = typeOf(key)) {
  if (isRemote) {
    const Body = Buffer.isBuffer(source) ? source : await fs.readFile(source);
    await s3.send(new PutObjectCommand({ Bucket, Key: key, Body, ContentType: contentType }));
    return;
  }
  const target = resolveKey(key);
  await fs.mkdir(path.dirname(target), { recursive: true });
  if (Buffer.isBuffer(source)) await fs.writeFile(target, source);
  else await fs.copyFile(source, target);
}

/** Contenu d'un fichier stocké (aperçus : filigrane, visages). */
export async function readFile(key) {
  if (isRemote) {
    const res = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
    return Buffer.from(await res.Body.transformToByteArray());
  }
  return fs.readFile(resolveKey(key));
}

/** Flux de lecture (ZIP des originaux). */
async function readStream(key) {
  if (isRemote) return (await s3.send(new GetObjectCommand({ Bucket, Key: key }))).Body;
  return createReadStream(resolveKey(key));
}

/** Supprime des fichiers privés. Un échec est signalé mais ne fait pas échouer l'action. */
export async function removeKeys(keys) {
  if (config.keepFiles) return; // copie de test : les fichiers appartiennent à la production
  // Un 2e essai après une courte pause : une coupure réseau passagère ne doit pas laisser un fichier orphelin qui occupe de l'espace.
  const remove = (k) => (isRemote
    ? s3.send(new DeleteObjectCommand({ Bucket, Key: k }))
    : fs.rm(resolveKey(k), { force: true, maxRetries: 3 }));
  await Promise.all(
    keys.filter(Boolean).map((k) => remove(k)
      .catch(() => new Promise((r) => setTimeout(r, 1500)).then(() => remove(k)))
      .catch((err) => console.error(`Suppression impossible (${k}) : ${err.code || err.name}`))),
  );
}

/** Tous les fichiers stockés : [{ key, size, modified }] (bucket ou dossier local). Sert au nettoyage de l'espace. */
export async function listStoredFiles() {
  const out = [];
  if (isRemote) {
    let token;
    do {
      const page = await s3.send(new ListObjectsV2Command({ Bucket, ContinuationToken: token }));
      for (const o of page.Contents || []) out.push({ key: o.Key, size: o.Size ?? 0, modified: o.LastModified ?? new Date() });
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return out;
  }
  const walk = async (dir, prefix) => {
    for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full, `${prefix}${e.name}/`);
      else {
        const st = await fs.stat(full).catch(() => null);
        if (st) out.push({ key: `${prefix}${e.name}`, size: st.size, modified: st.mtime });
      }
    }
  };
  await walk(config.storageDir, '');
  return out;
}

// ---------- Liens signés (mode en ligne) ----------
// Signés au début de l'heure et valables 2 h : même adresse pendant une heure,
// donc le navigateur garde les photos en cache au lieu de les retélécharger.
const hourStart = () => new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
const disposition = (filename) =>
  `attachment; filename="${String(filename).replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`;

function signedGet(key, filename) {
  const cmd = new GetObjectCommand({ Bucket, Key: key, ...(filename ? { ResponseContentDisposition: disposition(filename) } : {}) });
  return getSignedUrl(s3, cmd, { expiresIn: 7200, signingDate: hourStart() });
}

/**
 * Envoie un fichier privé après vérification des droits par la route appelante.
 * En ligne : redirection vers un lien signé (le fichier ne passe pas par ce serveur).
 * `filename` : téléchargement sous ce nom au lieu d'un affichage.
 */
export async function sendPrivate(res, key, filename = null) {
  if (isRemote) {
    res.set('Cache-Control', 'private, max-age=900');
    return res.redirect(302, await signedGet(key, filename));
  }
  if (filename) return res.download(resolveKey(key), filename);
  res.set('Cache-Control', 'private, max-age=3600');
  res.sendFile(resolveKey(key));
}

/**
 * Nom de fichier à télécharger. Photo envoyée compressée (galerie en mode sélection, RAW…) :
 * seul l'aperçu WEBP existe, le nom d'origine (IMG_1234.CR2) reçoit l'extension .webp.
 */
export const downloadName = (p) =>
  (p.original_key.startsWith('previews/') ? `${p.filename.replace(/\.[^.]*$/, '')}.webp` : p.filename);

/** Ajoute les originaux à un ZIP, l'un après l'autre (noms en double numérotés). */
export async function zipOriginals(zip, photos) {
  const used = new Set();
  for (const p of photos) {
    const name = downloadName(p);
    let entry = name;
    for (let n = 2; used.has(entry.toLowerCase()); n++) entry = name.replace(/(\.[^.]*)?$/, ` (${n})$1`);
    used.add(entry.toLowerCase());
    const done = new Promise((resolve) => zip.once('entry', resolve));
    zip.append(await readStream(p.original_key), { name: entry });
    await done; // un seul téléchargement depuis le bucket à la fois
  }
  await zip.finalize();
}

// ---------- Import direct navigateur -> bucket (mode en ligne) ----------
const DIRECT_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' };
const ticketOf = (id, ext, size) =>
  crypto.createHmac('sha256', config.jwtSecret).update(`upload:${id}:${ext}:${size}`).digest('base64url');

const previewTicketOf = (id) => crypto.createHmac('sha256', config.jwtSecret).update(`upload:${id}:preview`).digest('base64url');
const sameTicket = (a, b) => !!a && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Prépare l'envoi d'une photo : adresses signées pour l'original et l'aperçu (15 min).
 * previewOnly (galerie en mode sélection) : seul l'aperçu compressé est envoyé, l'original (souvent un RAW)
 * reste sur l'ordinateur du photographe — le client ne peut de toute façon rien télécharger.
 */
export async function prepareDirectUpload({ filename, type, size }, { previewOnly = false } = {}) {
  if (previewOnly) {
    const id = crypto.randomUUID();
    return {
      id,
      previewOnly: true,
      ticket: previewTicketOf(id),
      preview: {
        url: await getSignedUrl(s3, new PutObjectCommand({ Bucket, Key: `previews/${id}.webp`, ContentType: 'image/webp' }), { expiresIn: 900 }),
        headers: { 'Content-Type': 'image/webp' },
      },
      previewWidth: config.previewWidth,
      filename,
    };
  }
  const ext = DIRECT_TYPES[type];
  if (!ext) throw httpError(400, 'Format non pris en charge pour l’envoi direct (JPG, PNG, WEBP ou AVIF).');
  if (size > config.maxUploadMb * 1024 * 1024) throw httpError(413, `Photo trop lourde (${config.maxUploadMb} Mo maximum).`);
  const id = crypto.randomUUID();
  const sign = (cmd) => getSignedUrl(s3, cmd, { expiresIn: 900 });
  return {
    id,
    ext,
    ticket: ticketOf(id, ext, size),
    original: {
      url: await sign(new PutObjectCommand({
        Bucket, Key: `originals/${id}.${ext}`, ContentType: type, ContentLength: size,
      })),
      headers: { 'Content-Type': type },
    },
    preview: {
      url: await sign(new PutObjectCommand({ Bucket, Key: `previews/${id}.webp`, ContentType: 'image/webp' })),
      headers: { 'Content-Type': 'image/webp' },
    },
    previewWidth: config.previewWidth,
    filename,
  };
}

/** Vérifie un envoi direct terminé et renvoie les informations à enregistrer. */
export async function confirmDirectUpload({ id, ext, size, ticket, previewOnly = false }) {
  if (!sameTicket(ticket, previewOnly ? previewTicketOf(id) : ticketOf(id, ext, size))) throw httpError(400, 'Envoi non reconnu.');
  const previewKey = `previews/${id}.webp`;
  // Aperçu seul : il sert aussi d'« original » (aucun téléchargement en mode sélection).
  const originalKey = previewOnly ? previewKey : `originals/${id}.${ext}`;
  const [originalSize, previewSize] = await Promise.all([previewOnly ? null : fileSize(originalKey), fileSize(previewKey)]);
  if ((!previewOnly && originalSize !== size) || !previewSize) {
    await removeKeys([originalKey, previewKey]);
    throw httpError(400, 'La photo n’est pas arrivée complètement. Réessayez.');
  }
  // Dimensions réelles de l'aperçu (l'orientation est déjà appliquée par le navigateur).
  const meta = await sharp(await readFile(previewKey)).metadata().catch(() => null);
  if (!meta?.width) {
    await removeKeys([originalKey, previewKey]);
    throw httpError(400, 'Aperçu invalide. Réessayez.');
  }
  if (previewOnly) {
    return { originalKey, previewKey, mime: 'image/webp', sizeBytes: previewSize, previewBytes: 0, width: meta.width, height: meta.height };
  }
  return {
    originalKey, previewKey, mime: TYPES[ext], sizeBytes: size, previewBytes: previewSize, width: meta.width, height: meta.height,
  };
}

// ---------- Envois passant par le serveur ----------
/** Upload multipart vers storage/tmp, avant traitement (supprimé juste après). */
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

const makePreview = (input) =>
  sharp(input)
    .rotate() // respecte l'orientation EXIF
    .resize({ width: config.previewWidth, height: config.previewWidth, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });

/** Garde l'original intact et génère un aperçu WEBP léger. previewOnly : aperçu seul (mode sélection). */
export async function storePhoto(file, { previewOnly = false } = {}) {
  try {
    const meta = await inspect(file.path);
    const id = crypto.randomUUID();
    const previewKey = `previews/${id}.webp`;
    const preview = await makePreview(file.path);
    await putFile(previewKey, preview.data, 'image/webp');
    if (previewOnly) {
      return {
        originalKey: previewKey, previewKey, mime: 'image/webp', sizeBytes: preview.info.size, previewBytes: 0,
        width: preview.info.width, height: preview.info.height,
      };
    }
    const originalKey = `originals/${id}.${FORMATS[meta.format]}`;
    await putFile(originalKey, file.path, `image/${meta.format}`);
    return {
      originalKey,
      previewKey,
      mime: `image/${meta.format}`,
      sizeBytes: file.size,
      previewBytes: preview.info.size,
      width: preview.info.width,
      height: preview.info.height,
    };
  } finally {
    await fs.rm(file.path, { force: true });
  }
}

/**
 * Miniature de la grille (WEBP 800 px, ~3 fois plus légère que l'aperçu) : économise les données mobiles.
 * Créée à partir de l'aperçu au premier affichage, puis réutilisée. Deux demandes simultanées
 * pour la même photo ne la créent qu'une fois.
 */
const thumbJobs = new Map();
export const THUMB_WIDTH = 800;
export function makeThumb(previewKey, photoId) {
  const key = `thumbs/${photoId}.webp`;
  if (!thumbJobs.has(key)) {
    const job = (async () => {
      const data = await sharp(await readFile(previewKey))
        .resize({ width: THUMB_WIDTH, height: THUMB_WIDTH * 2, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 72 })
        .toBuffer();
      await putFile(key, data, 'image/webp');
      return key;
    })().finally(() => thumbJobs.delete(key));
    thumbJobs.set(key, job);
  }
  return thumbJobs.get(key);
}

/** Photo de couverture d'un événement : seul l'aperçu est conservé. */
export async function storeCover(file) {
  try {
    await inspect(file.path);
    const coverKey = `covers/${crypto.randomUUID()}.webp`;
    await putFile(coverKey, (await makePreview(file.path)).data, 'image/webp');
    return coverKey;
  } finally {
    await fs.rm(file.path, { force: true });
  }
}

/** Photo de profil : carré 400 px WEBP. */
export async function storeAvatar(file) {
  try {
    await inspect(file.path);
    const key = `avatars/${crypto.randomUUID()}.webp`;
    const data = await sharp(file.path).rotate().resize(400, 400, { fit: 'cover', position: sharp.strategy.attention }).webp({ quality: 85 }).toBuffer();
    await putFile(key, data, 'image/webp');
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
  const key = `watermarks/${photoId}-${number || 'x'}-v2.webp`;
  if (await fileExists(key)) return key;
  const image = sharp(await readFile(previewKey));
  const { width, height } = await image.metadata();
  const size = Math.round(Math.max(width, height) / 9);
  const tiles = [];
  for (let y = -height; y < height * 2; y += size * 2.2) {
    for (let x = -width; x < width * 2; x += size * 5.2) {
      tiles.push(`<text x="${x}" y="${y}">KentraPix</text>`);
    }
  }
  const badge = Math.round(size * 0.9);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <g transform="rotate(-28 ${width / 2} ${height / 2})" font-family="Segoe UI, Arial, sans-serif" font-weight="800"
       font-size="${size}" fill="#ffffff" fill-opacity="0.42" stroke="#0c4088" stroke-opacity="0.38" stroke-width="2.5" paint-order="stroke">${tiles.join('')}</g>
    ${number ? `<rect x="${badge * 0.4}" y="${height - badge * 1.7}" rx="${badge * 0.4}" width="${badge * 3.2}" height="${badge * 1.3}" fill="#1265d8" fill-opacity="0.9"/>
    <text x="${badge * 2}" y="${height - badge * 0.78}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif"
       font-weight="800" font-size="${badge * 0.8}" fill="#ffffff">N° ${number}</text>` : ''}
  </svg>`;
  await putFile(key, await image.composite([{ input: Buffer.from(svg) }]).webp({ quality: 78 }).toBuffer(), 'image/webp');
  return key;
}

/** Supprime les aperçus filigranés d'une photo (tous numéros). */
export async function removeWatermarks(photoId) {
  const prefix = `watermarks/${photoId}-`;
  if (isRemote) {
    const list = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: prefix })).catch(() => null);
    return removeKeys((list?.Contents || []).map((o) => o.Key));
  }
  const files = await fs.readdir(path.join(config.storageDir, 'watermarks')).catch(() => []);
  await removeKeys(files.filter((f) => `watermarks/${f}`.startsWith(prefix)).map((f) => `watermarks/${f}`));
}

// ---------- Musique du diaporama ----------
const AUDIO = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/webm': 'webm' };

/** Upload d'un fichier audio (20 Mo max). */
export const uploadAudio = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(config.storageDir, 'tmp')),
    filename: (req, file, cb) => cb(null, crypto.randomUUID()),
  }),
  limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 5 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype in AUDIO),
});

/** Range le fichier audio dans music/ et renvoie sa clé. */
export async function storeMusic(file) {
  try {
    const ext = AUDIO[file.mimetype];
    if (!ext) throw httpError(400, 'Format audio non pris en charge (MP3, M4A, AAC, OGG, WAV).');
    const key = `music/${crypto.randomUUID()}.${ext}`;
    await putFile(key, file.path, file.mimetype);
    return key;
  } finally {
    await fs.rm(file.path, { force: true });
  }
}
