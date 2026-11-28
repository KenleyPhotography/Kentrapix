// Update an existing database without reapplying the base schema.
import pg from 'pg';
import { pgConfig } from '../src/config.js';
import { applyMigrations } from '../src/lib/migrate.js';

const { label: _label, ...options } = pgConfig();
const client = new pg.Client({ ...options, connectionTimeoutMillis: 15000 });
try {
  await client.connect();
  await client.query("SET TIME ZONE 'UTC'");
  await client.query('SELECT version FROM schema_migrations LIMIT 1');
  const applied = await applyMigrations(client);
  const { rows } = await client.query(`SELECT
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'photographer_profiles' AND column_name = 'facebook') AS facebook,
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'photographer_profiles' AND column_name = 'other_links') AS other_links,
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'subscription_exempt') AS free_access,
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'subscription_suspended') AS suspension,
    EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'subscription_reminders') AS reminders`);
  if (!Object.values(rows[0]).every(Boolean)) throw new Error('Migration verification failed');
  console.log(JSON.stringify({ applied, verified: rows[0] }, null, 2));
} catch (error) {
  console.error('Database migration failed (' + (error.code || error.name) + '). Check the connection and migration history.');
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
