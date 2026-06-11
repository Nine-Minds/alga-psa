/**
 * Tests for the Xero -> Alga normalization direction: fetched invoices,
 * tax rates, accounts and tracking categories are converted from Xero's
 * decimal/PascalCase wire format into Alga's cent-based camelCase records.
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

import { XeroClientService } from '../xeroClientService';

const TENANT = 'tenant-1';
const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();

async function createService(): Promise<XeroClientService> {
  tenantSecrets.clear();
  appSecrets.clear();
  tenantSecrets.set(
    `${TENANT}:xero_credentials`,
    JSON.stringify({
      'conn-1': {
        connectionId: 'conn-1',
        xeroTenantId: 'xero-tenant-1',
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: FUTURE,
        refreshTokenExpiresAt: FUTURE
      }
    })
  );
  appSecrets.set('xero_client_id', 'app-client-id');
  appSecrets.set('xero_client_secret', 'app-client-secret');
  return XeroClientService.create(TENANT, 'conn-1');
}

describe('XeroClientService normalization of fetched data', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes a fetched invoice: decimal amounts become integer cents and tax components are mapped', async () => {
    const service = await createService();
    axiosRequestMock.mockResolvedValueOnce({
      data: {
        Invoices: [
          {
            InvoiceID: 'xero-id-1',
            InvoiceNumber: 'INV-100',
            Reference: 'REF-1',
            Status: 'AUTHORISED',
            CurrencyCode: 'USD',
            Total: 1134.55,
            TotalTax: 103.14,
            SubTotal: 1031.41,
            LineAmountTypes: 'Exclusive',
            LineItems: [
              {
                LineItemID: 'line-xero-1',
                Description: 'Managed services',
                Quantity: 2,
                UnitAmount: 515.7,
                LineAmount: 1031.41,
                TaxAmount: 103.14,
                TaxType: 'OUTPUT',
                AccountCode: '200',
                ItemCode: 'MSP-001',
                TaxComponents: [
                  { Name: 'State Tax', Rate: 6.25, TaxAmount: 64.46 },
                  { Name: 'City Tax', Rate: 3.75, TaxAmount: 38.68 }
                ]
              }
            ]
          }
        ]
      }
    });

    const invoice = await service.getInvoice('xero-id-1');

    expect(axiosRequestMock.mock.calls.at(-1)![0].url).toBe('/Invoices/xero-id-1');
    expect(invoice).toMatchObject({
      invoiceId: 'xero-id-1',
      invoiceNumber: 'INV-100',
      reference: 'REF-1',
      status: 'AUTHORISED',
      currencyCode: 'USD',
      total: 113455,
      totalTax: 10314,
      subTotal: 103141,
      lineAmountTypes: 'Exclusive'
    });
    expect(invoice!.lineItems).toEqual([
      {
        lineItemId: 'line-xero-1',
        description: 'Managed services',
        quantity: 2,
        unitAmount: 51570,
        lineAmount: 103141,
        taxAmount: 10314,
        taxType: 'OUTPUT',
        accountCode: '200',
        itemCode: 'MSP-001',
        taxComponents: [
          { name: 'State Tax', rate: 6.25, amount: 6446 },
          { name: 'City Tax', rate: 3.75, amount: 3868 }
        ]
      }
    ]);
  });

  it('applies defaults when optional invoice fields are missing from the Xero response', async () => {
    const service = await createService();
    axiosRequestMock.mockResolvedValueOnce({
      data: {
        Invoices: [
          {
            InvoiceID: 'xero-id-2',
            LineItems: [{}]
          }
        ]
      }
    });

    const invoice = await service.getInvoice('xero-id-2');

    expect(invoice).toMatchObject({
      invoiceId: 'xero-id-2',
      total: 0,
      totalTax: 0,
      subTotal: 0,
      lineAmountTypes: 'Exclusive'
    });
    expect(invoice!.invoiceNumber).toBeUndefined();
    expect(invoice!.lineItems[0]).toEqual({
      lineItemId: undefined,
      description: undefined,
      quantity: 1,
      unitAmount: 0,
      lineAmount: 0,
      taxAmount: 0,
      taxType: undefined,
      accountCode: undefined,
      itemCode: undefined,
      taxComponents: undefined
    });
  });

  it('returns null when the invoice does not exist', async () => {
    const service = await createService();
    axiosRequestMock.mockResolvedValueOnce({ data: { Invoices: [] } });

    await expect(service.getInvoice('missing')).resolves.toBeNull();
  });

  it('normalizes tax rates including component breakdowns and non-numeric effective rates', async () => {
    const service = await createService();
    axiosRequestMock.mockResolvedValueOnce({
      data: {
        TaxRates: [
          {
            TaxRateID: 'rate-1',
            Name: 'Combined Sales Tax',
            TaxType: 'OUTPUT',
            Status: 'ACTIVE',
            EffectiveRate: 10,
            TaxComponents: [
              { Name: 'State', Rate: 6.25 },
              { Name: 'City', Rate: 'oops' }
            ]
          },
          { TaxRateID: 'rate-2', Name: 'No components' }
        ]
      }
    });

    await expect(service.listTaxRates()).resolves.toEqual([
      {
        taxRateId: 'rate-1',
        name: 'Combined Sales Tax',
        taxType: 'OUTPUT',
        status: 'ACTIVE',
        effectiveRate: 10,
        components: [
          { name: 'State', rate: 6.25 },
          { name: 'City', rate: 0 }
        ]
      },
      {
        taxRateId: 'rate-2',
        name: 'No components',
        taxType: undefined,
        status: undefined,
        effectiveRate: null,
        components: []
      }
    ]);
  });

  it('normalizes accounts and filters by requested status', async () => {
    const service = await createService();
    axiosRequestMock.mockResolvedValue({
      data: {
        Accounts: [
          { AccountID: 'acc-1', Code: '200', Name: 'Sales', Type: 'REVENUE', Status: 'ACTIVE' },
          { AccountID: 'acc-2', Name: 'Old Sales', Status: 'ARCHIVED' }
        ]
      }
    });

    await expect(service.listAccounts({ status: 'ACTIVE' })).resolves.toEqual([
      { accountId: 'acc-1', code: '200', name: 'Sales', type: 'REVENUE', status: 'ACTIVE' }
    ]);

    const all = await service.listAccounts();
    expect(all).toHaveLength(2);
    expect(all[1]).toEqual({
      accountId: 'acc-2',
      code: undefined,
      name: 'Old Sales',
      type: undefined,
      status: 'ARCHIVED'
    });
  });

  it('normalizes tracking categories with nested options', async () => {
    const service = await createService();
    axiosRequestMock.mockResolvedValueOnce({
      data: {
        TrackingCategories: [
          {
            TrackingCategoryID: 'tc-1',
            Name: 'Source System',
            Status: 'ACTIVE',
            Options: [{ TrackingOptionID: 'opt-1', Name: 'AlgaPSA', Status: 'ACTIVE' }]
          },
          { TrackingCategoryID: 'tc-2', Name: 'Empty' }
        ]
      }
    });

    await expect(service.listTrackingCategories()).resolves.toEqual([
      {
        trackingCategoryId: 'tc-1',
        name: 'Source System',
        status: 'ACTIVE',
        options: [{ trackingOptionId: 'opt-1', name: 'AlgaPSA', status: 'ACTIVE' }]
      },
      { trackingCategoryId: 'tc-2', name: 'Empty', status: undefined, options: [] }
    ]);
  });
});
