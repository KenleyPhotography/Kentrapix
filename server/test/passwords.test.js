import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgres://127.0.0.1:5432/kentrapix_test";
}

const {
  hashPassword,
  normalizeBcryptHashForPgcrypto,
  verifyPassword,
} = await import("../src/lib/passwords.js");

const bcryptHash = `$2a$12$${"A".repeat(53)}`;

test("normalizes bcryptjs $2b hashes for PostgreSQL pgcrypto", () => {
  assert.equal(
    normalizeBcryptHashForPgcrypto(`$2b$${bcryptHash.slice(4)}`),
    bcryptHash,
  );
  assert.equal(normalizeBcryptHashForPgcrypto(bcryptHash), bcryptHash);
});

test("rejects malformed password hashes", () => {
  assert.throws(() => normalizeBcryptHashForPgcrypto("not-a-hash"));
});

test("hashes passwords with PostgreSQL bcrypt and the configured cost", async () => {
  const hash = await hashPassword("test-password", async (sql, values) => {
    assert.match(sql, /extensions\.crypt/);
    assert.match(sql, /extensions\.gen_salt\('bf', \$2\)/);
    assert.deepEqual(values, ["test-password", 12]);
    return { rows: [{ password_hash: bcryptHash }] };
  });

  assert.equal(hash, bcryptHash);

  // Also works when executeQuery returns rows array directly (db.query)
  const hashArray = await hashPassword("test-password", async () => [{ password_hash: bcryptHash }]);
  assert.equal(hashArray, bcryptHash);
});

test("verifies legacy bcryptjs hashes through PostgreSQL pgcrypto", async () => {
  const valid = await verifyPassword(
    "test-password",
    `$2b$${bcryptHash.slice(4)}`,
    async (sql, values) => {
      assert.match(sql, /extensions\.crypt\(\$1, \$2\)/);
      assert.deepEqual(values, ["test-password", bcryptHash]);
      return { rows: [{ valid: true }] };
    },
  );

  assert.equal(valid, true);

  // Also works when executeQuery returns rows array directly (db.query)
  const validArray = await verifyPassword(
    "test-password",
    `$2b$${bcryptHash.slice(4)}`,
    async () => [{ valid: true }],
  );
  assert.equal(validArray, true);
});

test("request auth routes use password helpers instead of bcryptjs", async () => {
  const routes = [
    "../src/routes/auth.js",
    "../src/routes/admin.js",
    "../src/routes/booking.js",
    "../src/routes/share.js",
    "../src/routes/client.js",
  ];

  for (const route of routes) {
    const source = await readFile(new URL(route, import.meta.url), "utf8");
    assert.doesNotMatch(source, /from ['"]bcryptjs['"]/);
  }

  const authSource = await readFile(
    new URL("../src/routes/auth.js", import.meta.url),
    "utf8",
  );
  assert.match(authSource, /verifyPassword\(/);
  assert.match(authSource, /hashPassword\(/);
});
