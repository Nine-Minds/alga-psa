import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * The adapter between NinjaOne's incremental sync and the rmm-device-sync job.
 *
 * The behaviour that matters is failure translation. RmmSyncResult reports
 * failure in a `success` field rather than by throwing, while the job treats a
 * resolved promise as success and advances the delta cursor on it. If the
 * adapter returned normally for a failed sync, the job would move the cursor
 * past a window it never actually read — and nothing would ever go back for it.
 */

const syncDevicesIncremental = vi.hoisted(() => vi.fn());

vi.mock('../../lib/integrations/ninjaone/sync/syncStrategy', () => ({
  getNinjaOneSyncStrategy: () => ({ syncDevicesIncremental }),
}));

const { ninjaOneDeviceSyncStrategy } = await import('../../lib/integrations/ninjaone/sync/deviceSyncStrategy');

const baseResult = {
  success: true,
  sync_type: 'incremental' as const,
  started_at: '2026-08-13T10:00:00.000Z',
  items_processed: 12,
  items_created: 2,
  items_updated: 10,
  items_failed: 0,
};

const input = {
  tenantId: 'tenant-1',
  integrationId: 'integration-1',
  since: new Date('2026-08-13T09:00:00.000Z'),
};

describe('ninjaOneDeviceSyncStrategy', () => {
  beforeEach(() => {
    syncDevicesIncremental.mockReset();
  });

  it('passes the delta cursor straight through', async () => {
    syncDevicesIncremental.mockResolvedValue(baseResult);
    await ninjaOneDeviceSyncStrategy.syncDevicesIncremental(input);

    expect(syncDevicesIncremental).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        integrationId: 'integration-1',
        since: input.since,
      }),
    );
  });

  it('reports the processed count from items_processed', async () => {
    syncDevicesIncremental.mockResolvedValue(baseResult);
    const result = await ninjaOneDeviceSyncStrategy.syncDevicesIncremental(input);
    expect(result).toEqual({ devicesProcessed: 12 });
  });

  it('throws when the sync reports success: false', async () => {
    syncDevicesIncremental.mockResolvedValue({ ...baseResult, success: false, items_failed: 3 });
    await expect(ninjaOneDeviceSyncStrategy.syncDevicesIncremental(input)).rejects.toThrow(
      /reported failure \(3 failed\)/,
    );
  });

  it('includes the provider errors in the thrown message', async () => {
    syncDevicesIncremental.mockResolvedValue({
      ...baseResult,
      success: false,
      items_failed: 1,
      errors: ['device 42 rejected', 'rate limited'],
    });
    await expect(ninjaOneDeviceSyncStrategy.syncDevicesIncremental(input)).rejects.toThrow(
      /device 42 rejected; rate limited/,
    );
  });

  it('does not throw on a successful sync that processed nothing', async () => {
    // A quiet window is a normal outcome, not a failure — the cursor should
    // still advance so the next run reads forward.
    syncDevicesIncremental.mockResolvedValue({ ...baseResult, items_processed: 0 });
    await expect(ninjaOneDeviceSyncStrategy.syncDevicesIncremental(input)).resolves.toEqual({
      devicesProcessed: 0,
    });
  });

  it('propagates a thrown provider error unchanged', async () => {
    syncDevicesIncremental.mockRejectedValue(new Error('NinjaOne API 503'));
    await expect(ninjaOneDeviceSyncStrategy.syncDevicesIncremental(input)).rejects.toThrow('NinjaOne API 503');
  });

  it('sends no performedBy, since a scheduled run has no acting user', async () => {
    syncDevicesIncremental.mockResolvedValue(baseResult);
    await ninjaOneDeviceSyncStrategy.syncDevicesIncremental(input);

    const [{ options }] = syncDevicesIncremental.mock.calls[0];
    expect(options?.performedBy).toBeUndefined();
  });
});
