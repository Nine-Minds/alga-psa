import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

type ResolverMockState = {
  clientDefault: string | null;
  tenantDefault: string | null;
  ticketClientId: string | null;
  catalog: Record<string, boolean>;
  eligible: Record<string, boolean>;
};

const state: ResolverMockState = {
  clientDefault: null,
  tenantDefault: null,
  ticketClientId: null,
  catalog: {},
  eligible: {},
};

let lastCatalogFilters: Record<string, unknown> | null = null;

const mockHasPermission = vi.fn(async () => true);
const mockGetEligibleContractLines = vi.fn(
  async (_knex: unknown, _tenant: string, _clientId: string, serviceId: string) =>
    state.eligible[serviceId] ? [{ client_contract_line_id: 'line-1' }] : []
);

function makeFacade() {
  return {
    table(name: string) {
      const filters: Record<string, unknown> = {};
      const builder: any = {
        where(next: Record<string, unknown>) {
          Object.assign(filters, next);
          return builder;
        },
        async first() {
          if (name === 'client_billing_settings') {
            return state.clientDefault
              ? { default_time_entry_service_id: state.clientDefault }
              : null;
          }
          if (name === 'default_billing_settings') {
            return state.tenantDefault
              ? { default_time_entry_service_id: state.tenantDefault }
              : null;
          }
          if (name === 'service_catalog') {
            lastCatalogFilters = { ...filters };
            return state.catalog[String(filters.service_id)]
              ? { service_id: filters.service_id }
              : null;
          }
          if (name === 'tickets') {
            return state.ticketClientId ? { client_id: state.ticketClientId } : null;
          }
          return null;
        },
      };
      return builder;
    },
  };
}

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {}, tenant: 'tenant-1' })),
  tenantDb: () => makeFacade(),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: unknown) => fn,
  hasPermission: (...args: unknown[]) => mockHasPermission(...args),
}));

vi.mock('../src/lib/contractLineDisambiguation', () => ({
  getEligibleContractLines: (...args: unknown[]) => mockGetEligibleContractLines(...(args as [unknown, string, string, string])),
}));

const user = { user_id: 'user-1', user_type: 'internal' as const };
const ctx = { tenant: 'tenant-1' };

describe('resolveDefaultTicketTimeEntryService (DB-backed rules)', () => {
  beforeEach(() => {
    state.clientDefault = null;
    state.tenantDefault = null;
    state.ticketClientId = null;
    state.catalog = {};
    state.eligible = {};
    lastCatalogFilters = null;
    (mockHasPermission as Mock).mockReset().mockResolvedValue(true);
    mockGetEligibleContractLines.mockClear();
  });

  it('prefers the valid client default', async () => {
    state.clientDefault = 'service-client';
    state.tenantDefault = 'service-tenant';
    state.catalog = { 'service-client': true, 'service-tenant': true };
    state.eligible = { 'service-client': true, 'service-tenant': true };

    const { resolveDefaultTicketTimeEntryService } = await import('../src/actions/timeEntryServiceDefaults');
    const result = await (resolveDefaultTicketTimeEntryService as any)(user, ctx, { clientId: 'client-1' });

    expect(result).toEqual({ serviceId: 'service-client', source: 'client' });
  });

  it('falls back to the tenant default when the client default is not an active hourly service', async () => {
    state.clientDefault = 'service-stale';
    state.tenantDefault = 'service-tenant';
    state.catalog = { 'service-tenant': true };
    state.eligible = { 'service-tenant': true };

    const { resolveDefaultTicketTimeEntryService } = await import('../src/actions/timeEntryServiceDefaults');
    const result = await (resolveDefaultTicketTimeEntryService as any)(user, ctx, { clientId: 'client-1' });

    expect(result).toEqual({ serviceId: 'service-tenant', source: 'tenant' });
  });

  it('rejects a service that is not applicable to the client', async () => {
    state.clientDefault = 'service-client';
    state.tenantDefault = 'service-tenant';
    state.catalog = { 'service-client': true, 'service-tenant': true };
    state.eligible = { 'service-client': false, 'service-tenant': true };

    const { resolveDefaultTicketTimeEntryService } = await import('../src/actions/timeEntryServiceDefaults');
    const result = await (resolveDefaultTicketTimeEntryService as any)(user, ctx, { clientId: 'client-1' });

    expect(result).toEqual({ serviceId: 'service-tenant', source: 'tenant' });
  });

  it('leaves the service empty when no candidate resolves', async () => {
    state.clientDefault = 'missing-client';
    state.tenantDefault = 'inactive-tenant';
    state.catalog = { 'inactive-tenant': false };
    state.eligible = {};

    const { resolveDefaultTicketTimeEntryService } = await import('../src/actions/timeEntryServiceDefaults');
    const result = await (resolveDefaultTicketTimeEntryService as any)(user, ctx, { clientId: 'client-1' });

    expect(result).toEqual({ serviceId: null, source: null });
  });

  it('checks the time-entry catalog rules (service item, hourly, active)', async () => {
    state.clientDefault = 'service-client';
    state.catalog = { 'service-client': true };
    state.eligible = { 'service-client': true };

    const { resolveDefaultTicketTimeEntryService } = await import('../src/actions/timeEntryServiceDefaults');
    await (resolveDefaultTicketTimeEntryService as any)(user, ctx, { clientId: 'client-1' });

    expect(lastCatalogFilters).toMatchObject({
      service_id: 'service-client',
      item_kind: 'service',
      billing_method: 'hourly',
      is_active: true,
    });
  });

  it('resolves the client from the ticket when no explicit client is given', async () => {
    state.ticketClientId = 'client-from-ticket';
    state.clientDefault = 'service-client';
    state.catalog = { 'service-client': true };
    state.eligible = { 'service-client': true };

    const { resolveDefaultTicketTimeEntryService } = await import('../src/actions/timeEntryServiceDefaults');
    const result = await (resolveDefaultTicketTimeEntryService as any)(user, ctx, {
      workItemId: 'ticket-1',
      workItemType: 'ticket',
    });

    expect(result).toEqual({ serviceId: 'service-client', source: 'client' });
  });

  it('returns no service when the user lacks time-entry read permission', async () => {
    (mockHasPermission as Mock).mockResolvedValueOnce(false);

    const { resolveDefaultTicketTimeEntryService } = await import('../src/actions/timeEntryServiceDefaults');
    const result = await (resolveDefaultTicketTimeEntryService as any)(user, ctx, { clientId: 'client-1' });

    expect(result).toMatchObject({ permissionError: expect.any(String) });
  });
});
