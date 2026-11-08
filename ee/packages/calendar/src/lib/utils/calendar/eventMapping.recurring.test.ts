import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarProviderConfig } from '@alga-psa/types';

// The mappers only touch the database to resolve attendee emails; these
// fixtures carry none, so a stub keeps the suite free of server-only deps.
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: () => ({}), tenant: 'tenant-1' }),
  tenantDb: () => ({ table: () => ({ whereIn: () => ({ select: async () => [] }), whereRaw: () => ({ select: async () => [] }) }) }),
}));

import { mapExternalEventToScheduleEntry } from './eventMapping';
import { GoogleCalendarAdapter } from '../../services/calendar/providers/GoogleCalendarAdapter';
import {
  MicrosoftCalendarAdapter,
  graphRecurrenceToRRULE,
} from '../../services/calendar/providers/MicrosoftCalendarAdapter';

const MASTER_ID = '2ppb6f3ftc40nggeoqtsoh743g';

function providerConfig(type: 'google' | 'microsoft'): CalendarProviderConfig {
  return {
    id: 'provider-1',
    tenant: 'tenant-1',
    user_id: 'user-1',
    name: type,
    provider_type: type,
    calendar_id: 'primary',
    active: true,
    sync_direction: 'bidirectional',
    connection_status: 'connected',
    provider_config: { accessToken: 'access', refreshToken: 'refresh', clientId: 'id', clientSecret: 'secret' },
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  } as CalendarProviderConfig;
}

