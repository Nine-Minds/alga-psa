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
  getEntraCippCredentials: vi.fn(async () => ({ baseUrl: 'https://cipp.test', apiToken: 'k' })),
}));

vi.mock('@ee/lib/integrations/entra/providers/cipp/cippProviderAdapter', () => ({
  CippProviderAdapter: class {
    async probeTenantList() {
      return hoisted.probe;
    }
  },
}));

vi.mock('@ee/lib/integrations/entra/mapping/confirmedMappingsService', () => ({
  listConfirmedEntraMappings: vi.fn(async () => []),
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

  it('fails reachability on timeout/DNS', async () => {
    hoisted.probe = { ...hoisted.probe, outcome: 'unreachable', reachable: false, networkCode: 'ETIMEDOUT', tenants: [] };
    const report = await runEntraConnectionDiagnostics('tenant-1', { includeIdentifiers: true });
    const steps = stepsById(report);
    expect(steps.cipp_reachable.status).toBe('fail');
    expect(report.recommendations.some((r) => r.code === 'cipp_unreachable')).toBe(true);
  });
});
