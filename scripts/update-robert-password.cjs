#!/usr/bin/env node
const { Client } = require("pg");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const nextAuthSecret =
  process.env.NEXTAUTH_SECRET ||
  fs.readFileSync(path.resolve(__dirname, "../secrets/nextauth_secret"), "utf8").trim();

const password = process.env.NEW_PASSWORD || "TempPass123!";
const saltBytes = Number(process.env.SALT_BYTES) || 12;
const iterations = Number(process.env.ITERATIONS) || 10000;
const keyLength = Number(process.env.KEY_LENGTH) || 64;
const digest = process.env.ALGORITHM || "sha512";

const salt = crypto.randomBytes(saltBytes).toString("hex");
const hash = crypto
  .pbkdf2Sync(password, nextAuthSecret + salt, iterations, keyLength, digest)
  .toString("hex");
const combined = `${salt}:${hash}`;

const client = new Client({
  host: process.env.DB_HOST || "postgres",
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER_ADMIN || "postgres",
  password: process.env.DB_PASSWORD_ADMIN || "postpass123",
  database: process.env.DB_NAME_SERVER || "server",
});

async function main() {
  await client.connect();
  await client.query("UPDATE users SET hashed_password = $1 WHERE email = $2", [
    combined,
    "robert@managedminds.ai",
  ]);
  await client.end();
  console.log("Updated password for robert@managedminds.ai to", password);
}

main().catch(async (error) => {
  console.error("Failed to update password", error);
  try {
    await client.end();
  } catch (endError) {
    // ignore
  }
  process.exit(1);
});