describe('Google event mapping for recurring series', () => {
  let mapGoogleEvent: (payload: any) => any;

  beforeEach(() => {
    const adapter = new GoogleCalendarAdapter(providerConfig('google')) as any;
    mapGoogleEvent = (payload: any) => adapter.mapGoogleEventToExternal(payload);
  });

  it('marks a series master and keeps its recurrence lines', () => {
    const mapped = mapGoogleEvent({
      id: MASTER_ID,
      summary: 'Go over advisories in Git @alga',
      start: { dateTime: '2026-10-01T10:15:00-04:00', timeZone: 'America/New_York' },
      end: { dateTime: '2026-10-01T10:45:00-04:00', timeZone: 'America/New_York' },
      recurrence: ['RRULE:FREQ=MONTHLY;BYDAY=1TH'],
      status: 'confirmed',
    });

    expect(mapped.instanceType).toBe('master');
    expect(mapped.recurringEventId).toBeUndefined();
    expect(mapped.recurrence).toEqual(['RRULE:FREQ=MONTHLY;BYDAY=1TH']);
  });

  it('marks an expanded instance as an occurrence of its master', () => {
    const mapped = mapGoogleEvent({
      id: `${MASTER_ID}_20261105T151500Z`,
      summary: 'Go over advisories in Git @alga',
      start: { dateTime: '2026-11-05T10:15:00-05:00', timeZone: 'America/New_York' },
      end: { dateTime: '2026-11-05T10:45:00-05:00', timeZone: 'America/New_York' },
      originalStartTime: { dateTime: '2026-11-05T10:15:00-05:00', timeZone: 'America/New_York' },
      recurringEventId: MASTER_ID,
      status: 'confirmed',
    });

    expect(mapped.instanceType).toBe('occurrence');
    expect(mapped.recurringEventId).toBe(MASTER_ID);
    expect(mapped.originalStartTime).toEqual({
      dateTime: '2026-11-05T10:15:00-05:00',
      timeZone: 'America/New_York',
    });
    expect(mapped.recurrence).toBeUndefined();
  });

  it('marks a moved instance as an exception', () => {
    const mapped = mapGoogleEvent({
      id: `${MASTER_ID}_20261203T151500Z`,
      summary: 'Advisories (moved) @alga',
      start: { dateTime: '2026-12-04T10:15:00-05:00' },
      end: { dateTime: '2026-12-04T10:45:00-05:00' },
      originalStartTime: { dateTime: '2026-12-03T10:15:00-05:00' },
      recurringEventId: MASTER_ID,
      status: 'confirmed',
    });

    expect(mapped.instanceType).toBe('exception');
    expect(mapped.recurringEventId).toBe(MASTER_ID);
  });

  it('treats a split-series _R master as a master in its own right', () => {
    const mapped = mapGoogleEvent({
      id: `${MASTER_ID}_R20261105T151500Z`,
      summary: 'Advisories, rescheduled @alga',
      start: { dateTime: '2026-11-05T10:15:00-05:00' },
      end: { dateTime: '2026-11-05T10:45:00-05:00' },
      recurrence: ['RRULE:FREQ=MONTHLY;BYDAY=2TH'],
      status: 'confirmed',
    });

    expect(mapped.instanceType).toBe('master');
    expect(mapped.recurringEventId).toBeUndefined();
  });

  it('maps a standalone event as single', () => {
    const mapped = mapGoogleEvent({
      id: 'standalone-1',
      summary: 'One-off @alga',
      start: { dateTime: '2026-10-01T14:15:00Z' },
      end: { dateTime: '2026-10-01T14:45:00Z' },
      status: 'confirmed',
    });

    expect(mapped.instanceType).toBe('single');
  });

  it('converts a master into a recurring schedule entry carrying the series zone', async () => {
    const mapped = mapGoogleEvent({
      id: MASTER_ID,
      summary: 'Go over advisories in Git @alga',
      start: { dateTime: '2026-10-01T10:15:00-04:00', timeZone: 'America/New_York' },
      end: { dateTime: '2026-10-01T10:45:00-04:00', timeZone: 'America/New_York' },
      recurrence: ['RRULE:FREQ=MONTHLY;BYDAY=1TH'],
      status: 'confirmed',
    });

    const entry = await mapExternalEventToScheduleEntry(mapped, 'tenant-1', 'google');

    expect(entry.is_recurring).toBe(true);
    expect(entry.recurrence_pattern).toMatchObject({
      frequency: 'monthly',
      interval: 1,
      daysOfWeek: [3],
      weekOfMonth: 1,
      timeZone: 'America/New_York',
    });
    expect(entry.scheduled_start?.toISOString()).toBe('2026-10-01T14:15:00.000Z');
  });

  it('converts an all-day series master, keeping date-only semantics', async () => {
    const mapped = mapGoogleEvent({
      id: 'allday-master',
      summary: 'Inventory day @alga',
      start: { date: '2026-10-01' },
      end: { date: '2026-10-02' },
      recurrence: ['RRULE:FREQ=MONTHLY;BYDAY=1TH'],
      status: 'confirmed',
    });

    const entry = await mapExternalEventToScheduleEntry(mapped, 'tenant-1', 'google');

    expect(entry.is_all_day).toBe(true);
    expect(entry.is_recurring).toBe(true);
    expect(entry.recurrence_pattern).toMatchObject({ weekOfMonth: 1, daysOfWeek: [3] });
  });

  it('imports an unsupported rule without a pattern rather than a mangled one', async () => {
    const mapped = mapGoogleEvent({
      id: 'rdate-master',
      summary: 'Irregular @alga',
      start: { dateTime: '2026-10-01T14:15:00Z' },
      end: { dateTime: '2026-10-01T14:45:00Z' },
      recurrence: ['RRULE:FREQ=MONTHLY;BYDAY=1TH', 'RDATE:20270210T151500Z'],
      status: 'confirmed',
    });

    const entry = await mapExternalEventToScheduleEntry(mapped, 'tenant-1', 'google');

    expect(entry.is_recurring).toBe(false);
    expect(entry.recurrence_pattern).toBeNull();
  });
});

