# Distributed Workflow Implementation Plan

## Overview

This document outlines the implementation plan for enhancing our workflow engine to support asynchronous, distributed processing using Redis Streams. The goal is to enable "fire and forget" workflow execution that can continue across server restarts and spread across multiple worker instances.

## Current Architecture vs. Target Architecture

### Current Architecture

Currently, workflow events are processed synchronously within the context of the HTTP request:

```
Client Request → processEvent() → State Machine → Execute Actions → Return Response
```

Limitations:
- Long-running workflows block HTTP requests
- Workflows are bound to a single server
- Server failures may interrupt workflows
- Limited parallelism for handling many workflows

### Target Architecture

The enhanced architecture will use Redis Streams for asynchronous processing:

```
┌─ Phase 1 (Synchronous) ─────────────────┐  ┌─ Phase 2 (Asynchronous) ───────────────┐
│                                         │  │                                         │
│ Client Request → enqueueEvent() →       │  │ Workers → processQueuedEvent() →       │
│ Persist Event → Publish to Redis Stream │  │ State Machine → Execute Actions        │
│                                         │  │                                         │
└─────────────────────────────────────────┘  └─────────────────────────────────────────┘
```

Benefits:
- HTTP requests complete quickly after event persistence
- Multiple workers can process events in parallel
- Workflows survive server restarts
- Horizontal scaling across multiple servers
- High availability through redundant workers

## Implementation Plan

### 1. Redis Stream Client Implementation

Create a Redis Stream client for workflow events in `server/src/lib/workflow/streams/redisStreamClient.ts`:

```typescript
export class RedisStreamClient {
  // Stream name for workflow events
  private readonly streamName = 'workflow:events';
  // Consumer group name for workflow workers
  private readonly consumerGroup = 'workflow-workers';
  
  constructor(private redis: Redis) {}
  
  /**
   * Publish an event to the workflow event stream
   */
  async publishEvent(event: WorkflowEventMessage): Promise<string> {
    // Convert event to Redis hash format
    const eventData: Record<string, string> = {
      eventId: event.eventId,
      executionId: event.executionId,
      eventName: event.eventName,
      tenant: event.tenant,
      payload: JSON.stringify(event.payload),
      userId: event.userId || '',
      timestamp: new Date().toISOString()
    };
    
    // Publish to Redis Stream
    return this.redis.xadd(this.streamName, '*', ...Object.entries(eventData).flat());
  }
  
  /**
   * Create the consumer group if it doesn't exist
   */
  async createConsumerGroup(): Promise<void> {
    try {
      await this.redis.xgroup('CREATE', this.streamName, this.consumerGroup, '$', 'MKSTREAM');
    } catch (error) {
      // Ignore if group already exists
      if (!(error instanceof Error) || !error.message.includes('BUSYGROUP')) {
        throw error;
      }
    }
  }
  
  /**
   * Read new messages from the stream
   */
  async readNewMessages(consumerName: string, count: number = 10): Promise<WorkflowEventMessage[]> {
    const results = await this.redis.xreadgroup(
      'GROUP', this.consumerGroup, consumerName,
      'COUNT', count,
      'BLOCK', 2000,
      'STREAMS', this.streamName, '>'
    );
    
    if (!results) return [];
    
    // Parse the results
    return this.parseStreamResults(results);
  }
  
  /**
   * Claim pending messages that have exceeded processing timeout
   */
  async claimPendingMessages(consumerName: string, idleTimeMs: number = 60000, count: number = 10): Promise<WorkflowEventMessage[]> {
    // Get pending messages
    const pending = await this.redis.xpending(
      this.streamName, this.consumerGroup, '-', '+', count
    );
    
    if (!pending || pending.length === 0) {
      return [];
    }
    
    // Claim messages that have been idle for too long
    const idsToReclaim = pending
      .filter(entry => Date.now() - entry.idle > idleTimeMs)
      .map(entry => entry.id);
    
    if (idsToReclaim.length === 0) {
      return [];
    }
    
    const claimed = await this.redis.xclaim(
      this.streamName,
      this.consumerGroup,
      consumerName,
      idleTimeMs,
      ...idsToReclaim
    );
    
    return this.parseStreamResults([
      [this.streamName, claimed]
    ]);
  }
  
  /**
   * Acknowledge message processing
   */
  async acknowledgeMessage(id: string): Promise<void> {
    await this.redis.xack(this.streamName, this.consumerGroup, id);
  }
  
  /**
   * Parse stream results into workflow event messages
   */
  private parseStreamResults(results: any[]): WorkflowEventMessage[] {
    const messages: WorkflowEventMessage[] = [];
    
    for (const [streamName, entries] of results) {
      for (const [id, fields] of entries) {
        // Convert Redis array format to object
        const data: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) {
          data[fields[i]] = fields[i + 1];
        }
        
        messages.push({
          id,
          eventId: data.eventId,
          executionId: data.executionId,
          eventName: data.eventName,
          tenant: data.tenant,
          userId: data.userId || undefined,
          payload: JSON.parse(data.payload),
          timestamp: data.timestamp
        });
      }
    }
    
    return messages;
  }
}
```

