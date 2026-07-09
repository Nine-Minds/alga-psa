import { createLogger, format, transports } from 'winston';
import { tenantDb } from '@alga-psa/db';
import { getAdminConnection, withAdminTransactionRetryReadOnly } from '@alga-psa/db/admin.js';
import type { Knex } from 'knex';
import {
  workflowOneTimeScheduledRunHandler,
  workflowRecurringScheduledRunHandler,
} from '@alga-psa/jobs/handlers/workflowScheduledRunHandlers';
import {
  WORKFLOW_ONE_TIME_TRIGGER_JOB,
  WORKFLOW_RECURRING_TRIGGER_JOB,
} from '@alga-psa/workflows/lib/workflowScheduleLifecycle';
import type { JobStatus } from '../types/job.js';
import { registerJobRunnerAccessor } from '@alga-psa/jobs/runner';
import { TemporalJobRunner } from '@alga-psa/jobs/runners/TemporalJobRunner';
import { extensionScheduledInvocationHandler } from '@alga-psa/jobs/handlers/extensionScheduledInvocationHandler';
import { publishEvent } from '@alga-psa/event-bus/publishers';

// rmm/huntress poll + accounting-sync-cycle handlers import src-consumed vertical
// packages (@alga-psa/integrations, @alga-psa/billing) the plain-Node-ESM worker
// cannot load. They run server-side: the worker forwards a MAINTENANCE_JOB_REQUESTED
// event (with the original jobId + data) and a server subscriber runs the registered
// handler (registerAllHandlers). Job-name constants are inlined here because importing
// them would pull the unresolvable handler module back into the worker's static graph.
const RMM_ALERT_RECONCILIATION_JOB = 'rmm-alert-reconciliation';
const HUNTRESS_INCIDENT_POLL_JOB = 'huntress-incident-poll';
const ACCOUNTING_SYNC_CYCLE_JOB = 'accounting-sync-cycle';
const HUDU_AUTO_SYNC_JOB = 'hudu-auto-sync';
const SYSTEM_TENANT_ID = '00000000-0000-0000-0000-000000000000';

// Configure logger
const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.json()
  ),
  transports: [
    new transports.Console({
      format: format.combine(format.colorize(), format.simple()),
    }),
  ],
});

type JobHandler = (
  jobId: string,
  data: Record<string, unknown>
) => Promise<void | Record<string, unknown>>;

const jobHandlers = new Map<string, JobHandler>();
let jobHandlersInitialized = false;

async function runWithTenant<T>(
  tenantId: string,
  callback: (trx: Knex.Transaction) => Promise<T>
): Promise<T> {
  return withAdminTransactionRetryReadOnly(async (trx) => {
    await trx.raw(`SELECT set_config('app.current_tenant', ?, true)`, [tenantId]);
    return callback(trx);
  });
}

/**
 * Initialize the job handler registry for Temporal worker
 *
 * This should be called during worker startup to populate the registry
 * with all available job handlers before any workflows are executed.
 */
