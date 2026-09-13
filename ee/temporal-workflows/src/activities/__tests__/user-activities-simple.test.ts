import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { MockActivityEnvironment } from '@temporalio/testing';
import { randomUUID } from 'node:crypto';
import { destroyAdminConnection, getAdminConnection } from '@alga-psa/db/admin';
import { verifyPassword } from '@alga-psa/core/encryption';
import { createAdminUser, rollbackUser } from '../user-activities';
import { rollbackTenant } from '../tenant-activities';
import { createTestTenant } from '../../db/__tests__/upgrade-test-fixtures';

// Exercise the shipped activities, not a second implementation in the test.
const activity = new MockActivityEnvironment();
const tenants = new Set<string>();
beforeAll(() => {
  vi.stubEnv('SECRET_READ_CHAIN', 'env');
  vi.stubEnv('NEXTAUTH_SECRET', 'synthetic-temporal-user-activity-key-82cc');
});
afterAll(() => vi.unstubAllEnvs());
afterEach(async () => {
  for (const tenantId of tenants) await activity.run(rollbackTenant, tenantId);
  tenants.clear();
});
afterAll(destroyAdminConnection);

async function fixture(withAdmin = true) {
  const db = await getAdminConnection();
  const { tenantId } = await createTestTenant(db, { name: `Admin activity ${randomUUID()}`, productCode: 'psa' });
  tenants.add(tenantId);
  const roleId = randomUUID();
  if (withAdmin) await db('roles').insert({ tenant: tenantId, role_id: roleId, role_name: 'Admin', msp: true, client: false });
  return { db, tenantId, roleId };
}
const request = (tenantId: string, email = `Admin-${randomUUID()}@example.test`) => ({
  tenantId, email, firstName: 'Test', lastName: 'Administrator',
});

it('creates an internal admin using the existing MSP role and a usable generated password', async () => {
  const { db, tenantId, roleId } = await fixture();
  // The identically named portal role must never be selected for an internal admin.
  await db('roles').insert({ tenant: tenantId, role_id: randomUUID(), role_name: 'Admin', msp: false, client: true });
  const input = request(tenantId);
  const result = await activity.run(createAdminUser, input);
  expect(result.roleId).toBe(roleId);
  const user = await db('users').where({ tenant: tenantId, user_id: result.userId }).first();
  expect(user).toMatchObject({ email: input.email.toLowerCase(), username: input.email.toLowerCase(), user_type: 'internal', first_name: 'Test', last_name: 'Administrator' });
  expect(user.hashed_password).not.toBe(result.temporaryPassword);
  expect(result.temporaryPassword.length).toBeGreaterThanOrEqual(16);
  expect(await verifyPassword(result.temporaryPassword, user.hashed_password)).toBe(true);
  expect(await verifyPassword('wrong-password', user.hashed_password)).toBe(false);
  expect(await db('user_roles').where({ tenant: tenantId, user_id: result.userId })).toEqual([
    expect.objectContaining({ role_id: roleId }),
  ]);
  expect(await db('roles').where({ tenant: tenantId, msp: true, client: false, role_name: 'Admin' })).toHaveLength(1);
});

it('honours a supplied appliance password and salts hashes independently', async () => {
  const { db, tenantId } = await fixture();
  const password = 'Synthetic-appliance-password-82cc!';
  const first = await activity.run(createAdminUser, { ...request(tenantId), password });
  const second = await activity.run(createAdminUser, { ...request(tenantId), password });
  expect(first.temporaryPassword).toBe(password);
  expect(second.temporaryPassword).toBe(password);
  const users = await db('users').where({ tenant: tenantId }).whereIn('user_id', [first.userId, second.userId]);
  expect(users).toHaveLength(2);
  expect(users[0].hashed_password).not.toBe(users[1].hashed_password);
  for (const user of users) expect(await verifyPassword(password, user.hashed_password)).toBe(true);
});

it('refuses duplicate internal email across tenants and preserves the original account', async () => {
  const first = await fixture();
  const second = await fixture();
  const email = `duplicate-${randomUUID()}@example.test`;
  const original = await activity.run(createAdminUser, request(first.tenantId, email));
  await expect(activity.run(createAdminUser, request(second.tenantId, email.toUpperCase()))).rejects.toThrow('already exists');
  expect(await first.db('users').where({ tenant: first.tenantId, user_id: original.userId }).first()).toMatchObject({ email });
  expect(await first.db('users').where({ tenant: second.tenantId })).toEqual([]);
  expect(await first.db('user_roles').where({ tenant: second.tenantId })).toEqual([]);
});

it('rolls back the inserted account if the required MSP Admin role is missing', async () => {
  const { db, tenantId } = await fixture(false);
  await db('roles').insert({ tenant: tenantId, role_id: randomUUID(), role_name: 'Admin', msp: false, client: true });
  await expect(activity.run(createAdminUser, request(tenantId))).rejects.toThrow('Admin role not found');
  expect(await db('users').where({ tenant: tenantId })).toEqual([]);
  expect(await db('user_roles').where({ tenant: tenantId })).toEqual([]);
});

it('scopes rollback to its tenant, removes role grants and tolerates repeated cleanup', async () => {
  const first = await fixture();
  const second = await fixture();
  const user = await activity.run(createAdminUser, request(first.tenantId));
  const survivor = await activity.run(createAdminUser, request(second.tenantId));
  await activity.run(rollbackUser, user.userId, second.tenantId);
  expect(await first.db('users').where({ tenant: first.tenantId, user_id: user.userId }).first()).toBeTruthy();
  await activity.run(rollbackUser, user.userId, first.tenantId);
  expect(await first.db('users').where({ tenant: first.tenantId })).toEqual([]);
  expect(await first.db('user_roles').where({ tenant: first.tenantId })).toEqual([]);
  expect(await second.db('users').where({ tenant: second.tenantId, user_id: survivor.userId }).first()).toBeTruthy();
  await activity.run(rollbackUser, user.userId, first.tenantId);
});
