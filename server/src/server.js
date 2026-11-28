import { config, assertServerConfig } from './config.js';
import { ping, closeDb, dbLabel, withClient } from './db.js';
import { applyMigrations } from './lib/migrate.js';
import { ensureStorage } from './lib/storage.js';
import { createApp } from './app.js';
import { startExpiryReminders } from './lib/expiry.js';
import { startAnnouncements } from './lib/announcements.js';
import { startAutoReminders } from './lib/autoremind.js';
import { startKeepAlive } from './lib/keepalive.js';
import { startBackups } from './lib/backup.js';
import { startBookingReminders } from './lib/bookingReminders.js';
import { startSubscriptionReminders } from './lib/subscription-reminders.js';

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
  // Rappels « votre galerie ferme dans 7 jours ».
  startExpiryReminders();
  // Notifications du studio : e-mails envoyés tout de suite ou à l'heure programmée.
  startAnnouncements();
  // Rappels de paiement automatiques (3 jours avant l'échéance, puis après).
  startAutoReminders();
  // Sauvegarde automatique de la base (1 par jour) + copie des photos si une 2e destination est configurée.
  startBackups();
  // Rappel la veille de chaque rendez-vous confirmé.
  startBookingReminders();
  startSubscriptionReminders();
  // Garde le site éveillé sur Render gratuit (ping toutes les 10 minutes).
  startKeepAlive();
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
