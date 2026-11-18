// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
  probe: {
    outcome: 'ok',
    reachable: true,
    authRejected: false,
    endpoint: 'https://cipp.test/api/listtenants',
    attempted: ['https://cipp.test/api/listtenants'],
    status: 200,
    tenants: [] as Array<{ entraTenantId: string; displayName: string | null }>,
  } as any,
  mappingsError: null as any,
  creds: { baseUrl: 'https://cipp.test', apiToken: 'k' } as any,
}));

vi.mock('@ee/lib/integrations/entra/connectionRepository', () => ({
  getActiveEntraPartnerConnection: vi.fn(async () => ({
    tenant: 'tenant-1',
    connection_id: 'conn-1',
    connection_type: 'cipp',
    status: 'connected',
    is_active: true,
    cipp_base_url: 'https://cipp.test',
    last_validation_error: {},
  })),
  updateEntraConnectionValidation: vi.fn(),
}));

vi.mock('@ee/lib/integrations/entra/providers/cipp/cippSecretStore', () => ({
  getEntraCippCredentials: vi.fn(async () => hoisted.creds),
}));

vi.mock('@ee/lib/integrations/entra/providers/cipp/cippProviderAdapter', () => ({
  CippProviderAdapter: class {
    async probeTenantList() {
      return hoisted.probe;
    }
  },
}));

vi.mock('@ee/lib/integrations/entra/mapping/confirmedMappingsService', () => ({
  listConfirmedEntraMappings: vi.fn(async () => {
    if (hoisted.mappingsError) throw hoisted.mappingsError;
    return [];
  }),
  listConfirmedEntraMappingsWithDb: vi.fn(async () => []),
}));

vi.mock('@ee/lib/integrations/entra/scheduleService', () => ({
  getEntraSyncSchedule: vi.fn(async () => ({
    syncEnabled: true,
    syncIntervalMinutes: 1440,
    updatedAt: null,
  })),
}));

vi.mock('@ee/lib/integrations/entra/entraWorkflowClient', () => ({
  getEntraSyncRunProgress: vi.fn(async () => ({ run: null, tenantResults: [] })),
}));

vi.mock('@ee/lib/integrations/entra/diagnostics/temporalReadiness', () => ({
  probeTemporalReadiness: vi.fn(async () => ({
    reachable: true,
    address: 't',
    namespace: 'default',
    taskQueue: 'q',
    workerEvidence: 'available',
  })),
  describeEntraSchedule: vi.fn(async () => ({
    configured: true,
    lookupFailed: false,
    nextFireTime: null,
    intervalMinutes: 1440,
    paused: false,
  })),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getTenantSecret: vi.fn(async () => null),
    getAppSecret: vi.fn(async () => null),
  })),
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: vi.fn(() => ({
    table: (name: string) => {
      const chain: any = {
        where() {
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
        limit() {
          return chain;
        },
        select() {
          return chain;
        },
        first: async () =>
          name === 'entra_contact_reconciliation_queue' ? { count: 0, oldest: null } : undefined,
        then: (resolve: any) => Promise.resolve([]).then(resolve),
      };
      return chain;
    },
  })),
  createTenantKnex: vi.fn(async () => ({ knex: {}, tenant: 'tenant-1' })),
}));

vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: vi.fn(async () => ({})) }));

vi.mock('axios', () => ({
  default: { get: vi.fn(), post: vi.fn(), isAxiosError: () => false },
}));

import { runEntraConnectionDiagnostics } from '@ee/lib/integrations/entra/diagnostics/connectionDiagnostics';
import {
  CippTokenService,
  setCippTokenServiceForTests,
  type CippFetch,
} from '@ee/lib/integrations/entra/providers/cipp/cippTokenService';
import { applyReportRedaction } from '@ee/lib/integrations/entra/diagnostics/redaction';

function stepsById(report: any): Record<string, any> {
  return Object.fromEntries(report.steps.map((s: any) => [s.id, s]));
}

