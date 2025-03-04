import { v4 as uuidv4 } from 'uuid';
import os from 'os';
import {
  getRedisStreamClient,
} from '@shared/workflow/streams/redisStreamClient.js';
import { TypeScriptWorkflowRuntime } from '@shared/workflow/core/index.js';

import logger from '@shared/core/logger.js';

// TODO: These utilities would need to be properly implemented or moved
// Currently they are in server/src/lib/workflow/util
const withRetry = async (fn: Function, options: any) => {
  return await fn();
};

const classifyError = (error: any, attempts?: number, options?: any) => {
  return {
    category: 'TRANSIENT',
    strategy: 'RETRY_IMMEDIATE',
    description: error instanceof Error ? error.message : String(error),
    isRetryable: true
  };
};

enum RecoveryStrategy {
  RETRY_IMMEDIATE = 'RETRY_IMMEDIATE',
  RETRY_WITH_BACKOFF = 'RETRY_WITH_BACKOFF',
  MANUAL_INTERVENTION = 'MANUAL_INTERVENTION'
}

enum ErrorCategory {
  TRANSIENT = 'TRANSIENT',
  RECOVERABLE = 'RECOVERABLE',
  PERMANENT = 'PERMANENT'
}

/**
 * Configuration options for the workflow worker
 */
export interface WorkflowWorkerConfig {
  pollIntervalMs: number;
  idleTimeoutMs: number;
  batchSize: number;
  maxRetries: number;
  healthCheckIntervalMs: number;
  metricsReportingIntervalMs: number;
  concurrencyLimit: number;
  shutdownTimeoutMs: number;
}

/**
 * Default configuration for workflow worker
 */
const DEFAULT_CONFIG: WorkflowWorkerConfig = {
  pollIntervalMs: 1000,
  idleTimeoutMs: 60000,
  batchSize: 10,
  maxRetries: 3,
  healthCheckIntervalMs: 30000,
  metricsReportingIntervalMs: 60000,
  concurrencyLimit: 5,
  shutdownTimeoutMs: 30000
};

/**
 * Health status of the worker
 */
export interface WorkerHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  workerId: string;
  uptime: number;
  eventsProcessed: number;
  eventsSucceeded: number;
  eventsFailed: number;
  lastError?: string;
  lastErrorTime?: string;
  activeEventCount: number;
  memoryUsage: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
  };
}

/**
 * Worker service that processes workflow events from Redis Streams
 * 
 * This is a simplified implementation that will be enhanced with proper database
 * integration in the future.
 */
export class WorkflowWorker {
  private running: boolean = false;
  private workerId: string;
  private redisStreamClient = getRedisStreamClient();
  private workflowRuntime: TypeScriptWorkflowRuntime;
  private config: WorkflowWorkerConfig;
  private startTime: number = Date.now();
  private activeEventCount: number = 0;
  private healthCheckInterval?: NodeJS.Timeout;
  private metricsReportingInterval?: NodeJS.Timeout;
  private activePromises: Set<Promise<void>> = new Set();
  
  // Metrics
  private eventsProcessed: number = 0;
  private eventsSucceeded: number = 0;
  private eventsFailed: number = 0;
  private lastError?: Error;
  private lastErrorTime?: Date;
  private processingTimes: number[] = [];
  
  /**
   * Create a new workflow worker
   * @param workflowRuntime Workflow runtime instance
   * @param config Worker configuration
   */
  constructor(workflowRuntime: TypeScriptWorkflowRuntime, config: Partial<WorkflowWorkerConfig> = {}) {
    this.workflowRuntime = workflowRuntime;
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Generate a unique worker ID based on hostname, process ID, and a random UUID
    this.workerId = `${os.hostname()}-${process.pid}-${uuidv4().substring(0, 8)}`;
    
    logger.info(`[WorkflowWorker] Created worker with ID: ${this.workerId}`);
  }
  
  /**
   * Start the worker
   */
  async start(): Promise<void> {
    if (this.running) {
      logger.info(`[WorkflowWorker] Worker ${this.workerId} is already running`);
      return;
    }
    
    this.running = true;
    this.startTime = Date.now();
    logger.info(`[WorkflowWorker] Starting worker ${this.workerId}`);
    
    try {
      // Initialize Redis Stream client
      await this.redisStreamClient.initialize();
      
      // Set up signal handlers for graceful shutdown
      this.setupSignalHandlers();
      
      // Start health check interval
      this.startHealthCheck();
      
      // Start metrics reporting interval
      this.startMetricsReporting();
      
      // This is a simplified version for now
      // The actual implementation would include processing events from the database
      // or Redis Streams
      
      logger.info(`[WorkflowWorker] Worker ${this.workerId} started successfully`);
    } catch (error) {
      logger.error(`[WorkflowWorker] Failed to start worker ${this.workerId}:`, error);
      this.running = false;
      throw error;
    }
  }
  
