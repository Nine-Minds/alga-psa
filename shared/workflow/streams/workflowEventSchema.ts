import type { WorkflowEventBase } from '@alga-psa/event-schemas';

type LegacyWorkflowEventRecord = {
  event_id: string;
  execution_id: string;
  event_name: string;
  event_type: string;
  tenant: string;
  created_at: string;
  from_state: string;
  to_state: string;
  user_id?: string;
  payload?: Record<string, unknown>;
};

// Re-export workflow event schemas from @alga-psa/event-schemas for backwards compatibility
export type {
  WorkflowEventBase,
  WorkflowEventProcessingStatus,
  WorkflowEventProcessing,
  RedisStreamMessage,
  WorkflowStreamEntry,
} from '@alga-psa/event-schemas';

export {
  WorkflowEventBaseSchema,
  WorkflowEventProcessingStatusSchema,
  WorkflowEventProcessingSchema,
  RedisStreamMessageSchema,
  WorkflowStreamEntrySchema,
  parseStreamEvent,
} from '@alga-psa/event-schemas';

/**
 * Convert a database workflow event to a stream event
 * This function remains local for legacy event-stream compatibility.
 */
export function toStreamEvent(event: LegacyWorkflowEventRecord): WorkflowEventBase {
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
