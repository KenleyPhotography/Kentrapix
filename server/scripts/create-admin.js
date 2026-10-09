// Crée (ou met à jour) le compte PROPRIÉTAIRE du studio (rôle owner : peut nommer d'autres admins).
// Usage : npm run create-admin -- --email studio@exemple.com --name "Kenley Elysée"
// Le mot de passe est demandé au clavier (jamais dans l'historique du terminal).
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';
import readline from 'node:readline/promises';
import bcrypt from 'bcryptjs';
import { closeDb, query } from '../src/db.js';
import { BCRYPT_COST } from '../src/routes/auth.js';

const { values } = parseArgs({
  options: { email: { type: 'string' }, name: { type: 'string' }, password: { type: 'string' } },
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const email = (values.email || (await rl.question('E-mail admin : '))).trim().toLowerCase();
const name = (values.name || (await rl.question('Nom affiché : '))).trim();
const password = values.password || (await rl.question('Mot de passe (12 caractères min.) : '));
rl.close();

if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('E-mail invalide.');
if (!name) throw new Error('Nom obligatoire.');
if (password.length < 12) throw new Error('Le mot de passe admin doit contenir au moins 12 caractères.');

const hash = await bcrypt.hash(password, BCRYPT_COST);
const [existing] = await query('SELECT id FROM users WHERE email = ?', [email]);
if (existing) {
  await query(
    "UPDATE users SET role = 'owner', name = ?, password_hash = ?, active = 1, must_change_password = 0, token_version = token_version + 1 WHERE id = ?",
    [name, hash, existing.id],
  );
  console.log(`Admin mis à jour : ${email}`);
} else {
  await query("INSERT INTO users (id, role, name, email, password_hash) VALUES (?, 'owner', ?, ?, ?)", [
    crypto.randomUUID(), name, email, hash,
  ]);
  console.log(`Admin créé : ${email}`);
}
await closeDb();
