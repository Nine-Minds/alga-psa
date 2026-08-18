import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * On-demand device sync, as the v1 API drives it.
 *
 * The behaviours worth pinning are the ones that would let an API-triggered
 * sync and a scheduled one disagree: which cursor a run starts from, and what
 * happens to that cursor when the provider fails.
 */

const strategy = vi.hoisted(() => ({ syncDevicesIncremental: vi.fn() }));
const getStrategy = vi.hoisted(() => vi.fn(() => strategy));
const integrationRow = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
const updateSpy = vi.hoisted(() => vi.fn().mockResolvedValue(1));

vi.mock('@alga-psa/jobs/handlers/rmmAlertPollingHandlers', () => ({
  getRmmDeviceSyncStrategy: getStrategy,
  ensureRmmDeviceSyncStrategies: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: () => ({
      where: () => ({
        first: async () => integrationRow.current,
        update: updateSpy,
      }),
    }),
  }),
}));

const {
  triggerRmmDeviceSync,
  RmmIntegrationInactiveError,
  RmmIntegrationNotFoundError,
  RmmProviderNotSchedulableError,
} = await import('./rmmDeviceSyncTriggerService');

const knex = { fn: { now: () => new Date('2026-08-16T12:00:00.000Z') } } as never;

describe('triggerRmmDeviceSync', () => {
  beforeEach(() => {
    updateSpy.mockClear();
    strategy.syncDevicesIncremental.mockReset().mockResolvedValue({ devicesProcessed: 9 });
    getStrategy.mockReturnValue(strategy);
    integrationRow.current = {
      integration_id: 'integration-1',
      is_active: true,
      last_incremental_sync_at: '2026-08-16T10:00:00.000Z',
      last_full_sync_at: '2026-08-01T00:00:00.000Z',
    };
  });

  it('resumes an incremental run from the same cursor the schedule uses', async () => {
    await triggerRmmDeviceSync(knex, 'tenant-1', 'ninjaone' as never, 'incremental');

    const [{ since }] = strategy.syncDevicesIncremental.mock.calls[0];
    expect(since.toISOString()).toBe('2026-08-16T10:00:00.000Z');
  });

  it('falls back to the last full sync when no incremental has run', async () => {
    integrationRow.current!.last_incremental_sync_at = null;
    await triggerRmmDeviceSync(knex, 'tenant-1', 'ninjaone' as never, 'incremental');

    const [{ since }] = strategy.syncDevicesIncremental.mock.calls[0];
    expect(since.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('expresses a full run as an epoch cursor rather than a separate path', async () => {
    // Every strategy filters on the device's own last-seen with an inclusive
    // lower bound, so an epoch cursor admits everything — one code path for
    // both sync types, and no second implementation to drift.
    await triggerRmmDeviceSync(knex, 'tenant-1', 'ninjaone' as never, 'full');

    const [{ since }] = strategy.syncDevicesIncremental.mock.calls[0];
    expect(since.getTime()).toBe(0);
  });

  it('advances the cursor and clears the error on success', async () => {
    await triggerRmmDeviceSync(knex, 'tenant-1', 'ninjaone' as never, 'incremental');

    const patch = updateSpy.mock.calls.at(-1)?.[0];
    expect(patch).toMatchObject({ sync_status: 'completed', sync_error: null });
    expect(patch.last_incremental_sync_at).toBeInstanceOf(Date);
  });

  it('stamps last_full_sync_at only on a full run', async () => {
    await triggerRmmDeviceSync(knex, 'tenant-1', 'ninjaone' as never, 'incremental');
    expect(updateSpy.mock.calls.at(-1)?.[0]).not.toHaveProperty('last_full_sync_at');

    await triggerRmmDeviceSync(knex, 'tenant-1', 'ninjaone' as never, 'full');
    expect(updateSpy.mock.calls.at(-1)?.[0]).toHaveProperty('last_full_sync_at');
  });

  it('does NOT advance the cursor when the provider fails', async () => {
    // The invariant the whole feature rests on: a failed window must be re-read.
    strategy.syncDevicesIncremental.mockRejectedValue(new Error('provider 503'));

    await expect(
      triggerRmmDeviceSync(knex, 'tenant-1', 'ninjaone' as never, 'incremental')
    ).rejects.toThrow('provider 503');

    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('rejects a provider with no device sync strategy', async () => {
    getStrategy.mockReturnValue(undefined as never);

    await expect(
      triggerRmmDeviceSync(knex, 'tenant-1', 'huntress' as never, 'full')
    ).rejects.toBeInstanceOf(RmmProviderNotSchedulableError);
  });

  it('rejects when the tenant has no such integration', async () => {
    integrationRow.current = null;

    await expect(
      triggerRmmDeviceSync(knex, 'tenant-1', 'ninjaone' as never, 'full')
    ).rejects.toBeInstanceOf(RmmIntegrationNotFoundError);
  });

  it('refuses to sync an inactive integration', async () => {
    integrationRow.current!.is_active = false;

    await expect(
      triggerRmmDeviceSync(knex, 'tenant-1', 'ninjaone' as never, 'full')
    ).rejects.toBeInstanceOf(RmmIntegrationInactiveError);
    expect(strategy.syncDevicesIncremental).not.toHaveBeenCalled();
  });

  it('reports what the strategy processed', async () => {
    const result = await triggerRmmDeviceSync(knex, 'tenant-1', 'ninjaone' as never, 'incremental');
    expect(result).toMatchObject({ provider: 'ninjaone', syncType: 'incremental', devicesProcessed: 9 });
  });
});

/**
 * Tenant scoping, carried over from the RMM contract suite in
 * packages/integrations when this module moved here to break an
 * integrations -> jobs dependency cycle. CitusDB requires structural scoping;
 * a raw .where({ tenant }) is not equivalent and does not survive sharding.
 */
describe('rmmDeviceSyncTriggerService tenant scoping', () => {
  it('reaches rmm_integrations only through tenantDb', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('./rmmDeviceSyncTriggerService.ts', import.meta.url), 'utf8');

    expect(source).toContain("import { tenantDb } from '@alga-psa/db';");
    expect(source).toContain("tenantDb(knex, tenant).table('rmm_integrations')");
    expect(source).not.toContain("knex('rmm_integrations')");
    expect(source).not.toContain('.where({ tenant })');
  });
});
