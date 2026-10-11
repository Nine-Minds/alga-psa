import { beforeEach, describe, expect, it } from 'vitest';
import {
  describeTimeZone,
  rankTimeZoneSearch,
  validateStorableTimeZone,
  type TimeZoneDescriptor,
} from './timeZones';

describe('validateStorableTimeZone', () => {
  it.each([
    'America/New_York',
    'America/Panama',
    'America/Port-au-Prince',
    'America/Argentina/Buenos_Aires',
    'Asia/Kolkata',
    'Australia/Sydney',
  ])('accepts %s unchanged', (zone) => {
    expect(validateStorableTimeZone(zone)).toEqual({ ok: true, timeZone: zone });
  });

  it.each(['UTC', 'Etc/UTC', 'GMT', 'Etc/GMT+0'])('maps %s to UTC', (zone) => {
    expect(validateStorableTimeZone(zone)).toEqual({ ok: true, timeZone: 'UTC' });
  });

  it.each(['EST', 'MST', 'HST', 'EST5EDT', 'Etc/GMT+5', 'US/Eastern', 'SystemV/EST5'])(
    'rejects %s as not_location',
    (zone) => {
      expect(validateStorableTimeZone(zone)).toEqual({ ok: false, reason: 'not_location', input: zone });
    },
  );

  it('returns unrecognized for unknown zones', () => {
    expect(validateStorableTimeZone('Not/AZone')).toEqual({ ok: false, reason: 'unrecognized', input: 'Not/AZone' });
  });

  it('trims input and maps empty / nullish values to null', () => {
    expect(validateStorableTimeZone('')).toEqual({ ok: true, timeZone: null });
    expect(validateStorableTimeZone('   ')).toEqual({ ok: true, timeZone: null });
    expect(validateStorableTimeZone(null)).toEqual({ ok: true, timeZone: null });
    expect(validateStorableTimeZone(undefined)).toEqual({ ok: true, timeZone: null });
    expect(validateStorableTimeZone('  America/Chicago ')).toEqual({ ok: true, timeZone: 'America/Chicago' });
  });
});

describe('describeTimeZone', () => {
  const referenceDate = new Date('2026-07-15T12:00:00Z');

  it.each(['America/New_York', 'America/Denver', 'America/Chicago', 'Australia/Sydney'])(
    '%s observes DST',
    (zone) => {
      expect(describeTimeZone(zone, { referenceDate }).observesDst).toBe(true);
    },
  );

  it.each(['America/Panama', 'America/Phoenix', 'America/Regina'])('%s does not observe DST', (zone) => {
    const d = describeTimeZone(zone, { referenceDate });
    expect(d.observesDst).toBe(false);
    expect(d.standardOffset).toBe(d.daylightOffset);
  });

  it('includes both US abbreviations for New York, regardless of the reference season', () => {
    for (const date of ['2026-07-15T12:00:00Z', '2026-01-15T12:00:00Z']) {
      const d = describeTimeZone('America/New_York', { referenceDate: new Date(date) });
      expect(d.abbreviations).toEqual(expect.arrayContaining(['EST', 'EDT']));
      expect(d.standardAbbreviation).toBe('EST');
      expect(d.displayAbbreviations).toEqual(['EST', 'EDT']);
      expect(d.primary).toBe(true);
    }
  });

  it('marks only the CLDR default zone as primary for a shared name', () => {
    expect(describeTimeZone('America/Chicago', { referenceDate }).primary).toBe(true);
    expect(describeTimeZone('America/Denver', { referenceDate }).primary).toBe(true);
    expect(describeTimeZone('America/Panama', { referenceDate }).primary).toBe(false);
    expect(describeTimeZone('America/Phoenix', { referenceDate }).primary).toBe(false);
  });

  it('describes UTC without an area collision', () => {
    const d = describeTimeZone('UTC', { referenceDate });
    expect(d.observesDst).toBe(false);
    expect(d.area).toBe('Etc');
  });

  it('survives an unusable locale', () => {
    const d = describeTimeZone('America/New_York', { referenceDate, locale: 'not a locale' });
    expect(d.observesDst).toBe(true);
    expect(d.displayName).not.toBe('');
  });
});

