import { getAdminConnection } from '@alga-psa/db/admin';
import logger from '@alga-psa/core/logger';
import { env } from 'process';
import { WorkflowRuntimeV2 } from '../runtime';
import WorkflowRunWaitModelV2 from '../persistence/workflowRunWaitModelV2';
import WorkflowRunModelV2 from '../persistence/workflowRunModelV2';
import WorkflowRunLogModelV2 from '../persistence/workflowRunLogModelV2';
import WorkflowDataStoreModel from '../persistence/workflowDataStoreModel';

const DEFAULT_STORE_EXPIRY_SWEEP_INTERVAL_MS = 60_000;
const DEFAULT_STORE_EXPIRY_SWEEP_TENANT_LIMIT = 50;
const DEFAULT_STORE_EXPIRY_SWEEP_BATCH_SIZE = 1000;

const readPositiveIntEnv = (name: string, fallback: number): number => {
  const parsed = Number(env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
};

export class WorkflowRuntimeV2Worker {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private readonly runtime: WorkflowRuntimeV2;
  private readonly workerId: string;
  private readonly verbose: boolean;
  private lastStoreExpirySweepAt = 0;
  private readonly storeExpirySweepIntervalMs: number;
  private readonly storeExpirySweepTenantLimit: number;
  private readonly storeExpirySweepBatchSize: number;

  constructor(workerId: string) {
    this.workerId = workerId;
    this.verbose =
      env.WORKFLOW_WORKER_VERBOSE === 'true' ||
      env.WORKFLOW_WORKER_VERBOSE === '1' ||
      env.WORKFLOW_WORKER_VERBOSE === 'yes';
    this.runtime = new WorkflowRuntimeV2();
    this.storeExpirySweepIntervalMs = readPositiveIntEnv(
      'WORKFLOW_STORE_EXPIRY_SWEEP_INTERVAL_MS',
      DEFAULT_STORE_EXPIRY_SWEEP_INTERVAL_MS
    );
    this.storeExpirySweepTenantLimit = readPositiveIntEnv(
      'WORKFLOW_STORE_EXPIRY_SWEEP_TENANT_LIMIT',
      DEFAULT_STORE_EXPIRY_SWEEP_TENANT_LIMIT
    );
    this.storeExpirySweepBatchSize = readPositiveIntEnv(
      'WORKFLOW_STORE_EXPIRY_SWEEP_BATCH_SIZE',
      DEFAULT_STORE_EXPIRY_SWEEP_BATCH_SIZE
    );
  }

  async start(pollIntervalMs = 5000): Promise<void> {
    if (this.intervalId) return;
    logger.info('[WorkflowRuntimeV2Worker] Starting scheduler', { workerId: this.workerId, pollIntervalMs });
    this.intervalId = setInterval(() => {
      this.tick().catch((error) => {
        logger.error('[WorkflowRuntimeV2Worker] Tick error', { workerId: this.workerId, error });
      });
    }, pollIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async tick(): Promise<void> {
    const knex = await getAdminConnection();

    const tickStartedAt = Date.now();
    const expiredStoreRowsDeleted = await this.sweepExpiredWorkflowDataStore(knex);

    // Process due retries
    const retryWaits = await WorkflowRunWaitModelV2.listDueRetries(knex);
    if (this.verbose && retryWaits.length > 0) {
      logger.info('[WorkflowRuntimeV2Worker] Due retries', { workerId: this.workerId, count: retryWaits.length });
    } else {
      logger.debug('[WorkflowRuntimeV2Worker] Due retries', { workerId: this.workerId, count: retryWaits.length });
    }
    for (const wait of retryWaits) {
      const run = await WorkflowRunModelV2.getById(knex, wait.run_id);
      if (!run) {
        await WorkflowRunWaitModelV2.update(knex, wait.wait_id, { status: 'RESOLVED', resolved_at: new Date().toISOString() });
        continue;
      }
      if (run.status === 'CANCELED') {
        await WorkflowRunWaitModelV2.update(knex, wait.wait_id, { status: 'CANCELED', resolved_at: new Date().toISOString() });
        continue;
      }
      if (run.engine === 'temporal') {
        logger.debug('[WorkflowRuntimeV2Worker] Skipping retry wait for Temporal run', {
          workerId: this.workerId,
          waitId: wait.wait_id,
          runId: wait.run_id,
        });
        continue;
      }
      logger.debug('[WorkflowRuntimeV2Worker] Resolving retry wait', {
        workerId: this.workerId,
        waitId: wait.wait_id,
        runId: wait.run_id,
        stepPath: wait.step_path,
      });
      await WorkflowRunWaitModelV2.update(knex, wait.wait_id, { status: 'RESOLVED', resolved_at: new Date().toISOString() });
      await WorkflowRunModelV2.update(knex, wait.run_id, { status: 'RUNNING' });
      await WorkflowRunLogModelV2.create(knex, {
        run_id: run.run_id,
        tenant: run.tenant ?? null,
        step_path: wait.step_path,
        level: 'INFO',
        message: 'Retry wait resolved',
        context_json: { waitId: wait.wait_id },
        source: 'worker'
      });
      logger.debug('[WorkflowRuntimeV2Worker] Executing run (retry)', { workerId: this.workerId, runId: wait.run_id });
      await this.runtime.executeRun(knex, wait.run_id, this.workerId);
    }

    // Process due timeouts
    const timeoutWaits = await WorkflowRunWaitModelV2.listDueTimeouts(knex);
    if (this.verbose && timeoutWaits.length > 0) {
      logger.info('[WorkflowRuntimeV2Worker] Due timeouts', { workerId: this.workerId, count: timeoutWaits.length });
    } else {
      logger.debug('[WorkflowRuntimeV2Worker] Due timeouts', { workerId: this.workerId, count: timeoutWaits.length });
    }
    for (const wait of timeoutWaits) {
      const run = await WorkflowRunModelV2.getById(knex, wait.run_id);
      if (!run) {
        await WorkflowRunWaitModelV2.update(knex, wait.wait_id, { status: 'RESOLVED', resolved_at: new Date().toISOString() });
        continue;
      }
      if (run.status === 'CANCELED') {
        await WorkflowRunWaitModelV2.update(knex, wait.wait_id, { status: 'CANCELED', resolved_at: new Date().toISOString() });
        continue;
      }
      if (run.engine === 'temporal') {
        logger.debug('[WorkflowRuntimeV2Worker] Skipping timeout wait for Temporal run', {
          workerId: this.workerId,
          waitId: wait.wait_id,
          runId: wait.run_id,
          eventName: wait.event_name ?? null,
        });
        continue;
      }
      logger.debug('[WorkflowRuntimeV2Worker] Resolving timeout wait', {
        workerId: this.workerId,
        waitId: wait.wait_id,
        runId: wait.run_id,
        stepPath: wait.step_path,
        eventName: wait.event_name ?? null,
        correlationKey: wait.key ?? null,
        timeoutAt: wait.timeout_at ?? null,
      });
      await WorkflowRunWaitModelV2.update(knex, wait.wait_id, { status: 'RESOLVED', resolved_at: new Date().toISOString() });
      await WorkflowRunModelV2.update(knex, wait.run_id, { status: 'RUNNING', resume_error: { category: 'TimeoutError', message: 'Event wait timeout' } });
      await WorkflowRunLogModelV2.create(knex, {
        run_id: run.run_id,
        tenant: run.tenant ?? null,
        step_path: wait.step_path,
        level: 'WARN',
        message: 'Event wait timed out',
        event_name: wait.event_name ?? null,
        correlation_key: wait.key ?? null,
        context_json: { waitId: wait.wait_id, timeoutAt: wait.timeout_at ?? null },
        source: 'worker'
      });
      logger.debug('[WorkflowRuntimeV2Worker] Executing run (timeout)', { workerId: this.workerId, runId: wait.run_id });
      await this.runtime.executeRun(knex, wait.run_id, this.workerId);
    }

    // Process due time waits
    const timeWaits = await WorkflowRunWaitModelV2.listDueTimeWaits(knex);
    if (this.verbose && timeWaits.length > 0) {
      logger.info('[WorkflowRuntimeV2Worker] Due time waits', { workerId: this.workerId, count: timeWaits.length });
    } else {
      logger.debug('[WorkflowRuntimeV2Worker] Due time waits', { workerId: this.workerId, count: timeWaits.length });
    }
    for (const wait of timeWaits) {
      const run = await WorkflowRunModelV2.getById(knex, wait.run_id);
      if (!run) {
        await WorkflowRunWaitModelV2.update(knex, wait.wait_id, { status: 'RESOLVED', resolved_at: new Date().toISOString() });
        continue;
      }
      if (run.status === 'CANCELED') {
        await WorkflowRunWaitModelV2.update(knex, wait.wait_id, { status: 'CANCELED', resolved_at: new Date().toISOString() });
        continue;
      }
      if (run.engine === 'temporal') {
        logger.debug('[WorkflowRuntimeV2Worker] Skipping time wait for Temporal run', {
          workerId: this.workerId,
          waitId: wait.wait_id,
          runId: wait.run_id,
        });
        continue;
      }
      logger.debug('[WorkflowRuntimeV2Worker] Resolving time wait', {
        workerId: this.workerId,
        waitId: wait.wait_id,
        runId: wait.run_id,
        stepPath: wait.step_path,
        timeoutAt: wait.timeout_at ?? null,
      });
      await WorkflowRunWaitModelV2.update(knex, wait.wait_id, { status: 'RESOLVED', resolved_at: new Date().toISOString() });
      await WorkflowRunModelV2.update(knex, wait.run_id, {
        status: 'RUNNING',
        resume_error: null,
        resume_event_name: 'TIME_WAIT_RESUMED',
        resume_event_payload: wait.payload ?? { dueAt: wait.timeout_at ?? null }
      });
      await WorkflowRunLogModelV2.create(knex, {
        run_id: run.run_id,
        tenant: run.tenant ?? null,
        step_path: wait.step_path,
        level: 'INFO',
        message: 'Time wait resolved',
        context_json: { waitId: wait.wait_id, dueAt: wait.timeout_at ?? null },
        source: 'worker'
      });
      logger.debug('[WorkflowRuntimeV2Worker] Executing run (time wait)', { workerId: this.workerId, runId: wait.run_id });
      await this.runtime.executeRun(knex, wait.run_id, this.workerId);
    }

    // Process runnable runs
    let runnableCount = 0;
    while (true) {
      const runId = await this.runtime.acquireRunnableRun(knex, this.workerId);
      if (!runId) break;
      runnableCount += 1;
      logger.debug('[WorkflowRuntimeV2Worker] Executing run (acquired)', { workerId: this.workerId, runId });
      await this.runtime.executeRun(knex, runId, this.workerId);
    }

    logger.debug('[WorkflowRuntimeV2Worker] Tick complete', {
      workerId: this.workerId,
      dueRetries: retryWaits.length,
      dueTimeouts: timeoutWaits.length,
      dueTimeWaits: timeWaits.length,
      acquiredRuns: runnableCount,
      expiredStoreRowsDeleted,
      durationMs: Date.now() - tickStartedAt,
    });
  }

  private async sweepExpiredWorkflowDataStore(knex: Awaited<ReturnType<typeof getAdminConnection>>): Promise<number> {
    const now = Date.now();
    if (now - this.lastStoreExpirySweepAt < this.storeExpirySweepIntervalMs) {
      return 0;
    }
    this.lastStoreExpirySweepAt = now;

    try {
      const tenants = await knex('workflow_data_store')
        .whereNotNull('expires_at')
        .andWhere('expires_at', '<=', new Date(now).toISOString())
        .distinct<{ tenant: string }[]>('tenant')
        .limit(this.storeExpirySweepTenantLimit);

      let deleted = 0;
      for (const row of tenants) {
        deleted += await WorkflowDataStoreModel.deleteExpired(knex, row.tenant, this.storeExpirySweepBatchSize);
      }

      if (deleted > 0) {
        logger.info('[WorkflowRuntimeV2Worker] Deleted expired workflow data-store rows', {
          workerId: this.workerId,
          tenantCount: tenants.length,
          deleted,
        });
      } else {
        logger.debug('[WorkflowRuntimeV2Worker] Expired workflow data-store sweep complete', {
          workerId: this.workerId,
          tenantCount: tenants.length,
          deleted,
        });
      }

      return deleted;
    } catch (error) {
      logger.warn('[WorkflowRuntimeV2Worker] Expired workflow data-store sweep failed', {
        workerId: this.workerId,
        error,
      });
      return 0;
    }
  }
}
