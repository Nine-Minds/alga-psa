/**
 * Scheduled RMM device sync, against a real database and real job runners.
 *
 * The unit tests in packages/jobs mock @alga-psa/db, so they cannot show that
 * the reconciler's unscoped join runs, that settings JSONB round-trips, that
 * the handler's tenant-scoped writes land on the right columns, or that either
 * job backend accepts and delivers the schedule. That is what this covers.
 *
 * Naming: `.db.test.ts` — the CI unit-coverage job runs without a database and
 * excludes this pattern via SKIP_DB_TESTS (see server/vitest.config.ts). It runs
 * in the integration workflow, which provides Postgres and sets REQUIRE_DB=1 so
 * an unreachable database fails loudly instead of skipping.
 *
 * Temporal has no service in CI, so that block probes for a broker and skips
 * when there isn't one. Start it locally with `temporal server start-dev`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';

import { createTestDbConnection, wireLocalTestDbEnv } from '../../../../test-utils/dbConfig';
import { describeWithDb, isDbReachable } from '../../../../test-utils/requireDb';

import { getAdminConnection } from '@alga-psa/db/admin';
import {
  RMM_DEVICE_SYNC_JOB,
  reconcileRmmPollingSchedules,
  registerRmmDeviceSyncStrategy,
  rmmDeviceSyncHandler,
} from '@alga-psa/jobs/handlers/rmmAlertPollingHandlers';

const TENANT = '11111111-2222-4333-8444-555555555555';
const PROVIDER = 'ninjaone';
const LAST_FULL_SYNC = '2026-08-01T00:00:00.000Z';

const TEMPORAL_HOST = process.env.TEMPORAL_HOST ?? '127.0.0.1';
const TEMPORAL_PORT = Number(process.env.TEMPORAL_PORT ?? 7233);

// Must precede the reachability probe below, which reads DB_HOST/DB_PORT.
// No-op under CI, where the workflow supplies correct DB_* step env.
wireLocalTestDbEnv();

const describeDb = await describeWithDb();

let db: Knex;
let admin: Knex;
let integrationId: string;

/** Back to "device sync enabled, nothing scheduled" — the suite shuffles. */
async function resetState() {
  await admin('jobs').where({ tenant: TENANT }).delete();
  const hasPgBossSchedule = await admin
    .select(1)
    .from('information_schema.tables')
    .where({ table_schema: 'pgboss', table_name: 'schedule' })
    .first();
  if (hasPgBossSchedule) {
    await admin.withSchema('pgboss').from('schedule').delete();
  }
  await admin('rmm_integrations')
    .where({ tenant: TENANT, integration_id: integrationId })
    .update({
      is_active: true,
      settings: JSON.stringify({ deviceSync: { enabled: true, intervalMinutes: 60 } }),
      sync_status: 'pending',
      sync_error: null,
      last_incremental_sync_at: null,
      last_full_sync_at: LAST_FULL_SYNC,
    });
  await admin('tenants').where({ tenant: TENANT }).update({ suspended_at: null });
}

beforeAll(async () => {
  // Bootstraps test_database (drop/recreate + migrate) and repoints DB_* env at
  // it, so getAdminConnection below follows. Seeds are not needed — this suite
  // creates exactly the rows it asserts on.
  db = await createTestDbConnection({ runSeeds: false });
  admin = await getAdminConnection();

  await admin('tenants').insert({
    tenant: TENANT,
    client_name: 'RMM Device Sync Tenant',
    email: 'rmm-device-sync@example.test',
  });
  // Every job record is attributed to a user; scheduling throws without one.
  await admin('users').insert({
    tenant: TENANT,
    username: 'rmm-device-sync',
    hashed_password: 'not-a-real-hash',
    email: 'rmm-device-sync-user@example.test',
    created_at: new Date(),
  });
  const [row] = await admin('rmm_integrations')
    .insert({
      tenant: TENANT,
      provider: PROVIDER,
      is_active: true,
      connected_at: new Date(),
      sync_status: 'completed',
      last_full_sync_at: LAST_FULL_SYNC,
      settings: JSON.stringify({ deviceSync: { enabled: true, intervalMinutes: 60 } }),
    })
    .returning('integration_id');
  integrationId = String(row.integration_id ?? row);

  // Warm the strategy registry before any test installs a spy.
  //
  // rmmDeviceSyncHandler lazily imports the real EE strategies on its first
  // call and registers them with a plain Map.set — so the first invocation
  // OVERWRITES whatever a test registered for 'ninjaone'. Burning that one-shot
  // here (against a provider with no strategy, so it no-ops after the import)
  // makes spy registration stick regardless of shuffled test order.
  await rmmDeviceSyncHandler('registry-warmup', {
    tenantId: TENANT,
    integrationId,
    provider: 'provider-with-no-strategy',
  });
}, 300_000);

