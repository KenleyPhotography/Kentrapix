import { query, transaction } from '../db.js';
import { sendMail } from './mailer.js';
import { config } from '../config.js';

export const subscriptionReminderPhase = days => days > 7 || days < -7 ? null : days <= 0 ? 'expired' : days <= 1 ? 'day' : 'week';

export async function sendSubscriptionReminders() {
  const rows = await query(`SELECT u.id AS user_id, u.name, u.email, s.id, s.expires_at,
    CEIL(EXTRACT(EPOCH FROM (s.expires_at - CURRENT_TIMESTAMP)) / 86400)::int AS days_left
    FROM users u JOIN LATERAL (SELECT id, expires_at FROM photographer_subscriptions
      WHERE staff_id = u.id AND activated_at IS NOT NULL ORDER BY activated_at DESC, id DESC LIMIT 1) s ON TRUE
    WHERE u.active = 1 AND u.role = 'admin' AND NOT u.subscription_exempt AND NOT u.subscription_suspended
      AND s.expires_at <= CURRENT_TIMESTAMP + INTERVAL '7 days' AND s.expires_at > CURRENT_TIMESTAMP - INTERVAL '7 days'`);
  for (const row of rows) {
    const phase = subscriptionReminderPhase(row.days_left);
    if (!phase) continue;
    await transaction(async conn => {
      const [[claim]] = await conn.execute(`INSERT INTO subscription_reminders (subscription_id, phase)
        VALUES (?, ?) ON CONFLICT DO NOTHING RETURNING subscription_id`, [row.id, phase]);
      if (!claim) return;
      const url = config.appUrl.replace(/\/$/, '') + '/tarifs#souscrire';
      const subject = phase === 'expired' ? 'Votre abonnement KentraPix a expiré' : 'Votre abonnement KentraPix arrive à échéance';
      const text = `Bonjour ${row.name},\n\n${phase === 'expired' ? 'Votre abonnement a expiré.' : `Votre abonnement arrive à échéance dans ${row.days_left} jour(s).`}\nPayez ou renouvelez votre abonnement : ${url}\nVotre paiement sera vérifié par le propriétaire avant activation.`;
      const result = await sendMail({ to: row.email, userId: row.user_id, kind: 'subscription_reminder', subject, text });
      if (result.status !== 'sent') await conn.execute('DELETE FROM subscription_reminders WHERE subscription_id = ? AND phase = ?', [row.id, phase]);
    });
  }
}

export function startSubscriptionReminders() {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await sendSubscriptionReminders(); }
    catch (error) { console.error('Rappels abonnements :', error.message); }
    finally { running = false; }
  };
  setTimeout(run, 30_000).unref();
  setInterval(run, 60 * 60 * 1000).unref();
}
