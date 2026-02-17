import axios from 'axios';
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

function axios401Error(): any {
  const err: any = new Error('Request failed with status code 401');
  err.isAxiosError = true;
  err.response = { status: 401, data: { detail: 'Unauthorized' } };
  return err;
}

describe('Tactical RMM connection test (API key)', () => {
  beforeEach(() => {
    const secrets = new Map<string, string>([
      ['tacticalrmm_instance_url', 'https://tactical.example'],
      ['tacticalrmm_api_key', 'api_abcdefghijklmnop'],
    ]);

    secretProvider = {
      getTenantSecret: vi.fn(async (_tenant: string, key: string) => secrets.get(key) ?? null),
    };

    knexMock = vi.fn((_table: string) => ({
      where: vi.fn().mockReturnThis(),
      first: vi.fn(async () => ({
        instance_url: 'https://tactical.example',
        settings: { auth_mode: 'api_key' },
      })),
    }));
  });

  it('uses X-API-KEY header and surfaces 401 as invalid credentials', async () => {
    const getSpy = vi.spyOn(axios, 'get').mockRejectedValueOnce(axios401Error());

    const { testTacticalRmmConnection } = await import(
      '@alga-psa/msp-composition/integrations'
    );

    const res = await testTacticalRmmConnection({} as any, { tenant: 'tenant_1' });
    expect(res.success).toBe(false);
    expect(res.error).toBe('Unauthorized (401): invalid credentials or token expired.');

    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).toHaveBeenCalledWith(
      'https://tactical.example/api/beta/v1/client/',
      expect.objectContaining({
        headers: { 'X-API-KEY': 'api_abcdefghijklmnop' },
        timeout: 15_000,
      })
    );
  });
});

