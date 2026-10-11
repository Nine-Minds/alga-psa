import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import knex, { type Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { getSecret } from '../../lib/utils/getSecret';

// The client details page and the list quick view both spread the record they
// were handed straight back into updateClient. That record comes from a read
// query that joins location, account-manager and default-client columns onto
// clients, so every alias a read query adds must be stripped before the
// UPDATE. alga-2026-0002617 (PR #3521 added location_phone_extension /
// location_country_code to the reads only) turned every client-details save
// into `column "location_phone_extension" of relation "clients" does not exist`
// and nothing in the gate ran the round trip against Postgres.

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
vi.mock('@alga-psa/clients/lib/documentsHelpers', () => ({
  getClientLogoUrlAsync: vi.fn(async () => null),
  getClientWideLogoUrlAsync: vi.fn(async () => null),
  getClientLogoUrlsBatchAsync: vi.fn(async () => new Map()),
}));
vi.mock('@alga-psa/formatting/avatarUtils', () => ({
  getClientLogoUrl: vi.fn(async () => null),
  getEntityImageUrl: vi.fn(async () => null),
  getClientLogoUrlsBatch: vi.fn(async () => new Map()),
  getContactAvatarUrlsBatch: vi.fn(async () => new Map()),
}));
vi.mock('@alga-psa/tags/actions/tagActions', () => ({ createTag: vi.fn(), findTagsByEntityId: vi.fn() }));
vi.mock('@alga-psa/tags/lib/tagCleanup', () => ({ deleteEntityTags: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: vi.fn() }));

import { createClient, getAllClientsPaginated, updateClient } from '@alga-psa/clients/actions/clientActions';
import { getClientById } from '@alga-psa/clients/actions/queryActions';

let db: Knex;
const databaseName = `client_save_round_trip_test_${randomUUID().replaceAll('-', '')}`;
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

async function seedClientWithDefaultLocation(): Promise<string> {
  context.tenant = randomUUID();
  context.userId = randomUUID();
  await db('tenants').insert({ tenant: context.tenant, client_name: 'Client save round trip', email: `${context.tenant}@example.test`, product_code: 'psa' });
  await db('users').insert({ tenant: context.tenant, user_id: context.userId, username: context.userId,
    email: `${context.userId}@example.test`, first_name: 'Test', last_name: 'Admin', user_type: 'internal', hashed_password: 'unused' });
  const created = await createClient({ client_name: 'Round trip customer', is_inactive: false } as any);
  if (!created.success) throw new Error(`Seed client creation failed: ${created.error}`);
  await db('client_locations').insert({
    location_id: randomUUID(), tenant: context.tenant, client_id: created.data.client_id,
    address_line1: '1 Main St', city: 'Springfield', country_code: 'US', country_name: 'United States',
    phone: '+1 555 0100', phone_extension: '42', email: 'front-desk@example.test', is_default: true,
  });
  return created.data.client_id;
}

// Both UI surfaces drop only the account-manager display name before saving;
// every other key of the fetched record travels back to the action.
function saveWholeRecord(record: Record<string, any>, changes: Record<string, any>) {
  const { account_manager_full_name, ...rest } = record;
  return updateClient(record.client_id, { ...rest, ...changes } as any);
}

it('saves a client record fetched for the details page back without touching joined columns', async () => {
  const clientId = await seedClientWithDefaultLocation();
  const fetched = await getClientById(clientId);
  expect(fetched).not.toBeNull();
  expect(fetched).toMatchObject({ location_phone: '+1 555 0100', location_phone_extension: '42', location_country_code: 'US' });

  const result = await saveWholeRecord(fetched as any, { client_name: 'Round trip customer (renamed)' });
  expect(result).not.toHaveProperty('error');
  expect(result).toMatchObject({ client_id: clientId, client_name: 'Round trip customer (renamed)' });

  const stored = await db('clients').where({ tenant: context.tenant, client_id: clientId }).first();
  expect(stored.client_name).toBe('Round trip customer (renamed)');
  const location = await db('client_locations').where({ tenant: context.tenant, client_id: clientId }).first();
  expect(location).toMatchObject({ phone: '+1 555 0100', phone_extension: '42', country_code: 'US' });
});

it('saves a client row from the paginated list (quick view) back without touching joined columns', async () => {
  const clientId = await seedClientWithDefaultLocation();
  const page = await getAllClientsPaginated({ page: 1, pageSize: 10, loadLogos: false });
  const row = page.clients.find((client) => client.client_id === clientId);
  expect(row).toBeDefined();
  expect(row).toMatchObject({ location_phone_extension: '42', location_country_code: 'US' });

  const result = await saveWholeRecord(row as any, { notes: 'Saved from the list quick view' });
  expect(result).not.toHaveProperty('error');
  expect(result).toMatchObject({ client_id: clientId, notes: 'Saved from the list quick view' });

  const stored = await db('clients').where({ tenant: context.tenant, client_id: clientId }).first();
  expect(stored.notes).toBe('Saved from the list quick view');
});
