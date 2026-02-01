import logger from '@alga-psa/core/logger';
import { isEnterprise } from '../features';
import {
  IJobRunner,
  IJobRunnerFactory,
  JobRunnerConfig,
} from './interfaces';
import { PgBossJobRunner } from './runners/PgBossJobRunner';

/**
 * Dummy job runner that logs operations but doesn't execute jobs
 * Used as a fallback when no job runner can be initialized
 */
class DummyJobRunner implements IJobRunner {
  constructor() {
    logger.warn('Using DummyJobRunner - job processing will be disabled');
  }

  getRunnerType(): 'pgboss' | 'temporal' {
    return 'pgboss';
  }

  registerHandler(): void {
    logger.warn('DummyJobRunner: Attempted to register handler');
  }

  async scheduleJob(): Promise<{ jobId: string; externalId: null }> {
    logger.warn('DummyJobRunner: Attempted to schedule job');
    return { jobId: 'dummy', externalId: null };
  }

  async scheduleJobAt(): Promise<{ jobId: string; externalId: null }> {
    logger.warn('DummyJobRunner: Attempted to schedule job at time');
    return { jobId: 'dummy', externalId: null };
  }

  async scheduleRecurringJob(): Promise<{ jobId: string; externalId: null }> {
    logger.warn('DummyJobRunner: Attempted to schedule recurring job');
    return { jobId: 'dummy', externalId: null };
  }

  async cancelJob(): Promise<boolean> {
    logger.warn('DummyJobRunner: Attempted to cancel job');
    return false;
  }

  async getJobStatus(): Promise<null> {
    return null;
  }

  async start(): Promise<void> {
    logger.warn('DummyJobRunner: start() called');
  }

  async stop(): Promise<void> {
    logger.warn('DummyJobRunner: stop() called');
  }

  async isHealthy(): Promise<boolean> {
    return false;
  }
}

/**
 * Factory for creating job runner instances
 *
 * This factory creates the appropriate job runner based on the application
 * edition (CE vs EE) and configuration. It ensures only one instance of the
 * job runner is created (singleton pattern).
 *
 * Usage:
 * ```typescript
 * // Get the singleton factory instance
 * const factory = JobRunnerFactory.getInstance();
 *
 * // Create or get the job runner
 * const runner = await factory.createJobRunner();
 *
 * // Or use the static helper
 * const runner = await JobRunnerFactory.getJobRunner();
 * ```
 */
export class JobRunnerFactory implements IJobRunnerFactory {
  private static factoryInstance: JobRunnerFactory | null = null;
  private jobRunner: IJobRunner | null = null;
  private initializationPromise: Promise<IJobRunner> | null = null;

  private constructor() {}

  /**
   * Get the singleton factory instance
   */
  public static getInstance(): JobRunnerFactory {
    if (!JobRunnerFactory.factoryInstance) {
      JobRunnerFactory.factoryInstance = new JobRunnerFactory();
    }
    return JobRunnerFactory.factoryInstance;
  }

  /**
   * Static helper to get or create the job runner
   */
  public static async getJobRunner(
    config?: Partial<JobRunnerConfig>
  ): Promise<IJobRunner> {
    const factory = JobRunnerFactory.getInstance();
    return factory.createJobRunner(config);
  }

  /**
   * Create or retrieve the job runner instance
   */
  async createJobRunner(config?: Partial<JobRunnerConfig>): Promise<IJobRunner> {
    // Return existing instance if available
    if (this.jobRunner) {
      return this.jobRunner;
    }

    // If initialization is in progress, wait for it
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    // Start initialization
    this.initializationPromise = this.initializeJobRunner(config);

    try {
      this.jobRunner = await this.initializationPromise;
      return this.jobRunner;
    } finally {
      this.initializationPromise = null;
    }
  }

  /**
   * Get the current job runner instance if one exists
   */
  getJobRunner(): IJobRunner | null {
    return this.jobRunner;
  }

