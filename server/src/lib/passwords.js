import { query } from "../db.js";

const BCRYPT_HASH_PATTERN = /^\$2a\$\d{2}\$[./A-Za-z0-9]{53}$/;
const BCRYPT_COST = 12;

export function normalizeBcryptHashForPgcrypto(hash) {
  if (typeof hash !== "string") {
    throw new Error("Unsupported bcrypt password hash format.");
  }
  const normalized = hash.startsWith("$2b$")
    ? `$2a$${hash.slice(4)}`
    : hash;
  if (!BCRYPT_HASH_PATTERN.test(normalized)) {
    throw new Error("Unsupported bcrypt password hash format.");
  }
  return normalized;
}

export async function hashPassword(password, executeQuery = query) {
  const result = await executeQuery(
    "SELECT extensions.crypt($1, extensions.gen_salt('bf', $2)) AS password_hash",
    [password, BCRYPT_COST],
  );
  const rows = Array.isArray(result) ? result : (result?.rows ?? []);
  const hash = rows[0]?.password_hash;
  if (typeof hash !== "string" || !BCRYPT_HASH_PATTERN.test(hash)) {
    throw new Error("PostgreSQL returned an invalid bcrypt password hash.");
  }
  return hash;
}

export async function verifyPassword(password, hash, executeQuery = query) {
  const normalizedHash = normalizeBcryptHashForPgcrypto(hash);
  const result = await executeQuery(
    "SELECT extensions.crypt($1, $2) = $2 AS valid",
    [password, normalizedHash],
  );
  const rows = Array.isArray(result) ? result : (result?.rows ?? []);
  return rows[0]?.valid === true;
}
