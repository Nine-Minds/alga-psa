import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * The adapter between the Tactical sync engine and the rmm-device-sync job.
 *
 * The engine reports failure in a `success` field instead of throwing, and the
 * job advances last_incremental_sync_at on any resolved promise. So the single
 * most important behaviour here is that a reported failure becomes a thrown
 * error — otherwise a failed window is skipped permanently and invisibly, and
 * the integration still reads as 'completed'.
 */

const runSync = vi.hoisted(() => vi.fn());

vi.mock('./deviceSync', () => ({ runTacticalRmmDeviceSync: runSync }));
vi.mock('@alga-psa/db', () => ({
  // Pass-through: the real one establishes AsyncLocalStorage tenant context.
  runWithTenant: (_tenantId: string, fn: () => Promise<unknown>) => fn(),
}));

const { tacticalRmmDeviceSyncStrategy } = await import('./deviceSyncStrategy');

const input = {
  tenantId: 'tenant-1',
  integrationId: 'integration-1',
  since: new Date('2026-08-13T09:00:00.000Z'),
};

describe('tacticalRmmDeviceSyncStrategy', () => {
  beforeEach(() => runSync.mockReset());

  it('runs an incremental sync from the job cursor', async () => {
    runSync.mockResolvedValue({ success: true, items_processed: 5 });

    await tacticalRmmDeviceSyncStrategy.syncDevicesIncremental(input);

    expect(runSync).toHaveBeenCalledWith(
      { tenant: 'tenant-1' },
      { syncType: 'incremental', since: input.since },
    );
  });

  it('runs with no acting user, so the event is attributed to SYSTEM', async () => {
    runSync.mockResolvedValue({ success: true, items_processed: 0 });

    await tacticalRmmDeviceSyncStrategy.syncDevicesIncremental(input);

    const [args] = runSync.mock.calls[0];
    expect(args).not.toHaveProperty('actorUserId');
  });

  it('reports how many devices it processed', async () => {
    runSync.mockResolvedValue({ success: true, items_processed: 5 });
    await expect(tacticalRmmDeviceSyncStrategy.syncDevicesIncremental(input)).resolves.toEqual({
      devicesProcessed: 5,
    });
  });

  it('THROWS when the engine reports failure', async () => {
    // The one that matters — see the file header.
    runSync.mockResolvedValue({ success: false, error: 'Tactical RMM is temporarily unavailable.' });

    await expect(tacticalRmmDeviceSyncStrategy.syncDevicesIncremental(input)).rejects.toThrow(
      /temporarily unavailable/,
    );
  });

  it('surfaces per-agent errors when the engine fails without a top-level message', async () => {
    runSync.mockResolvedValue({
      success: false,
      items_failed: 2,
      errors: ['Failed to sync agent a.', 'Failed to sync agent b.'],
    });

    await expect(tacticalRmmDeviceSyncStrategy.syncDevicesIncremental(input)).rejects.toThrow(
      /Failed to sync agent a\.; Failed to sync agent b\./,
    );
  });

  it('does not throw when individual agents failed but the run succeeded', async () => {
    // A partial failure still advances the cursor: those agents were read, and
    // the next run picks them up on their own last_seen anyway.
    runSync.mockResolvedValue({ success: true, items_processed: 10, items_failed: 1 });

    await expect(tacticalRmmDeviceSyncStrategy.syncDevicesIncremental(input)).resolves.toEqual({
      devicesProcessed: 10,
    });
  });

  it('defaults to zero when the engine omits a processed count', async () => {
    runSync.mockResolvedValue({ success: true });
    await expect(tacticalRmmDeviceSyncStrategy.syncDevicesIncremental(input)).resolves.toEqual({
      devicesProcessed: 0,
    });
  });
});
