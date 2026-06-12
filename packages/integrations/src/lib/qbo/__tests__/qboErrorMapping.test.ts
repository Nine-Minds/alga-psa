/**
 * Tests for QboClientService's normalization of QuickBooks API faults
 * into typed AppErrors (stale object, validation, auth, not-found).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tenantSecrets = new Map<string, string>();
const appSecrets = new Map<string, string>();

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getTenantSecret: async (tenant: string, key: string) => tenantSecrets.get(`${tenant}:${key}`) || null,
    getAppSecret: async (key: string) => appSecrets.get(key) || null,
    setTenantSecret: async (tenant: string, key: string, value: string) => {
      tenantSecrets.set(`${tenant}:${key}`, value);
    }
  })
}));

const axiosRequestMock = vi.fn();

vi.mock('axios', () => {
  const axios = {
    request: (...args: unknown[]) => axiosRequestMock(...args),
    post: vi.fn(),
    isAxiosError: (error: unknown) => Boolean((error as any)?.isAxiosError)
  };
  return { default: axios, ...axios };
});

import { QboClientService } from '../qboClientService';

const TENANT = 'tenant-1';
const REALM = 'realm-1';
const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();

async function createService(): Promise<QboClientService> {
  tenantSecrets.clear();
  appSecrets.clear();
  tenantSecrets.set(
    `${TENANT}:qbo_credentials`,
    JSON.stringify({
      [REALM]: {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        realmId: REALM,
        accessTokenExpiresAt: FUTURE,
        refreshTokenExpiresAt: FUTURE
      }
    })
  );
  appSecrets.set('qbo_client_id', 'qbo-client-id');
  appSecrets.set('qbo_client_secret', 'qbo-client-secret');
  return QboClientService.create(TENANT, REALM);
}

function qboFaultRejection(status: number, errorDetail: Record<string, unknown>) {
  return {
    isAxiosError: true,
    response: {
      status,
      data: { Fault: { Error: [errorDetail] } }
    }
  };
}

describe('QboClientService error mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps QBO stale-object fault (code 6240) to QBO_STALE_OBJECT', async () => {
    const service = await createService();
    axiosRequestMock.mockRejectedValueOnce(
      qboFaultRejection(400, { Message: 'Stale Object Error', code: '6240', Detail: 'SyncToken mismatch' })
    );

    const error: any = await service
      .update('Invoice', { Id: '1', SyncToken: '0' })
      .catch((e) => e);

    expect(error.code).toBe('QBO_STALE_OBJECT');
    expect(error.message).toContain('SyncToken mismatch');
    expect(error.message).toContain('Invoice');
  });

  it('maps QBO validation faults (2xxx codes) to QBO_VALIDATION_ERROR', async () => {
    const service = await createService();
    axiosRequestMock.mockRejectedValueOnce(
      qboFaultRejection(400, { Message: 'Invalid Reference Id', code: '2500', Detail: 'Bad customer ref' })
    );

    const error: any = await service.create('Invoice', { Line: [] }).catch((e) => e);

    expect(error.code).toBe('QBO_VALIDATION_ERROR');
    expect(error.message).toContain('Invalid Reference Id');
    expect(error.message).toContain('2500');
  });

  it('maps QBO auth faults (4xxx/5xxx codes) to QBO_AUTH_ERROR', async () => {
    const service = await createService();
    axiosRequestMock.mockRejectedValueOnce(
      qboFaultRejection(403, { Message: 'AuthorizationFault', code: '5020', Detail: 'Permission denied' })
    );

    const error: any = await service.create('Invoice', { Line: [] }).catch((e) => e);

    expect(error.code).toBe('QBO_AUTH_ERROR');
  });

  it('maps QBO entity-deleted fault (code 610) to QBO_NOT_FOUND', async () => {
    const service = await createService();
    axiosRequestMock.mockRejectedValueOnce(
      qboFaultRejection(400, { Message: 'Object Not Found', code: '610', Detail: 'Deleted entity' })
    );

    const error: any = await service.create('Payment', { Line: [] }).catch((e) => e);

    expect(error.code).toBe('QBO_NOT_FOUND');
    expect(error.message).toBe('QBO Payment not found.');
  });

  it('maps HTTP 404 responses to QBO_NOT_FOUND and read() converts them to null', async () => {
    const service = await createService();
    axiosRequestMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 404, data: {} }
    });

    await expect(service.read('Customer', 'missing-id')).resolves.toBeNull();
  });

  it('rejects update calls that lack Id or SyncToken before any HTTP request is made', async () => {
    const service = await createService();
    axiosRequestMock.mockClear();

    const error: any = await service
      .update('Customer', { Id: '', SyncToken: '' } as any)
      .catch((e) => e);

    expect(error.code).toBe('QBO_INVALID_INPUT');
    expect(axiosRequestMock).not.toHaveBeenCalled();
  });

  it('keeps unrecognized fault codes as generic QBO_API_ERROR with operation context', async () => {
    const service = await createService();
    axiosRequestMock.mockRejectedValueOnce(
      qboFaultRejection(500, { Message: 'Internal error', code: '10000', Detail: 'boom' })
    );

    const error: any = await service.create('Invoice', { Line: [] }).catch((e) => e);

    expect(error.code).toBe('QBO_API_ERROR');
    expect(error.message).toContain('create');
    expect(error.message).toContain('Invoice');
    expect(error.message).toContain('Internal error');
  });
});
