import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import User from '@alga-psa/db/models/user';
import { authenticateUser } from '@alga-psa/auth/actions/auth';
import { generateSecurePassword, hashPassword, verifyPassword } from '@alga-psa/core/encryption';
import { initializeDevelopmentCredential } from '../../lib/developmentCredential';

// Each run owns a disposable database. Set this before importing dbConfig,
// which captures TEST_DB_NAME at module load, to avoid shared test_database.
const databaseName = `alga_devcred_${process.pid}`;
process.env.TEST_DB_NAME = databaseName;
const { createTestDbConnection, wireLocalTestDbEnv } = await import('../../../test-utils/dbConfig');

const EMAIL = 'glinda@emeraldcity.oz';
let db: Knex;
let seededUser: { user_id: string; tenant: string; email: string; hashed_password: string };
const previousSecrets = {
  lower: process.env.nextauth_secret,
  upper: process.env.NEXTAUTH_SECRET,
};

async function getSeededUser() {
  return db('users').where({ email: EMAIL }).first();
}

function setup(user: typeof seededUser, options: {
  configuredPassword?: string;
  recoverExistingCredential?: boolean;
  generatePassword?: () => string;
  log?: ReturnType<typeof vi.fn>;
} = {}) {
  const log = options.log ?? vi.fn();
  return {
    log,
    run: initializeDevelopmentCredential({
      user,
      configuredPassword: options.configuredPassword,
      recoverExistingCredential: options.recoverExistingCredential,
      generatePassword: options.generatePassword ?? generateSecurePassword,
      hashPassword,
      verifyPassword,
      updatePasswordIfUnchanged: User.updatePasswordIfUnchanged,
      readCurrentHash: User.getPasswordHash,
      log,
    }),
  };
}

