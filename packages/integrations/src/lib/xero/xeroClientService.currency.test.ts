import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';

/**
 * The Xero client is where Alga minor units become Xero decimal amounts (and
 * back). The scale must follow the invoice's currency: JPY has no fraction
 * digits so 10000 yen is sent as 10000 and read back as 10000; USD keeps the
 * cents ↔ dollars conversion byte-for-byte.
 */

const getSecretProviderInstanceMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: getSecretProviderInstanceMock
}));

import {
  XeroClientService,
  XERO_CLIENT_ID_SECRET_NAME,
  XERO_CLIENT_SECRET_SECRET_NAME,
  XERO_CREDENTIALS_SECRET_NAME
} from './xeroClientService';

const TENANT = 'currency-tenant';

const connections = {
  'conn-a': {
    connectionId: 'conn-a',
    xeroTenantId: 'tenant-a',
    accessToken: 'access-a',
    refreshToken: 'refresh-a',
    accessTokenExpiresAt: '2999-01-01T00:00:00.000Z',
    scope: 'offline_access accounting.settings accounting.transactions accounting.contacts'
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  getSecretProviderInstanceMock.mockResolvedValue({
    getTenantSecret: vi.fn(async (_tenant: string, name: string) =>
      name === XERO_CREDENTIALS_SECRET_NAME ? JSON.stringify(connections) : undefined
    ),
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

function invoicePayload(currency: string, amounts: { unit: number; amount: number; tax: number }) {
  return {
    invoiceId: `alga-${currency}`,
    contactId: 'contact-1',
    currency,
    reference: `INV-${currency}`,
    invoiceDate: '2026-01-05',
    dueDate: '2026-02-04',
    amountCents: amounts.amount + amounts.tax,
    lines: [
      {
        lineId: 'line-1',
        quantity: 2,
        unitAmountCents: amounts.unit,
        amountCents: amounts.amount,
        taxAmountCents: amounts.tax,
        accountCode: '200',
        description: 'Consulting'
      }
    ]
  } as any;
}

describe('XeroClientService invoice money scaling', () => {
  it('sends JPY lines as whole yen and USD lines as dollars', async () => {
    const requestMock = vi.spyOn(axios, 'request').mockImplementation(async (config: any) => ({
      data: { Invoices: (config.data.Invoices as any[]).map((inv, i) => ({ ...inv, InvoiceID: `xero-${i}` })) }
    }) as any);

    const client = await XeroClientService.create(TENANT, 'conn-a');
    await client.createInvoices([
      invoicePayload('JPY', { unit: 5000, amount: 10000, tax: 800 }),
      invoicePayload('USD', { unit: 525, amount: 1050, tax: 84 })
    ]);

    const sent = requestMock.mock.calls[0][0] as any;
    const [jpy, usd] = sent.data.Invoices;
    expect(jpy.CurrencyCode).toBe('JPY');
    expect(jpy.LineItems[0]).toMatchObject({ Quantity: 2, UnitAmount: 5000, LineAmount: 10000, TaxAmount: 800 });
    expect(usd.CurrencyCode).toBe('USD');
    expect(usd.LineItems[0]).toMatchObject({ Quantity: 2, UnitAmount: 5.25, LineAmount: 10.5, TaxAmount: 0.84 });
  });

  it('reads a JPY invoice back in whole-yen minor units and a USD invoice in cents', async () => {
    const xeroInvoice = (currency: string, scale: number) => ({
      InvoiceID: `xero-${currency}`,
      InvoiceNumber: `INV-${currency}`,
      CurrencyCode: currency,
      Total: 10800 / scale,
      SubTotal: 10000 / scale,
      TotalTax: 800 / scale,
      LineAmountTypes: 'Exclusive',
      LineItems: [
        {
          LineItemID: 'li-1',
          Quantity: 2,
          UnitAmount: 5000 / scale,
          LineAmount: 10000 / scale,
          TaxAmount: 800 / scale,
          TaxComponents: [{ Name: 'Consumption tax', Rate: 8, TaxAmount: 800 / scale }]
        }
      ]
    });
    vi.spyOn(axios, 'request').mockImplementation(async (config: any) => ({
      data: { Invoices: [config.url.endsWith('xero-JPY') ? xeroInvoice('JPY', 1) : xeroInvoice('USD', 100)] }
    }) as any);

    const client = await XeroClientService.create(TENANT, 'conn-a');
    const jpy = await client.getInvoice('xero-JPY');
    expect(jpy).toMatchObject({ currencyCode: 'JPY', total: 10800, subTotal: 10000, totalTax: 800 });
    expect(jpy!.lineItems[0]).toMatchObject({ unitAmount: 5000, lineAmount: 10000, taxAmount: 800 });
    expect(jpy!.lineItems[0].taxComponents?.[0].amount).toBe(800);

    const usd = await client.getInvoice('xero-USD');
    expect(usd).toMatchObject({ currencyCode: 'USD', total: 10800, subTotal: 10000, totalTax: 800 });
    expect(usd!.lineItems[0]).toMatchObject({ unitAmount: 5000, lineAmount: 10000, taxAmount: 800 });
  });

  it('round-trips the minor units Alga sent when Xero echoes the invoice back', async () => {
    // Xero echoes what it stored; a read-back must land on the same minor units.
    let stored: any = null;
    vi.spyOn(axios, 'request').mockImplementation(async (config: any) => {
      if (config.method === 'POST') {
        const inv = config.data.Invoices[0];
        const line = inv.LineItems[0];
        stored = {
          ...inv,
          InvoiceID: 'xero-rt',
          SubTotal: line.LineAmount,
          TotalTax: line.TaxAmount,
          Total: line.LineAmount + line.TaxAmount
        };
        return { data: { Invoices: [stored] } } as any;
      }
      return { data: { Invoices: [stored] } } as any;
    });

    const client = await XeroClientService.create(TENANT, 'conn-a');
    for (const [currency, amounts] of [
      ['JPY', { unit: 5000, amount: 10000, tax: 800 }],
      ['USD', { unit: 525, amount: 1050, tax: 84 }]
    ] as const) {
      await client.createInvoices([invoicePayload(currency, amounts)]);
      const readBack = await client.getInvoice('xero-rt');
      expect(readBack!.currencyCode).toBe(currency);
      expect(readBack!.lineItems[0]).toMatchObject({
        unitAmount: amounts.unit,
        lineAmount: amounts.amount,
        taxAmount: amounts.tax
      });
      expect(readBack!.total).toBe(amounts.amount + amounts.tax);
    }
  });
});
