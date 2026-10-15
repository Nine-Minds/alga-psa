import { describe, it, expect } from 'vitest';
import { droppedEntryDates, resizedEntryDates, movedEntryUpdate } from '../src/lib/entryMoves';

const timed = { entry_id: 'e1', scheduled_start: new Date('2026-01-05T10:00:00'), scheduled_end: new Date('2026-01-05T11:00:00') };

describe('entryMoves', () => {
  it('uses the drop time for a same-day move that keeps the duration', () => {
    const r = droppedEntryDates(timed, { start: new Date('2026-01-05T13:00:00'), end: new Date('2026-01-05T14:00:00') });
    expect(r.scheduled_start).toEqual(new Date('2026-01-05T13:00:00'));
    expect(r.scheduled_end).toEqual(new Date('2026-01-05T14:00:00'));
  });

  it('keeps the original duration when the drop reports a different one', () => {
    const r = droppedEntryDates(timed, { start: new Date('2026-01-05T13:00:00'), end: new Date('2026-01-05T13:15:00') });
    expect(r.scheduled_end).toEqual(new Date('2026-01-05T14:00:00'));
  });

  it('keeps the time of day when moved to another day', () => {
    const r = droppedEntryDates(timed, { start: new Date('2026-01-07T00:00:00'), end: new Date('2026-01-07T01:00:00'), isAllDay: true });
    expect(r.scheduled_start).toEqual(new Date('2026-01-07T10:00:00'));
    expect(r.scheduled_end).toEqual(new Date('2026-01-07T11:00:00'));
  });

  it('keeps date-only entries at UTC midnight', () => {
    const allDay = { entry_id: 'e2', is_all_day: true, scheduled_start: new Date('2026-01-05T00:00:00Z'), scheduled_end: new Date('2026-01-06T00:00:00Z') };
    const r = droppedEntryDates(allDay, { start: new Date(2026, 0, 8), end: new Date(2026, 0, 9) });
    expect(r.scheduled_start.toISOString()).toBe('2026-01-08T00:00:00.000Z');
    expect(r.scheduled_end.toISOString()).toBe('2026-01-09T00:00:00.000Z');
  });

  it('resizes to the dragged edge', () => {
    const r = resizedEntryDates(timed, { start: new Date('2026-01-05T10:00:00'), end: new Date('2026-01-05T12:30:00') });
    expect(r.scheduled_end).toEqual(new Date('2026-01-05T12:30:00'));
    expect(r.is_all_day).toBe(false);
  });

  it('keeps the series id for a materialized occurrence', () => {
    const occurrence = { ...timed, entry_id: 'series_2026-01-05', original_entry_id: 'series', assigned_user_ids: ['u1'] } as any;
    const u = movedEntryUpdate(occurrence, { scheduled_start: new Date(), scheduled_end: new Date() });
    expect(u.original_entry_id).toBe('series');
    expect(u.assigned_user_ids).toEqual(['u1']);
  });
});
