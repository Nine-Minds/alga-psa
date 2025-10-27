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

vi.mock('@alga-psa/shared/core', () => {
  const provider = {
    getTenantSecret: vi.fn().mockResolvedValue(null),
    setTenantSecret: vi.fn().mockResolvedValue(undefined)
  };
  return {
    getSecretProviderInstance: vi.fn().mockResolvedValue(provider)
  };
});

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
});
