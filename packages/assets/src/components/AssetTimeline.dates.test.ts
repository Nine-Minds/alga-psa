/**
 * Regression: the timeline put "Purchased" on the wrong calendar day.
 *
 * `purchase_date` is a date column, stored as UTC midnight, so the milestone
 * built straight from it rendered the previous day west of UTC — the tile said
 * May 23 and the timeline said May 22 for the same asset.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

// AssetTimeline is a client component; the helpers under test are pure, so the
// server actions it imports are stubbed rather than loaded (they pull next-auth).
vi.mock('../actions/assetActions', () => ({
  getAssetHistory: vi.fn(),
  getAssetLinkedTickets: vi.fn(),
  getAssetMaintenanceReport: vi.fn(),
}));
vi.mock('../actions/assetActionErrors', () => ({
  unwrapAssetActionResult: (value: unknown) => value,
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const { calendarMilestoneAt, formatEventAge } = await import('./AssetTimeline');

const originalTz = process.env.TZ;
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe('calendarMilestoneAt', () => {
  it('keeps the stored calendar day west of UTC', () => {
    process.env.TZ = 'America/Los_Angeles';
    // What the milestone used to be built from, for contrast.
    expect(new Date('2025-05-23T00:00:00.000Z').toLocaleDateString('en-US')).toBe('5/22/2025');

    const at = calendarMilestoneAt('2025-05-23T00:00:00.000Z')!;
    expect(new Date(at).toLocaleDateString('en-US')).toBe('5/23/2025');
    expect(formatEventAge(at, Date.parse('2026-01-01T00:00:00.000Z'), 'en-US')).toBe('5/23/2025');
  });

  it('keeps the stored calendar day east of UTC', () => {
    process.env.TZ = 'Australia/Brisbane';
    const at = calendarMilestoneAt('2025-05-23')!;
    expect(new Date(at).toLocaleDateString('en-US')).toBe('5/23/2025');
  });

  it('is undefined when there is no date to place', () => {
    expect(calendarMilestoneAt(null)).toBeUndefined();
    expect(calendarMilestoneAt(undefined)).toBeUndefined();
    expect(calendarMilestoneAt('')).toBeUndefined();
  });
});
