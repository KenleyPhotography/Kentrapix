// Envoie les photos déjà stockées sur ce PC (STORAGE_DIR) vers le bucket en ligne.
// Relançable sans risque : un fichier déjà présent avec la même taille est ignoré.
// Usage : npm run storage:migrate            (copie)
//         npm run storage:migrate -- --delete-local   (copie, vérifie, puis supprime la copie locale)
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../src/config.js';
import { isRemote, putFile, fileSize } from '../src/lib/storage.js';

if (!isRemote) {
  console.error('Stockage en ligne non configuré : ajoutez B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET et B2_ENDPOINT dans server/.env');
  process.exit(1);
}
const deleteLocal = process.argv.includes('--delete-local');
// Les filigranes se régénèrent tout seuls : inutile de les copier.
const FOLDERS = ['originals', 'previews', 'covers', 'avatars', 'music'];

let copied = 0, skipped = 0, failed = 0, removed = 0, bytes = 0;
for (const folder of FOLDERS) {
  const dir = path.join(config.storageDir, folder);
  const files = await fs.readdir(dir).catch(() => []);
  for (const name of files) {
    const key = `${folder}/${name}`;
    const local = path.join(dir, name);
    const { size } = await fs.stat(local);
    try {
      if ((await fileSize(key)) === size) skipped++;
      else {
        await putFile(key, local);
        if ((await fileSize(key)) !== size) throw new Error('taille différente après envoi');
        copied++;
        bytes += size;
      }
      if (deleteLocal) {
        await fs.rm(local, { force: true });
        removed++;
      }
      process.stdout.write(`\r${copied} envoyé(s), ${skipped} déjà en ligne, ${failed} échec(s)   `);
    } catch (err) {
      failed++;
      console.error(`\n${key} : ${err.message}`);
    }
  }
}
console.log(`\nTerminé : ${copied} fichier(s) envoyé(s) (${(bytes / 1024 / 1024).toFixed(1)} Mo), ${skipped} déjà en ligne, ${failed} échec(s).`);
if (deleteLocal) console.log(`${removed} copie(s) locale(s) supprimée(s).`);
process.exit(failed ? 1 : 0);
