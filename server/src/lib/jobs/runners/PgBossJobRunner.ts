import PgBoss, { Job } from 'pg-boss';
import logger from '@shared/core/logger';
import { getPostgresConnection } from '../../db/knexfile';
import { JobService } from '../../../services/job.service';
import { StorageService } from '../../storage/StorageService';
import { JobStatus } from '../../../types/job';
import {
  IJobRunner,
  JobHandlerConfig,
  ScheduleJobOptions,
  ScheduleJobResult,
  JobStatusInfo,
  BaseJobData,
  PgBossConfig,
} from '../interfaces';
import { createTenantKnex, runWithTenant } from '../../db';

/**
 * PG Boss implementation of the IJobRunner interface
 *
 * This class wraps the existing PG Boss job scheduler and provides
 * the unified IJobRunner interface. It maintains backward compatibility
 * with existing job handlers while enabling the abstraction layer.
 */
export class PgBossJobRunner implements IJobRunner {
  private static instance: PgBossJobRunner | null = null;
  private boss: PgBoss;
  private jobService: JobService;
  private storageService: StorageService;
  private handlers: Map<string, JobHandlerConfig<any>> = new Map();
  private isRunning: boolean = false;

  private constructor(
    boss: PgBoss,
    jobService: JobService,
    storageService: StorageService
  ) {
    this.boss = boss;
    this.jobService = jobService;
    this.storageService = storageService;
  }

  /**
   * Create a new PgBossJobRunner instance
   */
  public static async create(config?: PgBossConfig): Promise<PgBossJobRunner> {
    if (PgBossJobRunner.instance) {
      return PgBossJobRunner.instance;
    }

    try {
      const env = process.env.APP_ENV || 'development';
      const { host, port, user, database } = await getPostgresConnection();
      let { password } = await getPostgresConnection();

      logger.info('Initializing PgBossJobRunner with connection', {
        host,
        port,
        database,
        user,
      });

      // Ensure password is properly encoded for URL
      if (password) {
        password = encodeURIComponent(password);
      }

      const connectionString =
        config?.connectionString ??
        `postgres://${user}:${password}@${host}:${port}/${database}?application_name=${config?.applicationName ?? `pgboss_${env}`}`;

      const boss = new PgBoss({
        connectionString,
        retryLimit: config?.retryLimit ?? 3,
        retryBackoff: config?.retryBackoff ?? true,
      });

      boss.on('error', (error) => {
        logger.error('PgBossJobRunner error:', error);
      });

      await boss.start();

      const jobService = await JobService.create();
      const storageService = new StorageService();

      PgBossJobRunner.instance = new PgBossJobRunner(
        boss,
        jobService,
        storageService
      );

      logger.info('PgBossJobRunner initialized successfully');

      return PgBossJobRunner.instance;
    } catch (error) {
      logger.error('Failed to initialize PgBossJobRunner:', error);
      throw error;
    }
  }

  /**
   * Get the singleton instance (throws if not initialized)
   */
  public static getInstance(): PgBossJobRunner {
    if (!PgBossJobRunner.instance) {
      throw new Error(
        'PgBossJobRunner not initialized. Call PgBossJobRunner.create() first.'
      );
    }
    return PgBossJobRunner.instance;
  }

  /**
   * Reset the singleton instance (for testing)
   */
  public static reset(): void {
    PgBossJobRunner.instance = null;
  }

  getRunnerType(): 'pgboss' | 'temporal' {
    return 'pgboss';
  }

  registerHandler<T extends BaseJobData>(config: JobHandlerConfig<T>): void {
    if (this.handlers.has(config.name)) {
      logger.warn(`Job handler ${config.name} is already registered, replacing`);
    }

    this.handlers.set(config.name, config);

    // Register with PG Boss
    void this.boss.work<T>(config.name, async (jobs: Job<T>[]) => {
      for (const job of jobs) {
        const startTime = Date.now();
        const jobData = job.data;

        try {
          logger.debug(`Processing job ${config.name}`, {
            jobId: job.id,
            tenantId: jobData.tenantId,
          });

          // Update status to processing if we have a jobServiceId
          if (jobData.jobServiceId) {
            await this.jobService.updateJobStatus(
              jobData.jobServiceId,
              JobStatus.Processing,
              { tenantId: jobData.tenantId, pgBossJobId: job.id }
            );
          }

          // Execute the handler
          await config.handler(jobData.jobServiceId || job.id, jobData);

          // Update status to completed
          if (jobData.jobServiceId) {
            await this.jobService.updateJobStatus(
              jobData.jobServiceId,
              JobStatus.Completed,
              { tenantId: jobData.tenantId }
            );
          }

          logger.debug(`Job ${config.name} completed`, {
            jobId: job.id,
            duration: Date.now() - startTime,
          });
        } catch (error) {
          logger.error(`Job ${config.name} failed:`, {
            jobId: job.id,
            error: error instanceof Error ? error.message : String(error),
          });

          // Update status to failed
          if (jobData.jobServiceId) {
            await this.jobService.updateJobStatus(
              jobData.jobServiceId,
              JobStatus.Failed,
              {
                tenantId: jobData.tenantId,
                error: error instanceof Error ? error.message : String(error),
              }
            );
          }

          // Re-throw to let PG Boss handle retries
          throw error;
        }
      }
    });

    logger.info(`Registered job handler: ${config.name}`);
  }

