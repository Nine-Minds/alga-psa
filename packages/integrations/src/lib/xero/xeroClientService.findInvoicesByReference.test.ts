import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';

const getSecretProviderInstanceMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: getSecretProviderInstanceMock
}));

import {
  XeroClientService,
  XERO_CLIENT_ID_SECRET_NAME,
  XERO_CLIENT_SECRET_SECRET_NAME,
  XERO_CREDENTIALS_SECRET_NAME,
  XERO_REFERENCE_LOOKUP_MAX_CLAUSES,
  XERO_REFERENCE_LOOKUP_MAX_WHERE_LENGTH,
  buildReferenceWhereClauses
} from './xeroClientService';

const TENANT = 'find-by-reference-tenant';

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

describe('buildReferenceWhereClauses', () => {
  it('ORs Reference clauses and filters to ACCREC', () => {
    expect(buildReferenceWhereClauses(['INV-1', 'INV-2 | PO 7'])).toEqual([
      'Type=="ACCREC" AND (Reference=="INV-1" OR Reference=="INV-2 | PO 7")'
    ]);
  });

  it('escapes double quotes in the reference', () => {
    const [where] = buildReferenceWhereClauses(['INV-1 | PO "A"']);
    expect(where).toBe('Type=="ACCREC" AND (Reference=="INV-1 | PO \\"A\\"")');
  });

  it('splits by clause count', () => {
    const refs = Array.from({ length: XERO_REFERENCE_LOOKUP_MAX_CLAUSES * 2 + 1 }, (_, i) => `R${i}`);
    const chunks = buildReferenceWhereClauses(refs);
    expect(chunks).toHaveLength(3);
    expect(chunks.join(' ').match(/Reference==/g)).toHaveLength(refs.length);
  });

  it('splits by where length', () => {
    const refs = Array.from({ length: 20 }, (_, i) => `${'x'.repeat(150)}-${i}`);
    const chunks = buildReferenceWhereClauses(refs);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(XERO_REFERENCE_LOOKUP_MAX_WHERE_LENGTH);
    }
    expect(chunks.join(' ').match(/Reference==/g)).toHaveLength(refs.length);
  });
});

describe('XeroClientService.findInvoicesByReference', () => {
  it('sends one GET /Invoices with the ACCREC where clause and maps results', async () => {
    const requestMock = vi.spyOn(axios, 'request').mockResolvedValue({
      data: {
        Invoices: [
          {
            InvoiceID: 'xero-1',
            InvoiceNumber: 'INV-0042',
            Reference: 'INV-PROV-1',
            Status: 'DRAFT',
            Contact: { ContactID: 'c-1' }
          }
        ]
      }
    } as any);
    const client = await XeroClientService.create(TENANT, 'conn-a');
    const result = await client.findInvoicesByReference(['INV-PROV-1']);

    expect(requestMock).toHaveBeenCalledTimes(1);
    const config = requestMock.mock.calls[0][0] as any;
    expect(config.method).toBe('GET');
    expect(config.url).toBe('/Invoices');
    expect(config.params.where).toBe('Type=="ACCREC" AND (Reference=="INV-PROV-1")');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ invoiceId: 'xero-1', invoiceNumber: 'INV-0042', reference: 'INV-PROV-1' });
    expect((result[0].raw as any).Contact.ContactID).toBe('c-1');
  });

  it('makes no request for an empty list and de-duplicates references', async () => {
    const requestMock = vi.spyOn(axios, 'request').mockResolvedValue({ data: { Invoices: [] } } as any);
    const client = await XeroClientService.create(TENANT, 'conn-a');
    expect(await client.findInvoicesByReference([])).toEqual([]);
    expect(requestMock).not.toHaveBeenCalled();

    await client.findInvoicesByReference(['A', 'A']);
    expect((requestMock.mock.calls[0][0] as any).params.where.match(/Reference==/g)).toHaveLength(1);
  });

  it('issues one request per chunk', async () => {
    const requestMock = vi.spyOn(axios, 'request').mockResolvedValue({ data: { Invoices: [] } } as any);
    const client = await XeroClientService.create(TENANT, 'conn-a');
    const refs = Array.from({ length: XERO_REFERENCE_LOOKUP_MAX_CLAUSES + 1 }, (_, i) => `R${i}`);
    await client.findInvoicesByReference(refs);
    expect(requestMock).toHaveBeenCalledTimes(2);
  });
});
