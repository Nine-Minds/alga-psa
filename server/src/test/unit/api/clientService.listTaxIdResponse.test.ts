import { describe, expect, it, vi } from 'vitest';

// Client-scope narrowing and the create gate are covered by the S18 integration test; this suite has no subject to resolve.
vi.mock('@alga-psa/authorization/clientScopeAuthorization', () => ({ createClientScopeContext: async () => ({ narrowing: async () => ({ narrowed: false, apply: (query: unknown) => query }), permits: async () => true }) }));

// The billing-column projection has its own DB suite (coManagedSeatCommercialLookups); these rows carry no billing column.
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));

const listRows = [{
  client_id: '11111111-1111-4111-8111-111111111111',
  client_name: 'Acme',
  tax_id_number: 'canonical',
  client_since: new Date(2021, 4, 17),
  properties: { tax_id: 'legacy', industry: 'IT' },
}];

function fakeQuery(result: unknown) {
  const query: any = {
    orderBy: () => query,
    limit: () => query,
    offset: () => query,
    select: () => query,
    count: () => Promise.resolve([{ count: '1' }]),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return query;
}

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return {
    ...actual,
    withTransaction: (_knex: unknown, callback: (trx: unknown) => Promise<unknown>) =>
      callback({ raw: (sql: string) => sql }),
    tenantDb: () => ({
      table: () => fakeQuery(listRows),
      tenantJoin: () => undefined,
      tenantJoinFirstMatching: () => undefined,
    }),
  };
});

// The chip-tag hydration runs a real tag_mappings join the fake query builders here cannot serve.
vi.mock('@alga-psa/tags/lib/loadDisplayTags', () => ({
  loadDisplayTagsForEntities: vi.fn(async () => new Map()),
  displayTagKey: (taggedType: string, id: string) => `${taggedType}:${id}`,
}));

vi.mock('@alga-psa/formatting/avatarUtils', () => ({
  getClientLogoUrl: vi.fn().mockResolvedValue('https://logo.example/acme.png'),
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

describe('ClientService.list response rows', () => {
  it('keeps the canonical Tax ID, drops legacy properties.tax_id and returns client_since as a date string', async () => {
    const { ClientService } = await import('../../../lib/api/services/ClientService');
    const service = new ClientService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: {} });
    vi.spyOn(service as any, 'applyClientFilters').mockImplementation((query: unknown) => query);

    const result = await service.list({ page: 1, limit: 25 } as any, { tenant: 'tenant-1' } as any);

    expect(result.total).toBe(1);
    expect(result.data).toEqual([{
      client_id: '11111111-1111-4111-8111-111111111111',
      client_name: 'Acme',
      tax_id_number: 'canonical',
      client_since: '2021-05-17',
      properties: { industry: 'IT' },
      logoUrl: 'https://logo.example/acme.png',
      display_tags: [],
    }]);
  });
});
