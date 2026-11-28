// Accept a one-session connection through hidden stdin, never shell arguments.
import pg from 'pg';
import fs from 'node:fs/promises';
import { serverRoot, pgConfig } from '../src/config.js';
import path from 'node:path';
import crypto from 'node:crypto';

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
process.stdout.write('Ready for database connection on hidden stdin.\n');
const raw = await new Promise((resolve, reject) => {
  let buffer = '';
  const read = chunk => {
    if (chunk.includes('\u0003')) return reject(new Error('Cancelled'));
    buffer += chunk;
    if (!buffer.includes('\n') && !buffer.includes('\r')) return;
    process.stdin.off('data', read);
    process.stdin.pause();
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    resolve(buffer.trim());
  };
  process.stdin.on('data', read);
});
const input = JSON.parse(raw);
process.env.DATABASE_URL = input.databaseUrl.trim();
const { label: _label, ...options } = pgConfig();
const client = new pg.Client({ ...options, connectionTimeoutMillis: 15000 });
try {
  await client.connect();
  const { rows } = await client.query('SELECT version FROM schema_migrations ORDER BY version');
  const applied = new Set(rows.map(row => row.version));
  const files = (await fs.readdir(path.join(serverRoot, 'sql/migrations'))).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
  const pending = files.filter(file => !applied.has(file));
  const { rows: tables } = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
  console.log(JSON.stringify({ connected: true, appliedCount: rows.length, pending, tables: tables.map(row => row.tablename) }, null, 2));
  if (input.action === 'migrate') {
    if (pending.some(file => Number(file.slice(0, 3)) < 63)) throw new Error('Unexpected older pending migrations');
    if (pending.length) {
      const backup = { createdAt: new Date().toISOString(), tables: {}, columns: [] };
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      try {
        for (const { tablename } of tables) {
          const identifier = '"' + tablename.replaceAll('"', '""') + '"';
          backup.tables[tablename] = (await client.query('SELECT * FROM public.' + identifier)).rows;
        }
        backup.columns = (await client.query("SELECT * FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position")).rows;
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
      const key = crypto.scryptSync(process.env.DATABASE_URL, salt, 32);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(backup)), cipher.final()]);
      const directory = path.join(serverRoot, '.db-backups');
      await fs.mkdir(directory, { recursive: true });
      const file = path.join(directory, 'before-subscriptions-' + Date.now() + '.json.enc');
      await fs.writeFile(file, JSON.stringify({ algorithm: 'aes-256-gcm', kdf: 'scrypt', salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: ciphertext.toString('base64') }), { mode: 0o600 });
      console.log('Encrypted pre-migration data snapshot saved under server/.db-backups.');
    }
    const { applyMigrations } = await import('../src/lib/migrate.js');
    const appliedNow = await applyMigrations(client);
    const { rows: verified } = await client.query(`SELECT version FROM schema_migrations WHERE version >= '063_' ORDER BY version`);
    const { rows: payment } = await client.query(`SELECT COALESCE(booking_payment->>'moncash', '') <> '' AS moncash_available,
      COALESCE(booking_payment->>'natcash', '') <> '' AS natcash_available FROM site_public_services WHERE id = 1`);
    console.log(JSON.stringify({ appliedNow, verified: verified.map(row => row.version), paymentMethods: payment[0] }, null, 2));
  }
} catch (error) {
  console.error('Database check failed (' + (error.code || error.name) + ').');
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
