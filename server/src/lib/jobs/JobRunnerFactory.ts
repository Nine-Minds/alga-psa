import logger from '@alga-psa/core/logger';
import { isEnterprise, isEnterpriseEdition } from '../features';
import {
  IJobRunner,
  IJobRunnerFactory,
  JobRunnerConfig,
} from './interfaces';
import { PgBossJobRunner } from './runners/PgBossJobRunner';

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
    // Determine runner type based on config, environment, and edition.
    // Re-evaluate the edition via isEnterpriseEdition() (reads process.env)
    // rather than the module-level `isEnterprise` const: the const can be read
    // before the features module finishes initializing, which previously made
    // EE silently resolve to PG Boss.
    const runnerType = this.determineRunnerType(config);
    const enterprise = isEnterpriseEdition();

    logger.info(`Initializing job runner`, { type: runnerType, isEnterprise: enterprise });

    // No silent fallback. In EE, Temporal is the durable scheduling/execution
    // authority; failing to bring it up must surface loudly rather than quietly
    // degrading to PG Boss (which strands recurring schedules on a backend with
    // no durable consumer). Let the error propagate to the caller.
    try {
      if (runnerType === 'temporal' && enterprise) {
        return await this.createTemporalRunner(config);
      }
      return await this.createPgBossRunner(config);
    } catch (error) {
      logger.error('Failed to initialize job runner; refusing to fall back', {
        runnerType,
        isEnterprise: enterprise,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
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

    // Default based on edition.
    // EE should use Temporal as the durable scheduling/execution authority by default.
    // Call isEnterpriseEdition() (reads process.env) instead of the module-level
    // `isEnterprise` const to stay immune to module-initialization ordering.
    return isEnterpriseEdition() ? 'temporal' : 'pgboss';
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
    if (!isEnterpriseEdition()) {
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
