import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ tenantDb: vi.fn(), publishEvent: vi.fn() }));
vi.mock('@alga-psa/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@alga-psa/db')>()), tenantDb: mocks.tenantDb, withTransaction: async (_knex: unknown, callback: (trx: unknown) => Promise<unknown>) => callback({}) }));
vi.mock('@alga-psa/shared/billingClients/defaultTaxRate', () => ({ resolveCatalogTaxRateIdForCreate: async (_trx: unknown, _tenant: string, explicitRate: string | null | undefined) => explicitRate ?? null }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: mocks.publishEvent }));

import { ServiceCatalogService } from '../../../lib/api/services/ServiceCatalogService';
import { createServiceSchema } from '../../../lib/api/schemas/serviceSchemas';

const context = { tenant: 'uom-api-tenant', userId: 'uom-api-user', user: {}, db: {} as any };

describe('ServiceCatalogService unit defaults', () => {
  it('defaults hourly to Hour/HUR and fixed to Each/C62; usage without a unit is rejected by schema', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    mocks.publishEvent.mockResolvedValue(undefined);
    mocks.tenantDb.mockImplementation((_knex: unknown, _tenant: string) => ({
      table: (name: string) => {
        if (name === 'service_types') return { where: () => ({ first: async () => ({ id: 'type-1' }) }) };
        if (name === 'service_catalog') return {
          insert: (data: Record<string, unknown>) => ({ returning: async () => { inserted.push(data); return [{ ...data, service_id: `service-${inserted.length}` }]; } }),
        };
        throw new Error(`Unexpected table ${name}`);
      },
    }));
    const service = new ServiceCatalogService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: {} });
    vi.spyOn(service, 'getById').mockResolvedValue({} as any);

    await service.create({ service_name: 'Hourly', custom_service_type_id: 'type-1', billing_method: 'hourly', default_rate: 10 }, context as any);
    await service.create({ service_name: 'Fixed', custom_service_type_id: 'type-1', billing_method: 'fixed', default_rate: 10 }, context as any);
    expect(inserted).toEqual(expect.arrayContaining([
      expect.objectContaining({ service_name: 'Hourly', unit_of_measure: 'Hour', unit_code: 'HUR' }),
      expect.objectContaining({ service_name: 'Fixed', unit_of_measure: 'Each', unit_code: 'C62' }),
    ]));
    expect(createServiceSchema.safeParse({
      service_name: 'Usage', custom_service_type_id: '11111111-1111-4111-8111-111111111111',
      billing_method: 'usage', default_rate: 10,
    }).success).toBe(false);
  });
});