describe('development credential recovery against PostgreSQL', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    const sharedEffectiveSecret = `development-credential-test-${randomUUID()}`;
    process.env.nextauth_secret = sharedEffectiveSecret;
    process.env.NEXTAUTH_SECRET = sharedEffectiveSecret;
    db = await createTestDbConnection({ databaseName, recreate: true, runSeeds: true });
    const user = await getSeededUser();
    if (!user) throw new Error('Development seed did not create the Glinda fixture user.');
    seededUser = user;
  }, 120_000);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
    const { destroyAdminConnection } = await import('@alga-psa/db/admin');
    await destroyAdminConnection().catch(() => undefined);
    if (previousSecrets.lower === undefined) delete process.env.nextauth_secret;
    else process.env.nextauth_secret = previousSecrets.lower;
    if (previousSecrets.upper === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = previousSecrets.upper;
  });

  it('repairs the malformed Glinda seed hash and authenticates through authenticateUser', async () => {
    // The schema-template clone can contain seed data from another local run;
    // force the exact legacy placeholder shape this test is meant to cover.
    await db('users').where({ tenant: seededUser.tenant, user_id: seededUser.user_id })
      .update({ hashed_password: 'legacy-seed-placeholder' });
    const malformedSeedUser = await getSeededUser();
    expect(malformedSeedUser.hashed_password).not.toMatch(/^[0-9a-f]+:[0-9a-f]+$/i);
    const { run, log } = setup(malformedSeedUser);
    await run;

    const reportedPassword = log.mock.calls
      .map(([line]) => String(line).match(/Password is -> \[ (.+) \]/)?.[1])
      .find((value): value is string => Boolean(value));
    expect(reportedPassword).toBeTruthy();
    const persistedHash = await User.getPasswordHash(seededUser.user_id, seededUser.tenant);
    expect(persistedHash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/i);
    expect(await verifyPassword(reportedPassword!, persistedHash!)).toBe(true);
    await expect(authenticateUser(EMAIL, reportedPassword!, 'internal')).resolves.toMatchObject({
      user_id: seededUser.user_id,
      tenant: seededUser.tenant,
    });
  });

  it('preserves a configured credential that already verifies for this stack', async () => {
    const credential = generateSecurePassword();
    const existingHash = await hashPassword(credential);
    await db('users').where({ tenant: seededUser.tenant, user_id: seededUser.user_id })
      .update({ hashed_password: existingHash });
    const user = await getSeededUser();
    const { run, log } = setup(user, { configuredPassword: credential });

    await run;

    expect(await User.getPasswordHash(seededUser.user_id, seededUser.tenant)).toBe(existingHash);
    expect(log.mock.calls.some(([line]) => String(line).includes(credential))).toBe(true);
    await expect(authenticateUser(EMAIL, credential, 'internal')).resolves.toMatchObject({ user_id: seededUser.user_id });
  });

  it('recovers a valid-format hash rejected by this stack only with explicit recovery enabled', async () => {
    const priorSecret = `prior-effective-secret-${randomUUID()}`;
    process.env.nextauth_secret = priorSecret;
    process.env.NEXTAUTH_SECRET = priorSecret;
    const staleHash = await hashPassword(generateSecurePassword());
    await db('users').where({ tenant: seededUser.tenant, user_id: seededUser.user_id })
      .update({ hashed_password: staleHash });

    const effectiveSecret = `current-effective-secret-${randomUUID()}`;
    process.env.nextauth_secret = effectiveSecret;
    process.env.NEXTAUTH_SECRET = effectiveSecret;
    const recoveryPassword = generateSecurePassword();
    const user = await getSeededUser();
    const { run: preserveRun, log: preserveLog } = setup(user, { configuredPassword: recoveryPassword });
    await preserveRun;
    expect(await User.getPasswordHash(seededUser.user_id, seededUser.tenant)).toBe(staleHash);
    expect(preserveLog.mock.calls.some(([line]) => String(line).includes(recoveryPassword))).toBe(false);

    const { run, log } = setup(user, {
      configuredPassword: recoveryPassword,
      recoverExistingCredential: true,
    });
    await run;

    const recoveredHash = await User.getPasswordHash(seededUser.user_id, seededUser.tenant);
    expect(recoveredHash).not.toBe(staleHash);
    expect(await verifyPassword(recoveryPassword, recoveredHash!)).toBe(true);
    await expect(authenticateUser(EMAIL, recoveryPassword, 'internal')).resolves.toMatchObject({
      user_id: seededUser.user_id,
    });
    expect(log.mock.calls.some(([line]) => String(line).includes(recoveryPassword))).toBe(true);
  });

  it('allows one concurrent initializer to replace a malformed hash and authenticates its reported password', async () => {
    const placeholder = 'legacy-seed-placeholder';
    await db('users').where({ tenant: seededUser.tenant, user_id: seededUser.user_id })
      .update({ hashed_password: placeholder });
    const user = await getSeededUser();
    const passwords = [generateSecurePassword(), generateSecurePassword()];
    const logs = [vi.fn(), vi.fn()];
    await Promise.all(passwords.map(async (password, index) => {
      await setup(user, { generatePassword: () => password, log: logs[index] }).run;
    }));

    const reported = logs.flatMap((log) => log.mock.calls
      .map(([line]) => String(line).match(/Password is -> \[ (.+) \]/)?.[1])
      .filter((value): value is string => Boolean(value)));
    expect(reported).toHaveLength(1);
    await expect(authenticateUser(EMAIL, reported[0], 'internal')).resolves.toMatchObject({
      user_id: seededUser.user_id,
    });
  });

  it('applies the compare-and-set only to the requested tenant row', async () => {
    const currentHash = await User.getPasswordHash(seededUser.user_id, seededUser.tenant);
    const otherTenant = randomUUID();
    await db('tenants').insert({
      tenant: otherTenant,
      client_name: 'Credential CAS isolation fixture',
      email: `${otherTenant}@example.test`,
      product_code: 'psa',
    });
    await db('users').insert({
      tenant: otherTenant,
      user_id: seededUser.user_id,
      username: `cas-${otherTenant}`,
      hashed_password: currentHash,
      first_name: 'CAS',
      last_name: 'Fixture',
      auth_method: 'password',
      user_type: 'internal',
      email: `cas-${otherTenant}@example.test`,
    });

    const replacementHash = await hashPassword(generateSecurePassword());
    await expect(User.updatePasswordIfUnchanged(
      seededUser.user_id,
      seededUser.tenant,
      currentHash,
      replacementHash
    )).resolves.toBe(true);

    const untouchedOtherTenant = await db('users').where({ tenant: otherTenant, user_id: seededUser.user_id }).first();
    expect(untouchedOtherTenant.hashed_password).toBe(currentHash);
    await db('users').where({ tenant: otherTenant, user_id: seededUser.user_id }).delete();
    await db('tenants').where({ tenant: otherTenant }).delete();
  });
});
