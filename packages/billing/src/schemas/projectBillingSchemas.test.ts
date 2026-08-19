import { describe, expect, it } from 'vitest';
import { createProjectBillingScheduleEntrySchema } from './projectBillingSchemas';

const validEntry = {
  config_id: '10000000-0000-4000-8000-000000000001',
  entry_type: 'milestone' as const,
  description: 'Calendar trigger',
  amount: 1_000,
  trigger_type: 'date' as const,
};

describe('project billing schedule date-only schema', () => {
  it('defaults the payment prerequisite flag off and preserves an explicit opt-in', () => {
    expect(createProjectBillingScheduleEntrySchema.parse({
      ...validEntry,
      trigger_date: '2026-11-01',
    }).requires_payment_before_work).toBe(false);
    expect(createProjectBillingScheduleEntrySchema.parse({
      ...validEntry,
      trigger_date: '2026-11-01',
      requires_payment_before_work: true,
    }).requires_payment_before_work).toBe(true);
    expect(createProjectBillingScheduleEntrySchema.parse({
      ...validEntry,
      trigger_date: '2026-11-01',
    }).increase_total).toBe(false);
  });

  it('allows total increases only for amount-based entries', () => {
    expect(createProjectBillingScheduleEntrySchema.safeParse({
      ...validEntry,
      trigger_date: '2026-11-01',
      increase_total: true,
    }).success).toBe(true);
    const invalid = createProjectBillingScheduleEntrySchema.safeParse({
      ...validEntry,
      amount: null,
      percentage: 25,
      trigger_date: '2026-11-01',
      increase_total: true,
    });
    expect(invalid.success).toBe(false);
    expect(invalid.error?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        params: {
          messageKey: 'msp/billing:errors.projectBilling.validation.increaseTotalAmountOnly',
        },
      }),
    ]));
  });

  it('keeps a valid calendar date as a YYYY-MM-DD string', () => {
    expect(createProjectBillingScheduleEntrySchema.parse({
      ...validEntry,
      trigger_date: '2026-11-01',
    }).trigger_date).toBe('2026-11-01');
  });

  it.each(['2026-02-29', '2026-13-01', '11/01/2026', '2026-11-01T00:00:00.000Z'])(
    'rejects invalid or timestamp-shaped trigger date %s',
    (trigger_date) => {
      expect(createProjectBillingScheduleEntrySchema.safeParse({
        ...validEntry,
        trigger_date,
      }).success).toBe(false);
    },
  );
});