describe('rankTimeZoneSearch', () => {
  const ZONES = Intl.supportedValuesOf('timeZone').concat('UTC');

  const build = (referenceDate: Date): TimeZoneDescriptor[] =>
    ZONES.map((id) => describeTimeZone(id, { referenceDate }));

  const ids = (list: TimeZoneDescriptor[]) => list.map((d) => d.id);

  describe.each([
    ['2026-07-15T12:00:00Z'],
    ['2026-01-15T12:00:00Z'],
  ])('with reference date %s', (iso) => {
    let descriptors: TimeZoneDescriptor[];
    beforeEach(() => {
      descriptors = build(new Date(iso));
    });

    /**
     * Matches that share the query's standard abbreviation sit in one score
     * bucket, where every DST zone must precede every fixed-offset zone.
     * (Across buckets, match quality still comes first.)
     */
    const expectDstBeforeFixedInBucket = (best: TimeZoneDescriptor[], abbreviation: string) => {
      const bucket = best.filter((d) => d.standardAbbreviation === abbreviation);
      const lastDst = bucket.map((d) => d.observesDst).lastIndexOf(true);
      const firstFixed = bucket.findIndex((d) => !d.observesDst);
      expect(lastDst).toBeGreaterThanOrEqual(0);
      expect(firstFixed).toBeGreaterThan(lastDst);
    };

    const indexOfId = (best: TimeZoneDescriptor[], id: string) => best.findIndex((d) => d.id === id);

    const lastDstIndex = (best: TimeZoneDescriptor[], abbreviation: string) =>
      Math.max(...best.map((d, i) => (d.standardAbbreviation === abbreviation && d.observesDst ? i : -1)));

    it.each(['EST', 'est', 'Eastern Standard Time'])('%s puts America/New_York first', (query) => {
      const { bestMatches } = rankTimeZoneSearch(descriptors, query);
      expect(bestMatches[0].id).toBe('America/New_York');
      expectDstBeforeFixedInBucket(bestMatches, 'EST');
      for (const fixed of ['America/Panama', 'America/Cancun', 'America/Jamaica']) {
        expect(indexOfId(bestMatches, fixed)).toBeGreaterThan(lastDstIndex(bestMatches, 'EST'));
      }
    });

    it('CST puts Chicago first and fixed-offset zones after every DST match', () => {
      const { bestMatches } = rankTimeZoneSearch(descriptors, 'CST');
      expect(bestMatches[0].id).toBe('America/Chicago');
      expectDstBeforeFixedInBucket(bestMatches, 'CST');
      expect(indexOfId(bestMatches, 'America/Regina')).toBeGreaterThan(lastDstIndex(bestMatches, 'CST'));
      expect(indexOfId(bestMatches, 'America/Mexico_City')).toBeGreaterThan(lastDstIndex(bestMatches, 'CST'));
    });

    it('MST puts Denver first and Phoenix after every DST match', () => {
      const { bestMatches } = rankTimeZoneSearch(descriptors, 'MST');
      expect(bestMatches[0].id).toBe('America/Denver');
      expectDstBeforeFixedInBucket(bestMatches, 'MST');
      expect(indexOfId(bestMatches, 'America/Phoenix')).toBeGreaterThan(lastDstIndex(bestMatches, 'MST'));
    });

    it('EDT puts New York first and excludes Panama', () => {
      const { bestMatches } = rankTimeZoneSearch(descriptors, 'EDT');
      expect(bestMatches[0].id).toBe('America/New_York');
      expect(ids(bestMatches)).not.toContain('America/Panama');
    });

    it('New York returns America/New_York', () => {
      const { bestMatches, otherMatches } = rankTimeZoneSearch(descriptors, 'New York');
      expect(ids([...bestMatches, ...otherMatches])).toContain('America/New_York');
    });

    it('treats underscores in the query as spaces', () => {
      const { bestMatches, otherMatches } = rankTimeZoneSearch(descriptors, 'new_york');
      expect(ids([...bestMatches, ...otherMatches])).toContain('America/New_York');
    });

    it('does not use prefix or substring name matching below three characters', () => {
      // "ea" would substring-match "Eastern ..." names; two characters must not.
      expect(rankTimeZoneSearch(descriptors, 'ea').bestMatches).toEqual([]);
    });

    it('a one-letter query produces no best matches', () => {
      expect(rankTimeZoneSearch(descriptors, 'e').bestMatches).toEqual([]);
    });
  });

  it('gives the same top results on both dates', () => {
    const summer = build(new Date('2026-07-15T12:00:00Z'));
    const winter = build(new Date('2026-01-15T12:00:00Z'));
    for (const query of ['EST', 'CST', 'MST', 'EDT', 'Eastern Standard Time']) {
      expect(ids(rankTimeZoneSearch(summer, query).bestMatches)).toEqual(
        ids(rankTimeZoneSearch(winter, query).bestMatches),
      );
    }
  });

  it('returns everything as otherMatches for an empty query', () => {
    const descriptors = build(new Date('2026-07-15T12:00:00Z'));
    const result = rankTimeZoneSearch(descriptors, '  ');
    expect(result.bestMatches).toEqual([]);
    expect(result.otherMatches).toHaveLength(descriptors.length);
  });
});
