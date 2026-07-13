import { describe, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { bucketQueueActionItems } from '../src/lib/workQueueBuckets';

function opportunity(overrides: Record<string, unknown>) {
  return {
    opportunity_id: 'opportunity-default',
    opportunity_number: 'OPP-0001',
    title: 'Managed services expansion',
    client_name: 'Acme',
    stage: 'qualified',
    mrr_cents: 10000,
    nrr_cents: 5000,
    hardware_cents: 0,
    currency_code: 'USD',
    next_action: 'Call the decision maker',
    next_action_due: '2026-07-20T14:00:00.000Z',
    last_activity_at: '2026-07-11T14:00:00.000Z',
    ...overrides,
  } as any;
}

describe('work queue action bucketing', () => {
  it('orders due work, marks only the first item primary, and excludes due work from going quiet', () => {
    const result = bucketQueueActionItems({
      now: Temporal.Instant.from('2026-07-12T16:00:00.000Z'),
      timezone: 'America/New_York',
      nudgeDays: 14,
      opportunities: [
        opportunity({
          opportunity_id: 'due-today',
          opportunity_number: 'OPP-0002',
          next_action_due: '2026-07-12T18:00:00.000Z',
        }),
        opportunity({
          opportunity_id: 'overdue-and-quiet',
          opportunity_number: 'OPP-0003',
          next_action_due: '2026-07-10T15:00:00.000Z',
          last_activity_at: '2026-06-01T15:00:00.000Z',
        }),
        opportunity({
          opportunity_id: 'quiet-future',
          opportunity_number: 'OPP-0004',
          next_action_due: '2026-07-20T15:00:00.000Z',
          last_activity_at: '2026-06-20T15:00:00.000Z',
        }),
        opportunity({
          opportunity_id: 'future-fresh',
          opportunity_number: 'OPP-0005',
          next_action_due: '2026-07-21T15:00:00.000Z',
          last_activity_at: '2026-07-11T15:00:00.000Z',
        }),
      ],
    });

    expect(result.do_today.map((item) => item.opportunity_id)).toEqual([
      'overdue-and-quiet',
      'due-today',
    ]);
    expect(result.do_today.map((item) => item.is_screen_primary)).toEqual([true, false]);
    expect(result.going_quiet.map((item) => item.opportunity_id)).toEqual(['quiet-future']);
    expect(result.going_quiet[0].is_screen_primary).toBe(false);
  });
});
