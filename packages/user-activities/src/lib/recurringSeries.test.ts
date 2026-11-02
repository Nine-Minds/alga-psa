import { describe, expect, it } from 'vitest';
import { ActivityType } from '@alga-psa/types';
import { collapseRecurringSeries } from './recurringSeries';

const sched = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, type: ActivityType.SCHEDULE, title: 'Standup', isRecurring: true, workItemId: 'w1', workItemType: 'ticket', ...over }) as any;

describe('collapseRecurringSeries', () => {
  it('keeps only the first occurrence of a series (same title, workItemId, workItemType)', () => {
    const out = collapseRecurringSeries([sched('a'), sched('b'), sched('c')]);
    expect(out.map((a) => a.id)).toEqual(['a']);
  });

  it('treats different title, work item id or work item type as different series', () => {
    const out = collapseRecurringSeries([
      sched('a'),
      sched('b', { title: 'Other' }),
      sched('c', { workItemId: 'w2' }),
      sched('d', { workItemType: 'project_task' }),
      sched('e'),
    ]);
    expect(out.map((a) => a.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps non-recurring schedule items and non-schedule items, preserving order', () => {
    const items = [
      sched('a', { isRecurring: false }),
      { id: 't1', type: ActivityType.TICKET, title: 'Standup' } as any,
      sched('b'),
      sched('c', { isRecurring: false }),
      { id: 't2', type: ActivityType.TICKET, title: 'Standup' } as any,
      sched('d'),
    ];
    expect(collapseRecurringSeries(items).map((a) => a.id)).toEqual(['a', 't1', 'b', 'c', 't2']);
  });
});
