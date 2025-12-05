/**
 * Empty TemporalJobRunner for Community Edition
 *
 * Temporal job runner functionality is only available in the Enterprise Edition.
 */

import type {
  IJobRunner,
  JobHandlerConfig,
  ScheduleJobOptions,
  ScheduleJobResult,
  JobStatusInfo,
  BaseJobData,
  TemporalConfig,
} from '@/lib/jobs/interfaces';

export class TemporalJobRunner implements IJobRunner {
  private static instance: TemporalJobRunner | null = null;

  private constructor() {}

  public static async create(_config?: TemporalConfig): Promise<TemporalJobRunner> {
    throw new Error('TemporalJobRunner is only available in Enterprise Edition');
  }

  public static reset(): void {
    TemporalJobRunner.instance = null;
  }

  getRunnerType(): 'pgboss' | 'temporal' {
    return 'temporal';
  }

  async start(): Promise<void> {
    throw new Error('TemporalJobRunner is only available in Enterprise Edition');
  }

  async stop(): Promise<void> {
    // No-op for CE
  }

  registerHandler<T extends BaseJobData>(_config: JobHandlerConfig<T>): void {
    throw new Error('TemporalJobRunner is only available in Enterprise Edition');
  }

  async scheduleJob<T extends BaseJobData>(
    _jobName: string,
    _data: T,
    _options?: ScheduleJobOptions
  ): Promise<ScheduleJobResult> {
    return {
      jobId: '',
      externalId: null,
    };
  }

  async scheduleJobAt<T extends BaseJobData>(
    _jobName: string,
    _data: T,
    _runAt: Date,
    _options?: ScheduleJobOptions
  ): Promise<ScheduleJobResult> {
    return {
      jobId: '',
      externalId: null,
    };
  }

  async scheduleRecurringJob<T extends BaseJobData>(
    _jobName: string,
    _data: T,
    _interval: string,
    _options?: ScheduleJobOptions
  ): Promise<ScheduleJobResult> {
    return {
      jobId: '',
      externalId: null,
    };
  }

  async cancelJob(_jobId: string, _tenantId: string): Promise<boolean> {
    return false;
  }

  async getJobStatus(_jobId: string, _tenantId: string): Promise<JobStatusInfo | null> {
    return null;
  }

  async isHealthy(): Promise<boolean> {
    return false;
  }
}
