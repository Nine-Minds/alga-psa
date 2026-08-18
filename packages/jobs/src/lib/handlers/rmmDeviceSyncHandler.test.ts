import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * What a scheduled device sync does to integration state.
 *
 * The invariant worth protecting is the delta cursor. The handler advances
 * last_incremental_sync_at on a resolved promise, so anything that resolves
 * after failing to read its window would move the cursor past data nobody
 * looked at — and no later run would go back for it. That failure is silent:
 * the integration reports 'completed', the timestamps advance, and the assets
 * simply never change.
 */

const updateSpy = vi.hoisted(() => vi.fn().mockResolvedValue(1));
const integrationRow = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
const tenantRow = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: async () => ({ fn: { now: () => new Date('2026-08-13T12:00:00.000Z') } }),
}));

// Both lookups go through tenantDb (structural tenant scoping — a raw
// .where({ tenant }) is forbidden by the tenant-scoping contract), so the stub
// branches on table name rather than call order.
vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: (name: string) => {
      if (name === 'tenants') {
        return { first: async () => tenantRow.current };
      }
      return {
        where: () => ({
          first: async () => integrationRow.current,
          update: updateSpy,
        }),
      };
    },
  }),
  createTenantKnex: async () => ({ knex: {} }),
}));

vi.mock('@alga-psa/shared/rmm/alerts', () => ({
  getRmmAlertFetcher: () => undefined,
  registerRmmAlertFetcher: vi.fn(),
  runRmmAlertReconciliation: vi.fn(),
}));

vi.mock('@alga-psa/integrations/lib/rmm/alerts/pipelineDeps', () => ({ buildRmmAlertPipelineDeps: vi.fn() }));
vi.mock('@alga-psa/integrations/lib/rmm/tacticalrmm/alertFetcher', () => ({ tacticalRmmAlertFetcher: {} }));

const { rmmDeviceSyncHandler, registerRmmDeviceSyncStrategy } = await import('./rmmAlertPollingHandlers');

const data = { tenantId: 'tenant-1', integrationId: 'integration-1', provider: 'faker' };

const enabledIntegration = {
  is_active: true,
  settings: { deviceSync: { enabled: true, intervalMinutes: 60 } },
  last_incremental_sync_at: '2026-08-13T10:00:00.000Z',
  last_full_sync_at: '2026-08-01T00:00:00.000Z',
};

describe('rmmDeviceSyncHandler', () => {
  let sync: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    updateSpy.mockClear();
    integrationRow.current = { ...enabledIntegration };
    tenantRow.current = { suspended_at: null };
    sync = vi.fn().mockResolvedValue({ devicesProcessed: 3 });
    registerRmmDeviceSyncStrategy('faker', {
      syncDevicesIncremental: sync as unknown as (input: {
        tenantId: string;
        integrationId: string;
        since: Date;
      }) => Promise<{ devicesProcessed: number }>,
    });
  });

  it('calls the strategy with the delta cursor from last_incremental_sync_at', async () => {
    await rmmDeviceSyncHandler('job-1', data);

    expect(sync).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', integrationId: 'integration-1' }),
    );
    const [{ since }] = sync.mock.calls[0];
    expect(since.toISOString()).toBe('2026-08-13T10:00:00.000Z');
  });

  it('advances the cursor and clears the error on success', async () => {
    await rmmDeviceSyncHandler('job-1', data);

    const patch = updateSpy.mock.calls.at(-1)?.[0];
    expect(patch).toMatchObject({ sync_status: 'completed', sync_error: null });
    expect(patch.last_incremental_sync_at).toBeInstanceOf(Date);
  });

  it('records the failure when the strategy throws', async () => {
    sync.mockRejectedValue(new Error('provider 503'));
    await expect(rmmDeviceSyncHandler('job-1', data)).rejects.toThrow('provider 503');

    const patch = updateSpy.mock.calls.at(-1)?.[0];
    expect(patch).toMatchObject({ sync_status: 'failed', sync_error: 'provider 503' });
  });

  it('does NOT advance the cursor when the strategy throws', async () => {
    // The one that matters: advancing here skips whatever changed inside the
    // failed window, permanently and invisibly.
    sync.mockRejectedValue(new Error('provider 503'));
    await expect(rmmDeviceSyncHandler('job-1', data)).rejects.toThrow();

    for (const [patch] of updateSpy.mock.calls) {
      expect(patch).not.toHaveProperty('last_incremental_sync_at');
    }
  });

  it('rethrows so the runner records the attempt as failed', async () => {
    // Swallowing would let the backend count a failed sync as a success and
    // report a healthy schedule.
    sync.mockRejectedValue(new Error('provider 503'));
    await expect(rmmDeviceSyncHandler('job-1', data)).rejects.toThrow();
  });

  it('skips without calling the provider when device sync is disabled', async () => {
    integrationRow.current = { ...enabledIntegration, settings: { deviceSync: { enabled: false } } };
    await rmmDeviceSyncHandler('job-1', data);

    expect(sync).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('skips without calling the provider when the integration is inactive', async () => {
    integrationRow.current = { ...enabledIntegration, is_active: false };
    await rmmDeviceSyncHandler('job-1', data);
    expect(sync).not.toHaveBeenCalled();
  });

  it('skips when the integration row has vanished', async () => {
    // A schedule can outlive its integration between reconciler passes; that
    // must be a no-op rather than a crash loop.
    integrationRow.current = null;
    await expect(rmmDeviceSyncHandler('job-1', data)).resolves.toBeUndefined();
    expect(sync).not.toHaveBeenCalled();
  });

  it('skips without calling the provider while the tenant is suspended', async () => {
    // Suspension is immediate; the schedule survives until the next reconciler
    // pass, so the handler must not send traffic in that window.
    tenantRow.current = { suspended_at: '2026-08-12T00:00:00.000Z' };
    await rmmDeviceSyncHandler('job-1', data);

    expect(sync).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('no-ops when no strategy is registered for the provider', async () => {
    await expect(
      rmmDeviceSyncHandler('job-1', { ...data, provider: 'provider-without-strategy' }),
    ).resolves.toBeUndefined();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('falls back to last_full_sync_at when no incremental has run', async () => {
    integrationRow.current = { ...enabledIntegration, last_incremental_sync_at: null };
    await rmmDeviceSyncHandler('job-1', data);

    const [{ since }] = sync.mock.calls[0];
    expect(since.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });
});
