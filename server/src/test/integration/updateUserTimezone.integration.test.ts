import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import knex, { type Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { getSecret } from '../../lib/utils/getSecret';

// updateUser saves the whole profile at once, so the timezone is validated only
// when it changes: a legacy value already stored (e.g. "EST" on another
// install) must not block an unrelated edit such as a phone-number change.
// alga-2026-0002611.

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
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: vi.fn() }));

import { runWithTenant } from '@alga-psa/db';
import { updateUser as updateUserAction } from '@alga-psa/users/actions/user-actions/userActions';

// Production runs actions inside the request's tenant context; User.update reads it.
const updateUser = (userId: string, data: Parameters<typeof updateUserAction>[1]) =>
  runWithTenant(context.tenant, () => updateUserAction(userId, data));

let db: Knex;
const databaseName = `update_user_timezone_test_${randomUUID().replaceAll('-', '')}`;

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

async function seedUser(timezone: string | null): Promise<void> {
  context.tenant = randomUUID();
  context.userId = randomUUID();
  await db('tenants').insert({ tenant: context.tenant, client_name: 'Timezone test', email: `${context.tenant}@example.test`, product_code: 'psa' });
  await db('users').insert({
    tenant: context.tenant, user_id: context.userId, username: context.userId,
    email: `${context.userId}@example.test`, first_name: 'Test', last_name: 'User',
    user_type: 'internal', hashed_password: 'unused', timezone,
  });
}

const storedTimezone = async () =>
  (await db('users').where({ tenant: context.tenant, user_id: context.userId }).first()).timezone;

beforeEach(() => vi.clearAllMocks());

it('rejects a non-location zone and leaves the stored value alone', async () => {
  await seedUser('America/Chicago');

  const result = await updateUser(context.userId, { timezone: 'EST' });

  expect(result).toMatchObject({ success: false, code: 'INVALID_TIMEZONE' });
  expect(await storedTimezone()).toBe('America/Chicago');
});

it('rejects an unrecognised zone', async () => {
  await seedUser('America/Chicago');

  const result = await updateUser(context.userId, { timezone: 'Not/AZone' });

  expect(result).toMatchObject({ success: false, code: 'INVALID_TIMEZONE' });
  expect(await storedTimezone()).toBe('America/Chicago');
});

it('saves a city zone', async () => {
  await seedUser('America/Chicago');

  const result = await updateUser(context.userId, { timezone: 'America/New_York' });

  expect(result).toMatchObject({ success: true });
  expect(await storedTimezone()).toBe('America/New_York');
});

it('saves a UTC alias as UTC', async () => {
  await seedUser('America/Chicago');

  const result = await updateUser(context.userId, { timezone: 'Etc/UTC' });

  expect(result).toMatchObject({ success: true });
  expect(await storedTimezone()).toBe('UTC');
});

it('does not re-validate an unchanged legacy zone saved alongside another change', async () => {
  await seedUser('EST');

  const result = await updateUser(context.userId, { timezone: 'EST', phone: '+1 555 0100' });

  expect(result).toMatchObject({ success: true });
  const row = await db('users').where({ tenant: context.tenant, user_id: context.userId }).first();
  expect(row.timezone).toBe('EST');
  expect(row.phone).toBe('+1 555 0100');
});

it('still rejects changing a legacy zone to another non-location zone', async () => {
  await seedUser('EST');

  const result = await updateUser(context.userId, { timezone: 'MST' });

  expect(result).toMatchObject({ success: false, code: 'INVALID_TIMEZONE' });
  expect(await storedTimezone()).toBe('EST');
});

it('clears the zone when null is sent', async () => {
  await seedUser('America/Chicago');

  const result = await updateUser(context.userId, { timezone: null as any });

  expect(result).toMatchObject({ success: true });
  expect(await storedTimezone()).toBeNull();
});

it('leaves the zone alone when the update does not mention it', async () => {
  await seedUser('America/Chicago');

  const result = await updateUser(context.userId, { phone: '+1 555 0101' });

  expect(result).toMatchObject({ success: true });
  expect(await storedTimezone()).toBe('America/Chicago');
});
