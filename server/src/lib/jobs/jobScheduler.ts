import PgBoss, { Job, WorkHandler } from 'pg-boss';
import logger from '@shared/core/logger';
import { getPostgresConnection } from '../db/knexfile';
import { StorageService } from 'server/src/lib/storage/StorageService';
import { JobService } from '../../services/job.service';
import { JobStatus } from '../../types/job';

export interface JobFilter {
  state?: 'completed' | 'failed' | 'active' | 'expired';
  startAfter?: Date;
  beforeDate?: Date;
  jobName?: string;
  tenantId?: string;
  limit?: number;
  offset?: number;
}

export interface JobState {
  active: number;
  completed: number;
  failed: number;
  queued: number;
}

export interface JobData {
  job_id: string;
  name: string;
  data: Record<string, unknown>;
  status: string;
  createdOn: Date;
  startedOn?: Date;
  completedOn?: Date;
}

export interface IJobScheduler {
  scheduleImmediateJob<T extends Record<string, unknown>>(jobName: string, data: T): Promise<string | null>;
  scheduleScheduledJob<T extends Record<string, unknown>>(jobName: string, runAt: Date, data: T): Promise<string | null>;
  scheduleRecurringJob<T extends Record<string, unknown>>(jobName: string, interval: string, data: T): Promise<string | null>;
  registerJobHandler<T extends Record<string, unknown>>(jobName: string, handler: (job: Job<T>) => Promise<void>): void;
  registerGenericJobHandler<T extends Record<string, unknown>>(jobType: string, handler: (jobId: string, data: T) => Promise<void>): void;
  getJobs(filter: JobFilter): Promise<PgBoss.Job<unknown>[]>;
}

// Dummy implementation that logs operations but doesn't actually do anything
export class DummyJobScheduler implements IJobScheduler {
  private static instance: DummyJobScheduler | null = null;

  private constructor() {
    console.warn('Using DummyJobScheduler - job scheduling functionality will be disabled');
  }

  public static getInstance(): DummyJobScheduler {
    if (!DummyJobScheduler.instance) {
      DummyJobScheduler.instance = new DummyJobScheduler();
    }
    return DummyJobScheduler.instance;
  }

  public async scheduleImmediateJob<T extends Record<string, unknown>>(jobName: string, data: T): Promise<string | null> {
    console.warn(`DummyJobScheduler: Attempted to schedule immediate job "${jobName}"`, data);
    return null;
  }

  public async scheduleScheduledJob<T extends Record<string, unknown>>(jobName: string, runAt: Date, data: T): Promise<string | null> {
    console.warn(`DummyJobScheduler: Attempted to schedule job "${jobName}" for ${runAt}`, data);
    return null;
  }

  public async scheduleRecurringJob<T extends Record<string, unknown>>(jobName: string, interval: string, data: T): Promise<string | null> {
    console.warn(`DummyJobScheduler: Attempted to schedule recurring job "${jobName}" with interval ${interval}`, data);
    return null;
  }

  public registerJobHandler<T extends Record<string, unknown>>(jobName: string, handler: (job: Job<T>) => Promise<void>): void {
    console.warn(`DummyJobScheduler: Attempted to register handler for job "${jobName}"`);
  }

  public registerGenericJobHandler<T extends Record<string, unknown>>(jobType: string, handler: (jobId: string, data: T) => Promise<void>): void {
    console.warn(`DummyJobScheduler: Attempted to register generic handler for job type "${jobType}"`);
  }

  public async getJobs(filter: JobFilter): Promise<PgBoss.Job<unknown>[]> {
    console.warn('DummyJobScheduler: Attempted to get jobs with filter', filter);
    return [];
  }
}

export class JobScheduler implements IJobScheduler {
  private static instance: JobScheduler | null = null;
  private boss: PgBoss;
  private handlers: Map<string, (job: Job<Record<string, unknown>>) => Promise<void>> = new Map();
  private jobService: JobService;
  private storageService: StorageService;

  private constructor(boss: PgBoss, jobService: JobService, storageService: StorageService) {
    this.boss = boss;
    this.jobService = jobService;
    this.storageService = storageService;
  }

  public static async getInstance(jobService: JobService, storageService: StorageService): Promise<IJobScheduler> {
    if (!JobScheduler.instance) {
      try {
        // Use postgres admin credentials with development environment
        const env = process.env.APP_ENV || 'development';
        const { host, port, user, database } = await getPostgresConnection();
        let { password } = await getPostgresConnection();

        // Avoid logging sensitive password in plaintext
        const redactedPassword = password ? '***REDACTED***' : undefined;
        console.log('Initializing pgboss with connection:', { host, port, user, database, password: redactedPassword });
        
        // Ensure password is properly encoded for URL
        if (password) {
          password = encodeURIComponent(password);
        }
        
        // Construct connection string using postgres admin credentials
        console.log('Initializing pgboss with connection:', {
          host,
          port,
          database,
          user
        });
        const connectionString = `postgres://${user}:${password}@${host}:${port}/${database}?application_name=pgboss_${env}`;
        
        const boss = new PgBoss({
          connectionString: connectionString,
          retryLimit: 3,
          retryBackoff: true,
        });

        boss.on('error', error => {
          console.error('Job scheduler error:', error);
        });

        await boss.start();
        
        JobScheduler.instance = new JobScheduler(boss, jobService, storageService);
      } catch (error) {
        console.error('Failed to initialize job scheduler:', error);
        console.warn('Falling back to dummy job scheduler');
        return DummyJobScheduler.getInstance();
      }
    }
    return JobScheduler.instance;
  }

