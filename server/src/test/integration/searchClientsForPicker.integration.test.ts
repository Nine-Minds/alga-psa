import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import knex, { type Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { getSecret } from '../../lib/utils/getSecret';

const context = vi.hoisted(() => ({
  tenant: '',
  userId: '',
  db: null as any,
  allowed: true,
  logoCalls: [] as string[][],
}));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) =>
    fn({ user_id: context.userId, tenant: context.tenant, user_type: 'internal' }, { tenant: context.tenant }, ...args),
  withAuthCheck: (fn: any) => fn,
  hasPermission: vi.fn(async () => context.allowed),
  preCheckDeletion: vi.fn(),
  localizeActionError: async (error: any) => error,
}));
vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: async () => ({ knex: context.db, tenant: context.tenant }),
}));
vi.mock('@alga-psa/clients/lib/documentsHelpers', () => ({
  getClientLogoUrlsBatchAsync: vi.fn(async (ids: string[]) => {
    context.logoCalls.push(ids);
    return new Map(ids.map((id) => [id, `/logo/${id}`]));
  }),
}));
vi.mock('../../../../packages/clients/src/lib/documentsHelpers', () => ({
  getClientLogoUrlsBatchAsync: vi.fn(async (ids: string[]) => {
    context.logoCalls.push(ids);
    return new Map(ids.map((id) => [id, `/logo/${id}`]));
  }),
}));

import { searchClientsForPicker } from '@alga-psa/clients/actions/clientPickerActions';

let db: Knex;
const databaseName = `client_picker_search_test_${randomUUID().replaceAll('-', '')}`;
const otherTenant = randomUUID();
const ids: Record<string, string> = {};
let otherTenantClientId: string;

async function seedTenant(tenant: string) {
  await db('tenants').insert({ tenant, client_name: `T ${tenant}`, email: `${tenant}@example.test`, product_code: 'psa' });
}
async function seedClient(tenant: string, name: string, extra: Record<string, unknown> = {}) {
  const client_id = randomUUID();
  await db('clients').insert({
    tenant,
    client_id,
    client_name: name,
    client_type: 'company',
    is_inactive: false,
    ...extra,
  });
  return client_id;
}

