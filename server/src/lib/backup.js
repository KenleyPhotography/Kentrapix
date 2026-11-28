import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { pipeline } from 'node:stream/promises';
import { S3Client, ListObjectsV2Command, CopyObjectCommand } from '@aws-sdk/client-s3';
import { withClient, query } from '../db.js';
import { config } from '../config.js';
import { httpError } from './errors.js';
import { putFile, readStream, listStoredFiles, removeKeys, isRemote, resolveKey } from './storage.js';

// Sauvegardes : toute la base (comptes, galeries, factures, sélections…) en un fichier compressé, chaque jour,
// gardé dans le stockage sous « backups/ » (jamais touché par le nettoyage de l'espace). Les photos elles-mêmes
// peuvent être recopiées vers une 2e copie (autre bucket BACKUP_S3_BUCKET, ou dossier BACKUP_DIR en local).
const PREFIX = 'backups/';
const KEEP = 14; // sauvegardes gardées (les plus récentes)
const EVERY = 6 * 60 * 60 * 1000; // vérification toutes les 6 h ; une sauvegarde par jour suffit
const DAY = 24 * 60 * 60 * 1000;
const PAGE = 2000;
const quote = (name) => `"${String(name).replace(/"/g, '""')}"`;
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

const parseName = (key) => {
  const m = String(key).match(/^backups\/db-(\d{8})-(\d{6})-([a-z-]+)\.ndjson\.gz$/);
  if (!m) return null;
  const iso = `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}T${m[2].slice(0, 2)}:${m[2].slice(2, 4)}:${m[2].slice(4, 6)}Z`;
  return { createdAt: iso, reason: m[3] };
};

/** Le propriétaire principal (le plus ancien) gère les sauvegardes : elles contiennent les données de tous les photographes. */
export async function isPlatformOwner(user) {
  const [first] = await query("SELECT id FROM users WHERE role = 'owner' ORDER BY created_at, id LIMIT 1");
  return !!first && first.id === user.id;
}