  /**
   * Stop the worker
   */
  async stop(): Promise<void> {
    if (!this.running) {
      logger.info(`[WorkflowWorker] Worker ${this.workerId} is already stopped`);
      return;
    }
    
    logger.info(`[WorkflowWorker] Stopping worker ${this.workerId}`);
    this.running = false;
    
    // Stop health check interval
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
    
    // Stop metrics reporting interval
    if (this.metricsReportingInterval) {
      clearInterval(this.metricsReportingInterval);
      this.metricsReportingInterval = undefined;
    }
    
    // Wait for active event processing to complete with timeout
    if (this.activePromises.size > 0) {
      logger.info(`[WorkflowWorker] Waiting for ${this.activePromises.size} active events to complete`);
      
      try {
        const timeoutPromise = new Promise<void>((_, reject) => {
          setTimeout(() => reject(new Error('Shutdown timeout exceeded')), this.config.shutdownTimeoutMs);
        });
        
        const allPromises = Promise.all(Array.from(this.activePromises));
        await Promise.race([allPromises, timeoutPromise]);
        
        logger.info(`[WorkflowWorker] All active events completed successfully`);
      } catch (error) {
        logger.warn(`[WorkflowWorker] Shutdown timeout exceeded, some events may not have completed processing`);
      }
    }
    
    // Stop the Redis Stream client consumer
    this.redisStreamClient.stopConsumer();
    
    // Close Redis connection
    await this.redisStreamClient.close();
    
    logger.info(`[WorkflowWorker] Worker ${this.workerId} stopped`);
  }
  
  /**
   * Get the health status of the worker
   */
  getHealth(): WorkerHealth {
    const memoryUsage = process.memoryUsage();
    const uptime = Date.now() - this.startTime;
    
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    
    // Determine health status based on metrics
    if (this.lastError && Date.now() - (this.lastErrorTime?.getTime() || 0) < 5 * 60 * 1000) {
      // Error in the last 5 minutes
      status = 'degraded';
    }
    
    if (this.activeEventCount >= this.config.concurrencyLimit) {
      // Worker is at capacity
      status = 'degraded';
    }
    
    if (!this.running) {
      status = 'unhealthy';
    }
    
    return {
      status,
      workerId: this.workerId,
      uptime,
      eventsProcessed: this.eventsProcessed,
      eventsSucceeded: this.eventsSucceeded,
      eventsFailed: this.eventsFailed,
      lastError: this.lastError?.message,
      lastErrorTime: this.lastErrorTime?.toISOString(),
      activeEventCount: this.activeEventCount,
      memoryUsage: {
        rss: memoryUsage.rss,
        heapTotal: memoryUsage.heapTotal,
        heapUsed: memoryUsage.heapUsed,
        external: memoryUsage.external
      }
    };
  }
  
  /**
   * Start the health check interval
   */
  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(() => {
      try {
        const health = this.getHealth();
        
        logger.debug(`[WorkflowWorker] Health check: ${health.status}`);
        
        // If health is degraded or unhealthy, log at a higher level
        if (health.status !== 'healthy') {
          logger.warn(`[WorkflowWorker] Worker health degraded: ${health.status}`);
        }
      } catch (error) {
        logger.error(`[WorkflowWorker] Error in health check:`, error);
      }
    }, this.config.healthCheckIntervalMs);
  }
  
  /**
   * Start the metrics reporting interval
   */
  private startMetricsReporting(): void {
    this.metricsReportingInterval = setInterval(() => {
      try {
        // Calculate average processing time
        const avgProcessingTime = this.processingTimes.length > 0
          ? this.processingTimes.reduce((sum, time) => sum + time, 0) / this.processingTimes.length
          : 0;
        
        // Reset processing times array to avoid unbounded growth
        this.processingTimes = [];
        
        logger.info(`[WorkflowWorker] Metrics report`, {
          workerId: this.workerId,
          eventsProcessed: this.eventsProcessed,
          eventsSucceeded: this.eventsSucceeded,
          eventsFailed: this.eventsFailed,
          activeEventCount: this.activeEventCount,
          avgProcessingTimeMs: avgProcessingTime,
          uptime: Date.now() - this.startTime
        });
      } catch (error) {
        logger.error(`[WorkflowWorker] Error in metrics reporting:`, error);
      }
    }, this.config.metricsReportingIntervalMs);
  }
  
  /**
   * Set up signal handlers for graceful shutdown
   */
  private setupSignalHandlers(): void {
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    
    for (const signal of signals) {
      process.on(signal, async () => {
        logger.info(`[WorkflowWorker] Received ${signal}, shutting down gracefully...`);
        await this.stop();
      });
    }
  }
}
