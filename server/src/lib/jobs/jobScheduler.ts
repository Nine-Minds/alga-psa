import PgBoss, { Job, WorkHandler } from 'pg-boss';
import { getAdminConnection } from '../db/admin';

export interface JobFilter {
  state?: 'completed' | 'failed' | 'active' | 'expired';
  startAfter?: Date;
  beforeDate?: Date;
  jobName?: string;
  tenantId?: string;
  limit?: number;
  offset?: number;
}

interface JobState {
  active: number;
  completed: number;
  failed: number;
  queued: number;
}

interface JobData {
  id: string;
  name: string;
  data: Record<string, unknown>;
  state: string;
  createdOn: Date;
  startedOn?: Date;
  completedOn?: Date;
}

interface PgBossJobData {
  id: string;
  name: string;
  data: unknown;
  createdOn?: string;
  startedOn?: string;
  completedOn?: string;
}

export class JobScheduler {
  private static instance: JobScheduler | null = null;
  private boss: PgBoss;
  private handlers: Map<string, (data: Record<string, unknown>) => Promise<void>> = new Map();

  private constructor(boss: PgBoss) {
    this.boss = boss;
  }

  public static async getInstance(): Promise<JobScheduler> {
    if (!JobScheduler.instance) {
      try {
        const adminKnex = await getAdminConnection();
        const config = adminKnex.client.config.connection;
        
        // Construct proper connection string
        const connectionString = typeof config === 'string' ? config :
          `postgres://${config.user}:${config.password}@${config.host}:${config.port}/${config.database}`;
        
        const boss = new PgBoss({
          connectionString: connectionString,
          retryLimit: 3,
          retryBackoff: true,
        });

        boss.on('error', error => {
          console.error('Job scheduler error:', error);
        });

        await boss.start();
        
        JobScheduler.instance = new JobScheduler(boss);
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
    return await this.boss.send(jobName, data);
  }

  public async scheduleScheduledJob<T extends Record<string, unknown>>(
    jobName: string,
    runAt: Date,
    data: T
  ): Promise<string | null> {
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
    
    return await this.boss.send(jobName, data, { 
      startAfter: pgBossInterval,
      retryLimit: 3,
      retryBackoff: true,
      singletonKey: jobName
    });
  }

  public registerJobHandler<T extends Record<string, unknown>>(
    jobName: string,
    handler: (data: T) => Promise<void>
  ): void {
    this.handlers.set(jobName, handler as (data: Record<string, unknown>) => Promise<void>);
    void this.boss.work<T>(jobName, async (jobs) => {
      const handler = this.handlers.get(jobName);
      if (handler) {
        // Process each job in the array
        for (const job of jobs) {
          if (job.data) {
            await handler(job.data);
          }
        }
      }
    });
  }

  private mapJobToJobData(job: PgBossJobData): JobData {
    return {
      id: job.id,
      name: job.name,
      data: job.data as Record<string, unknown>,
      state: 'completed',
      createdOn: job.createdOn ? new Date(job.createdOn) : new Date(),
      startedOn: job.startedOn ? new Date(job.startedOn) : undefined,
      completedOn: job.completedOn ? new Date(job.completedOn) : undefined
    };
  }

  public async getJobs(filter: JobFilter): Promise<JobData[]> {
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

    return filteredJobs.map((job): JobData => this.mapJobToJobData(job as unknown as PgBossJobData));
  }

  public async getJobById(jobId: string): Promise<JobData | null> {
    const jobs = await this.boss.fetch('*');
    const job = jobs?.find(j => j.id === jobId);
    return job ? this.mapJobToJobData(job as unknown as PgBossJobData) : null;
  }

  public async getJobHistory(filter: JobFilter): Promise<JobData[]> {
    const state = filter.state || 'completed';
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

    return filteredJobs.map((job): JobData => this.mapJobToJobData(job as unknown as PgBossJobData));
  }

  public async cancelJob(jobId: string): Promise<boolean> {
    // First get the job to get its name
    const job = await this.getJobById(jobId);
    if (!job) {
      return false;
    }

    // Cancel the job with both name and id
    await this.boss.cancel(job.name, jobId);
    return true;
  }

  public async getQueueMetrics(): Promise<JobState> {
    const [active, completed, failed, queued] = await Promise.all([
      this.boss.fetch('active'),
      this.boss.fetch('completed'),
      this.boss.fetch('failed'),
      this.boss.fetch('created')
    ]);

    return {
      active: active?.length || 0,
      completed: completed?.length || 0,
      failed: failed?.length || 0,
      queued: queued?.length || 0,
    };
  }
}
