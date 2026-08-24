import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ADD_ONS } from '@alga-psa/types';

const getAdminConnectionMock = vi.fn();
const getTenantIdBySlugMock = vi.fn();
const tableAccess: string[] = [];

const tables = {
  teams_integrations: [] as Array<Record<string, unknown>>,
  clients: [] as Array<Record<string, unknown>>,
};

function applyFilter(rows: Array<Record<string, unknown>>, a: unknown, b?: unknown) {
  if (typeof a === 'string') {
    const col = a.includes('.') ? a.split('.').pop()! : a;
    // Staged integration rows model unarchived profiles already flattened
    // into the joined SELECT shape.
    if (col === 'is_archived') {
      return rows;
    }
    if (col === 'tenant_id') {
      return rows.filter((row) => row.microsoft_tenant_id === b);
    }
    return rows.filter((row) => row[col] === b);
  }
  return rows.filter((row) =>
    Object.entries(a as Record<string, unknown>).every(([key, value]) => row[key] === value)
  );
}

function createBuilder(initialRows: Array<Record<string, unknown>>) {
  let rows = [...initialRows];
  const builder: any = {
    select: () => builder,
    limit: (count: number) => {
      rows = rows.slice(0, count);
      return builder;
    },
    where: (a: unknown, b?: unknown) => {
      rows = applyFilter(rows, a, b);
      return builder;
    },
    andWhere: (a: unknown, b?: unknown) => {
      rows = applyFilter(rows, a, b);
      return builder;
    },
    first: async () => rows[0],
    then: (resolve: any, reject: any) => Promise.resolve([...rows]).then(resolve, reject),
  };
  return builder;
}

function createConn() {
  return (tableRef: string, tenant: string | null) => {
    const name = tableRef.split(' ')[0] as keyof typeof tables;
    tableAccess.push(name);
    const rows = (tables[name] ?? []).filter((row) => tenant == null || row.tenant === tenant);
    return createBuilder(rows);
  };
}

vi.mock('@alga-psa/db', () => ({
  getAdminConnection: (...args: unknown[]) => getAdminConnectionMock(...args),
  getTenantIdBySlug: (...args: unknown[]) => getTenantIdBySlugMock(...args),
  tenantDb: (conn: any, tenant: string) => ({
    table: (t: string) => conn(t, tenant),
    unscoped: (t: string, reason: string) => {
      if (!reason) {
        throw new Error('tenantDb.unscoped requires a reason');
      }
      return conn(t, null);
    },
    tenantJoin: (q: any) => q,
  }),
}));

const { discoverTeamsClientTenantByEntraTenantId, resolveTeamsTenantContext } = await import(
  '../../../../../../ee/server/src/lib/teams/resolveTeamsTenantContext'
);

function integrationRow(overrides: Record<string, unknown> = {}) {
  return {
    tenant: 'tenant-1',
    install_status: 'active',
    enabled_capabilities: ['personal_bot', 'guest_ticket_submission'],
    app_id: 'app-1',
    bot_id: 'bot-1',
    microsoft_tenant_id: 'msp-tid',
    active_teams_addon: ADD_ONS.TEAMS,
    ...overrides,
  };
}

function clientRow(overrides: Record<string, unknown> = {}) {
  return {
    tenant: 'tenant-1',
    client_id: 'client-1',
    client_name: 'Contoso Ltd',
    entra_tenant_id: 'customer-tid',
    is_inactive: false,
    ...overrides,
  };
}

describe('discoverTeamsClientTenantByEntraTenantId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tables.teams_integrations.length = 0;
    tables.clients.length = 0;
    tableAccess.length = 0;
    getAdminConnectionMock.mockResolvedValue(createConn());
    getTenantIdBySlugMock.mockResolvedValue(null);
  });

  it('returns the owning tenant and client when exactly one active client claims the tid', async () => {
    tables.clients.push(clientRow());

    await expect(discoverTeamsClientTenantByEntraTenantId('customer-tid')).resolves.toEqual({
      tenant: 'tenant-1',
      clientId: 'client-1',
    });
  });

  it('returns null for a blank tid without touching the database', async () => {
    tables.clients.push(clientRow());

    await expect(discoverTeamsClientTenantByEntraTenantId('')).resolves.toBeNull();
    await expect(discoverTeamsClientTenantByEntraTenantId(null)).resolves.toBeNull();
    await expect(discoverTeamsClientTenantByEntraTenantId(undefined)).resolves.toBeNull();
    expect(tableAccess).toHaveLength(0);
  });

  it('returns null when no client claims the tid', async () => {
    tables.clients.push(clientRow({ entra_tenant_id: 'other-tid' }));

    await expect(discoverTeamsClientTenantByEntraTenantId('customer-tid')).resolves.toBeNull();
  });

  it('returns null when two clients of the same tenant claim the tid', async () => {
    tables.clients.push(clientRow(), clientRow({ client_id: 'client-2' }));

    await expect(discoverTeamsClientTenantByEntraTenantId('customer-tid')).resolves.toBeNull();
  });

  it('returns null when clients of different PSA tenants claim the tid', async () => {
    tables.clients.push(clientRow(), clientRow({ tenant: 'tenant-2', client_id: 'client-9' }));

    await expect(discoverTeamsClientTenantByEntraTenantId('customer-tid')).resolves.toBeNull();
  });

  it('ignores inactive clients', async () => {
    tables.clients.push(clientRow({ is_inactive: true }));
    await expect(discoverTeamsClientTenantByEntraTenantId('customer-tid')).resolves.toBeNull();

    tables.clients.push(clientRow({ client_id: 'client-2' }));
    await expect(discoverTeamsClientTenantByEntraTenantId('customer-tid')).resolves.toEqual({
      tenant: 'tenant-1',
      clientId: 'client-2',
    });
  });
});

