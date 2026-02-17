import { beforeEach, describe, expect, it, vi } from 'vitest';

let secretProvider: { getTenantSecret: (tenant: string, key: string) => Promise<string | null> };
let knexMock: any;
let remoteClients: any[] = [];

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

// Mock the Tactical API client so org sync doesn't hit the network.
vi.mock('@alga-psa/integrations/lib/rmm/tacticalrmm/tacticalApiClient', async () => {
  const actual: any = await vi.importActual(
    '@alga-psa/integrations/lib/rmm/tacticalrmm/tacticalApiClient'
  );

  class TacticalRmmClientMock {
    async listAllBeta() {
      return remoteClients;
    }
  }

  return {
    ...actual,
    TacticalRmmClient: TacticalRmmClientMock,
  };
});

describe('Tactical org sync upserts rmm_organization_mappings', () => {
  beforeEach(() => {
    secretProvider = {
      getTenantSecret: vi.fn(async (_tenant: string, key: string) => {
        if (key === 'tacticalrmm_api_key') return 'api_key';
        return null;
      }),
    };

    const orgMappings = new Map<string, any>(); // externalId -> row
    const integrationRow = {
      integration_id: 'integration_1',
      instance_url: 'https://tactical.example',
      settings: { auth_mode: 'api_key' },
    };

    // Seed existing mapping for external id "1"
    orgMappings.set('1', {
      tenant: 'tenant_1',
      integration_id: 'integration_1',
      external_organization_id: '1',
      external_organization_name: 'Old Name',
      metadata: { id: 1, name: 'Old Name' },
    });

    knexMock = ((table: string) => {
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
          select: vi.fn(async () =>
            Array.from(orgMappings.values()).map((r) => ({
              external_organization_id: r.external_organization_id,
            }))
          ),
          insert: (row: any) => ({
            onConflict: (_cols: string[]) => ({
              merge: async (_merge: any) => {
                const externalId = String(row.external_organization_id);
                const existing = orgMappings.get(externalId);
                if (existing) {
                  orgMappings.set(externalId, { ...existing, ...row });
                } else {
                  orgMappings.set(externalId, row);
                }
              },
            }),
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }) as any;

    knexMock.fn = { now: vi.fn(() => new Date()) };

    // Expose map for assertions via a property on knexMock.
    (knexMock as any).__orgMappings = orgMappings;
  });

  it('creates new org rows and updates existing org rows on rerun', async () => {
    const { syncTacticalRmmOrganizations } = await import(
      '@alga-psa/msp-composition/integrations'
    );

    remoteClients = [
      { id: 1, name: 'New Name', foo: 'bar' },
      { id: 2, name: 'Client Two' },
    ];

    const first = await syncTacticalRmmOrganizations({ user_id: 'u1' } as any, { tenant: 'tenant_1' });
    expect(first.success).toBe(true);
    expect(first.items_processed).toBe(2);
    expect(first.items_created).toBe(1);
    expect(first.items_updated).toBe(1);
    expect(first.items_failed).toBe(0);

    const orgMappings: Map<string, any> = (knexMock as any).__orgMappings;
    expect(orgMappings.size).toBe(2);
    expect(orgMappings.get('1')?.external_organization_name).toBe('New Name');
    expect(orgMappings.get('1')?.metadata?.foo).toBe('bar');
    expect(orgMappings.get('2')?.external_organization_name).toBe('Client Two');

    remoteClients = [
      { id: 1, name: 'Newest Name' },
      { id: 2, name: 'Client Two' },
    ];

    const second = await syncTacticalRmmOrganizations({ user_id: 'u1' } as any, { tenant: 'tenant_1' });
    expect(second.success).toBe(true);
    expect(second.items_processed).toBe(2);
    expect(second.items_created).toBe(0);
    expect(second.items_updated).toBe(2);
    expect(orgMappings.get('1')?.external_organization_name).toBe('Newest Name');
  });
});