afterAll(async () => {
  await admin?.destroy();
  await db?.destroy();
});

beforeEach(async () => {
  await resetState();
});

/** Only the two methods the reconciler calls. */
function spyRunner() {
  return {
    scheduleRecurringJob: vi.fn().mockResolvedValue(undefined),
    cancelJob: vi.fn().mockResolvedValue(true),
  };
}
const asRunner = (r: unknown) => r as never;

describeDb('RMM device sync — reconciler against a real database', () => {
  it('finds the enabled integration and schedules a device sync', async () => {
    const runner = spyRunner();
    await reconcileRmmPollingSchedules(asRunner(runner));

    const call = runner.scheduleRecurringJob.mock.calls.find(([name]) => name === RMM_DEVICE_SYNC_JOB);
    expect(call, 'no device sync schedule was created').toBeDefined();
    const [, data, cron, opts] = call!;
    expect(cron).toBe('0 * * * *');
    expect(data).toMatchObject({ tenantId: TENANT, integrationId, provider: PROVIDER });
    expect(opts).toEqual({ singletonKey: `${RMM_DEVICE_SYNC_JOB}:${TENANT}:${integrationId}` });
  });

  it('schedules nothing when device sync is disabled', async () => {
    await admin('rmm_integrations')
      .where({ tenant: TENANT, integration_id: integrationId })
      .update({ settings: JSON.stringify({ deviceSync: { enabled: false, intervalMinutes: 60 } }) });

    const runner = spyRunner();
    await reconcileRmmPollingSchedules(asRunner(runner));
    expect(runner.scheduleRecurringJob.mock.calls.filter(([n]) => n === RMM_DEVICE_SYNC_JOB)).toHaveLength(0);
  });

  it('reads the interval back out of JSONB and maps it to cron', async () => {
    await admin('rmm_integrations')
      .where({ tenant: TENANT, integration_id: integrationId })
      .update({ settings: JSON.stringify({ deviceSync: { enabled: true, intervalMinutes: 15 } }) });

    const runner = spyRunner();
    await reconcileRmmPollingSchedules(asRunner(runner));
    const call = runner.scheduleRecurringJob.mock.calls.find(([n]) => n === RMM_DEVICE_SYNC_JOB);
    expect(call?.[2]).toBe('*/15 * * * *');
  });

  it('leaves an inactive integration alone', async () => {
    await admin('rmm_integrations')
      .where({ tenant: TENANT, integration_id: integrationId })
      .update({ is_active: false });

    const runner = spyRunner();
    await reconcileRmmPollingSchedules(asRunner(runner));
    expect(runner.scheduleRecurringJob.mock.calls.filter(([n]) => n === RMM_DEVICE_SYNC_JOB)).toHaveLength(0);
  });

  it('schedules Tactical RMM alongside another provider, on its own key', async () => {
    // Tactical joined the eligible list once its bulk sync was extracted out of
    // the 'use server' actions module. Two integrations in one tenant must get
    // separate singleton keys, or enabling one would cancel the other.
    const [tactical] = await admin('rmm_integrations')
      .insert({
        tenant: TENANT,
        provider: 'tacticalrmm',
        is_active: true,
        connected_at: new Date(),
        sync_status: 'completed',
        last_full_sync_at: LAST_FULL_SYNC,
        settings: JSON.stringify({ deviceSync: { enabled: true, intervalMinutes: 30 } }),
      })
      .returning('integration_id');
    const tacticalId = String(tactical.integration_id ?? tactical);

    try {
      const runner = spyRunner();
      await reconcileRmmPollingSchedules(asRunner(runner));

      const deviceCalls = runner.scheduleRecurringJob.mock.calls.filter(([n]) => n === RMM_DEVICE_SYNC_JOB);
      expect(deviceCalls.map(([, data]) => data.provider).sort()).toEqual(['ninjaone', 'tacticalrmm']);

      const tacticalCall = deviceCalls.find(([, data]) => data.provider === 'tacticalrmm')!;
      expect(tacticalCall[2]).toBe('*/30 * * * *');
      expect(tacticalCall[3]).toEqual({ singletonKey: `${RMM_DEVICE_SYNC_JOB}:${TENANT}:${tacticalId}` });

      const ninjaCall = deviceCalls.find(([, data]) => data.provider === 'ninjaone')!;
      expect(ninjaCall[3]).not.toEqual(tacticalCall[3]);
    } finally {
      await admin('rmm_integrations').where({ tenant: TENANT, integration_id: tacticalId }).delete();
    }
  });
});

