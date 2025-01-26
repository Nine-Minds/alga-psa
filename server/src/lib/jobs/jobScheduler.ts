import PgBoss, { Job, WorkHandler } from 'pg-boss';
import { postgresConnection } from '../db/knexfile';
import { StorageService } from '@/lib/storage/StorageService';
// import logger from '../../utils/logger';
import { JobService } from '../../services/job.service';
import { JobStatus } from '../../types/job.d';

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

export class JobScheduler {
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

  public static async getInstance(jobService: JobService, storageService: StorageService): Promise<JobScheduler> {
    if (!JobScheduler.instance) {
      try {
        // Use postgres admin credentials with development environment
        const env = process.env.APP_ENV || 'development';
        const { host, port, user, database } = postgresConnection;
        let { password } = postgresConnection;
        
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
          ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
        });

        boss.on('error', error => {
          console.error('Job scheduler error:', error);
        });

        await boss.start();
        
        JobScheduler.instance = new JobScheduler(boss, jobService, storageService);
      } catch (error) {
        console.error('Failed to initialize job scheduler:', error);
        throw new Error('Failed to initialize job scheduler');
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
    // Convert cron expression to pg-boss interval
    let pgBossInterval: string;
    
    if (interval.includes('*')) {
      // Simple conversion for daily jobs
      pgBossInterval = '24 hours';
    } else {
      // For other intervals, use as-is
      pgBossInterval = interval;
    }
    
    if (!data.tenantId) {
      throw new Error('tenantId is required in job data');
    }
    return await this.boss.send(jobName, data, {
      startAfter: pgBossInterval,
      retryLimit: 3,
      retryBackoff: true,
      singletonKey: jobName
    });
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
        await this.jobService.updateJobStatus(jobId, JobStatus.Processing, { tenantId: payload.tenantId });
        await handler(jobId, payload);
        await this.jobService.updateJobStatus(jobId, JobStatus.Completed, { tenantId: payload.tenantId });
      } catch (error) {
        console.log('Error in job handler:', error);
        await this.jobService.updateJobStatus(jobId, JobStatus.Failed, {
          error,
          tenantId: payload.tenantId
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
