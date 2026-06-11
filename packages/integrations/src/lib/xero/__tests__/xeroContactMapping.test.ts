/**
 * Tests for the Alga company -> Xero Contact payload mapping and the
 * reverse normalization of Xero Contact records.
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
    taxNumber: 'TAX-123',
    notes: 'VIP customer',
    ...overrides
  };
}

describe('XeroClientService contact mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps a full company payload to the exact Xero Contact body', async () => {
    const service = await createService();
    axiosRequestMock.mockResolvedValueOnce({
      data: { Contacts: [{ ContactID: 'xero-contact-1', Name: 'Acme Corp' }] }
    });

    await service.createOrUpdateContact(companyPayload());

    const config = axiosRequestMock.mock.calls.at(-1)![0] as Record<string, any>;
    expect(config.method).toBe('POST');
    expect(config.url).toBe('/Contacts');
    expect(config.data).toEqual({
      Contacts: [
        {
          Name: 'Acme Corp',
          EmailAddress: 'billing@acme.test',
          Phones: [{ PhoneType: 'DEFAULT', PhoneNumber: '+1 555 0100' }],
          Addresses: [
            {
              AddressType: 'STREET',
              AddressLine1: '1 Main St',
              AddressLine2: 'Suite 2',
              City: 'Springfield',
              Region: 'IL',
              PostalCode: '62701',
              Country: 'US'
            }
          ],
          TaxNumber: 'TAX-123',
          Notes: 'VIP customer'
        }
      ]
    });
  });

  it('omits optional contact fields when absent and falls back to a contact phone number', async () => {
    const service = await createService();
    axiosRequestMock.mockResolvedValueOnce({
      data: { Contacts: [{ ContactID: 'xero-contact-2', Name: 'Bare Co' }] }
    });

    await service.createOrUpdateContact(
      companyPayload({
        name: 'Bare Co',
        primaryEmail: null,
        primaryPhone: null,
        billingAddress: null,
        taxNumber: null,
        notes: null,
        contacts: [
          { name: 'No phone', phone: null } as any,
          { name: 'Has phone', phone: '+44 20 0000 0000' } as any
        ]
      })
    );

    const contact = (axiosRequestMock.mock.calls.at(-1)![0] as Record<string, any>).data.Contacts[0];
    expect(contact).toEqual({
      Name: 'Bare Co',
      Phones: [{ PhoneType: 'DEFAULT', PhoneNumber: '+44 20 0000 0000' }]
    });
  });

  it('normalizes the returned contact into an ExternalCompanyRecord', async () => {
    const service = await createService();
    const rawContact = { ContactID: 'xero-contact-3', ContactNumber: 'C-77', Name: 'Acme Corp' };
    axiosRequestMock.mockResolvedValueOnce({ data: { Contacts: [rawContact] } });

    await expect(service.createOrUpdateContact(companyPayload())).resolves.toEqual({
      externalId: 'xero-contact-3',
      displayName: 'Acme Corp',
      syncToken: 'C-77',
      raw: rawContact
    });
  });

  it('escapes double quotes when searching contacts by name', async () => {
    const service = await createService();
    axiosRequestMock.mockResolvedValueOnce({ data: { Contacts: [] } });

    await service.findContactByName('Acme "The Best" Corp');

    const config = axiosRequestMock.mock.calls.at(-1)![0] as Record<string, any>;
    expect(config.url).toBe('/Contacts');
    expect(config.params.where).toBe('Name=="Acme \\"The Best\\" Corp"');
  });

  it('falls back to looking up the contact by name when creation fails', async () => {
    const service = await createService();
    const existing = { ContactID: 'xero-contact-4', Name: 'Acme Corp' };
    axiosRequestMock
      .mockRejectedValueOnce({ isAxiosError: true, response: { status: 500, data: {} } })
      .mockResolvedValueOnce({ data: { Contacts: [existing] } });

    await expect(service.createOrUpdateContact(companyPayload())).resolves.toEqual({
      externalId: 'xero-contact-4',
      displayName: 'Acme Corp',
      syncToken: undefined,
      raw: existing
    });
  });
});
