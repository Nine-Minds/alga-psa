import { describe, it, expect } from 'vitest';
import {
  defaultWorkItemSlot,
  nextQuarterHour,
  slotFromCalendarSelection,
  WORK_ITEM_ENTRY_DEFAULT_DURATION_MS,
} from '../src/lib/workItemScheduling';

describe('workItemScheduling defaults', () => {
  it('rounds up to the next quarter hour', () => {
    expect(nextQuarterHour(new Date('2026-01-05T10:07:30')).toISOString()).toBe(new Date('2026-01-05T10:15:00').toISOString());
    expect(nextQuarterHour(new Date('2026-01-05T10:15:00')).toISOString()).toBe(new Date('2026-01-05T10:30:00').toISOString());
  });

  it('defaults a work item booking to one hour', () => {
    const { start, end } = defaultWorkItemSlot(new Date('2026-01-05T10:00:00'));
    expect(end.getTime() - start.getTime()).toBe(WORK_ITEM_ENTRY_DEFAULT_DURATION_MS);
  });

  it('pins month-view selections to 8am with the given duration', () => {
    const { start, end } = slotFromCalendarSelection(
      { start: new Date('2026-01-05T00:00:00'), end: new Date('2026-01-06T00:00:00'), action: 'click' },
      'month',
      { durationMs: 15 * 60 * 1000 }
    );
    expect(start.getHours()).toBe(8);
    expect(end.getTime() - start.getTime()).toBe(15 * 60 * 1000);
  });

  it('keeps a dragged range as drawn but stretches a single click to the duration', () => {
    const drag = slotFromCalendarSelection(
      { start: new Date('2026-01-05T10:00:00'), end: new Date('2026-01-05T10:30:00'), action: 'select' },
      'week',
      { durationMs: 60 * 60 * 1000 }
    );
    expect(drag.end.getTime() - drag.start.getTime()).toBe(30 * 60 * 1000);

    const click = slotFromCalendarSelection(
      { start: new Date('2026-01-05T10:00:00'), end: new Date('2026-01-05T10:15:00'), action: 'click' },
      'week',
      { durationMs: 60 * 60 * 1000 }
    );
    expect(click.end.getTime() - click.start.getTime()).toBe(60 * 60 * 1000);
  });
});