/** Liste des sauvegardes, la plus récente d'abord : [{ key, name, size, createdAt, reason }]. */
export async function listBackups() {
  const files = await listStoredFiles();
  return files
    .map((f) => ({ f, meta: parseName(f.key) }))
    .filter((x) => x.meta)
    .map(({ f, meta }) => ({ key: f.key, name: f.key.slice(PREFIX.length), size: f.size, ...meta }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const write = async (stream, text) => {
  if (!stream.write(text)) await once(stream, 'drain');
};

/** Sauvegarde complète de la base. reason : auto | manuelle | avant-restauration */
export async function createBackup({ reason = 'auto' } = {}) {
  const key = `${PREFIX}db-${stamp()}-${reason}.ndjson.gz`;
  const tmp = path.join(config.storageDir, 'tmp', `${crypto.randomUUID()}.backup.gz`);
  await fsp.mkdir(path.dirname(tmp), { recursive: true });
  const gzip = zlib.createGzip({ level: 6 });
  const done = pipeline(gzip, fs.createWriteStream(tmp));
  const counts = {};
  try {
    await withClient(async (c) => {
      // Une seule « photo » cohérente de la base pendant toute la lecture.
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      try {
        const { rows: tables } = await c.query(
          "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name",
        );
        const names = tables.map((t) => t.table_name);
        const { rows: migrations } = await c.query('SELECT version FROM schema_migrations ORDER BY version').catch(() => ({ rows: [] }));
        await write(gzip, `${JSON.stringify({ kind: 'kentrapix-backup', v: 1, createdAt: new Date().toISOString(), reason, tables: names, migrations: migrations.map((m) => m.version) })}\n`);
        for (const t of names) {
          counts[t] = 0;
          for (let offset = 0; ; offset += PAGE) {
            const { rows } = await c.query(`SELECT * FROM ${quote(t)} ORDER BY ctid LIMIT ${PAGE} OFFSET ${offset}`);
            for (const r of rows) await write(gzip, `${JSON.stringify({ t, r })}\n`);
            counts[t] += rows.length;
            if (rows.length < PAGE) break;
          }
        }
      } finally {
        await c.query('ROLLBACK');
      }
    });
    gzip.end();
    await done;
    await putFile(key, tmp, 'application/gzip');
    const size = (await fsp.stat(tmp)).size;
    return { key, name: key.slice(PREFIX.length), size, rows: Object.values(counts).reduce((a, b) => a + b, 0), ...parseName(key) };
  } catch (err) {
    gzip.destroy();
    throw err;
  } finally {
    await fsp.rm(tmp, { force: true });
  }
}

/** Garde les KEEP sauvegardes les plus récentes. */
export async function pruneBackups() {
  const all = await listBackups();
  const old = all.slice(KEEP).map((b) => b.key);
  if (old.length) await removeKeys(old);
  return old.length;
}

const validKey = (key) => {
  if (!parseName(key)) throw httpError(400, 'Sauvegarde invalide.');
  return key;
};

/** Flux du fichier de sauvegarde (téléchargement). */
export async function openBackup(key) {
  return readStream(validKey(key));
}

export async function deleteBackup(key) {
  await removeKeys([validKey(key)]);
}

/**
 * Restaure la base depuis une sauvegarde : tout est remplacé dans UNE transaction (en cas d'erreur, rien ne change).
 * Une sauvegarde de sécurité de l'état actuel est faite juste avant.
 */
export async function restoreBackup(key) {
  validKey(key);
  const safety = await createBackup({ reason: 'avant-restauration' });
  const restored = {};
  await withClient(async (c) => {
    await c.query('BEGIN');
    try {
      // Les clés étrangères sont suspendues le temps de la restauration (tout est remis d'un coup, dans le même état qu'avant).
      await c.query("SET LOCAL session_replication_role = 'replica'");
      const { rows: cols } = await c.query(
        'SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema() ORDER BY table_name, ordinal_position',
      );
      const columns = {};
      for (const r of cols) (columns[r.table_name] ??= []).push(r.column_name);
      // Lecture du fichier seulement maintenant : un flux commencé plus tôt perdrait ses premières lignes pendant les requêtes ci-dessus.
      const lines = readline.createInterface({ input: (await readStream(key)).pipe(zlib.createGunzip()), crlfDelay: Infinity });
      let header = null;
      let batch = [];
      let batchTable = null;
      const flush = async () => {
        if (!batch.length) return;
        const names = Object.keys(batch[0]);
        const values = [];
        const rowsSql = batch.map((row) => `(${names.map((n) => {
          const v = row[n];
          values.push(v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
          return `$${values.length}`;
        }).join(', ')})`).join(', ');
        await c.query(`INSERT INTO ${quote(batchTable)} (${names.map(quote).join(', ')}) VALUES ${rowsSql}`, values);
        restored[batchTable] = (restored[batchTable] || 0) + batch.length;
        batch = [];
      };
      for await (const line of lines) {
        if (!line.trim()) continue;
        const entry = JSON.parse(line);
        if (!header) {
          if (entry.kind !== 'kentrapix-backup') throw httpError(400, 'Ce fichier n’est pas une sauvegarde KentraPix.');
          header = entry;
          // schema_migrations reste tel quel : la structure actuelle de la base ne change pas.
          const targets = entry.tables.filter((t) => columns[t] && t !== 'schema_migrations');
          if (targets.length) await c.query(`TRUNCATE TABLE ${targets.map(quote).join(', ')}`);
          continue;
        }
        const { t, r } = entry;
        if (!columns[t] || t === 'schema_migrations') continue;
        // Colonnes qui n'existent plus dans la base actuelle : ignorées ; nouvelles colonnes : valeur par défaut.
        const row = Object.fromEntries(Object.entries(r).filter(([k]) => columns[t].includes(k)));
        if (!Object.keys(row).length) continue;
        const sameShape = batch.length && batchTable === t && Object.keys(batch[0]).join() === Object.keys(row).join();
        if (batch.length && (!sameShape || batch.length >= 200)) await flush();
        batchTable = t;
        batch.push(row);
      }
      await flush();
      if (!header) throw httpError(400, 'Sauvegarde vide.');
      await c.query('COMMIT');
    } catch (err) {
      await c.query('ROLLBACK').catch(() => {});
      throw err;
    }
  });
  return { restored, safety: safety.name };
}

// ---------- Copie des photos (2e emplacement) ----------
const MIRROR_FOLDERS = ['originals', 'previews', 'covers', 'avatars', 'music', 'portfolios', 'photographer-logos', 'backups'];
const MIRROR_BATCH = 300; // objets copiés par passage (borne la durée ; la suite au passage suivant)

export const mirrorConfig = () => {
  if (process.env.BACKUP_S3_BUCKET && isRemote) return { kind: 's3', bucket: process.env.BACKUP_S3_BUCKET };
  if (process.env.BACKUP_DIR) return { kind: 'dir', dir: path.resolve(process.env.BACKUP_DIR) };
  return null;
};

let backupClient;
const backupS3 = () => {
  const s = config.s3;
  backupClient ??= new S3Client({
    endpoint: process.env.BACKUP_S3_ENDPOINT || s.endpoint,
    region: process.env.BACKUP_S3_REGION || s.region,
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.BACKUP_S3_KEY_ID || s.keyId, secretAccessKey: process.env.BACKUP_S3_SECRET || s.secret },
  });
  return backupClient;
};

async function walkDir(dir, prefix, out = []) {
  for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.isDirectory()) await walkDir(path.join(dir, e.name), `${prefix}${e.name}/`, out);
    else out.push(`${prefix}${e.name}`);
  }
  return out;
}

