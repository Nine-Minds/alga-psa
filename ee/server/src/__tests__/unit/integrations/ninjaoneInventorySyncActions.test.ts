import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The trigger actions schedule 'rmm-inventory-sync' and return a jobId; they
 * never walk the fleet inside the request. Also covers the durable duplicate
 * guard (incl. stale `running` recovery) and the inventorySync field on the
 * compliance summary.
 */

const TENANT = 'tenant-inv';
const user = { user_id: 'user-1', tenant: TENANT, user_type: 'internal' };

const h = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  scheduleJob: vi.fn(),
  integration: null as Record<string, unknown> | null,
  jobRow: null as Record<string, unknown> | null,
  updates: [] as Array<Record<string, unknown>>,
  whereRaw: vi.fn(),
  syncSoftware: vi.fn(),
  syncPatches: vi.fn(),
  summaryCounts: {} as Record<string, unknown>,
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: (...a: unknown[]) => Promise<unknown>) => (...a: unknown[]) => fn(user, { tenant: TENANT }, ...a),
  hasPermission: h.hasPermission,
}));
vi.mock('server/src/lib/tier-gating/assertTierAccess', () => ({ assertTierAccess: vi.fn() }));
vi.mock('@/lib/db', () => ({
  createTenantKnex: async () => ({ knex: { raw: (sql: string, b: unknown[]) => ({ sql, b }) }, tenant: TENANT }),
}));
vi.mock('@alga-psa/db', () => ({
  withTransaction: vi.fn(),
  tenantDb: () => ({
    tenantJoin: vi.fn(),
    table: (name: string) => {
      const b: any = {};
      for (const m of ['where', 'whereNotNull', 'select', 'groupBy', 'count', 'countDistinct']) b[m] = () => b;
      b.whereRaw = (...a: unknown[]) => { h.whereRaw(...a); return b; };
      b.update = async (row: Record<string, unknown>) => { h.updates.push(row); return 1; };
      b.first = async () => {
        if (name === 'rmm_integrations') return h.integration;
        if (name === 'jobs') return h.jobRow;
        return { count: 0 };
      };
      b.then = (resolve: (v: unknown) => unknown) => resolve([]);
      return b;
    },
  }),
}));
vi.mock('@alga-psa/core/secrets', () => ({ getSecretProviderInstance: vi.fn() }));
vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('server/src/lib/jobs/initializeJobRunner', () => ({
  getJobRunnerInstance: () => ({ scheduleJob: h.scheduleJob }),
  initializeJobRunner: async () => ({ scheduleJob: h.scheduleJob }),
}));
// If the action ever pulls these in again, the "not called" assertions catch it.
vi.mock('@ee/lib/integrations/ninjaone/sync/softwareSync', () => ({ syncSoftwareInventory: h.syncSoftware }));
vi.mock('@ee/lib/integrations/ninjaone/sync/patchSync', () => ({ syncPatchStatus: h.syncPatches }));

const actions = await import('@ee/lib/actions/integrations/ninjaoneActions');
const { triggerSoftwareInventorySync, triggerPatchStatusSync, getRmmComplianceSummary } = actions;

const runningRecord = { status: 'running', jobId: 'job-live', startedAt: '2026-11-16T10:00:00.000Z' };

beforeEach(() => {
  vi.clearAllMocks();
  h.updates.length = 0;
  h.hasPermission.mockResolvedValue(true);
  h.scheduleJob.mockResolvedValue({ jobId: 'job-new', externalId: 'ext' });
  h.integration = { integration_id: 'int-1', settings: {} };
  h.jobRow = null;
});

