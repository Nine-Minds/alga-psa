import { describe, expect, it } from 'vitest';
import { parseRmmDeviceSyncState } from './rmmAlertPollingHandlers';

/**
 * Device-sync eligibility, as the reconciler computes it:
 *
 *   active && deviceSync.enabled && !tenant_suspended_at && provider is eligible
 *
 * The rule is reproduced here rather than imported because the reconciler
 * computes it inline against a database row. What these tests protect is the
 * shape of the decision — in particular that device sync is independent of
 * whether the same integration can poll alerts.
 *
 * That independence is the reason the reconciler loop was restructured. Level.io
 * has no alert fetcher, so its alert schedule is permanently ineligible; when
 * both capabilities shared one code path, that early exit meant Level.io — the
 * provider that prompted this work — never reached its device sync at all.
 */

const DEVICE_SYNC_PROVIDERS = ['ninjaone', 'levelio'];
const ALERT_POLLING_PROVIDERS = ['ninjaone', 'tacticalrmm'];

function deviceSyncEligible(row: {
  is_active: boolean;
  settings: unknown;
  provider: string;
  tenant_suspended_at?: unknown;
}): boolean {
  const state = parseRmmDeviceSyncState(row);
  return (
    state.active
    && state.pollingEnabled
    && !row.tenant_suspended_at
    && DEVICE_SYNC_PROVIDERS.includes(row.provider)
  );
}

const enabled = { deviceSync: { enabled: true, intervalMinutes: 60 } };

describe('device sync eligibility', () => {
  it('is eligible for an active, enabled, supported provider', () => {
    expect(deviceSyncEligible({ is_active: true, settings: enabled, provider: 'levelio' })).toBe(true);
  });

  it('is eligible for Level.io despite it having no alert fetcher', () => {
    // The case the restructure exists for.
    expect(ALERT_POLLING_PROVIDERS).not.toContain('levelio');
    expect(deviceSyncEligible({ is_active: true, settings: enabled, provider: 'levelio' })).toBe(true);
  });

  it('is not eligible for a provider outside the device sync list', () => {
    // tacticalrmm polls alerts but has never completed a device sync in
    // production; scheduling it would manufacture recurring failures.
    expect(deviceSyncEligible({ is_active: true, settings: enabled, provider: 'tacticalrmm' })).toBe(false);
    expect(deviceSyncEligible({ is_active: true, settings: enabled, provider: 'huntress' })).toBe(false);
  });

  it('is not eligible when the integration is inactive', () => {
    expect(deviceSyncEligible({ is_active: false, settings: enabled, provider: 'ninjaone' })).toBe(false);
  });

  it('is not eligible when device sync was never enabled', () => {
    expect(deviceSyncEligible({ is_active: true, settings: {}, provider: 'ninjaone' })).toBe(false);
  });

  it('is not eligible while the tenant is suspended', () => {
    // Cancelled on suspension and recreated automatically once it clears —
    // a suspended tenant should generate no provider API traffic.
    expect(
      deviceSyncEligible({
        is_active: true,
        settings: enabled,
        provider: 'ninjaone',
        tenant_suspended_at: '2026-08-01T00:00:00.000Z',
      }),
    ).toBe(false);
  });

  it('does not depend on alert polling being enabled', () => {
    const settings = {
      deviceSync: { enabled: true, intervalMinutes: 60 },
      alertPolling: { enabled: false },
    };
    expect(deviceSyncEligible({ is_active: true, settings, provider: 'ninjaone' })).toBe(true);
  });
});

/**
 * Why the other three providers are absent, recorded so nobody "fixes" the list
 * by adding them:
 *
 * - tacticalrmm: has no bulk device sync at all. Its only sync is
 *   syncSingleAgent, driven by webhook deliveries, and it writes sync state on
 *   the entity mapping rather than on rmm_integrations. There is nothing to
 *   schedule until a device-list sync is built.
 * - huntress: exposes getAgent(id) but no agent listing, and orgSync sets
 *   auto_sync_assets: false — it is an incident source, not an inventory one.
 * - tanium: has a working full sync, but only behind a server action wrapped in
 *   withAuth + a per-user permission check. A scheduled run has no acting user,
 *   so it needs extracting into a callable engine first.
 */
describe('providers deliberately excluded from device sync', () => {
  it('lists only the providers with a job-callable device sync', () => {
    expect([...DEVICE_SYNC_PROVIDERS].sort()).toEqual(['levelio', 'ninjaone']);
  });
});