describeDb('RMM device sync — handler against a real database', () => {
  const data = () => ({ tenantId: TENANT, integrationId, provider: PROVIDER });

  it('advances the cursor and clears the error on success', async () => {
    await admin('rmm_integrations')
      .where({ tenant: TENANT, integration_id: integrationId })
      .update({ sync_error: 'previous failure' });

    const sync = vi.fn().mockResolvedValue({ items_processed: 3, success: true });
    registerRmmDeviceSyncStrategy(PROVIDER, { syncDevicesIncremental: sync as never });

    await rmmDeviceSyncHandler('job-local', data());

    // No incremental yet, so the cursor falls back to last_full_sync_at.
    const [{ since }] = sync.mock.calls[0];
    expect(since.toISOString()).toBe(LAST_FULL_SYNC);

    const row = await admin('rmm_integrations').where({ tenant: TENANT, integration_id: integrationId }).first();
    expect(row.sync_status).toBe('completed');
    expect(row.sync_error).toBeNull();
    expect(row.last_incremental_sync_at).not.toBeNull();
  });

  it('records the failure WITHOUT advancing the cursor', async () => {
    const before = await admin('rmm_integrations')
      .where({ tenant: TENANT, integration_id: integrationId })
      .first();

    registerRmmDeviceSyncStrategy(PROVIDER, {
      syncDevicesIncremental: vi.fn().mockRejectedValue(new Error('provider 503')) as never,
    });

    await expect(rmmDeviceSyncHandler('job-local', data())).rejects.toThrow('provider 503');

    const after = await admin('rmm_integrations')
      .where({ tenant: TENANT, integration_id: integrationId })
      .first();
    expect(after.sync_status).toBe('failed');
    expect(after.sync_error).toContain('provider 503');
    // The invariant: a failed window must be re-read on the next run.
    expect(after.last_incremental_sync_at?.toISOString()).toBe(before.last_incremental_sync_at?.toISOString());
  });

  it('does not call the provider while the tenant is suspended', async () => {
    await admin('tenants').where({ tenant: TENANT }).update({ suspended_at: new Date() });

    const sync = vi.fn().mockResolvedValue({ items_processed: 0, success: true });
    registerRmmDeviceSyncStrategy(PROVIDER, { syncDevicesIncremental: sync as never });

    await rmmDeviceSyncHandler('job-local', data());
    expect(sync).not.toHaveBeenCalled();
  });
});