### 2. Workflow Runtime Refactoring

Split event processing into two phases in `server/src/lib/workflow/core/workflowRuntime.ts`:

```typescript
/**
 * Enqueues an event for asynchronous processing
 * This is a "fire and forget" operation that returns quickly
 */
async function enqueueEvent({ 
  executionId, 
  eventName, 
  payload, 
  userRole, 
  tenant,
  idempotencyKey = undefined
}): Promise<{ eventId: string }> {
  // Generate event ID or use idempotency key if provided
  const eventId = idempotencyKey || generateUniqueId();
  
  // Check if this event has already been enqueued
  if (idempotencyKey) {
    const existing = await getEventByIdempotencyKey(idempotencyKey, tenant);
    if (existing) {
      // Return the existing event ID
      return { eventId: existing.event_id };
    }
  }
  
  // Validate that the workflow exists
  const workflowDef = await loadWorkflowDefinition(executionId, tenant);
  if (!workflowDef) {
    throw new Error(`Workflow not found for execution ID: ${executionId}`);
  }
  
  // Load the current state to validate the event
  const eventLog = await loadEventLog(executionId, tenant);
  const currentState = stateMachine.replayEvents(workflowDef, eventLog).currentState;
  const isValidEvent = validateEvent(workflowDef, currentState, eventName);
  
  if (!isValidEvent) {
    throw new Error(`Invalid event ${eventName} for current state ${currentState}`);
  }
  
  // Create new event object
  const newEvent = {
    event_id: eventId,
    execution_id: executionId,
    event_name: eventName,
    from_state: currentState,
    to_state: '', // Will be determined during processing
    payload,
    user_id: userRole ? getCurrentUserId() : undefined,
    tenant,
    idempotency_key: idempotencyKey,
    timestamp: new Date().toISOString()
  };
  
  // Transactionally persist the event and create processing record
  await knex.transaction(async (trx) => {
    // Persist the event
    await persistEvent(newEvent, trx);
    
    // Update workflow execution status
    await updateWorkflowExecutionStatus(executionId, tenant, 'pending_processing', trx);
    
    // Create processing record
    await createEventProcessingRecord(eventId, tenant, trx);
  });
  
  // Publish the event to Redis Stream for asynchronous processing
  await redisStreamClient.publishEvent({
    eventId,
    executionId,
    eventName,
    tenant,
    userId: newEvent.user_id,
    payload
  });
  
  // Return the event ID for tracking
  return {
    eventId
  };
}

/**
 * Process a queued event from Redis Streams
 * This is called by worker processes to handle events asynchronously
 */
async function processQueuedEvent(eventData, workerId): Promise<void> {
  // Extract event information
  const { id, eventId, executionId, eventName, tenant, userId, payload } = eventData;
  
  // Check if event has already been processed (idempotency)
  const processing = await getEventProcessingRecord(eventId, tenant);
  if (processing.status === 'completed') {
    // Already processed, acknowledge and exit early
    await redisStreamClient.acknowledgeMessage(id);
    return;
  }
  
  // Acquire distributed lock
  const lockKey = `event:${eventId}:processing`;
  const lockAcquired = await acquireDistributedLock(lockKey, tenant, 30000); // 30s lock
  if (!lockAcquired) {
    // Another worker is processing this event
    return;
  }
  
  try {
    // Mark event as processing
    await updateEventProcessingStatus(eventId, tenant, 'processing', {
      worker_id: workerId,
      started_at: new Date().toISOString()
    });
    
    // Load workflow definition
    const workflowDef = await loadWorkflowDefinition(executionId, tenant);
    if (!workflowDef) {
      throw new Error(`Workflow not found for execution ID: ${executionId}`);
    }
    
    // Load all previous events for this execution
    const eventLog = await loadEventLog(executionId, tenant);
    
    // Get the persisted event
    const newEvent = await getEventById(eventId, tenant);
    
    // Process the event using the stateless state machine
    const result = stateMachine.processEvent(
      workflowDef,
      eventLog,
      newEvent,
      payload
    );
    
    if (!result.isValid) {
      throw new Error(result.errorMessage || `Invalid event ${eventName} for current state`);
    }
    
    // Update the event with the determined state transition
    await updateEventStateTransition(eventId, tenant, result.previousState, result.nextState);
    
    // Begin transaction for registering actions and dependencies
    await knex.transaction(async (trx) => {
      // Register actions and their dependencies in the database
      await registerActionsWithDependencies(result.actionsToExecute, newEvent, tenant, trx);
      
      // Process any timers that should be started or canceled
      await processTimers(executionId, result.nextState, tenant, trx);
      
      // Update workflow execution status and state
      await updateWorkflowExecution(executionId, tenant, result.nextState, 'active', trx);
    });
    
    // Execute actions using the dependency graph executor (outside the transaction)
    const actionResults = await actionExecutor.executeActions(
      result.actionsToExecute,
      newEvent,
      tenant
    );
    
    // Mark event as completed
    await updateEventProcessingStatus(eventId, tenant, 'completed', {
      worker_id: workerId,
      completed_at: new Date().toISOString(),
      result: {
        previousState: result.previousState,
        currentState: result.nextState,
        actionsExecuted: actionResults.map(a => a.actionName)
      }
    });
    
    // Acknowledge the message in Redis Stream
    await redisStreamClient.acknowledgeMessage(id);
  } catch (error) {
    // Mark event as failed
    await updateEventProcessingStatus(eventId, tenant, 'failed', {
      worker_id: workerId,
      error: error.message,
      completed_at: new Date().toISOString()
    });
    
    // Possibly retry or handle error
    await handleProcessingError(eventId, executionId, tenant, error);
    
    // Log the error
    console.error(`Error processing event ${eventId}:`, error);
  } finally {
    // Release distributed lock
    await releaseDistributedLock(lockKey, tenant);
  }
}
```

