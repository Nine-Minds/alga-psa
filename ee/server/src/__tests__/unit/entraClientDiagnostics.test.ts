// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const hoisted = vi.hoisted(() => {
  const mapping = (clientId: string, entraTenantId: string) => ({
    managedTenantId: `managed-${clientId}`,
    entraTenantId,
    clientId,
    clientName: `Client ${clientId}`,
    displayName: `Tenant ${clientId}`,
    primaryDomain: `${clientId}.example`,
    sourceUserCount: 3,
    userCount: 3,
    userCountSource: 'discovery' as const,
    userCountObservedAt: null,
    lastSyncedAt: null,
    lastRunStatus: null,
  });
  return {
    mapping,
    connectionType: 'direct' as 'direct' | 'cipp',
    connection: {
      tenant: 'tenant-1',
      connection_id: 'conn-1',
      connection_type: 'direct',
      status: 'connected',
      is_active: true,
    },
    mappings: [mapping('c1', 'entra-1'), mapping('c2', 'entra-2')],
    mintError: null as any,
    users: [] as any[],
    filterResult: { included: [], excluded: [] } as any,
    cippUsers: [] as any[],
    cippError: null as any,
  };
});

vi.mock('@ee/lib/integrations/entra/connectionRepository', () => ({
  getActiveEntraPartnerConnection: vi.fn(async () => ({
    ...hoisted.connection,
    connection_type: hoisted.connectionType,
  })),
  updateEntraConnectionValidation: vi.fn(),
}));

vi.mock('@ee/lib/integrations/entra/mapping/confirmedMappingsService', () => ({
  listConfirmedEntraMappings: vi.fn(async () => hoisted.mappings),
  listConfirmedEntraMappingsWithDb: vi.fn(async () => hoisted.mappings),
}));

vi.mock('@ee/lib/integrations/entra/auth/refreshDirectToken', () => ({
  refreshEntraDirectToken: vi.fn(),
  refreshEntraDirectAccessTokenForTenant: vi.fn(async (_tenant: string, authority: string) => {
    if (hoisted.mintError && authority === hoisted.mintError.authority) {
      throw hoisted.mintError.error;
    }
    return {
      accessToken: 'customer-token',
      refreshToken: 'refresh-token',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      scope: 'Directory.Read.All',
    };
  }),
}));

vi.mock('@ee/lib/integrations/entra/auth/microsoftCredentialResolver', () => ({
  resolveMicrosoftCredentialsForTenant: vi.fn(async () => ({
    clientId: 'app-1',
    clientSecret: 's',
    tenantId: 'partner',
    source: 'profile',
    profileId: 'p',
    profileDisplayName: 'App',
  })),
}));

vi.mock('@ee/lib/integrations/entra/providers/direct/directProviderAdapter', () => ({
  DirectProviderAdapter: class {
    async listUsersForTenantWithToken() {
      return { users: hoisted.users, pages: 1, truncated: false };
    }
  },
  createDirectProviderAdapter: () => ({ listManagedTenants: async () => [] }),
}));

vi.mock('@ee/lib/integrations/entra/providers/cipp/cippProviderAdapter', () => ({
  CippProviderAdapter: class {
    async listUsersForTenant() {
      if (hoisted.cippError) throw hoisted.cippError;
      return hoisted.cippUsers;
    }
  },
}));

vi.mock('@ee/lib/integrations/entra/providers/cipp/cippSecretStore', () => ({
  getEntraCippCredentials: vi.fn(async () => ({ baseUrl: 'https://cipp.test', apiToken: 'k' })),
}));

vi.mock('@ee/lib/integrations/entra/settingsService', () => ({
  filterEntraUsersForTenant: vi.fn(async () => hoisted.filterResult),
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: vi.fn(() => ({ table: () => ({ where: () => ({ first: async () => undefined }) }) })),
  createTenantKnex: vi.fn(async () => ({ knex: {}, tenant: 'tenant-1' })),
}));

vi.mock('axios', () => {
  const isAxiosError = (e: any) => Boolean(e?.isAxiosError);
  const get = vi.fn(async (url: string) => {
    if (url.includes('/users?')) {
      return { status: 200, data: { value: [{ id: 'u1' }] }, headers: { 'request-id': 'rid-u' } };
    }
    if (url.includes('/groups?')) {
      return { status: 200, data: { value: [{ id: 'g1' }] }, headers: {} };
    }
    return { status: 200, data: {}, headers: {} };
  });
  const post = vi.fn(async () => ({ data: { value: [] } }));
  return { default: { get, post, isAxiosError }, get, post, isAxiosError };
});

import { runEntraClientAccessDiagnostics } from '@ee/lib/integrations/entra/diagnostics/clientDiagnostics';
import { signContinuation } from '@ee/lib/integrations/entra/diagnostics/continuation';

const SECRET = 'client-test-signing-secret-1234';