describe('CIPP connection diagnostics outcomes', () => {
  beforeEach(() => {
    hoisted.probe = {
      outcome: 'ok',
      reachable: true,
      authRejected: false,
      endpoint: 'https://cipp.test/api/listtenants',
      attempted: ['https://cipp.test/api/listtenants'],
      status: 200,
      tenants: [],
    };
    hoisted.mappingsError = null;
    hoisted.creds = { baseUrl: 'https://cipp.test', apiToken: 'k' };
  });

  it('passes reachability and warns on an empty tenant list', async () => {
    const report = await runEntraConnectionDiagnostics('tenant-1', { includeIdentifiers: true });
    const steps = stepsById(report);
    expect(steps.cipp_reachable.status).toBe('pass');
    expect(steps.cipp_auth.status).toBe('pass');
    expect(steps.cipp_tenant_list.status).toBe('warn');
    expect(report.recommendations.some((r) => r.code === 'cipp_empty_tenant_list')).toBe(true);
  });

  it('warns reachability and fails auth on 401/403', async () => {
    hoisted.probe = { ...hoisted.probe, outcome: 'auth_rejected', authRejected: true, status: 401, tenants: [] };
    const report = await runEntraConnectionDiagnostics('tenant-1', { includeIdentifiers: true });
    const steps = stepsById(report);
    expect(steps.cipp_reachable.status).toBe('warn');
    expect(steps.cipp_auth.status).toBe('fail');
    expect(steps.cipp_tenant_list.status).toBe('skip');
    expect(steps.cipp_mappings_vs_list.status).toBe('skip');
  });

  it('fails reachability and skips dependents on all-candidate HTTP errors', async () => {
    hoisted.probe = { ...hoisted.probe, outcome: 'http_error', reachable: true, status: 500, tenants: [] };
    const report = await runEntraConnectionDiagnostics('tenant-1', { includeIdentifiers: true });
    const steps = stepsById(report);
    expect(steps.cipp_reachable.status).toBe('fail');
    expect(steps.cipp_auth.status).toBe('skip');
    expect(steps.cipp_tenant_list.status).toBe('skip');
    expect(report.recommendations.some((r) => r.code === 'cipp_http_error')).toBe(true);
  });

  it('fails reachability on a malformed success payload', async () => {
    hoisted.probe = { ...hoisted.probe, outcome: 'invalid_payload', reachable: true, status: 200, tenants: [] };
    const report = await runEntraConnectionDiagnostics('tenant-1', { includeIdentifiers: true });
    const steps = stepsById(report);
    expect(steps.cipp_reachable.status).toBe('fail');
    expect(steps.cipp_tenant_list.status).toBe('skip');
    expect(report.recommendations.some((r) => r.code === 'cipp_invalid_payload')).toBe(true);
  });

  it('emits the API-client IP-block text without the legacy messageKey', async () => {
    const text = 'CIPP refused the tenant list (listtenants) with HTTP 403. This usually means our egress IP is not in the API client\'s allowlist.';
    hoisted.probe = { ...hoisted.probe, outcome: 'auth_rejected', authRejected: true, status: 403, error: text, tenants: [] };
    const report = await runEntraConnectionDiagnostics('tenant-1', { includeIdentifiers: true });
    const rec = report.recommendations.find((r) => r.code === 'cipp_auth_rejected');
    expect(rec?.text).toBe(text);
    expect(rec?.messageKey).toBeUndefined();
  });

  it('keeps the legacy cippAuthRejected key and text when the probe carries no error', async () => {
    hoisted.probe = { ...hoisted.probe, outcome: 'auth_rejected', authRejected: true, status: 401, tenants: [] };
    const report = await runEntraConnectionDiagnostics('tenant-1', { includeIdentifiers: true });
    const rec = report.recommendations.find((r) => r.code === 'cipp_auth_rejected');
    expect(rec?.messageKey).toBe('cippAuthRejected');
    expect(rec?.text).toMatch(/rejected the legacy API key.*CIPP API client/);
  });

  it('reports an HTML response under cipp_html_response, not cipp_invalid_payload', async () => {
    hoisted.probe = {
      ...hoisted.probe,
      outcome: 'html_response',
      status: 200,
      error: 'CIPP answered with a web page instead of API data: the API URL is missing /api or points at the wrong host.',
      tenants: [],
    };
    const report = await runEntraConnectionDiagnostics('tenant-1', { includeIdentifiers: true });
    const steps = stepsById(report);
    expect(steps.cipp_reachable.status).toBe('fail');
    expect(steps.cipp_tenant_list.status).toBe('skip');
    const rec = report.recommendations.find((r) => r.code === 'cipp_html_response');
    expect(rec?.text).toMatch(/missing \/api or points at the wrong host/);
    expect(rec?.messageKey).toBeUndefined();
    expect(report.recommendations.some((r) => r.code === 'cipp_invalid_payload')).toBe(false);
  });

  it('fails reachability on timeout/DNS', async () => {
    hoisted.probe = { ...hoisted.probe, outcome: 'unreachable', reachable: false, networkCode: 'ETIMEDOUT', tenants: [] };
    const report = await runEntraConnectionDiagnostics('tenant-1', { includeIdentifiers: true });
    const steps = stepsById(report);
    expect(steps.cipp_reachable.status).toBe('fail');
    expect(report.recommendations.some((r) => r.code === 'cipp_unreachable')).toBe(true);
  });

  it('fails the CIPP mapping comparison and nulls the count when mappings cannot be read', async () => {
    hoisted.mappingsError = new Error('mapping lookup exploded');
    const report = await runEntraConnectionDiagnostics('tenant-1', { includeIdentifiers: true });
    const steps = stepsById(report);
    expect(steps.cipp_mappings_vs_list.status).toBe('fail');
    expect((steps.cipp_mappings_vs_list.data as any)?.mappingsUnavailable).toBe(true);
    expect(report.recommendations.some((r) => r.code === 'mappings_lookup_failed')).toBe(true);
    expect(report.summary.mappedClientCount).toBeNull();
    // Independent CIPP checks still ran.
    expect(steps.cipp_reachable.status).toBe('pass');
    expect(steps.cipp_tenant_list.status).toBe('warn');
  });
});