  public async scheduleImmediateJob<T extends Record<string, unknown>>(
    jobName: string,
    data: T
  ): Promise<string | null> {
    await this.boss.createQueue(jobName);
    if (!data.tenantId) {
      throw new Error('tenantId is required in job data');
    }
        
    return await this.boss.send(jobName, data);
  }

  public async scheduleScheduledJob<T extends Record<string, unknown>>(
    jobName: string,
    runAt: Date,
    data: T
  ): Promise<string | null> {
    // Ensure queue exists before sending (required in pg-boss v10+)
    await this.boss.createQueue(jobName);

    if (!data.tenantId) {
      throw new Error('tenantId is required in job data');
    }

    return await this.boss.send(jobName, data, { startAfter: runAt });
  }

  public async scheduleRecurringJob<T extends Record<string, unknown>>(
    jobName: string,
    interval: string,
    data: T
  ): Promise<string | null> {
    // Ensure queue exists before sending (required in pg-boss v10+)
    await this.boss.createQueue(jobName);

    // Convert a cron-ish input into a coarse interval, since we're using delayed send()
    let pgBossInterval: string = interval;
    if (/(^|\s)\*/.test(interval)) {
      // Any cron expression is coerced to daily interval here
      pgBossInterval = '24 hours';
    }

    if (!data.tenantId) {
      throw new Error('tenantId is required in job data');
    }
    const tenantId = String((data as Record<string, unknown>).tenantId);
    const key = `${jobName}:${tenantId}`;

    logger.debug('Scheduling recurring job via delayed send', {
      jobName,
      tenantId,
      requestedInterval: interval,
      effectiveInterval: pgBossInterval,
      singletonKey: key,
    });

    const id = await this.boss.send(jobName, data, {
      startAfter: pgBossInterval,
      retryLimit: 3,
      retryBackoff: true,
      // Make singleton per-tenant, not global across all tenants
      singletonKey: key,
    });

    if (!id) {
      logger.info('Recurring job send returned null (singleton already queued)', {
        jobName,
        tenantId,
        singletonKey: key,
        effectiveInterval: pgBossInterval,
      });
    } else {
      logger.debug('Recurring job scheduled', { jobName, tenantId, id });
    }

    return id; // null means identical singleton already exists
  }

  public registerJobHandler<T extends Record<string, unknown>>(
    jobName: string,
    handler: (job: Job<T>) => Promise<void>
  ): void {
    this.handlers.set(jobName, async (job: Job<Record<string, unknown>>) => {
      await handler(job as Job<T>);
    });
    void this.boss.work<T>(jobName, async (jobs) => {
      const handler = this.handlers.get(jobName);
      if (handler) {
        // Process each job in the array
        for (const job of jobs) {
          await handler(job);
        }
      }
    });
  }

  public registerGenericJobHandler<T extends Record<string, unknown>>(
    jobType: string,
    handler: (jobId: string, data: T) => Promise<void>
  ) {
    this.registerJobHandler(jobType, async (job: Job<T>) => {
      const jobId = job.id;
      const payload = job.data;
      
      if (!payload.tenantId) {
        throw new Error('tenantId is required in job data');
      }
      
      try {
        const tenantId = payload.tenantId as string;
        await this.jobService.updateJobStatus(jobId, JobStatus.Processing, { tenantId });
        await handler(jobId, payload);
        await this.jobService.updateJobStatus(jobId, JobStatus.Completed, { tenantId });
      } catch (error) {
        console.log('Error in job handler:', error);
        const tenantId = payload.tenantId as string;
        await this.jobService.updateJobStatus(jobId, JobStatus.Failed, {
          error,
          tenantId
        });
        throw error;
      }
    });
  }

  public async getJobs(filter: JobFilter): Promise<PgBoss.Job<unknown>[]> {
    const state = filter.state || 'active';
    const jobs = await this.boss.fetch(state);

    const filteredJobs = (jobs || [])
      .slice(filter.offset || 0, (filter.offset || 0) + (filter.limit || 100))
      .filter(job => {
        const matchesName = !filter.jobName || job.name === filter.jobName;
        const matchesTenant = !filter.tenantId || 
          (job.data && typeof job.data === 'object' && 'tenantId' in job.data && 
           (job.data as Record<string, unknown>).tenantId === filter.tenantId);
        return matchesName && matchesTenant;
      });

    return filteredJobs;
  }
}
