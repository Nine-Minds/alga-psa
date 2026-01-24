import { IWorkflowEvent } from '../persistence/index';
import type { WorkflowEventBase } from '@alga-psa/event-schemas';

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
 * This function remains local because it depends on IWorkflowEvent from persistence
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
