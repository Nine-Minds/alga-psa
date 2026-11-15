import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import knex, { type Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { getSecret } from '../../lib/utils/getSecret';

// Seat admission and seat counts read `is_inactive = false`, while sign-in
// only tests truthiness. A null or string active state therefore produced a
// working account no seat count saw, and reactivating an inactive internal user
// took a seat without checking the limit.

const context = vi.hoisted(() => ({ tenant: '', userId: '', db: null as any }));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) =>
    fn({ user_id: context.userId, tenant: context.tenant, user_type: 'internal' }, { tenant: context.tenant }, ...args),
  withOptionalAuth: (fn: any) => fn,
  withAuthCheck: (fn: any) => fn,
  hasPermission: vi.fn(async () => true),
  preCheckDeletion: vi.fn(),
  localizeActionError: async (error: any) => error,
}));
vi.mock('@alga-psa/user-composition/lib/permissions', () => ({
  hasPermission: vi.fn(async () => true),
  throwPermissionError: (action: string) => { throw new Error(`Permission denied: ${action}`); },
}));
vi.mock('@alga-psa/user-composition/actions/userQueryActions', () => ({ getUserRoles: vi.fn(async () => []) }));
vi.mock('@alga-psa/user-composition/lib/avatarUtils', () => ({ getUserAvatarUrl: vi.fn(async () => null) }));
vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@alga-psa/db')>(),
  createTenantKnex: async () => ({ knex: context.db, tenant: context.tenant }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@alga-psa/storage', () => ({ uploadEntityImage: vi.fn(), deleteEntityImage: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: vi.fn(), publishEvent: vi.fn(async () => undefined), publishNonCatalogWorkflowEvent: vi.fn(async () => undefined), publishStoredWorkflowEvent: vi.fn(async () => undefined), publishBuiltWorkflowPayload: vi.fn(async () => undefined), publishNonCatalogEventByName: vi.fn(async () => undefined), publishUnregisteredEventType: vi.fn(async () => undefined) }));

import { runWithTenant } from '@alga-psa/db';
import { updateUser as updateUserAction } from '@alga-psa/users/actions/user-actions/userActions';

// Production runs actions inside the request's tenant context; User.update reads it.
const updateUser = (userId: string, data: Parameters<typeof updateUserAction>[1]) =>
  runWithTenant(context.tenant, () => updateUserAction(userId, data));

let db: Knex;
const databaseName = `update_user_active_state_test_${randomUUID().replaceAll('-', '')}`;

beforeAll(async () => {
  db = await createTestDbConnection({ databaseName, runSeeds: false });
  context.db = db;
}, 180_000);

afterAll(async () => {
  await db?.destroy();
  const admin = knex({ client: 'pg', connection: {
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER_ADMIN || 'postgres',
    password: await getSecret('postgres_password', 'DB_PASSWORD_ADMIN', 'postpass123'), database: 'postgres',
  }, pool: { min: 0, max: 1 } });
  try { await admin.raw('DROP DATABASE IF EXISTS ??', [databaseName]); }
  finally { await admin.destroy(); }
});

async function seedUser(isInactive: boolean): Promise<void> {
  context.tenant = randomUUID();
  context.userId = randomUUID();
  await db('tenants').insert({ tenant: context.tenant, client_name: 'Active state test', email: `${context.tenant}@example.test`, product_code: 'psa' });
  await db('users').insert({
    tenant: context.tenant, user_id: context.userId, username: context.userId,
    email: `${context.userId}@example.test`, first_name: 'Test', last_name: 'User',
    user_type: 'internal', hashed_password: 'unused', is_inactive: isInactive,
  });
}

const storedActiveState = async () =>
  (await db('users').where({ tenant: context.tenant, user_id: context.userId }).first()).is_inactive;

beforeEach(() => vi.clearAllMocks());

it.each([null, 'false', 0, 'true'])('refuses the active state %j and leaves the stored value alone', async (value) => {
  await seedUser(false);
  const result = await updateUser(context.userId, { is_inactive: value as never, phone: '555-0100' });
  expect(result).toMatchObject({ success: false, code: 'INVALID_ACTIVE_STATE' });
  expect(await storedActiveState()).toBe(false);
});

it('still deactivates and reactivates with a real boolean', async () => {
  await seedUser(false);
  await expect(updateUser(context.userId, { is_inactive: true })).resolves.toMatchObject({ success: true });
  expect(await storedActiveState()).toBe(true);
  await expect(updateUser(context.userId, { is_inactive: false })).resolves.toMatchObject({ success: true });
  expect(await storedActiveState()).toBe(false);
});

it('stores no user without an active state', async () => {
  await seedUser(false);
  await expect(db('users').where({ tenant: context.tenant, user_id: context.userId }).update({ is_inactive: null }))
    .rejects.toMatchObject({ code: '23502' });
  const columns = await db('information_schema.columns').where({ table_name: 'users', column_name: 'is_inactive' }).first('is_nullable');
  expect(columns.is_nullable).toBe('NO');
});

async function seedOtherActiveInternalUser(): Promise<void> {
  const otherId = randomUUID();
  await db('users').insert({
    tenant: context.tenant, user_id: otherId, username: otherId, email: `${otherId}@example.test`,
    first_name: 'Other', last_name: 'User', user_type: 'internal', hashed_password: 'unused', is_inactive: false,
  });
}

const setSeatLimit = (limit: number | null) =>
  db('tenants').where({ tenant: context.tenant }).update({ licensed_user_count: limit });

it('refuses to reactivate an internal user when the seat limit is reached', async () => {
  await seedUser(true);
  await seedOtherActiveInternalUser();
  await setSeatLimit(1);
  const result = await updateUser(context.userId, { is_inactive: false });
  expect(result).toMatchObject({ success: false, code: 'LICENSE_LIMIT_REACHED' });
  expect(await storedActiveState()).toBe(true);
});

it('reactivates an internal user while a seat is free', async () => {
  await seedUser(true);
  await seedOtherActiveInternalUser();
  await setSeatLimit(2);
  await expect(updateUser(context.userId, { is_inactive: false })).resolves.toMatchObject({ success: true });
  expect(await storedActiveState()).toBe(false);
});

it('does not refuse an unrelated edit by an already-active user at the seat limit', async () => {
  await seedUser(false);
  await setSeatLimit(1);
  await expect(updateUser(context.userId, { phone: '555-0101' })).resolves.toMatchObject({ success: true });
  await expect(updateUser(context.userId, { is_inactive: false, phone: '555-0102' })).resolves.toMatchObject({ success: true });
  expect(await storedActiveState()).toBe(false);
});
