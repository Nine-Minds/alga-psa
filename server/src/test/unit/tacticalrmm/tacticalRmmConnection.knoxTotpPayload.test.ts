import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let secretProvider: {
  getTenantSecret: (tenant: string, key: string) => Promise<string | null>;
  setTenantSecret: (tenant: string, key: string, value: string) => Promise<void>;
};
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

describe('Tactical RMM connection test (Knox) TOTP payload behavior', () => {
  beforeEach(() => {
    const secrets = new Map<string, string>([
      ['tacticalrmm_instance_url', 'https://tactical.example'],
      ['tacticalrmm_username', 'admin'],
      ['tacticalrmm_password', 'password123'],
    ]);

    secretProvider = {
      getTenantSecret: vi.fn(async (_tenant: string, key: string) => secrets.get(key) ?? null),
      setTenantSecret: vi.fn(async (_tenant: string, key: string, value: string) => {
        secrets.set(key, value);
      }),
    };

    const qb: any = {
      where: vi.fn().mockReturnThis(),
      first: vi.fn(async () => ({
        instance_url: 'https://tactical.example',
        settings: { auth_mode: 'knox' },
      })),
      update: vi.fn(async () => 1),
    };
    knexMock = vi.fn((_table: string) => qb);
    knexMock.fn = { now: vi.fn(() => new Date()) };
  });

  it('includes twofactor when checkcreds indicates TOTP is required', async () => {
    const posted: Array<{ url: string; data: any }> = [];
    vi.spyOn(axios, 'post').mockImplementation(async (url: any, data: any) => {
      const u = String(url);
      posted.push({ url: u, data });
      if (u.endsWith('/api/v2/checkcreds/')) return { data: { totp: true } } as any;
      if (u.endsWith('/api/v2/login/')) return { data: { token: 'token_totp' } } as any;
      throw new Error(`Unexpected POST: ${u}`);
    });
    vi.spyOn(axios, 'get').mockResolvedValue({ data: [] } as any);

    const { testTacticalRmmConnection } = await import(
      '@alga-psa/msp-composition/integrations'
    );

    const res = await testTacticalRmmConnection({} as any, { tenant: 'tenant_1' }, { totpCode: '123456' });
    expect(res.success).toBe(true);

    const login = posted.find((p) => p.url.endsWith('/api/v2/login/'));
    expect(login?.data?.twofactor).toBe('123456');
  });

  it('does not include twofactor when checkcreds indicates TOTP is not required', async () => {
    const posted: Array<{ url: string; data: any }> = [];
    vi.spyOn(axios, 'post').mockImplementation(async (url: any, data: any) => {
      const u = String(url);
      posted.push({ url: u, data });
      if (u.endsWith('/api/v2/checkcreds/')) return { data: { totp: false } } as any;
      if (u.endsWith('/api/v2/login/')) return { data: { token: 'token_plain' } } as any;
      throw new Error(`Unexpected POST: ${u}`);
    });
    vi.spyOn(axios, 'get').mockResolvedValue({ data: [] } as any);

    const { testTacticalRmmConnection } = await import(
      '@alga-psa/msp-composition/integrations'
    );

    const res = await testTacticalRmmConnection({} as any, { tenant: 'tenant_1' });
    expect(res.success).toBe(true);

    const login = posted.find((p) => p.url.endsWith('/api/v2/login/'));
    expect(login?.data?.twofactor).toBeUndefined();
  });
});

