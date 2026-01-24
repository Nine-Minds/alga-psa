// Local RedisStreamClient exports
export { RedisStreamClient, getRedisStreamClient } from './redisStreamClient';

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

// Re-export event types from @alga-psa/event-schemas for backwards compatibility
export type { EventType } from '@alga-psa/event-schemas';
export { EventTypeEnum } from '@alga-psa/event-schemas';

// Keep local toStreamEvent function that depends on local IWorkflowEvent
export { toStreamEvent } from './workflowEventSchema';
