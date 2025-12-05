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

  async registerHandler<T>(_config: JobHandlerConfig<T>): Promise<void> {
    throw new Error('TemporalJobRunner is only available in Enterprise Edition');
  }

  async scheduleJob<T>(_options: ScheduleJobOptions<T>): Promise<ScheduleJobResult> {
    return {
      success: false,
      error: 'TemporalJobRunner is only available in Enterprise Edition',
    };
  }

  async cancelJob(_jobId: string): Promise<boolean> {
    return false;
  }

  async getJobStatus(_jobId: string): Promise<JobStatusInfo | null> {
    return null;
  }

  isHealthy(): boolean {
    return false;
  }
}
