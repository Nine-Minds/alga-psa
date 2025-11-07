import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AxiosRequestConfig } from 'axios';
import axios from 'axios';

import { XeroClientService } from 'server/src/lib/xero/xeroClientService';
import type { XeroInvoicePayload } from 'server/src/lib/xero/xeroClientService';

/**
 * Spec references:
 * - Invoices endpoint: https://developer.xero.com/documentation/accounting/invoices#post
 * - OAuth token refresh: https://developer.xero.com/documentation/oauth2/auth-flow
 */

const secretProviderMock = vi.hoisted(() => ({
  getTenantSecret: vi.fn().mockResolvedValue(null),
  setTenantSecret: vi.fn().mockResolvedValue(undefined),
  getAppSecret: vi.fn().mockResolvedValue(undefined)
}));

const getSecretProviderInstanceMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue(secretProviderMock)
);

vi.mock('@alga-psa/shared/core', () => ({
  getSecretProviderInstance: getSecretProviderInstanceMock
}));

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}));

vi.mock('@shared/core/logger', () => ({
  default: loggerMock
}));

vi.mock('axios', () => {
  const request = vi.fn();
  const post = vi.fn();
  const isAxiosError = (error: any) => Boolean(error && error.isAxiosError);
  return {
    default: {
      request,
      post,
      isAxiosError
    },
    request,
    post,
    isAxiosError
  };
});

const axiosMock = axios as unknown as {
  request: vi.Mock;
  post: vi.Mock;
};

function createService(overrides: Partial<XeroInvoicePayload> = {}) {
  const now = Date.now();
  const connection = {
    connectionId: 'connection-1',
    xeroTenantId: 'tenant-xero-guid',
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    accessTokenExpiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
    refreshTokenExpiresAt: new Date(now + 60 * 60 * 1000 * 24).toISOString(),
    scope: 'accounting.transactions'
  };

  const service = new (XeroClientService as any)(
    'tenant-123',
    connection,
    { [connection.connectionId]: connection },
    { clientId: 'client-id', clientSecret: 'client-secret' }
  ) as XeroClientService;

  const payload: XeroInvoicePayload = {
    invoiceId: 'invoice-1',
    contactId: 'contact-1',
    invoiceDate: '2025-02-01',
    dueDate: '2025-02-15',
    lineAmountType: 'Exclusive',
    amountCents: 25_000,
    currency: 'USD',
    reference: 'INV-1001',
    lines: [
      {
        lineId: 'line-1',
        description: 'Consulting services',
        amountCents: 25_000,
        quantity: 5,
        unitAmountCents: 5_000,
        accountCode: '200',
        taxType: 'OUTPUT'
      }
    ]
  };

  return { service, payload: { ...payload, ...overrides } };
}

