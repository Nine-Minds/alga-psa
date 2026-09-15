import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import knex, { type Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { getSecret } from '../../lib/utils/getSecret';

const context = vi.hoisted(() => ({ tenant: '', db: null as any }));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ tenant: context.tenant }, { tenant: context.tenant }, ...args),
}));
vi.mock('@alga-psa/db', async importOriginal => ({
  ...await importOriginal<typeof import('@alga-psa/db')>(),
  createTenantKnex: async () => ({ knex: context.db, tenant: context.tenant }),
}));
import { getRemainingBucketUnits } from '@alga-psa/reporting/actions/report-actions/getRemainingBucketUnits';

let db: Knex;
const databaseName = `bucket_units_test_${randomUUID().replaceAll('-', '')}`;
beforeAll(async () => {
  // The Citus runtime runner supplies TEST_DB_BACKEND and TEST_MIGRATIONS_DIR;
  // the same real SQL assertions run there against its distributed schema.
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

async function fixture(shared: { contractId?: string; lineId?: string; bucketId?: string; serviceIds?: string[] } = {}) {
  const tenant = randomUUID();
  const clientId = randomUUID();
  const contractId = shared.contractId ?? randomUUID();
  const lineId = shared.lineId ?? randomUUID();
  const bucketId = shared.bucketId ?? randomUUID();
  const serviceIds = shared.serviceIds ?? [randomUUID(), randomUUID()].sort();
  await db('tenants').insert({ tenant, client_name: 'Bucket summary test', email: `${tenant}@example.test` });
  await db('clients').insert({ tenant, client_id: clientId, client_name: 'Bucket client' });
  const serviceTypeId = randomUUID();
  await db('service_types').insert({ tenant, id: serviceTypeId, name: 'Bucket services' });
  for (const [index, serviceId] of serviceIds.entries()) {
    await db('service_catalog').insert({ tenant, service_id: serviceId, service_name: `Service ${index}`, custom_service_type_id: serviceTypeId, billing_method: 'per_unit' });
  }
  await db('contracts').insert({ tenant, contract_id: contractId, contract_name: 'Bucket contract' });
  await db('contract_lines').insert({ tenant, contract_line_id: lineId, contract_id: contractId,
    contract_line_name: 'Retainer', contract_line_type: 'Bucket', billing_frequency: 'monthly', cadence_owner: 'client', is_template: false, is_active: true });
  await db('client_contracts').insert({ tenant, client_contract_id: randomUUID(), client_id: clientId,
    contract_id: contractId, start_date: '2026-03-01', end_date: null, is_active: true });
  await db('contract_line_buckets').insert({ tenant, bucket_id: bucketId, contract_line_id: lineId,
    total_minutes: 600, overage_rate: 15000, allow_rollover: true, covers_all_services: false });
  // Reverse insertion order proves the displayed service follows UUID ordering.
  for (const serviceId of [...serviceIds].reverse()) {
    await db('contract_line_bucket_services').insert({ tenant, bucket_id: bucketId, contract_line_id: lineId, service_id: serviceId, burn_multiplier: 1 });
  }
  return { tenant, clientId, contractId, lineId, bucketId, serviceIds };
}
async function usage(f: Awaited<ReturnType<typeof fixture>>, overrides: Record<string, unknown> = {}) {
  await db('bucket_usage').insert({ tenant: f.tenant, usage_id: randomUUID(), client_id: f.clientId,
    contract_line_id: f.lineId, service_catalog_id: f.serviceIds[0], bucket_id: f.bucketId,
    period_start: '2026-03-01', period_end: '2026-04-01', minutes_used: 240,
    overage_minutes: 0, rolled_over_minutes: 60, ...overrides });
}
function read(f: Awaited<ReturnType<typeof fixture>>, currentDate = '2026-03-15') {
  context.tenant = f.tenant;
  return getRemainingBucketUnits({ clientId: f.clientId, currentDate });
}

it('returns tenant-isolated weighted usage, rollover and deterministic first-member labels from real SQL', async () => {
  const own = await fixture();
  const foreign = await fixture();
  await usage(own);
  await usage(foreign, { minutes_used: 599 });
  await db('contract_line_buckets').where({ tenant: foreign.tenant }).update({ bucket_name: 'Foreign pool', total_minutes: 9999 });
  expect(await read(own)).toEqual([expect.objectContaining({
    contract_line_id: own.lineId, service_id: own.serviceIds[0], service_name: 'Service 0',
    display_label: 'Retainer - Service 0', total_minutes: 600, minutes_used: 240,
    rolled_over_minutes: 60, remaining_minutes: 420, period_start: '2026-03-01', period_end: '2026-04-01',
  })]);
  context.tenant = foreign.tenant;
  expect(await getRemainingBucketUnits({ clientId: own.clientId, currentDate: '2026-03-15' })).toEqual([]);
});

it('retains unused pools and catch-all labels, excluding usage at the exclusive period end', async () => {
  const f = await fixture();
  await usage(f, { period_start: '2026-02-01', period_end: '2026-03-01' });
  await db('contract_line_bucket_services').where({ tenant: f.tenant }).delete();
  await db('contract_line_buckets').where({ tenant: f.tenant }).update({ covers_all_services: true, bucket_name: 'Shared hours' });
  expect(await read(f, '2026-03-01')).toEqual([expect.objectContaining({
    service_id: null, service_name: 'All services', display_label: 'Shared hours',
    minutes_used: 0, rolled_over_minutes: 0, remaining_minutes: 600,
  })]);
  await db('client_contracts').where({ tenant: f.tenant }).update({ end_date: '2026-03-01' });
  expect(await read(f, '2026-03-01')).toEqual([]);
});

it('uses the template contract when assigned and excludes inactive or future assignments', async () => {
  const f = await fixture();
  const instanceId = randomUUID();
  await db('contracts').insert({ tenant: f.tenant, contract_id: instanceId, contract_name: 'Assigned instance' });
  await db('client_contracts').where({ tenant: f.tenant }).update({ contract_id: instanceId, template_contract_id: f.contractId });
  expect(await read(f)).toEqual([expect.objectContaining({ contract_line_id: f.lineId, remaining_minutes: 600 })]);
  await db('client_contracts').where({ tenant: f.tenant }).update({ is_active: false });
  expect(await read(f)).toEqual([]);
  await db('client_contracts').where({ tenant: f.tenant }).update({ is_active: true, start_date: '2026-04-01' });
  expect(await read(f)).toEqual([]);
});


it('isolates colliding contract, line, bucket and service IDs across tenants', async () => {
  const own = await fixture();
  const foreign = await fixture(own);
  await usage(own);
  await usage(foreign, { minutes_used: 590, rolled_over_minutes: 900 });
  await db('contract_lines').where({ tenant: foreign.tenant }).update({ contract_line_name: 'Foreign retainer' });
  await db('contract_line_buckets').where({ tenant: foreign.tenant }).update({ total_minutes: 9999, bucket_name: 'Foreign pool' });
  await db('service_catalog').where({ tenant: foreign.tenant }).update({ service_name: 'Foreign service' });
  expect(await read(own)).toEqual([expect.objectContaining({
    contract_line_id: own.lineId, contract_line_name: 'Retainer', service_id: own.serviceIds[0], service_name: 'Service 0',
    display_label: 'Retainer - Service 0', total_minutes: 600, minutes_used: 240, rolled_over_minutes: 60, remaining_minutes: 420,
  })]);
  expect(await read(foreign)).toEqual([expect.objectContaining({
    contract_line_id: foreign.lineId, contract_line_name: 'Foreign retainer', service_id: foreign.serviceIds[0], service_name: 'Foreign service',
    display_label: 'Foreign pool', total_minutes: 9999, minutes_used: 590, rolled_over_minutes: 900, remaining_minutes: 10309,
  })]);
});
