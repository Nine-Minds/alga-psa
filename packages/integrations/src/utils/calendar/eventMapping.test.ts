import { describe, expect, it } from 'vitest';
import type { ExternalCalendarEvent, IScheduleEntry } from '@alga-psa/types';
import { mapExternalEventToScheduleEntry, mapScheduleEntryToExternalEvent } from './eventMapping';

describe('calendar date roundtrips', () => {
  it.each(['google', 'microsoft'] as const)('%s preserves date-only exclusive ends across repeated synchronization', async provider => {
    let external: ExternalCalendarEvent = {
      id: 'external-all-day', provider, title: 'All day',
      start: { date: '2026-10-25', timeZone: 'UTC' },
      end: { date: '2026-10-26', timeZone: 'UTC' },
    };
    for (let round = 0; round < 3; round++) {
      const entry = await mapExternalEventToScheduleEntry(external, 'test-tenant', provider, new Map());
      expect(new Date(entry.scheduled_start!).toISOString()).toBe('2026-10-25T00:00:00.000Z');
      expect(new Date(entry.scheduled_end!).toISOString()).toBe('2026-10-26T00:00:00.000Z');
      external = await mapScheduleEntryToExternalEvent(entry as IScheduleEntry, provider, new Map());
      expect(external.start).toEqual({ date: '2026-10-25', timeZone: 'UTC' });
      expect(external.end).toEqual({ date: '2026-10-26', timeZone: 'UTC' });
    }
  });

  it('does not classify a nearly-midnight timed event as all-day', async () => {
    const entry = await mapExternalEventToScheduleEntry({
      id: 'timed', provider: 'microsoft', title: 'Timed',
      start: { dateTime: '2026-10-25T00:00:30Z' },
      end: { dateTime: '2026-10-26T00:00:30Z' },
    }, 'test-tenant', 'microsoft', new Map());
    const external = await mapScheduleEntryToExternalEvent(entry as IScheduleEntry, 'microsoft', new Map());
    expect(external.start.dateTime).toBe('2026-10-25T00:00:30.000Z');
    expect(external.end.dateTime).toBe('2026-10-26T00:00:30.000Z');
    expect(external.start.date).toBeUndefined();
  });
});
