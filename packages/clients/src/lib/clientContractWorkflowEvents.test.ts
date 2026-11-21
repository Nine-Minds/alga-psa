import { describe, expect, it } from 'vitest';
import { deriveClientContractWorkflowStatus } from './clientContractWorkflowEvents';

describe('client contract workflow status', () => {
  it.each([
    ['2026-10-14', 'scheduled'],
    ['2026-10-15', 'active'],
    ['2026-10-31', 'active'],
    ['2026-11-01', 'expired'],
  ] as const)('preserves PostgreSQL calendar dates on tenant day %s', (now, expected) => {
    expect(deriveClientContractWorkflowStatus({
      isActive: true,
      startDate: new Date(2026, 9, 15),
      endDate: new Date(2026, 9, 31),
      now,
    })).toBe(expected);
  });

  it('keeps an inactive future assignment terminated', () => {
    expect(deriveClientContractWorkflowStatus({
      isActive: false,
      startDate: new Date(2026, 9, 15),
      endDate: null,
      now: '2026-10-14',
    })).toBe('terminated');
  });
});
