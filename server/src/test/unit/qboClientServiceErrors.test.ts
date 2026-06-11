import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios', () => {
  const request = vi.fn();
  const post = vi.fn();
  return {
    default: {
      request,
      post,
      isAxiosError: (err: any) => err?.isAxiosError === true,
    },
  };
});

vi.mock('@alga-psa/core/secrets', () => {
  const baseCredentials = {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    realmId: 'realm-1',
    accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    refreshTokenExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
  };
  return {
    getSecretProviderInstance: vi.fn(async () => ({
      getTenantSecret: vi.fn(async (tenantId: string) => {
        const credentials =
          tenantId === 'tenant-expired'
            ? { ...baseCredentials, accessTokenExpiresAt: new Date(Date.now() - 60 * 1000).toISOString() }
            : baseCredentials;
        return JSON.stringify({ 'realm-1': credentials });
      }),
      setTenantSecret: vi.fn(async () => undefined),
      getAppSecret: vi.fn(async (name: string) =>
        name === 'qbo_client_id' ? 'client-id' : name === 'qbo_client_secret' ? 'client-secret' : null
      ),
    })),
  };
});

import axios from 'axios';
import { QboClientService } from '@alga-psa/integrations/lib/qbo/qboClientService';
import { AppError } from '@alga-psa/core';

const INTUIT_TID = 'tid-12345-abcde';

function axiosError(
  status: number | undefined,
  data: unknown,
  headers: Record<string, string> = {},
  config: Record<string, unknown> = {}
) {
  return {
    isAxiosError: true,
    message: status ? `Request failed with status code ${status}` : 'Network Error',
    response: status !== undefined ? { status, data, headers } : undefined,
    config,
  };
}

function faultResponse(code: string, message: string, type = 'ValidationFault') {
  return {
    Fault: { type, Error: [{ Message: message, Detail: `${message} detail`, code }] },
    time: '2026-06-10T00:00:00Z',
  };
}

describe('QboClientService intuit_tid capture and fault mapping', () => {
  beforeEach(() => {
    vi.mocked(axios.request).mockReset();
    vi.mocked(axios.post).mockReset();
  });

  it('captures intuit_tid on a QBO validation fault and maps it to QBO_VALIDATION_ERROR', async () => {
    vi.mocked(axios.request).mockRejectedValue(
      axiosError(400, faultResponse('2500', 'Invalid Reference Id'), { intuit_tid: INTUIT_TID })
    );

    const client = await QboClientService.create('tenant-a', 'realm-1');
    const error = await client.create('Invoice', { Line: [] }).catch((err) => err);

    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe('QBO_VALIDATION_ERROR');
    expect(error.message).toContain('Invalid Reference Id');
    expect(error.message).toContain(`intuit_tid: ${INTUIT_TID}`);
    expect(error.details?.intuitTid).toBe(INTUIT_TID);
  });

  it('captures intuit_tid on a 404 not-found response', async () => {
    vi.mocked(axios.request).mockRejectedValue(
      axiosError(404, { Fault: { type: 'ValidationFault', Error: [] } }, { intuit_tid: INTUIT_TID })
    );

    const client = await QboClientService.create('tenant-a', 'realm-1');
    // read() converts not-found into null, so call query() to observe the raw error
    const error = await client.query('SELECT * FROM Invoice').catch((err) => err);

    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe('QBO_NOT_FOUND');
    expect(error.details?.intuitTid).toBe(INTUIT_TID);
  });

  it('omits intuit_tid cleanly when the header is absent', async () => {
    vi.mocked(axios.request).mockRejectedValue(
      axiosError(500, faultResponse('10000', 'Server Error', 'SystemFault'))
    );

    const client = await QboClientService.create('tenant-a', 'realm-1');
    const error = await client.create('Invoice', { Line: [] }).catch((err) => err);

    expect(error).toBeInstanceOf(AppError);
    expect(error.message).not.toContain('intuit_tid');
    expect(error.details?.intuitTid).toBeUndefined();
  });

  it('maps Intuit code 5010 to QBO_STALE_OBJECT (SyncToken mismatch)', async () => {
    vi.mocked(axios.request).mockRejectedValue(
      axiosError(400, faultResponse('5010', 'Stale Object Error'))
    );

    const client = await QboClientService.create('tenant-a', 'realm-1');
    const error = await client.update('Invoice', { Id: '1', SyncToken: '0' }).catch((err) => err);

    expect(error.code).toBe('QBO_STALE_OBJECT');
    expect(error.message).toContain('SyncToken');
  });

  it('maps Intuit code 6240 to QBO_DUPLICATE_NAME', async () => {
    vi.mocked(axios.request).mockRejectedValue(
      axiosError(400, faultResponse('6240', 'Duplicate Name Exists Error'))
    );

    const client = await QboClientService.create('tenant-a', 'realm-1');
    const error = await client.create('Customer', { DisplayName: 'Acme' }).catch((err) => err);

    expect(error.code).toBe('QBO_DUPLICATE_NAME');
    expect(error.message).toContain('already exists');
  });
});

describe('QboClientService does not leak credentials into error details', () => {
  beforeEach(() => {
    vi.mocked(axios.request).mockReset();
    vi.mocked(axios.post).mockReset();
  });

  it('sanitizes the axios error when a token refresh fails', async () => {
    vi.mocked(axios.post).mockRejectedValue(
      axiosError(
        400,
        { error: 'invalid_grant' },
        { intuit_tid: INTUIT_TID },
        {
          headers: { Authorization: 'Basic c3VwZXItc2VjcmV0' },
          data: 'grant_type=refresh_token&refresh_token=super-secret-refresh',
        }
      )
    );

    const error = await QboClientService.create('tenant-expired', 'realm-1').catch((err) => err);

    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe('QBO_AUTH_ERROR');
    expect(error.details?.intuitTid).toBe(INTUIT_TID);
    const serialized = JSON.stringify(error.details);
    expect(serialized).not.toContain('Authorization');
    expect(serialized).not.toContain('c3VwZXItc2VjcmV0');
    expect(serialized).not.toContain('super-secret-refresh');
  });

  it('sanitizes network-level axios errors that carry the request config', async () => {
    vi.mocked(axios.request).mockRejectedValue(
      axiosError(undefined, undefined, {}, { headers: { Authorization: 'Bearer access-token' } })
    );

    const client = await QboClientService.create('tenant-a', 'realm-1');
    const error = await client.create('Invoice', { Line: [] }).catch((err) => err);

    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe('QBO_API_ERROR');
    expect(error.message).toContain('Network Error');
    const serialized = JSON.stringify(error.details);
    expect(serialized).not.toContain('Authorization');
    expect(serialized).not.toContain('Bearer access-token');
  });
});