describe('XeroClientService – REST usage', () => {
  beforeEach(() => {
    loggerMock.info.mockReset();
    loggerMock.warn.mockReset();
    loggerMock.error.mockReset();
    loggerMock.debug.mockReset();
    secretProviderMock.getTenantSecret.mockReset();
    secretProviderMock.setTenantSecret.mockReset();
    secretProviderMock.getAppSecret.mockReset();
    getSecretProviderInstanceMock.mockReset();
    secretProviderMock.getTenantSecret.mockResolvedValue(null);
    secretProviderMock.setTenantSecret.mockResolvedValue(undefined);
    secretProviderMock.getAppSecret.mockResolvedValue(undefined);
    getSecretProviderInstanceMock.mockResolvedValue(secretProviderMock);
    axiosMock.request.mockReset();
    axiosMock.post.mockReset();
  });

  it('POST /Invoices payload matches spec requirements', async () => {
    const { service, payload } = createService();
    axiosMock.request.mockImplementation(async (config: AxiosRequestConfig) => {
      expect(config.method).toBe('POST');
      expect(config.url).toBe('/Invoices');
      expect(config.data?.Invoices).toHaveLength(1);
      const body = config.data.Invoices[0];
      expect(body.Type).toBe('ACCREC');
      expect(body.Contact).toEqual({ ContactID: payload.contactId });
      expect(body.LineItems).toHaveLength(1);
      expect(body.LineItems[0]).toMatchObject({
        LineItemID: payload.lines[0]?.lineId,
        Description: 'Consulting services',
        AccountCode: '200',
        TaxType: 'OUTPUT'
      });
      expect(body.CurrencyCode).toBe('USD');
      return {
        data: {
          Invoices: [
            {
              InvoiceID: 'guid-1',
              InvoiceNumber: 'INV-1001'
            }
          ]
        }
      };
    });

    const result = await service.createInvoices([payload]);
    expect(result).toEqual([
      {
        status: 'success',
        invoiceId: 'guid-1',
        documentId: payload.invoiceId,
        invoiceNumber: 'INV-1001',
        raw: {
          InvoiceID: 'guid-1',
          InvoiceNumber: 'INV-1001'
        }
      }
    ]);

    expect(axiosMock.request).toHaveBeenCalledTimes(1);
  });

  it('normalizes validation errors returned from POST /Invoices', async () => {
    const { service, payload } = createService();
    const error = {
      isAxiosError: true,
      response: {
        status: 400,
        headers: { 'xero-correlation-id': 'corr-123' },
        data: {
          Elements: [
            {
              Invoice: { InvoiceNumber: 'INV-INVALID' },
              ValidationErrors: [{ Message: 'LineItems[0].AccountCode is required' }]
            }
          ]
        }
      }
    };

    axiosMock.request.mockRejectedValue(error);

    await expect(service.createInvoices([payload])).rejects.toMatchObject({
      code: 'XERO_VALIDATION_ERROR',
      details: {
        status: 400,
        correlationId: 'corr-123',
        errors: [
          {
            documentId: 'INV-INVALID',
            validationErrors: [{ message: 'LineItems[0].AccountCode is required', field: undefined }]
          }
        ]
      }
    });
  });

  it('handles empty payload array without issuing network request', async () => {
    const { service } = createService();
    const result = await service.createInvoices([]);
    expect(result).toEqual([]);
    expect(axiosMock.request).not.toHaveBeenCalled();
  });

  it('sets expected headers for authenticated requests', async () => {
    const { service } = createService();
    axiosMock.request.mockResolvedValue({ data: { ok: true } });

    const response = await (service as any).request({ method: 'GET', url: '/Accounts' });
    expect(response).toEqual({ ok: true });
    expect(axiosMock.request).toHaveBeenCalledTimes(1);
    const call = axiosMock.request.mock.calls[0][0] as AxiosRequestConfig;
    expect(call.baseURL).toBe('https://api.xero.com/api.xro/2.0');
    expect(call.headers).toMatchObject({
      Accept: 'application/json',
      Authorization: 'Bearer access-token',
      'Xero-tenant-id': 'tenant-xero-guid'
    });
  });

  it('refreshes OAuth tokens when expired', async () => {
    const now = Date.now();
    const connection = {
      connectionId: 'connection-expired',
      xeroTenantId: 'tenant-xero-guid',
      accessToken: 'old-token',
      refreshToken: 'old-refresh',
      accessTokenExpiresAt: new Date(now - 1000).toISOString(),
      refreshTokenExpiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
      scope: 'accounting.transactions'
    };

    const service = new (XeroClientService as any)(
      'tenant-123',
      connection,
      { [connection.connectionId]: connection },
      { clientId: 'client-id', clientSecret: 'client-secret' }
    ) as XeroClientService;

    axiosMock.post.mockResolvedValue({
      data: {
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 1800,
        refresh_token_expires_in: 7200,
        scope: 'accounting.transactions'
      }
    });

    await (service as any).refreshAccessToken(true);

    expect(axiosMock.post).toHaveBeenCalledWith(
      'https://identity.xero.com/connect/token',
      expect.any(String),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );
    const params = new URLSearchParams(axiosMock.post.mock.calls[0][1]);
    expect(params.get('grant_type')).toBe('refresh_token');
    expect(params.get('refresh_token')).toBe('old-refresh');
    expect(params.get('client_id')).toBe('client-id');
    expect(params.get('client_secret')).toBe('client-secret');

    expect((service as any).connection.accessToken).toBe('new-access');
    expect((service as any).connection.refreshToken).toBe('new-refresh');
  });

  it('retrieves accounts, items, tax rates, and tracking categories with normalized structures', async () => {
    const { service } = createService();
    axiosMock.request
      .mockResolvedValueOnce({
        data: {
          Accounts: [{ AccountID: 'acc-1', Code: '200', Name: 'Revenue', Status: 'ACTIVE', Type: 'SALES' }]
        }
      })
      .mockResolvedValueOnce({
        data: {
          Items: [{ ItemID: 'item-1', Code: 'SKU', Name: 'Support Plan', Status: 'ACTIVE', IsTrackedAsInventory: false }]
        }
      })
      .mockResolvedValueOnce({
        data: {
          TaxRates: [
            {
              TaxRateID: 'tax-1',
              Name: 'GST',
              TaxType: 'OUTPUT',
              Status: 'ACTIVE',
              EffectiveRate: 10,
              TaxComponents: [{ Name: 'GST', Rate: 10 }]
            }
          ]
        }
      })
      .mockResolvedValueOnce({
        data: {
          TrackingCategories: [
            {
              TrackingCategoryID: 'track-1',
              Name: 'Region',
              Status: 'ACTIVE',
              Options: [{ TrackingOptionID: 'opt-1', Name: 'North', Status: 'ACTIVE' }]
            }
          ]
        }
      });

    const accounts = await service.listAccounts({ status: 'ACTIVE' });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ accountId: 'acc-1', code: '200', name: 'Revenue', status: 'ACTIVE', type: 'SALES' });

    const items = await service.listItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ itemId: 'item-1', code: 'SKU', name: 'Support Plan', isTrackedAsInventory: false });

    const taxRates = await service.listTaxRates();
    expect(taxRates).toHaveLength(1);
    expect(taxRates[0]).toMatchObject({
      taxRateId: 'tax-1',
      name: 'GST',
      taxType: 'OUTPUT',
      effectiveRate: 10,
      components: [{ name: 'GST', rate: 10 }]
    });

    const tracking = await service.listTrackingCategories();
    expect(tracking).toHaveLength(1);
    expect(tracking[0]).toMatchObject({
      trackingCategoryId: 'track-1',
      name: 'Region',
      options: [{ trackingOptionId: 'opt-1', name: 'North' }]
    });

    expect(axiosMock.request.mock.calls.map((call) => call[0]?.url)).toEqual([
      '/Accounts',
      '/Items',
      '/TaxRates',
      '/TrackingCategories'
    ]);
  });

  it('retries after 401 by refreshing token once and logs tenant metadata', async () => {
    const { service } = createService();

    axiosMock.request
      .mockRejectedValueOnce({
        isAxiosError: true,
        response: { status: 401 }
      })
      .mockResolvedValueOnce({
        data: {
          Accounts: [{ AccountID: 'acc-2', Name: 'Consulting', Code: '210' }]
        }
      });

    axiosMock.post.mockResolvedValueOnce({
      data: {
        access_token: 'refreshed-token',
        refresh_token: 'refreshed-refresh',
        expires_in: 1800,
        refresh_token_expires_in: 7200,
        scope: 'accounting.transactions'
      }
    });

    const accounts = await service.listAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].accountId).toBe('acc-2');

    expect(axiosMock.request).toHaveBeenCalledTimes(2);
    expect(axiosMock.post).toHaveBeenCalledTimes(1);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      '[XeroClientService] 401 received, attempting token refresh',
      expect.objectContaining({ tenantId: 'tenant-123', connectionId: 'connection-1' })
    );
    expect(loggerMock.info).toHaveBeenCalledWith(
      '[XeroClientService] refreshing access token',
      expect.objectContaining({ tenantId: 'tenant-123', connectionId: 'connection-1' })
    );
    expect(secretProviderMock.setTenantSecret).toHaveBeenCalledTimes(1);
  });

  it('allows re-export after validation error once mappings are corrected', async () => {
    const { service, payload } = createService();

    axiosMock.request
      .mockRejectedValueOnce({
        isAxiosError: true,
        response: {
          status: 400,
          headers: { 'xero-correlation-id': 'corr-999' },
          data: {
            Elements: [
              {
                Invoice: { InvoiceNumber: 'INV-BAD' },
                ValidationErrors: [{ Message: 'AccountCode ACC-000 is disabled' }]
              }
            ]
          }
        }
      })
      .mockResolvedValueOnce({
        data: {
          Invoices: [{ InvoiceID: 'guid-2', InvoiceNumber: 'INV-1002' }]
        }
      });

    await expect(service.createInvoices([payload])).rejects.toMatchObject({
      code: 'XERO_VALIDATION_ERROR'
    });

    const result = await service.createInvoices([payload]);
    expect(result).toEqual([
      {
        status: 'success',
        invoiceId: 'guid-2',
        documentId: payload.invoiceId,
        invoiceNumber: 'INV-1002',
        raw: { InvoiceID: 'guid-2', InvoiceNumber: 'INV-1002' }
      }
    ]);
  });
});
