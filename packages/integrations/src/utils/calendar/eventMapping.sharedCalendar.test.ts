import { describe, expect, it } from 'vitest';
import type { ExternalCalendarEvent, IScheduleEntry } from '@alga-psa/types';
import * as workspace from './eventMapping';
import * as enterprise from '../../../../../ee/packages/calendar/src/lib/utils/calendar/eventMapping';
import * as legacyServer from '../../../../../server/src/utils/calendar/eventMapping';

const entry = (notes: string): IScheduleEntry => ({
  entry_id: 'entry-1', title: 'Unchanged title', notes, assigned_user_ids: [], work_item_type: 'ad_hoc',
  scheduled_start: new Date('2026-09-28T10:00:00Z'), scheduled_end: new Date('2026-09-28T11:00:00Z'),
} as unknown as IScheduleEntry);

describe.each([['workspace', workspace], ['enterprise', enterprise], ['server', legacyServer]] as const)(
  '%s shared calendar metadata mapping', (_name, mapping) => {
    it.each(['google', 'microsoft'] as const)('%s adds group metadata without changing title and round-trips notes', async provider => {
      const source = entry('Keep this note');
      const outbound = await mapping.mapScheduleEntryToExternalEvent(source, provider, new Map(), 'On-call');
      expect(outbound.title).toBe('Unchanged title');
      expect(outbound.description).toContain('[Alga calendar: On-call]');
      if (provider === 'microsoft') expect(outbound.categories).toEqual(['Alga calendar: On-call']);
      else expect(outbound.categories).toBeUndefined();
      let roundTrip: Partial<IScheduleEntry> = {};
      let current = outbound;
      for (let i = 0; i < 3; i++) {
        roundTrip = await mapping.mapExternalEventToScheduleEntry(current, 'unused-tenant', provider, new Map());
        expect(roundTrip.notes).toBe('Keep this note');
        current = await mapping.mapScheduleEntryToExternalEvent({ ...source, ...roundTrip } as IScheduleEntry, provider, new Map(), 'On-call');
      }
      expect(current.description).toBe(outbound.description);
    });

    it.each(['google', 'microsoft'] as const)('%s leaves personal and calendar-less notes alone', async provider => {
      const outbound = await mapping.mapScheduleEntryToExternalEvent(entry('Personal note'), provider, new Map());
      expect(outbound.title).toBe('Unchanged title');
      expect(outbound.description).toBe('Personal note');
      expect(outbound.categories).toBeUndefined();
    });

    it('strips only complete injected marker lines while retaining embedded marker-like text and HTML', async () => {
      const event: ExternalCalendarEvent = {
        id: 'event', provider: 'microsoft', title: 'Title',
        description: '<p>Keep [Alga calendar: user text] inside HTML.</p>\n<p>[Alga calendar: On-call]</p>',
        start: { dateTime: '2026-09-28T10:00:00Z' }, end: { dateTime: '2026-09-28T11:00:00Z' },
      };
      const inbound = await mapping.mapExternalEventToScheduleEntry(event, 'unused-tenant', 'microsoft', new Map());
      expect(inbound.notes).toBe('<p>Keep [Alga calendar: user text] inside HTML.</p>');
    });

    it('keeps marker insertion idempotent and preserves HTML body boundaries and adjacent whitespace', async () => {
      const source = entry('<html><body><p>Keep this.</p>  </body></html>');
      const once = await mapping.mapScheduleEntryToExternalEvent(source, 'microsoft', new Map(), 'R&D <Ops>');
      const twice = await mapping.mapScheduleEntryToExternalEvent({ ...source, notes: once.description } as IScheduleEntry, 'microsoft', new Map(), 'R&D <Ops>');
      expect(once.description).toBe('<html><body><p>Keep this.</p>  \n<p>[Alga calendar: R&amp;D &lt;Ops&gt;]</p></body></html>');
      expect(twice.description).toBe(once.description);
      const inbound = await mapping.mapExternalEventToScheduleEntry({
        ...once,
        categories: ['Alga calendar: R&D <Ops>'],
      }, 'unused-tenant', 'microsoft', new Map());
      expect(inbound.notes).toBe('<html><body><p>Keep this.</p>  </body></html>');
    });
  }
);
