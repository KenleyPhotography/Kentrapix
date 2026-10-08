import mysql from 'mysql2/promise';
import { config } from './config.js';

export const pool = mysql.createPool({
  ...config.db,
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
  // DATE -> 'YYYY-MM-DD', TIMESTAMP -> 'YYYY-MM-DD HH:MM:SS' (UTC) : pas de décalage de fuseau.
  dateStrings: true,
});

// Toutes les connexions travaillent en UTC.
pool.pool.on('connection', (conn) => conn.query("SET time_zone = '+00:00'"));

/** Requête préparée (protège contre les injections SQL). */
export async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/** Exécute fn(conn) dans une transaction ; annule tout en cas d'erreur. */
export async function transaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** '?, ?, ?' pour une clause IN de n éléments. */
export const placeholders = (n) => Array(n).fill('?').join(', ');

/** TIMESTAMP MySQL (UTC) -> ISO 8601. */
export const toIso = (value) => (value ? `${value.replace(' ', 'T')}Z` : null);
