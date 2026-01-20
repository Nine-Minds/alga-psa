import { v4 as uuidv4 } from 'uuid';
import os from 'os';
import {
  getRedisStreamClient,
  RedisStreamClient,
  WorkflowEventBase,
  WorkflowEventBaseSchema
} from '@shared/workflow/streams/index.js';
import { TypeScriptWorkflowRuntime } from '@shared/workflow/core/index.js';
import { createClient } from 'redis';
import logger from '@alga-psa/core/logger';
import { getSecret } from '@alga-psa/core/server';
import { getAdminConnection } from '@alga-psa/db/admin';
import { withAdminTransaction } from '@alga-psa/db';
import { Knex } from 'knex';

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
  pollIntervalMs: 300000, // Poll every 5 minutes (300 seconds)
  idleTimeoutMs: 60000,
  batchSize: 10,
  maxRetries: 3,
  healthCheckIntervalMs: 300000, // Health check every 5 minutes
  metricsReportingIntervalMs: 300000, // Metrics every 5 minutes
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
 */
export class WorkflowWorker {
  private static createdConsumerGroups: Set<string> = new Set<string>();
  private running: boolean = false;
  private workerId: string;
  private redisStreamClient = getRedisStreamClient({
    consumerGroup: 'workflow-workers'
  });
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
      
      // Schedule periodic check for pending events (as a safety net)
      // This runs less frequently since Redis streams are the primary mechanism
      setInterval(() => this.processPendingEvents(), this.config.pollIntervalMs);
      
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
    // Use the same consumer group as configured in RedisStreamClient
    const consumerGroup = 'workflow-processors';
    
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
      logger.info(`[WorkflowWorker] Processing global event from Redis:`, {
        eventId: event.event_id,
        eventType: event.event_type,
        tenant: event.tenant
      });
      
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
      
      console.log(`[TENANT-DEBUG] WorkflowWorker received global event: tenant=${eventData.tenant}, eventType=${eventData.event_type}, eventId=${eventData.event_id}`);
      
      // Extract tenant from the event
      const tenant = eventData.tenant;
      if (!tenant) {
        logger.error(`[WorkflowWorker] Event is missing tenant ID, cannot process`);
        console.log(`[TENANT-DEBUG] WorkflowWorker ERROR: Event missing tenant ID: eventId=${eventData.event_id}, eventType=${eventData.event_type}`);
        return;
      }
      
      console.log(`[TENANT-DEBUG] WorkflowWorker extracted tenant from event: tenant=${tenant}, eventType=${eventData.event_type}`);
      
      // Check if this is a test event with a specific version_id in the payload
      // If so, we can directly start the workflow with that version_id
      const versionId = eventData.payload?.versionId;
      const workflowId = eventData.payload?.workflowId;
      const isTestEvent = eventData.payload?.isTestEvent === true;
      
