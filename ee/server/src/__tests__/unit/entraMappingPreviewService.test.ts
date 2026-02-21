import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.fn();
const runWithTenantMock = vi.fn();

vi.mock('@/lib/db', () => ({
  createTenantKnex: createTenantKnexMock,
  runWithTenant: runWithTenantMock,
}));

type DiscoveryFixture = {
  managedTenants: Array<Record<string, unknown>>;
  clients: Array<Record<string, unknown>>;
  inboundDomains?: Array<Record<string, unknown>>;
};

function createManagedTenantRow(overrides: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    tenant: 'tenant-preview',
    managed_tenant_id: 'managed-default',
    entra_tenant_id: 'entra-default',
    display_name: 'Default Tenant',
    primary_domain: 'default.example.com',
    source_user_count: 10,
    discovered_at: '2026-02-20T00:00:00.000Z',
    last_seen_at: '2026-02-20T00:00:00.000Z',
    metadata: {},
    created_at: '2026-02-20T00:00:00.000Z',
    updated_at: '2026-02-20T00:00:00.000Z',
    ...overrides,
  };
}

function mockDiscoveryQueries(fixture: DiscoveryFixture) {
  const managedTenantsTable = {
    where: vi.fn(),
    orderByRaw: vi.fn(),
    select: vi.fn(async () => fixture.managedTenants),
  };
  managedTenantsTable.where.mockReturnValue(managedTenantsTable);
  managedTenantsTable.orderByRaw.mockReturnValue(managedTenantsTable);

  const clientsTable = {
    where: vi.fn(),
    select: vi.fn(async () => fixture.clients),
  };
  clientsTable.where.mockReturnValue(clientsTable);

  const inboundDomainTable = {
    where: vi.fn(),
    select: vi.fn(async () => fixture.inboundDomains || []),
  };
  inboundDomainTable.where.mockReturnValue(inboundDomainTable);

  const knexMock = vi.fn((table: string) => {
    if (table === 'entra_managed_tenants') {
      return managedTenantsTable;
    }
    if (table === 'clients') {
      return clientsTable;
    }
    if (table === 'client_inbound_email_domains') {
      return inboundDomainTable;
    }
    throw new Error(`Unexpected table: ${table}`);
  });

  createTenantKnexMock.mockResolvedValue({ knex: knexMock });
}

describe('buildEntraMappingPreview', () => {
  beforeEach(() => {
    vi.resetModules();
    createTenantKnexMock.mockReset();
    runWithTenantMock.mockReset();
    runWithTenantMock.mockImplementation(async (_tenant: string, fn: () => Promise<unknown>) => fn());
  });

  it('T055: places exact-domain matches in autoMatched preview group', async () => {
    mockDiscoveryQueries({
      managedTenants: [
        createManagedTenantRow({
          managed_tenant_id: 'managed-055',
          entra_tenant_id: 'entra-055',
          display_name: 'Contoso Tenant',
          primary_domain: 'contoso.example.com',
        }),
      ],
      clients: [
        {
          client_id: 'client-055',
          client_name: 'Contoso Client',
          url: 'https://contoso.example.com',
          properties: null,
          billing_email: null,
        },
      ],
    });

    const { buildEntraMappingPreview } = await import('@ee/lib/integrations/entra/mapping/mappingPreviewService');
    const result = await buildEntraMappingPreview('tenant-preview');

    expect(result.autoMatched).toHaveLength(1);
    expect(result.autoMatched[0]).toMatchObject({
      managedTenantId: 'managed-055',
      entraTenantId: 'entra-055',
      match: {
        clientId: 'client-055',
        reason: 'exact_domain',
        matchedDomain: 'contoso.example.com',
        confidenceScore: 1,
      },
    });
    expect(result.fuzzyCandidates).toHaveLength(0);
    expect(result.unmatched).toHaveLength(0);
  });

  it('T056: includes secondary-domain matches with expected confidence in candidates', async () => {
    mockDiscoveryQueries({
      managedTenants: [
        createManagedTenantRow({
          managed_tenant_id: 'managed-056',
          entra_tenant_id: 'entra-056',
          display_name: 'Acme Secondary',
          primary_domain: 'billing.acme.example.com',
        }),
      ],
      clients: [
        {
          client_id: 'client-056',
          client_name: 'Acme Client',
          url: 'https://acme.example.com',
          properties: null,
          billing_email: 'ops@billing.acme.example.com',
        },
      ],
    });

    const { buildEntraMappingPreview } = await import('@ee/lib/integrations/entra/mapping/mappingPreviewService');
    const result = await buildEntraMappingPreview('tenant-preview');

    expect(result.autoMatched).toHaveLength(0);
    expect(result.fuzzyCandidates).toHaveLength(1);
    expect(result.fuzzyCandidates[0].candidates[0]).toMatchObject({
      clientId: 'client-056',
      reason: 'secondary_domain',
      matchedDomain: 'billing.acme.example.com',
      confidenceScore: 0.88,
    });
    expect(result.unmatched).toHaveLength(0);
  });

  it('T057: returns fuzzy candidates sorted by score and never auto-confirms them', async () => {
    mockDiscoveryQueries({
      managedTenants: [
        createManagedTenantRow({
          managed_tenant_id: 'managed-057',
          entra_tenant_id: 'entra-057',
          display_name: 'Northwind Managed Services',
          primary_domain: null,
        }),
      ],
      clients: [
        {
          client_id: 'client-057-a',
          client_name: 'Northwind Managed',
          url: null,
          properties: null,
          billing_email: null,
        },
        {
          client_id: 'client-057-b',
          client_name: 'Northwind Services',
          url: null,
          properties: null,
          billing_email: null,
        },
      ],
    });

    const { buildEntraMappingPreview } = await import('@ee/lib/integrations/entra/mapping/mappingPreviewService');
    const result = await buildEntraMappingPreview('tenant-preview');

    expect(result.autoMatched).toHaveLength(0);
    expect(result.fuzzyCandidates).toHaveLength(1);
    const [first, second] = result.fuzzyCandidates[0].candidates;

    expect(first.confidenceScore).toBeGreaterThanOrEqual(second.confidenceScore);
    expect(result.fuzzyCandidates[0].candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'fuzzy_name', autoMatch: false }),
      ])
    );
  });

  it('T058: returns unmatched tenants when no candidate crosses matching thresholds', async () => {
    mockDiscoveryQueries({
      managedTenants: [
        createManagedTenantRow({
          managed_tenant_id: 'managed-058',
          entra_tenant_id: 'entra-058',
          display_name: 'Globex Rare Entity',
          primary_domain: 'globex.rare.example.com',
        }),
      ],
      clients: [
        {
          client_id: 'client-058',
          client_name: 'Initech',
          url: 'https://initech.example.com',
          properties: null,
          billing_email: null,
        },
      ],
    });

    const { buildEntraMappingPreview } = await import('@ee/lib/integrations/entra/mapping/mappingPreviewService');
    const result = await buildEntraMappingPreview('tenant-preview');

    expect(result.autoMatched).toHaveLength(0);
    expect(result.fuzzyCandidates).toHaveLength(0);
    expect(result.unmatched).toHaveLength(1);
    expect(result.unmatched[0]).toMatchObject({
      managedTenantId: 'managed-058',
      entraTenantId: 'entra-058',
      displayName: 'Globex Rare Entity',
    });
  });
});
