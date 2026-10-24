import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchTenantPartyMock } = vi.hoisted(() => ({
  fetchTenantPartyMock: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  runWithTenant: async (_tenant: string, fn: () => unknown) => fn(),
  tenantDb: () => {
    throw new Error('no database in this test');
  },
  withTransaction: async (_knex: unknown, fn: (trx: unknown) => unknown) => fn({}),
}));

vi.mock('./browserPoolService', () => ({
  browserPoolService: { getBrowser: vi.fn(), releaseBrowser: vi.fn() },
}));

vi.mock('../lib/adapters/tenantPartyAdapter', () => ({
  fetchTenantParty: (...args: unknown[]) => fetchTenantPartyMock(...args),
}));

import { PDFGenerationService } from './pdfGenerationService';

const BRANDING_LOGO = '/api/documents/view/22222222-2222-2222-2222-222222222222?t=2';

/**
 * Whatever logo the party adapter resolves — branding first, own-company record
 * second — is the one the standard templates bind as `tenantClientLogo`.
 */
describe('PDFGenerationService tenant-client logo', () => {
  beforeEach(() => {
    fetchTenantPartyMock.mockReset();
  });

  it('carries the resolved branding logo onto the rendered document data', async () => {
    fetchTenantPartyMock.mockResolvedValue({
      name: 'Managed Nerds',
      address: '1 Nerd Way',
      email: 'billing@example.com',
      phone: '555-0100',
      logo_url: BRANDING_LOGO,
    });
    const service = new PDFGenerationService('tenant-1');

    const enriched = await (service as any).enrichWithTenantClient({}, { invoice_number: 'INV-1' });

    expect(enriched).toEqual({
      invoice_number: 'INV-1',
      tenantClient: {
        name: 'Managed Nerds',
        address: '1 Nerd Way',
        logoUrl: BRANDING_LOGO,
      },
    });
  });

  it('leaves the document data untouched when no tenant party resolves', async () => {
    fetchTenantPartyMock.mockResolvedValue(null);
    const service = new PDFGenerationService('tenant-1');

    const dbData = { invoice_number: 'INV-2' };
    expect(await (service as any).enrichWithTenantClient({}, dbData)).toBe(dbData);
  });
});
