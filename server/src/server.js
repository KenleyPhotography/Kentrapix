import { config, assertServerConfig } from './config.js';
import { pool } from './db.js';
import { ensureStorage } from './lib/storage.js';
import { createApp } from './app.js';
import { kickFaces, resetInterruptedFaces } from './lib/faces.js';
import { startExpiryReminders } from './lib/expiry.js';

assertServerConfig();
await ensureStorage();
await pool.query('SELECT 1').catch((err) => {
  console.error(`Connexion MySQL impossible (${config.db.host}:${config.db.port}/${config.db.database}) : ${err.message}`);
  process.exit(1);
});

const server = createApp().listen(config.port, config.host, () => {
  console.log(`KentraPix prêt sur http://localhost:${config.port} (${config.env})`);
  // Photos importées pas encore analysées (ou interrompues par un arrêt du serveur).
  resetInterruptedFaces().then(kickFaces).catch((err) => console.error('Visages :', err.message));
  // Rappels « votre galerie ferme dans 7 jours ».
  startExpiryReminders();
});

// Arrêt propre : termine les requêtes en cours puis ferme MySQL.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  });
}
