import { describe, expect, it, vi } from 'vitest';

import { BillingEngine } from '@alga-psa/billing/services';

describe('billing engine billed-through reader', () => {
  it('T201: recurring billed-through enforcement reads canonical invoice charge detail periods instead of invoice header periods', async () => {
    const engine = new BillingEngine();
    const builder: any = {
      join: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      first: vi.fn(async () => ({ item_id: 'detail-1' })),
    };
    const knex = vi.fn(() => builder);

    (engine as any).tenant = 'tenant-1';
    (engine as any).knex = knex;

    const exists = await (engine as any).hasExistingServicePeriodCharge(
      'contract-line-1',
      '2025-01-01',
      '2025-01-31',
      'advance'
    );

    const queriedColumns = [
      ...builder.where.mock.calls.map((call: any[]) => call[0]),
      ...builder.andWhere.mock.calls.map((call: any[]) => call[0]),
    ];

    expect(exists).toBe(true);
    expect(knex).toHaveBeenCalledWith('invoice_charge_details as iid');
    expect(builder.join).toHaveBeenCalledWith(
      'contract_line_service_configuration as clsc',
      expect.any(Function)
    );
    expect(queriedColumns).toContain('iid.service_period_start');
    expect(queriedColumns).toContain('iid.service_period_end');
    expect(queriedColumns).toContain('iid.billing_timing');
    expect(queriedColumns).not.toContain('invoices.billing_period_end');
    expect(queriedColumns).not.toContain('billing_period_end');
  });
});
