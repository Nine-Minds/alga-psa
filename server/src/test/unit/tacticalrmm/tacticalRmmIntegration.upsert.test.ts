import { beforeEach, describe, expect, it, vi } from 'vitest';

let secretProvider: {
  getTenantSecret: (tenant: string, key: string) => Promise<string | null>;
  setTenantSecret: (tenant: string, key: string, value: string) => Promise<void>;
  deleteTenantSecret: (tenant: string, key: string) => Promise<void>;
};

let knexMock: any;
let rows: Map<string, any>;

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

describe('Tactical RMM integration row upsert', () => {
  beforeEach(() => {
    const secrets = new Map<string, string>();

    secretProvider = {
      getTenantSecret: vi.fn(async (_tenant: string, key: string) => secrets.get(key) ?? null),
      setTenantSecret: vi.fn(async (_tenant: string, key: string, value: string) => {
        secrets.set(key, value);
      }),
      deleteTenantSecret: vi.fn(async (_tenant: string, key: string) => {
        secrets.delete(key);
      }),
    };

    rows = new Map<string, any>(); // key: `${tenant}:${provider}`
    let idSeq = 0;

    const makeId = () => `integration_${++idSeq}`;

    knexMock = ((table: string) => {
      if (table !== 'rmm_integrations') {
        throw new Error(`Unexpected table: ${table}`);
      }

      return {
        insert: (insertRow: any) => ({
          onConflict: (_cols: string[]) => ({
            merge: (_merge: any) => ({
              returning: async (_colsReturning: string[]) => {
                const key = `${insertRow.tenant}:${insertRow.provider}`;
                const existing = rows.get(key);
                if (existing) {
                  // Simulate onConflict merge: update the row but keep the same integration_id.
                  const merged = { ...existing, ...insertRow };
                  merged.integration_id = existing.integration_id;
                  rows.set(key, merged);
                  return [merged];
                }

                const created = { ...insertRow, integration_id: makeId() };
                rows.set(key, created);
                return [created];
              },
            }),
          }),
        }),
      };
    }) as any;

    knexMock.raw = vi.fn((sql: string) => ({ __raw: sql }));
  });

  it('creates one row per tenant+provider and updates it on subsequent saves', async () => {
    const { saveTacticalRmmConfiguration } = await import(
      '@alga-psa/msp-composition/integrations'
    );

    const tenant = 'tenant_1';
    const key = `${tenant}:tacticalrmm`;

    const res1 = await saveTacticalRmmConfiguration(
      {} as any,
      { tenant },
      {
        instanceUrl: 'https://tactical.example/',
        authMode: 'api_key',
        apiKey: 'api_key_1',
      }
    );
    expect(res1.success).toBe(true);

    const row1 = rows.get(key);
    expect(row1).toBeTruthy();
    expect(row1.provider).toBe('tacticalrmm');
    expect(row1.instance_url).toBe('https://tactical.example');
    expect(row1.is_active).toBe(false);
    expect(row1.settings?.auth_mode).toBe('api_key');
    const id1 = row1.integration_id;

    // Update instance URL and key; should not create a second row.
    const res2 = await saveTacticalRmmConfiguration(
      {} as any,
      { tenant },
      {
        instanceUrl: 'https://tactical2.example',
        authMode: 'api_key',
        apiKey: 'api_key_2',
      }
    );
    expect(res2.success).toBe(true);

    expect(rows.size).toBe(1);
    const row2 = rows.get(key);
    expect(row2).toBeTruthy();
    expect(row2.instance_url).toBe('https://tactical2.example');
    expect(row2.integration_id).toBe(id1);
  });
});
