import { env } from "cloudflare:workers";
import { createServer } from "node:http";
import { httpServerHandler } from "cloudflare:node";
import process from "node:process";

for (const [key, value] of Object.entries(env || {})) {
  if (typeof value === "string" && !process.env[key]) {
    process.env[key] = value;
  }
}

if (env.HYPERDRIVE?.connectionString) {
  process.env.DATABASE_URL = env.HYPERDRIVE.connectionString;
}

if (!process.env.DATABASE_URL) {
  throw new Error("Configure a DATABASE_URL secret or a HYPERDRIVE binding.");
}

if (!process.env.JWT_SECRET) {
  throw new Error("Configure the existing JWT_SECRET to preserve current sessions.");
}

if (!process.env.B2_KEY_ID && process.env.S3_KEY_ID) process.env.B2_KEY_ID = process.env.S3_KEY_ID;
if (!process.env.B2_APPLICATION_KEY && process.env.S3_SECRET) process.env.B2_APPLICATION_KEY = process.env.S3_SECRET;
if (!process.env.B2_BUCKET && process.env.S3_BUCKET) process.env.B2_BUCKET = process.env.S3_BUCKET;
if (!process.env.B2_ENDPOINT && process.env.S3_ENDPOINT) process.env.B2_ENDPOINT = process.env.S3_ENDPOINT;

const storageVariables = [
  "B2_KEY_ID",
  "B2_APPLICATION_KEY",
  "B2_BUCKET",
  "B2_ENDPOINT",
];
const missingStorageVariables = storageVariables.filter(
  (name) => !process.env[name],
);
if (missingStorageVariables.length > 0) {
  throw new Error(
    `Configure persistent media storage secrets: ${missingStorageVariables.join(", ")} (or S3_KEY_ID, S3_SECRET, S3_BUCKET, S3_ENDPOINT).`,
  );
}

process.env.TRUST_PROXY = "true";

const { createApp } = await import("./app.js");
const app = createApp();
const server = createServer((request, response) => {
  const clientIp = request.headers["cf-connecting-ip"];
  if (typeof clientIp === "string") {
    request.headers["x-forwarded-for"] = clientIp;
  }
  app(request, response);
});

export default httpServerHandler(server);
