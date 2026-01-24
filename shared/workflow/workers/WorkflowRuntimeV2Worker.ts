import { getAdminConnection } from '@alga-psa/db/admin';
import logger from '@alga-psa/core/logger';
import { WorkflowRuntimeV2 } from '../runtime';
import WorkflowRunWaitModelV2 from '../persistence/workflowRunWaitModelV2';
import WorkflowRunModelV2 from '../persistence/workflowRunModelV2';
import WorkflowRunLogModelV2 from '../persistence/workflowRunLogModelV2';

export class WorkflowRuntimeV2Worker {
  private intervalId: NodeJS.Timeout | null = null;
  private readonly runtime: WorkflowRuntimeV2;
  private readonly workerId: string;
  private readonly verbose: boolean;

  constructor(workerId: string) {
    this.workerId = workerId;
    this.verbose =
      process.env.WORKFLOW_WORKER_VERBOSE === 'true' ||
      process.env.WORKFLOW_WORKER_VERBOSE === '1' ||
      process.env.WORKFLOW_WORKER_VERBOSE === 'yes';
    this.runtime = new WorkflowRuntimeV2();
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
        tenant_id: run.tenant_id ?? null,
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
        tenant_id: run.tenant_id ?? null,
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
      acquiredRuns: runnableCount,
      durationMs: Date.now() - tickStartedAt,
    });
  }
}
