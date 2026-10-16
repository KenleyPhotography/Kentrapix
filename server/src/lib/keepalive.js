import { config } from '../config.js';

// Render (offre gratuite) endort le site après ~15 minutes sans visite : la première personne attend alors 30 à 60 secondes.
// En production, le site s'appelle lui-même toutes les 10 minutes (/api/health) pour rester éveillé.
// Désactivable avec KEEP_ALIVE=0. Si le site dort quand même (redémarrage, panne), un ping externe (UptimeRobot…) le réveille.
const EVERY = 10 * 60 * 1000;

export function startKeepAlive() {
  if (!config.isProd || process.env.KEEP_ALIVE === '0') return;
  const base = (process.env.RENDER_EXTERNAL_URL || config.appUrl).replace(/\/$/, '');
  const ping = () => fetch(`${base}/api/health`, { headers: { 'User-Agent': 'KentraPix-keepalive' }, signal: AbortSignal.timeout(20_000) })
    .catch((err) => console.error('Keep-alive :', err.message));
  setInterval(ping, EVERY).unref();
}
