import { describe, it, expect } from 'vitest';
import { findMatchingWindow, isInstantInWindow } from '@alga-psa/shared/rmm/alerts';
import type { RmmMaintenanceWindowRow } from '@alga-psa/shared/rmm/alerts';

const TENANT = '00000000-0000-0000-0000-000000000001';
const INTEGRATION = '00000000-0000-0000-0000-000000000002';
const CLIENT = '00000000-0000-0000-0000-000000000003';
const ASSET = '00000000-0000-0000-0000-000000000004';

let windowCounter = 0;
function window(overrides: Partial<RmmMaintenanceWindowRow> = {}): RmmMaintenanceWindowRow {
  windowCounter += 1;
  return {
    tenant: TENANT,
    window_id: `00000000-0000-0000-0000-0000000001${String(10 + windowCounter)}`,
    name: `window-${windowCounter}`,
    is_active: true,
    integration_id: null,
    client_id: null,
    asset_id: null,
    starts_at: null,
    ends_at: null,
    recurrence: null,
    ...overrides,
  };
}

const target = (occurredAt: string, overrides: Partial<{ clientId: string | null; assetId: string | null }> = {}) => ({
  integrationId: INTEGRATION,
  clientId: 'clientId' in overrides ? overrides.clientId ?? null : CLIENT,
  assetId: 'assetId' in overrides ? overrides.assetId ?? null : ASSET,
  occurredAt,
});

describe('one-off windows', () => {
  const oneOff = window({ starts_at: '2026-06-12T02:00:00.000Z', ends_at: '2026-06-12T04:00:00.000Z' });

  it('matches inside the range and not outside it', () => {
    expect(findMatchingWindow([oneOff], target('2026-06-12T03:00:00.000Z'))).not.toBeNull();
    expect(findMatchingWindow([oneOff], target('2026-06-12T05:00:00.000Z'))).toBeNull();
    expect(findMatchingWindow([oneOff], target('2026-06-12T01:59:59.000Z'))).toBeNull();
  });

  it('end is exclusive', () => {
    expect(findMatchingWindow([oneOff], target('2026-06-12T04:00:00.000Z'))).toBeNull();
  });
});

describe('weekly recurrence', () => {
  it('matches inside the day/time range evaluated in the window timezone', () => {
    // Friday 2026-06-12 14:30 UTC = Friday 10:30 in New York (EDT, UTC-4).
    const w = window({
      recurrence: { type: 'weekly', days: [5], startTime: '10:00', endTime: '11:00', timezone: 'America/New_York' },
    });
    expect(isInstantInWindow(w, new Date('2026-06-12T14:30:00.000Z'))).toBe(true);
    expect(isInstantInWindow(w, new Date('2026-06-12T15:30:00.000Z'))).toBe(false); // 11:30 local
  });

  it('day-of-week is evaluated in the window timezone, not UTC', () => {
    // Saturday 2026-06-13 01:00 UTC is still Friday 21:00 in New York.
    const w = window({
      recurrence: { type: 'weekly', days: [5], startTime: '20:00', endTime: '22:00', timezone: 'America/New_York' },
    });
    expect(isInstantInWindow(w, new Date('2026-06-13T01:00:00.000Z'))).toBe(true);
  });

  it('a window crossing midnight matches both sides', () => {
    // Friday 22:00 → Saturday 02:00 New York time.
    const w = window({
      recurrence: { type: 'weekly', days: [5], startTime: '22:00', endTime: '02:00', timezone: 'America/New_York' },
    });
    // Friday 23:00 local = Saturday 03:00 UTC
    expect(isInstantInWindow(w, new Date('2026-06-13T03:00:00.000Z'))).toBe(true);
    // Saturday 01:00 local = Saturday 05:00 UTC (post-midnight side)
    expect(isInstantInWindow(w, new Date('2026-06-13T05:00:00.000Z'))).toBe(true);
    // Saturday 03:00 local = Saturday 07:00 UTC (after the window)
    expect(isInstantInWindow(w, new Date('2026-06-13T07:00:00.000Z'))).toBe(false);
    // Saturday 23:00 local (Saturday not in days; its own pre-midnight side must not match)
    expect(isInstantInWindow(w, new Date('2026-06-14T03:00:00.000Z'))).toBe(false);
  });

  it('an unknown timezone fails closed (no suppression)', () => {
    const w = window({
      recurrence: { type: 'weekly', days: [0, 1, 2, 3, 4, 5, 6], startTime: '00:00', endTime: '23:59', timezone: 'Not/AZone' },
    });
    expect(isInstantInWindow(w, new Date('2026-06-12T12:00:00.000Z'))).toBe(false);
  });
});

describe('scope matching', () => {
  const during = '2026-06-12T03:00:00.000Z';
  const base = { starts_at: '2026-06-12T02:00:00.000Z', ends_at: '2026-06-12T04:00:00.000Z' };

  it('integration-scoped windows only match their integration', () => {
    const w = window({ ...base, integration_id: INTEGRATION });
    expect(findMatchingWindow([w], target(during))).not.toBeNull();
    const other = window({ ...base, integration_id: '00000000-0000-0000-0000-000000000099' });
    expect(findMatchingWindow([other], target(during))).toBeNull();
  });

  it('client- and asset-scoped windows only match their client/asset', () => {
    expect(findMatchingWindow([window({ ...base, client_id: CLIENT })], target(during))).not.toBeNull();
    expect(findMatchingWindow([window({ ...base, client_id: CLIENT })], target(during, { clientId: null }))).toBeNull();
    expect(findMatchingWindow([window({ ...base, asset_id: ASSET })], target(during))).not.toBeNull();
    expect(
      findMatchingWindow(
        [window({ ...base, asset_id: '00000000-0000-0000-0000-000000000098' })],
        target(during)
      )
    ).toBeNull();
  });

  it('a window with multiple non-null scopes requires all of them', () => {
    const w = window({ ...base, integration_id: INTEGRATION, client_id: CLIENT });
    expect(findMatchingWindow([w], target(during))).not.toBeNull();
    expect(findMatchingWindow([w], target(during, { clientId: '00000000-0000-0000-0000-000000000097' }))).toBeNull();
  });

  it('inactive windows never match', () => {
    const w = window({ ...base, is_active: false });
    expect(findMatchingWindow([w], target(during))).toBeNull();
  });
});
