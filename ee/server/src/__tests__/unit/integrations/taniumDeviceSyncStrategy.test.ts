import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * The adapter between the Tanium sync engine and the rmm-device-sync job.
 *
 * The engine reports failure in a `success` field instead of throwing, and the
 * job advances last_incremental_sync_at on any resolved promise. So the
 * behaviour that matters most is that a reported failure becomes a thrown error
 * — otherwise a failed window is skipped permanently and invisibly while the
 * integration still reads as 'completed'.
 */

const runSync = vi.hoisted(() => vi.fn());

vi.mock('./../../../lib/integrations/tanium/sync/deviceSyncEngine', () => ({
  runTaniumDeviceSync: runSync,
}));
vi.mock('@alga-psa/db', () => ({
  // Pass-through: the real one establishes AsyncLocalStorage tenant context.
  runWithTenant: (_tenantId: string, fn: () => Promise<unknown>) => fn(),
}));

const { taniumDeviceSyncStrategy } = await import(
  '../../../lib/integrations/tanium/sync/deviceSyncStrategy'
);

const input = {
  tenantId: 'tenant-1',
  integrationId: 'integration-1',
  since: new Date('2026-08-13T09:00:00.000Z'),
};

describe('taniumDeviceSyncStrategy', () => {
  beforeEach(() => runSync.mockReset());

  it('runs an incremental sync from the job cursor', async () => {
    runSync.mockResolvedValue({ success: true, items_processed: 12 });

    await taniumDeviceSyncStrategy.syncDevicesIncremental(input);

    expect(runSync).toHaveBeenCalledWith(
      { tenant: 'tenant-1' },
      { syncType: 'incremental', since: input.since },
    );
  });

  it('reports how many endpoints it processed', async () => {
    runSync.mockResolvedValue({ success: true, items_processed: 12 });
    await expect(taniumDeviceSyncStrategy.syncDevicesIncremental(input)).resolves.toEqual({
      devicesProcessed: 12,
    });
  });

  it('THROWS when the engine reports failure', async () => {
    runSync.mockResolvedValue({ success: false, error: 'Unable to sync Tanium inventory.' });

    await expect(taniumDeviceSyncStrategy.syncDevicesIncremental(input)).rejects.toThrow(
      /Unable to sync Tanium inventory/,
    );
  });

  it('holds the cursor when a single endpoint fails', async () => {
    // Tanium sets success = errors.length === 0, so one bad endpoint fails the
    // run. Throwing keeps the window unread rather than skipping past it; a
    // stalled cursor is visible, skipped devices are not.
    runSync.mockResolvedValue({
      success: false,
      items_processed: 40,
      items_failed: 1,
      errors: ['endpoint-9: Unable to sync this Tanium endpoint.'],
    });

    await expect(taniumDeviceSyncStrategy.syncDevicesIncremental(input)).rejects.toThrow(
      /endpoint-9/,
    );
  });

  it('defaults to zero when the engine omits a processed count', async () => {
    runSync.mockResolvedValue({ success: true });
    await expect(taniumDeviceSyncStrategy.syncDevicesIncremental(input)).resolves.toEqual({
      devicesProcessed: 0,
    });
  });
});

/**
 * The tier gate has to survive the move off the action.
 *
 * ADVANCED_ASSETS is a tenant entitlement, not a user permission. It used to be
 * enforced by withAdvancedAssetsAccess, which a scheduled run never passes
 * through — so if the engine did not assert it itself, enabling a schedule would
 * be a way around a paid feature. assertTenantTierAccess is the session-free
 * form; assertTierAccess reads getSession() and would be useless in a job.
 *
 * Asserted against source, as rmmDefaultContactActions.contract.test.ts does for
 * its own wrappers: exercising it for real would mean standing up licensing and
 * a tenant tier, and what matters is that the call is present and is the
 * session-free variant.
 */
describe('Tanium device sync engine tier gate', () => {
  it('asserts the tenant tier itself, without a session', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../../../lib/integrations/tanium/sync/deviceSyncEngine.ts', import.meta.url),
      'utf8',
    );

    expect(source).toContain('assertTenantTierAccess(tenant, TIER_FEATURES.ADVANCED_ASSETS)');
    // The session-based variant would silently pass or throw in a job.
    expect(source).not.toMatch(/\bassertTierAccess\s*\(/);
  });
});
