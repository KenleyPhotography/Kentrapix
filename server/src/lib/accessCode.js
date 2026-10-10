import crypto from 'node:crypto';
import { z } from 'zod';
import { query } from '../db.js';

// Code d'accès d'un membre de l'équipe : 2 à 4 lettres ou chiffres, sans distinction de casse.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const codeRule = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9]{2,4}$/, 'Le code doit avoir 2 à 4 lettres ou chiffres, sans espace.')
  .transform((v) => v.toUpperCase());

/** Génère un code libre de 4 caractères. */
export async function freshCode() {
  for (;;) {
    const code = Array.from({ length: 4 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
    const [used] = await query('SELECT 1 AS x FROM users WHERE access_code = ?', [code]);
    if (!used) return code;
  }
}
