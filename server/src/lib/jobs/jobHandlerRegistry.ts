import logger from '@shared/core/logger';
import { JobHandlerConfig, BaseJobData } from './interfaces';

/**
 * Job Handler Function type
 */
export type JobHandlerFn<T extends BaseJobData = BaseJobData> = (
  jobId: string,
  data: T
) => Promise<void>;

/**
 * Registered handler entry with metadata
 */
export interface RegisteredHandler<T extends BaseJobData = BaseJobData> {
  /** The handler function */
  handler: JobHandlerFn<T>;
  /** Handler configuration */
  config: JobHandlerConfig<T>;
  /** When the handler was registered */
  registeredAt: Date;
}

/**
 * Centralized Job Handler Registry
 *
 * This registry provides a single source of truth for all job handlers
 * in the application. It can be used by both:
 * - The main Next.js server (for PG Boss job execution)
 * - The Temporal worker (for workflow activity execution)
 *
 * The registry is designed to be populated at application/worker startup
 * with all available job handlers, making them discoverable and executable
 * by any job runner implementation.
 *
 * @example
 * ```typescript
 * // Register a handler
 * JobHandlerRegistry.register({
 *   name: 'my-job',
 *   handler: async (jobId, data) => {
 *     // Process the job
 *   },
 *   retry: { maxAttempts: 3 },
 * });
 *
 * // Execute a handler
 * const result = await JobHandlerRegistry.execute('my-job', 'job-123', { tenantId: 'tenant-1' });
 * ```
 */
export class JobHandlerRegistry {
  private static handlers: Map<string, RegisteredHandler<any>> = new Map();
  private static initialized: boolean = false;

  /**
   * Register a job handler
   *
   * @param config The handler configuration
   * @throws Error if a handler with the same name is already registered (unless force=true)
   */
  static register<T extends BaseJobData>(
    config: JobHandlerConfig<T>,
    options?: { force?: boolean }
  ): void {
    const existing = this.handlers.get(config.name);

    if (existing && !options?.force) {
      logger.warn(`Job handler '${config.name}' is already registered`, {
        existingRegisteredAt: existing.registeredAt,
      });
      return;
    }

    this.handlers.set(config.name, {
      handler: config.handler,
      config,
      registeredAt: new Date(),
    });

    logger.info(`Registered job handler: ${config.name}`, {
      hasRetryConfig: !!config.retry,
      timeoutMs: config.timeoutMs,
    });
  }

  /**
   * Get a registered handler by name
   *
   * @param name The job name
   * @returns The registered handler or undefined
   */
  static get<T extends BaseJobData>(name: string): RegisteredHandler<T> | undefined {
    return this.handlers.get(name) as RegisteredHandler<T> | undefined;
  }

  /**
   * Check if a handler is registered
   *
   * @param name The job name
   * @returns True if a handler is registered
   */
  static has(name: string): boolean {
    return this.handlers.has(name);
  }

  /**
   * Execute a job handler by name
   *
   * @param name The job name
   * @param jobId The job ID
   * @param data The job data
   * @returns Promise that resolves when the handler completes
   * @throws Error if no handler is registered for the job name
   */
  static async execute<T extends BaseJobData>(
    name: string,
    jobId: string,
    data: T
  ): Promise<void> {
    const registered = this.handlers.get(name);

    if (!registered) {
      throw new Error(`No handler registered for job type: ${name}`);
    }

    const startTime = Date.now();
    logger.debug(`Executing job handler: ${name}`, { jobId, tenantId: data.tenantId });

    try {
      await registered.handler(jobId, data);
      logger.debug(`Job handler completed: ${name}`, {
        jobId,
        durationMs: Date.now() - startTime,
      });
    } catch (error) {
      logger.error(`Job handler failed: ${name}`, {
        jobId,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Get all registered handler names
   *
   * @returns Array of registered job names
   */
  static getRegisteredNames(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Get all registered handlers with their configurations
   *
   * @returns Map of handler name to configuration
   */
  static getAll(): Map<string, RegisteredHandler<any>> {
    return new Map(this.handlers);
  }

  /**
   * Get handler configuration by name
   *
   * @param name The job name
   * @returns The handler configuration or undefined
   */
  static getConfig<T extends BaseJobData>(name: string): JobHandlerConfig<T> | undefined {
    return this.handlers.get(name)?.config as JobHandlerConfig<T> | undefined;
  }

  /**
   * Unregister a handler
   *
   * @param name The job name
   * @returns True if a handler was removed
   */
  static unregister(name: string): boolean {
    const removed = this.handlers.delete(name);
    if (removed) {
      logger.info(`Unregistered job handler: ${name}`);
    }
    return removed;
  }

  /**
   * Clear all registered handlers
   * Mainly useful for testing
   */
  static clear(): void {
    this.handlers.clear();
    this.initialized = false;
    logger.info('Cleared all job handlers from registry');
  }

  /**
   * Check if the registry has been initialized
   */
  static isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Mark the registry as initialized
   * Called after all handlers have been registered
   */
  static markInitialized(): void {
    this.initialized = true;
    logger.info(`Job handler registry initialized with ${this.handlers.size} handlers`, {
      handlers: this.getRegisteredNames(),
    });
  }

  /**
   * Get registry statistics
   */
  static getStats(): {
    totalHandlers: number;
    handlerNames: string[];
    initialized: boolean;
  } {
    return {
      totalHandlers: this.handlers.size,
      handlerNames: this.getRegisteredNames(),
      initialized: this.initialized,
    };
  }
}

/**
 * Convenience function to register a handler
 */
export function registerJobHandler<T extends BaseJobData>(
  config: JobHandlerConfig<T>,
  options?: { force?: boolean }
): void {
  JobHandlerRegistry.register(config, options);
}

/**
 * Convenience function to execute a handler
 */
export async function executeJobHandler<T extends BaseJobData>(
  name: string,
  jobId: string,
  data: T
): Promise<void> {
  return JobHandlerRegistry.execute(name, jobId, data);
}