export async function initializeJobHandlersForWorker(): Promise<void> {
  if (jobHandlersInitialized) {
    logger.info('Job handler registry already initialized');
    return;
  }

  // Provide a Temporal job runner to shared handlers that schedule follow-up
  // jobs. The worker registers the Temporal runner directly so shared handlers
  // (e.g. RMM polling) stay decoupled from the server-bound JobRunnerFactory.
  registerJobRunnerAccessor(async () => TemporalJobRunner.create({
    address: process.env.TEMPORAL_ADDRESS || 'temporal-frontend.temporal.svc.cluster.local:7233',
    namespace: process.env.TEMPORAL_NAMESPACE || 'default',
    taskQueue: process.env.TEMPORAL_JOB_TASK_QUEUE || 'alga-jobs',
  }) as any);

  // Register EE extension schedule invocation handler so Temporal can execute
  // extension cron jobs on the shared alga-jobs queue.
  try {
    registerJobHandlerForActivities(
      'extension-scheduled-invocation',
      async (jobId, data) => {
        await extensionScheduledInvocationHandler(jobId, data as any);
      }
    );
  } catch (error) {
    logger.error('Failed to register extension scheduled invocation handler', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  // RMM/Huntress polling: in EE these recurring jobs arrive as Temporal Schedules
  // that start genericJobWorkflow, which executes whatever is registered here. The
  // handlers import the src-consumed @alga-psa/integrations vertical, which the
  // plain-Node-ESM worker cannot load, so they run server-side: forward the job to
  // the server (which has them registered via registerAllHandlers) over the event
  // bus and let a subscriber execute the real handler for the tenant.
  const forwardJobToServer = (jobName: string) =>
    async (jobId: string, data: Record<string, unknown>) => {
      await publishEvent({
        eventType: 'MAINTENANCE_JOB_REQUESTED',
        payload: {
          tenantId: (data?.tenantId as string) ?? SYSTEM_TENANT_ID,
          occurredAt: new Date().toISOString(),
          jobName,
          jobId,
          data: data ?? {},
        },
      });
    };
  registerJobHandlerForActivities(RMM_ALERT_RECONCILIATION_JOB, forwardJobToServer(RMM_ALERT_RECONCILIATION_JOB));
  registerJobHandlerForActivities(HUNTRESS_INCIDENT_POLL_JOB, forwardJobToServer(HUNTRESS_INCIDENT_POLL_JOB));
  registerJobHandlerForActivities(ACCOUNTING_SYNC_CYCLE_JOB, forwardJobToServer(ACCOUNTING_SYNC_CYCLE_JOB));
  registerJobHandlerForActivities(HUDU_AUTO_SYNC_JOB, forwardJobToServer(HUDU_AUTO_SYNC_JOB));
  // Teams meeting Graph cleanup (cancel/decline): the handler imports
  // src-consumed vertical packages (@alga-psa/clients + EE Teams lib), so the
  // worker forwards it to the server like the polling jobs above. The
  // recurring sweep-teams-online-meetings maintenance job re-attempts any
  // cancel_pending rows if a forwarded run is lost.
  registerJobHandlerForActivities('teams-meeting-cleanup', forwardJobToServer('teams-meeting-cleanup'));

  // User-defined workflow schedules: after the pg-boss → Temporal cutover these
  // arrive as Temporal Schedules (TemporalJobRunner.scheduleJobAt /
  // scheduleRecurringJob) that start genericJobWorkflow with jobName
  // workflow-time-trigger-{once,recurring}. The handler code and trigger-name
  // constants are shared via @alga-psa/jobs and @alga-psa/workflows (no server
  // dependency), so they are imported statically at module load.
  try {
    registerJobHandlerForActivities(WORKFLOW_ONE_TIME_TRIGGER_JOB, async (jobId, data) => {
      await workflowOneTimeScheduledRunHandler(jobId, data as any);
    });
    registerJobHandlerForActivities(WORKFLOW_RECURRING_TRIGGER_JOB, async (jobId, data) => {
      await workflowRecurringScheduledRunHandler(jobId, data as any);
    });
  } catch (error) {
    logger.error('Failed to register workflow schedule handlers', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  jobHandlersInitialized = true;
  logger.info('Initialized job handler registry for Temporal worker', {
    handlerCount: jobHandlers.size,
    handlers: Array.from(jobHandlers.keys()),
  });
}

/**
 * Legacy function for backwards compatibility
 * @deprecated Use registerAllJobHandlers instead
 */
export function registerJobHandlerForActivities(
  jobName: string,
  handler: JobHandler
): void {
  jobHandlers.set(jobName, handler);
  logger.info(`Registered job handler for Temporal activities: ${jobName}`);
}

/**
 * Execute a job handler activity
 *
 * This activity looks up the registered handler from the centralized
 * JobHandlerRegistry and executes it with the provided data.
 */
export async function executeJobHandler(input: {
  jobId: string;
  jobName: string;
  tenantId: string;
  jobExecutionId: string;
  data: Record<string, unknown>;
}): Promise<{ success: boolean; error?: string; result?: Record<string, unknown> }> {
  const { jobId, jobName, tenantId, jobExecutionId, data } = input;

  logger.info('Executing job handler activity', { jobId, jobName, tenantId });

  // Ensure handlers are initialized
  if (!jobHandlersInitialized) {
    logger.warn('Job handler registry not initialized, initializing now');
    await initializeJobHandlersForWorker();
  }

  const handler = jobHandlers.get(jobName);
  if (!handler) {
    const error = `No handler registered for job type: ${jobName}`;
    logger.error(error, {
      jobId,
      jobName,
      availableHandlers: Array.from(jobHandlers.keys()),
    });
    return { success: false, error };
  }

  try {
    const result = await runWithTenant(tenantId, async () => {
      const maybeResult = await handler(jobId, {
        ...data,
        tenantId,
        jobExecutionId,
      });
      if (maybeResult && typeof maybeResult === 'object') {
        return maybeResult as Record<string, unknown>;
      }
      return undefined;
    });

    logger.info('Job handler executed successfully', { jobId, jobName });
    return { success: true, ...(result ? { result } : {}) };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Job handler failed', {
      jobId,
      jobName,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return { success: false, error: errorMessage };
  }
}

/**
 * Update job status activity
 *
 * Updates the status of a job in the database.
 */
export async function updateJobStatus(input: {
  jobId: string;
  tenantId: string;
  status: JobStatus;
  error?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { jobId, tenantId, status, error, metadata } = input;

  logger.debug('Updating job status', { jobId, tenantId, status });

  await runWithTenant(tenantId, async (trx) => {
    const db = tenantDb(trx, tenantId);
    // Get current metadata
    const currentJob = await db.table('jobs')
      .where({ job_id: jobId })
      .first('metadata');

    const currentMetadata = currentJob?.metadata
      ? typeof currentJob.metadata === 'string'
        ? JSON.parse(currentJob.metadata)
        : currentJob.metadata
      : {};

    // A recurring schedule reuses one jobs row as its per-fire tracker; a
    // terminal status would make it invisible to schedule reconcilers, which
    // then re-schedule on every pass. pg-boss returns tracker rows to queued
    // after each run — keep parity, and record the run outcome in metadata.
    const isRecurringTracker = Boolean(currentMetadata?.recurring);
    const isTerminal = status === 'completed' || status === 'failed';
    const effectiveStatus = isRecurringTracker && isTerminal ? 'queued' : status;

    // Merge metadata
    const updatedMetadata = {
      ...currentMetadata,
      ...metadata,
      ...(error ? { error } : {}),
      ...(isRecurringTracker && isTerminal
        ? { lastRunStatus: status, lastRunAt: new Date().toISOString() }
        : {}),
    };

    // Update job record
    await db.table('jobs')
      .where({ job_id: jobId })
      .update({
        status: effectiveStatus,
        metadata: JSON.stringify(updatedMetadata),
        updated_at: new Date(),
      });
  });

  logger.debug('Job status updated', { jobId, status });
}

/**
 * Create job detail activity
 *
 * Creates a job detail record for step tracking.
 */
export async function createJobDetail(input: {
  jobId: string;
  tenantId: string;
  stepName: string;
  status: JobStatus;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  const { jobId, tenantId, stepName, status, metadata } = input;

  logger.debug('Creating job detail', { jobId, tenantId, stepName, status });

  const detailId = await runWithTenant(tenantId, async (trx) => {
    const [row] = await tenantDb(trx, tenantId).table('job_details')
      .insert({
        tenant: tenantId,
        job_id: jobId,
        step_name: stepName,
        status,
        result: metadata ? JSON.stringify(metadata) : null,
        processed_at: status === 'pending' ? null : new Date(),
        retry_count: 0,
        updated_at: new Date(),
      })
      .returning<{ detail_id: string }[]>('detail_id');

    return row?.detail_id;
  });

  if (!detailId) {
    throw new Error('Failed to create job detail record');
  }

  logger.debug('Job detail created', { jobId, detailId, stepName });
  return detailId;
}

/**
 * Get job data activity
 *
 * Retrieves the full job data from the database.
 */
export async function getJobData(input: {
  jobId: string;
  tenantId: string;
}): Promise<{
  jobId: string;
  type: string;
  status: JobStatus;
  metadata: Record<string, unknown>;
  createdAt: Date;
} | null> {
  const { jobId, tenantId } = input;

  return runWithTenant(tenantId, async (trx) => {
    const job = await tenantDb(trx, tenantId).table('jobs')
      .where({ job_id: jobId })
      .first();

    if (!job) {
      return null;
    }

    return {
      jobId: job.job_id,
      type: job.type,
      status: job.status as JobStatus,
      metadata: job.metadata
        ? typeof job.metadata === 'string'
          ? JSON.parse(job.metadata)
          : job.metadata
        : {},
      createdAt: job.created_at,
    };
  });
}

/**
 * Export all job activities
 */
export const jobActivities = {
  executeJobHandler,
  updateJobStatus,
  createJobDetail,
  getJobData,
};