  async scheduleJob<T extends BaseJobData>(
    jobName: string,
    data: T,
    options?: ScheduleJobOptions
  ): Promise<ScheduleJobResult> {
    if (!data.tenantId) {
      throw new Error('tenantId is required in job data');
    }

    // Create job record in database
    const jobRecord = await this.createJobRecord(jobName, data, options);

    // Schedule with PG Boss
    await this.boss.createQueue(jobName);
    const externalId = await this.boss.send(jobName, {
      ...data,
      jobServiceId: jobRecord.jobId,
    });

    // Update job record with external ID
    if (externalId) {
      await this.updateJobExternalId(jobRecord.jobId, externalId, data.tenantId);
    }

    return {
      jobId: jobRecord.jobId,
      externalId,
    };
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

    // Create job record in database
    const jobRecord = await this.createJobRecord(jobName, data, options);

    // Schedule with PG Boss
    const externalId = await this.boss.send(
      jobName,
      { ...data, jobServiceId: jobRecord.jobId },
      { startAfter: runAt }
    );

    // Update job record with external ID
    if (externalId) {
      await this.updateJobExternalId(jobRecord.jobId, externalId, data.tenantId);
    }

    return {
      jobId: jobRecord.jobId,
      externalId,
    };
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

    // Convert cron expression to interval for PG Boss
    let pgBossInterval = interval;
    if (/(^|\s)\*/.test(interval)) {
      // Any cron expression is coerced to daily interval
      pgBossInterval = '24 hours';
    }

    // Create singleton key for recurring jobs
    const singletonKey =
      options?.singletonKey ?? `${jobName}:${data.tenantId}`;

    // Create job record in database
    const jobRecord = await this.createJobRecord(jobName, data, {
      ...options,
      singletonKey,
      metadata: {
        ...options?.metadata,
        recurring: true,
        interval,
      },
    });

    // Schedule with PG Boss
    const externalId = await this.boss.send(
      jobName,
      { ...data, jobServiceId: jobRecord.jobId },
      {
        startAfter: pgBossInterval,
        retryLimit: 3,
        retryBackoff: true,
        singletonKey,
      }
    );

    // Update job record with external ID
    if (externalId) {
      await this.updateJobExternalId(jobRecord.jobId, externalId, data.tenantId);
    } else {
      logger.info('Recurring job already exists', {
        jobName,
        singletonKey,
      });
    }

    return {
      jobId: jobRecord.jobId,
      externalId,
    };
  }

  async cancelJob(jobId: string, tenantId: string): Promise<boolean> {
    try {
      // Get the external ID from our database
      const { knex } = await createTenantKnex();
      const job = await runWithTenant(tenantId, async () => {
        return knex('jobs')
          .where({ job_id: jobId, tenant: tenantId })
          .first('external_id', 'status');
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

      // Cancel in PG Boss if we have an external ID
      if (job.external_id) {
        await this.boss.cancel(job.external_id);
      }

      // Update our database
      await this.jobService.updateJobStatus(jobId, JobStatus.Failed, {
        tenantId,
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
      logger.warn('PgBossJobRunner is already running');
      return;
    }

    // PG Boss starts automatically in create(), but we mark it as running
    this.isRunning = true;
    logger.info('PgBossJobRunner started');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      await this.boss.stop({ graceful: true });
      this.isRunning = false;
      logger.info('PgBossJobRunner stopped');
    } catch (error) {
      logger.error('Error stopping PgBossJobRunner:', error);
      throw error;
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      // Simple health check - try to get queue info
      await this.boss.getQueueSize('health-check');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the underlying PG Boss instance for advanced operations
   * This is provided for backward compatibility with existing code
   */
  public getBoss(): PgBoss {
    return this.boss;
  }

  /**
   * Get the job service instance
   */
  public getJobService(): JobService {
    return this.jobService;
  }

  /**
   * Get the storage service instance
   */
  public getStorageService(): StorageService {
    return this.storageService;
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
          user_id: options?.userId || data.tenantId, // Use tenantId as fallback
          runner_type: 'pgboss',
        })
        .returning('job_id');

      return { jobId: inserted.job_id };
    });
  }

  /**
   * Update the external ID for a job record
   */
  private async updateJobExternalId(
    jobId: string,
    externalId: string,
    tenantId: string
  ): Promise<void> {
    await runWithTenant(tenantId, async () => {
      const { knex } = await createTenantKnex();
      await knex('jobs')
        .where({ job_id: jobId, tenant: tenantId })
        .update({
          external_id: externalId,
          status: JobStatus.Queued,
          updated_at: new Date(),
        });
    });
  }
}
