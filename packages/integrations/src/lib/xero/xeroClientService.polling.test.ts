import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';

const getSecretProviderInstanceMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: getSecretProviderInstanceMock
}));

import { XeroClientService, XERO_CLIENT_ID_SECRET_NAME, XERO_CLIENT_SECRET_SECRET_NAME, XERO_CREDENTIALS_SECRET_NAME } from './xeroClientService';

const TENANT = 'poll-tenant';

const connections = {
  'conn-a': {
    connectionId: 'conn-a',
    xeroTenantId: 'tenant-a',
    accessToken: 'access-a',
    refreshToken: 'refresh-a',
    accessTokenExpiresAt: '2999-01-01T00:00:00.000Z'
  },
  'conn-b': {
    connectionId: 'conn-b',
    xeroTenantId: 'tenant-b',
    accessToken: 'access-b',
    refreshToken: 'refresh-b',
    accessTokenExpiresAt: '2999-01-01T00:00:00.000Z'
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  getSecretProviderInstanceMock.mockResolvedValue({
    getTenantSecret: vi.fn(async (_tenant: string, name: string) => {
      if (name === XERO_CREDENTIALS_SECRET_NAME) {
        return JSON.stringify(connections);
      }
      return undefined;
    }),
    getAppSecret: vi.fn(async (name: string) => {
      if (name === XERO_CLIENT_ID_SECRET_NAME) return 'app-client-id';
      if (name === XERO_CLIENT_SECRET_SECRET_NAME) return 'app-client-secret';
      return undefined;
    }),
    setTenantSecret: vi.fn(async () => undefined)
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('XeroClientService polling HTTP boundary', () => {
  it('sends modified-since paging requests with the selected organisation header', async () => {
    const requestMock = vi.spyOn(axios, 'request').mockResolvedValue({
      data: { Invoices: [{ InvoiceID: 'inv-1' }] }
    } as any);

    const client = await XeroClientService.create(TENANT, 'conn-b');
    const page = await client.listChangedInvoices('2026-01-01T00:00:00.000Z', 2);

    expect(page.records).toHaveLength(1);
    expect(page.hasMore).toBe(false);

    const config = requestMock.mock.calls[0][0] as any;
    expect(config.url).toBe('/Invoices');
    expect(config.params).toMatchObject({ page: 2, modifiedAfter: '2026-01-01T00:00:00.000Z' });
    expect(config.headers['If-Modified-Since']).toBe('2026-01-01T00:00:00.000Z');
    // The organisation header is the selected connection's xeroTenantId, not
    // the connection id.
    expect(config.headers['Xero-tenant-id']).toBe('tenant-b');
    expect(config.headers.Authorization).toBe('Bearer access-b');
  });

  it('uses the connection id to select the organisation, defaulting to the first', async () => {
    const requestMock = vi.spyOn(axios, 'request').mockResolvedValue({ data: { Payments: [] } } as any);

    const first = await XeroClientService.create(TENANT);
    await first.listChangedPayments('2026-01-01T00:00:00.000Z', 1);
    expect((requestMock.mock.calls[0][0] as any).headers['Xero-tenant-id']).toBe('tenant-a');

    const second = await XeroClientService.create(TENANT, 'conn-b');
    await second.listChangedCreditNotes('2026-01-01T00:00:00.000Z', 1);
    const lastConfig = requestMock.mock.calls[requestMock.mock.calls.length - 1][0] as any;
    expect(lastConfig.url).toBe('/CreditNotes');
    expect(lastConfig.params).toMatchObject({ page: 1 });
    expect(lastConfig.headers['Xero-tenant-id']).toBe('tenant-b');
  });

  it('reports hasMore for a full page (100 records)', async () => {
    const fullPage = Array.from({ length: 100 }, (_, index) => ({ InvoiceID: `inv-${index}` }));
    vi.spyOn(axios, 'request').mockResolvedValue({ data: { Invoices: fullPage } } as any);

    const client = await XeroClientService.create(TENANT, 'conn-a');
    const page = await client.listChangedInvoices('2026-01-01T00:00:00.000Z', 1);
    expect(page.records).toHaveLength(100);
    expect(page.hasMore).toBe(true);
  });

  it('surfaces a polling 401 with a revoked refresh token as reconnect-required', async () => {
    vi.spyOn(axios, 'request').mockRejectedValue({
      isAxiosError: true,
      message: 'unauthorized',
      response: { status: 401, headers: {}, data: {} }
    });
    vi.spyOn(axios, 'post').mockRejectedValue({
      isAxiosError: true,
      message: 'bad request',
      response: { status: 400, headers: {}, data: { error: 'invalid_grant' } }
    });

    const client = await XeroClientService.create(TENANT, 'conn-a');
    let failure: any;
    try {
      await client.listChangedInvoices('2026-01-01T00:00:00.000Z', 1);
    } catch (error) {
      failure = error;
    }
    expect(['XERO_REFRESH_FAILED', 'XERO_UNAUTHORIZED', 'XERO_REFRESH_EXPIRED']).toContain(failure?.code);
  });

  it('classifies a persistent Payments 401 under a known reduced grant as actionable scope-insufficient', async () => {
    // Build the client directly so the refresh path can be stubbed: the
    // scenario is a token refresh that succeeds while Payments still 401s,
    // which is the signature of an insufficient grant.
    const client = Object.create(XeroClientService.prototype) as any;
    client.tenantId = TENANT;
    client.connection = {
      connectionId: 'conn-limited',
      xeroTenantId: 'tenant-limited',
      accessToken: 'access-limited',
      refreshToken: 'refresh-limited',
      accessTokenExpiresAt: '2999-01-01T00:00:00.000Z',
      scope: 'offline_access accounting.invoices accounting.contacts'
    };
    client.connections = { 'conn-limited': client.connection };
    client.appSecrets = { clientId: 'app-client-id', clientSecret: 'app-client-secret' };
    vi.spyOn(client, 'refreshAccessToken').mockResolvedValue(undefined);
    vi.spyOn(axios, 'request').mockRejectedValue({
      isAxiosError: true,
      message: 'unauthorized',
      response: { status: 401, headers: {}, data: {} }
    });

    let failure: any;
    try {
      await client.listChangedPayments('2026-01-01T00:00:00.000Z', 1);
    } catch (error) {
      failure = error;
    }

    expect(failure?.code).toBe('XERO_SCOPE_INSUFFICIENT');
    expect(failure?.message).toContain('accounting.payments.read');
    expect(failure?.message).toContain('Reconnect');
    expect(failure?.message).toContain('refreshing');
    expect(failure?.details?.missingScopes).toEqual(['accounting.payments.read']);
  });

  it('accepts a legacy broad transactions grant for Payments polling', async () => {
    const client = Object.create(XeroClientService.prototype) as any;
    client.tenantId = TENANT;
    client.connection = {
      connectionId: 'conn-legacy',
      xeroTenantId: 'tenant-legacy',
      accessToken: 'access-legacy',
      refreshToken: 'refresh-legacy',
      accessTokenExpiresAt: '2999-01-01T00:00:00.000Z',
      scope: 'offline_access accounting.settings accounting.transactions accounting.contacts'
    };
    client.connections = { 'conn-legacy': client.connection };
    client.appSecrets = { clientId: 'app-client-id', clientSecret: 'app-client-secret' };

    const requestMock = vi.spyOn(axios, 'request').mockResolvedValue({
      data: { Payments: [{ PaymentID: 'pay-1' }] }
    } as any);

    const page = await client.listChangedPayments('2026-01-01T00:00:00.000Z', 1);

    // No scope-insufficient failure: legacy broad scopes satisfy the granular
    // requirement (asserted by the request reaching the provider).
    expect(page.records).toHaveLength(1);
    expect(requestMock).toHaveBeenCalled();
  });
});
