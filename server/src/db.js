// Base de données PostgreSQL (Supabase). Adresse : DATABASE_URL dans .env.
// Les routes écrivent leurs requêtes avec des « ? » ; ce fichier les numérote ($1, $2…).
import pg from 'pg';
import { pgConfig } from './config.js';

// Dates et horodatages en texte UTC ('YYYY-MM-DD', 'YYYY-MM-DD HH:MM:SS'), grands entiers en nombres.
pg.types.setTypeParser(1082, (v) => v); // DATE
pg.types.setTypeParser(1114, (v) => v.slice(0, 19)); // TIMESTAMP
pg.types.setTypeParser(20, Number); // BIGINT (COUNT, ROW_NUMBER…)
pg.types.setTypeParser(1700, Number); // NUMERIC (SUM…)

const { label, ...options } = pgConfig();
// Supabase (Session pooler, offre gratuite) : 15 connexions au total pour tout le projet.
// 5 par serveur : deux serveurs (ex. PC + Render pendant la bascule) et les scripts tiennent dedans.
const pool = new pg.Pool({ ...options, max: Number(process.env.DB_POOL_MAX || 5) });
pool.on('error', (err) => console.error('PostgreSQL :', err.message));

/** Base utilisée, pour les messages. */
export const dbLabel = `PostgreSQL ${label}`;

// Chaque connexion travaille en UTC (réglé une fois, avant sa première requête).
const utc = new WeakSet();
async function connect() {
  const client = await pool.connect();
  if (!utc.has(client)) {
    try {
      await client.query("SET TIME ZONE 'UTC'");
    } catch (err) {
      client.release(err);
      throw err;
    }
    utc.add(client);
  }
  return client;
}

async function run(client, sql, params) {
  const res = await client.query(numbered(sql), params.map(toValue));
  const rows = res.rows ?? [];
  rows.affectedRows = res.rowCount ?? 0;
  return rows;
}

/** Requête préparée (protège contre les injections SQL). Écritures : rows.affectedRows. */
export async function query(sql, params = []) {
  const client = await connect();
  try {
    return await run(client, sql, params);
  } finally {
    client.release();
  }
}

/** Exécute fn(conn) dans une transaction ; annule tout en cas d'erreur. conn.execute() renvoie [rows]. */
export async function transaction(fn) {
  const client = await connect();
  try {
    await client.query('BEGIN');
    const result = await fn({ execute: async (sql, params = []) => [await run(client, sql, params)] });
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Exécute fn(client) avec une connexion dédiée (scripts SQL à plusieurs instructions, migrations). */
export async function withClient(fn) {
  const client = await connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/** Vérifie la connexion. */
export const ping = () => query('SELECT 1');

/** Ferme les connexions (arrêt du serveur, fin d'un script). */
export const closeDb = () => pool.end();

/** '?, ?, ?' pour une clause IN de n éléments. */
export const placeholders = (n) => Array(n).fill('?').join(', ');

/** Date -> 'YYYY-MM-DD HH:MM:SS' (UTC), format des colonnes TIMESTAMP. */
export const utcStamp = (date) => date.toISOString().slice(0, 19).replace('T', ' ');

/** TIMESTAMP (UTC) -> ISO 8601. */
export const toIso = (value) => (value ? `${value.replace(' ', 'T')}Z` : null);

/** « ? » -> $1, $2… (sauf dans les chaînes 'texte'). */
function numbered(sql) {
  let n = 0;
  return sql
    .split(/('(?:[^']|'')*')/)
    .map((part, i) => (i % 2 ? part : part.replace(/\?/g, () => `$${++n}`)))
    .join('');
}

/** Booléens -> 0/1 (colonnes SMALLINT) ; dates -> texte UTC. */
const toValue = (v) => (typeof v === 'boolean' ? Number(v) : v instanceof Date ? utcStamp(v) : v);