### 3. Worker Service Implementation

Create a workflow worker service in `server/src/lib/workflow/workers/workflowWorker.ts`:

```typescript
import { RedisStreamClient } from '../streams/redisStreamClient';
import { processQueuedEvent } from '../core/workflowRuntime';
import { getRedisClient } from '../util/redisClient';
import { generateUniqueId } from '../util/idGenerator';
import os from 'os';

export class WorkflowWorker {
  private running = false;
  private workerId: string;
  private redisStreamClient: RedisStreamClient;
  private checkIntervalMs = 1000; // Poll interval
  private idleTimeMs = 60000; // Consider message idle after 60s
  private batchSize = 10; // Number of messages to process in a batch
  
  constructor() {
    // Generate a unique worker ID based on hostname and process
    this.workerId = `${os.hostname()}-${process.pid}-${generateUniqueId()}`;
    
    // Create Redis Stream client
    const redis = getRedisClient();
    this.redisStreamClient = new RedisStreamClient(redis);
  }
  
  /**
   * Start the worker
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    
    this.running = true;
    console.log(`Starting workflow worker ${this.workerId}`);
    
    // Create consumer group if it doesn't exist
    await this.redisStreamClient.createConsumerGroup();
    
    // Set up signal handlers for graceful shutdown
    this.setupSignalHandlers();
    
    // Start processing loop
    this.processingLoop();
  }
  
  /**
   * Stop the worker gracefully
   */
  async stop(): Promise<void> {
    console.log(`Stopping workflow worker ${this.workerId}...`);
    this.running = false;
    // Any cleanup needed can go here
  }
  
  /**
   * Process messages in a loop
   */
  private async processingLoop(): Promise<void> {
    while (this.running) {
      try {
        // First, check for pending messages that need to be reclaimed
        const pendingMessages = await this.redisStreamClient.claimPendingMessages(
          this.workerId,
          this.idleTimeMs,
          this.batchSize
        );
        
        if (pendingMessages.length > 0) {
          console.log(`Processing ${pendingMessages.length} reclaimed pending messages`);
          await this.processMessages(pendingMessages);
        }
        
        // Then, read new messages
        const newMessages = await this.redisStreamClient.readNewMessages(
          this.workerId,
          this.batchSize
        );
        
        if (newMessages.length > 0) {
          console.log(`Processing ${newMessages.length} new messages`);
          await this.processMessages(newMessages);
        } else {
          // If no messages were found, wait before polling again
          await new Promise(resolve => setTimeout(resolve, this.checkIntervalMs));
        }
      } catch (error) {
        // Log error but keep processing
        console.error('Error in workflow worker processing loop:', error);
        
        // Wait a bit before retrying to avoid tight loop on persistent errors
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    
    console.log(`Workflow worker ${this.workerId} stopped`);
  }
  
  /**
   * Process a batch of messages
   */
  private async processMessages(messages: WorkflowEventMessage[]): Promise<void> {
    // Process messages in parallel
    await Promise.all(
      messages.map(async (message) => {
        try {
          await processQueuedEvent(message, this.workerId);
        } catch (error) {
          console.error(`Error processing message ${message.eventId}:`, error);
          // Don't rethrow to prevent one message failure from affecting others
        }
      })
    );
  }
  
  /**
   * Set up signal handlers for graceful shutdown
   */
  private setupSignalHandlers(): void {
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    
    for (const signal of signals) {
      process.on(signal, async () => {
        console.log(`Received ${signal}, shutting down gracefully...`);
        await this.stop();
        process.exit(0);
      });
    }
  }
}

// Helper function to start a worker
export async function startWorkflowWorker(): Promise<WorkflowWorker> {
  const worker = new WorkflowWorker();
  await worker.start();
  return worker;
}
```

