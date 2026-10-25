/**
 * C5: mirroring an RMA's vendor case onto its ticket goes through the REAL `addExternalLink` /
 * `updateExternalLink` path (real DB, real link persistence); only the session, the event bus and the
 * per-record authorization decision are stubbed, and `getRmaCase` is faked because the case row is not what is
 * under test. Run it through scripts/run-workspace-db-tests.mjs (REQUIRE_DB=1, TEST_DB_NAME, DB_USER_ADMIN, DB_PASSWORD_ADMIN).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import knexLib, { type Knex } from 'knex';

const holder = vi.hoisted(() => ({
  knex: undefined as unknown as import('knex').Knex,
  tenant: '',
  user: undefined as any,
  rma: undefined as any,
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: (...a: any[]) => unknown) => (...args: unknown[]) => fn(holder.user, { tenant: holder.tenant }, ...args),
  hasPermission: async () => true,
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async () => true }));
vi.mock('@alga-psa/db', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  createTenantKnex: async () => ({ knex: holder.knex, tenant: holder.tenant }),
  getConnection: async () => holder.knex,
  withTransaction: (db: Knex, fn: (trx: Knex.Transaction) => Promise<unknown>) => db.transaction(fn),
}));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(), publishWorkflowEvent: vi.fn(async () => undefined), publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined), publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined), publishUnregisteredEventType: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/event-bus', () => ({ getEventBus: vi.fn(() => ({ publish: vi.fn() })), ServerEventPublisher: class {} }));
vi.mock('@alga-psa/authorization/bundles/service', () => ({ resolveBundleNarrowingRulesForEvaluation: async () => [] }));
vi.mock('@alga-psa/authorization/kernel', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  createAuthorizationKernel: () => ({ authorizeResource: async () => ({ allowed: true }) }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@alga-psa/inventory/actions', () => ({ getRmaCase: async () => holder.rma, openWarrantyClaim: vi.fn() }));

import { mirrorRmaToTicketLinks } from '../rmaTicketActions';

let knex: Knex;
let ticketId: string;
const rmaId = randomUUID();

const connection = (): Knex.PgConnectionConfig => {
  const { TEST_DB_NAME: database, DB_USER_ADMIN: user, DB_PASSWORD_ADMIN: password } = process.env;
  if (process.env.REQUIRE_DB !== '1' || !database || !user || !password) {
    throw new Error('DB tests require REQUIRE_DB=1, TEST_DB_NAME, DB_USER_ADMIN and DB_PASSWORD_ADMIN');
  }
  return { host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432), user, password, database };
};

beforeAll(async () => {
  process.env.NEXTAUTH_URL = 'https://psa.example.test';
  knex = knexLib({ client: 'pg', connection: connection(), pool: { min: 1, max: 4 } });
  holder.knex = knex;
  const tenant = randomUUID(); const userId = randomUUID(); const clientId = randomUUID();
  const boardId = randomUUID(); const statusId = randomUUID(); const priorityId = randomUUID();
  ticketId = randomUUID();
  await knex.transaction(async (trx) => {
    await trx('tenants').insert({ tenant, client_name: `RMA mirror ${tenant}`, email: `mirror-${tenant}@example.invalid`, product_code: 'psa' });
    await trx('users').insert({ tenant, user_id: userId, username: `mirror-${tenant}`, email: `op-${tenant}@example.invalid`, hashed_password: 'x', user_type: 'internal', first_name: 'Mirror', last_name: 'Operator' });
    await trx('clients').insert({ tenant, client_id: clientId, client_name: 'Mirror customer', billing_cycle: 'monthly', billing_email: `b-${tenant}@example.invalid` });
    await trx('boards').insert({ tenant, board_id: boardId, board_name: 'Mirror board', is_default: true });
    await trx('statuses').insert({ tenant, board_id: boardId, status_id: statusId, name: 'Open', status_type: 'ticket', order_number: 1, is_closed: false });
    await trx('priorities').insert({ tenant, priority_id: priorityId, priority_name: 'Normal', created_by: userId, order_number: 1 });
    await trx('tickets').insert({ tenant, ticket_id: ticketId, ticket_number: `MIR-${tenant}`, title: 'Dell dock', client_id: clientId, board_id: boardId, status_id: statusId, priority_id: priorityId, entered_by: userId });
  });
  holder.tenant = tenant;
  holder.user = { user_id: userId, user_type: 'internal', first_name: 'Mirror', last_name: 'Operator', username: `mirror-${tenant}` };
});
afterAll(async () => { await knex?.destroy(); });
beforeEach(() => {
  holder.rma = { rma_id: rmaId, rma_number: 'RMA-00007', ticket_id: ticketId, rma_reference: 'DELL-7788', status: 'sent_to_vendor', vendor_name: 'Dell' };
});

const links = () => knex('external_entity_links').where({ tenant: holder.tenant, ticket_id: ticketId });

describe('mirrorRmaToTicketLinks (real external-link persistence)', () => {
  it('adds one generic link carrying the RMA record URL, and a second call upserts instead of adding another', async () => {
    const first: any = await mirrorRmaToTicketLinks(rmaId);
    expect(first.actionError ?? first.permissionError, JSON.stringify(first)).toBeUndefined();
    expect(first.link_id).toBeTruthy();

    let rows = await links();
    expect(rows).toHaveLength(1);
    expect(rows[0].external_id).toBe('DELL-7788');
    expect(rows[0].system).toBe('generic');
    expect(rows[0].metadata.rma_id).toBe(rmaId);
    expect(rows[0].url).toBe(`https://psa.example.test/msp/inventory/rma?rmaId=${rmaId}`);
    expect(rows[0].external_status).toBe('sent_to_vendor');

    holder.rma = { ...holder.rma, status: 'received' };
    const second: any = await mirrorRmaToTicketLinks(rmaId);
    expect(second.link_id).toBe(first.link_id);
    rows = await links();
    expect(rows).toHaveLength(1);
    expect(rows[0].external_status).toBe('received');
  });

  it('replaces the link when the vendor case number changed, still leaving exactly one row', async () => {
    holder.rma = { ...holder.rma, rma_reference: 'DELL-9999' };
    const result: any = await mirrorRmaToTicketLinks(rmaId);
    expect(result.actionError ?? result.permissionError, JSON.stringify(result)).toBeUndefined();
    const rows = await links();
    expect(rows).toHaveLength(1);
    expect(rows[0].external_id).toBe('DELL-9999');
    expect(rows[0].metadata.rma_id).toBe(rmaId);
  });

  it('another RMA on the same ticket gets its own link', async () => {
    const otherId = randomUUID();
    holder.rma = { ...holder.rma, rma_id: otherId, rma_number: 'RMA-00008', rma_reference: 'DELL-1234' };
    await mirrorRmaToTicketLinks(otherId);
    expect(await links()).toHaveLength(2);
  });
});
