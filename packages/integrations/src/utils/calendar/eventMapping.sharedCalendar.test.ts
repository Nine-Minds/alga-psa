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
    it.each(['google', 'microsoft'] as const)('%s preserves HTML, literal entities and blank lines through repeated round trips', async provider => {
      for (const notes of ['', '  ', '\n\n', '<p>Keep</p>', '<html><body><p>Keep</p></body></html>', 'Keep\n\n', 'Literal &lt;tag&gt; and &quot;quoted&quot;', '[Alga calendar: R&D &lt;Ops&gt;]']) {
        for (const name of ['Ops', 'R&D &lt;Ops&gt;', 'R&D <Ops>', 'Ops [West]', 'Ops $&', "Ops $' $` $$"]) {
          const source = entry(notes);
          let current = source;
          for (let round = 0; round < 3; round++) {
            const external = await mapping.mapScheduleEntryToExternalEvent(current, provider, new Map(), name);
            const inbound = await mapping.mapExternalEventToScheduleEntry(external, 'unused-tenant', provider, new Map());
            expect(inbound.notes, `${provider}: ${name}: ${notes}`).toBe(notes);
            current = { ...source, ...inbound } as IScheduleEntry;
          }
        }
      }
    });

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
      expect(outbound).not.toHaveProperty('categories');
    });

    it('strips only complete injected marker lines while retaining embedded marker-like text and HTML', async () => {
      const event: ExternalCalendarEvent = {
        id: 'event', provider: 'microsoft', title: 'Title',
        description: '<p>Keep [Alga calendar: user text] inside HTML.</p>\n<p>[Alga calendar: On-call]</p>',
        extendedProperties: { private: { 'alga-calendar-marker-name': 'On-call', 'alga-calendar-marker-note-count': '0' } },
        start: { dateTime: '2026-09-28T10:00:00Z' }, end: { dateTime: '2026-09-28T11:00:00Z' },
      };
      const inbound = await mapping.mapExternalEventToScheduleEntry(event, 'unused-tenant', 'microsoft', new Map());
      expect(inbound.notes).toBe('<p>Keep [Alga calendar: user text] inside HTML.</p>');
    });

    it.each(['google', 'microsoft'] as const)('%s strips empty-note metadata to the empty notes representation', async provider => {
      const outbound = await mapping.mapScheduleEntryToExternalEvent(entry(''), provider, new Map(), 'Ops [West]');
      expect(outbound.description).toContain('[Alga calendar: Ops [West]]');
      const normalized = provider === 'microsoft'
        ? { ...outbound, description: `<html><body><p>[Alga calendar: Ops [West]]</p></body></html>` }
        : outbound;
      const inbound = await mapping.mapExternalEventToScheduleEntry(normalized, 'unused-tenant', provider, new Map());
      expect(inbound.notes).toBe('');
    });

    it.each(['google', 'microsoft'] as const)('%s preserves user marker-like notes while removing only the injected final marker', async provider => {
      const personalMarker = '[Alga calendar: Ops [West]]';
      const source = entry(personalMarker);
      const outbound = await mapping.mapScheduleEntryToExternalEvent(source, provider, new Map(), 'Ops [West]');
      const inbound = await mapping.mapExternalEventToScheduleEntry(outbound, 'unused-tenant', provider, new Map());
      expect(inbound.notes).toBe(personalMarker);
    });

    it.each(['google', 'microsoft'] as const)('%s strips only the marker actually injected before a rename, preserving a matching user note', async provider => {
      const source = entry('Keep\n[Alga calendar: New]');
      const oldOutbound = await mapping.mapScheduleEntryToExternalEvent(source, provider, new Map(), 'Old');
      const inboundBeforeNextPush = await mapping.mapExternalEventToScheduleEntry(oldOutbound, 'unused-tenant', provider, new Map());
      expect(inboundBeforeNextPush.notes).toBe(source.notes);
      const renamed = await mapping.mapScheduleEntryToExternalEvent({ ...source, ...inboundBeforeNextPush } as IScheduleEntry, provider, new Map(), 'New');
      expect(renamed.description).toContain('[Alga calendar: New]');
      expect(renamed.description).not.toContain('[Alga calendar: Old]');
    });

    it.each(['google', 'microsoft'] as const)('%s preserves note-ending whitespace across repeated rounds', async provider => {
      const source = entry('Keep\n');
      const outbound = await mapping.mapScheduleEntryToExternalEvent(source, provider, new Map(), 'On-call');
      const inbound = await mapping.mapExternalEventToScheduleEntry(outbound, 'unused-tenant', provider, new Map());
      expect(inbound.notes).toBe('Keep\n');
    });

    it.each(['google', 'microsoft'] as const)('%s preserves a user marker-like line on an existing group copy without provenance', async provider => {
      const note = 'Keep\n[Alga calendar: user text]';
      const event: ExternalCalendarEvent = {
        id: 'existing', provider, title: 'Title', description: note,
        start: { dateTime: '2026-09-28T10:00:00Z' }, end: { dateTime: '2026-09-28T11:00:00Z' },
      };
      const inbound = await mapping.mapExternalEventToScheduleEntry(event, 'unused-tenant', provider, new Map());
      expect(inbound.notes).toBe(note);
    });

    it.each(['google', 'microsoft'] as const)('%s preserves user-authored marker text when the injected marker was removed externally', async provider => {
      const source = entry('Keep\n[Alga calendar: Old]');
      const outbound = await mapping.mapScheduleEntryToExternalEvent(source, provider, new Map(), 'Old');
      const externalWithoutInjectedLine = { ...outbound, description: source.notes };
      const inbound = await mapping.mapExternalEventToScheduleEntry(externalWithoutInjectedLine, 'unused-tenant', provider, new Map());
      expect(inbound.notes).toBe(source.notes);
    });

    it.each(['google', 'microsoft'] as const)('%s removes a moved injected marker while preserving user text below it', async provider => {
      const generated = await mapping.mapScheduleEntryToExternalEvent(entry('Keep'), provider, new Map(), 'Old [Team]');
      const event: ExternalCalendarEvent = {
        ...generated,
        id: 'event', provider, title: 'Title',
        description: provider === 'microsoft'
          ? '<html><body><p>Keep</p><p>[Alga calendar: Old [Team]]</p><p>Added by user</p></body></html>'
          : 'Keep\n[Alga calendar: Old [Team]]\nAdded by user',
        start: { dateTime: '2026-09-28T10:00:00Z' }, end: { dateTime: '2026-09-28T11:00:00Z' },
      };
      const inbound = await mapping.mapExternalEventToScheduleEntry(event, 'unused-tenant', provider, new Map());
      expect(inbound.notes).toBe('Keep\nAdded by user');
    });

    it('preserves a personal Outlook note matching its category marker', async () => {
      const personalText = 'Personal\n[Alga calendar: Personal]';
      const event: ExternalCalendarEvent = {
        id: 'personal', provider: 'microsoft', title: 'Personal', description: personalText,
        categories: ['Alga calendar: Personal'],
        start: { dateTime: '2026-09-28T10:00:00Z' }, end: { dateTime: '2026-09-28T11:00:00Z' },
      };
      const inbound = await mapping.mapExternalEventToScheduleEntry(event, 'unused-tenant', 'microsoft', new Map());
      expect(inbound.notes).toBe(personalText);
    });

    it('reflects a renamed calendar on the next outbound mapping', async () => {
      const source = entry('Keep this note');
      const oldName = await mapping.mapScheduleEntryToExternalEvent(source, 'google', new Map(), 'Old [Team]');
      const renamed = await mapping.mapScheduleEntryToExternalEvent(source, 'google', new Map(), 'New [Team]');
      expect(oldName.description).toContain('[Alga calendar: Old [Team]]');
      expect(renamed.description).toContain('[Alga calendar: New [Team]]');
      expect(renamed.description).not.toContain('Old [Team]');
    });

    it('keeps marker insertion idempotent and preserves HTML body boundaries and adjacent whitespace', async () => {
      const source = entry('<html><body><p>Keep this.</p>  </body></html>');
      const once = await mapping.mapScheduleEntryToExternalEvent(source, 'microsoft', new Map(), 'R&D <Ops>');
      expect(once.description).toBe('<html><body><p>Keep this.</p>  \n<p>[Alga calendar: R&amp;D &lt;Ops&gt;]</p></body></html>');
      const restored = await mapping.mapExternalEventToScheduleEntry({
        ...once,
        categories: ['Alga calendar: R&D <Ops>'],
      }, 'unused-tenant', 'microsoft', new Map());
      const twice = await mapping.mapScheduleEntryToExternalEvent({ ...source, ...restored } as IScheduleEntry, 'microsoft', new Map(), 'R&D <Ops>');
      expect(twice.description).toBe(once.description);
      const inbound = restored;
      expect(inbound.notes).toBe('<html><body><p>Keep this.</p>  </body></html>');
    });
  }
);