### 4. Distributed Lock Implementation

Create a Redis-based distributed lock in `server/src/lib/workflow/util/distributedLock.ts`:

```typescript
import { getRedisClient } from './redisClient';

/**
 * A simple Redis-based distributed lock implementation
 */
export class DistributedLock {
  private redis = getRedisClient();
  
  /**
   * Acquire a distributed lock
   * @param key Lock key
   * @param owner Identifier of the lock owner
   * @param ttlMs Time-to-live in milliseconds
   * @returns True if lock was acquired, false otherwise
   */
  async acquire(key: string, owner: string, ttlMs: number): Promise<boolean> {
    // Use Redis SET with NX option (only set if key doesn't exist)
    const result = await this.redis.set(
      `lock:${key}`,
      owner,
      'PX', // Expire in milliseconds
      ttlMs,
      'NX' // Only set if key doesn't exist
    );
    
    return result === 'OK';
  }
  
  /**
   * Release a distributed lock
   * @param key Lock key
   * @param owner Identifier of the lock owner
   * @returns True if lock was released, false if lock doesn't exist or is owned by someone else
   */
  async release(key: string, owner: string): Promise<boolean> {
    // Use Lua script to ensure we only delete the lock if we own it
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    
    const result = await this.redis.eval(script, 1, `lock:${key}`, owner);
    return result === 1;
  }
  
  /**
   * Extend a lock's TTL
   * @param key Lock key
   * @param owner Identifier of the lock owner
   * @param ttlMs New time-to-live in milliseconds
   * @returns True if lock was extended, false if lock doesn't exist or is owned by someone else
   */
  async extend(key: string, owner: string, ttlMs: number): Promise<boolean> {
    // Use Lua script to ensure we only extend the lock if we own it
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("pexpire", KEYS[1], ARGV[2])
      else
        return 0
      end
    `;
    
    const result = await this.redis.eval(
      script, 
      1, 
      `lock:${key}`, 
      owner, 
      ttlMs.toString()
    );
    
    return result === 1;
  }
}

