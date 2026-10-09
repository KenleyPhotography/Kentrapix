import fs from 'node:fs/promises';
import path from 'node:path';
import { serverRoot } from '../config.js';

const dir = path.join(serverRoot, 'sql', 'migrations');

/**
 * Applique les fichiers sql/migrations/NNN_*.sql pas encore appliqués, chacun dans une transaction.
 * Utilisé par npm run db:init et au démarrage du serveur (Render n'a pas de terminal).
 * Un verrou évite que deux serveurs démarrés en même temps appliquent la même migration.
 * client : client pg déjà connecté (requêtes sans paramètres = plusieurs instructions permises).
 */
export async function applyMigrations(client, log = console.log) {
  const files = (await fs.readdir(dir).catch(() => [])).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const applied = [];
  for (const file of files) {
    await client.query('BEGIN');
    try {
      await client.query('SELECT pg_advisory_xact_lock(4851200)');
      const { rowCount } = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [file]);
      if (!rowCount) {
        await client.query(await fs.readFile(path.join(dir, file), 'utf8'));
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        applied.push(file);
        log(`Migration appliquée : ${file}`);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${file} : ${err.message}`);
    }
  }
  return applied;
}
