import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import knex, { type Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { getSecret } from '../../lib/utils/getSecret';

const context = vi.hoisted(() => ({ tenant: '', userId: '', db: null as any }));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: context.userId, tenant: context.tenant, user_type: 'internal' }, { tenant: context.tenant }, ...args),
  withAuthCheck: (fn: any) => fn,
  hasPermission: vi.fn(async () => true),
}));
vi.mock('@alga-psa/db', async importOriginal => ({
  ...await importOriginal<typeof import('@alga-psa/db')>(),
  createTenantKnex: async () => ({ knex: context.db, tenant: context.tenant }),
}));

import { getClientOpenTicketCounts } from '@alga-psa/clients/actions/clientTicketStatsActions';

// alga-2026-0002754: counts are scoped to the visible page's client ids and
// still use statuses.is_closed (joined), not the stale tickets.is_closed.

let db: Knex;
const databaseName = `client_ticket_counts_test_${randomUUID().replaceAll('-', '')}`;
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

async function seedTenant(): Promise<void> {
  context.tenant = randomUUID();
  context.userId = randomUUID();
  await db('tenants').insert({ tenant: context.tenant, client_name: 'Card B', email: `${context.tenant}@example.test`, product_code: 'psa' });
  await db('users').insert({ tenant: context.tenant, user_id: context.userId, username: context.userId,
    email: `${context.userId}@example.test`, first_name: 'Test', last_name: 'Admin', user_type: 'internal', hashed_password: 'unused' });
}

async function seedClient(name: string): Promise<string> {
  const client_id = randomUUID();
  await db('clients').insert({ tenant: context.tenant, client_id, client_name: name });
  return client_id;
}

async function seedStatus(name: string, is_closed: boolean, order: number): Promise<string> {
  const status_id = randomUUID();
  await db('statuses').insert({ tenant: context.tenant, status_id, name, status_type: 'ticket', order_number: order, is_closed, created_by: context.userId });
  return status_id;
}
let n = 0;
async function seedTicket(client_id: string, status_id: string, is_closed: boolean | null = null) {
  await db('tickets').insert({ tenant: context.tenant, ticket_id: randomUUID(), ticket_number: `T-${++n}-${randomUUID().slice(0, 6)}`,
    title: 'x', client_id, status_id, ...(is_closed === null ? {} : { is_closed }) });
}

it('counts open tickets only for the requested clients and keeps the status-based predicate', async () => {
  await seedTenant();
  const open = await seedStatus('Open', false, 1);
  const closed = await seedStatus('Closed', true, 2);
  const a = await seedClient('A'), b = await seedClient('B'), c = await seedClient('C'), d = await seedClient('D');
  await seedTicket(a, open); await seedTicket(a, open); await seedTicket(a, closed);
  await seedTicket(b, open);
  // Stale denormalized flag: status says closed, ticket says open -> NOT counted.
  await seedTicket(c, closed, false);
  // Opposite disagreement: status open, ticket flag true -> counted.
  await seedTicket(c, open, true);
  await seedTicket(d, open); await seedTicket(d, open); await seedTicket(d, open);

  expect(await getClientOpenTicketCounts([a, c])).toEqual({ [a]: 2, [c]: 1 });
  expect(await getClientOpenTicketCounts([b])).toEqual({ [b]: 1 });
  expect(await getClientOpenTicketCounts([a, b, c, d])).toEqual({ [a]: 2, [b]: 1, [c]: 1, [d]: 3 });
  expect(await getClientOpenTicketCounts([a, a])).toEqual({ [a]: 2 });
  expect(await getClientOpenTicketCounts([])).toEqual({});
}, 120_000);
