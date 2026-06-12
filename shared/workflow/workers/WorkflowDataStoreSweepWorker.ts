import { getAdminConnection } from '@alga-psa/db/admin';
import logger from '@alga-psa/core/logger';
import { env } from 'process';
import WorkflowDataStoreModel from '../persistence/workflowDataStoreModel';

const DEFAULT_STORE_EXPIRY_SWEEP_INTERVAL_MS = 60_000;
const DEFAULT_STORE_EXPIRY_SWEEP_TENANT_LIMIT = 50;
const DEFAULT_STORE_EXPIRY_SWEEP_BATCH_SIZE = 1000;

const readPositiveIntEnv = (name: string, fallback: number): number => {
  const parsed = Number(env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
};

export class WorkflowDataStoreSweepWorker {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private readonly workerId: string;
  private readonly sweepIntervalMs: number;
  private readonly tenantLimit: number;
  private readonly batchSize: number;

  constructor(workerId: string) {
    this.workerId = workerId;
    this.sweepIntervalMs = readPositiveIntEnv(
      'WORKFLOW_STORE_EXPIRY_SWEEP_INTERVAL_MS',
      DEFAULT_STORE_EXPIRY_SWEEP_INTERVAL_MS
    );
    this.tenantLimit = readPositiveIntEnv(
      'WORKFLOW_STORE_EXPIRY_SWEEP_TENANT_LIMIT',
      DEFAULT_STORE_EXPIRY_SWEEP_TENANT_LIMIT
    );
    this.batchSize = readPositiveIntEnv(
      'WORKFLOW_STORE_EXPIRY_SWEEP_BATCH_SIZE',
      DEFAULT_STORE_EXPIRY_SWEEP_BATCH_SIZE
    );
  }

  async start(): Promise<void> {
    if (this.intervalId) return;
    logger.info('[WorkflowDataStoreSweepWorker] Starting sweep', {
      workerId: this.workerId,
      sweepIntervalMs: this.sweepIntervalMs,
    });
    this.intervalId = setInterval(() => {
      this.sweep().catch((error) => {
        logger.warn('[WorkflowDataStoreSweepWorker] Sweep error', { workerId: this.workerId, error });
      });
    }, this.sweepIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async sweep(): Promise<number> {
    const knex = await getAdminConnection();

    try {
      const tenants = await knex('workflow_data_store')
        .whereNotNull('expires_at')
        .andWhere('expires_at', '<=', new Date().toISOString())
        .distinct<{ tenant: string }[]>('tenant')
        .limit(this.tenantLimit);

      let deleted = 0;
      for (const row of tenants) {
        deleted += await WorkflowDataStoreModel.deleteExpired(knex, row.tenant, this.batchSize);
      }

      if (deleted > 0) {
        logger.info('[WorkflowDataStoreSweepWorker] Deleted expired workflow data-store rows', {
          workerId: this.workerId,
          tenantCount: tenants.length,
          deleted,
        });
      } else {
        logger.debug('[WorkflowDataStoreSweepWorker] Expired workflow data-store sweep complete', {
          workerId: this.workerId,
          tenantCount: tenants.length,
          deleted,
        });
      }

      return deleted;
    } catch (error) {
      logger.warn('[WorkflowDataStoreSweepWorker] Expired workflow data-store sweep failed', {
        workerId: this.workerId,
        error,
      });
      return 0;
    }
  }
}
