/**
 * Data-in/data-out tests for the Alga company -> QuickBooks Online Customer
 * payload mapping, and the reverse normalization of QBO customer records.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedCompanyPayload } from '@alga-psa/types';

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

import { QboClientService } from '../qboClientService';

const TENANT = 'tenant-1';
const REALM = 'realm-1';
const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const SANDBOX_BASE = `https://sandbox-quickbooks.api.intuit.com/v3/company/${REALM}`;

async function createService(): Promise<QboClientService> {
  tenantSecrets.clear();
  appSecrets.clear();
  tenantSecrets.set(
    `${TENANT}:qbo_credentials`,
    JSON.stringify({
      [REALM]: {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        realmId: REALM,
        accessTokenExpiresAt: FUTURE,
        refreshTokenExpiresAt: FUTURE
      }
    })
  );
  appSecrets.set('qbo_client_id', 'qbo-client-id');
  appSecrets.set('qbo_client_secret', 'qbo-client-secret');
  return QboClientService.create(TENANT, REALM);
}

function companyPayload(overrides: Partial<NormalizedCompanyPayload> = {}): NormalizedCompanyPayload {
  return {
    companyId: 'company-1',
    name: 'Acme Corp',
    primaryEmail: 'billing@acme.test',
    primaryPhone: '+1 555 0100',
    billingAddress: {
      line1: '1 Main St',
      line2: 'Suite 2',
      city: 'Springfield',
      region: 'IL',
      postalCode: '62701',
      country: 'US'
    },
    notes: 'VIP customer',
    ...overrides
  };
}

/** Queue an empty result for the lookup query that createOrUpdateCustomer runs first. */
function queueEmptyLookup(): void {
  axiosRequestMock.mockResolvedValueOnce({ data: { QueryResponse: {} } });
}

describe('QboClientService customer mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a new customer with the exact QBO field mapping', async () => {
    const service = await createService();
    queueEmptyLookup();
    axiosRequestMock.mockResolvedValueOnce({
      data: { Customer: { Id: '42', DisplayName: 'Acme Corp', SyncToken: '0' } }
    });

    const record = await service.createOrUpdateCustomer(companyPayload());

    const createCall = axiosRequestMock.mock.calls.at(-1)![0] as Record<string, any>;
    expect(createCall.method).toBe('POST');
    expect(createCall.url).toBe(`${SANDBOX_BASE}/customer`);
    expect(createCall.headers.Authorization).toBe('Bearer access-token');
    expect(createCall.data).toEqual({
      DisplayName: 'Acme Corp',
      CompanyName: 'Acme Corp',
      PrimaryEmailAddr: { Address: 'billing@acme.test' },
      PrimaryPhone: { FreeFormNumber: '+1 555 0100' },
      BillAddr: {
        Line1: '1 Main St',
        Line2: 'Suite 2',
        City: 'Springfield',
        Country: 'US',
        CountrySubDivisionCode: 'IL',
        PostalCode: '62701'
      },
      Notes: 'VIP customer'
    });

    expect(record).toEqual({
      externalId: '42',
      displayName: 'Acme Corp',
      syncToken: '0',
      raw: { Id: '42', DisplayName: 'Acme Corp', SyncToken: '0' }
    });
  });

  it('omits optional fields and falls back to a contact phone number', async () => {
    const service = await createService();
    queueEmptyLookup();
    axiosRequestMock.mockResolvedValueOnce({
      data: { Customer: { Id: '43', DisplayName: 'Bare Co' } }
    });

    await service.createOrUpdateCustomer(
      companyPayload({
        name: 'Bare Co',
        primaryEmail: null,
        primaryPhone: null,
        billingAddress: null,
        notes: null,
        contacts: [
          { name: 'No phone', phone: null } as any,
          { name: 'Has phone', phone: '+44 20 0000 0000' } as any
        ]
      })
    );

    const createCall = axiosRequestMock.mock.calls.at(-1)![0] as Record<string, any>;
    expect(createCall.data).toEqual({
      DisplayName: 'Bare Co',
      CompanyName: 'Bare Co',
      PrimaryPhone: { FreeFormNumber: '+44 20 0000 0000' }
    });
  });

  it('updates an existing customer carrying over Id and SyncToken', async () => {
    const service = await createService();
    axiosRequestMock
      // Lookup finds an existing customer
      .mockResolvedValueOnce({
        data: {
          QueryResponse: {
            Customer: [{ Id: '42', DisplayName: 'Acme Corp', SyncToken: '3' }]
          }
        }
      })
      // Update response
      .mockResolvedValueOnce({
        data: { Customer: { Id: '42', DisplayName: 'Acme Corp', SyncToken: '4' } }
      });

    const record = await service.createOrUpdateCustomer(companyPayload());

    const updateCall = axiosRequestMock.mock.calls.at(-1)![0] as Record<string, any>;
    expect(updateCall.method).toBe('POST');
    expect(updateCall.url).toBe(`${SANDBOX_BASE}/customer`);
    expect(updateCall.params).toEqual({ operation: 'update' });
    expect(updateCall.data).toMatchObject({
      Id: '42',
      SyncToken: '3',
      DisplayName: 'Acme Corp',
      CompanyName: 'Acme Corp'
    });

    expect(record.syncToken).toBe('4');
  });

  it("escapes single quotes in the display-name lookup query", async () => {
    const service = await createService();
    axiosRequestMock.mockResolvedValueOnce({ data: { QueryResponse: {} } });

    await service.findCustomerByDisplayName("O'Brien & Sons");

    const queryCall = axiosRequestMock.mock.calls.at(-1)![0] as Record<string, any>;
    expect(queryCall.method).toBe('GET');
    expect(queryCall.url).toBe(`${SANDBOX_BASE}/query`);
    expect(queryCall.params.query).toBe(
      "SELECT Id, DisplayName, SyncToken, PrimaryEmailAddr FROM Customer WHERE DisplayName = 'O''Brien & Sons'"
    );
  });

  it('extracts the entity array from QueryResponse regardless of entity key', async () => {
    const service = await createService();
    axiosRequestMock.mockResolvedValueOnce({
      data: {
        QueryResponse: {
          startPosition: 1,
          maxResults: 2,
          Item: [{ Id: 'i1' }, { Id: 'i2' }]
        }
      }
    });

    await expect(service.query('SELECT * FROM Item')).resolves.toEqual([{ Id: 'i1' }, { Id: 'i2' }]);
  });

  it('returns an empty array when the query response has no entity array', async () => {
    const service = await createService();
    axiosRequestMock.mockResolvedValueOnce({ data: { QueryResponse: {} } });

    await expect(service.query('SELECT * FROM Item')).resolves.toEqual([]);
  });
});
