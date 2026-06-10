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
  const credentials = {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    realmId: 'realm-1',
    accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    refreshTokenExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
  };
  return {
    getSecretProviderInstance: vi.fn(async () => ({
      getTenantSecret: vi.fn(async () => JSON.stringify({ 'realm-1': credentials })),
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

function axiosError(status: number, data: unknown, headers: Record<string, string> = {}) {
  return {
    isAxiosError: true,
    message: `Request failed with status code ${status}`,
    response: { status, data, headers },
  };
}

describe('QboClientService intuit_tid capture and fault mapping', () => {
  beforeEach(() => {
    vi.mocked(axios.request).mockReset();
    vi.mocked(axios.post).mockReset();
  });

  it('captures intuit_tid on a QBO validation fault and maps it to QBO_VALIDATION_ERROR', async () => {
    vi.mocked(axios.request).mockRejectedValue(
      axiosError(
        400,
        {
          Fault: {
            type: 'ValidationFault',
            Error: [
              {
                Message: 'Invalid Reference Id',
                Detail: 'Something you tried to reference does not exist',
                code: '2500',
              },
            ],
          },
          time: '2026-06-10T00:00:00Z',
        },
        { intuit_tid: INTUIT_TID }
      )
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
      axiosError(500, {
        Fault: {
          type: 'SystemFault',
          Error: [{ Message: 'Server Error', Detail: 'Internal error', code: '10000' }],
        },
      })
    );

    const client = await QboClientService.create('tenant-a', 'realm-1');
    const error = await client.create('Invoice', { Line: [] }).catch((err) => err);

    expect(error).toBeInstanceOf(AppError);
    expect(error.message).not.toContain('intuit_tid');
    expect(error.details?.intuitTid).toBeUndefined();
  });
});