describe('graphRecurrenceToRRULE', () => {
  it('converts a native relative-monthly Outlook series', () => {
    expect(
      graphRecurrenceToRRULE({
        pattern: { type: 'relativeMonthly', interval: 1, daysOfWeek: ['thursday'], index: 'first' },
        range: { type: 'noEnd', startDate: '2026-10-01' },
      })
    ).toBe('RRULE:FREQ=MONTHLY;BYDAY=1TH');
  });

  it('converts weekly, absolute-monthly and yearly patterns with their ranges', () => {
    expect(
      graphRecurrenceToRRULE({
        pattern: { type: 'weekly', interval: 2, daysOfWeek: ['monday', 'wednesday'] },
        range: { type: 'endDate', startDate: '2026-10-01', endDate: '2027-01-01' },
      })
    ).toBe('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20270101');

    expect(
      graphRecurrenceToRRULE({
        pattern: { type: 'absoluteMonthly', interval: 1, dayOfMonth: 15 },
        range: { type: 'numbered', numberOfOccurrences: 5 },
      })
    ).toBe('RRULE:FREQ=MONTHLY;BYMONTHDAY=15;COUNT=5');

    expect(
      graphRecurrenceToRRULE({
        pattern: { type: 'absoluteYearly', interval: 1, month: 3, dayOfMonth: 1 },
        range: { type: 'noEnd' },
      })
    ).toBe('RRULE:FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=1');

    expect(
      graphRecurrenceToRRULE({
        pattern: { type: 'relativeMonthly', interval: 1, daysOfWeek: ['friday'], index: 'last' },
        range: { type: 'noEnd' },
      })
    ).toBe('RRULE:FREQ=MONTHLY;BYDAY=-1FR');
  });

  it('returns null for a shape it cannot express', () => {
    expect(graphRecurrenceToRRULE({ pattern: { type: 'martian' }, range: {} })).toBeNull();
    expect(graphRecurrenceToRRULE(undefined)).toBeNull();
  });
});

