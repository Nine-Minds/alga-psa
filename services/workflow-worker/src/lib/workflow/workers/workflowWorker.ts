import { v4 as uuidv4 } from 'uuid';
import os from 'os';
import logger from '@alga-psa/core/logger';
import { getRedisStreamClient } from '@shared/workflow/streams/redisStreamClient';
import { TypeScriptWorkflowRuntime, ProcessQueuedEventParams } from 'shared/workflow/core/index';
import WorkflowEventProcessingModel from '@shared/workflow/persistence/workflowEventProcessingModel';
import { withRetry, classifyError, RecoveryStrategy, ErrorCategory } from 'shared/utils/retryUtils';
import knex, { Knex } from 'knex';
import { getConnection } from '@alga-psa/db/connection';

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

interface WorkflowEvent {
  event_id: string;
  execution_id: string;
  processing_id: string;
  tenant: string;
}

/**
 * Worker service that processes workflow events from Redis Streams
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
    
    logger.info(`[WorkflowWorker] Created worker with ID: ${this.workerId}`, {
      workerId: this.workerId,
      config: this.config
    });
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
      
      // Subscribe to the global event stream
      await this.subscribeToGlobalEventStream();
      
      // Start processing loop
      this.processingLoop();
      
      logger.info(`[WorkflowWorker] Listening to global event stream: workflow:events:global`);
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
        
        logger.debug(`[WorkflowWorker] Health check: ${health.status}`, {
          workerId: this.workerId,
          health
        });
        
        // If health is degraded or unhealthy, log at a higher level
        if (health.status !== 'healthy') {
          logger.warn(`[WorkflowWorker] Worker health degraded: ${health.status}`, {
            workerId: this.workerId,
            health
          });
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
   * Main processing loop
   */
  private async processingLoop(): Promise<void> {
    const dbConnection = await getConnection();
    while (this.running) {
      try {
        // Use withRetry for resilient processing
        await withRetry(async () => {
          // First, check for pending events in the database that need to be processed (for all tenants)
          const pendingEvents = await WorkflowEventProcessingModel.getPendingEvents(this.config.batchSize);
          
          if (pendingEvents.length > 0) {
            logger.info(`[WorkflowWorker] Processing ${pendingEvents.length} pending events from database`, {
              workerId: this.workerId,
              eventCount: pendingEvents.length
            });
            
            // Process each pending event with concurrency control
            await this.processBatch(pendingEvents, async (event: WorkflowEvent) => {
              await this.processEvent(dbConnection, event.event_id, event.execution_id, event.processing_id, event.tenant);
            });
          }
          
          // Then, check for events that need to be retried across all tenants
          const eventsToRetry = await WorkflowEventProcessingModel.getEventsToRetry(
            dbConnection,
            this.config.batchSize,
            this.config.maxRetries
          );
          
          if (eventsToRetry.length > 0) {
            logger.info(`[WorkflowWorker] Retrying ${eventsToRetry.length} failed events`, {
              workerId: this.workerId,
              eventCount: eventsToRetry.length
            });
            
            // Process each event to retry with concurrency control
            await this.processBatch(eventsToRetry, async (event: WorkflowEvent) => {
              await WorkflowEventProcessingModel.markAsRetrying(dbConnection, event.tenant, event.processing_id, this.workerId);
              await this.processEvent(dbConnection, event.event_id, event.execution_id, event.processing_id, event.tenant);
            });
          }
          
          // If no events were processed, wait before polling again
          if (pendingEvents.length === 0 && eventsToRetry.length === 0) {
            await new Promise(resolve => setTimeout(resolve, this.config.pollIntervalMs));
          }
        }, {
          maxRetries: 3,
          initialDelayMs: 1000,
          maxDelayMs: 10000
        });
      } catch (error) {
        // Classify the error to determine recovery strategy
        const classification = classifyError(error);
        
        // Update error metrics
        this.lastError = error instanceof Error ? error : new Error(String(error));
        this.lastErrorTime = new Date();
        
        logger.error(`[WorkflowWorker] Error in processing loop:`, {
          workerId: this.workerId,
          error,
          category: classification.category,
          strategy: classification.strategy,
          description: classification.description
        });
        
        // Wait before retrying to avoid tight loop on persistent errors
        const delayMs = classification.strategy === RecoveryStrategy.RETRY_IMMEDIATE ? 1000 : 5000;
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  
  /**
   * Process a batch of events with concurrency control
   */
  private async processBatch<T>(
    items: T[],
    processor: (item: T) => Promise<void>
  ): Promise<void> {
    // Create a queue of items to process
    const queue = [...items];
    const activePromises: Promise<void>[] = [];
    const promiseStates = new Map<Promise<void>, 'pending' | 'completed'>();
    
    // Process items with concurrency limit
    while (queue.length > 0 && this.running) {
      // If we're at the concurrency limit, wait for a slot to open up
      if (activePromises.length >= this.config.concurrencyLimit) {
        await Promise.race(activePromises);
        
        // Remove completed promises
        for (let i = activePromises.length - 1; i >= 0; i--) {
          const promise = activePromises[i];
          if (promiseStates.get(promise) === 'completed') {
            activePromises.splice(i, 1);
            promiseStates.delete(promise);
          }
        }
      }
      
      // Process the next item if we're still running
      if (this.running && queue.length > 0) {
        const item = queue.shift()!;
        const promise = this.trackPromise(processor(item));
        activePromises.push(promise);
        promiseStates.set(promise, 'pending');
        
        // Update promise state when it completes
        promise.finally(() => {
          promiseStates.set(promise, 'completed');
        });
      }
    }
    
    // Wait for all active promises to complete
    if (activePromises.length > 0) {
      await Promise.allSettled(activePromises);
    }
  }
  
  /**
   * Track a promise for concurrency control and cleanup
   */
  private trackPromise<T>(promise: Promise<T>): Promise<T> {
    // Add the promise to the active set
    this.activePromises.add(promise as unknown as Promise<void>);
    this.activeEventCount++;
    
    // Return a wrapped promise that removes itself from the active set when done
    return promise.finally(() => {
      this.activePromises.delete(promise as unknown as Promise<void>);
      this.activeEventCount--;
    });
  }
  
  /**
   * Process a single event
   */
  private async processEvent(
    knex: Knex,
    eventId: string,
    executionId: string,
    processingId: string,
    tenant: string
  ): Promise<void> {
    const startTime = Date.now();
    this.eventsProcessed++;
    
    // Log when an event is received
    logger.info(`[WorkflowWorker] Received event ${eventId} for processing`, {
      workerId: this.workerId,
      eventId,
      executionId,
      tenant,
      event_name: 'unknown' // Will be updated when we load the event
    });
    
    try {
      // Create parameters for processing the queued event
      const params: ProcessQueuedEventParams = {
        eventId,
        executionId,
        processingId,
        workerId: this.workerId,
        tenant
      };
      
      // Process the event using the workflow runtime with retry
      await withRetry(
        async () => {
          // Log that we're about to process the event
          logger.info(`[WorkflowWorker] Processing event ${eventId} with workflow runtime`, {
            workerId: this.workerId,
            eventId,
            executionId,
            tenant
          });
          
          const result = await this.workflowRuntime.processQueuedEvent(knex, params);
          
          if (!result.success) {
            // Log that no workflow was found or execution failed
            if (result.errorMessage && result.errorMessage.includes("No workflow found")) {
              logger.warn(`[WorkflowWorker] No workflow found for event ${eventId}`, {
                workerId: this.workerId,
                eventId,
                executionId,
                tenant,
                error: result.errorMessage,
                message: "The system received an event but could not find a workflow to execute in response"
              });
            } else {
              logger.error(`[WorkflowWorker] Failed to process event ${eventId}: ${result.errorMessage}`, {
                workerId: this.workerId,
                eventId,
                executionId,
                tenant,
                error: result.errorMessage,
                message: "The system found a workflow but encountered an error while executing it"
              });
            }
            // Throw an error to trigger retry if needed
            throw new Error(result.errorMessage);
          } else {
            // Log successful workflow execution
            logger.info(`[WorkflowWorker] Successfully processed event ${eventId} with workflow`, {
              workerId: this.workerId,
              eventId,
              executionId,
              tenant,
              previousState: result.previousState,
              currentState: result.currentState,
              actionsExecuted: result.actionsExecuted.map((action: { actionName: string }) => action.actionName),
              message: "The system found a workflow to execute in response to the event and successfully processed it"
            });
            
            this.eventsSucceeded++;
          }
        },
        {
          maxRetries: this.config.maxRetries,
          initialDelayMs: 1000
        }
      );
      
      // Record processing time
      const processingTime = Date.now() - startTime;
      this.processingTimes.push(processingTime);
      
      logger.debug(`[WorkflowWorker] Event processing completed in ${processingTime}ms`, {
        workerId: this.workerId,
        eventId,
        executionId,
        processingTime
      });
    } catch (error) {
      // Record failure
      this.eventsFailed++;
      
      // Classify the error to determine recovery strategy
      const classification = classifyError(error, 0, {
        maxRetries: this.config.maxRetries
      });
      
      // Update error metrics
      this.lastError = error instanceof Error ? error : new Error(String(error));
      this.lastErrorTime = new Date();
      
      logger.error(`[WorkflowWorker] Error processing event ${eventId}:`, {
        workerId: this.workerId,
        eventId,
        executionId,
        error,
        category: classification.category,
        strategy: classification.strategy,
        description: classification.description,
        processingTime: Date.now() - startTime
      });
      
      // If the error is permanent, mark the event as failed
      if (
        classification.category === ErrorCategory.PERMANENT ||
        !classification.isRetryable
      ) {
        try {
          await WorkflowEventProcessingModel.markAsFailed(
            knex,
            tenant,
            processingId,
            classification.description
          );
          logger.info(`[WorkflowWorker] Marked event ${eventId} as permanently failed`, {
            workerId: this.workerId,
            eventId,
            executionId,
            reason: classification.description
          });
        } catch (markError) {
          logger.error(`[WorkflowWorker] Failed to mark event ${eventId} as failed:`, {
            workerId: this.workerId,
            eventId,
            executionId,
            error: markError
          });
        }
      }
    }
  }
  
  /**
   * Set up signal handlers for graceful shutdown
   */
  private setupSignalHandlers(): void {
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    
    for (const signal of signals) {
      process.on(signal, async () => {
        logger.info(`[WorkflowWorker] Received ${signal}, shutting down gracefully...`, {
          workerId: this.workerId,
          signal
        });
        await this.stop();
        process.exit(0);
      });
    }
  }

  /**
   * Subscribe to the global event stream
   * This stream contains all events that need to be processed by workflows
   */
  private async subscribeToGlobalEventStream(): Promise<void> {
    const streamName = 'workflow:events:global';
    const consumerGroup = 'workflow-workers';
    
    try {
      // Create a stream name for the consumer group
      const streamKey = `${streamName}`;
      
      try {
        // Try to create the consumer group
        const redis = require('redis');
        const client = redis.createClient({
          url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || '6379'}`
        });
        
        await client.connect();
        
        try {
          logger.info(`[WorkflowWorker] Creating consumer group ${consumerGroup} for stream: ${streamKey}`);
          await client.xGroupCreate(streamKey, consumerGroup, '0', {
            MKSTREAM: true
          });
          logger.info(`[WorkflowWorker] Successfully created consumer group for stream: ${streamKey}`);
        } catch (err: any) {
          if (err.message && err.message.includes('BUSYGROUP')) {
            logger.info(`[WorkflowWorker] Consumer group already exists for stream: ${streamKey}`);
          } else {
            logger.error(`[WorkflowWorker] Error in xGroupCreate:`, err);
            throw err;
          }
        } finally {
          await client.quit();
        }
      } catch (err: any) {
        logger.error(`[WorkflowWorker] Error creating consumer group:`, err);
        throw err;
      }
      
      // Register a consumer for the global event stream
      this.redisStreamClient.registerConsumer(
        streamName,
        this.processGlobalEvent.bind(this)
      );
      
      logger.info(`[WorkflowWorker] Subscribed to global event stream: ${streamName}`);
    } catch (error: any) {
      logger.error(`[WorkflowWorker] Failed to subscribe to global event stream:`, error);
      throw error;
    }
  }
  
  /**
   * Process a global event from Redis Streams
   * This method is called when a new event is received from the global event stream
   *
   * @param event The workflow event to process
   */
  private async processGlobalEvent(event: any): Promise<void> {
    try {
      // The event might be wrapped in an 'event' property if it came from the EventBus
      const eventData = event.event ? JSON.parse(event.event) : event;
      
      logger.info(`[WorkflowWorker] Processing global event of type ${eventData.eventType}`, {
        eventId: eventData.id,
        eventType: eventData.eventType,
        payload: eventData.payload
      });
      
      // Extract tenant from the payload
      const tenant = eventData.payload?.tenant;
      if (!tenant) {
        logger.error(`[WorkflowWorker] Event is missing tenant ID, cannot process`);
        return;
      }
      
      // Find workflows attached to this event type
      const dbConnection = await getConnection();
      const attachments = await dbConnection('workflow_event_attachments as wea')
        .join('event_catalog as ec', function(this: any) {
          this.on('wea.event_id', 'ec.event_id')
              .andOn('wea.tenant', 'ec.tenant');
        })
        .where({
          'ec.event_type': eventData.eventType,
          'wea.tenant': tenant,
          'wea.is_active': true
        })
        .select('wea.workflow_id');
      
      const workflowIds = attachments.map((attachment: any) => attachment.workflow_id);
      
      if (workflowIds.length === 0) {
        logger.info(`[WorkflowWorker] No workflows attached to event type ${eventData.eventType}`);
        return;
      }
      
      logger.info(`[WorkflowWorker] Found ${workflowIds.length} workflows attached to event type ${eventData.eventType}`, {
        workflowIds,
        eventType: eventData.eventType,
        tenant
      });
      
      // Create a workflow event record in the database
      const workflowEvent = {
        event_id: eventData.id,
        tenant: tenant,
        event_name: eventData.payload?.eventName || eventData.eventType,
        event_type: eventData.eventType,
        from_state: 'initial',
        to_state: 'pending',
        user_id: eventData.payload?.userId,
        payload: eventData.payload || {},
        created_at: new Date().toISOString()
      };
      
      // Persist the event to the database for event sourcing
      try {
        await dbConnection('workflow_events').insert(workflowEvent);
        logger.info(`[WorkflowWorker] Persisted event ${eventData.id} to database for event sourcing`);
      } catch (error) {
        logger.error(`[WorkflowWorker] Error persisting event ${eventData.id} to database:`, error);
        // Continue processing even if persistence fails
      }
      
      // Start each attached workflow
      for (const workflowId of workflowIds) {
        try {
          // Get the workflow registration and its current version
          const registration = await dbConnection('workflow_registrations as wr')
            .join('workflow_registration_versions as wrv', function(this: any) {
              this.on('wrv.registration_id', '=', 'wr.registration_id')
                  .andOn('wrv.is_current', '=', dbConnection.raw('true'));
            })
            .where({
              'wr.workflow_id': workflowId,
              'wr.tenant': tenant
            })
            .select('wr.*', 'wrv.version_id')
            .first();
          
          if (!registration) {
            logger.error(`[WorkflowWorker] Workflow ${workflowId} not found`);
            continue;
          }
          
          // Start the workflow
          const result = await this.workflowRuntime.startWorkflowByVersionId(dbConnection, {
            tenant: tenant,
            initialData: {
              eventId: eventData.id,
              eventType: eventData.eventType,
              eventName: eventData.payload?.eventName || eventData.eventType,
              eventPayload: eventData.payload || {},
              triggerEvent: eventData,
              workflowId: workflowId,
              versionId: registration.version_id
            },
            userId: eventData.payload?.userId,
            versionId: registration.version_id,
            isSystemManaged: false
          });
          
          logger.info(`[WorkflowWorker] Started workflow ${registration.name} with execution ID ${result.executionId}`, {
            workflowId,
            workflowName: registration.name,
            executionId: result.executionId,
            eventId: eventData.id
          });
          
          // Submit the original event to the workflow
          await this.workflowRuntime.submitEvent(dbConnection, {
            execution_id: result.executionId,
            event_name: workflowEvent.event_name,
            payload: workflowEvent.payload,
            user_id: workflowEvent.user_id,
            tenant: workflowEvent.tenant
          });
          
          logger.info(`[WorkflowWorker] Submitted event to workflow execution ${result.executionId}`);
        } catch (error) {
          logger.error(`[WorkflowWorker] Error starting workflow ${workflowId} from event:`, error);
        }
      }
    } catch (error) {
      logger.error(`[WorkflowWorker] Error processing global event:`, error);
      // Don't rethrow the error to allow processing to continue
    }
  }
}

/**
 * Create and start a new workflow worker
 * @param workflowRuntime Workflow runtime instance
 * @param config Worker configuration
 * @returns The started worker instance
 */
export async function startWorkflowWorker(
  workflowRuntime: TypeScriptWorkflowRuntime,
  config: Partial<WorkflowWorkerConfig> = {}
): Promise<WorkflowWorker> {
  const worker = new WorkflowWorker(workflowRuntime, config);
  await worker.start();
  return worker;
}
