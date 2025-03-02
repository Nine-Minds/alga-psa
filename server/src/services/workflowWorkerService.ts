import { getWorkflowRuntime } from '../lib/workflow/core/workflowRuntime';
import { getActionRegistry } from '../lib/workflow/core/actionRegistry';
import { WorkflowWorker } from '../lib/workflow/workers/workflowWorker';
import { workflowConfig } from '../config/workflowConfig';
import logger from '../utils/logger';

/**
 * Service for managing workflow worker instances
 * This service is responsible for starting and stopping worker instances
 * that process events from Redis Streams
 */
export class WorkflowWorkerService {
  private workers: WorkflowWorker[] = [];
  private workerCount: number;
  
  /**
   * Create a new workflow worker service
   * @param workerCount Number of worker instances to run
   */
  constructor(workerCount: number = workflowConfig.workerCount) {
    this.workerCount = workerCount;
  }
  
  /**
   * Start the workflow worker service
   * This will start the specified number of worker instances
   */
  async start(): Promise<void> {
    if (!workflowConfig.distributedMode) {
      logger.info('[WorkflowWorkerService] Distributed mode is disabled, not starting workers');
      return;
    }
    
    logger.info(`[WorkflowWorkerService] Starting ${this.workerCount} workflow workers`);
    
    try {
      // Initialize action registry and workflow runtime
      const actionRegistry = getActionRegistry();
      const workflowRuntime = getWorkflowRuntime(actionRegistry);
      
      // Start worker instances
      for (let i = 0; i < this.workerCount; i++) {
        const worker = new WorkflowWorker(workflowRuntime);
        await worker.start();
        this.workers.push(worker);
        logger.info(`[WorkflowWorkerService] Started worker ${i + 1} of ${this.workerCount}`);
      }
      
      logger.info('[WorkflowWorkerService] All workflow workers started successfully');
    } catch (error) {
      logger.error('[WorkflowWorkerService] Failed to start workflow workers:', error);
      throw error;
    }
  }
  
  /**
   * Stop the workflow worker service
   * This will stop all worker instances
   */
  async stop(): Promise<void> {
    if (this.workers.length === 0) {
      return;
    }
    
    logger.info(`[WorkflowWorkerService] Stopping ${this.workers.length} workflow workers`);
    
    // Stop all workers
    await Promise.all(this.workers.map(async (worker) => {
      try {
        await worker.stop();
      } catch (error) {
        logger.error('[WorkflowWorkerService] Error stopping worker:', error);
      }
    }));
    
    this.workers = [];
    logger.info('[WorkflowWorkerService] All workflow workers stopped');
  }
}

// Singleton instance
let workerService: WorkflowWorkerService | null = null;

/**
 * Get the workflow worker service instance
 * @param workerCount Number of worker instances to run
 * @returns The workflow worker service instance
 */
export function getWorkflowWorkerService(workerCount?: number): WorkflowWorkerService {
  if (!workerService) {
    workerService = new WorkflowWorkerService(workerCount);
  }
  return workerService;
}