describeDb('RMM device sync — pg-boss (CE) accepts and delivers the job', () => {
  let runner: { scheduleJob: Function; stop: Function };
  const delivered: Array<{ jobId: string }> = [];

  beforeAll(async () => {
    const { PgBossJobRunner } = await import('server/src/lib/jobs/runners/PgBossJobRunner');
    runner = (await PgBossJobRunner.create()) as never;

    // Mirrors server/src/lib/jobs/registerAllHandlers.ts.
    (runner as unknown as { registerHandler: Function }).registerHandler({
      name: RMM_DEVICE_SYNC_JOB,
      handler: async (jobId: string, jobData: unknown) => {
        delivered.push({ jobId });
        await rmmDeviceSyncHandler(jobId, jobData as never);
      },
      retry: { maxAttempts: 1 },
      timeoutMs: 1_800_000,
    });
    await (runner as unknown as { start: Function }).start();
  }, 180_000);

  afterAll(async () => {
    try {
      await runner?.stop();
    } catch {
      /* best effort */
    }
  });

  it('creates a real recurring schedule and registers it with pg-boss', async () => {
    const result = await reconcileRmmPollingSchedules(runner as never);
    expect(result.ensured).toBeGreaterThanOrEqual(1);

    const job = await admin('jobs')
      .where({ tenant: TENANT })
      .whereRaw(`metadata->>'singletonKey' = ?`, [`${RMM_DEVICE_SYNC_JOB}:${TENANT}:${integrationId}`])
      .first();
    expect(job, 'reconciler did not persist a job record').toBeTruthy();
    expect(job.metadata.recurring).toBe(true);
    expect(job.metadata.interval).toBe('0 * * * *');
    expect(job.external_id, 'no live schedule pointer').toBeTruthy();

    // pg-boss persists its schedule on its own cadence — poll, don't sample.
    let mine: { name: string; cron: string } | undefined;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && !mine) {
      const rows = await admin.withSchema('pgboss').select('name', 'cron').from('schedule');
      mine = rows.find((s: { name: string }) => s.name.includes(integrationId));
      if (!mine) await new Promise((r) => setTimeout(r, 500));
    }
    expect(mine, 'no pgboss.schedule row appeared within 30s').toBeTruthy();
    expect(mine!.cron).toBe('0 * * * *');
  }, 90_000);

  it('converges on a second pass instead of duplicating', async () => {
    await reconcileRmmPollingSchedules(runner as never);
    await reconcileRmmPollingSchedules(runner as never);

    const rows = await admin.withSchema('pgboss').select('name').from('schedule');
    expect(rows.filter((s: { name: string }) => s.name.includes(integrationId))).toHaveLength(1);
  }, 90_000);

  it('delivers the job to rmmDeviceSyncHandler and writes the cursor', async () => {
    const sync = vi.fn().mockResolvedValue({ items_processed: 7, success: true });
    registerRmmDeviceSyncStrategy(PROVIDER, { syncDevicesIncremental: sync as never });
    delivered.length = 0;

    await runner.scheduleJob(RMM_DEVICE_SYNC_JOB, { tenantId: TENANT, integrationId, provider: PROVIDER });

    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline && delivered.length === 0) {
      await new Promise((r) => setTimeout(r, 500));
    }

    expect(delivered.length, 'pg-boss never delivered the job to the handler').toBeGreaterThan(0);
    expect(sync).toHaveBeenCalledTimes(1);

    const after = await admin('rmm_integrations')
      .where({ tenant: TENANT, integration_id: integrationId })
      .first();
    expect(after.sync_status).toBe('completed');
    expect(after.last_incremental_sync_at).not.toBeNull();
  }, 120_000);
});

describeDb('RMM device sync — forwarded dispatch (EE path)', () => {
  it('resolves rmm-device-sync in the server-local registry and runs it', async () => {
    const { registerAllJobHandlers } = await import('server/src/lib/jobs/registerAllHandlers');
    const { executeJobHandler } = await import('server/src/lib/jobs/jobHandlerRegistry');
    const { JobService } = await import('server/src/services/job.service');
    const { StorageService } = await import('@alga-psa/storage/StorageService');

    await registerAllJobHandlers({
      jobService: await JobService.create(),
      storageService: new StorageService(),
      includeEnterprise: false,
    } as never);

    const sync = vi.fn().mockResolvedValue({ items_processed: 4, success: true });
    registerRmmDeviceSyncStrategy(PROVIDER, { syncDevicesIncremental: sync as never });

    // Exactly what maintenanceJobSubscriber does when the worker forwards.
    await executeJobHandler(
      RMM_DEVICE_SYNC_JOB,
      `evt:${RMM_DEVICE_SYNC_JOB}`,
      { tenantId: TENANT, integrationId, provider: PROVIDER } as never,
    );

    expect(sync, 'forwarded job never reached the device sync strategy').toHaveBeenCalledTimes(1);

    const after = await admin('rmm_integrations')
      .where({ tenant: TENANT, integration_id: integrationId })
      .first();
    expect(after.sync_status).toBe('completed');
    expect(after.last_incremental_sync_at).not.toBeNull();
  }, 180_000);
});

