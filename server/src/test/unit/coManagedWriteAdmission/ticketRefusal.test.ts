import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createFakeKnex, CO_MANAGED_TENANT, clearWriteAdmissionCacheForTests, withReadOnlyWorkspace, type FakeKnex } from './fakeKnex';

const h = vi.hoisted(() => ({ fake: null as any }));
vi.mock('../../../lib/db/db', async (original) => ({ ...(await original<object>()), getConnection: async () => h.fake.knex }));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(), publishWorkflowEvent: vi.fn(), publishStoredWorkflowEvent: vi.fn(),
  publishNonCatalogWorkflowEvent: vi.fn(), publishNonCatalogEventByName: vi.fn(), publishUnregisteredEventType: vi.fn(), publishBuiltWorkflowPayload: vi.fn(),
}));
const ID = '00000000-0000-4000-8000-000000000001';
let fake: FakeKnex;
let ticket: Record<string, unknown>;
beforeEach(() => {
  ticket = { ticket_id: ID, tenant: CO_MANAGED_TENANT, client_id: ID, status_id: ID, title: 'Old', master_ticket_id: null, closed_at: null };
  fake = createFakeKnex((sql, bindings) => {
    if (/^update "tickets"/.test(sql)) {
      ticket = { ...ticket, title: bindings[0] };
      return [ticket];
    }
    return /from "tickets"/.test(sql) ? [{ ...ticket }] : undefined;
  });
  h.fake = fake;
  clearWriteAdmissionCacheForTests();
});
afterEach(async () => { clearWriteAdmissionCacheForTests(); vi.unstubAllEnvs(); await fake.destroy(); });

async function updateThroughController() {
  const { ApiTicketController } = await import('../../../lib/api/controllers/ApiTicketController');
  const controller: any = new ApiTicketController();
  const context = { tenant: CO_MANAGED_TENANT, userId: ID, user: { user_id: ID, user_type: 'internal' }, apiKeyId: ID };
  // Identity and authorization are supplied; the controller, validation, error handler,
  // TicketService, transaction and SQL builder are the production implementations.
  controller.authenticate = async (request: NextRequest) => Object.assign(request, { context });
  controller.checkPermission = async () => undefined;
  controller.assertTicketReadAllowed = async () => undefined;
  controller.service.getKnex = async () => ({ knex: fake.knex, tenant: CO_MANAGED_TENANT });
  return controller.update()(new NextRequest(`http://localhost/api/v1/tickets/${ID}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Renamed' }),
  }));
}

it('the public REST controller returns 423 for the real mutation and writes nothing', async () => {
  const response = await withReadOnlyWorkspace(updateThroughController);
  expect(response.status).toBe(423);
  expect((await response.json()).error.code).toBe('CO_MANAGED_READ_ONLY');
  expect(fake.writes()).toEqual([]);
  expect(ticket.title).toBe('Old');
}, 60_000);

it('the same REST mutation succeeds and commits with the kill switch off', async () => {
  await withReadOnlyWorkspace(async () => {
    expect((await updateThroughController()).status).toBe(423);
    fake.statements.length = 0;
    vi.stubEnv('FORCE_CAPABILITIES', 'co-managed:off');
    const response = await updateThroughController();
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ ticket_id: ID, title: 'Renamed' });
    expect(ticket.title).toBe('Renamed');
    expect(fake.writes().some((sql) => /^update "tickets"/.test(sql))).toBe(true);
    expect(fake.statements.some((sql) => /^commit/i.test(sql))).toBe(true);
    expect(fake.statements.some((sql) => /^rollback/i.test(sql))).toBe(false);
  });
}, 60_000);
