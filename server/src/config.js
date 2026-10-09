import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const serverRoot = path.resolve(here, '..');
// Le frontend (HTML/CSS/JS) est le dossier parent de server/.
export const frontendRoot = path.resolve(serverRoot, '..');

try {
  process.loadEnvFile(path.join(serverRoot, '.env'));
} catch {
  // Pas de .env : on utilise les variables d'environnement de l'hébergeur.
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Variable d'environnement manquante : ${name} (voir server/.env.example)`);
  return value;
}

const env = process.env.NODE_ENV || 'development';

export const config = {
  env,
  isProd: env === 'production',
  port: Number(process.env.PORT || 3000),
  // Production derrière Cloudflare Tunnel : 127.0.0.1 (le site n'est joignable que par le tunnel).
  host: process.env.HOST || undefined,
  trustProxy: process.env.TRUST_PROXY === 'true',
  jwtSecret: process.env.JWT_SECRET || '',
  sessionDays: Number(process.env.SESSION_DAYS || 7),
  storageDir: path.resolve(serverRoot, process.env.STORAGE_DIR || 'storage'),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 50),
  previewWidth: Number(process.env.PREVIEW_WIDTH || 1600),
  // Adresse publique du site, utilisée dans les liens des e-mails.
  appUrl: (process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, ''),
  mail: {
    resendKey: process.env.RESEND_API_KEY || '',
    from: process.env.MAIL_FROM || '',
    replyTo: process.env.MAIL_REPLY_TO || '',
  },
  // Stockage en ligne des photos (Backblaze B2, ou tout service compatible S3 : R2, Oracle…).
  // Vide = photos dans STORAGE_DIR sur ce serveur.
  s3: s3Config(),
  // true = ne jamais supprimer de fichier photo (copie de test qui partage le bucket de la production).
  keepFiles: process.env.STORAGE_KEEP_FILES === 'true',
  // false = pas d'analyse des visages (petit hébergement : ~300 Mo de mémoire en moins). Les photos restent « en attente ».
  facesEnabled: process.env.FACES_ENABLED !== 'false',
};

// Supabase : Project Settings > Database > Connection string > « Session pooler » (IPv4).
export function pgConfig() {
  const url = required('DATABASE_URL').trim();
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const ssl = process.env.DATABASE_SSL === 'false' || (local && process.env.DATABASE_SSL !== 'true')
    ? false
    : process.env.DATABASE_CA
      // Certificat de Supabase (Database Settings > SSL) : connexion chiffrée ET vérifiée.
      ? { ca: fs.readFileSync(path.resolve(serverRoot, process.env.DATABASE_CA), 'utf8') }
      : { rejectUnauthorized: false };
  return { connectionString: url, ssl, label: new URL(url).host };
}

function s3Config() {
  const endpoint = (process.env.B2_ENDPOINT || process.env.S3_ENDPOINT || '').trim().replace(/\/$/, '');
  const bucket = (process.env.B2_BUCKET || process.env.S3_BUCKET || '').trim();
  const keyId = (process.env.B2_KEY_ID || process.env.S3_KEY_ID || '').trim();
  const secret = (process.env.B2_APPLICATION_KEY || process.env.S3_SECRET || '').trim();
  if (!endpoint || !bucket || !keyId || !secret) return null;
  const url = endpoint.startsWith('http') ? endpoint : `https://${endpoint}`;
  // s3.us-east-005.backblazeb2.com -> us-east-005
  const region = process.env.S3_REGION || new URL(url).hostname.match(/^s3\.([^.]+)\./)?.[1] || 'auto';
  return { endpoint: url, origin: new URL(url).origin, bucket, keyId, secret, region };
}

// Appelé au démarrage du serveur web (pas par les scripts de base de données).
export function assertServerConfig() {
  if (config.jwtSecret.length < 32) {
    throw new Error('JWT_SECRET doit contenir au moins 32 caractères aléatoires (voir server/.env.example).');
  }
}
