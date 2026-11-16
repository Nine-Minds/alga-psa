import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 'rmm-inventory-sync' handler: eligibility gate, per-batch progress rows,
 * durable outcome in settings, and a throw recorded as `failed`.
 */

const h = vi.hoisted(() => ({
  integration: null as Record<string, unknown> | null,
  tenant: { suspended_at: null } as Record<string, unknown> | null,
  inserts: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
  runSoftware: vi.fn(),
  runPatches: vi.fn(),
  revalidate: vi.fn(),
  patch: vi.fn((_knex: unknown, kind: string, record: unknown) => ({ kind, record })),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: async () => ({ fn: { now: () => 'NOW' } }),
}));
vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: (name: string) => {
      if (name === 'tenants') return { first: async () => h.tenant };
      if (name === 'job_details') {
        return { insert: async (row: Record<string, unknown>) => { h.inserts.push(row); } };
      }
      return {
        where: () => ({
          first: async () => h.integration,
          update: async (row: Record<string, unknown>) => { h.updates.push(row); return 1; },
        }),
      };
    },
  }),
}));
vi.mock('@alga-psa/shared/rmm/inventorySync', async (orig) => ({
  ...(await orig<typeof import('@alga-psa/shared/rmm/inventorySync')>()),
  inventorySyncSettingsPatch: h.patch,
}));
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }));
vi.mock('./rmmAlertPollingHandlers', () => ({
  isIntegrationReconnectRequired: (s: { tokenLifecycle?: { status?: string } }) =>
    s.tokenLifecycle?.status === 'reconnect_required',
}));
vi.mock('@enterprise/lib/integrations/ninjaone/sync/softwareSync', () => ({
  syncSoftwareInventory: (...a: unknown[]) => h.runSoftware(...a),
}));
vi.mock('@enterprise/lib/integrations/ninjaone/sync/patchSync', () => ({
  syncPatchStatus: (...a: unknown[]) => h.runPatches(...a),
}));

const { rmmInventorySyncHandler } = await import('./rmmInventorySyncHandler');

const data = {
  tenantId: 'tenant-1',
  integrationId: 'int-1',
  provider: 'ninjaone' as const,
  kind: 'software' as const,
  jobServiceId: 'job-1',
};

const okResult = {
  status: 'partial',
  success: false,
  assetsProcessed: 831,
  assetsUpdated: 830,
  assetsFailed: 1,
  errorCount: 1,
  errors: ['Asset a (PC): unreachable'],
};

describe('rmmInventorySyncHandler', () => {
  beforeEach(() => {
    h.integration = { is_active: true, settings: {} };
    h.tenant = { suspended_at: null };
    h.inserts.length = 0;
    h.updates.length = 0;
    h.runSoftware.mockReset();
    h.runPatches.mockReset();
    h.revalidate.mockReset();
    h.patch.mockClear();
  });

  it.each([
    ['integration missing', () => { h.integration = null; }],
    ['integration inactive', () => { h.integration = { is_active: false, settings: {} }; }],
    ['tenant suspended', () => { h.tenant = { suspended_at: new Date() }; }],
    ['reconnect required', () => { h.integration = { is_active: true, settings: JSON.stringify({ tokenLifecycle: { status: 'reconnect_required' } }) }; }],
  ])('does nothing when ineligible: %s', async (_label, arrange) => {
    arrange();
    await rmmInventorySyncHandler('ignored', data);
    expect(h.runSoftware).not.toHaveBeenCalled();
    expect(h.updates).toHaveLength(0);
    expect(h.inserts).toHaveLength(0);
    expect(h.revalidate).not.toHaveBeenCalled();
  });

  it('writes one job_details progress row per batch', async () => {
    h.runSoftware.mockImplementation(async (_t, _i, opts) => {
      opts.onProgress(25, 60);
      opts.onProgress(50, 60);
      opts.onProgress(60, 60);
      return okResult;
    });
    await rmmInventorySyncHandler('ignored', data);
    expect(h.inserts).toHaveLength(3);
    expect(h.inserts[0]).toMatchObject({ tenant: 'tenant-1', job_id: 'job-1', status: 'completed' });
    expect(h.inserts.map(r => JSON.parse(r.result as string))).toEqual([
      { kind: 'software', done: 25, total: 60 },
      { kind: 'software', done: 50, total: 60 },
      { kind: 'software', done: 60, total: 60 },
    ]);
  });

  it('writes the outcome to settings.inventorySync[kind] and revalidates afterwards', async () => {
    h.runSoftware.mockResolvedValue(okResult);
    await rmmInventorySyncHandler('ignored', { ...data, assetIds: ['x'], trackChanges: true, performedBy: 'u1' });

    expect(h.runSoftware).toHaveBeenCalledWith(
      'tenant-1', 'int-1',
      expect.objectContaining({ assetIds: ['x'], trackChanges: true, performedBy: 'u1', onProgress: expect.any(Function) }),
    );
    expect(h.patch).toHaveBeenCalledTimes(1);
    const [, kind, record] = h.patch.mock.calls[0] as unknown as [unknown, string, Record<string, unknown>];
    expect(kind).toBe('software');
    expect(record).toMatchObject({
      status: 'partial', assetsProcessed: 831, assetsUpdated: 830, assetsFailed: 1,
      errorCount: 1, errors: ['Asset a (PC): unreachable'], jobId: 'job-1',
    });
    expect(typeof record.startedAt).toBe('string');
    expect(typeof record.completedAt).toBe('string');
    expect(h.updates).toHaveLength(1);
    expect(h.revalidate).toHaveBeenCalled();
  });

  it('dispatches kind=patches to the patch runner', async () => {
    h.runPatches.mockResolvedValue({ ...okResult, status: 'succeeded', assetsFailed: 0, errorCount: 0, errors: [] });
    await rmmInventorySyncHandler('ignored', { ...data, kind: 'patches' });
    expect(h.runPatches).toHaveBeenCalledTimes(1);
    expect(h.runSoftware).not.toHaveBeenCalled();
    expect((h.patch.mock.calls[0] as unknown[])[1]).toBe('patches');
  });

  it('records `failed` when the sync throws, and still revalidates', async () => {
    h.runSoftware.mockRejectedValue(new Error('NinjaOne exploded'));
    await expect(rmmInventorySyncHandler('ignored', data)).resolves.toBeUndefined();
    const record = (h.patch.mock.calls[0] as unknown as [unknown, string, Record<string, unknown>])[2];
    expect(record).toMatchObject({ status: 'failed', errorCount: 1, errors: ['NinjaOne exploded'], jobId: 'job-1' });
    expect(h.revalidate).toHaveBeenCalled();
  });

  it('records the sync\'s own `failed` status (returned, not thrown) as failed with its errors', async () => {
    h.runSoftware.mockResolvedValue({ ...okResult, status: 'failed', assetsProcessed: 0, assetsUpdated: 0, assetsFailed: 0, errors: ['no credentials'] });
    await rmmInventorySyncHandler('ignored', data);
    const record = (h.patch.mock.calls[0] as unknown as [unknown, string, Record<string, unknown>])[2];
    expect(record).toMatchObject({ status: 'failed', errors: ['no credentials'] });
  });
});
