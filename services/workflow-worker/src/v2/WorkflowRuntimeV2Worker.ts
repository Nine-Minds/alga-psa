import { getAdminConnection } from '@shared/db/admin';
import logger from '@shared/core/logger';
import { WorkflowRuntimeV2 } from '@shared/workflow/runtime';
import WorkflowRunWaitModelV2 from '@shared/workflow/persistence/workflowRunWaitModelV2';
import WorkflowRunModelV2 from '@shared/workflow/persistence/workflowRunModelV2';
import WorkflowRunLogModelV2 from '@shared/workflow/persistence/workflowRunLogModelV2';

export class WorkflowRuntimeV2Worker {
  private intervalId: NodeJS.Timeout | null = null;
  private readonly runtime: WorkflowRuntimeV2;
  private readonly workerId: string;

  constructor(workerId: string) {
    this.workerId = workerId;
    this.runtime = new WorkflowRuntimeV2();
  }

  async start(pollIntervalMs = 5000): Promise<void> {
    if (this.intervalId) return;
    logger.info('[WorkflowRuntimeV2Worker] Starting scheduler');
    this.intervalId = setInterval(() => {
      this.tick().catch((error) => {
        logger.error('[WorkflowRuntimeV2Worker] Tick error', error);
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

    // Process due retries
    const retryWaits = await WorkflowRunWaitModelV2.listDueRetries(knex);
    for (const wait of retryWaits) {
      await WorkflowRunWaitModelV2.update(knex, wait.wait_id, { status: 'RESOLVED', resolved_at: new Date().toISOString() });
      await WorkflowRunModelV2.update(knex, wait.run_id, { status: 'RUNNING' });
      const run = await WorkflowRunModelV2.getById(knex, wait.run_id);
      if (run) {
        await WorkflowRunLogModelV2.create(knex, {
          run_id: run.run_id,
          tenant_id: run.tenant_id ?? null,
          step_path: wait.step_path,
          level: 'INFO',
          message: 'Retry wait resolved',
          context_json: { waitId: wait.wait_id },
          source: 'worker'
        });
      }
      await this.runtime.executeRun(knex, wait.run_id, this.workerId);
    }

    // Process due timeouts
    const timeoutWaits = await WorkflowRunWaitModelV2.listDueTimeouts(knex);
    for (const wait of timeoutWaits) {
      await WorkflowRunWaitModelV2.update(knex, wait.wait_id, { status: 'RESOLVED', resolved_at: new Date().toISOString() });
      await WorkflowRunModelV2.update(knex, wait.run_id, { status: 'RUNNING', resume_error: { category: 'TimeoutError', message: 'Event wait timeout' } });
      const run = await WorkflowRunModelV2.getById(knex, wait.run_id);
      if (run) {
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
      }
      await this.runtime.executeRun(knex, wait.run_id, this.workerId);
    }

    // Process runnable runs
    while (true) {
      const runId = await this.runtime.acquireRunnableRun(knex, this.workerId);
      if (!runId) break;
      await this.runtime.executeRun(knex, runId, this.workerId);
    }
  }
}
