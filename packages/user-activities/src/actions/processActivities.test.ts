import { describe, expect, it, vi } from 'vitest';
import { ActivityPriority, ActivityType } from '@alga-psa/types';

const mocks = vi.hoisted(() => ({
  createTenantKnex: vi.fn(),
  tenantDb: vi.fn(),
  getScheduleActivityEntriesForUser: vi.fn(),
}));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@alga-psa/db')>(),
  createTenantKnex: mocks.createTenantKnex,
  tenantDb: mocks.tenantDb,
}));
vi.mock('@alga-psa/scheduling/actions/scheduleActivityCore', () => ({
  getScheduleActivityEntriesForUser: mocks.getScheduleActivityEntriesForUser,
}));

import { processActivities } from './activityAggregationActions';

const sched = (id: string, dueDate: string, over: Record<string, unknown> = {}) =>
  ({
    id,
    type: ActivityType.SCHEDULE,
    title: 'Weekly sync',
    priority: ActivityPriority.MEDIUM,
    status: 'scheduled',
    dueDate,
    createdAt: '2026-01-01T00:00:00.000Z',
    isRecurring: true,
    workItemId: 'w1',
    workItemType: 'ticket',
    ...over,
  }) as any;

const fixture = () => [
  sched('r3', '2026-03-03T00:00:00.000Z'),
  sched('r1', '2026-03-01T00:00:00.000Z'),
  sched('r2', '2026-03-02T00:00:00.000Z'),
  sched('one', '2026-03-10T00:00:00.000Z', { title: 'One-off', isRecurring: false }),
];

describe('processActivities collapseRecurringSeries', () => {
  it('collapses after sorting, so the earliest-due occurrence survives regardless of input order, and counts are per series', () => {
    // fixture() feeds the occurrences out of order (r3, r1, r2).
    const out = processActivities(fixture(), { collapseRecurringSeries: true });
    expect(out.map((a) => a.id)).toEqual(['r1', 'one']);
    expect(out).toHaveLength(2); // totalCount = out.length in fetchActivities: series, not occurrences
  });

  it('leaves recurring duplicates alone without the flag (table path unchanged)', () => {
    const out = processActivities(fixture(), {});
    expect(out.map((a) => a.id)).toEqual(['r1', 'r2', 'r3', 'one']);
  });

  it('applies filters before collapsing', () => {
    const out = processActivities(fixture(), {
      collapseRecurringSeries: true,
      dueDateStart: '2026-03-02T00:00:00.000Z',
    });
    expect(out.map((a) => a.id)).toEqual(['r2', 'one']);
    const out2 = processActivities(fixture(), {
      collapseRecurringSeries: true,
      dueDateEnd: '2026-03-02T00:00:00.000Z',
    });
    expect(out2.map((a) => a.id)).toEqual(['r1']);
  });
});
