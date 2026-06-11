/**
 * Data-in/data-out tests for the Alga -> Xero invoice payload mapping.
 *
 * These tests drive XeroClientService.createInvoices with domain payloads
 * (amounts in integer cents) and assert the exact JSON body posted to the
 * Xero /Invoices endpoint (amounts in decimal currency units).
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
const axiosPostMock = vi.fn();

vi.mock('axios', () => {
  const axios = {
    request: (...args: unknown[]) => axiosRequestMock(...args),
    post: (...args: unknown[]) => axiosPostMock(...args),
    isAxiosError: (error: unknown) => Boolean((error as any)?.isAxiosError)
  };
  return { default: axios, ...axios };
});

import { XeroClientService, type XeroInvoicePayload } from '../xeroClientService';

const TENANT = 'tenant-1';
const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();

function seedConnection(): void {
  tenantSecrets.clear();
  appSecrets.clear();
  tenantSecrets.set(
    `${TENANT}:xero_credentials`,
    JSON.stringify({
      'conn-1': {
        connectionId: 'conn-1',
        xeroTenantId: 'xero-tenant-1',
        tenantName: 'Acme Org',
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: FUTURE,
        refreshTokenExpiresAt: FUTURE
      }
    })
  );
  appSecrets.set('xero_client_id', 'app-client-id');
  appSecrets.set('xero_client_secret', 'app-client-secret');
}

function basePayload(overrides: Partial<XeroInvoicePayload> = {}): XeroInvoicePayload {
  return {
    invoiceId: 'alga-invoice-1',
    contactId: 'contact-1',
    currency: 'USD',
    reference: 'INV-100',
    invoiceDate: '2024-03-15',
    dueDate: '2024-04-14',
    lineAmountType: 'Exclusive',
    amountCents: 123456,
    lines: [
      {
        lineId: 'line-1',
        amountCents: 123456,
        description: 'Managed services',
        quantity: 2,
        unitAmountCents: 61728,
        itemCode: 'MSP-001',
        accountCode: '200',
        taxType: 'OUTPUT',
        taxAmountCents: 12346
      }
    ],
    ...overrides
  };
}

async function createService(): Promise<XeroClientService> {
  return XeroClientService.create(TENANT, 'conn-1');
}

async function postedInvoice(payload: XeroInvoicePayload): Promise<Record<string, any>> {
  axiosRequestMock.mockResolvedValueOnce({
    data: { Invoices: [{ InvoiceID: 'xero-id-1', InvoiceNumber: 'INV-100' }] }
  });
  const service = await createService();
  await service.createInvoices([payload]);
  const config = axiosRequestMock.mock.calls.at(-1)![0] as Record<string, any>;
  return config.data.Invoices[0];
}

describe('XeroClientService.createInvoices payload mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedConnection();
  });

  it('maps a complete domain invoice to the exact Xero payload, converting cents to decimal amounts', async () => {
    axiosRequestMock.mockResolvedValueOnce({
      data: { Invoices: [{ InvoiceID: 'xero-id-1', InvoiceNumber: 'INV-100' }] }
    });
    const service = await createService();
    await service.createInvoices([basePayload()]);

    const config = axiosRequestMock.mock.calls.at(-1)![0] as Record<string, any>;
    expect(config.method).toBe('POST');
    expect(config.url).toBe('/Invoices');
    expect(config.headers.Authorization).toBe('Bearer access-token');
    expect(config.headers['Xero-tenant-id']).toBe('xero-tenant-1');

    expect(config.data).toEqual({
      Invoices: [
        {
          Type: 'ACCREC',
          InvoiceNumber: 'INV-100',
          Reference: 'INV-100',
          Date: '2024-03-15',
          DueDate: '2024-04-14',
          CurrencyCode: 'USD',
          LineAmountTypes: 'Exclusive',
          Contact: { ContactID: 'contact-1' },
          LineItems: [
            {
              Description: 'Managed services',
              Quantity: 2,
              UnitAmount: 617.28,
              LineAmount: 1234.56,
              ItemCode: 'MSP-001',
              AccountCode: '200',
              TaxType: 'OUTPUT',
              TaxAmount: 123.46
            }
          ]
        }
      ]
    });
  });

  it('falls back to the Alga invoice id as InvoiceNumber and defaults LineAmountTypes when not provided', async () => {
    const invoice = await postedInvoice(
      basePayload({ reference: null, lineAmountType: undefined })
    );

    expect(invoice.InvoiceNumber).toBe('alga-invoice-1');
    expect(invoice).not.toHaveProperty('Reference');
    expect(invoice.LineAmountTypes).toBe('Exclusive');
  });

  it('omits null/undefined optional fields instead of sending them to Xero', async () => {
    const invoice = await postedInvoice(
      basePayload({
        currency: null,
        invoiceDate: null,
        dueDate: null,
        externalInvoiceId: null,
        lines: [{ lineId: 'line-1', amountCents: 5000 }]
      })
    );

    expect(invoice).not.toHaveProperty('CurrencyCode');
    expect(invoice).not.toHaveProperty('Date');
    expect(invoice).not.toHaveProperty('DueDate');
    expect(invoice).not.toHaveProperty('InvoiceID');

    const line = invoice.LineItems[0];
    expect(line).toEqual({
      Quantity: 1,
      UnitAmount: 50,
      LineAmount: 50
    });
    expect(line).not.toHaveProperty('LineItemID');
    expect(line).not.toHaveProperty('TaxAmount');
    expect(line).not.toHaveProperty('Description');
  });

  it('sends InvoiceID and LineItemID only when prior-export external ids are known', async () => {
    const invoice = await postedInvoice(
      basePayload({
        externalInvoiceId: 'xero-prev-invoice',
        lines: [
          { lineId: 'line-1', amountCents: 1000, externalLineItemId: 'xero-prev-line' },
          { lineId: 'line-2', amountCents: 2000 }
        ]
      })
    );

    expect(invoice.InvoiceID).toBe('xero-prev-invoice');
    expect(invoice.LineItems[0].LineItemID).toBe('xero-prev-line');
    expect(invoice.LineItems[1]).not.toHaveProperty('LineItemID');
  });

  it('derives UnitAmount from line amount and quantity when no unit amount is supplied', async () => {
    const invoice = await postedInvoice(
      basePayload({
        lines: [{ lineId: 'line-1', amountCents: 1000, quantity: 4 }]
      })
    );

    expect(invoice.LineItems[0].Quantity).toBe(4);
    expect(invoice.LineItems[0].LineAmount).toBe(10);
    expect(invoice.LineItems[0].UnitAmount).toBe(2.5);
  });

  it('appends the service period to the line description', async () => {
    const invoice = await postedInvoice(
      basePayload({
        lines: [
          {
            lineId: 'line-1',
            amountCents: 1000,
            description: 'Support retainer',
            servicePeriodStart: '2024-01-01',
            servicePeriodEnd: '2024-01-31'
          },
          {
            lineId: 'line-2',
            amountCents: 2000,
            description: 'One-off work',
            servicePeriodStart: '2024-01-15',
            servicePeriodEnd: '2024-01-15'
          },
          {
            lineId: 'line-3',
            amountCents: 3000,
            servicePeriodStart: '2024-02-01'
          }
        ]
      })
    );

    expect(invoice.LineItems[0].Description).toBe(
      'Support retainer — Service period: 2024-01-01 to 2024-01-31'
    );
    expect(invoice.LineItems[1].Description).toBe('One-off work — Service date: 2024-01-15');
    expect(invoice.LineItems[2].Description).toBe('Service period starts: 2024-02-01');
  });

  it('normalizes tracking categories from both array and record forms', async () => {
    const invoice = await postedInvoice(
      basePayload({
        lines: [
          {
            lineId: 'line-1',
            amountCents: 1000,
            tracking: [
              { name: 'Source System', option: 'AlgaPSA' },
              { name: '', option: 'dropped' }
            ]
          },
          {
            lineId: 'line-2',
            amountCents: 2000,
            tracking: { Region: 'West', Empty: '' }
          },
          {
            lineId: 'line-3',
            amountCents: 3000,
            tracking: []
          }
        ]
      })
    );

    expect(invoice.LineItems[0].Tracking).toEqual([{ Name: 'Source System', Option: 'AlgaPSA' }]);
    expect(invoice.LineItems[1].Tracking).toEqual([{ Name: 'Region', Option: 'West' }]);
    expect(invoice.LineItems[2]).not.toHaveProperty('Tracking');
  });

  it('maps the Xero response back to create-success results keyed by the Alga document id', async () => {
    axiosRequestMock.mockResolvedValueOnce({
      data: { Invoices: [{ InvoiceID: 'xero-id-9', InvoiceNumber: 'INV-900' }] }
    });
    const service = await createService();
    const results = await service.createInvoices([basePayload()]);

    expect(results).toEqual([
      {
        status: 'success',
        invoiceId: 'xero-id-9',
        documentId: 'alga-invoice-1',
        invoiceNumber: 'INV-900',
        raw: { InvoiceID: 'xero-id-9', InvoiceNumber: 'INV-900' }
      }
    ]);
  });

  it('normalizes Xero validation failures into a XERO_VALIDATION_ERROR with per-document details', async () => {
    axiosRequestMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 400,
        headers: { 'xero-correlation-id': 'corr-1' },
        data: {
          Elements: [
            {
              Invoice: { InvoiceNumber: 'INV-100' },
              ValidationErrors: [{ Message: 'AccountCode: account is archived' }]
            }
          ]
        }
      }
    });

    const service = await createService();
    const error: any = await service.createInvoices([basePayload()]).catch((e) => e);

    expect(error.code).toBe('XERO_VALIDATION_ERROR');
    expect(error.details.correlationId).toBe('corr-1');
    expect(error.details.errors).toEqual([
      {
        documentId: 'INV-100',
        message: 'AccountCode: account is archived',
        validationErrors: [{ message: 'AccountCode: account is archived', field: 'AccountCode' }],
        raw: {
          Invoice: { InvoiceNumber: 'INV-100' },
          ValidationErrors: [{ Message: 'AccountCode: account is archived' }]
        }
      }
    ]);
  });
});