describe('resolveTeamsTenantContext client-tenant fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tables.teams_integrations.length = 0;
    tables.clients.length = 0;
    tableAccess.length = 0;
    getAdminConnectionMock.mockResolvedValue(createConn());
    getTenantIdBySlugMock.mockResolvedValue(null);
  });

  it('resolves the client tenant from the verified sender tid and carries the matched client id', async () => {
    tables.teams_integrations.push(integrationRow());
    tables.clients.push(clientRow());

    await expect(
      resolveTeamsTenantContext({
        microsoftTenantId: 'customer-tid',
        verifiedSenderMicrosoftTenantId: 'customer-tid',
        requiredCapability: 'personal_bot',
      })
    ).resolves.toEqual({
      status: 'resolved',
      tenantId: 'tenant-1',
      installStatus: 'active',
      enabledCapabilities: ['personal_bot', 'guest_ticket_submission'],
      appId: 'app-1',
      botId: 'bot-1',
      microsoftTenantId: 'msp-tid',
      entraMatchedClientId: 'client-1',
    });
  });

  it('never runs client discovery from a body-derived tid alone', async () => {
    tables.teams_integrations.push(integrationRow());
    tables.clients.push(clientRow());

    const resolution = await resolveTeamsTenantContext({
      microsoftTenantId: 'customer-tid',
      requiredCapability: 'personal_bot',
    });

    expect(resolution.status).toBe('not_configured');
    expect(tableAccess).not.toContain('clients');
  });

  it('keeps unresolved behavior when the tid is claimed by more than one client', async () => {
    tables.teams_integrations.push(integrationRow());
    tables.clients.push(clientRow(), clientRow({ tenant: 'tenant-2', client_id: 'client-9' }));

    const resolution = await resolveTeamsTenantContext({
      microsoftTenantId: 'customer-tid',
      verifiedSenderMicrosoftTenantId: 'customer-tid',
      requiredCapability: 'personal_bot',
    });

    expect(resolution.status).toBe('not_configured');
  });

  it('keeps the direct MSP-tenant match without any client attribution', async () => {
    tables.teams_integrations.push(integrationRow());
    tables.clients.push(clientRow());

    const resolution = await resolveTeamsTenantContext({
      microsoftTenantId: 'msp-tid',
      verifiedSenderMicrosoftTenantId: 'msp-tid',
      requiredCapability: 'personal_bot',
    });

    expect(resolution.status).toBe('resolved');
    expect(resolution).not.toHaveProperty('entraMatchedClientId');
    expect(tableAccess).not.toContain('clients');
  });

  it('stays unresolved when the discovered tenant has no eligible Teams integration', async () => {
    tables.teams_integrations.push(integrationRow({ install_status: 'install_pending' }));
    tables.clients.push(clientRow());

    const resolution = await resolveTeamsTenantContext({
      microsoftTenantId: 'customer-tid',
      verifiedSenderMicrosoftTenantId: 'customer-tid',
      requiredCapability: 'personal_bot',
    });

    expect(resolution.status).toBe('not_configured');
  });

  it('stays unresolved when the discovered tenant lacks the required capability', async () => {
    tables.teams_integrations.push(integrationRow({ enabled_capabilities: ['personal_tab'] }));
    tables.clients.push(clientRow());

    const resolution = await resolveTeamsTenantContext({
      microsoftTenantId: 'customer-tid',
      verifiedSenderMicrosoftTenantId: 'customer-tid',
      requiredCapability: 'personal_bot',
    });

    expect(resolution.status).toBe('not_configured');
  });

  it('rejects a discovered tenant that contradicts an explicit tenant hint', async () => {
    tables.teams_integrations.push(integrationRow());
    tables.clients.push(clientRow());

    const resolution = await resolveTeamsTenantContext({
      explicitTenantId: 'tenant-2',
      microsoftTenantId: 'customer-tid',
      verifiedSenderMicrosoftTenantId: 'customer-tid',
      requiredCapability: 'personal_bot',
    });

    expect(resolution.status).toBe('not_configured');
  });
});
