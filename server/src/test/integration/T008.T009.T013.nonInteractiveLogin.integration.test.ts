import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import User from '@alga-psa/db/models/user';
import { authenticateUser } from '@alga-psa/auth/actions/auth';
import { assertActiveInternalUser, assertInteractiveUser } from '../../../../packages/auth/src/lib/assertInteractiveUser';
import { hashPassword, verifyPassword } from '@alga-psa/core/encryption';

// Service principals A/4: T008 (authenticateUser), T009 (interactive gate behind signIn),
// T013 password half (setNewPassword). Runs against real PostgreSQL with a service user
// that carries a REAL valid password hash, so the refusals cannot be explained by a locked password.
process.env.TEST_DB_NAME = process.env.TEST_DB_NAME || 'sp_a_auth';
const { createTestDbConnection, wireLocalTestDbEnv } = await import('../../../test-utils/dbConfig');
const { createTenant, createUser } = await import('../../../test-utils/testDataFactory');
const { createServiceUser } = await import('../../../test-utils/serviceUserFixtures');

const PASSWORD = 'Correct-Horse-9!';
let db: Knex;
let tenant: string;
let internal: { id: string; email: string };
let client: { id: string; email: string };
let service: { id: string; email: string };
let inactiveInternal: { id: string; email: string };
let inactiveService: { id: string; email: string };
let hash: string;
const previousSecret = { lower: process.env.nextauth_secret, upper: process.env.NEXTAUTH_SECRET };

async function emailOf(userId: string): Promise<string> {
  return (await db('users').where({ tenant, user_id: userId }).first()).email;
}

