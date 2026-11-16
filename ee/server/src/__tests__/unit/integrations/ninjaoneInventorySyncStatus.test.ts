import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Both whole-fleet inventory syncs must report a partial run as `partial`
 * (not as the legacy boolean `success: false`), keep the counts, cap the
 * stored error list, and report progress once per batch.
 */

const state = vi.hoisted(() => ({
  assets: [] as Array<{ asset_id: string; asset_type: string; rmm_device_id: string; name: string }>,
  failDevice: new Set<string>(),
  clientError: null as Error | null,
}));

vi.mock('@/lib/db', () => ({ createTenantKnex: async () => ({ knex: {} }) }));

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: (name: string) => {
      const builder: any = {};
      for (const m of ['where', 'whereNotNull', 'whereIn', 'andWhere', 'first', 'insert', 'returning']) {
        builder[m] = () => builder;
      }
      builder.select = async () => (name === 'assets' ? state.assets : []);
      builder.update = async () => 1;
      builder.then = (resolve: (v: unknown) => unknown) => resolve(undefined);
      return builder;
    },
  }),
}));

vi.mock('../../../lib/integrations/ninjaone/ninjaOneClient', () => ({
  createNinjaOneClient: async () => {
    if (state.clientError) throw state.clientError;
    const fail = (id: number) => {
      if (state.failDevice.has(String(id))) throw new Error(`device ${id} unreachable`);
    };
    return {
      getDeviceSoftware: async (id: number) => {
        fail(id);
        return [];
      },
      getDevicePatchStatus: async (id: number) => {
        fail(id);
        return { pending: 3, failed: 1 };
      },
    };
  },
}));

const { syncSoftwareInventory } = await import('../../../lib/integrations/ninjaone/sync/softwareSync');
const { syncPatchStatus } = await import('../../../lib/integrations/ninjaone/sync/patchSync');
const { MAX_SYNC_ERRORS } = await import('../../../lib/integrations/ninjaone/sync/syncOutcome');

const makeAssets = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    asset_id: `asset-${i}`,
    asset_type: 'workstation',
    rmm_device_id: String(i + 1),
    name: `PC-${i}`,
  }));

const runners = [
  ['software', syncSoftwareInventory],
  ['patches', syncPatchStatus],
] as const;

async function run(fn: (typeof runners)[number][1], options: Record<string, unknown> = {}) {
  const promise = fn('tenant-1', 'integration-1', { batchSize: 10, ...options });
  await vi.runAllTimersAsync();
  return promise;
}

describe.each(runners)('%s sync status', (_kind, fn) => {
  beforeEach(() => {
    vi.useFakeTimers();
    state.assets = makeAssets(25);
    state.failDevice = new Set();
    state.clientError = null;
  });
  afterEach(() => vi.useRealTimers());

  it('is succeeded when every device updates', async () => {
    const result = await run(fn);
    expect(result.status).toBe('succeeded');
    expect(result.success).toBe(true);
    expect(result).toMatchObject({ assetsProcessed: 25, assetsUpdated: 25, assetsFailed: 0, errorCount: 0 });
  });

  it('a single failed device makes the run partial and keeps the counts', async () => {
    state.failDevice = new Set(['7']);
    const result = await run(fn);
    expect(result.status).toBe('partial');
    expect(result.success).toBe(false); // legacy boolean unchanged
    expect(result).toMatchObject({ assetsProcessed: 25, assetsUpdated: 24, assetsFailed: 1, errorCount: 1 });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('unreachable');
  });

  it('stays partial when most devices fail but the run completed', async () => {
    state.failDevice = new Set(state.assets.map(a => a.rmm_device_id));
    const result = await run(fn);
    expect(result.status).toBe('partial');
    expect(result.assetsFailed).toBe(25);
  });

  it('caps errors[] at 20 while errorCount stays the true total', async () => {
    state.assets = makeAssets(45);
    state.failDevice = new Set(state.assets.map(a => a.rmm_device_id));
    const result = await run(fn);
    expect(MAX_SYNC_ERRORS).toBe(20);
    expect(result.errors).toHaveLength(20);
    expect(result.errorCount).toBe(45);
  });

  it('is failed when the run throws before any device is processed', async () => {
    state.clientError = new Error('reconnect required');
    const result = await run(fn);
    expect(result.status).toBe('failed');
    expect(result.success).toBe(false);
    expect(result.errors).toEqual(['reconnect required']);
    expect(result.errorCount).toBe(1);
  });

  it('calls onProgress once per batch with done/total', async () => {
    const onProgress = vi.fn();
    await run(fn, { onProgress });
    expect(onProgress.mock.calls).toEqual([[10, 25], [20, 25], [25, 25]]);
  });

  it('does not fail the sync when onProgress throws', async () => {
    const result = await run(fn, { onProgress: () => { throw new Error('boom'); } });
    expect(result.status).toBe('succeeded');
  });
});
