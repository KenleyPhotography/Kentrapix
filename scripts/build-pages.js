import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

const entries = [
  '404.html',
  'manifest.webmanifest',
  'sw.js',
  'index.html',
  'login.html',
  'admin.html',
  'client.html',
  'portfolio.html',
  'reservation.html',
  'photographes.html',
  'tarifs.html',
  'suivi.html',
  'gallery.html',
  'share.html',
  'contrat.html',
  'facture.html',
  'conditions.html',
  'maintenance.html',
  'css',
  'js',
  'img',
  'logo',
  'downloads',
  'admin',
];

for (const entry of entries) {
  const source = path.join(root, entry);
  if (!fs.existsSync(source)) continue;
  fs.cpSync(source, path.join(output, entry), { recursive: true });
}
