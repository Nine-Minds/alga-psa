import { Client, Connection, WorkflowHandle } from '@temporalio/client';
import { Duration } from '@temporalio/common';
import logger from '@shared/core/logger';
import { JobStatus } from 'server/src/types/job';
import { createTenantKnex, runWithTenant } from 'server/src/lib/db';
import {
  IJobRunner,
  JobHandlerConfig,
  ScheduleJobOptions,
  ScheduleJobResult,
  JobStatusInfo,
  BaseJobData,
  TemporalConfig,
} from 'server/src/lib/jobs/interfaces';

/**
 * Temporal implementation of the IJobRunner interface
 *
 * This class provides the Enterprise Edition job runner that uses
 * Temporal for workflow orchestration. Jobs are converted to Temporal
 * workflows, providing durability, observability, and advanced features
 * like signals and queries.
 */
export class TemporalJobRunner implements IJobRunner {
  private static instance: TemporalJobRunner | null = null;
  private client: Client;
  private config: Required<TemporalConfig>;
  private handlers: Map<string, JobHandlerConfig<any>> = new Map();
  private isRunning: boolean = false;

  private constructor(client: Client, config: Required<TemporalConfig>) {
    this.client = client;
    this.config = config;
  }

  /**
   * Create a new TemporalJobRunner instance
   */
  public static async create(config?: TemporalConfig): Promise<TemporalJobRunner> {
    if (TemporalJobRunner.instance) {
      return TemporalJobRunner.instance;
    }

    const finalConfig: Required<TemporalConfig> = {
      address: config?.address || process.env.TEMPORAL_ADDRESS || 'localhost:7233',
      namespace: config?.namespace || process.env.TEMPORAL_NAMESPACE || 'default',
      taskQueue: config?.taskQueue || process.env.TEMPORAL_JOB_TASK_QUEUE || 'alga-jobs',
      tls: config?.tls ?? false,
      clientCert: config?.clientCert || '',
      clientKey: config?.clientKey || '',
    };

    logger.info('Initializing TemporalJobRunner', {
      address: finalConfig.address,
      namespace: finalConfig.namespace,
      taskQueue: finalConfig.taskQueue,
    });

    try {
      const connection = await Connection.connect({
        address: finalConfig.address,
        tls: finalConfig.tls
          ? {
              clientCertPair: {
                crt: Buffer.from(finalConfig.clientCert),
                key: Buffer.from(finalConfig.clientKey),
              },
            }
          : undefined,
      });

      const client = new Client({
        connection,
        namespace: finalConfig.namespace,
      });

      TemporalJobRunner.instance = new TemporalJobRunner(client, finalConfig);

      logger.info('TemporalJobRunner initialized successfully');

      return TemporalJobRunner.instance;
    } catch (error) {
      logger.error('Failed to initialize TemporalJobRunner:', error);
      throw error;
    }
  }

  /**
   * Get the singleton instance (throws if not initialized)
   */
  public static getInstance(): TemporalJobRunner {
    if (!TemporalJobRunner.instance) {
      throw new Error(
        'TemporalJobRunner not initialized. Call TemporalJobRunner.create() first.'
      );
    }
    return TemporalJobRunner.instance;
  }

  /**
   * Reset the singleton instance (for testing)
   */
  public static reset(): void {
    TemporalJobRunner.instance = null;
  }

  getRunnerType(): 'pgboss' | 'temporal' {
    return 'temporal';
  }

  registerHandler<T extends BaseJobData>(config: JobHandlerConfig<T>): void {
    if (this.handlers.has(config.name)) {
      logger.warn(`Job handler ${config.name} is already registered, replacing`);
    }

    this.handlers.set(config.name, config);
    logger.info(`Registered job handler: ${config.name}`);

    // Note: In Temporal, handlers are executed by the worker, not registered here.
    // The handler config is stored for reference and will be used by the generic
    // job workflow activities.
  }

  /**
   * Check if a handler is registered for a job type
   */
  hasHandler(jobName: string): boolean {
    return this.handlers.has(jobName);
  }