  /**
   * Reset the factory (mainly for testing purposes)
   */
  reset(): void {
    if (this.jobRunner) {
      // Note: We don't call stop() here as it might be in use
      // The caller should stop the runner before resetting
      logger.warn('Resetting JobRunnerFactory - ensure runner is stopped');
    }
    this.jobRunner = null;
    this.initializationPromise = null;
    PgBossJobRunner.reset();

    // Reset TemporalJobRunner if available (EE only)
    if (isEnterprise) {
      try {
        // Dynamic import to avoid bundling EE code in CE
        import('@enterprise/lib/jobs/runners/TemporalJobRunner')
          .then(({ TemporalJobRunner }) => {
            TemporalJobRunner.reset();
          })
          .catch(() => {
            // TemporalJobRunner not available, ignore
          });
      } catch {
        // Ignore errors during reset
      }
    }

    JobRunnerFactory.factoryInstance = null;
  }

  /**
   * Initialize the appropriate job runner
   */
  private async initializeJobRunner(
    config?: Partial<JobRunnerConfig>
  ): Promise<IJobRunner> {
    // Determine runner type based on config, environment, and edition
    const runnerType = this.determineRunnerType(config);

    logger.info(`Initializing job runner`, { type: runnerType, isEnterprise });

    try {
      if (runnerType === 'temporal' && isEnterprise) {
        return await this.createTemporalRunner(config);
      } else {
        return await this.createPgBossRunner(config);
      }
    } catch (error) {
      logger.error('Failed to initialize job runner:', error);

      // If Temporal fails and fallback is enabled, try PG Boss
      if (
        runnerType === 'temporal' &&
        config?.fallbackToPgBoss !== false
      ) {
        logger.warn('Falling back to PG Boss job runner');
        try {
          return await this.createPgBossRunner(config);
        } catch (fallbackError) {
          logger.error('Fallback to PG Boss also failed:', fallbackError);
        }
      }

      // Return dummy runner as last resort
      logger.warn('Using DummyJobRunner as fallback');
      return new DummyJobRunner();
    }
  }

  /**
   * Determine which runner type to use
   */
  private determineRunnerType(
    config?: Partial<JobRunnerConfig>
  ): 'pgboss' | 'temporal' {
    // Explicit config takes precedence
    if (config?.type) {
      return config.type;
    }

    // Check environment variable
    const envType = process.env.JOB_RUNNER_TYPE?.toLowerCase();
    if (envType === 'temporal' || envType === 'pgboss') {
      return envType;
    }

    // Default based on edition
    // For now, default to pgboss even for EE until Temporal adapter is ready
    return 'pgboss';
  }

  /**
   * Create a PG Boss job runner
   */
  private async createPgBossRunner(
    config?: Partial<JobRunnerConfig>
  ): Promise<IJobRunner> {
    return PgBossJobRunner.create(config?.pgboss);
  }

  /**
   * Create a Temporal job runner (EE only)
   */
  private async createTemporalRunner(
    config?: Partial<JobRunnerConfig>
  ): Promise<IJobRunner> {
    if (!isEnterprise) {
      throw new Error('Temporal job runner is only available in Enterprise Edition');
    }

    // Validate Temporal configuration
    const temporalConfig = config?.temporal ?? this.getTemporalConfigFromEnv();

    if (!temporalConfig.address) {
      throw new Error('Temporal address is required');
    }

    // Dynamically import the EE Temporal runner to avoid bundling in CE
    try {
      const { TemporalJobRunner } = await import(
        '@enterprise/lib/jobs/runners/TemporalJobRunner'
      );
      return (await TemporalJobRunner.create(temporalConfig)) as unknown as IJobRunner;
    } catch (error) {
      logger.error('Failed to load TemporalJobRunner:', error);
      throw new Error(
        'TemporalJobRunner not available. Ensure EE modules are properly installed.'
      );
    }
  }

  /**
   * Get Temporal configuration from environment variables
   */
  private getTemporalConfigFromEnv(): {
    address: string;
    namespace?: string;
    taskQueue?: string;
  } {
    return {
      address:
        process.env.TEMPORAL_ADDRESS ||
        'temporal-frontend.temporal.svc.cluster.local:7233',
      namespace: process.env.TEMPORAL_NAMESPACE || 'default',
      taskQueue: process.env.TEMPORAL_JOB_TASK_QUEUE || 'alga-jobs',
    };
  }
}

/**
 * Export a convenience function for getting the job runner
 */
export async function getJobRunner(
  config?: Partial<JobRunnerConfig>
): Promise<IJobRunner> {
  return JobRunnerFactory.getJobRunner(config);
}
