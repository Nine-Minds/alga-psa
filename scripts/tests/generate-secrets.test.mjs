import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(testsDir, "../generate-secrets.sh");
const validateScriptPath = path.resolve(testsDir, "../validate-secrets.sh");
const wrapperScriptPath = path.resolve(testsDir, "../docker-compose-wrapper.sh");

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

const MIGRATION_SECRET = "credential_encryption_key";

function run(script, secretsDir, env = {}) {
  return spawnSync("bash", [script], {
    env: { ...process.env, ...env, SECRETS_DIR: secretsDir },
    encoding: "utf8",
  });
}

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "generate-secrets-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeSecret(secretsDir, name, content = "legacy-value\n") {
  fs.mkdirSync(secretsDir, { recursive: true });
  fs.writeFileSync(path.join(secretsDir, name), content);
}

test("fresh bootstrap generates all secrets with mode 0600", (t) => {
  const secretsDir = path.join(fixture(t), "secrets");
  const result = run(scriptPath, secretsDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  for (const name of REQUIRED_SECRETS) {
    const file = path.join(secretsDir, name);
    assert.ok(fs.existsSync(file), `${name} exists`);
    assert.ok(fs.readFileSync(file, "utf8").trim().length > 0, `${name} non-empty`);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600, `${name} mode 0600`);
  }
});

test("fresh bootstrap generates credential_encryption_key and preserves it across reruns", (t) => {
  const secretsDir = path.join(fixture(t), "secrets");
  const keyFile = path.join(secretsDir, MIGRATION_SECRET);

  const first = run(scriptPath, secretsDir);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  assert.ok(fs.existsSync(keyFile), "key file created on first run");

  const generated = fs.readFileSync(keyFile, "utf8");
  assert.ok(generated.trim().length >= 32, "generated key is non-trivial");
  assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600, "key file is mode 0600");

  const second = run(scriptPath, secretsDir);
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.equal(
    fs.readFileSync(keyFile, "utf8"),
    generated,
    "key preserved unchanged across reruns (generated once)",
  );
});

test("never overwrites an existing operator-supplied credential key on a legacy complete set", (t) => {
  const secretsDir = path.join(fixture(t), "secrets");
  // A complete legacy set (all established secrets) plus an operator-pinned
  // credential_encryption_key: the generator must preserve every value.
  const legacy = REQUIRED_SECRETS.filter((name) => name !== MIGRATION_SECRET);
  for (const name of legacy) writeSecret(secretsDir, name, `legacy-${name}\n`);
  writeSecret(secretsDir, MIGRATION_SECRET, "operator-supplied-value\n");

  const result = run(scriptPath, secretsDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(
    fs.readFileSync(path.join(secretsDir, MIGRATION_SECRET), "utf8"),
    "operator-supplied-value\n",
    "existing operator value preserved (never regenerated)",
  );
  for (const name of legacy) {
    assert.equal(
      fs.readFileSync(path.join(secretsDir, name), "utf8"),
      `legacy-${name}\n`,
      `${name} preserved`,
    );
  }
});

test("legacy complete set: adds only credential_encryption_key and preserves every established secret", (t) => {
  const secretsDir = path.join(fixture(t), "secrets");
  const legacy = REQUIRED_SECRETS.filter((name) => name !== MIGRATION_SECRET);
  for (const name of legacy) writeSecret(secretsDir, name, `legacy-${name}\n`);

  const result = run(scriptPath, secretsDir);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const keyFile = path.join(secretsDir, MIGRATION_SECRET);
  assert.ok(fs.statSync(keyFile).size > 0, "credential_encryption_key auto-added");
  assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600, "added key is mode 0600");

  for (const name of legacy) {
    assert.equal(
      fs.readFileSync(path.join(secretsDir, name), "utf8"),
      `legacy-${name}\n`,
      `${name} preserved unchanged`,
    );
  }
});

test("refuses to regenerate a missing established secret on an existing install", (t) => {
  const secretsDir = path.join(fixture(t), "secrets");
  writeSecret(secretsDir, "postgres_password", "existing-pg\n");

  const result = run(scriptPath, secretsDir);
  assert.notEqual(result.status, 0, "generator must fail loudly");
  assert.match(result.stderr, /Refusing to regenerate/);

  // The missing established secret must NOT be created, and the migration
  // secret must not be added either (the run aborts on the first missing
  // established secret).
  assert.ok(!fs.existsSync(path.join(secretsDir, "db_password_server")), "db_password_server not created");
  assert.ok(!fs.existsSync(path.join(secretsDir, MIGRATION_SECRET)), "credential_encryption_key not created");
  assert.equal(
    fs.readFileSync(path.join(secretsDir, "postgres_password"), "utf8"),
    "existing-pg\n",
    "existing secret preserved",
  );
});

test("refuses to regenerate an empty established secret on an existing install", (t) => {
  const secretsDir = path.join(fixture(t), "secrets");
  writeSecret(secretsDir, "postgres_password", "existing-pg\n");
  writeSecret(secretsDir, "db_password_server", ""); // empty established secret

  const result = run(scriptPath, secretsDir);
  assert.notEqual(result.status, 0, "generator must fail loudly");
  assert.match(result.stderr, /Refusing to regenerate/);
  assert.equal(fs.statSync(path.join(secretsDir, "db_password_server")).size, 0, "empty secret not overwritten");
});

test("an empty managed-secret file alone is existing state and is never regenerated", (t) => {
  const secretsDir = path.join(fixture(t), "secrets");
  writeSecret(secretsDir, "nextauth_secret", "");

  const result = run(scriptPath, secretsDir);
  assert.notEqual(result.status, 0, "generator must fail rather than treating the directory as fresh");
  assert.match(result.stderr, /Missing\/empty established secret/);
  assert.equal(fs.statSync(path.join(secretsDir, "nextauth_secret")).size, 0, "empty secret not overwritten");
  assert.ok(!fs.existsSync(path.join(secretsDir, "postgres_password")), "fresh bootstrap must not start");
  assert.ok(!fs.existsSync(path.join(secretsDir, MIGRATION_SECRET)), "migration secret must not be added");
});

test("propagates generator failure: validate-secrets.sh and docker-compose-wrapper.sh terminate", (t) => {
  // SECRETS_DIR points at a path occupied by a regular file, so the generator's
  // `mkdir -p` fails and `set -e` makes it exit non-zero before any secret work.
  const dir = fixture(t);
  const blocker = path.join(dir, "secrets");
  fs.writeFileSync(blocker, "i am a file, not a directory\n");

  const validate = run(validateScriptPath, blocker);
  assert.notEqual(validate.status, 0, "validate-secrets.sh must terminate on generator failure");
  assert.match(validate.stderr, /mkdir:|Already exists|File exists|cannot create directory|not a directory/i);

  // The wrapper must not reach `docker compose` after a generator failure: put
  // a fake `docker` on PATH that records invocation; if the wrapper reached it,
  // the marker file would appear.
  const fakeBin = path.join(dir, "fake-bin");
  const marker = path.join(dir, "docker-invoked");
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(path.join(fakeBin, "docker"), `#!/bin/sh\necho invoked > "${marker}"\nexit 0\n`);
  fs.chmodSync(path.join(fakeBin, "docker"), 0o755);

  const wrapper = run(wrapperScriptPath, blocker, { PATH: `${fakeBin}:${process.env.PATH}` });
  assert.notEqual(wrapper.status, 0, "docker-compose-wrapper.sh must terminate on generator failure");
  assert.ok(!fs.existsSync(marker), "docker compose must never be invoked after generator failure");
});