      if (versionId && workflowId && isTestEvent) {
        logger.info(`[WorkflowWorker] Test event detected with specific version_id: ${versionId}`, {
          workflowId,
          versionId,
          eventType: eventData.event_type
        });
        
        // Use transaction for test event processing
        await withAdminTransaction(async (trx) => {
          // Get the workflow registration directly by ID and version
          const registration = await trx('workflow_registrations as wr')
            .join('workflow_registration_versions as wrv', function() {
              this.on('wrv.registration_id', '=', 'wr.registration_id')
                  .andOn('wrv.tenant', '=', 'wr.tenant');
            })
            .where({
              'wr.registration_id': workflowId,
              'wr.tenant': tenant,
              'wrv.version_id': versionId
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
            logger.info(`[WorkflowWorker] Starting test workflow with specific version`, {
              workflowId,
              versionId,
              name: registration.name
            });
            
            // Start the workflow using the version ID
            const result = await this.workflowRuntime.startWorkflowByVersionId(trx, {
              tenant: eventData.tenant,
              initialData: {
                eventId: eventData.event_id,
                eventType: eventData.event_type,
                eventName: eventData.event_name,
                eventPayload: eventData.payload || {},
                triggerEvent: eventData
              },
              userId: eventData.user_id,
              versionId: versionId as string,
              isSystemManaged: false // For this test event path, the preceding query only fetches tenant workflows
            });
            
            // Submit the original event to the workflow
            await this.workflowRuntime.submitEvent(trx, {
              execution_id: result.executionId,
              event_name: eventData.event_name,
              payload: eventData.payload,
              user_id: eventData.user_id,
              tenant: eventData.tenant
            });
          } else {
            logger.error(`[WorkflowWorker] Test workflow with ID ${workflowId} and version ${versionId} not found`);
          }
        });
        
        return; // Skip the normal workflow attachment lookup
      }
      
      // eventData is WorkflowEventBase, already parsed by RedisStreamClient's consumer handler
      // before calling this.processGlobalEvent

      // Determine if the event is for an existing execution or a trigger for a new one.
      // Instance events typically have event_type 'workflow' and a defined execution_id.
      if (eventData.execution_id && eventData.event_type === 'workflow') {
        logger.info(`[WorkflowWorker] Global event ${eventData.event_id} is for existing execution ${eventData.execution_id}. Routing to processQueuedEvent.`, { eventName: eventData.event_name });
        
        await withAdminTransaction(async (trx) => {
          // Find the processing_id from the workflow_event_processing table.
          // This record should have been created by TypeScriptWorkflowRuntime.enqueueEvent.
          const processingRecord = await trx('workflow_event_processing')
            .where({
              event_id: eventData.event_id,
              execution_id: eventData.execution_id, // Ensure we get the right one if event_id isn't globally unique
              tenant: eventData.tenant
            })
            .first();

          if (processingRecord) {
            // Call processQueuedEvent with all necessary parameters.
            // processQueuedEvent will handle updating the processingRecord's status,
            // loading the full execution state, applying the event, and notifying listeners.
            await this.workflowRuntime.processQueuedEvent(trx, {
              eventId: eventData.event_id,
              executionId: eventData.execution_id || '',
              processingId: processingRecord.processing_id, // Crucial: use the ID from the DB record
              workerId: this.workerId,
              tenant: eventData.tenant
            });
            logger.info(`[WorkflowWorker] Routed event ${eventData.event_id} to processQueuedEvent for execution ${eventData.execution_id}.`);
          } else {
            // This case should be rare if enqueueEvent always creates a processing record.
            // It might happen if an event is published to global stream bypassing enqueueEvent's DB operations,
            // or if there's a race condition/delay in DB commit vs Redis publish.
            logger.error(`[WorkflowWorker] Could not find processing record for event ${eventData.event_id} (execution: ${eventData.execution_id}) from global stream. Event may not be processed correctly by this path.`);
            // Consider if fallback to processPendingEvents is sufficient or if specific error handling is needed.
          }
        });
      } else {
        // Event is treated as a trigger for new workflows.
        logger.info(`[WorkflowWorker] Global event ${eventData.event_id} (type: ${eventData.event_type}, execution_id: ${eventData.execution_id || 'N/A'}) treated as a trigger for new workflows.`);
        
        // Special logging for INBOUND_EMAIL_RECEIVED events
        if (eventData.event_type === 'INBOUND_EMAIL_RECEIVED') {
          console.log(`[TENANT-DEBUG] WorkflowWorker processing INBOUND_EMAIL_RECEIVED event: tenant=${tenant}, eventId=${eventData.event_id}, payload=${JSON.stringify(eventData.payload)}`);
        }
        
        await withAdminTransaction(async (trx) => {
          const attachedWorkflows = await this.findAttachedWorkflows(eventData.event_type, tenant, trx);
        
          if (attachedWorkflows.length === 0) {
            logger.info(`[WorkflowWorker] No workflows attached to event type ${eventData.event_type} for new workflow instantiation.`);
            return;
          }
          
          for (const attachment of attachedWorkflows) {
            // Pass the full eventData object to startWorkflowFromEvent with transaction
            await this.startWorkflowFromEvent(attachment.workflow_id, attachment.isSystemManaged, eventData, trx);
          }
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
   * @param trx Optional transaction to use
   * @returns Array of workflow IDs
   */
  private async findAttachedWorkflows(eventType: string, tenant: string, trx?: Knex.Transaction): Promise<{ workflow_id: string; isSystemManaged: boolean }[]> { // Updated return type
    try {
      logger.info(`[WorkflowWorker] Finding workflows attached to event type ${eventType} for tenant ${tenant}`);
      console.log(`[TENANT-DEBUG] WorkflowWorker finding attached workflows: tenant=${tenant}, eventType=${eventType}`);
      
      return await withAdminTransaction(async (txn) => {
        const transaction = trx || txn;
        const results: { workflow_id: string; isSystemManaged: boolean }[] = [];

        logger.info(`[WorkflowWorker] Searching for tenant workflow attachments...`);

        // Step 1: Query tenant-specific workflow_event_attachments for the given eventType and tenant
        const tenantAttachments = await transaction('workflow_event_attachments as wea')
          .where({
            'wea.event_type': eventType,
            'wea.tenant': tenant,
            'wea.is_active': true
          })
          .select('wea.workflow_id as workflow_id');

        logger.info(`[WorkflowWorker] Found ${tenantAttachments.length} tenant workflow attachments for event type ${eventType}`);

        // Add tenant workflows (they are not system managed)
        for (const attachment of tenantAttachments) {
          results.push({
            workflow_id: attachment.workflow_id,
            isSystemManaged: false
          });
        }

        // Step 2: Query system workflow attachments by looking up the event in system_event_catalog
        // and then finding attachments via system_workflow_event_attachments
        const systemEvent = await transaction('system_event_catalog')
          .where({ event_type: eventType })
          .first();

        if (systemEvent) {
          logger.info(`[WorkflowWorker] Found system event ${systemEvent.event_id} for event type ${eventType}`);
          
          const systemAttachments = await transaction('system_workflow_event_attachments as swea')
            .where({
              'swea.event_id': systemEvent.event_id,
              'swea.is_active': true
            })
            .select('swea.workflow_id as workflow_id');

          logger.info(`[WorkflowWorker] Found ${systemAttachments.length} system workflow attachments for event type ${eventType}`);

          // Add system workflows (they are system managed)
          for (const attachment of systemAttachments) {
            results.push({
              workflow_id: attachment.workflow_id,
              isSystemManaged: true
            });
          }
        } else {
          logger.info(`[WorkflowWorker] No system event found for event type ${eventType}`);
        }

        logger.info(`[WorkflowWorker] Found ${results.length} total workflows attached to event type ${eventType}`, {
          tenantWorkflows: tenantAttachments.length,
          systemWorkflows: results.filter(r => r.isSystemManaged).length,
          eventType,
          tenant
        });
        
        console.log(`[TENANT-DEBUG] WorkflowWorker found attached workflows: tenant=${tenant}, eventType=${eventType}, totalWorkflows=${results.length}`);

        return results;
      }, trx);
    } catch (error) {
      logger.error(`[WorkflowWorker] Error finding attached workflows for event type ${eventType}:`, error);
      return [];
    }
  }
  
  /**
   * Start a workflow from an event
   *
   * @param workflowId The workflow registration ID
   * @param isSystemManaged Flag indicating if it's a system workflow
   * @param event The event that triggered the workflow
   */
   private async startWorkflowFromEvent(
    workflowId: string,
    isSystemManaged: boolean, // Added parameter
    event: any,
    trx?: Knex.Transaction
  ): Promise<void> {
    try {
      logger.info(`[WorkflowWorker] Starting ${isSystemManaged ? 'system' : 'tenant'} workflow ${workflowId} from event`, {
        workflowId,
        isSystemManaged, // Log the flag
        eventId: event.event_id,
        eventType: event.event_type,
        tenant: event.tenant
      });
      
      console.log(`[TENANT-DEBUG] WorkflowWorker starting workflow from event: tenant=${event.tenant}, workflowId=${workflowId}, eventType=${event.event_type}`);
      
      // Get the workflow registration, passing the system flag and transaction connection
      const workflow = await this.getWorkflowRegistration(workflowId, event.tenant, isSystemManaged, trx);

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
      
      // Use the existing transaction or create a new one
      await withAdminTransaction(async (txn) => {
        const transaction = trx || txn;
        // Log the workflow details
        logger.info(`[WorkflowWorker] Starting workflow by version ID: ${workflow.version_id}`, {
          workflowId,
          workflowName: workflow.name,
          version_id: workflow.version_id,
          definitionMetadata: workflow.definition?.metadata
        });
        
        // Start the workflow using the version ID
        console.log(`[TENANT-DEBUG] WorkflowWorker about to start workflow: tenant=${event.tenant}, workflowId=${workflowId}, versionId=${workflow.version_id}`);
        
        const result = await this.workflowRuntime.startWorkflowByVersionId(transaction, {
          tenant: event.tenant,
          initialData: {
            eventId: event.event_id,
            eventType: event.event_type,
            eventName: event.event_name,
            eventPayload: event.payload || {},
            triggerEvent: event
          },
          userId: event.user_id,
          versionId: workflow.version_id, // Pass the version_id
          isSystemManaged: isSystemManaged // Pass the isSystemManaged flag
        });
        
        console.log(`[TENANT-DEBUG] WorkflowWorker started workflow: tenant=${event.tenant}, executionId=${result.executionId}, workflowId=${workflowId}`);
        
        logger.info(`[WorkflowWorker] Started workflow ${workflow.name} with execution ID ${result.executionId}`, {
          workflowId,
          workflowName: workflow.name,
          executionId: result.executionId,
          eventId: event.event_id
        });
        
        // Submit the original event to the workflow
        console.log(`[TENANT-DEBUG] WorkflowWorker about to submit event to workflow: tenant=${event.tenant}, executionId=${result.executionId}, eventName=${event.event_name}`);
        
        await this.workflowRuntime.submitEvent(transaction, {
          execution_id: result.executionId,
          event_name: event.event_name,
          payload: event.payload,
          user_id: event.user_id,
          tenant: event.tenant
        });
        
        console.log(`[TENANT-DEBUG] WorkflowWorker submitted event to workflow: tenant=${event.tenant}, executionId=${result.executionId}, eventName=${event.event_name}`);
        
        logger.info(`[WorkflowWorker] Submitted event ${event.event_name} to workflow execution ${result.executionId}`);
      }, trx);
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
  private async getWorkflowRegistration(
    workflowId: string,
    tenant: string,
    isSystemManaged: boolean, // Added parameter
    knexConnection?: Knex | Knex.Transaction
  ): Promise<any> { // Consider defining a specific return type
    try {
      // Use provided connection or get a new one
      const db = knexConnection || await getAdminConnection();

      const registrationTable = isSystemManaged ? 'system_workflow_registrations' : 'workflow_registrations';
      const versionTable = isSystemManaged ? 'system_workflow_registration_versions' : 'workflow_registration_versions';
      const tenantFilter = isSystemManaged ? {} : { 'wr.tenant': tenant };

      // Query the appropriate tables based on isSystemManaged
      const registration = await db(`${registrationTable} as wr`)
        .join(`${versionTable} as wrv`, function(this: any) {
          this.on('wrv.registration_id', '=', 'wr.registration_id');
          // No tenant join needed for system tables or version table here
          // if (!isSystemManaged) {
          //   // Only join on tenant for tenant workflows - Redundant due to where clause?
          //   // this.andOn('wrv.tenant', '=', 'wr.tenant');
          // }
          this.andOn('wrv.is_current', '=', db.raw('true'));
        })
        .where({
          'wr.registration_id': workflowId,
          ...tenantFilter // Apply tenant filter only if not system managed
        })
        .select(
          'wr.registration_id',
          'wr.name',
          'wr.description',
          'wr.tags',
          'wr.status',
          'wrv.version_id', // Need version_id to start the workflow
          'wrv.version',
          'wrv.code as definition' // Use 'code' column and alias as 'definition'
          // Add other fields if needed
        )
        .first();

      if (registration) {
        logger.info(`[WorkflowWorker] Found ${isSystemManaged ? 'system' : 'tenant'} workflow registration:`, {
          workflowId,
          name: registration.name,
          version_id: registration.version_id,
          isSystemManaged
        });
        
        console.log(`[TENANT-DEBUG] WorkflowWorker found workflow registration: tenant=${tenant}, workflowId=${workflowId}, name=${registration.name}, isSystemManaged=${isSystemManaged}`);
      } else {
         logger.warn(`[WorkflowWorker] ${isSystemManaged ? 'System' : 'Tenant'} workflow registration not found:`, {
          workflowId,
          tenant: isSystemManaged ? undefined : tenant,
          isSystemManaged
        });
        
        console.log(`[TENANT-DEBUG] WorkflowWorker workflow registration NOT FOUND: tenant=${tenant}, workflowId=${workflowId}, isSystemManaged=${isSystemManaged}`);
      }

      return registration; // Return the fetched registration or null
    } catch (error) {
      logger.error(`[WorkflowWorker] Error getting ${isSystemManaged ? 'system' : 'tenant'} workflow registration ${workflowId}:`, error);
      console.log(`[TENANT-DEBUG] WorkflowWorker ERROR getting workflow registration: tenant=${tenant}, workflowId=${workflowId}, error=${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
  
  /**
   * Process pending events from the database
   * This method processes events that were persisted but not yet processed
   */
  private async processPendingEvents(): Promise<void> {
    logger.info(`[WorkflowWorker] 🔥 HOT RELOAD TEST: File change detected at ${new Date().toISOString()}! 🔥`);
    logger.info(`[WorkflowWorker] 🔥 WORKFLOW-WORKER SOURCE CHANGE: This should trigger hot reload! 🔥`);
    logger.info(`[WorkflowWorker] 🔧 ADMIN CONNECTION DEBUG: Testing detailed transaction logging`);
    try {
      await withAdminTransaction(async (trx) => {
        // Query for pending events
        const pendingEvents = await trx('workflow_event_processing')
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
            await this.workflowRuntime.processQueuedEvent(trx, {
              eventId: processingRecord.event_id,
              executionId: processingRecord.execution_id,
              processingId: processingRecord.processing_id,
              workerId: this.workerId,
              tenant: processingRecord.tenant
            });
            
            logger.info(`[WorkflowWorker] Successfully processed event ${processingRecord.event_id}`);
          } catch (error) {
            logger.error(`[WorkflowWorker] Error processing event ${processingRecord.event_id}:`, error);
            
            // Update the processing record to mark it as failed within the same transaction
            await trx('workflow_event_processing')
              .where({
                processing_id: processingRecord.processing_id,
                tenant: processingRecord.tenant
              })
              .update({
                status: 'failed',
                error_message: error instanceof Error ? error.message : String(error),
                attempt_count: trx.raw('attempt_count + 1'),
                last_attempt: new Date().toISOString(),
                updated_at: new Date().toISOString()
              });
          }
        }
      });
      
      // Only process pending events once at startup - new events come via Redis streams
      logger.debug(`[WorkflowWorker] Startup pending events processing complete. New events will be processed via Redis streams.`);
    } catch (error) {
      logger.error(`[WorkflowWorker] Error processing pending events:`, error);
      
      // Do not retry automatically - this is startup processing only
      logger.error(`[WorkflowWorker] Failed to process startup pending events. Manual intervention may be required.`);
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
        logger.info(`[WorkflowWorker] Successfully created consumer group ${consumerGroup} for stream: ${prefixedStreamKey}`);
        // Add to the set of created consumer groups
        WorkflowWorker.createdConsumerGroups.add(prefixedStreamKey);
      } catch (err: any) {
        if (err.message && err.message.includes('BUSYGROUP')) {
          logger.info(`[WorkflowWorker] Consumer group ${consumerGroup} already exists for stream: ${prefixedStreamKey}`);
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
