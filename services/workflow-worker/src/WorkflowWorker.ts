import { v4 as uuidv4 } from 'uuid';
import os from 'os';
import {
  getRedisStreamClient,
  RedisStreamClient
} from '@shared/workflow/streams/redisStreamClient.js';
import { WorkflowEventBase, WorkflowEventBaseSchema } from '@shared/workflow/streams/workflowEventSchema.js';
import { TypeScriptWorkflowRuntime } from '@shared/workflow/core/index.js';
import { createClient } from 'redis';
import logger from '@shared/core/logger.js';
import { getSecret } from '@shared/core/getSecret.js';
import { getAdminConnection } from '@shared/db/admin.js';

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
  private static createdConsumerGroups: Set<string> = new Set<string>();
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
      
      // Start processing events from Redis Streams
      await this.startEventProcessing();
      
      // Log that we're listening to the global event stream
      logger.info(`[WorkflowWorker] Listening to global event stream: workflow:events:global (registered as 'global')`);
      
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
    // Stop event processing
    await this.stopEventProcessing();
    
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
  /**
   * Start processing events from Redis Streams
   * This method sets up event processing from Redis Streams and database
   */
  private async startEventProcessing(): Promise<void> {
    logger.info(`[WorkflowWorker] Starting event processing`);
    
    try {
      // Subscribe to the global event stream for new events
      await this.subscribeToGlobalEventStream();
      
      // Process any pending events from the database
      await this.processPendingEvents();
      
      logger.info(`[WorkflowWorker] Event processing started successfully`);
      logger.info(`[WorkflowWorker] Listening to global event stream: workflow:events:global`);
    } catch (error) {
      logger.error(`[WorkflowWorker] Failed to start event processing:`, error);
      throw error;
    }
  }
  
  /**
   * Stop event processing
   */
  private async stopEventProcessing(): Promise<void> {
    logger.info(`[WorkflowWorker] Stopping event processing`);
    
    // Unsubscribe from all event streams
    // The Redis client will handle this when closed
  }
  
  /**
   * Subscribe to the global event stream
   * This stream contains all events that need to be processed by workflows
   */
  private async subscribeToGlobalEventStream(): Promise<void> {
    // Use 'global' as the stream name - the RedisStreamClient will add the 'workflow:events:' prefix
    const streamName = 'global';
    const consumerGroup = 'workflow-workers';
    
    try {
      // Create a stream name for the consumer group
      // Note: We don't add the prefix here because the RedisStreamClient will add it
      const streamKey = streamName;
      
      try {
        // Try to create the consumer group
        // Since getClient is private in RedisStreamClient, we'll use a workaround
        // by initializing the client first and then using Redis commands directly
        await this.redisStreamClient.initialize();
        
        // Use the Redis client through a custom method
        await this.createConsumerGroup(streamKey, consumerGroup);
        logger.info(`[WorkflowWorker] Created consumer group for stream: ${streamKey}`);
      } catch (err: any) {
        if (err.message && err.message.includes('BUSYGROUP')) {
          logger.info(`[WorkflowWorker] Consumer group already exists for stream: ${streamKey}`);
        } else {
          logger.error(`[WorkflowWorker] Error creating consumer group:`, err);
          throw err;
        }
      }
      
      // Register a consumer for the global event stream
      this.redisStreamClient.registerConsumer(
        streamName,
        this.processGlobalEvent.bind(this)
      );
      
      logger.info(`[WorkflowWorker] Subscribed to global event stream: ${streamName}`);
    } catch (error) {
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
  private async processGlobalEvent(event: WorkflowEventBase): Promise<void> {
    try {
      // The event is already parsed by the RedisStreamClient
      const eventData = event;
      
      // Validate the event against the WorkflowEventBaseSchema
      try {
        WorkflowEventBaseSchema.parse(eventData);
      } catch (validationError) {
        logger.error(`[WorkflowWorker] Invalid event format:`, validationError);
        throw new Error(`Invalid event format: ${validationError instanceof Error ? validationError.message : String(validationError)}`);
      }
      
      // Now we know the event has the correct structure
      logger.info(`[WorkflowWorker] Processing global event of type ${eventData.event_type}`, {
        eventId: eventData.event_id,
        eventType: eventData.event_type,
        payload: eventData.payload
      });
      
      // Extract tenant from the event
      const tenant = eventData.tenant;
      if (!tenant) {
        logger.error(`[WorkflowWorker] Event is missing tenant ID, cannot process`);
        return;
      }
      
      // Find workflows attached to this event type
      const attachedWorkflows = await this.findAttachedWorkflows(eventData.event_type, tenant);
      
      if (attachedWorkflows.length === 0) {
        logger.info(`[WorkflowWorker] No workflows attached to event type ${eventData.event_type}`);
        return;
      }
      
      // Start each attached workflow
      for (const workflowId of attachedWorkflows) {
        await this.startWorkflowFromEvent(workflowId, {
          event_id: eventData.event_id,
          event_type: eventData.event_type,
          event_name: eventData.event_name,
          tenant: eventData.tenant,
          user_id: eventData.user_id,
          payload: eventData.payload
        });
      }
    } catch (error) {
      logger.error(`[WorkflowWorker] Error processing global event:`, error);
      // Don't rethrow the error to allow processing to continue
    }
  }
  
  /**
   * Find workflows attached to an event type
   *
   * @param eventType The event type
   * @param tenant The tenant ID
   * @returns Array of workflow IDs
   */
  private async findAttachedWorkflows(eventType: string, tenant: string): Promise<string[]> {
    try {
      logger.info(`[WorkflowWorker] Finding workflows attached to event type ${eventType} for tenant ${tenant}`);
      
      
      // Get a database connection
      const db = await getAdminConnection();
      // Query the workflow_event_attachments table
      const attachments = await db('workflow_event_attachments as wea')
        .join('event_catalog as ec', function(this: any) {
          this.on('wea.event_id', 'ec.event_id')
              .andOn('wea.tenant_id', 'ec.tenant_id');
        })
        .where({
          'ec.event_type': eventType,
          'wea.tenant_id': tenant,
          'wea.is_active': true
        })
        .select('wea.workflow_id');
      
      // Extract workflow IDs (these are registration_id values in workflow_registrations)
      const workflowIds = attachments.map((attachment: any) => attachment.workflow_id);
      
      logger.info(`[WorkflowWorker] Found ${workflowIds.length} workflows attached to event type ${eventType}`, {
        workflowIds,
        eventType,
        tenant
      });
      
      return workflowIds;
    } catch (error) {
      logger.error(`[WorkflowWorker] Error finding attached workflows for event type ${eventType}:`, error);
      return [];
    }
  }
  
  /**
   * Start a workflow from an event
   *
   * @param workflowId The workflow ID
   * @param event The event that triggered the workflow
   */
  private async startWorkflowFromEvent(workflowId: string, event: any): Promise<void> {
    try {
      logger.info(`[WorkflowWorker] Starting workflow ${workflowId} from event`, {
        workflowId,
        eventId: event.event_id,
        eventType: event.event_type,
        tenant: event.tenant
      });
      
      // Get the workflow registration
      const workflow = await this.getWorkflowRegistration(workflowId, event.tenant);
      
      if (!workflow) {
        logger.error(`[WorkflowWorker] Workflow ${workflowId} not found`);
        return;
      }
      
      // Log the workflow details for debugging
      logger.info(`[WorkflowWorker] Found workflow registration:`, {
        workflowId,
        name: workflow.name,
        definition: workflow.definition ? 'present' : 'missing'
      });
      
      // Get a database connection
      const db = await getAdminConnection();
      
      // Log the workflow details
      logger.info(`[WorkflowWorker] Starting workflow by version ID: ${workflow.version_id}`, {
        workflowId,
        workflowName: workflow.name,
        version_id: workflow.version_id,
        definitionMetadata: workflow.definition?.metadata
      });
      
      // Start the workflow using the version ID
      const result = await this.workflowRuntime.startWorkflowByVersionId(db, {
        tenant: event.tenant,
        initialData: {
          eventId: event.event_id,
          eventType: event.event_type,
          eventName: event.event_name,
          eventPayload: event.payload || {},
          triggerEvent: event
        },
        userId: event.user_id,
        versionId: workflow.version_id // Pass the version_id
      });
      
      logger.info(`[WorkflowWorker] Started workflow ${workflow.name} with execution ID ${result.executionId}`, {
        workflowId,
        workflowName: workflow.name,
        executionId: result.executionId,
        eventId: event.event_id
      });
      
      // Submit the original event to the workflow
      await this.workflowRuntime.submitEvent(db, {
        execution_id: result.executionId,
        event_name: event.event_name,
        payload: event.payload,
        user_id: event.user_id,
        tenant: event.tenant
      });
      
      logger.info(`[WorkflowWorker] Submitted event ${event.event_name} to workflow execution ${result.executionId}`);
    } catch (error) {
      logger.error(`[WorkflowWorker] Error starting workflow ${workflowId} from event:`, error);
    }
  }
  
  /**
   * Get a workflow registration by ID
   *
   * @param workflowId The workflow ID
   * @param tenant The tenant ID
   * @returns The workflow registration or null if not found
   */
  private async getWorkflowRegistration(workflowId: string, tenant: string): Promise<any> {
    try {
      // Get a database connection
      const db = await getAdminConnection();
      
      // Query the workflow_registrations table and join with workflow_registration_versions
      // to get the current version of the workflow
      const registration = await db('workflow_registrations as wr')
        .join('workflow_registration_versions as wrv', function() {
          this.on('wrv.registration_id', '=', 'wr.registration_id')
              .andOn('wrv.tenant_id', '=', 'wr.tenant_id')
              .andOn('wrv.is_current', '=', db.raw('true'));
        })
        .where({
          'wr.registration_id': workflowId,
          'wr.tenant_id': tenant
        })
        .select(
          'wr.registration_id',
          'wr.name',
          'wr.description',
          'wr.tags',
          'wr.status',
          'wrv.version_id',
          'wrv.version',
          'wrv.definition'
        )
        .first();
      
      if (registration) {
        logger.info(`[WorkflowWorker] Found workflow registration with definition:`, {
          workflowId,
          name: registration.name,
          version_id: registration.version_id,
          definitionMetadata: registration.definition?.metadata
        });
      }
      
      return registration;
    } catch (error) {
      logger.error(`[WorkflowWorker] Error getting workflow registration ${workflowId}:`, error);
      return null;
    }
  }
  
  /**
   * Process pending events from the database
   * This method processes events that were persisted but not yet processed
   */
  private async processPendingEvents(): Promise<void> {
    try {
      // Get a database connection
      const db = await getAdminConnection();
      
      // Query for pending events
      const pendingEvents = await db('workflow_event_processing')
        .where('status', 'pending')
        .orWhere('status', 'published')
        .orderBy('created_at', 'asc')
        .limit(this.config.batchSize);
      
      if (pendingEvents.length === 0) {
        logger.debug(`[WorkflowWorker] No pending events to process`);
        return;
      }
      
      logger.info(`[WorkflowWorker] Found ${pendingEvents.length} pending events to process`);
      
      // Process each pending event
      for (const processingRecord of pendingEvents) {
        try {
          // Process the event
          await this.workflowRuntime.processQueuedEvent(db, {
            eventId: processingRecord.event_id,
            executionId: processingRecord.execution_id,
            processingId: processingRecord.processing_id,
            workerId: this.workerId,
            tenant: processingRecord.tenant
          });
          
          logger.info(`[WorkflowWorker] Successfully processed event ${processingRecord.event_id}`);
        } catch (error) {
          logger.error(`[WorkflowWorker] Error processing event ${processingRecord.event_id}:`, error);
          
          // Update the processing record to mark it as failed
          await db('workflow_event_processing')
            .where({
              processing_id: processingRecord.processing_id,
              tenant: processingRecord.tenant
            })
            .update({
              status: 'failed',
              error_message: error instanceof Error ? error.message : String(error),
              attempt_count: db.raw('attempt_count + 1'),
              last_attempt: new Date().toISOString(),
              updated_at: new Date().toISOString()
            });
        }
      }
      
      // Schedule the next batch of pending events
      setTimeout(() => this.processPendingEvents(), this.config.pollIntervalMs);
    } catch (error) {
      logger.error(`[WorkflowWorker] Error processing pending events:`, error);
      
      // Retry after a delay
      setTimeout(() => this.processPendingEvents(), this.config.pollIntervalMs);
    }
  }
  
  /**
   * Create a consumer group for a stream
   * This is a workaround for the private getClient method in RedisStreamClient
   *
   * @param streamKey The stream key
   * @param consumerGroup The consumer group name
   */
  private async createConsumerGroup(streamKey: string, consumerGroup: string): Promise<void> {
    // Add the prefix to the stream key since we're using Redis directly here
    const prefixedStreamKey = `workflow:events:${streamKey}`;
    
    // Check if we've already created this consumer group
    if (WorkflowWorker.createdConsumerGroups.has(prefixedStreamKey)) {
      // logger.debug(`[WorkflowWorker] Consumer group already ensured for stream: ${prefixedStreamKey}`);
      return;
    }
    
    try {
      // Use the Redis client through the Node.js redis client directly
      // This is a workaround since we can't access the private getClient method
      const password = await getSecret('redis_password', 'REDIS_PASSWORD');
      if (!password) {
        logger.warn('[WorkflowWorker] No Redis password configured - this is not recommended for production');
      }

      const client = createClient({
        url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || '6379'}`,
        password
      });
      
      await client.connect();
      
      try {
        logger.info(`[WorkflowWorker] Creating consumer group ${consumerGroup} for stream: ${prefixedStreamKey}`);
        await client.xGroupCreate(prefixedStreamKey, consumerGroup, '0', {
          MKSTREAM: true
        });
        logger.info(`[WorkflowWorker] Successfully created consumer group for stream: ${prefixedStreamKey}`);
        // Add to the set of created consumer groups
        WorkflowWorker.createdConsumerGroups.add(prefixedStreamKey);
      } catch (err: any) {
        if (err.message && err.message.includes('BUSYGROUP')) {
          logger.info(`[WorkflowWorker] Consumer group already exists for stream: ${prefixedStreamKey}`);
          // Add to the set of created consumer groups even if it already existed
          WorkflowWorker.createdConsumerGroups.add(prefixedStreamKey);
        } else {
          logger.error(`[WorkflowWorker] Error in xGroupCreate:`, err);
          throw err;
        }
      } finally {
        await client.quit();
      }
    } catch (error) {
      logger.error(`[WorkflowWorker] Error creating consumer group:`, error);
      throw error;
    }
  }
}
