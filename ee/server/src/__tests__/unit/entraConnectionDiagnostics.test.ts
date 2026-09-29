// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => {
  const makeJwt = (payload: Record<string, unknown>) => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${header}.${body}.sig`;
  };
  const buildAccessToken = (appId: string) =>
    makeJwt({
      tid: 'partner-tenant',
      appid: appId,
      aud: 'graph',
      preferred_username: 'admin@partner.example',
      scp: 'User.Read ManagedTenants.Read.All Directory.Read.All offline_access',
    });
  return {
    makeJwt,
    buildAccessToken,
    mintAppId: 'app-1',
    connection: {
      tenant: 'tenant-1',
      connection_id: 'conn-1',
      connection_type: 'direct' as const,
      status: 'connected',
      is_active: true,
      cipp_base_url: null,
      token_secret_ref: null,
      connected_at: '2026-01-01T00:00:00.000Z',
      disconnected_at: null,
      last_validated_at: '2026-01-02T00:00:00.000Z',
      last_validation_error: { message: 'old failure', code: 'X', checkedAt: '2026-01-02T00:00:00.000Z' },
      created_by: null,
      updated_by: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
    },
    binding: { profile_id: 'profile-1' },
    profile: {
      display_name: 'Partner App',
      client_id: 'app-1',
      tenant_id: 'partner-tenant',
      client_secret_ref: 'ref-1',
      capabilities: ['entra'],
      is_archived: false,
    },
    activeConnection: null as any,
    secretValue: 'super-secret-value' as string | null,
    tokens: {
      accessToken: null as string | null,
      refreshToken: 'refresh-token-value' as string | null,
      expiresAt: new Date(Date.now() + 3600_000).toISOString() as string | null,
    },
    mappings: [
      {
        managedTenantId: 'managed-1',
        entraTenantId: 'customer-tenant-1',
        clientId: 'client-1',
        clientName: 'Acme',
        displayName: 'Acme Ltd',
        primaryDomain: 'acme.example',
        sourceUserCount: 5,
        userCount: 5,
        userCountSource: 'discovery' as const,
        userCountObservedAt: null,
        lastSyncedAt: null,
        lastRunStatus: null,
      },
    ],
    discovered: [
      { entraTenantId: 'customer-tenant-1', displayName: 'Acme Ltd', primaryDomain: 'acme.example', sourceUserCount: 5, raw: {} },
      { entraTenantId: 'customer-tenant-2', displayName: 'Beta', primaryDomain: 'beta.example', sourceUserCount: 3, raw: {} },
    ],
    temporal: {
      reachable: true,
      address: 'temporal:7233',
      namespace: 'default',
      taskQueue: 'tenant-workflows',
      workerEvidence: 'available' as 'available' | 'none' | 'unknown',
    },
    schedule: {
      configured: true,
      lookupFailed: false,
      nextFireTime: '2026-01-03T00:00:00.000Z',
      intervalMinutes: 1440,
      paused: false,
    },
    updateValidation: vi.fn(),
    probes: [] as string[],
    mappingsError: null as any,
    reconciliation: { count: 0, oldest: null as string | null },
  };
});

vi.mock('@ee/lib/integrations/entra/connectionRepository', () => ({
  getActiveEntraPartnerConnection: vi.fn(async () => hoisted.activeConnection),
  updateEntraConnectionValidation: hoisted.updateValidation,
}));

vi.mock('@ee/lib/integrations/entra/auth/microsoftCredentialResolver', () => ({
  resolveMicrosoftCredentialsForTenant: vi.fn(async () => ({
    clientId: 'app-1',
    clientSecret: 'super-secret-value',
    tenantId: 'partner-tenant',
    source: 'profile',
    profileId: 'profile-1',
    profileDisplayName: 'Partner App',
  })),
}));

vi.mock('@ee/lib/integrations/entra/auth/refreshDirectToken', () => ({
  refreshEntraDirectToken: vi.fn(async () => ({
    accessToken: hoisted.buildAccessToken(hoisted.mintAppId),
    refreshToken: 'refresh-token-value',
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    scope: 'User.Read ManagedTenants.Read.All Directory.Read.All offline_access',
  })),
  refreshEntraDirectAccessTokenForTenant: vi.fn(async () => ({
    accessToken: 'customer-token',
    refreshToken: 'refresh-token-value',
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    scope: 'Directory.Read.All',
  })),
}));

vi.mock('@ee/lib/integrations/entra/providers/direct/directProbe', () => ({
  entraDirectProbeEndpoint: () => 'https://graph.microsoft.com/beta/tenantRelationships/managedTenants/tenants?$top=1',
  probeEntraDirectAccess: vi.fn(async () => {
    hoisted.probes.push('direct');
    return {
      valid: true,
      checkedAt: new Date().toISOString(),
      managedTenantSampleCount: 1,
      endpoint: 'https://graph.microsoft.com/beta/tenantRelationships/managedTenants/tenants?$top=1',
    };
  }),
  isSuccessfulEntraDirectProbe: (p: any) => p.valid === true,
  isFailedEntraDirectProbe: (p: any) => p.valid === false,
}));

vi.mock('@ee/lib/integrations/entra/providers/direct/directProviderAdapter', () => ({
  createDirectProviderAdapter: () => ({
    connectionType: 'direct',
    listManagedTenants: vi.fn(async () => hoisted.discovered),
  }),
  DirectProviderAdapter: class {},
}));

vi.mock('@ee/lib/integrations/entra/mapping/confirmedMappingsService', () => ({
  listConfirmedEntraMappings: vi.fn(async () => {
    if (hoisted.mappingsError) throw hoisted.mappingsError;
    return hoisted.mappings;
  }),
  listConfirmedEntraMappingsWithDb: vi.fn(async () => hoisted.mappings),
}));

vi.mock('@ee/lib/integrations/entra/scheduleService', () => ({
  getEntraSyncSchedule: vi.fn(async () => ({
    syncEnabled: true,
    syncIntervalMinutes: 1440,
    updatedAt: '2026-01-01T00:00:00.000Z',
  })),
}));

vi.mock('@ee/lib/integrations/entra/entraWorkflowClient', () => ({
  getEntraSyncRunProgress: vi.fn(async () => ({ run: null, tenantResults: [] })),
}));

vi.mock('@ee/lib/integrations/entra/diagnostics/temporalReadiness', () => ({
  probeTemporalReadiness: vi.fn(async () => hoisted.temporal),
  describeEntraSchedule: vi.fn(async () => hoisted.schedule),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getTenantSecret: vi.fn(async (_tenant: string, key: string) => {
      if (key === 'ref-1') return hoisted.secretValue;
      if (key === 'entra_direct_access_token') return hoisted.tokens.accessToken;
      if (key === 'entra_direct_refresh_token') return hoisted.tokens.refreshToken;
      if (key === 'entra_direct_token_expires_at') return hoisted.tokens.expiresAt;
      return null;
    }),
    getAppSecret: vi.fn(async () => null),
  })),
}));

const queryResults: Record<string, any[]> = {
  entra_sync_runs: [],
  entra_sync_run_tenants: [],
};

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: vi.fn(async () => ({})),
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: vi.fn(() => ({
    table: (name: string) => {
      const chain: any = {
        __where: null,
        where(arg?: any) {
          if (arg && typeof arg === 'object') chain.__where = arg;
          return chain;
        },
        whereIn() {
          return chain;
        },
        whereNot() {
          return chain;
        },
        count() {
          return chain;
        },
        min() {
          return chain;
        },
        orderBy() {
          return chain;
        },
        orderByRaw() {
          return chain;
        },
        groupBy() {
          return chain;
        },
        limit() {
          return chain;
        },
        select() {
          return chain;
        },
        sum() {
          return chain;
        },
        first: async () => {
          if (name === 'entra_contact_reconciliation_queue') return hoisted.reconciliation;
          if (name === 'microsoft_profile_consumer_bindings') return hoisted.binding;
          if (name === 'microsoft_profiles') return hoisted.profile;
          return undefined;
        },
        then: (resolve: any, reject: any) => {
          let rows = queryResults[name] ?? [];
          const where = chain.__where;
          if (Array.isArray(rows) && where && 'is_dry_run' in where) {
            rows = rows.filter((row: any) => row.is_dry_run === where.is_dry_run);
          }
          return Promise.resolve(rows).then(resolve, reject);
        },
      };
      return chain;
    },
  })),
  createTenantKnex: vi.fn(async () => ({ knex: {}, tenant: 'tenant-1' })),
}));

vi.mock('axios', () => {
  const get = vi.fn(async (url: string) => {
    if (url.endsWith('/me')) {
      return {
        status: 200,
        data: { id: 'me-id', userPrincipalName: 'admin@partner.example' },
        headers: { 'request-id': 'rid-me' },
      };
    }
    throw new Error(`Unexpected GET ${url}`);
  });
  return {
    default: { get, post: vi.fn(), isAxiosError: (e: any) => Boolean(e?.isAxiosError) },
    get,
    post: vi.fn(),
    isAxiosError: (e: any) => Boolean(e?.isAxiosError),
  };
});

import { runEntraConnectionDiagnostics } from '@ee/lib/integrations/entra/diagnostics/connectionDiagnostics';
import { getEntraSyncRunProgress } from '@ee/lib/integrations/entra/entraWorkflowClient';
import { parseEntraConsoleTab } from '@ee/components/settings/integrations/entra/entraConsoleModel';

describe('runEntraConnectionDiagnostics', () => {
  beforeEach(() => {
    hoisted.activeConnection = hoisted.connection;
    hoisted.mintAppId = 'app-1';
    hoisted.secretValue = 'super-secret-value';
    hoisted.tokens.accessToken = hoisted.buildAccessToken('app-1');
    hoisted.tokens.refreshToken = 'refresh-token-value';
    hoisted.temporal = {
      reachable: true,
      address: 'temporal:7233',
      namespace: 'default',
      taskQueue: 'tenant-workflows',
      workerEvidence: 'available',
    };
    hoisted.schedule = {
      configured: true,
      lookupFailed: false,
      nextFireTime: '2026-01-03T00:00:00.000Z',
      intervalMinutes: 1440,
      paused: false,
    };
    queryResults.entra_sync_runs = [];
    queryResults.entra_sync_run_tenants = [];
    hoisted.probes = [];
    hoisted.mappingsError = null;
    hoisted.reconciliation = { count: 0, oldest: null };
    vi.clearAllMocks();
  });

  it('produces a green Direct report with the planned step order and no secret leakage', async () => {
    const report = await runEntraConnectionDiagnostics('tenant-1', { includeIdentifiers: true });

    expect(report.steps.map((s) => s.id)).toEqual([
      'edition_tier_rbac',
      'connection_row',
      'app_registration_binding',
      'client_secret_present',
      'expected_app_registration_values',
      'sync_worker_and_schedule',
      'token_set_present',
      'token_refresh',
      'token_claims',
      'graph_me',
      'managed_tenants_endpoint',
      'managed_tenants_count',
      'mappings_vs_discovery',
      'cipp_credentials_present',
      'cipp_reachable',
      'cipp_auth',
      'cipp_tenant_list',
      'cipp_mappings_vs_list',
      'last_runs',
      'per_tenant_last_result',
      'reconciliation_queue',
    ]);

    expect(report.summary.overallStatus).toBe('pass');
    expect(report.summary.managedTenantCount).toBe(2);
    expect(report.summary.mappedClientCount).toBe(1);
    expect(JSON.stringify(report)).not.toContain('super-secret-value');
    // No forbidden writes.
    expect(hoisted.updateValidation).not.toHaveBeenCalled();
  });

  it('fails the secret check and skips credential-dependent work when the secret is missing', async () => {
    hoisted.secretValue = null;
    const report = await runEntraConnectionDiagnostics('tenant-1', { includeIdentifiers: true });

    expect(report.steps.find((s) => s.id === 'client_secret_present')?.status).toBe('fail');
    expect(report.steps.find((s) => s.id === 'token_set_present')?.status).toBe('skip');
    const refresh = report.steps.find((s) => s.id === 'token_refresh');
    expect(refresh?.status).toBe('skip');
    expect(refresh?.blockedBy).toBe('token_set_present');
    expect(report.steps.find((s) => s.id === 'managed_tenants_endpoint')?.status).toBe('skip');
    expect(report.recommendations.some((r) => r.code === 'client_secret_missing')).toBe(true);
    expect(hoisted.updateValidation).not.toHaveBeenCalled();
  });

  it('treats a whitespace-only secret as missing', async () => {
    hoisted.secretValue = '   ';
    const report = await runEntraConnectionDiagnostics('tenant-1', { includeIdentifiers: true });
    expect(report.steps.find((s) => s.id === 'client_secret_present')?.status).toBe('fail');
  });

  it('skips discovery when token claims report an app mismatch', async () => {
    hoisted.mintAppId = 'other-app';
    const report = await runEntraConnectionDiagnostics('tenant-1', { includeIdentifiers: true });

    expect(report.steps.find((s) => s.id === 'token_claims')?.status).toBe('fail');
    const endpoint = report.steps.find((s) => s.id === 'managed_tenants_endpoint');
    expect(endpoint?.status).toBe('skip');
    expect(endpoint?.blockedBy).toBe('token_claims');
    expect(hoisted.probes).not.toContain('direct');
  });

  it('fails the schedule step when Temporal is unreachable but keeps local health checks', async () => {
    hoisted.temporal = {
      reachable: false,
      address: 'temporal:7233',
      namespace: 'default',
      taskQueue: 'tenant-workflows',
      workerEvidence: 'unknown',
    };
    const report = await runEntraConnectionDiagnostics('tenant-1', { includeIdentifiers: true });

    expect(report.steps.find((s) => s.id === 'sync_worker_and_schedule')?.status).toBe('fail');
    expect(report.steps.find((s) => s.id === 'last_runs')?.status).toBe('pass');
    expect(report.steps.find((s) => s.id === 'reconciliation_queue')?.status).toBe('pass');
    expect(hoisted.updateValidation).not.toHaveBeenCalled();
  });

  it('warns when the schedule interval drifts from the saved setting', async () => {
    hoisted.schedule = {
      configured: true,
      lookupFailed: false,
      nextFireTime: '2026-01-03T00:00:00.000Z',
      intervalMinutes: 60,
      paused: false,
    };
    const report = await runEntraConnectionDiagnostics('tenant-1', { includeIdentifiers: true });
    const step = report.steps.find((s) => s.id === 'sync_worker_and_schedule');
    expect(step?.status).toBe('warn');
    expect((step?.data as any)?.scheduleIntervalMatchesSettings).toBe(false);
    expect(report.recommendations.some((r) => r.code === 'schedule_interval_mismatch')).toBe(true);
  });

  it('warns when no worker is polling the task queue', async () => {
    hoisted.temporal = {
      reachable: true,
      address: 'temporal:7233',
      namespace: 'default',
      taskQueue: 'tenant-workflows',
      workerEvidence: 'none',
    };
    const report = await runEntraConnectionDiagnostics('tenant-1', { includeIdentifiers: true });
    expect(report.steps.find((s) => s.id === 'sync_worker_and_schedule')?.status).toBe('fail');
    expect(report.recommendations.some((r) => r.code === 'temporal_no_workers')).toBe(true);
  });

  it('evaluates consecutive real failures despite interspersed dry runs and decodes customer context', async () => {
    queryResults.entra_sync_runs = [
      { run_id: 'r1', status: 'failed', run_type: 'all-tenants', started_at: '2026-01-05T00:00:00.000Z', completed_at: '2026-01-05T00:01:00.000Z', is_dry_run: false, total_tenants: 2, succeeded_tenants: 0, failed_tenants: 2 },
      { run_id: 'r2', status: 'partial', run_type: 'all-tenants', started_at: '2026-01-04T00:00:00.000Z', completed_at: '2026-01-04T00:01:00.000Z', is_dry_run: false, total_tenants: 2, succeeded_tenants: 1, failed_tenants: 1 },
      { run_id: 'd1', status: 'completed', run_type: 'preflight', started_at: '2026-01-03T00:00:00.000Z', completed_at: '2026-01-03T00:00:30.000Z', is_dry_run: true, total_tenants: 1, succeeded_tenants: 1, failed_tenants: 0 },
      { run_id: 'd2', status: 'completed', run_type: 'preflight', started_at: '2026-01-02T00:00:00.000Z', completed_at: '2026-01-02T00:00:30.000Z', is_dry_run: true, total_tenants: 1, succeeded_tenants: 1, failed_tenants: 0 },
    ];
    queryResults.entra_sync_run_tenants = [
      { run_id: 'r1', created: 1, linked: 2, updated: 3, ambiguous: 4, inactivated: 5 },
      { run_id: 'r2', created: 0, linked: 0, updated: 0, ambiguous: 0, inactivated: 0 },
    ];
    const progressMock = getEntraSyncRunProgress as unknown as ReturnType<typeof vi.fn>;
    progressMock.mockResolvedValue({
      run: null,
      tenantResults: [
        {
          managedTenantId: 'managed-1',
          clientId: 'client-1',
          status: 'failed',
          created: 0, linked: 0, updated: 0, ambiguous: 0, inactivated: 0,
          errorMessage: 'invalid_grant AADSTS65001 consent_required',
          startedAt: null,
          completedAt: '2026-01-05T00:01:00.000Z',
        },
      ],
    });

    const report = await runEntraConnectionDiagnostics('tenant-1', { includeIdentifiers: true });
    const step = report.steps.find((s) => s.id === 'last_runs');
    expect(step?.status).toBe('warn');
    expect(report.recommendations.some((r) => r.code === 'consecutive_sync_failures')).toBe(true);

    const runs = (step?.data as any)?.runs as any[];
    expect(runs[0].totals).toEqual({ created: 1, linked: 2, updated: 3, ambiguous: 4, inactivated: 5 });

    const decoded = (step?.data as any)?.decodedFailure;
    expect(decoded?.aadstsCode).toBe('AADSTS65001');
    expect(decoded?.clientName).toBe('Acme');
    expect(decoded?.remedy).toMatch(/Reconnecting the partner will not fix/i);
    const consentRec = report.recommendations.find((r) => r.code === 'customer_consent_required');
    expect(consentRec?.action?.payload).toContain('/adminconsent?client_id=app-1');
  });

  it('fails connection_row and skips direct checks while keeping independent local checks running', async () => {
    hoisted.activeConnection = null;
    const report = await runEntraConnectionDiagnostics('tenant-1', { includeIdentifiers: true });

    expect(report.steps.find((s) => s.id === 'connection_row')?.status).toBe('fail');
    const binding = report.steps.find((s) => s.id === 'app_registration_binding');
    expect(binding?.status).toBe('skip');
    expect(binding?.blockedBy).toBe('connection_row');
    expect(report.steps.find((s) => s.id === 'expected_app_registration_values')?.status).toBe('pass');
    expect(report.steps.find((s) => s.id === 'last_runs')?.status).toBe('pass');
    expect(report.steps.find((s) => s.id === 'token_refresh')?.status).toBe('skip');
    expect(report.recommendations.some((r) => r.code === 'connect_entra')).toBe(true);
  });

  it('emits a review-queue navigation target that parses to the console tab', async () => {
    hoisted.reconciliation = { count: 3, oldest: '2026-01-01T00:00:00.000Z' };
    const report = await runEntraConnectionDiagnostics('tenant-1', { includeIdentifiers: true });

    const step = report.steps.find((s) => s.id === 'reconciliation_queue');
    expect(step?.status).toBe('warn');
    const rec = report.recommendations.find((r) => r.code === 'reconciliation_open_items');
    expect(rec?.action).toEqual({ kind: 'navigate', payload: 'review-queue' });
    expect(parseEntraConsoleTab(rec?.action?.payload ?? null)).toBe('review-queue');
  });

  it('reports a confirmed-mappings lookup failure instead of an empty passing comparison', async () => {
    hoisted.mappingsError = new Error('mapping lookup exploded');
    const report = await runEntraConnectionDiagnostics('tenant-1', { includeIdentifiers: true });

    const step = report.steps.find((s) => s.id === 'mappings_vs_discovery');
    expect(step?.status).toBe('fail');
    expect((step?.data as any)?.mappingsUnavailable).toBe(true);
    expect(report.recommendations.some((r) => r.code === 'mappings_lookup_failed')).toBe(true);
    expect(report.summary.mappedClientCount).toBeNull();
    // Independent discovery checks still ran.
    expect(report.steps.find((s) => s.id === 'managed_tenants_count')?.status).toBe('pass');
    expect(report.steps.find((s) => s.id === 'last_runs')?.status).toBe('pass');
  });
});
