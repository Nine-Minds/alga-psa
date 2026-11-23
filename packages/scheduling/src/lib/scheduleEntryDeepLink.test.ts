import { describe, expect, it } from 'vitest';
import type { IScheduleEntry } from '@alga-psa/types';
import { deepLinkFetchId, parseVirtualEntryId, resolveScheduleDeepLinkTarget } from './scheduleEntryDeepLink';

const MASTER = '3f2b8c1e-6a4d-4e7b-9c1a-2d5e8f0a7b64';
const base = {
  entry_id: MASTER,
  title: 'Weekly check-in',
  scheduled_start: new Date('2031-03-03T15:00:00.000Z'),
  scheduled_end: new Date('2031-03-03T16:30:00.000Z'),
  assigned_user_ids: ['u1'],
} as unknown as IScheduleEntry;

describe('resolveScheduleDeepLinkTarget', () => {
  it('opens a plain entry on its own date', () => {
    const target = resolveScheduleDeepLinkTarget(base, { entryId: MASTER });
    expect(target.entry).toBe(base);
    expect(target.date).toEqual(base.scheduled_start);
  });

  it('ignores an occurrence on a non-recurring entry', () => {
    const target = resolveScheduleDeepLinkTarget(base, { entryId: MASTER, occurrence: new Date('2031-04-01T15:00:00.000Z') });
    expect(target.entry).toBe(base);
    expect(target.date).toEqual(base.scheduled_start);
  });

  it('materializes the named occurrence of a recurring master, as the schedule view does', () => {
    const master = { ...base, is_recurring: true } as IScheduleEntry;
    const occurrence = new Date('2031-03-17T15:00:00.000Z');
    const { entry, date } = resolveScheduleDeepLinkTarget(master, { entryId: MASTER, occurrence });
    expect(entry.entry_id).toBe(`${MASTER}_${occurrence.getTime()}`);
    expect(entry.original_entry_id).toBe(MASTER);
    expect(entry.is_recurring).toBe(true);
    expect(new Date(entry.scheduled_start)).toEqual(occurrence);
    expect(new Date(entry.scheduled_end).getTime() - occurrence.getTime()).toBe(90 * 60_000);
    expect(date).toEqual(occurrence);
    expect(master.scheduled_start).toEqual(base.scheduled_start); // input not mutated
  });

  it('opens a recurring master on its own date when no occurrence is named', () => {
    const master = { ...base, is_recurring: true } as IScheduleEntry;
    const target = resolveScheduleDeepLinkTarget(master, { entryId: MASTER });
    expect(target.entry).toBe(master);
    expect(target.date).toEqual(master.scheduled_start);
  });

  it('accepts a virtual entry id as the link', () => {
    const master = { ...base, is_recurring: true } as IScheduleEntry;
    const epoch = new Date('2031-03-24T15:00:00.000Z').getTime();
    expect(deepLinkFetchId(`${MASTER}_${epoch}`)).toBe(MASTER);
    expect(parseVirtualEntryId(`${MASTER}_${epoch}`)).toEqual({ masterId: MASTER, occurrence: new Date(epoch) });
    const { entry } = resolveScheduleDeepLinkTarget(master, { entryId: `${MASTER}_${epoch}` });
    expect(entry.entry_id).toBe(`${MASTER}_${epoch}`);
  });

  it('does not re-materialize an entry that is already a stored occurrence', () => {
    const child = { ...base, is_recurring: true, original_entry_id: 'other' } as IScheduleEntry;
    const target = resolveScheduleDeepLinkTarget(child, { entryId: MASTER, occurrence: new Date('2031-03-17T15:00:00.000Z') });
    expect(target.entry).toBe(child);
  });

  it('leaves plain ids alone', () => {
    expect(deepLinkFetchId(MASTER)).toBe(MASTER);
    expect(parseVirtualEntryId(MASTER)).toBeNull();
    expect(parseVirtualEntryId('abc_notanumber')).toBeNull();
  });
});
