import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../generate-secrets.sh",
);

const REQUIRED_SECRETS = [
  "postgres_password",
  "db_password_server",
  "db_password_hocuspocus",
  "redis_password",
  "email_password",
  "crypto_key",
  "token_secret_key",
  "nextauth_secret",
  "credential_encryption_key",
  "google_oauth_client_id",
  "google_oauth_client_secret",
  "alga_auth_key",
];

function run(secretsDir) {
  return spawnSync("bash", [scriptPath], {
    env: { ...process.env, SECRETS_DIR: secretsDir },
    encoding: "utf8",
  });
}

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "generate-secrets-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("bootstraps credential_encryption_key from absent and preserves it across reruns", (t) => {
  const secretsDir = path.join(fixture(t), "secrets");
  const keyFile = path.join(secretsDir, "credential_encryption_key");

  const first = run(secretsDir);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  assert.ok(fs.existsSync(keyFile), "key file created on first run");

  const generated = fs.readFileSync(keyFile, "utf8");
  assert.ok(generated.trim().length >= 32, "generated key is non-trivial");
  assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600, "key file is mode 0600");

  const second = run(secretsDir);
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.equal(
    fs.readFileSync(keyFile, "utf8"),
    generated,
    "key preserved unchanged across reruns (generated once)",
  );
});

test("bootstraps every required secret on a fresh checkout with mode 0600", (t) => {
  const secretsDir = path.join(fixture(t), "secrets");
  const result = run(secretsDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  for (const name of REQUIRED_SECRETS) {
    const file = path.join(secretsDir, name);
    assert.ok(fs.existsSync(file), `${name} exists`);
    assert.ok(fs.readFileSync(file, "utf8").trim().length > 0, `${name} non-empty`);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600, `${name} mode 0600`);
  }
});

test("never overwrites an existing operator-supplied value", (t) => {
  const secretsDir = path.join(fixture(t), "secrets");
  fs.mkdirSync(secretsDir, { recursive: true });
  const keyFile = path.join(secretsDir, "credential_encryption_key");
  fs.writeFileSync(keyFile, "operator-supplied-value\n");

  const result = run(secretsDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(
    fs.readFileSync(keyFile, "utf8"),
    "operator-supplied-value\n",
    "existing value preserved",
  );
});
