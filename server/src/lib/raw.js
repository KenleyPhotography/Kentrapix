import fs from 'node:fs/promises';

// Fichiers RAW des appareils photo (NEF, CR2, CR3, ARW, DNG…). Ni sharp ni les navigateurs ne savent
// les développer, mais l'appareil enregistre dedans un JPEG déjà développé, presque toujours en pleine
// taille : c'est lui qui est extrait ici, puis utilisé comme original téléchargeable, comme couverture
// et comme aperçu. Le RAW lui-même n'est jamais conservé.
export const RAW_EXTENSIONS = [
  'cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'dng', 'raf', 'orf',
  'rw2', 'rwl', 'pef', 'srw', 'x3f', '3fr', 'iiq', 'erf', 'kdc', 'mrw', 'raw',
];

/** true si ce nom de fichier est un RAW (l'extension décide : un NEF s'ouvre à moitié comme un TIFF). */
export const isRawName = (name) => RAW_EXTENSIONS.includes(String(name || '').split('.').pop().toLowerCase());

/** Même nom, rangé sous le JPEG extrait : DSC_0001.NEF -> DSC_0001.jpg. */
export const rawToJpgName = (name) => `${String(name || '').replace(/\.[^.]*$/, '')}.jpg`;

const SOI = Buffer.from([0xFF, 0xD8, 0xFF]);

/**
 * Le plus grand JPEG contenu dans un RAW, avec son orientation.
 * Renvoie { data, width, height } ou null si le fichier ne contient aucune image lisible.
 */
export async function rawJpeg(source) {
  const b = Buffer.isBuffer(source) ? source : await fs.readFile(source);
  const found = [];
  for (let i = b.indexOf(SOI); i >= 0; i = b.indexOf(SOI, i + 1)) {
    const j = jpegAt(b, i);
    if (j) {
      found.push(j);
      i = j.end - 1;
    }
  }
  if (!found.length) return null;
  found.sort((x, y) => y.w * y.h - x.w * x.h);
  const best = found[0];
  const jpeg = b.subarray(best.start, best.end);
  // Les JPEG intégrés sont souvent livrés sans EXIF : l'orientation vient alors de l'en-tête TIFF du RAW.
  const orientation = hasExif(jpeg) ? 0 : tiffOrientationOf(b);
  return {
    data: orientation > 1 ? withOrientation(jpeg, orientation) : Buffer.from(jpeg),
    width: best.w,
    height: best.h,
  };
}

/**
 * Parcourt les segments d'un JPEG commençant à `s` : renvoie ses bornes et sa taille,
 * ou null (données RAW compressées, JPEG sans perte…).
 */
function jpegAt(b, s) {
  let i = s + 2;
  let w = 0;
  let h = 0;
  while (i + 2 <= b.length) {
    if (b[i] !== 0xFF) return null;
    const m = b[i + 1];
    if (m === 0xFF) { i += 1; continue; } // octets de remplissage
    if (m === 0xD9) return w ? { start: s, end: i + 2, w, h } : null;
    if ((m >= 0xD0 && m <= 0xD7) || m === 0x01) { i += 2; continue; }
    if (i + 4 > b.length) return null; // longueur de segment tronquée
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2) return null;
    if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
      if (m === 0xC3 || m === 0xC7 || m === 0xCB || m === 0xCF) return null; // JPEG sans perte : les données du capteur
      h = (b[i + 5] << 8) | b[i + 6];
      w = (b[i + 7] << 8) | b[i + 8];
    }
    i += 2 + len;
    // Données compressées : on saute jusqu'au prochain marqueur (hors octets bourrés et redémarrages).
    if (m === 0xDA) while (i + 1 < b.length && !(b[i] === 0xFF && b[i + 1] !== 0x00 && !(b[i + 1] >= 0xD0 && b[i + 1] <= 0xD7))) i += 1;
  }
  return null;
}

/** true si ce JPEG porte déjà un bloc EXIF (son orientation est alors la bonne). */
function hasExif(b) {
  let i = 2;
  while (i + 4 <= b.length && b[i] === 0xFF) {
    const m = b[i + 1];
    if (m === 0xDA || m === 0xD9) return false;
    if (m === 0xE1 && b.toString('latin1', i + 4, i + 8) === 'Exif') return true;
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2) return false;
    i += 2 + len;
  }
  return false;
}

/**
 * Orientation (balise TIFF 0x0112) : en tête du fichier (CR2, NEF, ARW, DNG…) ou dans la boîte
 * CMT1 des CR3. 0 si introuvable.
 */
function tiffOrientationOf(b) {
  const head = tiffOrientation(b, 0);
  if (head) return head;
  const cmt1 = b.indexOf('CMT1', 0, 'latin1');
  return cmt1 > 0 && cmt1 < (1 << 16) ? tiffOrientation(b, cmt1 + 4) : 0;
}

function tiffOrientation(b, base) {
  const le = b[base] === 0x49 && b[base + 1] === 0x49;
  if (!le && !(b[base] === 0x4D && b[base + 1] === 0x4D)) return 0;
  const u16 = (o) => (le ? b.readUInt16LE(base + o) : b.readUInt16BE(base + o));
  const u32 = (o) => (le ? b.readUInt32LE(base + o) : b.readUInt32BE(base + o));
  if (base + 8 > b.length) return 0;
  const ifd = u32(4);
  if (base + ifd + 2 > b.length) return 0;
  const n = u16(ifd);
  for (let k = 0; k < n; k += 1) {
    const e = ifd + 2 + k * 12;
    if (base + e + 12 > b.length) break;
    if (u16(e) === 0x0112) {
      const o = u16(e + 8);
      return o >= 1 && o <= 8 ? o : 0;
    }
  }
  return 0;
}

/**
 * Ajoute un bloc EXIF minimal (orientation seule) juste après le début du JPEG : l'image n'est pas
 * recompressée, et sharp comme les navigateurs la redressent ensuite tout seuls.
 */
function withOrientation(jpeg, orientation) {
  const tiff = Buffer.alloc(26);
  tiff.write('II', 0, 'latin1'); // petit-boutiste
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4); // position du 1er répertoire
  tiff.writeUInt16LE(1, 8); // une seule balise
  tiff.writeUInt16LE(0x0112, 10); // orientation
  tiff.writeUInt16LE(3, 12); // entier court
  tiff.writeUInt32LE(1, 14); // une valeur
  tiff.writeUInt16LE(orientation, 18);
  tiff.writeUInt32LE(0, 22); // pas de répertoire suivant
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const app1 = Buffer.concat([Buffer.from([0xFF, 0xE1, (body.length + 2) >> 8, (body.length + 2) & 0xFF]), body]);
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}
