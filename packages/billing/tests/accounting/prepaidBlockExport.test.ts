import { describe, expect, it, vi } from 'vitest';

/**
 * Prepaid Block invoice lines (plan section 8, part 4): the issuance line is
 * sold as `sold_as_service_id` (charge.service_id) and so resolves its
 * accounting mapping exactly like an ad-hoc block line; the $0 consumption
 * lines keep a service_id and pass the shared quantity reconciliation both the
 * QuickBooks Online and Xero adapters use, without the lump fallback.
 */

const mappings = vi.hoisted(() => ({
  rows: [
    { alga_entity_id: 'svc-sold-as', external_entity_id: 'item-block', metadata: { name: 'Block' } },
  ] as Array<{ alga_entity_id: string; external_entity_id: string; metadata: unknown }>,
}));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createTenantKnex: vi.fn(),
  tenantDb: vi.fn(() => ({
    table: () => {
      let entityId: string | null = null;
      const qb: any = {
        where: (cond: Record<string, string>) => {
          if (cond?.alga_entity_id) entityId = cond.alga_entity_id;
          return qb;
        },
        whereNull: () => qb,
        select: () => qb,
        first: async () => mappings.rows.find((row) => row.alga_entity_id === entityId) ?? null,
      };
      return qb;
    },
  })),
}));

import { AccountingMappingResolver } from '../../src/services/accountingMappingResolver';
import { reconcileExportLineQuantity } from '../../src/adapters/accounting/exportLineQuantity';

describe('prepaid block accounting export', () => {
  it('resolves the issuance line through its sold-as service mapping, like an ad-hoc block line', async () => {
    const resolver = new AccountingMappingResolver({} as any, undefined, 'tenant-x');
    const prepaidBlockLine = { service_id: 'svc-sold-as' };
    const adHocBlockLine = { service_id: 'svc-sold-as' };
    for (const adapterType of ['quickbooks_online', 'xero']) {
      const a = await resolver.resolveServiceMapping({ adapterType, serviceId: prepaidBlockLine.service_id });
      const b = await resolver.resolveServiceMapping({ adapterType, serviceId: adHocBlockLine.service_id });
      expect(a).toMatchObject({ external_entity_id: 'item-block', source: 'service' });
      expect(b).toEqual(a);
    }
  });

  it('exports the $0 consumption line as its stored quantity at unit price 0 for both adapters', () => {
    const result = reconcileExportLineQuantity({
      quantity: 4,
      unitPriceCents: 0,
      amountCents: 0,
      maxQuantityDecimals: 4,
    });
    expect(result).toEqual({ quantity: 4, unitPriceCents: 0, strategy: 'stored' });
  });

  it('exports the issuance line as hours at the derived rate', () => {
    const result = reconcileExportLineQuantity({
      quantity: 10,
      unitPriceCents: 15000,
      amountCents: 150000,
      maxQuantityDecimals: 4,
    });
    expect(result).toMatchObject({ quantity: 10, unitPriceCents: 15000 });
  });
});
