import { z } from 'zod';

/**
 * Zod schema for workflow events in Redis Streams
 */

// Base workflow event schema
export const WorkflowEventBaseSchema = z.object({
  event_id: z.string().uuid(),
  execution_id: z.string().uuid().optional(),
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
  'pending',
  'published',
  'processing',
  'completed',
  'failed',
  'retrying',
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
    event: z.string(),
  }),
});

// Type definitions
export type WorkflowEventBase = z.infer<typeof WorkflowEventBaseSchema>;
export type WorkflowEventProcessingStatus = z.infer<typeof WorkflowEventProcessingStatusSchema>;
export type WorkflowEventProcessing = z.infer<typeof WorkflowEventProcessingSchema>;
export type RedisStreamMessage = z.infer<typeof RedisStreamMessageSchema>;
export type WorkflowStreamEntry = z.infer<typeof WorkflowStreamEntrySchema>;

/**
 * Parse a stream message into a workflow event
 */
export function parseStreamEvent(message: RedisStreamMessage): WorkflowEventBase {
  try {
    const rawEventData = message.message;

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
