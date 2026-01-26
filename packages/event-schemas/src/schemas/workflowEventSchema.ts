import { z } from 'zod';

/**
 * Zod schema for workflow events in Redis Streams
 * This ensures type safety for events published to and consumed from Redis
 */

// Base workflow event schema
export const WorkflowEventBaseSchema = z.object({
  event_id: z.string().uuid(),
  execution_id: z.string().uuid().optional(), // Made execution_id optional
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
 * Input interface for toStreamEvent - compatible with IWorkflowEvent from persistence layer.
 * This allows the function to work with database workflow events without creating a dependency
 * on the persistence package.
 */
export interface WorkflowEventInput {
  event_id: string;
  execution_id: string;
  event_name: string;
  event_type: string;
  tenant: string;
  from_state: string;
  to_state: string;
  user_id?: string;
  payload?: Record<string, any>;
  created_at: string;
}

/**
 * Convert a database workflow event to a stream event
 */
export function toStreamEvent(event: WorkflowEventInput): WorkflowEventBase {
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
    const rawEventData = message.message;

    // Reconstruct the event object from individual fields
    const eventForValidation = {
      event_id: rawEventData.event_id,
      execution_id: rawEventData.execution_id === '' ? undefined : rawEventData.execution_id,
      event_name: rawEventData.event_name,
      event_type: rawEventData.event_type,
      tenant: rawEventData.tenant,
      timestamp: rawEventData.timestamp,
      from_state: rawEventData.from_state === '' ? undefined : rawEventData.from_state,
      to_state: rawEventData.to_state === '' ? undefined : rawEventData.to_state,
      user_id: rawEventData.user_id === '' ? undefined : rawEventData.user_id,
      payload: rawEventData.payload_json ? JSON.parse(rawEventData.payload_json) : undefined,
    };

    return WorkflowEventBaseSchema.parse(eventForValidation);
  } catch (error) {
    console.error('[parseStreamEvent] Raw message data:', message.message);
    throw new Error(`Failed to parse workflow event from stream message: ${error instanceof Error ? error.message : String(error)}`);
  }
}
