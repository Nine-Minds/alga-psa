// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';

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
    filterResult: { included: [], excluded: [], unknownFieldCounts: { userType: 0, assignedLicenseCount: 0 }, deactivateExcludedContacts: false, groupMembershipResolver: { isMember: async () => false } } as any,
    cippUsers: [] as any[],
    cippError: null as any,
    pageNextLink: null as string | null,
    pageError: null as any,
    pageRead: vi.fn(),
    usersGetError: null as any,
    groupsGetError: null as any,
    groupByIdGetError: null as any,
    membershipPostError: null as any,
    portalConfig: null as any,
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

vi.mock('../../lib/integrations/entra/settingsService', () => ({
  filterEntraUsersForManagedTenant: vi.fn(async () => hoisted.filterResult),
  resolveEntraUserFilterPolicy: vi.fn(async () => ({})),
}));

vi.mock('@ee/lib/integrations/entra/settingsService', () => ({
  filterEntraUsersForManagedTenant: vi.fn(async () => hoisted.filterResult),
  resolveEntraUserFilterPolicy: vi.fn(async () => ({})),
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
    async listUsersPageWithToken(input: any) {
      const scripted = await hoisted.pageRead(input);
      if (scripted) return scripted;
      if (hoisted.pageError) throw hoisted.pageError;
      return { users: hoisted.users, nextLink: hoisted.pageNextLink ?? null };
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

vi.mock('@ee/lib/integrations/entra/sync/userFilterPipeline', () => ({
  filterEntraUsers: vi.fn(() => hoisted.filterResult),
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: vi.fn(() => ({
    table: () => ({ where: () => ({ first: async () => hoisted.portalConfig }) }),
  })),
  createTenantKnex: vi.fn(async () => ({ knex: {}, tenant: 'tenant-1' })),
}));

vi.mock('axios', () => {
  const isAxiosError = (e: any) => Boolean(e?.isAxiosError);
  const get = vi.fn(async (url: string) => {
    if (url.includes('/users?')) {
      if (hoisted.usersGetError) throw hoisted.usersGetError;
      return { status: 200, data: { value: [{ id: 'u1' }] }, headers: { 'request-id': 'rid-u' } };
    }
    if (url.includes('/groups?')) {
      if (hoisted.groupsGetError) throw hoisted.groupsGetError;
      return { status: 200, data: { value: [{ id: 'g1' }] }, headers: {} };
    }
    if (/\/groups\/[^?]/.test(url)) {
      if (hoisted.groupByIdGetError) throw hoisted.groupByIdGetError;
      return {
        status: 200,
        data: { id: 'eg-1', displayName: 'Portal Access', securityEnabled: true },
        headers: { 'request-id': 'rid-group' },
      };
    }
    return { status: 200, data: {}, headers: {} };
  });
  const post = vi.fn(async () => {
    if (hoisted.membershipPostError) throw hoisted.membershipPostError;
    return { data: { value: [] }, status: 200, headers: {} };
  });
  return { default: { get, post, isAxiosError }, get, post, isAxiosError };
});

import { runEntraClientAccessDiagnostics } from '@ee/lib/integrations/entra/diagnostics/clientDiagnostics';
import {
  signContinuation,
  type EntraClientContinuationPayload,
} from '@ee/lib/integrations/entra/diagnostics/continuation';

const SECRET = 'client-test-signing-secret-1234';

function continuationPayload(
  overrides: Partial<EntraClientContinuationPayload> = {}
): EntraClientContinuationPayload {
  return {
    v: 1,
    tenant: 'tenant-1',
    userId: 'user-1',
    scope: 'clients',
    connectionType: 'direct',
    connectionId: 'conn-1',
    selection: [{ clientId: 'c1', managedTenantId: 'managed-c1', entraTenantId: 'entra-1' }],
    includeUserYield: false,
    offset: 0,
    total: 1,
    recentResults: [],
    aggregate: { ok: 0, need_consent: 0, conditional_access: 0, missing_role: 0, other: 0 },
    failedCount: 0,
    warnCount: 0,
    recommendations: [],
    pending: null,
    startedAt: Date.now(),
    exp: Date.now() + 60_000,
    ...overrides,
  };
}

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
    hoisted.pageNextLink = null;
    hoisted.pageError = null;
    hoisted.pageRead.mockReset();
    hoisted.usersGetError = null;
    hoisted.groupsGetError = null;
    hoisted.groupByIdGetError = null;
    hoisted.membershipPostError = null;
    hoisted.portalConfig = null;
    vi.clearAllMocks();
  });

  afterAll(() => {
    delete process.env.ENTRA_DIAGNOSTICS_JOB_SECRET;
  });

  afterEach(() => vi.useRealTimers());

  it('resumes the interrupted page after a deadline and preserves counts already read', async () => {
    vi.useFakeTimers();
    hoisted.pageRead
      .mockResolvedValueOnce({ users: hoisted.users, nextLink: 'https://graph.test/users?page=2' })
      .mockImplementationOnce(({ signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('canceled'), { code: 'ERR_CANCELED' })));
      }));
    const running = runEntraClientAccessDiagnostics('tenant-1', 'user-1', { clientIds: ['c1'], includeUserYield: true });
    await vi.advanceTimersByTimeAsync(15_001);
    const first = await running;
    expect(first.completed).toBe(0);
    expect(first.isDone).toBe(false);
    expect(first.clients).toEqual([]);
    expect(first.jobId).toBeTruthy();
    hoisted.pageRead.mockResolvedValueOnce({ users: hoisted.users, nextLink: null });
    const last = await runEntraClientAccessDiagnostics('tenant-1', 'user-1', { continuation: first.jobId });
    expect(hoisted.pageRead).toHaveBeenLastCalledWith(expect.objectContaining({ url: 'https://graph.test/users?page=2' }));
    expect(last.completed).toBe(1);
    expect(last.isDone).toBe(true);
    expect(last.clients[0].steps.find((s) => s.id === 'user_yield_preview')?.data).toMatchObject({ totalUsers: 2, includedUsers: 2 });
  });

  it('processes at most three clients per request and resumes via continuation', async () => {
    hoisted.mappings = [
      hoisted.mapping('c1', 'entra-1'),
      hoisted.mapping('c2', 'entra-2'),
      hoisted.mapping('c3', 'entra-3'),
      hoisted.mapping('c4', 'entra-4'),
    ];
    const first = await runEntraClientAccessDiagnostics('tenant-1', 'user-1', {
      clientIds: ['c1', 'c2', 'c3', 'c4'],
    });
    expect(first.clients).toHaveLength(3);
    expect(first.completed).toBe(3);
    expect(first.isDone).toBe(false);
    expect(first.jobId).toBeTruthy();

    const second = await runEntraClientAccessDiagnostics('tenant-1', 'user-1', {
      continuation: first.jobId,
    });
    expect(second.clients).toHaveLength(1);
    expect(second.clients[0].clientId).toBe('c4');
    expect(second.completed).toBe(4);
    expect(second.isDone).toBe(true);
    expect(second.overallStatus).toBe('pass');
  });

  it('does not finalize a client whose resumable preview is incomplete', async () => {
    hoisted.users = [
      { entraObjectId: 'u1', email: 'a@c1.example', userPrincipalName: 'a@c1.example', accountEnabled: true },
    ];
    hoisted.filterResult = { included: hoisted.users, excluded: [] };
    hoisted.pageNextLink = 'https://graph.test/users?$skiptoken=next';
    const result = await runEntraClientAccessDiagnostics('tenant-1', 'user-1', {
      clientIds: ['c1'],
      includeUserYield: true,
    });
    expect(result.clients).toHaveLength(0);
    expect(result.completed).toBe(0);
    expect(result.isDone).toBe(false);
    expect(result.jobId).toBeTruthy();
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
    const continuation = signContinuation(continuationPayload({
      selection,
      total: 2,
    }));

    // The mapping now points at a different Entra tenant.
    hoisted.mappings = [hoisted.mapping('c1', 'entra-CHANGED'), hoisted.mapping('c2', 'entra-2')];

    const result = await runEntraClientAccessDiagnostics('tenant-1', 'user-1', { continuation });
    expect(result.error).toMatch(/changed or were removed/);
    expect(result.clients).toEqual([]);
  });

  it('rejects a continuation bound to a different connection id', async () => {
    const continuation = signContinuation(continuationPayload({
      connectionId: 'other-connection',
      selection: [{ clientId: 'c1', managedTenantId: 'managed-c1', entraTenantId: 'entra-1' }],
      total: 1,
    }));
    const result = await runEntraClientAccessDiagnostics('tenant-1', 'user-1', { continuation });
    expect(result.error).toMatch(/reconnected/);
  });

  it('rejects a continuation for a different user', async () => {
    const continuation = signContinuation(continuationPayload({
      userId: 'someone-else',
      selection: [{ clientId: 'c1', managedTenantId: 'managed-c1', entraTenantId: 'entra-1' }],
      total: 1,
    }));
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

  function graphError(overrides: {
    status: number;
    requestId?: string;
    clientRequestId?: string;
    code?: string;
    message?: string;
    rawMessage?: string;
  }) {
    return Object.assign(new Error(overrides.rawMessage ?? 'Request failed with status code'), {
      isAxiosError: true,
      code: overrides.code ?? 'ERR_BAD_REQUEST',
      response: {
        status: overrides.status,
        headers: {
          ...(overrides.requestId ? { 'request-id': overrides.requestId } : {}),
          ...(overrides.clientRequestId ? { 'client-request-id': overrides.clientRequestId } : {}),
        },
        data: { error: { code: 'Authorization_RequestDenied', message: overrides.message } },
      },
    });
  }

  it('keeps native users read evidence and client correlation alongside the remedy', async () => {
    hoisted.usersGetError = graphError({
      status: 403,
      requestId: 'rid-users',
      clientRequestId: 'crid-users',
      message: 'Insufficient privileges',
    });
    const result = await runEntraClientAccessDiagnostics('tenant-1', 'user-1', { clientIds: ['c1'] });
    const step = result.clients[0].steps.find((s) => s.id === 'users_read');
    expect(step?.status).toBe('fail');
    expect(step?.http).toMatchObject({
      method: 'GET',
      path: '/users?$select=id&$top=1',
      status: 403,
      requestId: 'rid-users',
      clientRequestId: 'crid-users',
    });
    expect(step?.error).toMatchObject({
      message: 'Insufficient privileges',
      status: 403,
      graphCode: 'Authorization_RequestDenied',
      requestId: 'rid-users',
      clientRequestId: 'crid-users',
    });
    // The remediation is preserved as a recommendation, not lost to the evidence.
    expect(step?.recommendations?.some((r) => r.code === 'customer_directory_role_missing')).toBe(true);
  });

  it('keeps native groups read evidence and distinguishes it from the users read', async () => {
    hoisted.groupsGetError = graphError({
      status: 403,
      requestId: 'rid-groups',
      clientRequestId: 'crid-groups',
      message: 'Insufficient privileges',
    });
    const result = await runEntraClientAccessDiagnostics('tenant-1', 'user-1', { clientIds: ['c1'] });
    const client = result.clients[0];
    expect(client.steps.find((s) => s.id === 'users_read')?.status).toBe('pass');
    const groups = client.steps.find((s) => s.id === 'groups_read');
    expect(groups?.status).toBe('fail');
    expect(groups?.http).toMatchObject({
      method: 'GET',
      path: '/groups?$select=id&$top=1',
      requestId: 'rid-groups',
      clientRequestId: 'crid-groups',
    });
    expect(groups?.error).toMatchObject({
      message: 'Insufficient privileges',
      graphCode: 'Authorization_RequestDenied',
      clientRequestId: 'crid-groups',
    });
  });

  it('reports a failed entitlement group GET as a GET, never as the membership POST', async () => {
    hoisted.portalConfig = {
      client_portal_entitlement_group_id: 'eg-1',
      client_portal_entitlement_membership_mode: 'auto',
    };
    hoisted.groupByIdGetError = graphError({
      status: 500,
      requestId: 'rid-group-get',
      clientRequestId: 'crid-group-get',
      code: 'ERR_BAD_RESPONSE',
      message: 'Group lookup exploded',
    });
    const result = await runEntraClientAccessDiagnostics('tenant-1', 'user-1', { clientIds: ['c1'] });
    const step = result.clients[0].steps.find((s) => s.id === 'entitlement_group_resolves');
    expect(step?.status).toBe('fail');
    expect(step?.http).toMatchObject({
      method: 'GET',
      path: '/groups/{id}',
      status: 500,
      requestId: 'rid-group-get',
      clientRequestId: 'crid-group-get',
    });
    expect(step?.error).toMatchObject({ message: 'Group lookup exploded', graphCode: 'Authorization_RequestDenied' });
    expect(step?.recommendations?.some((r) => r.code === 'entitlement_group_missing')).toBe(false);
  });

  it('does not report a resolved group as missing when the membership POST returns 404', async () => {
    hoisted.portalConfig = {
      client_portal_entitlement_group_id: 'eg-1',
      client_portal_entitlement_membership_mode: 'auto',
    };
    hoisted.membershipPostError = graphError({
      status: 404,
      requestId: 'rid-membership',
      clientRequestId: 'crid-membership',
      rawMessage: 'Request failed with status code 404',
    });
    const result = await runEntraClientAccessDiagnostics('tenant-1', 'user-1', { clientIds: ['c1'] });
    const step = result.clients[0].steps.find((s) => s.id === 'entitlement_group_resolves');
    expect(step?.status).toBe('fail');
    expect(step?.http).toMatchObject({
      method: 'POST',
      path: '/users/{id}/checkMemberGroups',
      status: 404,
      requestId: 'rid-membership',
      clientRequestId: 'crid-membership',
    });
    expect((step?.data as any)?.groupResolved).toBe(true);
    expect((step?.data as any)?.membershipProbeFailed).toBe(true);
    expect(step?.recommendations?.some((r) => r.code === 'entitlement_group_missing')).toBe(false);
  });

  it('redacts secrets from preserved native error metadata', async () => {
    hoisted.usersGetError = Object.assign(new Error('noise'), {
      isAxiosError: true,
      response: {
        status: 403,
        headers: { 'request-id': 'rid-secret' },
        data: {
          error: {
            code: 'Authorization_RequestDenied',
            message: 'Denied for refresh_token=super-secret-refresh-value',
          },
        },
      },
    });
    const result = await runEntraClientAccessDiagnostics('tenant-1', 'user-1', { clientIds: ['c1'] });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('super-secret-refresh-value');
    // Correlation ids and native codes survive secret redaction.
    const step = result.clients[0].steps.find((s) => s.id === 'users_read');
    expect(step?.error).toMatchObject({ requestId: 'rid-secret', graphCode: 'Authorization_RequestDenied' });
  });
});
