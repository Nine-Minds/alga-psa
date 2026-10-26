/**
 * REST clients: lifecycle_status is accepted and persisted on create and update,
 * and an API-driven transition emits CLIENT_STATUS_CHANGED like the web action.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const UPDATED_AT = '2026-10-13T12:00:00.000Z';

const existingClient = {
  client_id: CLIENT_ID,
  client_name: 'Acme',
  url: 'https://acme.example',
  is_inactive: false,
  lifecycle_status: 'active',
  properties: { industry: 'IT', website: 'https://acme.example' },
};

const inserts: Array<Record<string, unknown>> = [];
const updates: Array<Record<string, unknown>> = [];

function fakeTable(name: string) {
  if (name === 'tenants') {
    return { first: () => Promise.resolve({ product_code: 'psa' }) };
  }
  // Read by the shared creation seam to adopt the tenant's default currency.
  if (name === 'default_billing_settings') {
    return { select: () => ({ first: () => Promise.resolve({ default_currency_code: 'USD' }) }) };
  }
  const query: any = {
    where: () => query,
    first: () => Promise.resolve(existingClient),
    insert: (data: Record<string, unknown>) => {
      inserts.push(data);
      return {
        returning: () => Promise.resolve([{ ...data, client_id: CLIENT_ID, created_at: UPDATED_AT }]),
      };
    },
    update: (data: Record<string, unknown>) => {
      updates.push(data);
      return {
        returning: () => Promise.resolve([{ ...existingClient, ...data, updated_at: UPDATED_AT }]),
      };
    },
  };
  return query;
}

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return {
    ...actual,
    withTransaction: (_knex: unknown, callback: (trx: unknown) => Promise<unknown>) => callback({}),
    tenantDb: () => ({ table: (name: string) => fakeTable(name) }),
  };
});

// The shared client-creation seam (shared/models/clientCreation.ts) imports
// tenantDb from this subpath, not the barrel above, so it falls through to
// the real tenantDb against the bare fake trx ({}) without this mock,
// throwing "conn is not a function".
vi.mock('@alga-psa/db/tenantDb', () => ({
  tenantDb: () => ({ table: (name: string) => fakeTable(name) }),
}));

vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishWorkflowEvent: vi.fn().mockResolvedValue(undefined),
  publishEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/shared/billingClients/billingProfiles', () => ({
  ensureClientDefaultBillingProfile: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/shared/billingClients/defaultContract', () => ({
  ensureDefaultContractForClientIfBillingConfigured: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/shared/billingClients/defaultTaxRate', () => ({
  initializeClientDefaultTax: vi.fn(async () => undefined),
}));

async function newService() {
  const { ClientService } = await import('../../../lib/api/services/ClientService');
  const service = new ClientService();
  vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: { raw: (sql: string) => sql } });
  return service;
}

async function statusChangedEvents() {
  const { publishWorkflowEvent } = await import('server/src/lib/eventBus/publishers');
  return (publishWorkflowEvent as any).mock.calls
    .map(([call]: [any]) => call)
    .filter((call: any) => call.eventType === 'CLIENT_STATUS_CHANGED');
}

describe('ClientService lifecycle_status', () => {
  beforeEach(async () => {
    inserts.length = 0;
    updates.length = 0;
    const { publishWorkflowEvent } = await import('server/src/lib/eventBus/publishers');
    (publishWorkflowEvent as any).mockClear();
  });

  it('persists a lifecycle_status supplied on create', async () => {
    const service = await newService();
    await service.create(
      { client_name: 'Prospect Co', billing_cycle: 'monthly', lifecycle_status: 'prospect' } as any,
      { tenant: 'tenant-1' } as any,
    );

    expect(inserts).toHaveLength(1);
    expect(inserts[0].lifecycle_status).toBe('prospect');
  });

  it('defaults lifecycle_status to active when create omits it', async () => {
    const service = await newService();
    await service.create(
      { client_name: 'Acme', billing_cycle: 'monthly' } as any,
      { tenant: 'tenant-1' } as any,
    );

    expect(inserts[0].lifecycle_status).toBe('active');
  });

  it('writes lifecycle_status on update and publishes CLIENT_STATUS_CHANGED once', async () => {
    const service = await newService();
    await service.update(CLIENT_ID, { lifecycle_status: 'prospect' } as any, { tenant: 'tenant-1' } as any);

    expect(updates).toHaveLength(1);
    expect(updates[0].lifecycle_status).toBe('prospect');

    const events = await statusChangedEvents();
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      clientId: CLIENT_ID,
      previousStatus: 'active',
      newStatus: 'prospect',
    });
    expect(events[0].idempotencyKey).toBe(`client_lifecycle_status_changed:${CLIENT_ID}:${UPDATED_AT}`);
  });

  it('leaves lifecycle_status untouched and silent when the update omits it', async () => {
    const service = await newService();
    await service.update(CLIENT_ID, { client_name: 'Acme Renamed' } as any, { tenant: 'tenant-1' } as any);

    expect(updates[0]).not.toHaveProperty('lifecycle_status');
    expect(await statusChangedEvents()).toHaveLength(0);
  });
});

describe('client write schemas lifecycle_status', () => {
  it('accepts the three lifecycle values and rejects anything else', async () => {
    const { createClientSchema, updateClientSchema } = await import('../../../lib/api/schemas/client');

    expect(createClientSchema.safeParse({ client_name: 'Acme', billing_cycle: 'monthly', lifecycle_status: 'prospect' }).success).toBe(true);
    expect(createClientSchema.safeParse({ client_name: 'Acme', billing_cycle: 'monthly', lifecycle_status: 'zzz_invalid' }).success).toBe(false);
    expect(updateClientSchema.parse({ lifecycle_status: 'former' })).toEqual({ lifecycle_status: 'former' });
    expect(updateClientSchema.safeParse({ lifecycle_status: 'zzz_invalid' }).success).toBe(false);
  });
});
