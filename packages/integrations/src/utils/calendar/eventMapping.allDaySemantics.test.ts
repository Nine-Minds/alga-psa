import { describe, expect, it } from 'vitest';
import type { IScheduleEntry } from '@alga-psa/types';
import * as workspaceMapping from './eventMapping';
import * as enterpriseMapping from '../../../../../ee/packages/calendar/src/lib/utils/calendar/eventMapping';

describe.each([['workspace', workspaceMapping], ['enterprise', enterpriseMapping]] as const)('%s explicit all-day synchronization semantics', (_name, { mapExternalEventToScheduleEntry, mapScheduleEntryToExternalEvent }) => {
  it('exports legacy midnight entries without provenance as timed', async () => {
    const external = await mapScheduleEntryToExternalEvent({
      entry_id: 'legacy-midnight', title: 'Maintenance', assigned_user_ids: [], work_item_type: 'ad_hoc',
      scheduled_start: new Date('2026-10-25T00:00:00Z'), scheduled_end: new Date('2026-10-26T00:00:00Z'),
    } as unknown as IScheduleEntry, 'microsoft', new Map());
    expect(external.start.dateTime).toBe('2026-10-25T00:00:00.000Z');
    expect(external.end.dateTime).toBe('2026-10-26T00:00:00.000Z');
    expect(external.start.date).toBeUndefined();
  });

  it.each(['google', 'microsoft'] as const)('%s retains a timed event that begins and ends exactly at UTC midnight', async provider => {
    const entry = await mapExternalEventToScheduleEntry({
      id: 'midnight-timed', provider, title: 'Timed maintenance',
      start: { dateTime: '2026-10-25T00:00:00Z' },
      end: { dateTime: '2026-10-26T00:00:00Z' },
    }, 'test-tenant', provider, new Map());
    expect(entry).toHaveProperty('is_all_day', false);
    const external = await mapScheduleEntryToExternalEvent(entry as IScheduleEntry, provider, new Map());
    expect(external.start.dateTime).toBe('2026-10-25T00:00:00.000Z');
    expect(external.end.dateTime).toBe('2026-10-26T00:00:00.000Z');
    expect(external.start.date).toBeUndefined();
  });

  it.each(['google', 'microsoft'] as const)('%s records all-day provenance rather than inferring it from stored timestamps', async provider => {
    const entry = await mapExternalEventToScheduleEntry({
      id: 'all-day', provider, title: 'All-day maintenance',
      start: { date: '2026-10-25' }, end: { date: '2026-10-26' },
    }, 'test-tenant', provider, new Map());
    expect(entry).toHaveProperty('is_all_day', true);
    expect(new Date(entry.scheduled_start!).toISOString()).toBe('2026-10-25T00:00:00.000Z');
    expect(new Date(entry.scheduled_end!).toISOString()).toBe('2026-10-26T00:00:00.000Z');
    const external = await mapScheduleEntryToExternalEvent(entry as IScheduleEntry, provider, new Map());
    expect(external.start.date).toBe('2026-10-25');
    expect(external.end.date).toBe('2026-10-26');
    expect(external.start.dateTime).toBeUndefined();
  });
});
