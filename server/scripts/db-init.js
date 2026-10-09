// Crée les tables et les vues (sql/schema.sql), puis applique les migrations de sql/migrations/
// pas encore appliquées. Base : DATABASE_URL (Supabase).
// Usage : npm run db:init   — peut être relancé sans risque.
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { serverRoot, pgConfig } from '../src/config.js';

const sqlDir = path.join(serverRoot, 'sql');
const { label, ...options } = pgConfig();
const client = new pg.Client(options);
await client.connect();

try {
  const { rows: [{ version }] } = await client.query("SELECT current_setting('server_version') AS version");
  console.log(`Serveur PostgreSQL ${version} sur ${label}`);
  await client.query("SET TIME ZONE 'UTC'");

  await client.query(await fs.readFile(path.join(sqlDir, 'schema.sql'), 'utf8'));
  console.log('Schéma de base appliqué.');

  // Migrations : fichiers NNN_description.sql, appliqués une seule fois, dans l'ordre.
  const files = (await fs.readdir(path.join(sqlDir, 'migrations')).catch(() => []))
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();
  const { rows: done } = await client.query('SELECT version FROM schema_migrations');
  const applied = new Set(done.map((r) => r.version));
  for (const file of files.filter((f) => !applied.has(f))) {
    await client.query('BEGIN');
    try {
      await client.query(await fs.readFile(path.join(sqlDir, 'migrations', file), 'utf8'));
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
    console.log(`Migration appliquée : ${file}`);
  }

  const { rows: tables } = await client.query(
    `SELECT c.relname AS name, c.relkind AS kind, c.relrowsecurity AS rls
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v') ORDER BY c.relkind, c.relname`,
  );
  console.table(tables.map((t) => ({
    nom: t.name,
    type: t.kind === 'v' ? 'vue' : 'table',
    'API Supabase bloquée (RLS)': t.kind === 'v' ? '' : t.rls ? 'oui' : 'NON',
  })));
  console.log('Base prête.');
} finally {
  await client.end();
}
