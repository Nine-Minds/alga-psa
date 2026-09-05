import { describe, expect, it } from 'vitest';
import { advanceMaintenanceDate } from './maintenanceRecurrence';

describe('advanceMaintenanceDate', () => {
  it('anchors a late completion to the actual completion date', () => {
    expect(advanceMaintenanceDate('2026-08-22T12:00:00.000Z', 'monthly', 1).toISOString())
      .toBe('2026-09-22T12:00:00.000Z');
  });

  it('supports interval and month-end cadence without overflowing the target month', () => {
    expect(advanceMaintenanceDate('2026-01-31T12:00:00.000Z', 'monthly', 1).toISOString())
      .toBe('2026-02-28T12:00:00.000Z');
    expect(advanceMaintenanceDate('2026-01-31T12:00:00.000Z', 'quarterly', 2).toISOString())
      .toBe('2026-07-31T12:00:00.000Z');
  });

  it('rejects custom cadence instead of treating it as daily', () => {
    expect(() => advanceMaintenanceDate('2026-08-22T12:00:00.000Z', 'custom', 1))
      .toThrow('Custom maintenance frequency');
  });
});
