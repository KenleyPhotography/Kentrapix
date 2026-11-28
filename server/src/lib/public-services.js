import { query } from '../db.js';
import { subscriptionAllows } from './public-tracking.js';

export async function publicServices() {
  const [row] = await query('SELECT portfolio_enabled, booking_staff, team_staff FROM site_public_services WHERE id = 1');
  return row;
}

export const bookingStaff = () => query("SELECT id, name, sender_name, email, role, portfolio_photo_limit FROM users WHERE active = 1 AND role IN ('owner', 'admin') ORDER BY created_at, id");

export async function publicPhotographers({ enforceSubscription = true } = {}) {
  const [{ booking_staff: selected }, staff] = await Promise.all([publicServices(), bookingStaff()]);
  const allowed = selected ?? staff.filter((person) => person.role === 'owner').slice(0, 1).map((person) => person.id);
  if (!enforceSubscription) return staff.filter(person => allowed.includes(person.id));
  const eligible = await query(`SELECT u.id FROM users u WHERE ${subscriptionAllows('u.id', true)}`);
  const byId = new Set(eligible.map(person => person.id));
  return staff.filter(person => allowed.includes(person.id) && byId.has(person.id));
}
