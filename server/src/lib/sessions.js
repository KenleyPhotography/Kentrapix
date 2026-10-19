// Appareils connectés : une ligne par connexion (cookie), visible et révocable depuis le profil.
import crypto from 'node:crypto';
import { query } from '../db.js';

/** « Chrome · Windows », « Application KentraPix · Android »… à partir du navigateur. */
export function deviceLabel(ua = '') {
  const s = String(ua);
  const os = /Android/i.test(s) ? 'Android' : /iPhone|iPad|iOS/i.test(s) ? 'iPhone / iPad' : /Windows/i.test(s) ? 'Windows' : /Mac OS X|Macintosh/i.test(s) ? 'Mac' : /CrOS/i.test(s) ? 'Chromebook' : /Linux/i.test(s) ? 'Linux' : 'Appareil';
  const app = /KentraPixApp/i.test(s);
  const browser = app ? 'Application KentraPix' : /Edg\//i.test(s) ? 'Edge' : /OPR\/|Opera/i.test(s) ? 'Opera' : /SamsungBrowser/i.test(s) ? 'Samsung Internet' : /Firefox\//i.test(s) ? 'Firefox' : /Chrome\/|CriOS/i.test(s) ? 'Chrome' : /Safari\//i.test(s) ? 'Safari' : 'Navigateur';
  return `${browser} · ${os}`;
}

/** Adresse IP masquée (« 197.155.12.x ») : suffisante pour reconnaître un lieu, sans garder l'adresse complète. */
export function maskIp(ip = '') {
  const s = String(ip).replace(/^::ffff:/, '');
  if (s.includes('.')) return s.replace(/\.\d+$/, '.x');
  return s.includes(':') ? `${s.split(':').slice(0, 3).join(':')}::x` : '';
}

// Sessions valides gardées 30 s en mémoire : évite une requête de plus à chaque appel (la révocation l'efface aussitôt).
const alive = new Map();
export const forgetSession = (sid) => alive.delete(sid);

/** La session existe-t-elle et n'est-elle pas révoquée ? Met à jour « dernière activité » (au plus toutes les 5 min). */
export async function sessionAlive(sid, userId) {
  const hit = alive.get(sid);
  if (hit && hit > Date.now()) return true;
  const [row] = await query('SELECT last_seen_at FROM user_sessions WHERE id = ? AND user_id = ? AND revoked_at IS NULL', [sid, userId]);
  if (!row) { alive.delete(sid); return false; }
  alive.set(sid, Date.now() + 30_000);
  if (Date.now() - new Date(`${String(row.last_seen_at).replace(' ', 'T')}Z`).getTime() > 5 * 60_000) {
    query('UPDATE user_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?', [sid]).catch(() => {});
  }
  return true;
}

export async function createSession(req, userId, id = crypto.randomUUID(), createdAt = null) {
  await query(
    `INSERT INTO user_sessions (id, user_id, device, ip${createdAt ? ', created_at' : ''}) VALUES (?, ?, ?, ?${createdAt ? ', ?' : ''}) ON CONFLICT (id) DO NOTHING`,
    [id, userId, deviceLabel(req?.headers?.['user-agent']).slice(0, 120), maskIp(req?.ip), ...(createdAt ? [createdAt] : [])],
  );
  return id;
}

/** Retire toutes les sessions d'un compte, sauf éventuellement une. */
export async function revokeSessions(userId, exceptId = null) {
  const rows = await query(`UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL${exceptId ? ' AND id <> ?' : ''} RETURNING id`, exceptId ? [userId, exceptId] : [userId]);
  for (const r of rows || []) forgetSession(r.id);
  return (rows || []).length;
}
