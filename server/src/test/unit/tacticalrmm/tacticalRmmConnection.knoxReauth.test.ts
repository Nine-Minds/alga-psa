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

function axios401Error(): any {
  const err: any = new Error('Request failed with status code 401');
  err.isAxiosError = true;
  err.response = { status: 401, data: { detail: 'Unauthorized' } };
  return err;
}

describe('Tactical RMM connection test (Knox) re-auth on 401', () => {
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

  it('retries login once when token verification returns 401, using Authorization: Token ...', async () => {
    const postSpy = vi.spyOn(axios, 'post').mockImplementation(async (url: any, data: any) => {
      const u = String(url);
      if (u.endsWith('/api/v2/checkcreds/')) {
        return { data: { totp: false } } as any;
      }
      if (u.endsWith('/api/v2/login/')) {
        // Return token1 then token2.
        const current = (postSpy as any).mock.calls.filter((c: any[]) => String(c[0]).endsWith('/api/v2/login/')).length;
        return { data: { token: current === 1 ? 'token1' : 'token2' } } as any;
      }
      throw new Error(`Unexpected POST: ${u}`);
    });

    const authHeaders: string[] = [];
    const getSpy = vi.spyOn(axios, 'get').mockImplementation(async (_url: any, config: any) => {
      const auth = String(config?.headers?.Authorization || '');
      authHeaders.push(auth);
      if (auth === 'Token token1') {
        throw axios401Error();
      }
      return { data: [{ id: 1, name: 'Mock Client' }] } as any;
    });

    const { testTacticalRmmConnection } = await import(
      '@alga-psa/msp-composition/integrations'
    );

    const res = await testTacticalRmmConnection({} as any, { tenant: 'tenant_1' });
    expect(res.success).toBe(true);

    // checkcreds once, login twice
    expect(postSpy.mock.calls.filter((c) => String(c[0]).endsWith('/api/v2/checkcreds/')).length).toBe(1);
    expect(postSpy.mock.calls.filter((c) => String(c[0]).endsWith('/api/v2/login/')).length).toBe(2);

    // verify token called twice with proper header.
    expect(getSpy).toHaveBeenCalledTimes(2);
    expect(authHeaders).toEqual(['Token token1', 'Token token2']);

    // token is persisted after retry
    expect((secretProvider.setTenantSecret as any).mock.calls.some((c: any[]) => c[1] === 'tacticalrmm_knox_token' && c[2] === 'token2')).toBe(true);
  });
});

