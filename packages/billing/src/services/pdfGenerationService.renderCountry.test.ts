import { beforeEach, describe, expect, it, vi } from 'vitest';

const { resolveClientCountryMock, resolveTenantDefaultCountryMock } = vi.hoisted(() => ({
  resolveClientCountryMock: vi.fn(),
  resolveTenantDefaultCountryMock: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  runWithTenant: async (_tenant: string, fn: () => unknown) => fn(),
  tenantDb: () => {
    throw new Error('no database in this test');
  },
  withTransaction: async (_knex: unknown, fn: (trx: unknown) => unknown) => fn({}),
}));

vi.mock('@alga-psa/tenancy/lib/tenantDefaultCountry', () => ({
  resolveClientCountry: resolveClientCountryMock,
  resolveTenantDefaultCountry: resolveTenantDefaultCountryMock,
}));

vi.mock('./browserPoolService', () => ({
  browserPoolService: { getBrowser: vi.fn(), releaseBrowser: vi.fn() },
}));

import { SYSTEM_DATE_FORMAT } from '@alga-psa/core/i18n/countryDateFormat';
import { PDFGenerationService } from './pdfGenerationService';

const buildService = (recipientClientId: string | null) => {
  const service = new PDFGenerationService('tenant-1');
  (service as any).resolveRecipientClientId = vi.fn().mockResolvedValue(recipientClientId);
  return service;
};

/**
 * The document's date shape is a separate question from its language: a UK
 * client of a US MSP reads 30/09/2026 whether the invoice arrives in English or
 * French. These pin the order the answer is looked for in.
 */
describe('PDFGenerationService.resolveRenderCountry', () => {
  beforeEach(() => {
    resolveClientCountryMock.mockReset();
    resolveTenantDefaultCountryMock.mockReset();
  });

  it("prefers the recipient client's own country over the tenant default", async () => {
    resolveClientCountryMock.mockResolvedValue({ code: 'GB', name: 'United Kingdom' });
    resolveTenantDefaultCountryMock.mockResolvedValue({ code: 'US', name: 'United States' });

    const format = await buildService('client-1').resolveRenderCountry({ invoiceId: 'invoice-1' });

    expect(format.country).toBe('GB');
    expect(format.datePattern).toBe('dd/MM/yyyy');
    expect(resolveTenantDefaultCountryMock).not.toHaveBeenCalled();
  });

  it('falls back to the tenant default when the client has no country', async () => {
    resolveClientCountryMock.mockResolvedValue(null);
    resolveTenantDefaultCountryMock.mockResolvedValue({ code: 'DE', name: 'Germany' });

    const format = await buildService('client-1').resolveRenderCountry({ quoteId: 'quote-1' });

    expect(format.country).toBe('DE');
    expect(format.datePattern).toBe('dd.MM.yyyy');
    expect(format.hour12).toBe(false);
  });

  it('falls back to the fixed system default when neither resolves', async () => {
    resolveClientCountryMock.mockResolvedValue(null);
    resolveTenantDefaultCountryMock.mockResolvedValue(null);

    const format = await buildService('client-1').resolveRenderCountry({ salesOrderId: 'so-1' });

    expect(format).toEqual(SYSTEM_DATE_FORMAT);
  });

  it('asks only the tenant default when there is no document to address', async () => {
    resolveTenantDefaultCountryMock.mockResolvedValue({ code: 'AU', name: 'Australia' });

    const format = await buildService(null).resolveRenderCountry({});

    expect(format.datePattern).toBe('dd/MM/yyyy');
    expect(resolveClientCountryMock).not.toHaveBeenCalled();
  });

  it('answers the system default rather than failing the render', async () => {
    resolveClientCountryMock.mockRejectedValue(new Error('database unreachable'));

    const format = await buildService('client-1').resolveRenderCountry({ invoiceId: 'invoice-1' });

    expect(format).toEqual(SYSTEM_DATE_FORMAT);
  });
});