describe.each([
  ['software', triggerSoftwareInventorySync],
  ['patches', triggerPatchStatusSync],
] as const)('%s trigger action', (kind, trigger) => {
  it('schedules the job, returns its jobId and never runs the sync inline', async () => {
    const result = await trigger();
    expect(result).toEqual({ success: true, jobId: 'job-new' });
    expect(h.scheduleJob).toHaveBeenCalledTimes(1);
    const [name, data, opts] = h.scheduleJob.mock.calls[0];
    expect(name).toBe('rmm-inventory-sync');
    expect(data).toMatchObject({ tenantId: TENANT, integrationId: 'int-1', provider: 'ninjaone', kind, performedBy: 'user-1' });
    expect(opts.singletonKey).toBe(`rmm-inventory-sync:${TENANT}:int-1:${kind}`);
    expect(h.syncSoftware).not.toHaveBeenCalled();
    expect(h.syncPatches).not.toHaveBeenCalled();
  });

  it('writes a `running` record for the new job (not clobbering this job\'s own outcome)', async () => {
    await trigger();
    expect(h.updates).toHaveLength(1);
    const patch = h.updates[0].settings as { b: unknown[] };
    expect(patch.b[0]).toBe(kind);
    expect(JSON.parse(patch.b[1] as string)).toMatchObject({ status: 'running', jobId: 'job-new' });
    expect(h.whereRaw).toHaveBeenCalledWith(expect.stringContaining('<>'), [kind, 'job-new']);
  });

  it('returns the in-flight jobId instead of scheduling a duplicate', async () => {
    h.integration = { integration_id: 'int-1', settings: { inventorySync: { [kind]: runningRecord } } };
    h.jobRow = { status: 'processing' };
    expect(await trigger()).toEqual({ success: true, jobId: 'job-live' });
    expect(h.scheduleJob).not.toHaveBeenCalled();
    expect(h.updates).toHaveLength(0);
  });

  it.each(['completed', 'failed'])('overwrites a stale running record whose job is %s', async (status) => {
    h.integration = { integration_id: 'int-1', settings: JSON.stringify({ inventorySync: { [kind]: runningRecord } }) };
    h.jobRow = { status };
    expect(await trigger()).toEqual({ success: true, jobId: 'job-new' });
    expect(h.scheduleJob).toHaveBeenCalledTimes(1);
  });

  it('treats a running record whose job row is gone as stale', async () => {
    h.integration = { integration_id: 'int-1', settings: { inventorySync: { [kind]: runningRecord } } };
    h.jobRow = null;
    expect(await trigger()).toEqual({ success: true, jobId: 'job-new' });
  });

  it('a finished outcome (not running) never blocks a new run', async () => {
    h.integration = {
      integration_id: 'int-1',
      settings: { inventorySync: { [kind]: { status: 'partial', jobId: 'job-old', assetsFailed: 1 } } },
    };
    expect(await trigger()).toEqual({ success: true, jobId: 'job-new' });
  });

  it('refuses a user without asset:update and schedules nothing', async () => {
    h.hasPermission.mockResolvedValue(false);
    const result = await trigger();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/permission/i);
    expect(result.jobId).toBeUndefined();
    expect(h.scheduleJob).not.toHaveBeenCalled();
  });

  it('refuses when NinjaOne is not configured', async () => {
    h.integration = null;
    const result = await trigger();
    expect(result.success).toBe(false);
    expect(h.scheduleJob).not.toHaveBeenCalled();
  });

  it('reports a scheduling failure as a structural refusal, not a sync result', async () => {
    h.scheduleJob.mockRejectedValue(new Error('queue down'));
    const result = await trigger();
    expect(result.success).toBe(false);
    expect(result.jobId).toBeUndefined();
  });
});

describe('triggerSoftwareInventorySync options', () => {
  it('defaults trackChanges to true and forwards assetIds', async () => {
    await triggerSoftwareInventorySync({ assetIds: ['a1'] });
    expect(h.scheduleJob.mock.calls[0][1]).toMatchObject({ assetIds: ['a1'], trackChanges: true });
  });
});

describe('action module', () => {
  it('does not import the sync modules or revalidate from the schedulers', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../../../lib/actions/integrations/ninjaoneActions.ts'),
      'utf8',
    );
    // searchSoftware (a different action) legitimately imports softwareSync, so
    // assert on the scheduler section only.
    const schedulerSrc = src.slice(
      src.indexOf('const NON_TERMINAL_JOB_STATUSES'),
      src.indexOf('Search for software across all assets'),
    );
    expect(schedulerSrc.length).toBeGreaterThan(500);
    expect(schedulerSrc).not.toMatch(/softwareSync|patchSync|syncSoftwareInventory|syncPatchStatus/);
    expect(schedulerSrc).not.toMatch(/revalidatePath/);
    expect(src).not.toMatch(/import\s[^;]*sync\/(softwareSync|patchSync)/);
  });
});

describe('getRmmComplianceSummary inventorySync', () => {
  it('returns the stored per-kind records from integration settings', async () => {
    const partial = {
      status: 'partial', assetsProcessed: 831, assetsUpdated: 828, assetsFailed: 3, errorCount: 3,
      errors: ['a', 'b', 'c'], startedAt: 's', completedAt: 'e', jobId: 'job-1',
    };
    h.integration = { last_sync_at: null, settings: { tokenLifecycle: { status: 'ok' }, inventorySync: { software: partial, patches: runningRecord } } };
    const result = await getRmmComplianceSummary();
    expect(result.success).toBe(true);
    expect(result.summary?.inventorySync).toEqual({ software: partial, patches: runningRecord });
  });

  it('returns an empty inventorySync when nothing has run', async () => {
    h.integration = { last_sync_at: null, settings: {} };
    const result = await getRmmComplianceSummary();
    expect(result.summary?.inventorySync).toEqual({});
  });
});
