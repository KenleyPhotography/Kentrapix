import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { config, serverRoot } from '../config.js';
import { query } from '../db.js';
import { readFile, fileExists, putFile } from './storage.js';

// Reconnaissance des visages (Human + TensorFlow WASM, sans module natif).
// Les photos sont analysées une par une en arrière-plan, sans bloquer le site.

const require = createRequire(import.meta.url);
const modulesDir = path.join(serverRoot, 'node_modules');
const asFileUrl = (p) => `${pathToFileURL(p).href}/`; // Windows et Linux

// Ressemblance cosinus au-delà de laquelle deux visages sont la même personne.
// Mesuré sur une vraie photo de groupe : personnes différentes <= 0,775, même personne ~0,84-0,93.
// Seuil volontairement strict : mieux vaut une personne en deux groupes (fusion en un clic)
// que deux personnes mélangées.
const MATCH = Number(process.env.FACE_MATCH || 0.78);

const cosine = (a, b) => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / Math.sqrt(na * nb || 1);
};
const MIN_SCORE = 0.6;

let enginePromise = null;

/** Charge le moteur une seule fois, à la première analyse. */
function engine() {
  enginePromise ??= (async () => {
    // fetch() de Node ne lit pas file:// : les modèles sont lus directement sur le disque.
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      const u = String(url?.url ?? url);
      if (!u.startsWith('file://')) return realFetch(url, opts);
      const file = fileURLToPath(u);
      return new Response(await fs.readFile(file), {
        headers: { 'content-type': file.endsWith('.json') ? 'application/json' : 'application/octet-stream' },
      });
    };
    // Chemin complet : le paquet n'expose pas cette variante WASM dans ses « exports ».
    const lib = require(path.join(modulesDir, '@vladmandic/human/dist/human.node-wasm.js'));
    const Human = lib.default || lib.Human;
    const human = new Human({
      backend: 'wasm',
      wasmPath: asFileUrl(path.join(modulesDir, '@tensorflow/tfjs-backend-wasm/dist')),
      modelBasePath: asFileUrl(path.join(modulesDir, '@vladmandic/human/models')),
      debug: false,
      async: true,
      cacheSensitivity: 0,
      face: {
        enabled: true,
        detector: { maxDetected: 100, minConfidence: 0.4, rotation: false, return: false },
        mesh: { enabled: true },
        iris: { enabled: false },
        description: { enabled: true },
        emotion: { enabled: false },
        antispoof: { enabled: false },
        liveness: { enabled: false },
      },
      body: { enabled: false },
      hand: { enabled: false },
      object: { enabled: false },
      gesture: { enabled: false },
      segmentation: { enabled: false },
    });
    await human.load();
    console.log(`Visages : moteur prêt (backend ${human.tf.getBackend()})`);
    return human;
  })().catch((err) => {
    enginePromise = null;
    throw err;
  });
  return enginePromise;
}

const toBlob = (arr) => Buffer.from(new Float32Array(arr).buffer);
// Copie : le Buffer renvoyé par la base n'est pas forcément aligné sur 4 octets.
const fromBlob = (buf) => new Float32Array(Uint8Array.from(buf).buffer);

