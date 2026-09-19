import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateAllDayInterval } from '@alga-psa/shared/models/scheduleEntry';

/**
 * A co-managed tenant's schedule updates are claimed by
 * `commandCoManagedNativeSchedule` instead of the generic path covered by
 * `timeSheetServiceAllDayValidation.test.ts`. That command originally neither
 * accepted `is_all_day` as a writable field nor applied the all-day rule, so on
 * exactly the tenants this feature targets an all-day entry could not be edited
 * and its boundaries were never checked.
 */
const source = readFileSync(
  resolve(__dirname, '../../../../../packages/co-managed/src/nativeScheduleCommand.ts'),
  'utf8',
);

describe('co-managed native schedule command: all-day entries', () => {
  it('treats is_all_day as a writable, type-checked field', () => {
    const writable = source.match(/const writable = \[(.*?)\] as const;/s)?.[1];
    expect(writable, 'writable field list').toBeTruthy();
    expect(writable).toContain("'is_all_day'");
    // Defaulted on the merged row so a create without the field is still valid...
    expect(source).toContain('is_private: false, is_all_day: false');
    // ...and rejected when it is not a boolean, alongside the other scalar guards.
    expect(source).toContain("typeof merged.is_all_day !== 'boolean'");
  });

  it('applies the shared all-day rule to the merged row, not to the caller patch', () => {
    expect(source).toContain('validateAllDayInterval(merged)');
    // Validating `merged` rather than `input` is what makes a partial date update on an
    // existing all-day entry fail: the existing flag still governs.
    expect(source).not.toContain('validateAllDayInterval(input)');
    expect(source).not.toContain('validateAllDayInterval(fields)');
  });

  it('enforces UTC-midnight boundaries with an exclusive end', () => {
    const day = (iso: string) => new Date(iso);
    expect(() => validateAllDayInterval({
      is_all_day: true, scheduled_start: day('2026-10-25T00:00:00Z'), scheduled_end: day('2026-10-26T00:00:00Z'),
    } as any)).not.toThrow();

    for (const [label, start, end] of [
      ['non-midnight start', '2026-10-25T09:00:00Z', '2026-10-26T00:00:00Z'],
      ['non-midnight end', '2026-10-25T00:00:00Z', '2026-10-26T09:00:00Z'],
      ['end equal to start', '2026-10-25T00:00:00Z', '2026-10-25T00:00:00Z'],
    ] as const) {
      expect(() => validateAllDayInterval({
        is_all_day: true, scheduled_start: day(start), scheduled_end: day(end),
      } as any), label).toThrow(/all-day/i);
    }

    // A timed entry is unconstrained by this rule.
    expect(() => validateAllDayInterval({
      is_all_day: false, scheduled_start: day('2026-10-25T09:00:00Z'), scheduled_end: day('2026-10-25T09:30:00Z'),
    } as any)).not.toThrow();
  });
});
