import { config, assertServerConfig } from './config.js';
import { ping, closeDb, dbLabel, withClient } from './db.js';
import { applyMigrations } from './lib/migrate.js';
import { ensureStorage } from './lib/storage.js';
import { createApp } from './app.js';
import { kickFaces, resetInterruptedFaces } from './lib/faces.js';
import { startExpiryReminders } from './lib/expiry.js';
import { startAnnouncements } from './lib/announcements.js';

assertServerConfig();
await ensureStorage();
await ping().catch((err) => {
  console.error(`Connexion à la base impossible (${dbLabel}) : ${err.message}`);
  process.exit(1);
});
// Migrations en attente (sql/migrations/) : appliquées automatiquement au démarrage.
await withClient((client) => applyMigrations(client));

const server = createApp().listen(config.port, config.host, () => {
  console.log(`KentraPix prêt sur http://localhost:${config.port} (${config.env}, ${dbLabel})`);
  // Photos importées pas encore analysées (ou interrompues par un arrêt du serveur).
  resetInterruptedFaces().then(kickFaces).catch((err) => console.error('Visages :', err.message));
  // Rappels « votre galerie ferme dans 7 jours ».
  startExpiryReminders();
  // Notifications du studio : e-mails envoyés tout de suite ou à l'heure programmée.
  startAnnouncements();
});

// Arrêt propre : termine les requêtes en cours puis ferme la base.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(async () => {
      await closeDb();
      process.exit(0);
    });
  });
}
