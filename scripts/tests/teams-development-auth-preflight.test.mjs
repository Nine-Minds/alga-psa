import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'tsx/esm/api';
import { checkTeamsDevelopmentAuth } from '../../e2e-tests/harness/check-teams-development-auth.mjs';

const unregister = register();
after(unregister);
// Node's test runner isolates this file in its own process. Exercise the actual
// source secret provider and password crypto with synthetic credentials.
Object.assign(process.env, { SECRET_READ_CHAIN: 'env', SECRET_WRITE_PROVIDER: 'filesystem',
  nextauth_secret: 'synthetic-preflight-key', ITERATIONS: '10000', KEY_LENGTH: '64', ALGORITHM: 'sha512' });
const { hashPassword, verifyPassword } = await import('../../packages/core/src/lib/encryption.ts');
const { getSecret } = await import('../../packages/core/src/lib/secrets/index.ts');
const storedHash = await hashPassword('synthetic-password');
const env = { NODE_ENV: 'development', TEAMS_EMULATOR_MODE: 'true', E2E_DATABASE_ISOLATED: 'true',
  E2E_USER_EMAIL: 'fixture@example.invalid', E2E_USER_PASSWORD: 'synthetic-password', NEXTAUTH_SECRET: 'synthetic-preflight-key' };
function options(rows = [{ hashed_password: storedHash }]) {
  const query = { where(criteria) {
    assert.deepEqual(criteria, { email: env.E2E_USER_EMAIL, user_type: 'internal', is_inactive: false }); return this;
  }, select(column) { assert.equal(column, 'hashed_password'); return this; },
  async limit(count) { assert.equal(count, 2); return rows; } };
  return { env, db: () => query, getSecret, verifyPassword, readMountedSecret: async () => 'synthetic-preflight-key' };
}
test('source crypto verifies captured password and returns only the diagnostic contract', async () => {
  assert.deepEqual(await checkTeamsDevelopmentAuth(options()), { runtime: 'source-node-preflight', status: 'passed',
    sourcePasswordValid: true, resolvedSecretMatchesMountedFile: true, resolvedSecretMatchesEnvironment: true,
    parameters: { iterations: 10000, keyLength: 64, digest: 'SHA-512' } });
});
test('wrong password fails verification without returning credential data', async () => {
  const result = await checkTeamsDevelopmentAuth({ ...options(), env: { ...env, E2E_USER_PASSWORD: 'wrong' } });
  assert.equal(result.status, 'failed'); assert.equal(result.sourcePasswordValid, false);
});
test('mounted-secret mismatch is distinguishable from successful source verification', async () => {
  const result = await checkTeamsDevelopmentAuth({ ...options(), readMountedSecret: async () => 'different-key' });
  assert.equal(result.status, 'passed'); assert.equal(result.resolvedSecretMatchesMountedFile, false);
});
test('ambiguous or missing source users fail closed', async () => {
  for (const rows of [[], [{ hashed_password: storedHash }, { hashed_password: storedHash }]]) {
    await assert.rejects(checkTeamsDevelopmentAuth(options(rows)), /SOURCE_ACCOUNT_AMBIGUOUS_OR_MISSING/);
  }
});
test('production and nonisolated execution are refused', async () => {
  await assert.rejects(checkTeamsDevelopmentAuth({ ...options(), env: { ...env, NODE_ENV: 'production' } }), /CONFIGURATION/);
  await assert.rejects(checkTeamsDevelopmentAuth({ ...options(), env: { ...env, E2E_DATABASE_ISOLATED: 'false' } }), /CONFIGURATION/);
});