/** Détecte les visages d'une image (aperçu) : cadres relatifs + empreintes. */
export async function detect(previewKey) {
  const human = await engine();
  const { data, info } = await sharp(await readFile(previewKey)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const tensor = human.tf.tensor3d(new Uint8Array(data), [info.height, info.width, 3], 'int32');
  try {
    const result = await human.detect(tensor);
    return result.face
      .filter((f) => f.score >= MIN_SCORE && f.embedding?.length)
      .map((f) => ({
        box: [f.box[0] / info.width, f.box[1] / info.height, f.box[2] / info.width, f.box[3] / info.height],
        score: f.score,
        embedding: Array.from(f.embedding),
      }));
  } finally {
    tensor.dispose();
  }
}

/** Rattache un visage à la personne la plus ressemblante de la galerie, ou en crée une. */
async function assignPerson(eventId, face) {
  const people = await query('SELECT id, embedding, face_count FROM people WHERE event_id = ?', [eventId]);
  let best = null;
  for (const p of people) {
    const score = cosine(face.embedding, fromBlob(p.embedding));
    if (score >= MATCH && (!best || score > best.score)) best = { ...p, score };
  }
  if (!best) {
    const id = crypto.randomUUID();
    await query('INSERT INTO people (id, event_id, embedding, face_count) VALUES (?, ?, ?, 1)', [id, eventId, toBlob(face.embedding)]);
    return id;
  }
  // Empreinte moyenne mise à jour : la personne est mieux reconnue à chaque photo.
  const n = best.face_count;
  const mean = Array.from(fromBlob(best.embedding)).map((v, i) => (v * n + face.embedding[i]) / (n + 1));
  await query('UPDATE people SET embedding = ?, face_count = face_count + 1 WHERE id = ?', [toBlob(mean), best.id]);
  return best.id;
}

async function analyse(photo) {
  const faces = await detect(photo.preview_key);
  await query('DELETE FROM photo_faces WHERE photo_id = ?', [photo.id]);
  for (const face of faces) {
    const personId = await assignPerson(photo.event_id, face);
    await query(
      `INSERT INTO photo_faces (id, photo_id, person_id, box_x, box_y, box_w, box_h, score, embedding)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), photo.id, personId, ...face.box, face.score, toBlob(face.embedding)],
    );
  }
  await query("UPDATE photos SET faces_status = 'done' WHERE id = ?", [photo.id]);
  return faces.length;
}

// ---------- File d'attente ----------
let running = false;

/**
 * Au démarrage : les analyses interrompues (arrêt du serveur) et les échecs repassent
 * en attente — chaque redémarrage donne une nouvelle chance aux photos en échec.
 */
export async function resetInterruptedFaces() {
  await query("UPDATE photos SET faces_status = 'pending' WHERE faces_status IN ('processing', 'failed')");
}

/** Lance (ou relance) l'analyse des photos en attente. Sans effet si elle tourne déjà. */
export function kickFaces() {
  if (running || !config.facesEnabled) return;
  running = true;
  (async () => {
    try {
      for (;;) {
        const [photo] = await query(
          "SELECT id, event_id, preview_key FROM photos WHERE faces_status = 'pending' ORDER BY created_at LIMIT 1",
        );
        if (!photo) break;
        // Réservation atomique : si un autre processus l'a prise entre-temps, on passe à la suivante.
        const claim = await query("UPDATE photos SET faces_status = 'processing' WHERE id = ? AND faces_status = 'pending'", [photo.id]);
        if (!claim.affectedRows) continue;
        try {
          const t0 = Date.now();
          const n = await analyse(photo);
          if (!config.isProd) console.log(`Visages : ${n} visage(s) en ${((Date.now() - t0) / 1000).toFixed(1)} s (photo ${photo.id.slice(0, 8)})`);
        } catch (err) {
          console.error(`Visages : échec sur la photo ${photo.id} : ${err.message}`);
          await query("UPDATE photos SET faces_status = 'failed' WHERE id = ?", [photo.id]);
        }
      }
      await removeEmptyPeople();
    } catch (err) {
      console.error('Visages :', err.message);
    } finally {
      running = false;
    }
  })();
}

/** Supprime les personnes qui n'ont plus aucun visage (photos supprimées, fusions). */
export async function removeEmptyPeople() {
  await query('DELETE FROM people WHERE id NOT IN (SELECT DISTINCT person_id FROM photo_faces WHERE person_id IS NOT NULL)');
}

/** Fusionne deux personnes (même individu reconnu deux fois). */
export async function mergePeople(fromId, intoId) {
  await query('UPDATE photo_faces SET person_id = ? WHERE person_id = ?', [intoId, fromId]);
  const faces = await query('SELECT embedding FROM photo_faces WHERE person_id = ?', [intoId]);
  const sum = new Float32Array(1024);
  for (const f of faces) fromBlob(f.embedding).forEach((v, i) => { sum[i] += v; });
  const mean = Array.from(sum, (v) => v / Math.max(1, faces.length));
  await query('UPDATE people SET embedding = ?, face_count = ? WHERE id = ?', [toBlob(mean), faces.length, intoId]);
  await query('DELETE FROM people WHERE id = ?', [fromId]);
}

/** Relance l'analyse complète d'une galerie. */
export async function rescanEvent(eventId) {
  await query('DELETE FROM people WHERE event_id = ?', [eventId]); // visages : person_id -> NULL
  await query('DELETE FROM photo_faces WHERE photo_id IN (SELECT id FROM photos WHERE event_id = ?)', [eventId]);
  await query("UPDATE photos SET faces_status = 'pending' WHERE event_id = ?", [eventId]);
  kickFaces();
}

/** Vignette carrée d'un visage (cache : faces/<id>.webp). */
export async function faceThumbnail(face) {
  const key = `faces/${face.id}.webp`;
  if (await fileExists(key)) return key;
  const img = sharp(await readFile(face.preview_key));
  const { width, height } = await img.metadata();
  const pad = 0.35;
  const size = Math.max(face.box_w * width, face.box_h * height) * (1 + pad * 2);
  const cx = (face.box_x + face.box_w / 2) * width;
  const cy = (face.box_y + face.box_h / 2) * height;
  const left = Math.max(0, Math.round(cx - size / 2));
  const top = Math.max(0, Math.round(cy - size / 2));
  const side = Math.round(Math.min(size, width - left, height - top));
  await img.extract({ left, top, width: side, height: side }).resize(160, 160).webp({ quality: 82 }).toBuffer().then((buf) => putFile(key, buf, 'image/webp'));
  return key;
}