describe('CIPP API-client token mint diagnostic', () => {
  const SECRET = 'client-secret-VALUE-4471';
  const API_CLIENT = {
    authType: 'api_client',
    baseUrl: 'https://cipp.test',
    clientId: 'client-1',
    clientSecret: SECRET,
    directoryId: 'dir-1',
  };

  function mintWith(response: { ok: boolean; status: number; body: unknown }) {
    const fetch = vi.fn(async () => ({
      ok: response.ok,
      status: response.status,
      text: async () => JSON.stringify(response.body),
    }));
    setCippTokenServiceForTests(new CippTokenService({ fetch: fetch as unknown as CippFetch }));
    return fetch;
  }

  beforeEach(() => {
    hoisted.creds = API_CLIENT;
    hoisted.probe = {
      outcome: 'ok', reachable: true, authRejected: false, status: 200,
      endpoint: 'https://cipp.test/api/listtenants', attempted: ['https://cipp.test/api/listtenants'], tenants: [],
    };
    hoisted.mappingsError = null;
  });

  it('runs a token mint check ahead of reachability and passes for a working client', async () => {
    mintWith({ ok: true, status: 200, body: { access_token: 'minted-abc', expires_in: 3600 } });
    const report = await runEntraConnectionDiagnostics('tenant-1', { includeIdentifiers: true });
    const ids = report.steps.map((s: any) => s.id);
    const steps = stepsById(report);

    expect(ids.indexOf('cipp_token_mint')).toBeGreaterThan(ids.indexOf('cipp_credentials_present'));
    expect(ids.indexOf('cipp_token_mint')).toBeLessThan(ids.indexOf('cipp_reachable'));
    expect(steps.cipp_token_mint.status).toBe('pass');
    expect(steps.cipp_reachable.status).toBe('pass');
    expect(JSON.stringify(report)).not.toContain('minted-abc');
    expect(JSON.stringify(report)).not.toContain(SECRET);
  });

  it('fails the mint with an actionable recommendation and blocks the CIPP checks that need a token', async () => {
    mintWith({
      ok: false,
      status: 401,
      body: { error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret', error_codes: [7000215] },
    });
    const report = await runEntraConnectionDiagnostics('tenant-1', { includeIdentifiers: true });
    const steps = stepsById(report);

    expect(steps.cipp_token_mint.status).toBe('fail');
    expect(steps.cipp_reachable.status).toBe('skip');
    expect(steps.cipp_auth.status).toBe('skip');
    expect(steps.cipp_tenant_list.status).toBe('skip');
    const rec = report.recommendations.find((r) => r.code === 'cipp_token_mint_failed');
    expect(rec?.text).toMatch(/secret ID instead of its Value/);
  });

  it('reports a rejected identifier URI as its own recommendation', async () => {
    mintWith({
      ok: false,
      status: 400,
      body: { error: 'invalid_resource', error_description: 'AADSTS500011: resource not found', error_codes: [500011] },
    });
    const report = await runEntraConnectionDiagnostics('tenant-1', { includeIdentifiers: true });
    const rec = report.recommendations.find((r) => r.code === 'cipp_token_scope_rejected');
    expect(rec?.text).toMatch(/Repair Identifier URI/);
  });

  it('is not applicable to a legacy connection, and does not block the CIPP checks', async () => {
    hoisted.creds = { baseUrl: 'https://cipp.test', apiToken: 'k' };
    const fetch = mintWith({ ok: true, status: 200, body: {} });
    const report = await runEntraConnectionDiagnostics('tenant-1', { includeIdentifiers: true });
    const steps = stepsById(report);

    expect(steps.cipp_token_mint.status).toBe('skip');
    expect((steps.cipp_token_mint.data as any).reason).toMatch(/Not applicable/);
    expect(steps.cipp_reachable.status).toBe('pass');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the client secret out of the redacted export', async () => {
    mintWith({ ok: true, status: 200, body: { access_token: 'eyJhbGciOiJSUzI1NiJ9.eyJhdWQiOiJ4In0.c2lnbmF0dXJl', expires_in: 3600 } });
    const report = await runEntraConnectionDiagnostics('tenant-1', { includeIdentifiers: false });
    const redacted = JSON.stringify(applyReportRedaction(report, false));
    expect(redacted).not.toContain(SECRET);
    expect(redacted).not.toContain('c2lnbmF0dXJl');
  });
});
