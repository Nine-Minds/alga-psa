import { describe, expect, it } from 'vitest';

const migration = require('../../../../migrations/20260802090000_eliminate_premium_tier.cjs');

describe('eliminate Premium tier migration', () => {
  it('normalizes legacy trial metadata and retains its billing schedule for cleanup', () => {
    expect(
      migration.normalizePremiumTrialMetadata({
        premium_trial: 'confirmed',
        premium_trial_end: '2026-08-31T00:00:00.000Z',
        premium_trial_confirmed: '2026-08-01T00:00:00.000Z',
        premium_trial_effective_date: '2026-09-01T00:00:00.000Z',
        schedule_id: 'sub_sched_legacy_premium',
        solo_pro_trial: 'true',
      }),
    ).toEqual({
      changed: true,
      metadata: {
        retired_premium_schedule_id: 'sub_sched_legacy_premium',
        solo_pro_trial: 'true',
      },
    });
  });

  it('is idempotent', () => {
    const first = migration.normalizePremiumTrialMetadata({
      premium_trial: 'true',
      premium_trial_started: '2026-08-01T00:00:00.000Z',
      premium_trial_end: '2026-08-31T00:00:00.000Z',
    });
    const second = migration.normalizePremiumTrialMetadata(first.metadata);

    expect(first.changed).toBe(true);
    expect(second).toEqual({ changed: false, metadata: {} });
  });
});
