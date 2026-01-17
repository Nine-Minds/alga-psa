import { WorkflowWorker, WorkflowWorkerConfig, WorkerHealth } from './workflowWorker.js';
import { getWorkflowRuntime, TypeScriptWorkflowRuntime } from '@shared/workflow/core/index.js';
import { getActionRegistry } from '@shared/workflow/core/index.js';
import logger from '@alga-psa/core/logger';
import os from 'os';

/**
 * Configuration for the worker service
 */
export interface WorkerServiceConfig {
  /**
   * Number of worker instances to run
   * Default: Number of CPU cores
   */
  workerCount?: number;
  
  /**
   * Configuration for each worker instance
   */
  workerConfig?: Partial<WorkflowWorkerConfig>;
  
  /**
   * Whether to automatically start workers on service initialization
   * Default: true
   */
  autoStart?: boolean;
}

/**
 * Default worker service configuration
 */
const DEFAULT_CONFIG: Required<WorkerServiceConfig> = {
  workerCount: os.cpus().length,
  workerConfig: {},
  autoStart: true
};

/**
 * Service for managing workflow workers
 * Handles worker lifecycle, health monitoring, and scaling
 */
export class WorkerService {
  private workers: WorkflowWorker[] = [];
  private workflowRuntime: TypeScriptWorkflowRuntime;
  private config: Required<WorkerServiceConfig>;
  private isRunning: boolean = false;
  private healthCheckInterval?: NodeJS.Timeout;
  
  /**
   * Create a new worker service
   * @param config Worker service configuration
   */
  constructor(config: WorkerServiceConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    const actionRegistry = getActionRegistry();
    this.workflowRuntime = getWorkflowRuntime(actionRegistry);

    logger.info(`[WorkerService] Created worker service with ${this.config.workerCount} workers`);
    
    if (this.config.autoStart) {
      // Start workers in the next tick to allow for proper initialization
      process.nextTick(() => {
        this.start().catch(error => {
          logger.error('[WorkerService] Failed to auto-start workers:', error);
        });
      });
    }
  }
  
  /**
   * Start the worker service
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.info('[WorkerService] Worker service is already running');
      return;
    }
    
    logger.info(`[WorkerService] Starting worker service with ${this.config.workerCount} workers`);
    this.isRunning = true;
    
    try {
      // Start the specified number of workers
      const startPromises: Promise<void>[] = [];
      
      for (let i = 0; i < this.config.workerCount; i++) {
        startPromises.push(this.startWorker());
      }
      
      await Promise.all(startPromises);
      
      // Start health check interval
      this.startHealthCheck();
      
      logger.info(`[WorkerService] Worker service started with ${this.workers.length} workers`);
    } catch (error) {
      logger.error('[WorkerService] Failed to start worker service:', error);
      this.isRunning = false;
      throw error;
    }
  }
  
  /**
   * Stop the worker service
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.info('[WorkerService] Worker service is already stopped');
      return;
    }
    
    logger.info(`[WorkerService] Stopping worker service with ${this.workers.length} workers`);
    this.isRunning = false;
    
    // Stop health check interval
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
    
    // Stop all workers
    const stopPromises = this.workers.map(worker => worker.stop());
    await Promise.all(stopPromises);
    
    this.workers = [];
    logger.info('[WorkerService] Worker service stopped');
  }
  
  /**
   * Start a new worker
   */
  private async startWorker(): Promise<void> {
    // Cast the runtime to "any" before passing it to the WorkflowWorker constructor.
    //
    // The runtime instance is obtained from `getWorkflowRuntime` which returns the
    // `TypeScriptWorkflowRuntime` defined in the shared package. In the worker
    // service project the import is resolved via the compiled output found under
    // `shared/dist`, while within the `WorkflowWorker` module the same import is
    // resolved to the original TypeScript sources located under `shared/src`.
    //
    // Because the class contains a private member (`actionRegistry`) the two
    // distinct declarations are treated as *nominal* types by the TypeScript
    // compiler and are therefore incompatible even though they expose an
    // identical public surface.  A simple, safe way to bridge this compile-time
    // mismatch is to cast the instance to `any` at the call-site.  This keeps
    // full type-safety elsewhere in the code-base while unblocking the build.
    //
    // NOTE: At runtime there is only a single copy of the module, so this cast
    // does **not** impact behaviour – it merely appeases the TypeScript type
    // checker.
    const worker = new WorkflowWorker(this.workflowRuntime as any, this.config.workerConfig);
    await worker.start();
    this.workers.push(worker);
  }
  
  /**
   * Start the health check interval
   */
  private startHealthCheck(): void {
    // Check worker health every 30 seconds
    this.healthCheckInterval = setInterval(() => {
      this.checkWorkerHealth();
    }, 30000);
  }
  