describe('runEntraClientAccessDiagnostics', () => {
  beforeEach(() => {
    process.env.ENTRA_DIAGNOSTICS_JOB_SECRET = SECRET;
    hoisted.connectionType = 'direct';
    hoisted.mappings = [hoisted.mapping('c1', 'entra-1'), hoisted.mapping('c2', 'entra-2')];
    hoisted.mintError = null;
    hoisted.users = [
      { entraObjectId: 'u1', email: 'alice@c1.example', userPrincipalName: 'alice@c1.example', accountEnabled: true },
    ];
    hoisted.filterResult = { included: hoisted.users, excluded: [] };
    hoisted.cippError = null;
    hoisted.cippUsers = [];
    vi.clearAllMocks();
  });

  afterAll(() => {
    delete process.env.ENTRA_DIAGNOSTICS_JOB_SECRET;
  });

  it('returns empty explicitly and never defaults an empty selection to all', async () => {
    const result = await runEntraClientAccessDiagnostics('tenant-1', 'user-1', { clientIds: [] });
    expect(result.total).toBe(0);
    expect(result.isDone).toBe(true);
    expect(result.clients).toEqual([]);
  });

  it('isolates a customer consent failure while another client succeeds', async () => {
    hoisted.mintError = {
      authority: 'entra-2',
      error: Object.assign(new Error('invalid_grant AADSTS65001 consent_required'), {
        aadstsCode: 'AADSTS65001',
      }),
    };
    const result = await runEntraClientAccessDiagnostics('tenant-1', 'user-1', {
      clientIds: ['c1', 'c2'],
    });
    expect(result.isDone).toBe(true);
    expect(result.completed).toBe(2);

    const c1 = result.clients.find((c) => c.clientId === 'c1');
    const c2 = result.clients.find((c) => c.clientId === 'c2');
    expect(c1?.overallStatus).toBe('pass');
    expect(c2?.category).toBe('need_consent');

    const consentAction = c2?.steps
      .flatMap((s) => s.recommendations ?? [])
      .find((r) => r.code === 'customer_consent_required')?.action;
    expect(consentAction?.payload).toBe(
      'https://login.microsoftonline.com/entra-2/adminconsent?client_id=app-1'
    );
    expect(result.aggregate.need_consent).toBe(1);
  });

  it('rejects a continuation whose selected mapping changed', async () => {
    const selection = hoisted.mappings.map((m) => ({
      clientId: m.clientId,
      managedTenantId: m.managedTenantId,
      entraTenantId: m.entraTenantId,
    }));
    const continuation = signContinuation({
      v: 1,
      tenant: 'tenant-1',
      userId: 'user-1',
      scope: 'clients',
      connectionType: 'direct',
      connectionId: 'conn-1',
      selection,
      includeUserYield: false,
      offset: 0,
      total: 2,
      results: [],
      exp: Date.now() + 60_000,
    });

    // The mapping now points at a different Entra tenant.
    hoisted.mappings = [hoisted.mapping('c1', 'entra-CHANGED'), hoisted.mapping('c2', 'entra-2')];

    const result = await runEntraClientAccessDiagnostics('tenant-1', 'user-1', { continuation });
    expect(result.error).toMatch(/changed or were removed/);
    expect(result.clients).toEqual([]);
  });

  it('rejects a continuation bound to a different connection id', async () => {
    const continuation = signContinuation({
      v: 1,
      tenant: 'tenant-1',
      userId: 'user-1',
      scope: 'clients',
      connectionType: 'direct',
      connectionId: 'other-connection',
      selection: [{ clientId: 'c1', managedTenantId: 'managed-c1', entraTenantId: 'entra-1' }],
      includeUserYield: false,
      offset: 0,
      total: 1,
      results: [],
      exp: Date.now() + 60_000,
    });
    const result = await runEntraClientAccessDiagnostics('tenant-1', 'user-1', { continuation });
    expect(result.error).toMatch(/reconnected/);
  });

  it('rejects a continuation for a different user', async () => {
    const continuation = signContinuation({
      v: 1,
      tenant: 'tenant-1',
      userId: 'someone-else',
      scope: 'clients',
      connectionType: 'direct',
      connectionId: 'conn-1',
      selection: [{ clientId: 'c1', managedTenantId: 'managed-c1', entraTenantId: 'entra-1' }],
      includeUserYield: false,
      offset: 0,
      total: 1,
      results: [],
      exp: Date.now() + 60_000,
    });
    const result = await runEntraClientAccessDiagnostics('tenant-1', 'user-1', { continuation });
    expect(result.error).toMatch(/invalid or has expired/);
  });

  it('classifies a CIPP credential rejection with a CIPP remedy, not GDAP', async () => {
    hoisted.connectionType = 'cipp';
    hoisted.cippError = Object.assign(new Error('CIPP rejected the API credential.'), {
      code: 'credential-rejected',
    });
    const result = await runEntraClientAccessDiagnostics('tenant-1', 'user-1', { clientIds: ['c1'] });
    const client = result.clients[0];
    expect(client.category).toBe('other');
    const rec = client.steps.flatMap((s) => s.recommendations ?? [])[0];
    expect(rec?.code).toBe('cipp_auth_rejected');
    expect(rec?.text).toMatch(/CIPP API/);
    expect(rec?.text).not.toMatch(/GDAP/);
  });

  it('records every exclusion category and warns when all users are excluded', async () => {
    hoisted.users = [
      { entraObjectId: 'u1', email: 'a@c1.example' },
      { entraObjectId: 'u2', email: 'b@c1.example' },
    ];
    hoisted.filterResult = {
      included: [],
      excluded: [
        { reason: 'account_disabled', user: { entraObjectId: 'u1' } },
        { reason: 'service_account', user: { entraObjectId: 'u2' } },
        { reason: 'tenant_custom_pattern', user: { entraObjectId: 'u2' } },
      ],
    };
    const result = await runEntraClientAccessDiagnostics('tenant-1', 'user-1', {
      clientIds: ['c1'],
      includeUserYield: true,
    });
    const client = result.clients[0];
    const yieldStep = client.steps.find((s) => s.id === 'user_yield_preview');
    expect(yieldStep?.status).toBe('warn');
    expect((yieldStep?.data as any)?.excludedByReason).toEqual({
      account_disabled: 1,
      service_account: 1,
      tenant_custom_pattern: 1,
    });
    expect(client.category).toBe('other');
    expect(result.overallStatus).toBe('warn');
  });
});
