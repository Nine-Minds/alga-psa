import { describe, expect, it, vi, beforeEach } from 'vitest';

// These are server actions (Next "use server") so we unit-test by mocking the wrappers and dependencies,
// then calling the underlying handler directly.

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

describe('Tactical RMM settings secret masking', () => {
  beforeEach(() => {
    const secrets = new Map<string, string>([
      ['tacticalrmm_instance_url', 'https://tactical.example'],
      ['tacticalrmm_api_key', 'api_abcdefghijklmnop'],
      ['tacticalrmm_username', 'admin'],
      ['tacticalrmm_knox_token', 'knox_1234567890abcdef'],
    ]);

    secretProvider = {
      getTenantSecret: vi.fn(async (_tenant: string, key: string) => secrets.get(key) ?? null),
    };

    knexMock = vi.fn((_table: string) => ({
      where: vi.fn().mockReturnThis(),
      first: vi.fn(async () => ({
        instance_url: 'https://tactical.example',
        is_active: false,
        connected_at: null,
        sync_error: null,
        settings: { auth_mode: 'api_key' },
      })),
    }));
  });

  it('masks API key and Knox token with only the last 4 characters visible', async () => {
    const { getTacticalRmmSettings } = await import(
      '@alga-psa/msp-composition/integrations'
    );

    const res = await getTacticalRmmSettings({} as any, { tenant: 'tenant_1' });
    expect(res.success).toBe(true);

    // api_abcdefghijklmnop -> bullets + 'mnop'
    expect(res.credentials?.apiKeyMasked).toBe(`${'•'.repeat('api_abcdefghijklmnop'.length - 4)}mnop`);
    // knox_1234567890abcdef -> bullets + 'cdef'
    expect(res.credentials?.knoxTokenMasked).toBe(
      `${'•'.repeat('knox_1234567890abcdef'.length - 4)}cdef`
    );
  });
});