  /**
   * Check the health of all workers and restart unhealthy ones
   */
  private async checkWorkerHealth(): Promise<void> {
    if (!this.isRunning) return;
    
    try {
      logger.debug(`[WorkerService] Checking health of ${this.workers.length} workers`);
      
      const unhealthyWorkers: WorkflowWorker[] = [];
      const healthStatuses: WorkerHealth[] = [];
      
      // Check each worker's health
      for (const worker of this.workers) {
        const health = worker.getHealth();
        healthStatuses.push(health);
        
        if (health.status === 'unhealthy') {
          unhealthyWorkers.push(worker);
        }
      }
      
      // Log overall health status
      const healthySummary = healthStatuses.filter(h => h.status === 'healthy').length;
      const degradedSummary = healthStatuses.filter(h => h.status === 'degraded').length;
      const unhealthySummary = healthStatuses.filter(h => h.status === 'unhealthy').length;
      
      logger.info(`[WorkerService] Worker health: ${healthySummary} healthy, ${degradedSummary} degraded, ${unhealthySummary} unhealthy`);
      
      // Restart unhealthy workers
      if (unhealthyWorkers.length > 0) {
        logger.warn(`[WorkerService] Restarting ${unhealthyWorkers.length} unhealthy workers`);
        
        for (const worker of unhealthyWorkers) {
          // Remove from workers array
          const index = this.workers.indexOf(worker);
          if (index !== -1) {
            this.workers.splice(index, 1);
          }
          
          try {
            // Stop the worker
            await worker.stop();
          } catch (error) {
            logger.error('[WorkerService] Error stopping unhealthy worker:', error);
          }
          
          // Start a new worker to replace it
          await this.startWorker();
        }
      }
      
      // Check if we need to scale workers
      if (this.workers.length < this.config.workerCount) {
        const missingWorkers = this.config.workerCount - this.workers.length;
        logger.info(`[WorkerService] Scaling up ${missingWorkers} missing workers`);
        
        for (let i = 0; i < missingWorkers; i++) {
          await this.startWorker();
        }
      }
    } catch (error) {
      logger.error('[WorkerService] Error in worker health check:', error);
    }
  }
  
  /**
   * Get the health status of all workers
   */
  getHealth(): {
    status: 'healthy' | 'degraded' | 'unhealthy';
    workerCount: number;
    healthyWorkers: number;
    degradedWorkers: number;
    unhealthyWorkers: number;
    workers: WorkerHealth[];
  } {
    const workerHealths = this.workers.map(worker => worker.getHealth());
    
    const healthyWorkers = workerHealths.filter(h => h.status === 'healthy').length;
    const degradedWorkers = workerHealths.filter(h => h.status === 'degraded').length;
    const unhealthyWorkers = workerHealths.filter(h => h.status === 'unhealthy').length;
    
    // Determine overall status
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    
    if (unhealthyWorkers > 0) {
      status = 'unhealthy';
    } else if (degradedWorkers > 0) {
      status = 'degraded';
    }
    
    // If we have fewer workers than configured, consider degraded
    if (this.workers.length < this.config.workerCount) {
      status = 'degraded';
    }
    
    // If no workers at all, consider unhealthy
    if (this.workers.length === 0) {
      status = 'unhealthy';
    }
    
    return {
      status,
      workerCount: this.workers.length,
      healthyWorkers,
      degradedWorkers,
      unhealthyWorkers,
      workers: workerHealths
    };
  }
  
  /**
   * Get statistics about processed events
   */
  getStatistics(): {
    totalEventsProcessed: number;
    totalEventsSucceeded: number;
    totalEventsFailed: number;
    activeEventCount: number;
  } {
    const workerHealths = this.workers.map(worker => worker.getHealth());
    
    return {
      totalEventsProcessed: workerHealths.reduce((sum, h) => sum + h.eventsProcessed, 0),
      totalEventsSucceeded: workerHealths.reduce((sum, h) => sum + h.eventsSucceeded, 0),
      totalEventsFailed: workerHealths.reduce((sum, h) => sum + h.eventsFailed, 0),
      activeEventCount: workerHealths.reduce((sum, h) => sum + h.activeEventCount, 0)
    };
  }
}

// Singleton instance
let workerServiceInstance: WorkerService | null = null;

/**
 * Get the worker service instance
 * @param config Worker service configuration
 * @returns The worker service instance
 */
export function getWorkerService(config?: WorkerServiceConfig): WorkerService {
  if (!workerServiceInstance) {
    workerServiceInstance = new WorkerService(config);
  }
  return workerServiceInstance;
}

/**
 * Start the worker service
 * @param config Worker service configuration
 * @returns The worker service instance
 */
export async function startWorkerService(config?: WorkerServiceConfig): Promise<WorkerService> {
  const service = getWorkerService(config);
  await service.start();
  return service;
}
