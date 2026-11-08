import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deriveClientContractStatus, toLocalDateInTimeZone } from '../clientContractStatus';
import { getTenantLocalToday, loadTenantTimeZone } from '../tenantLocalDate';

/**
 * The derived 'scheduled' status compares the assignment start date against the tenant's
 * calendar date, read from tenant_settings.settings.timezone. Tenants without a timezone row
 * fall back to the UTC date, and most seeded tenants have none, so the fallback is the common
 * path rather than an edge case — it is pinned here, including the one-day skew it accepts.
 */

type SettingsRead = () => Promise<{ settings: unknown } | undefined>;

function createMockConnection(readSettings: SettingsRead) {
  const query: any = {
    where: () => query,
    select: () => query,
    first: () => readSettings(),
  };

  return ((table: string) => {
    if (table !== 'tenant_settings') {
      throw new Error(`Unexpected table ${table}`);
    }
    return query;
  }) as any;
}

const settings = (value: unknown): SettingsRead => async () => ({ settings: value });
const noRow: SettingsRead = async () => undefined;

// 2026-11-15 21:00 in New York is already 2026-11-16 in UTC: the instant where the two
// calendars disagree, which is what the fallback changes.
const EVENING_IN_NEW_YORK = new Date('2026-11-16T02:00:00.000Z');

describe('loadTenantTimeZone', () => {
  it('reads the IANA zone out of the tenant settings JSON', async () => {
    await expect(
      loadTenantTimeZone(createMockConnection(settings({ timezone: 'America/New_York' })), 'tenant-1')
    ).resolves.toBe('America/New_York');
  });

  it('parses settings stored as a JSON string', async () => {
    await expect(
      loadTenantTimeZone(
        createMockConnection(settings(JSON.stringify({ timezone: 'Europe/Berlin' }))),
        'tenant-1'
      )
    ).resolves.toBe('Europe/Berlin');
  });

  it('returns null when the tenant has no settings row, no timezone, or a blank one', async () => {
    await expect(loadTenantTimeZone(createMockConnection(noRow), 'tenant-1')).resolves.toBeNull();
    await expect(
      loadTenantTimeZone(createMockConnection(settings({ locale: 'en' })), 'tenant-1')
    ).resolves.toBeNull();
    await expect(
      loadTenantTimeZone(createMockConnection(settings({ timezone: '' })), 'tenant-1')
    ).resolves.toBeNull();
  });

  it('returns null instead of throwing when the settings row is unreadable', async () => {
    const failing = createMockConnection(async () => {
      throw new Error('relation "tenant_settings" does not exist');
    });
    await expect(loadTenantTimeZone(failing, 'tenant-1')).resolves.toBeNull();

    const malformedJson = createMockConnection(settings('{not json'));
    await expect(loadTenantTimeZone(malformedJson, 'tenant-1')).resolves.toBeNull();
  });
});

describe('toLocalDateInTimeZone', () => {
  it('uses the zone when it is valid and UTC when it is not', () => {
    expect(toLocalDateInTimeZone(EVENING_IN_NEW_YORK, 'America/New_York')).toBe('2026-11-15');
    expect(toLocalDateInTimeZone(EVENING_IN_NEW_YORK, 'Australia/Sydney')).toBe('2026-11-16');
    expect(toLocalDateInTimeZone(EVENING_IN_NEW_YORK, 'Mars/Olympus_Mons')).toBe('2026-11-16');
    expect(toLocalDateInTimeZone(EVENING_IN_NEW_YORK, null)).toBe('2026-11-16');
  });
});

describe('getTenantLocalToday', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: EVENING_IN_NEW_YORK });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the tenant's own calendar date when a timezone is configured", async () => {
    await expect(
      getTenantLocalToday(createMockConnection(settings({ timezone: 'America/New_York' })), 'tenant-1')
    ).resolves.toBe('2026-11-15');
  });

  it('falls back to the UTC date for a tenant with no timezone row', async () => {
    await expect(getTenantLocalToday(createMockConnection(noRow), 'tenant-1')).resolves.toBe('2026-11-16');
  });

  it('falls back to the UTC date for an unusable timezone value', async () => {
    await expect(
      getTenantLocalToday(createMockConnection(settings({ timezone: 'Not/AZone' })), 'tenant-1')
    ).resolves.toBe('2026-11-16');
  });

  it('is the only input the derived status needs, so the fallback shifts Scheduled by at most a day', async () => {
    const assignment = { isActive: true, startDate: '2026-11-16', endDate: null } as const;

    const configured = await getTenantLocalToday(
      createMockConnection(settings({ timezone: 'America/New_York' })),
      'tenant-1'
    );
    expect(deriveClientContractStatus({ ...assignment, now: configured })).toBe('scheduled');

    // No timezone: the tenant sees Active from the UTC rollover instead of local midnight.
    // Accepted fallback, documented on toLocalDateInTimeZone — never a different status.
    const fallback = await getTenantLocalToday(createMockConnection(noRow), 'tenant-1');
    expect(deriveClientContractStatus({ ...assignment, now: fallback })).toBe('active');
  });
});
