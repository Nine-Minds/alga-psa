import { describe, expect, it } from 'vitest';
import { buildRecurringPricingScheduleFixture } from '../../test-utils/pricingScheduleHelpers';

describe('pricingScheduleHelpers recurring fixtures', () => {
  it('builds client-cadence recurring pricing fixtures with stable defaults', () => {
    const fixture = buildRecurringPricingScheduleFixture({
      customRate: 12000,
    });

    expect(fixture.cadenceOwner).toBe('client');
    expect(fixture.duePosition).toBe('advance');
    expect(fixture.currentInvoiceWindow).toMatchObject({
      cadenceOwner: 'client',
      duePosition: 'advance',
      start: '2025-01-01',
      end: '2025-02-01',
    });
    expect(fixture.servicePeriods.map((period) => period.cadenceOwner)).toEqual([
      'client',
      'client',
      'client',
    ]);
    expect(fixture.schedule).toMatchObject({
      effectiveDate: '2025-01-01',
      customRate: 12000,
      endDate: null,
    });
  });

  it('supports contract-cadence arrears fixtures without rewriting helper call sites', () => {
    const fixture = buildRecurringPricingScheduleFixture({
      cadenceOwner: 'contract',
      duePosition: 'arrears',
      effectiveDate: '2025-02-08',
      endDate: '2025-05-08',
      customRate: 18000,
      notes: 'Contract anniversary override',
    });

    expect(fixture.cadenceOwner).toBe('contract');
    expect(fixture.currentInvoiceWindow).toMatchObject({
      cadenceOwner: 'contract',
      duePosition: 'arrears',
      start: '2025-02-01',
      end: '2025-03-01',
    });
    expect(fixture.servicePeriods.every((period) => period.cadenceOwner === 'contract')).toBe(true);
    expect(fixture.servicePeriods.every((period) => period.duePosition === 'arrears')).toBe(true);
    expect(fixture.schedule).toMatchObject({
      effectiveDate: '2025-02-08',
      endDate: '2025-05-08',
      customRate: 18000,
      notes: 'Contract anniversary override',
    });
  });
});
