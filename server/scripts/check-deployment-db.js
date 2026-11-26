import { readdir } from 'node:fs/promises';

let closeDb;
try {
  const db = await import('../src/db.js');
  closeDb = db.closeDb;
  await db.ping();
  const files = (await readdir(new URL('../sql/migrations/', import.meta.url)))
    .filter(name => /^\d+_.+\.sql$/.test(name)).sort();
  const applied = new Set((await db.query('SELECT version FROM schema_migrations')).map(row => row.version));
  const pending = files.filter(name => !applied.has(name));
  console.log('Connexion PostgreSQL OK. Historique des migrations accessible.');
  if (pending.length) console.log('Migrations à appliquer au démarrage :\n' + pending.join('\n'));
  else console.log('Toutes les migrations sont déjà appliquées.');
} catch (error) {
  const code = error.code || error.name;
  console.error('Vérification PostgreSQL impossible (' + code + '). Vérifiez DATABASE_URL, la connexion réseau et le schéma de la base existante.');
  process.exitCode = 1;
} finally {
  await closeDb?.();
}