/** Copie vers la 2e destination les fichiers qui n'y sont pas encore. Renvoie { copied, remaining }. */
export async function mirrorFiles() {
  const mirror = mirrorConfig();
  if (!mirror) return { enabled: false, copied: 0, remaining: 0 };
  const files = (await listStoredFiles()).filter((f) => MIRROR_FOLDERS.includes(f.key.split('/')[0]));
  let have = new Set();
  if (mirror.kind === 's3') {
    let token;
    do {
      const page = await backupS3().send(new ListObjectsV2Command({ Bucket: mirror.bucket, ContinuationToken: token }));
      for (const o of page.Contents || []) have.add(o.Key);
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  } else {
    have = new Set(await walkDir(mirror.dir, ''));
  }
  const missing = files.filter((f) => !have.has(f.key));
  let copied = 0;
  for (const f of missing.slice(0, MIRROR_BATCH)) {
    if (mirror.kind === 's3') {
      await backupS3().send(new CopyObjectCommand({ Bucket: mirror.bucket, Key: f.key, CopySource: `${config.s3.bucket}/${f.key}` }));
    } else {
      const target = path.join(mirror.dir, ...f.key.split('/'));
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.copyFile(resolveKey(f.key), target);
    }
    copied += 1;
  }
  return { enabled: true, copied, remaining: Math.max(0, missing.length - copied), total: files.length };
}

// ---------- Planification ----------
export async function runScheduledBackup() {
  const [latest] = (await listBackups()).filter((b) => b.reason === 'auto');
  if (!latest || Date.now() - Date.parse(latest.createdAt) > DAY - 60 * 60 * 1000) {
    const b = await createBackup({ reason: 'auto' });
    console.log(`Sauvegarde automatique : ${b.name} (${b.rows} lignes, ${(b.size / 1024).toFixed(0)} Ko)`);
    await pruneBackups();
  }
  const m = await mirrorFiles();
  if (m.copied) console.log(`Copie des photos : ${m.copied} fichier(s), ${m.remaining} restant(s).`);
}

export function startBackups() {
  const run = () => runScheduledBackup().catch((err) => console.error('Sauvegarde automatique :', err.message));
  setTimeout(run, 90_000).unref(); // laisse le serveur démarrer d'abord
  setInterval(run, EVERY).unref();
}