// Temporal has no CI service; probe for a broker and skip when absent.
// skipIf rather than a static skip marker, which scripts/check-skip-budget.mjs
// counts against the repo budget — this block is conditional on infrastructure,
// not a disabled test.
const temporalReachable = await isDbReachable(TEMPORAL_HOST, TEMPORAL_PORT);
const describeTemporal =
  describeDb === describe ? describe.skipIf(!temporalReachable) : describeDb;

describeTemporal('RMM device sync — Temporal (EE) schedule lifecycle', () => {
  const scheduleId = () => `${RMM_DEVICE_SYNC_JOB}:${TENANT}:${integrationId}`;
  let runner: unknown;

  async function withClient<T>(fn: (client: { schedule: any }) => Promise<T>): Promise<T> {
    const { Client, Connection } = await import('@temporalio/client');
    const connection = await Connection.connect({ address: `${TEMPORAL_HOST}:${TEMPORAL_PORT}` });
    try {
      return await fn(new Client({ connection, namespace: process.env.TEMPORAL_NAMESPACE ?? 'default' }) as never);
    } finally {
      await connection.close();
    }
  }

  async function listMySchedules(): Promise<string[]> {
    return withClient(async (client) => {
      const ids: string[] = [];
      for await (const s of client.schedule.list()) {
        if (s.scheduleId.includes(integrationId)) ids.push(s.scheduleId);
      }
      return ids;
    });
  }

  async function deleteScheduleIfPresent() {
    await withClient(async (client) => {
      try {
        await client.schedule.getHandle(scheduleId()).delete();
      } catch {
        /* not there */
      }
    });
  }

  beforeAll(async () => {
    process.env.TEMPORAL_ADDRESS = `${TEMPORAL_HOST}:${TEMPORAL_PORT}`;
    const { TemporalJobRunner } = await import('@alga-psa/jobs/runners/TemporalJobRunner');
    runner = await TemporalJobRunner.create();

    // The Temporal runner refuses to schedule a job name it doesn't know.
    (runner as { registerHandler: Function }).registerHandler({
      name: RMM_DEVICE_SYNC_JOB,
      handler: async (jobId: string, jobData: unknown) => rmmDeviceSyncHandler(jobId, jobData as never),
      retry: { maxAttempts: 3 },
      timeoutMs: 1_800_000,
    });
  }, 180_000);

  beforeEach(async () => {
    await deleteScheduleIfPresent();
  });

  afterAll(async () => {
    await deleteScheduleIfPresent();
  });

  it('creates a real Temporal Schedule carrying the worker payload', async () => {
    const result = await reconcileRmmPollingSchedules(runner as never);
    expect(result.ensured).toBeGreaterThanOrEqual(1);

    const description = await withClient((client) => client.schedule.getHandle(scheduleId()).describe());
    expect(description, 'no Temporal schedule was created').toBeTruthy();

    const args = (description as { action: { args?: unknown[] } }).action.args?.[0] as {
      jobName?: string;
      tenantId?: string;
      data?: { provider?: string };
    };
    expect(args?.jobName).toBe(RMM_DEVICE_SYNC_JOB);
    expect(args?.tenantId).toBe(TENANT);
    expect(args?.data?.provider).toBe(PROVIDER);
  }, 120_000);

  it('converges instead of creating a second schedule', async () => {
    await reconcileRmmPollingSchedules(runner as never);
    await reconcileRmmPollingSchedules(runner as never);

    expect(await listMySchedules()).toHaveLength(1);
  }, 120_000);

  it('tears the schedule down when device sync is disabled', async () => {
    await reconcileRmmPollingSchedules(runner as never);
    expect(await listMySchedules()).toHaveLength(1);

    await admin('rmm_integrations')
      .where({ tenant: TENANT, integration_id: integrationId })
      .update({ settings: JSON.stringify({ deviceSync: { enabled: false, intervalMinutes: 60 } }) });

    const result = await reconcileRmmPollingSchedules(runner as never);
    expect(result.cancelled).toBeGreaterThanOrEqual(1);
    expect(await listMySchedules()).toHaveLength(0);
  }, 120_000);
});
