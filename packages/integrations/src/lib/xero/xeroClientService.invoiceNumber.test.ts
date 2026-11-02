import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';

/**
 * alga-2026-0002806: InvoiceNumber must be the plain Alga invoice number, never the
 * PO-suffixed Reference or the invoice UUID, and must only be sent on create.
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

const TENANT = 'invoice-number-tenant';

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

function payload(overrides: Record<string, unknown>) {
  return {
    invoiceId: '6b1f0c7e-0000-4000-8000-000000000001',
    contactId: 'contact-1',
    currency: 'USD',
    invoiceDate: '2026-01-05',
    dueDate: '2026-02-04',
    amountCents: 1000,
    lines: [{ lineId: 'line-1', quantity: 1, unitAmountCents: 1000, amountCents: 1000, accountCode: '200', description: 'Consulting' }],
    ...overrides
  } as any;
}

async function sentInvoice(overrides: Record<string, unknown>): Promise<Record<string, unknown>> {
  const requestMock = vi.spyOn(axios, 'request').mockImplementation(async (config: any) => ({
    data: { Invoices: (config.data.Invoices as any[]).map((inv) => ({ ...inv, InvoiceID: 'xero-1' })) }
  }) as any);
  const client = await XeroClientService.create(TENANT, 'conn-a');
  await client.createInvoices([payload(overrides)]);
  return (requestMock.mock.calls[0][0] as any).data.Invoices[0];
}

describe('mapInvoicePayload InvoiceNumber', () => {
  it('sends the plain number as InvoiceNumber and keeps the PO-suffixed Reference', async () => {
    const sent = await sentInvoice({ invoiceNumber: 'INV-000123', reference: 'INV-000123 | PO 4567' });
    expect(sent.InvoiceNumber).toBe('INV-000123');
    expect(sent.Reference).toBe('INV-000123 | PO 4567');
  });

  it('sends the plain number in both fields when there is no PO', async () => {
    const sent = await sentInvoice({ invoiceNumber: 'INV-000123', reference: 'INV-000123' });
    expect(sent.InvoiceNumber).toBe('INV-000123');
    expect(sent.Reference).toBe('INV-000123');
  });

  it.each([null, undefined, '', '   '])('omits InvoiceNumber (never the UUID) when the number is %j', async (value) => {
    const sent = await sentInvoice({ invoiceNumber: value, reference: '6b1f0c7e-0000-4000-8000-000000000001' });
    expect('InvoiceNumber' in sent).toBe(false);
  });

  it('never sends InvoiceNumber on an update by InvoiceID', async () => {
    const sent = await sentInvoice({
      externalInvoiceId: 'xero-1',
      invoiceNumber: 'INV-000123',
      reference: 'INV-000123 | PO 4567'
    });
    expect(sent.InvoiceID).toBe('xero-1');
    expect('InvoiceNumber' in sent).toBe(false);
    expect(sent.Reference).toBe('INV-000123 | PO 4567');
  });
});
