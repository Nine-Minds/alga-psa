import { afterEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { XeroClientService } from './xeroClientService';

/**
 * Token-refresh classification through the real client with mocked HTTP.
 * Terminal failures must surface as reconnect-required codes so the sync cycle
 * can file a connection-expired exception; transient failures stay retryable.
 */

function makeClient(): any {
  const client = Object.create(XeroClientService.prototype) as any;
  client.tenantId = 'refresh-tenant';
  client.connection = { connectionId: 'refresh-connection', refreshToken: 'test-token' };
  client.appSecrets = { clientId: 'test-id', clientSecret: 'test-secret' };
  client.connections = { 'refresh-connection': client.connection };
  return client;
}

function axiosRejection(status: number, data: Record<string, unknown>) {
  return {
    isAxiosError: true,
    message: `Request failed with status code ${status}`,
    response: { status, headers: {}, data }
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Xero refresh-token classification', () => {
  it('classifies HTTP 400 invalid_grant as reconnect-required', async () => {
    const client = makeClient();
    vi.spyOn(axios, 'post').mockRejectedValue(
      axiosRejection(400, { error: 'invalid_grant', error_description: 'Refresh token revoked' })
    );

    let failure: any;
    try {
      await client.refreshAccessToken(true);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeTruthy();
    expect(['XERO_REFRESH_FAILED', 'XERO_REFRESH_EXPIRED', 'XERO_UNAUTHORIZED']).toContain(failure.code);
  });

  it('classifies HTTP 401 as reconnect-required', async () => {
    const client = makeClient();
    vi.spyOn(axios, 'post').mockRejectedValue(axiosRejection(401, { error: 'unauthorized_client' }));

    let failure: any;
    try {
      await client.refreshAccessToken(true);
    } catch (error) {
      failure = error;
    }

    expect(['XERO_REFRESH_FAILED', 'XERO_REFRESH_EXPIRED', 'XERO_UNAUTHORIZED']).toContain(failure.code);
  });

  it('keeps a transient 500 retryable (not reconnect-required)', async () => {
    const client = makeClient();
    vi.spyOn(axios, 'post').mockRejectedValue(axiosRejection(500, { message: 'temporary' }));

    let failure: any;
    try {
      await client.refreshAccessToken(true);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeTruthy();
    expect(['XERO_REFRESH_FAILED', 'XERO_REFRESH_EXPIRED', 'XERO_UNAUTHORIZED']).not.toContain(failure.code);
  });
});