  async scheduleJob<T extends BaseJobData>(
    jobName: string,
    data: T,
    options?: ScheduleJobOptions
  ): Promise<ScheduleJobResult> {
    if (!data.tenantId) {
      throw new Error('tenantId is required in job data');
    }

    // Validate handler exists (handlers are registered in the worker, but we track them here too)
    if (!this.handlers.has(jobName)) {
      logger.warn(
        `No handler registered locally for job type: ${jobName}. Ensure the Temporal worker has the handler registered.`
      );
    }

    // Create job record in database
    const jobRecord = await this.createJobRecord(jobName, data, options);

    // Generate workflow ID
    const workflowId = `job-${jobName}-${jobRecord.jobId}`;

    try {
      // Start the generic job workflow
      const handle = await this.client.workflow.start('genericJobWorkflow', {
        args: [
          {
            jobId: jobRecord.jobId,
            jobName,
            tenantId: data.tenantId,
            data,
          },
        ],
        taskQueue: this.config.taskQueue,
        workflowId,
        workflowExecutionTimeout: '1h',
      });

      // Update job record with external IDs
      await this.updateJobExternalIds(
        jobRecord.jobId,
        handle.workflowId,
        handle.firstExecutionRunId,
        data.tenantId
      );

      logger.debug('Scheduled job as Temporal workflow', {
        jobId: jobRecord.jobId,
        workflowId: handle.workflowId,
        jobName,
      });

      return {
        jobId: jobRecord.jobId,
        externalId: handle.workflowId,
      };
    } catch (error) {
      // Update job as failed
      await this.updateJobStatus(jobRecord.jobId, data.tenantId, JobStatus.Failed, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async scheduleJobAt<T extends BaseJobData>(
    jobName: string,
    data: T,
    runAt: Date,
    options?: ScheduleJobOptions
  ): Promise<ScheduleJobResult> {
    if (!data.tenantId) {
      throw new Error('tenantId is required in job data');
    }

    // Calculate delay
    const delayMs = Math.max(0, runAt.getTime() - Date.now());

    // Create job record in database
    const jobRecord = await this.createJobRecord(jobName, data, {
      ...options,
      runAt,
      metadata: {
        ...options?.metadata,
        scheduledFor: runAt.toISOString(),
      },
    });

    // Generate workflow ID
    const workflowId = `job-${jobName}-${jobRecord.jobId}`;

    try {
      // Start the generic job workflow with start delay
      const handle = await this.client.workflow.start('genericJobWorkflow', {
        args: [
          {
            jobId: jobRecord.jobId,
            jobName,
            tenantId: data.tenantId,
            data,
          },
        ],
        taskQueue: this.config.taskQueue,
        workflowId,
        workflowExecutionTimeout: '1h',
        startDelay: `${delayMs}ms`,
      });

      // Update job record with external IDs
      await this.updateJobExternalIds(
        jobRecord.jobId,
        handle.workflowId,
        handle.firstExecutionRunId,
        data.tenantId
      );

      logger.debug('Scheduled delayed job as Temporal workflow', {
        jobId: jobRecord.jobId,
        workflowId: handle.workflowId,
        jobName,
        runAt: runAt.toISOString(),
      });

      return {
        jobId: jobRecord.jobId,
        externalId: handle.workflowId,
      };
    } catch (error) {
      await this.updateJobStatus(jobRecord.jobId, data.tenantId, JobStatus.Failed, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async scheduleRecurringJob<T extends BaseJobData>(
    jobName: string,
    data: T,
    interval: string,
    options?: ScheduleJobOptions
  ): Promise<ScheduleJobResult> {
    if (!data.tenantId) {
      throw new Error('tenantId is required in job data');
    }

    // For recurring jobs, we use Temporal schedules
    const scheduleId =
      options?.singletonKey ?? `recurring-${jobName}-${data.tenantId}`;

    // Create job record in database
    const jobRecord = await this.createJobRecord(jobName, data, {
      ...options,
      singletonKey: scheduleId,
      metadata: {
        ...options?.metadata,
        recurring: true,
        interval,
      },
    });

    try {
      // Check if schedule already exists
      try {
        const existingHandle = this.client.schedule.getHandle(scheduleId);
        await existingHandle.describe();
        // Schedule exists, return existing
        logger.info('Recurring job schedule already exists', {
          scheduleId,
          jobName,
        });
        return {
          jobId: jobRecord.jobId,
          externalId: scheduleId,
        };
      } catch {
        // Schedule doesn't exist, create it
      }

      // Create a new schedule
      const scheduleSpec = this.parseScheduleSpec(interval);
      const timezoneName = (options?.metadata as any)?.timezone;
      const spec: any = { ...scheduleSpec };
      if (timezoneName && typeof timezoneName === 'string') {
        // Temporal supports schedule timezones via `timezoneName` on spec.
        spec.timezoneName = timezoneName;
      }
      await this.client.schedule.create({
        scheduleId,
        spec,
        action: {
          type: 'startWorkflow',
          workflowType: 'genericJobWorkflow',
          args: [
            {
              jobId: jobRecord.jobId,
              jobName,
              tenantId: data.tenantId,
              data,
            },
          ],
          taskQueue: this.config.taskQueue,
          workflowExecutionTimeout: '1h',
        },
      });

      // Update job record
      await this.updateJobExternalIds(
        jobRecord.jobId,
        scheduleId,
        null,
        data.tenantId
      );

      logger.debug('Created recurring job schedule', {
        jobId: jobRecord.jobId,
        scheduleId,
        jobName,
        interval,
      });

      return {
        jobId: jobRecord.jobId,
        externalId: scheduleId,
      };
    } catch (error) {
      await this.updateJobStatus(jobRecord.jobId, data.tenantId, JobStatus.Failed, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async cancelJob(jobId: string, tenantId: string): Promise<boolean> {
    try {
      // Get the external ID from our database
      const { knex } = await createTenantKnex();
      const job = await runWithTenant(tenantId, async () => {
        return knex('jobs')
          .where({ job_id: jobId, tenant: tenantId })
          .first('external_id', 'status', 'metadata');
      });

      if (!job) {
        logger.warn(`Job not found for cancellation: ${jobId}`);
        return false;
      }

      // If job is already completed or failed, cannot cancel
      if (
        job.status === JobStatus.Completed ||
        job.status === JobStatus.Failed
      ) {
        logger.warn(`Cannot cancel job in status: ${job.status}`);
        return false;
      }

      if (job.external_id) {
        const metadata = job.metadata
          ? typeof job.metadata === 'string'
            ? JSON.parse(job.metadata)
            : job.metadata
          : {};

        if (metadata.recurring) {
          // Cancel schedule
          try {
            const scheduleHandle = this.client.schedule.getHandle(job.external_id);
            await scheduleHandle.delete();
          } catch (error) {
            logger.warn('Failed to delete schedule:', error);
          }
        } else {
          // Cancel workflow
          try {
            const workflowHandle = this.client.workflow.getHandle(job.external_id);
            await workflowHandle.cancel();
          } catch (error) {
            logger.warn('Failed to cancel workflow:', error);
          }
        }
      }

      // Update our database
      await this.updateJobStatus(jobId, tenantId, JobStatus.Failed, {
        error: 'Job cancelled by user',
      });

      return true;
    } catch (error) {
      logger.error('Failed to cancel job:', error);
      return false;
    }
  }

  async getJobStatus(
    jobId: string,
    tenantId: string
  ): Promise<JobStatusInfo | null> {
    try {
      const { knex } = await createTenantKnex();
      const job = await runWithTenant(tenantId, async () => {
        return knex('jobs')
          .where({ job_id: jobId, tenant: tenantId })
          .first();
      });

      if (!job) {
        return null;
      }

      const metadata = job.metadata
        ? typeof job.metadata === 'string'
          ? JSON.parse(job.metadata)
          : job.metadata
        : {};

      // Optionally query Temporal for real-time status
      if (job.external_id && !metadata.recurring) {
        try {
          const handle = this.client.workflow.getHandle(job.external_id);
          const description = await handle.describe();

          // Map Temporal status to our status
          const temporalStatus = this.mapTemporalStatus(description.status.name);
          if (temporalStatus !== job.status) {
            // Update database with latest status
            await this.updateJobStatus(jobId, tenantId, temporalStatus);
          }
        } catch {
          // Workflow may not exist anymore, use database status
        }
      }

      return {
        status: job.status as JobStatus,
        progress: metadata.progress,
        error: metadata.error,
        metadata,
        createdAt: job.created_at,
        startedAt: job.processed_at,
        completedAt:
          job.status === JobStatus.Completed || job.status === JobStatus.Failed
            ? job.updated_at
            : undefined,
      };
    } catch (error) {
      logger.error('Failed to get job status:', error);
      return null;
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('TemporalJobRunner is already running');
      return;
    }

    // The Temporal client doesn't need explicit starting
    // Job execution is handled by the Temporal worker
    this.isRunning = true;
    logger.info('TemporalJobRunner started');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      await this.client.connection.close();
      this.isRunning = false;
      logger.info('TemporalJobRunner stopped');
    } catch (error) {
      logger.error('Error stopping TemporalJobRunner:', error);
      throw error;
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      // Simple health check - try to list workflows
      const iterable = this.client.workflow.list({ pageSize: 1 });
      // Get first item from async iterable
      for await (const _ of iterable) {
        break; // Just need to verify we can iterate
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the underlying Temporal client for advanced operations
   */
  public getClient(): Client {
    return this.client;
  }

  /**
   * Get the registered handler for a job name
   */
  public getHandler(jobName: string): JobHandlerConfig<any> | undefined {
    return this.handlers.get(jobName);
  }

  /**
   * Create a job record in the database
   */
  private async createJobRecord(
    jobName: string,
    data: BaseJobData,
    options?: ScheduleJobOptions
  ): Promise<{ jobId: string }> {
    return runWithTenant(data.tenantId, async () => {
      const { knex } = await createTenantKnex();

      const metadata = {
        ...options?.metadata,
        singletonKey: options?.singletonKey,
        priority: options?.priority,
      };

      const [inserted] = await knex('jobs')
        .insert({
          tenant: data.tenantId,
          type: jobName,
          status: JobStatus.Pending,
          metadata: JSON.stringify(metadata),
          created_at: new Date(),
          user_id: options?.userId || data.tenantId,
          runner_type: 'temporal',
        })
        .returning('job_id');

      return { jobId: inserted.job_id };
    });
  }

  /**
   * Update the external IDs for a job record
   */
  private async updateJobExternalIds(
    jobId: string,
    externalId: string,
    externalRunId: string | null,
    tenantId: string
  ): Promise<void> {
    await runWithTenant(tenantId, async () => {
      const { knex } = await createTenantKnex();
      await knex('jobs')
        .where({ job_id: jobId, tenant: tenantId })
        .update({
          external_id: externalId,
          external_run_id: externalRunId,
          status: JobStatus.Queued,
          updated_at: new Date(),
        });
    });
  }

  /**
   * Update job status in the database
   */
  private async updateJobStatus(
    jobId: string,
    tenantId: string,
    status: JobStatus,
    updates?: { error?: string }
  ): Promise<void> {
    await runWithTenant(tenantId, async () => {
      const { knex } = await createTenantKnex();

      const currentJob = await knex('jobs')
        .where({ job_id: jobId, tenant: tenantId })
        .first('metadata');

      const currentMetadata = currentJob?.metadata
        ? typeof currentJob.metadata === 'string'
          ? JSON.parse(currentJob.metadata)
          : currentJob.metadata
        : {};

      const updatedMetadata = {
        ...currentMetadata,
        ...(updates?.error ? { error: updates.error } : {}),
      };

      await knex('jobs')
        .where({ job_id: jobId, tenant: tenantId })
        .update({
          status,
          metadata: JSON.stringify(updatedMetadata),
          updated_at: new Date(),
        });
    });
  }

  /**
   * Parse an interval string to Temporal schedule spec
   * Supports both cron expressions and interval strings
   */
  private parseScheduleSpec(interval: string): {
    intervals?: Array<{ every: Duration }>;
    cronExpressions?: string[];
  } {
    // Check if this is a cron expression (5 or 6 space-separated parts)
    const cronParts = interval.trim().split(/\s+/);
    if (cronParts.length >= 5 && cronParts.length <= 6) {
      // Looks like a cron expression
      // Temporal uses standard cron format: minute hour day-of-month month day-of-week
      logger.info('Using cron expression for schedule', { cronExpression: interval });
      return {
        cronExpressions: [interval],
      };
    }

    // Handle common interval formats like "24 hours", "30 minutes"
    const match = interval.match(/^(\d+)\s*(hours?|minutes?|days?|seconds?)$/i);
    if (match) {
      const value = parseInt(match[1], 10);
      const unit = match[2].toLowerCase();

      let duration: string;
      if (unit.startsWith('second')) {
        duration = `${value}s`;
      } else if (unit.startsWith('minute')) {
        duration = `${value}m`;
      } else if (unit.startsWith('hour')) {
        duration = `${value}h`;
      } else if (unit.startsWith('day')) {
        duration = `${value * 24}h`;
      } else {
        duration = `${value}h`; // Default to hours
      }

      return {
        intervals: [{ every: duration as Duration }],
      };
    }

    // Default: treat as a duration string that Temporal understands
    return {
      intervals: [{ every: interval as Duration }],
    };
  }

  /**
   * Map Temporal workflow status to our JobStatus
   */
  private mapTemporalStatus(temporalStatus: string): JobStatus {
    switch (temporalStatus) {
      case 'RUNNING':
        return JobStatus.Processing;
      case 'COMPLETED':
        return JobStatus.Completed;
      case 'FAILED':
      case 'TERMINATED':
      case 'CANCELED':
      case 'TIMED_OUT':
        return JobStatus.Failed;
      default:
        return JobStatus.Pending;
    }
  }
}
