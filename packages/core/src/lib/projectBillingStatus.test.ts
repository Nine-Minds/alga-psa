import { describe, expect, it } from 'vitest';
import { isPhaseBillingOverdue } from './projectBillingStatus';

describe('isPhaseBillingOverdue', () => {
  const today = '2026-07-30';

  it.each([
    ['past pending phase entry', '2026-07-29', 'pending', 'phase', true],
    ['past timestamp-shaped phase entry', '2026-07-29T00:00:00.000Z', 'pending', 'phase', true],
    ['today pending phase entry', '2026-07-30', 'pending', 'phase', false],
    ['future pending phase entry', '2026-07-31', 'pending', 'phase', false],
    ['missing phase end date', null, 'pending', 'phase', false],
    ['past ready phase entry', '2026-07-29', 'ready', 'phase', false],
    ['past invoiced phase entry', '2026-07-29', 'invoiced', 'phase', false],
    ['past pending manual entry', '2026-07-29', 'pending', 'manual', false],
  ] as const)('%s', (_label, phaseEndDate, status, triggerType, expected) => {
    expect(isPhaseBillingOverdue({
      phase_end_date: phaseEndDate,
      status,
      trigger_type: triggerType,
    }, today)).toBe(expected);
  });

  it('treats database Date values as UTC calendar dates', () => {
    expect(isPhaseBillingOverdue({
      phase_end_date: new Date('2026-07-30T00:00:00.000Z'),
      status: 'pending',
      trigger_type: 'phase',
    }, today)).toBe(false);
  });
});
