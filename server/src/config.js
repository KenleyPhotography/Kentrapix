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
  trustProxy: process.env.TRUST_PROXY === 'true',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: required('DB_USER'),
    password: process.env.DB_PASSWORD || '',
    database: required('DB_NAME'),
  },
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
};

// Appelé au démarrage du serveur web (pas par les scripts de base de données).
export function assertServerConfig() {
  if (config.jwtSecret.length < 32) {
    throw new Error('JWT_SECRET doit contenir au moins 32 caractères aléatoires (voir server/.env.example).');
  }
}
