import { z } from 'zod';
import { IWorkflowEvent } from '../persistence/index.js';

/**
 * Zod schema for workflow events in Redis Streams
 * This ensures type safety for events published to and consumed from Redis
 */

// Base workflow event schema
export const WorkflowEventBaseSchema = z.object({
  event_id: z.string().uuid(),
  execution_id: z.string().uuid(),
  event_name: z.string(),
  event_type: z.string(),
  tenant: z.string(),
  timestamp: z.string().datetime(),
  from_state: z.string().optional(),
  to_state: z.string().optional(),
  user_id: z.string().uuid().optional(),
  payload: z.record(z.unknown()).optional(),
});

// Schema for workflow event processing status
export const WorkflowEventProcessingStatusSchema = z.enum([
  'pending',    // Event has been persisted but not yet published to Redis
  'published',  // Event has been published to Redis
  'processing', // Event is being processed by a worker
  'completed',  // Event has been successfully processed
  'failed',     // Event processing failed
  'retrying',   // Event is being retried after a failure
]);

// Schema for workflow event processing record
export const WorkflowEventProcessingSchema = z.object({
  processing_id: z.string().uuid(),
  event_id: z.string().uuid(),
  execution_id: z.string().uuid(),
  tenant: z.string(),
  status: WorkflowEventProcessingStatusSchema,
  worker_id: z.string().optional(),
  attempt_count: z.number().int().nonnegative(),
  last_attempt: z.string().datetime().optional(),
  error_message: z.string().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

// Schema for Redis stream message
export const RedisStreamMessageSchema = z.object({
  id: z.string(),
  message: z.record(z.string()),
});

// Schema for Redis stream entry with workflow event
export const WorkflowStreamEntrySchema = z.object({
  id: z.string(),
  message: z.object({
    event: z.string(), // JSON stringified workflow event
  }),
});

// Type definitions
export type WorkflowEventBase = z.infer<typeof WorkflowEventBaseSchema>;
export type WorkflowEventProcessingStatus = z.infer<typeof WorkflowEventProcessingStatusSchema>;
export type WorkflowEventProcessing = z.infer<typeof WorkflowEventProcessingSchema>;
export type RedisStreamMessage = z.infer<typeof RedisStreamMessageSchema>;
export type WorkflowStreamEntry = z.infer<typeof WorkflowStreamEntrySchema>;

/**
 * Convert a database workflow event to a stream event
 */
export function toStreamEvent(event: IWorkflowEvent): WorkflowEventBase {
  return {
    event_id: event.event_id,
    execution_id: event.execution_id,
    event_name: event.event_name,
    event_type: event.event_type,
    tenant: event.tenant,
    timestamp: event.created_at,
    from_state: event.from_state,
    to_state: event.to_state,
    user_id: event.user_id,
    payload: event.payload,
  };
}

/**
 * Parse a stream message into a workflow event
 */
export function parseStreamEvent(message: RedisStreamMessage): WorkflowEventBase {
  try {
    const eventJson = message.message.event;
    const parsedEvent = JSON.parse(eventJson);
    return WorkflowEventBaseSchema.parse(parsedEvent);
  } catch (error) {
    throw new Error(`Failed to parse workflow event: ${error instanceof Error ? error.message : String(error)}`);
  }
}