describe('T008/T009/T013: non-interactive users never log in', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    const secret = `t008-${randomUUID()}`;
    process.env.nextauth_secret = secret;
    process.env.NEXTAUTH_SECRET = secret;
    db = await createTestDbConnection();
    hash = await hashPassword(PASSWORD);
    tenant = await createTenant(db, 'T008 tenant');
    const internalId = await createUser(db, tenant, { user_type: 'internal', hashed_password: hash });
    const clientId = await createUser(db, tenant, { user_type: 'client', hashed_password: hash });
    const inactiveId = await createUser(db, tenant, { user_type: 'internal', hashed_password: hash, is_inactive: true });
    const svc = await createServiceUser(db, tenant, { hashedPassword: hash });
    const inactiveSvc = await createServiceUser(db, tenant, { hashedPassword: hash, isInactive: true });
    internal = { id: internalId, email: await emailOf(internalId) };
    client = { id: clientId, email: await emailOf(clientId) };
    inactiveInternal = { id: inactiveId, email: await emailOf(inactiveId) };
    service = { id: svc.userId, email: await emailOf(svc.userId) };
    inactiveService = { id: inactiveSvc.userId, email: await emailOf(inactiveSvc.userId) };
  }, 180_000);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
    const { destroyAdminConnection } = await import('@alga-psa/db/admin');
    await destroyAdminConnection().catch(() => undefined);
    if (previousSecret.lower === undefined) delete process.env.nextauth_secret;
    else process.env.nextauth_secret = previousSecret.lower;
    if (previousSecret.upper === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = previousSecret.upper;
  });

  describe('T008: authenticateUser', () => {
    it('stored password hash really verifies (the refusal below is not a locked password)', async () => {
      const stored = await User.getPasswordHash(service.id, tenant);
      expect(await verifyPassword(PASSWORD, stored!)).toBe(true);
    });

    it('rejects a service user with a valid hash, for every requested type', async () => {
      await expect(authenticateUser(service.email, PASSWORD, 'service' as never)).resolves.toBeNull();
      await expect(authenticateUser(service.email, PASSWORD, 'internal')).resolves.toBeNull();
      await expect(authenticateUser(service.email, PASSWORD, 'client')).resolves.toBeNull();
    });

    it('rejects when userType is omitted (no untyped fallback), even for a valid internal user', async () => {
      await expect(authenticateUser(service.email, PASSWORD)).resolves.toBeNull();
      await expect(authenticateUser(internal.email, PASSWORD)).resolves.toBeNull();
    });

    it('still authenticates internal and client users', async () => {
      await expect(authenticateUser(internal.email, PASSWORD, 'internal', tenant)).resolves.toMatchObject({ user_id: internal.id });
      await expect(authenticateUser(client.email, PASSWORD, 'client', tenant)).resolves.toMatchObject({ user_id: client.id });
    });
  });

  describe('T009: gate that runs in signIn before any session / last_login / success record', () => {
    it('assertInteractiveUser accepts active internal and client users only', async () => {
      await expect(assertInteractiveUser(internal.id, tenant)).resolves.toBe(true);
      await expect(assertInteractiveUser(client.id, tenant)).resolves.toBe(true);
      await expect(assertInteractiveUser(service.id, tenant)).resolves.toBe(false);
      await expect(assertInteractiveUser(inactiveService.id, tenant)).resolves.toBe(false);
      await expect(assertInteractiveUser(inactiveInternal.id, tenant)).resolves.toBe(false);
    });

    it('fails closed on unknown user, wrong tenant and empty ids', async () => {
      await expect(assertInteractiveUser(randomUUID(), tenant)).resolves.toBe(false);
      await expect(assertInteractiveUser(internal.id, randomUUID())).resolves.toBe(false);
      await expect(assertInteractiveUser('', tenant)).resolves.toBe(false);
      await expect(assertInteractiveUser(internal.id, '')).resolves.toBe(false);
    });

    it('assertActiveInternalUser (mobile) accepts only active internal', async () => {
      await expect(assertActiveInternalUser(internal.id, tenant)).resolves.toBe(true);
      await expect(assertActiveInternalUser(client.id, tenant)).resolves.toBe(false);
      await expect(assertActiveInternalUser(service.id, tenant)).resolves.toBe(false);
      await expect(assertActiveInternalUser(inactiveInternal.id, tenant)).resolves.toBe(false);
    });
  });

  describe('T009: real signIn callback against a real service row', () => {
    async function signIn(userId: string, email: string, account: unknown) {
      const { getAuthOptions } = await import('../../../../packages/auth/src/lib/nextAuthOptions');
      const options = await getAuthOptions();
      // The candidate CLAIMS internal; the stored row (user_type = service) must win.
      const candidate = { id: userId, tenant, email, name: email, username: email, proToken: '', user_type: 'internal' };
      return options.callbacks!.signIn!({ user: candidate as any, account: account as any, credentials: undefined, profile: undefined } as any);
    }

    it.each([
      ['credentials', { provider: 'credentials', type: 'credentials' }],
      ['azure-ad', { provider: 'azure-ad', providerAccountId: 'oid-t009' }],
      ['google', { provider: 'google', providerAccountId: 'g-t009' }],
    ])('refuses a real service user via %s: no session row, no last_login', async (_n, account) => {
      const { UserSession } = await import('@alga-psa/db/models/UserSession');
      const createSpy = vi.spyOn(UserSession, 'create');
      const lastLoginSpy = vi.spyOn(User, 'updateLastLogin');
      try {
        await expect(signIn(service.id, service.email, account)).resolves.toBe(false);
        expect(createSpy).not.toHaveBeenCalled();
        expect(lastLoginSpy).not.toHaveBeenCalled();
      } finally {
        createSpy.mockRestore();
        lastLoginSpy.mockRestore();
      }
      const sessions = await db('sessions').where({ tenant, user_id: service.id }).count('* as c').first();
      expect(Number(sessions?.c)).toBe(0);
      const row = await db('users').where({ tenant, user_id: service.id }).first();
      expect(row.last_login_at ?? null).toBeNull();
      expect(row.last_login_method ?? null).toBeNull();
    });
  });

  describe('T013 (password half): setNewPassword', () => {
    async function tokenFor(email: string, userType: string) {
      const { createToken } = await import('../../../../packages/auth/src/lib/tokenizer');
      return createToken({ username: '', email, password: '', clientName: '', user_type: userType as never });
    }

    it('refuses to set a password for a service user and leaves the hash untouched', async () => {
      const { setNewPassword } = await import('@alga-psa/auth/actions/useRegister');
      for (const type of ['service', 'internal', 'client']) {
        await expect(setNewPassword('Brand-New-Pass-1!', await tokenFor(service.email, type))).resolves.toBe(false);
      }
      expect(await User.getPasswordHash(service.id, tenant)).toBe(hash);
    });

    it('refuses a token without a user type', async () => {
      const { setNewPassword } = await import('@alga-psa/auth/actions/useRegister');
      const { createToken } = await import('../../../../packages/auth/src/lib/tokenizer');
      const token = await createToken({ username: '', email: internal.email, password: '', clientName: '' } as never);
      await expect(setNewPassword('Brand-New-Pass-1!', token)).resolves.toBe(false);
      expect(await User.getPasswordHash(internal.id, tenant)).toBe(hash);
    });

    it('still sets a password for an internal user', async () => {
      const { setNewPassword } = await import('@alga-psa/auth/actions/useRegister');
      // A dedicated user keeps this independent of test order (the suite shuffles).
      const id = await createUser(db, tenant, { user_type: 'internal', hashed_password: hash });
      const email = await emailOf(id);
      await expect(setNewPassword('Brand-New-Pass-1!', await tokenFor(email, 'internal'))).resolves.toBe(true);
      expect(await User.getPasswordHash(id, tenant)).not.toBe(hash);
    });
  });
});