describe('Microsoft event mapping for recurring series', () => {
  let mapGraphEvent: (payload: any) => any;

  beforeEach(() => {
    const adapter = new MicrosoftCalendarAdapter(providerConfig('microsoft')) as any;
    mapGraphEvent = (payload: any) => adapter.mapMicrosoftEventToExternal(payload);
  });

  it('recognises a native Outlook series master through its own recurrence object', async () => {
    const mapped = mapGraphEvent({
      id: 'graph-master',
      subject: 'Standup @alga',
      body: { content: '' },
      type: 'seriesMaster',
      start: { dateTime: '2026-10-01T10:15:00.0000000', timeZone: 'America/New_York' },
      end: { dateTime: '2026-10-01T10:45:00.0000000', timeZone: 'America/New_York' },
      recurrence: {
        pattern: { type: 'relativeMonthly', interval: 1, daysOfWeek: ['thursday'], index: 'first' },
        range: { type: 'noEnd', startDate: '2026-10-01' },
      },
    });

    expect(mapped.instanceType).toBe('master');
    expect(mapped.recurrence).toEqual(['RRULE:FREQ=MONTHLY;BYDAY=1TH']);

    const entry = await mapExternalEventToScheduleEntry(mapped, 'tenant-1', 'microsoft');
    expect(entry.is_recurring).toBe(true);
    expect(entry.recurrence_pattern).toMatchObject({ weekOfMonth: 1, daysOfWeek: [3], timeZone: 'America/New_York' });
  });

  it('anchors a series in its recurrenceTimeZone, not the UTC start Graph reports', async () => {
    // Without a Prefer: outlook.timezone header Graph answers start/end in UTC,
    // so the series zone has to come off the recurrence range — and it arrives
    // as a Windows name, which must be resolved to IANA before rrule sees it.
    const mapped = mapGraphEvent({
      id: 'graph-zoned-master',
      subject: 'Standup @alga',
      body: { content: '' },
      type: 'seriesMaster',
      start: { dateTime: '2026-10-01T14:15:00.0000000', timeZone: 'UTC' },
      end: { dateTime: '2026-10-01T14:45:00.0000000', timeZone: 'UTC' },
      recurrence: {
        pattern: { type: 'relativeMonthly', interval: 1, daysOfWeek: ['thursday'], index: 'first' },
        range: { type: 'noEnd', startDate: '2026-10-01', recurrenceTimeZone: 'Eastern Standard Time' },
      },
    });

    expect(mapped.recurrenceTimeZone).toBe('America/New_York');

    const entry = await mapExternalEventToScheduleEntry(mapped, 'tenant-1', 'microsoft');
    expect(entry.recurrence_pattern).toMatchObject({ timeZone: 'America/New_York' });
  });

  it('maps seriesMasterId and type on an expanded occurrence', () => {
    const mapped = mapGraphEvent({
      id: 'graph-occurrence',
      subject: 'Standup @alga',
      body: { content: '' },
      type: 'occurrence',
      seriesMasterId: 'graph-master',
      originalStart: '2026-11-05T15:15:00Z',
      start: { dateTime: '2026-11-05T10:15:00.0000000', timeZone: 'America/New_York' },
      end: { dateTime: '2026-11-05T10:45:00.0000000', timeZone: 'America/New_York' },
    });

    expect(mapped.instanceType).toBe('occurrence');
    expect(mapped.recurringEventId).toBe('graph-master');
    expect(mapped.originalStartTime).toEqual({ dateTime: '2026-11-05T15:15:00Z' });
    expect(mapped.recurrence).toBeUndefined();
  });

  it('maps an exception occurrence', () => {
    const mapped = mapGraphEvent({
      id: 'graph-exception',
      subject: 'Standup (moved) @alga',
      body: { content: '' },
      type: 'exception',
      seriesMasterId: 'graph-master',
      originalStart: '2026-12-03T15:15:00Z',
      start: { dateTime: '2026-12-04T10:15:00.0000000', timeZone: 'America/New_York' },
      end: { dateTime: '2026-12-04T10:45:00.0000000', timeZone: 'America/New_York' },
    });

    expect(mapped.instanceType).toBe('exception');
    expect(mapped.recurringEventId).toBe('graph-master');
  });

  it('still honours the AlgaRRULE property on events Alga exported', () => {
    const mapped = mapGraphEvent({
      id: 'graph-alga-master',
      subject: 'Alga export @alga',
      body: { content: '' },
      start: { dateTime: '2026-10-01T10:15:00.0000000', timeZone: 'UTC' },
      end: { dateTime: '2026-10-01T10:45:00.0000000', timeZone: 'UTC' },
      singleValueExtendedProperties: [
        { id: 'String {66f5a359-4659-4830-9070-00047ec6ac6e} Name AlgaRRULE', value: 'FREQ=WEEKLY;BYDAY=MO' },
      ],
    });

    expect(mapped.recurrence).toEqual(['FREQ=WEEKLY;BYDAY=MO']);
    expect(mapped.instanceType).toBe('master');
  });

  it('prefers AlgaRRULE over the placeholder recurrence createEvent posts', async () => {
    // The real shape of an Alga-exported series in Outlook: createEvent writes a
    // stand-in native recurrence (daily/noEnd) next to the true rule, and
    // updateEvent only refreshes the property. Reading the native object here
    // would turn a weekly entry into a daily one and push that back as AlgaRRULE.
    const placeholder = {
      pattern: { type: 'daily', interval: 1 },
      range: { type: 'noEnd', startDate: '2026-10-05T10:15:00' },
    };
    expect(graphRecurrenceToRRULE(placeholder)).toBe('RRULE:FREQ=DAILY');

    const mapped = mapGraphEvent({
      id: 'graph-alga-weekly-master',
      subject: 'Standup @alga',
      body: { content: '' },
      type: 'seriesMaster',
      start: { dateTime: '2026-10-05T10:15:00.0000000', timeZone: 'UTC' },
      end: { dateTime: '2026-10-05T10:45:00.0000000', timeZone: 'UTC' },
      recurrence: placeholder,
      singleValueExtendedProperties: [
        { id: 'String {66f5a359-4659-4830-9070-00047ec6ac6e} Name AlgaRRULE', value: 'RRULE:FREQ=WEEKLY;BYDAY=MO' },
      ],
    });

    expect(mapped.recurrence).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=MO']);

    const entry = await mapExternalEventToScheduleEntry(mapped, 'tenant-1', 'microsoft');
    expect(entry.is_recurring).toBe(true);
    expect(entry.recurrence_pattern).toMatchObject({ frequency: 'weekly', daysOfWeek: [0] });
  });
});
