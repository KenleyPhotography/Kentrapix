// Crée la base (si l'utilisateur MySQL en a le droit), les tables et les vues,
// puis applique les migrations de sql/migrations/ pas encore appliquées.
// Usage : npm run db:init   — peut être relancé sans risque.
import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { config, serverRoot } from '../src/config.js';

const { database, ...access } = config.db;
const sqlDir = path.join(serverRoot, 'sql');
const conn = await mysql.createConnection({ ...access, multipleStatements: true, charset: 'utf8mb4' });

try {
  const [[{ version }]] = await conn.query('SELECT VERSION() AS version');
  console.log(`Serveur MySQL ${version} sur ${access.host}:${access.port}`);

  await conn
    .query(`CREATE DATABASE IF NOT EXISTS \`${database.replace(/`/g, '')}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
    .catch((err) => console.warn(`Base non créée automatiquement (${err.code}) — elle doit déjà exister.`));
  await conn.changeUser({ database });
  await conn.query("SET time_zone = '+00:00'");

  await conn.query(await fs.readFile(path.join(sqlDir, 'schema.sql'), 'utf8'));
  console.log('Schéma de base appliqué.');

  // Migrations : fichiers NNN_description.sql, appliqués une seule fois, dans l'ordre.
  const files = (await fs.readdir(path.join(sqlDir, 'migrations')).catch(() => []))
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();
  const [done] = await conn.query('SELECT version FROM schema_migrations');
  const applied = new Set(done.map((r) => r.version));
  for (const file of files.filter((f) => !applied.has(f))) {
    await conn.query(await fs.readFile(path.join(sqlDir, 'migrations', file), 'utf8'));
    await conn.query('INSERT INTO schema_migrations (version) VALUES (?)', [file]);
    console.log(`Migration appliquée : ${file}`);
  }

  const [tables] = await conn.query(
    `SELECT TABLE_NAME AS name, TABLE_TYPE AS type, TABLE_ROWS AS approxRows, TABLE_COMMENT AS comment
     FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_TYPE, TABLE_NAME`,
    [database],
  );
  console.table(tables.map((t) => ({
    nom: t.name,
    type: t.type === 'VIEW' ? 'vue' : 'table',
    lignes: t.type === 'VIEW' ? '' : t.approxRows,
    description: t.comment === 'VIEW' ? '' : t.comment,
  })));
  console.log(`Base « ${database} » prête.`);
} finally {
  await conn.end();
}
