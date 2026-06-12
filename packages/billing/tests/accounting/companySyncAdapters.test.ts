/**
 * Unit tests for the company-sync accounting adapters
 * (packages/billing/src/services/companySync/adapters/).
 *
 * The adapters bridge normalized company payloads to the QBO/Xero client
 * services. The external client services are mocked; we verify context
 * validation (QBO realm requirement), factory wiring, and delegation.
 */
import { describe, expect, it, vi } from 'vitest';

// The real client services pull axios/secret providers; keep the unit
// boundary at the injected client factory.
vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  QboClientService: { create: vi.fn() },
}));
vi.mock('@alga-psa/integrations/lib/xero/xeroClientService', () => ({
  XeroClientService: { create: vi.fn() },
}));

import { QuickBooksOnlineCompanyAdapter } from '../../src/services/companySync/adapters/quickBooksCompanyAdapter';
import { XeroCompanyAdapter } from '../../src/services/companySync/adapters/xeroCompanyAdapter';
import type { NormalizedCompanyPayload } from '../../src/services/companySync/companySync.types';
import { AppError } from '@alga-psa/core';

const payload: NormalizedCompanyPayload = { companyId: 'co-1', name: 'Acme Co' };

describe('QuickBooksOnlineCompanyAdapter', () => {
  it('requires a target realm before any client is constructed', async () => {
    const factory = vi.fn();
    const adapter = new QuickBooksOnlineCompanyAdapter(factory);

    const attempt = adapter.findExternalCompany(payload, { tenantId: 'tenant-1', targetRealm: null });

    await expect(attempt).rejects.toMatchObject({
      constructor: AppError,
      code: 'QBO_REALM_REQUIRED',
    });
    expect(factory).not.toHaveBeenCalled();
  });

  it('looks up customers by display name through a realm-scoped client', async () => {
    const found = { externalId: 'qbo-5', displayName: 'Acme Co' };
    const client = {
      findCustomerByDisplayName: vi.fn(async () => found),
      createOrUpdateCustomer: vi.fn(),
    };
    const factory = vi.fn(async () => client);
    const adapter = new QuickBooksOnlineCompanyAdapter(factory as any);

    const result = await adapter.findExternalCompany(payload, {
      tenantId: 'tenant-1',
      targetRealm: 'realm-9',
    });

    expect(factory).toHaveBeenCalledWith('tenant-1', 'realm-9');
    expect(client.findCustomerByDisplayName).toHaveBeenCalledWith('Acme Co');
    expect(result).toBe(found);
  });

  it('delegates createOrUpdate with the full normalized payload', async () => {
    const created = { externalId: 'qbo-6', displayName: 'Acme Co' };
    const client = {
      findCustomerByDisplayName: vi.fn(),
      createOrUpdateCustomer: vi.fn(async () => created),
    };
    const adapter = new QuickBooksOnlineCompanyAdapter(vi.fn(async () => client) as any);

    const result = await adapter.createOrUpdateExternalCompany(payload, {
      tenantId: 'tenant-1',
      targetRealm: 'realm-9',
    });

    expect(client.createOrUpdateCustomer).toHaveBeenCalledWith(payload);
    expect(result).toBe(created);
  });

  it('identifies itself as the quickbooks_online adapter', () => {
    expect(new QuickBooksOnlineCompanyAdapter(vi.fn() as any).type).toBe('quickbooks_online');
  });
});

describe('XeroCompanyAdapter', () => {
  it('works without a target realm, passing a null connection id to the factory', async () => {
    const client = {
      findContactByName: vi.fn(async () => null),
      createOrUpdateContact: vi.fn(),
    };
    const factory = vi.fn(async () => client);
    const adapter = new XeroCompanyAdapter(factory as any);

    const result = await adapter.findExternalCompany(payload, { tenantId: 'tenant-1' });

    expect(factory).toHaveBeenCalledWith('tenant-1', null);
    expect(client.findContactByName).toHaveBeenCalledWith('Acme Co');
    expect(result).toBeNull();
  });

  it('passes the target realm through as the Xero connection id', async () => {
    const client = {
      findContactByName: vi.fn(async () => null),
      createOrUpdateContact: vi.fn(),
    };
    const factory = vi.fn(async () => client);
    const adapter = new XeroCompanyAdapter(factory as any);

    await adapter.findExternalCompany(payload, { tenantId: 'tenant-1', targetRealm: 'conn-3' });

    expect(factory).toHaveBeenCalledWith('tenant-1', 'conn-3');
  });

  it('delegates createOrUpdate with the full normalized payload', async () => {
    const created = { externalId: 'xero-1', displayName: 'Acme Co' };
    const client = {
      findContactByName: vi.fn(),
      createOrUpdateContact: vi.fn(async () => created),
    };
    const adapter = new XeroCompanyAdapter(vi.fn(async () => client) as any);

    const result = await adapter.createOrUpdateExternalCompany(payload, { tenantId: 'tenant-1' });

    expect(client.createOrUpdateContact).toHaveBeenCalledWith(payload);
    expect(result).toBe(created);
  });

  it('identifies itself as the xero adapter', () => {
    expect(new XeroCompanyAdapter(vi.fn() as any).type).toBe('xero');
  });
});
