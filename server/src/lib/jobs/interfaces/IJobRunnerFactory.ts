import { IJobRunner } from './IJobRunner';

/**
 * PG Boss specific configuration
 */
export interface PgBossConfig {
  /** PostgreSQL connection string (optional, uses default if not provided) */
  connectionString?: string;
  /** Maximum retry attempts for failed jobs (default: 3) */
  retryLimit?: number;
  /** Enable exponential backoff for retries (default: true) */
  retryBackoff?: boolean;
  /** Application name for PostgreSQL connection */
  applicationName?: string;
}

/**
 * Temporal specific configuration
 */
export interface TemporalConfig {
  /** Temporal server address (e.g., "localhost:7233") */
  address: string;
  /** Temporal namespace (default: "default") */
  namespace?: string;
  /** Task queue for job workflows (default: "alga-jobs") */
  taskQueue?: string;
  /** Enable TLS for connection */
  tls?: boolean;
  /** Client certificate for mTLS */
  clientCert?: string;
  /** Client key for mTLS */
  clientKey?: string;
}

/**
 * Configuration for the job runner
 */
export interface JobRunnerConfig {
  /** The job runner type: 'pgboss' or 'temporal' */
  type: 'pgboss' | 'temporal';

  /** PG Boss specific configuration (used when type is 'pgboss') */
  pgboss?: PgBossConfig;

  /** Temporal specific configuration (used when type is 'temporal') */
  temporal?: TemporalConfig;

  /** Whether to fall back to PG Boss if Temporal is unavailable (EE only) */
  fallbackToPgBoss?: boolean;
}

/**
 * Factory for creating job runner instances
 *
 * This factory creates the appropriate job runner based on the application
 * edition (CE vs EE) and configuration. It ensures only one instance of the
 * job runner is created (singleton pattern).
 */
export interface IJobRunnerFactory {
  /**
   * Create or retrieve the job runner instance
   *
   * @param config Optional configuration override
   * @returns The job runner instance
   */
  createJobRunner(config?: Partial<JobRunnerConfig>): Promise<IJobRunner>;

  /**
   * Get the current job runner instance if one exists
   *
   * @returns The job runner instance or null if not yet created
   */
  getJobRunner(): IJobRunner | null;

  /**
   * Reset the factory (mainly for testing purposes)
   */
  reset(): void;
}
