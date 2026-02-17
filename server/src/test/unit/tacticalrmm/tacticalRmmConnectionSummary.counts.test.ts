import { beforeEach, describe, expect, it, vi } from 'vitest';

let secretProvider: { getTenantSecret: (tenant: string, key: string) => Promise<string | null> };
let knexMock: any;

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => fn,
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => secretProvider),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: knexMock })),
}));

vi.mock('@alga-psa/assets/actions/assetActions', () => ({
  createAsset: vi.fn(),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(),
  publishWorkflowEvent: vi.fn(),
}));

describe('Tactical RMM connection summary counts', () => {
  beforeEach(() => {
    secretProvider = {
      getTenantSecret: vi.fn(async () => null),
    };

    const integrationRow = {
      integration_id: 'integration_1',
      instance_url: 'https://tactical.example',
      is_active: true,
      connected_at: new Date('2026-02-13T00:00:00.000Z'),
      last_sync_at: new Date('2026-02-13T01:00:00.000Z'),
      sync_error: null,
      settings: { auth_mode: 'api_key' },
    };

    const statusRows = [
      { agent_status: 'online', count: '2' },
      { agent_status: 'offline', count: '1' },
      { agent_status: 'overdue', count: '3' },
      { agent_status: null, count: '4' },
    ];

    knexMock = vi.fn((table: string) => {
      if (table === 'rmm_integrations') {
        return {
          where: vi.fn().mockReturnThis(),
          first: vi.fn(async () => integrationRow),
          update: vi.fn(async () => 1),
        };
      }

      if (table === 'rmm_organization_mappings') {
        return {
          where: vi.fn().mockReturnThis(),
          count: vi.fn().mockReturnThis(),
          first: vi.fn(async () => ({ count: '2' })),
        };
      }

      if (table === 'assets') {
        // Two different queries use this table: device count (whereNotNull) and status breakdown (groupBy).
        const qb: any = {
          where: vi.fn().mockReturnThis(),
          whereNotNull: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          count: vi.fn().mockReturnThis(),
          groupBy: vi.fn(async () => statusRows),
          first: vi.fn(async () => ({ count: '5' })),
        };
        return qb;
      }

      if (table === 'rmm_alerts') {
        return {
          where: vi.fn().mockReturnThis(),
          count: vi.fn().mockReturnThis(),
          first: vi.fn(async () => ({ count: '3' })),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });
  });

  it('returns mapped org/device/alert counts and status breakdown', async () => {
    const { getTacticalRmmConnectionSummary } = await import(
      '@alga-psa/msp-composition/integrations'
    );

    const res = await getTacticalRmmConnectionSummary({} as any, { tenant: 'tenant_1' });
    expect(res.success).toBe(true);
    expect(res.summary?.isActive).toBe(true);
    expect(res.summary?.instanceUrl).toBe('https://tactical.example');
    expect(res.summary?.authMode).toBe('api_key');

    expect(res.summary?.counts.mappedOrganizations).toBe(2);
    expect(res.summary?.counts.syncedDevices).toBe(5);
    expect(res.summary?.counts.activeAlerts).toBe(3);
    expect(res.summary?.counts.byAgentStatus).toEqual({
      online: 2,
      offline: 1,
      overdue: 3,
      unknown: 4,
    });
  });
});

