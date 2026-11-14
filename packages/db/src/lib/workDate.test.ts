import { afterEach, describe, expect, it, vi } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { localDateForInstant, resolveTenantToday } from './workDate';

const SYDNEY_BOUNDARY = Temporal.Instant.from('2026-10-18T22:00:00Z');

describe('localDateForInstant', () => {
  it('returns the Sydney calendar date for 2026-10-18T22:00Z', () => {
    expect(localDateForInstant(SYDNEY_BOUNDARY, 'Australia/Sydney').toString()).toBe('2026-10-19');
  });

  it('returns the UTC calendar date for the same instant', () => {
    expect(localDateForInstant(SYDNEY_BOUNDARY, 'UTC').toString()).toBe('2026-10-18');
  });

  it('accepts a JS Date', () => {
    expect(localDateForInstant(new Date('2026-10-18T22:00:00Z'), 'Australia/Sydney').toString()).toBe('2026-10-19');
  });

  it.each([null, undefined, '', 'Not/AZone'])('falls back to UTC for zone %j without throwing', (zone) => {
    expect(localDateForInstant(SYDNEY_BOUNDARY, zone as any).toString()).toBe('2026-10-18');
  });

  it('handles the Sydney DST start day (2026-10-04 spring-forward): 15:30Z on the 3rd is already the 4th', () => {
    expect(localDateForInstant(Temporal.Instant.from('2026-10-03T15:30:00Z'), 'Australia/Sydney').toString()).toBe('2026-10-04');
    // Just before local midnight (+10:00 standard time) it is still the 3rd.
    expect(localDateForInstant(Temporal.Instant.from('2026-10-03T13:59:00Z'), 'Australia/Sydney').toString()).toBe('2026-10-03');
  });

  it('handles a US zone across its DST change (America/New_York, 2026-11-01 fall-back)', () => {
    // 04:30Z on 11-01 is 00:30 EDT (-04:00) on the 1st; 03:30Z on 11-02 is 22:30 EST on the 1st.
    expect(localDateForInstant(Temporal.Instant.from('2026-11-01T04:30:00Z'), 'America/New_York').toString()).toBe('2026-11-01');
    expect(localDateForInstant(Temporal.Instant.from('2026-11-02T03:30:00Z'), 'America/New_York').toString()).toBe('2026-11-01');
    // Behind UTC: 2026-10-18T22:00Z is still the 18th in Los Angeles (and before midnight UTC the 17th at 03:00Z).
    expect(localDateForInstant(Temporal.Instant.from('2026-10-18T03:00:00Z'), 'America/Los_Angeles').toString()).toBe('2026-10-17');
  });
});

describe('resolveTenantToday', () => {
  afterEach(() => vi.restoreAllMocks());

  // tenantDb(knex, tenant).table('tenant_settings').select('settings').first()
  function fakeKnex(settings: unknown) {
    const builder: any = {
      where: vi.fn(() => builder),
      select: vi.fn(() => builder),
      first: vi.fn(async () => (settings === undefined ? undefined : { settings })),
    };
    return vi.fn(() => builder) as any;
  }

  it('uses the tenant timezone at the stubbed instant', async () => {
    vi.spyOn(Temporal.Now, 'instant').mockReturnValue(SYDNEY_BOUNDARY);
    const today = await resolveTenantToday(fakeKnex({ timezone: 'Australia/Sydney' }), 'tenant-1');
    expect(today.toString()).toBe('2026-10-19');
  });

  it('falls back to the UTC date when no timezone is saved', async () => {
    vi.spyOn(Temporal.Now, 'instant').mockReturnValue(SYDNEY_BOUNDARY);
    expect((await resolveTenantToday(fakeKnex({}), 'tenant-1')).toString()).toBe('2026-10-18');
    expect((await resolveTenantToday(fakeKnex(undefined), 'tenant-1')).toString()).toBe('2026-10-18');
  });
});
