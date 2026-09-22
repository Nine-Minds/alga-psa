import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import knex, { type Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { getSecret } from '../../lib/utils/getSecret';

const context = vi.hoisted(() => ({ tenant: '', userId: '', db: null as any }));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: context.userId, tenant: context.tenant, user_type: 'internal' }, { tenant: context.tenant }, ...args),
  withAuthCheck: (fn: any) => fn,
  hasPermission: vi.fn(async () => true), preCheckDeletion: vi.fn(), localizeActionError: async (error: any) => error,
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@alga-psa/db', async importOriginal => ({
  ...await importOriginal<typeof import('@alga-psa/db')>(),
  createTenantKnex: async () => ({ knex: context.db, tenant: context.tenant }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@alga-psa/storage', () => ({ uploadEntityImage: vi.fn(), deleteEntityImage: vi.fn() }));
vi.mock('@alga-psa/clients/lib/documentsHelpers', () => ({ getClientLogoUrlAsync: vi.fn(), getClientLogoUrlsBatchAsync: vi.fn() }));
vi.mock('@alga-psa/tags/actions/tagActions', () => ({ createTag: vi.fn(), findTagsByEntityId: vi.fn() }));
vi.mock('@alga-psa/tags/lib/tagCleanup', () => ({ deleteEntityTags: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: vi.fn() }));

import { createClient } from '@alga-psa/clients/actions/clientActions';
let db: Knex;
const databaseName = `client_atomicity_test_${randomUUID().replaceAll('-', '')}`;
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

async function tenant(product = 'psa') {
  context.tenant = randomUUID();
  context.userId = randomUUID();
  await db('tenants').insert({ tenant: context.tenant, client_name: 'Client atomicity', email: `${context.tenant}@example.test`, product_code: product });
  await db('users').insert({ tenant: context.tenant, user_id: context.userId, username: context.userId,
    email: `${context.userId}@example.test`, first_name: 'Test', last_name: 'Admin', user_type: 'internal', hashed_password: 'unused' });
}
const create = () => createClient({ client_name: 'Atomic customer', is_inactive: false } as any);

// Found while auditing #3338. This rollback gap is not asserted to be the
// original incident's root cause (that report confirmed stale image/schema).
it('a real missing-active-tax-rate failure leaves no client or billing profile', async () => {
  await tenant();
  await expect(create()).rejects.toThrow('No active tax rates found');
  expect(await db('clients').where({ tenant: context.tenant })).toEqual([]);
  expect(await db('client_billing_profiles').where({ tenant: context.tenant })).toEqual([]);
  expect(await db('client_tax_settings').where({ tenant: context.tenant })).toEqual([]);
});

it('creates the client, default profile and tax settings together when an active tax rate exists', async () => {
  await tenant();
  await db('tax_regions').insert({ tenant: context.tenant, region_code: 'US-FL', region_name: 'Florida' });
  await db('tax_rates').insert({ tenant: context.tenant, tax_rate_id: randomUUID(), tax_percentage: 0,
    region_code: 'US-FL', description: 'Zero rate', is_active: true, start_date: '2026-01-01' });
  const result = await create();
  expect(result).toMatchObject({ success: true });
  if (!result.success) throw new Error('Expected client creation to succeed');
  const profiles = await db('client_billing_profiles').where({ tenant: context.tenant, client_id: result.data.client_id });
  expect(profiles).toHaveLength(1);
  const settings = await db('client_tax_settings').where({ tenant: context.tenant, client_id: result.data.client_id });
  expect(settings).toHaveLength(1);
  expect(settings[0].billing_profile_id).toBe(profiles[0].billing_profile_id);
});

it('preserves AlgaDesk client creation without tax rates or tax settings', async () => {
  await tenant('algadesk');
  const result = await create();
  expect(result).toMatchObject({ success: true });
  expect(await db('clients').where({ tenant: context.tenant })).toHaveLength(1);
  expect(await db('client_billing_profiles').where({ tenant: context.tenant })).toHaveLength(1);
  expect(await db('client_tax_settings').where({ tenant: context.tenant })).toEqual([]);
});
