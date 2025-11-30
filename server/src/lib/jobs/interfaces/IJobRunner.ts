import { JobStatus } from '../../../types/job';

/**
 * Configuration for retry behavior
 */
export interface JobRetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number;
  /** Backoff coefficient for exponential backoff (default: 2.0) */
  backoffCoefficient?: number;
  /** Initial retry interval in milliseconds (default: 1000) */
  initialIntervalMs?: number;
  /** Maximum retry interval in milliseconds (default: 30000) */
  maxIntervalMs?: number;
  /** Error types that should not be retried */
  nonRetryableErrors?: string[];
}

/**
 * Configuration for a job handler
 */
export interface JobHandlerConfig<T extends Record<string, unknown> = Record<string, unknown>> {
  /** Unique name for this job type */
  name: string;
  /** The handler function that processes the job */
  handler: (jobId: string, data: T) => Promise<void>;
  /** Optional retry configuration */
  retry?: JobRetryConfig;
  /** Optional timeout in milliseconds (default: 300000 = 5 minutes) */
  timeoutMs?: number;
}

/**
 * Options for scheduling a job
 */
export interface ScheduleJobOptions {
  /** For scheduled jobs: when to run */
  runAt?: Date;
  /** For recurring jobs: cron expression or interval string */
  interval?: string;
  /** Unique key to prevent duplicate jobs (for singleton behavior) */
  singletonKey?: string;
  /** Priority (higher = more important, default: 0) */
  priority?: number;
  /** User ID who triggered the job (optional) */
  userId?: string;
  /** Additional metadata to store with the job */
  metadata?: Record<string, unknown>;
}

/**
 * Result of scheduling a job
 */
export interface ScheduleJobResult {
  /** The job ID in our database (jobs table) */
  jobId: string;
  /** The external ID (PG Boss job ID or Temporal workflow ID) */
  externalId: string | null;
}

/**
 * Job status information
 */
export interface JobStatusInfo {
  /** Current status of the job */
  status: JobStatus;
  /** Progress percentage (0-100) if available */
  progress?: number;
  /** Error message if the job failed */
  error?: string;
  /** Additional metadata about the job */
  metadata?: Record<string, unknown>;
  /** When the job was created */
  createdAt?: Date;
  /** When the job started processing */
  startedAt?: Date;
  /** When the job completed */
  completedAt?: Date;
}

/**
 * Base job data that all jobs must include
 */
export interface BaseJobData {
  /** Tenant ID is required for all jobs */
  tenantId: string;
  /** Optional job service ID for tracking */
  jobServiceId?: string;
}

/**
 * Abstraction for background job execution
 *
 * This interface is implemented by both PgBossJobRunner (CE) and TemporalJobRunner (EE)
 * to provide a unified API for background job processing.
 *
 * Both implementations write job status to the same database tables (jobs, job_details)
 * to ensure a unified monitoring experience regardless of the underlying execution engine.
 */
export interface IJobRunner {
  /**
   * Register a job handler for a specific job type
   *
   * @param config Job handler configuration including name and handler function
   */
  registerHandler<T extends BaseJobData>(config: JobHandlerConfig<T>): void;

  /**
   * Schedule a job for immediate execution
   *
   * @param jobName The name of the job type (must have a registered handler)
   * @param data The job data (must include tenantId)
   * @param options Optional scheduling options
   * @returns The job ID and external ID
   */
  scheduleJob<T extends BaseJobData>(
    jobName: string,
    data: T,
    options?: ScheduleJobOptions
  ): Promise<ScheduleJobResult>;

  /**
   * Schedule a job to run at a specific time
   *
   * @param jobName The name of the job type
   * @param data The job data (must include tenantId)
   * @param runAt When to execute the job
   * @param options Optional scheduling options
   * @returns The job ID and external ID
   */
  scheduleJobAt<T extends BaseJobData>(
    jobName: string,
    data: T,
    runAt: Date,
    options?: ScheduleJobOptions
  ): Promise<ScheduleJobResult>;

  /**
   * Schedule a recurring job
   *
   * @param jobName The name of the job type
   * @param data The job data (must include tenantId)
   * @param interval Cron expression or interval string (e.g., "0 0 * * *" or "24 hours")
   * @param options Optional scheduling options
   * @returns The job ID and external ID
   */
  scheduleRecurringJob<T extends BaseJobData>(
    jobName: string,
    data: T,
    interval: string,
    options?: ScheduleJobOptions
  ): Promise<ScheduleJobResult>;

  /**
   * Cancel a scheduled or running job
   *
   * @param jobId The job ID (from our database)
   * @param tenantId The tenant ID
   * @returns True if the job was cancelled, false if it couldn't be cancelled
   */
  cancelJob(jobId: string, tenantId: string): Promise<boolean>;

  /**
   * Get the status of a job
   *
   * @param jobId The job ID
   * @param tenantId The tenant ID
   * @returns The job status and metadata
   */
  getJobStatus(jobId: string, tenantId: string): Promise<JobStatusInfo | null>;

  /**
   * Start the job runner (begin processing jobs)
   * This should be called once during application initialization
   */
  start(): Promise<void>;

  /**
   * Stop the job runner gracefully
   * This should be called during application shutdown
   */
  stop(): Promise<void>;

  /**
   * Check if the job runner is healthy and ready to process jobs
   */
  isHealthy(): Promise<boolean>;

  /**
   * Get the runner type identifier
   */
  getRunnerType(): 'pgboss' | 'temporal';
}
