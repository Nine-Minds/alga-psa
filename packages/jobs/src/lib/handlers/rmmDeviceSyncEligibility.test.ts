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

const DEVICE_SYNC_PROVIDERS = ['ninjaone', 'levelio', 'tacticalrmm', 'tanium'];
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
    expect(deviceSyncEligible({ is_active: true, settings: enabled, provider: 'huntress' })).toBe(false);
    expect(deviceSyncEligible({ is_active: true, settings: enabled, provider: 'unknown-provider' })).toBe(false);
  });

  it('is eligible for Tactical RMM, which polls alerts as well', () => {
    // The one provider with both capabilities — each still converges on its own
    // schedule, so enabling device sync must not depend on the alert poll.
    expect(ALERT_POLLING_PROVIDERS).toContain('tacticalrmm');
    expect(deviceSyncEligible({ is_active: true, settings: enabled, provider: 'tacticalrmm' })).toBe(true);
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
 * Why the remaining two providers are absent, recorded so nobody "fixes" the
 * list by adding them:
 *
 * - huntress: exposes getAgent(id) but no agent listing, and orgSync sets
 *   auto_sync_assets: false — it is an incident source, not an inventory one.
 *   Nothing to schedule until a device-list endpoint exists.
 * - tanium: has a working full sync, but only behind a server action wrapped in
 *   withAuth + a per-user permission check. A scheduled run has no acting user,
 *   so it needs the same extraction Tactical just had: move the body into a
 *   plain lib module, leave the permission check on the action.
 *
 * Tactical RMM was in this list until its bulk sync was extracted. It always
 * had one — syncTacticalRmmDevices, walking /beta/v1/agent/ per mapped org —
 * it was simply unreachable from a job because every export of a 'use server'
 * module is an RPC endpoint, so the sync could not be exported unguarded.
 */
describe('providers deliberately excluded from device sync', () => {
  it('lists only the providers with a job-callable device sync', () => {
    expect([...DEVICE_SYNC_PROVIDERS].sort()).toEqual(['levelio', 'ninjaone', 'tacticalrmm', 'tanium']);
  });
});
