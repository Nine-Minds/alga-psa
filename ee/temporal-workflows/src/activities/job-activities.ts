import { createLogger, format, transports } from 'winston';
import { JobStatus } from 'server/src/types/job';
import { JobService } from 'server/src/services/job.service';
import { createTenantKnex, runWithTenant } from 'server/src/lib/db';
import { JobHandlerRegistry } from 'server/src/lib/jobs/jobHandlerRegistry';
import { registerAllJobHandlers } from 'server/src/lib/jobs/registerAllHandlers';

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

/**
 * Initialize the job handler registry for Temporal worker
 *
 * This should be called during worker startup to populate the registry
 * with all available job handlers before any workflows are executed.
 */
export async function initializeJobHandlersForWorker(): Promise<void> {
  if (JobHandlerRegistry.isInitialized()) {
    logger.info('Job handler registry already initialized');
    return;
  }

  logger.info('Initializing job handler registry for Temporal worker');
  await registerAllJobHandlers({
    includeEnterprise: true, // Worker always runs in EE context
  });
}

/**
 * Legacy function for backwards compatibility
 * @deprecated Use registerAllJobHandlers instead
 */
export function registerJobHandlerForActivities(
  jobName: string,
  handler: (jobId: string, data: Record<string, unknown>) => Promise<void>
): void {
  JobHandlerRegistry.register({
    name: jobName,
    handler,
  });
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
  data: Record<string, unknown>;
}): Promise<{ success: boolean; error?: string; result?: Record<string, unknown> }> {
  const { jobId, jobName, tenantId, data } = input;

  logger.info('Executing job handler activity', { jobId, jobName, tenantId });

  // Ensure handlers are initialized
  if (!JobHandlerRegistry.isInitialized()) {
    logger.warn('Job handler registry not initialized, initializing now');
    await initializeJobHandlersForWorker();
  }

  if (!JobHandlerRegistry.has(jobName)) {
    const error = `No handler registered for job type: ${jobName}`;
    logger.error(error, { jobId, jobName, availableHandlers: JobHandlerRegistry.getRegisteredNames() });
    return { success: false, error };
  }

  try {
    // Execute the handler within the tenant context using the centralized registry
    await runWithTenant(tenantId, async () => {
      await JobHandlerRegistry.execute(jobName, jobId, { ...data, tenantId });
    });

    logger.info('Job handler executed successfully', { jobId, jobName });
    return { success: true };
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

  await runWithTenant(tenantId, async () => {
    const { knex } = await createTenantKnex();

    // Get current metadata
    const currentJob = await knex('jobs')
      .where({ job_id: jobId, tenant: tenantId })
      .first('metadata');

    const currentMetadata = currentJob?.metadata
      ? typeof currentJob.metadata === 'string'
        ? JSON.parse(currentJob.metadata)
        : currentJob.metadata
      : {};

    // Merge metadata
    const updatedMetadata = {
      ...currentMetadata,
      ...metadata,
      ...(error ? { error } : {}),
    };

    // Update job record
    await knex('jobs')
      .where({ job_id: jobId, tenant: tenantId })
      .update({
        status,
        metadata: JSON.stringify(updatedMetadata),
        updated_at: new Date(),
        ...(status === JobStatus.Processing ? { processed_at: new Date() } : {}),
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
  status: string;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  const { jobId, tenantId, stepName, status, metadata } = input;

  logger.debug('Creating job detail', { jobId, tenantId, stepName, status });

  const detailId = await runWithTenant(tenantId, async () => {
    const jobService = await JobService.create();
    return jobService.createJobDetail(
      jobId,
      stepName,
      status as 'pending' | 'processing' | 'completed' | 'failed',
      metadata
    );
  });

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

  return runWithTenant(tenantId, async () => {
    const { knex } = await createTenantKnex();

    const job = await knex('jobs')
      .where({ job_id: jobId, tenant: tenantId })
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