beforeAll(async () => {
  db = await createTestDbConnection({ databaseName, runSeeds: false });
  context.db = db;
  context.tenant = randomUUID();
  context.userId = randomUUID();
  await seedTenant(context.tenant);
  await seedTenant(otherTenant);
  await db('users').insert({
    tenant: context.tenant, user_id: context.userId, username: context.userId,
    email: `${context.userId}@example.test`, first_name: 'Test', last_name: 'Admin',
    user_type: 'internal', hashed_password: 'unused',
  });

  ids.acme = await seedClient(context.tenant, 'Acme Widgets');
  ids.bravo = await seedClient(context.tenant, 'Bravo Logistics');
  ids.zed = await seedClient(context.tenant, 'Zed Person', { client_type: 'individual' });
  ids.dormant = await seedClient(context.tenant, 'Dormant Acme Holdings', { is_inactive: true });
  for (let i = 0; i < 60; i++) {
    ids[`bulk${i}`] = await seedClient(context.tenant, `Bulk ${String(i).padStart(2, '0')}`);
  }
  otherTenantClientId = await seedClient(otherTenant, 'Acme Foreign');

  const tagId = randomUUID();
  await db('tag_definitions').insert({
    tenant: context.tenant, tag_id: tagId, tag_text: 'vip', tagged_type: 'client',
    background_color: '#112233', text_color: '#ffffff',
  });
  await db('tag_mappings').insert({
    tenant: context.tenant, mapping_id: randomUUID(), tag_id: tagId, tagged_id: ids.bravo, tagged_type: 'client',
  });
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

const names = (r: { clients: { client_name: string }[] }) => r.clients.map((c) => c.client_name);

it('returns slim rows with logos for the returned page only', async () => {
  context.logoCalls.length = 0;
  const r = await searchClientsForPicker({ pageSize: 5 });
  expect(r.clients).toHaveLength(5);
  expect(Object.keys(r.clients[0]).sort()).toEqual(['client_id', 'client_name', 'client_type', 'displayTags', 'is_inactive', 'logoUrl']);
  expect(Array.isArray(r.clients[0].displayTags)).toBe(true);
  expect(r.clients[0].logoUrl).toBe(`/logo/${r.clients[0].client_id}`);
  expect(context.logoCalls).toHaveLength(1);
  expect(context.logoCalls[0]).toHaveLength(5);
});

it('pages with stable order and reports the total', async () => {
  const p0 = await searchClientsForPicker({ page: 0, pageSize: 10 });
  const p1 = await searchClientsForPicker({ page: 1, pageSize: 10 });
  const p3 = await searchClientsForPicker({ page: 3, pageSize: 10 });
  // 63 active clients: acme, bravo, zed, 60 bulk (dormant excluded by default status)
  expect(p0.total).toBe(63);
  expect(p0.clients).toHaveLength(10);
  expect(p1.clients).toHaveLength(10);
  expect(p3.clients).toHaveLength(10);
  expect(new Set([...p0.clients, ...p1.clients].map((c) => c.client_id)).size).toBe(20);
  expect(names(p0)[0]).toBe('Acme Widgets');
});

it('caps pageSize on the server', async () => {
  const r = await searchClientsForPicker({ pageSize: 10_000, status: 'all' });
  expect(r.clients.length).toBe(50);
  expect(r.total).toBe(64);
});

it('matches search terms', async () => {
  const r = await searchClientsForPicker({ search: 'acme', status: 'all' });
  expect(names(r).sort()).toEqual(['Acme Widgets', 'Dormant Acme Holdings']);
  expect(r.total).toBe(2);
});

it('filters by status and type', async () => {
  expect(names(await searchClientsForPicker({ status: 'inactive' }))).toEqual(['Dormant Acme Holdings']);
  expect(names(await searchClientsForPicker({ clientType: 'individual' }))).toEqual(['Zed Person']);
  const all = await searchClientsForPicker({ status: 'all', pageSize: 50 });
  expect(all.total).toBe(64);
});

it('filters by tag text', async () => {
  const r = await searchClientsForPicker({ tags: ['vip'] });
  expect(names(r)).toEqual(['Bravo Logistics']);
  expect(r.total).toBe(1);
  expect((await searchClientsForPicker({ tags: ['nope'] })).total).toBe(0);
});

it('removes excludeIds on the server', async () => {
  const r = await searchClientsForPicker({ search: 'acme', status: 'all', excludeIds: [ids.acme] });
  expect(names(r)).toEqual(['Dormant Acme Holdings']);
  expect(r.total).toBe(1);
});

it('looks up by id ignoring paging and filters', async () => {
  const r = await searchClientsForPicker({
    ids: [ids.dormant, ids.zed], status: 'active', clientType: 'company', page: 5, pageSize: 1, search: 'zzz',
  });
  expect(names(r).sort()).toEqual(['Dormant Acme Holdings', 'Zed Person']);
  expect(r.total).toBe(2);
});

it('never returns other tenants, including via ids', async () => {
  const search = await searchClientsForPicker({ search: 'Foreign', status: 'all' });
  expect(search.clients).toHaveLength(0);
  const lookup = await searchClientsForPicker({ ids: [otherTenantClientId, ids.acme] });
  expect(lookup.clients.map((c) => c.client_id)).toEqual([ids.acme]);
  const everything = await searchClientsForPicker({ status: 'all', pageSize: 50 });
  expect(everything.clients.map((c) => c.client_id)).not.toContain(otherTenantClientId);
});

it('rejects callers without client:read', async () => {
  context.allowed = false;
  try {
    await expect(searchClientsForPicker({})).rejects.toThrow(/Permission denied/);
  } finally {
    context.allowed = true;
  }
});
