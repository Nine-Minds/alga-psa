import { describe, expect, it } from 'vitest';
import {
  buildScheduleEntryLink,
  parseScheduleEntryDeepLink,
} from './scheduleEntryLinks';

const ID = '3f2b8c1e-6a4d-4e7b-9c1a-2d5e8f0a7b64';

describe('scheduleEntryLinks', () => {
  it('builds the entry deep link', () => {
    expect(buildScheduleEntryLink(ID)).toBe(`/msp/schedule?entryId=${ID}`);
  });

  it('appends an encoded ISO occurrence', () => {
    const link = buildScheduleEntryLink(ID, new Date('2031-03-10T09:00:00.000Z'));
    expect(link).toBe(`/msp/schedule?entryId=${ID}&occurrence=2031-03-10T09%3A00%3A00.000Z`);
  });

  it('rejects an empty id and an invalid occurrence', () => {
    expect(() => buildScheduleEntryLink(' ')).toThrow(TypeError);
    expect(() => buildScheduleEntryLink(ID, 'nope')).toThrow(TypeError);
  });

  it('round-trips through parseScheduleEntryDeepLink', () => {
    const occurrence = new Date('2031-03-10T09:00:00.000Z');
    const url = new URL(`http://x${buildScheduleEntryLink(ID, occurrence)}`);
    expect(parseScheduleEntryDeepLink(url.searchParams)).toEqual({ entryId: ID, occurrence });
  });

  it('ignores a malformed occurrence and returns null without an entryId', () => {
    expect(parseScheduleEntryDeepLink(new URLSearchParams(`entryId=${ID}&occurrence=garbage`))).toEqual({ entryId: ID });
    expect(parseScheduleEntryDeepLink(new URLSearchParams('requestId=1'))).toBeNull();
    expect(parseScheduleEntryDeepLink(null)).toBeNull();
  });
});
