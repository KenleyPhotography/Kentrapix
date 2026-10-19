// Comptage anonyme des visites du site public : une empreinte par visiteur et par jour (adresse IP et navigateur hachés
// avec un sel qui change chaque jour). Aucune IP n'est gardée, et on ne peut pas suivre quelqu'un d'un jour à l'autre.
import crypto from 'node:crypto';
import { query } from '../db.js';
import { config } from '../config.js';
import { studioToday } from './booking.js';

const BOT = /bot|crawl|spider|slurp|preview|monitor|uptime|lighthouse|headless|facebookexternalhit|whatsapp|curl|wget|python|go-http/i;

/** Enregistre une visite (sans attendre, sans jamais faire échouer la page). */
export function recordVisit(req, path) {
  try {
    if (req.method !== 'GET' || req.user) return; // l'équipe et les clients connectés ne comptent pas
    const ua = String(req.headers['user-agent'] || '');
    if (!ua || BOT.test(ua)) return;
    const day = studioToday();
    const visitor = crypto.createHash('sha256').update(`${req.ip}|${ua}|${day}|${config.jwtSecret}`).digest('hex').slice(0, 20);
    query(
      'INSERT INTO site_visits (day, visitor, path, hits) VALUES (?, ?, ?, 1) ON CONFLICT (day, visitor, path) DO UPDATE SET hits = site_visits.hits + 1',
      [day, visitor, path.slice(0, 60)],
    ).catch(() => {});
  } catch { /* le comptage ne doit jamais gêner l'affichage */ }
}

/** Chiffres pour le propriétaire : visiteurs par jour (30 jours), totaux, pages les plus vues. */
export async function visitStats() {
  const today = studioToday();
  const since = new Date(`${today}T12:00:00Z`); since.setUTCDate(since.getUTCDate() - 29);
  const from = since.toISOString().slice(0, 10);
  const [days, pages, total] = await Promise.all([
    query('SELECT day, COUNT(DISTINCT visitor)::int AS visitors, SUM(hits)::int AS views FROM site_visits WHERE day >= ? GROUP BY day ORDER BY day', [from]),
    query('SELECT path, COUNT(DISTINCT visitor)::int AS visitors, SUM(hits)::int AS views FROM site_visits WHERE day >= ? GROUP BY path ORDER BY views DESC LIMIT 8', [from]),
    query('SELECT COUNT(*)::int AS visits, COALESCE(SUM(hits), 0)::int AS views FROM (SELECT day, visitor, SUM(hits) AS hits FROM site_visits GROUP BY day, visitor) t'),
  ]);
  const byDay = {};
  for (const d of days) byDay[String(d.day).slice(0, 10)] = d;
  const series = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(`${from}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    series.push({ day: key, visitors: byDay[key]?.visitors || 0, views: byDay[key]?.views || 0 });
  }
  const sum = (arr, k) => arr.reduce((n, x) => n + x[k], 0);
  return {
    today: series[29].visitors,
    week: sum(series.slice(23), 'visitors'),
    month: sum(series, 'visitors'),
    monthViews: sum(series, 'views'),
    allVisits: total[0]?.visits || 0,
    allViews: total[0]?.views || 0,
    series,
    pages: pages.map((p) => ({ path: p.path, visitors: p.visitors, views: p.views })),
  };
}