// Singleton instance
let distributedLockInstance: DistributedLock | null = null;

/**
 * Get the distributed lock instance
 */
export function getDistributedLock(): DistributedLock {
  if (!distributedLockInstance) {
    distributedLockInstance = new DistributedLock();
  }
  return distributedLockInstance;
}

/**
 * Helper function to acquire a distributed lock
 */
export async function acquireDistributedLock(
  key: string, 
  owner: string, 
  ttlMs: number = 30000
): Promise<boolean> {
  return getDistributedLock().acquire(key, owner, ttlMs);
}

/**
 * Helper function to release a distributed lock
 */
export async function releaseDistributedLock(
  key: string,
  owner: string
): Promise<boolean> {
  return getDistributedLock().release(key, owner);
}
```

### 5. Schema for Event Processing Table

Create a migration for the event processing table:

```javascript
// In server/migrations/YYYYMMDDHHMMSS_create_workflow_event_processing_table.cjs
exports.up = function(knex) {
  return knex.schema
    .createTable('workflow_event_processing', table => {
      table.uuid('processing_id').defaultTo(knex.raw('gen_random_uuid()')).primary();
      table.text('tenant').notNullable();
      table.uuid('event_id').notNullable();
      table.text('worker_id').nullable();
      table.text('status').notNullable().defaultTo('pending'); // pending | processing | completed | failed
      table.integer('retry_count').notNullable().defaultTo(0);
      table.text('error_message').nullable();
      table.jsonb('result').nullable();
      table.timestamp('locked_until').nullable();
      table.timestamp('started_at').nullable();
      table.timestamp('completed_at').nullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
      
      // Create index for efficient retrieval
      table.index(['tenant', 'event_id']);
      table.index(['tenant', 'status']);
      table.index(['tenant', 'worker_id', 'status']);
    });
};

exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('workflow_event_processing');
};
```

## Testing Plan

### Unit Tests

1. **Redis Stream Client Tests**
   - Test publishing events to Redis Streams
   - Test reading messages from streams
   - Test claiming pending messages
   - Test message acknowledgment

2. **Workflow Runtime Tests**
   - Test event enqueueing
   - Test event validation
   - Test idempotent event handling
   - Test event processing

3. **Distributed Lock Tests**
   - Test lock acquisition
   - Test lock release
   - Test lock extension
   - Test concurrent lock acquisition

### Integration Tests

1. **End-to-End Workflow Tests**
   - Test complete workflow processing via Redis Streams
   - Test workflow resumption after interruption
   - Test parallel workflow processing
   - Test idempotent event processing

2. **Worker Tests**
   - Test worker startup and shutdown
   - Test worker message processing
   - Test worker error handling
   - Test worker pending message claiming

## Deployment Considerations

- **Multiple Worker Instances**: Configure multiple worker instances in the deployment to increase throughput and fault tolerance
- **Worker Process Management**: Use a process manager (e.g., PM2) to manage worker processes
- **Monitoring**: Implement monitoring to track worker health and performance
- **Scaling**: Scale the number of workers based on workload
- **Error Handling**: Configure appropriate error handling strategies for different error types

## Migration Strategy

To ensure backward compatibility during the transition to the distributed workflow architecture:

1. Implement the asynchronous components without breaking existing functionality
2. Add a feature flag to control the mode of operation (sync vs. async)
3. Gradually migrate workflows to the async mode
4. Monitor for issues and roll back if necessary
5. Once stable, make async mode the default