import { describe, expect, it } from 'vitest';
import * as workspaceMapping from './eventMapping';
import * as enterpriseMapping from '../../../../../ee/packages/calendar/src/lib/utils/calendar/eventMapping';
import { parseCalendarDateTime } from '@alga-psa/core';

// Graph dateTimeTimeZone values can omit an offset. The separate timeZone
// determines the instant, not the timezone of the worker importing the event.
// https://learn.microsoft.com/en-us/graph/api/event-get?view=graph-rest-1.0
// https://learn.microsoft.com/en-us/graph/api/resources/datetimetimezone?view=graph-rest-1.0
describe.each([['workspace', workspaceMapping], ['enterprise', enterpriseMapping]] as const)('%s timed calendar imports preserve the provider instant', (_name, { mapExternalEventToScheduleEntry }) => {
  it.each([
    ['Graph default UTC response', '2026-09-17T09:00:00.0000000', 'UTC', '2026-09-17T09:00:00.000Z'],
    ['IANA zone in summer', '2026-07-17T09:00:00', 'Europe/Berlin', '2026-07-17T07:00:00.000Z'],
    ['IANA zone in winter', '2026-01-17T09:00:00', 'Europe/Berlin', '2026-01-17T08:00:00.000Z'],
    ['Graph Windows zone in summer', '2026-07-17T09:00:00.0000000', 'Pacific Standard Time', '2026-07-17T16:00:00.000Z'],
    ['Graph Windows zone in winter', '2026-01-17T09:00:00.0000000', 'Pacific Standard Time', '2026-01-17T17:00:00.000Z'],
    ['explicit offset', '2026-07-17T09:00:00+02:00', 'Europe/Berlin', '2026-07-17T07:00:00.000Z'],
    ['explicit UTC instant', '2026-07-17T09:00:00Z', 'Europe/Berlin', '2026-07-17T09:00:00.000Z'],
  ])('%s', async (_name, dateTime, timeZone, expected) => {
    const entry = await mapExternalEventToScheduleEntry({
      id: 'graph-timed-event', provider: 'microsoft', title: 'Timed maintenance',
      start: { dateTime, timeZone },
      end: { dateTime: dateTime.replace('T09:', 'T10:'), timeZone },
    }, 'timezone-regression-tenant', 'microsoft', new Map());

    expect(new Date(entry.scheduled_start!).toISOString()).toBe(expected);
    expect(new Date(entry.scheduled_end!).toISOString()).toBe(
      new Date(new Date(expected).getTime() + 60 * 60 * 1000).toISOString(),
    );
  });
});

describe('provider datetime validation', () => {
  it('preserves Graph fractional seconds to stored Date precision', () => {
    expect(parseCalendarDateTime('2026-07-17T09:00:00.1234567', 'Pacific Standard Time').toISOString())
      .toBe('2026-07-17T16:00:00.123Z');
  });

  it.each([
    ['2026-07-17T09:00:00', undefined],
    ['2026-07-17T09:00:00', 'Unknown Time Zone'],
    ['2026-02-30T09:00:00', 'UTC'],
    ['2026-07-17T09:00:00+99:00', 'UTC'],
    ['2026-03-08T02:30:00', 'Pacific Standard Time'],
    ['2026-11-01T01:30:00', 'Pacific Standard Time'],
  ])('rejects invalid or ambiguous datetime %s in %s', (value, zone) => {
    expect(() => parseCalendarDateTime(value, zone)).toThrow();
  });

  it('uses an explicit offset to disambiguate a repeated wall time', () => {
    expect(parseCalendarDateTime('2026-11-01T01:30:00-08:00', 'Pacific Standard Time').toISOString())
      .toBe('2026-11-01T09:30:00.000Z');
  });
});
