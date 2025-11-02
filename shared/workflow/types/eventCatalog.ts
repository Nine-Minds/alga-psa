import { z } from 'zod';

/**
 * Event type enum copied from server/src/lib/eventBus/events.ts
 * This is duplicated here to avoid import issues between shared and server code
 */
export const EventTypeEnum = z.enum([
  'TICKET_CREATED',
  'TICKET_UPDATED',
  'TICKET_CLOSED',
  'TICKET_ASSIGNED',
  'TICKET_COMMENT_ADDED',
  'TICKET_DELETED',
  'PROJECT_CREATED',
  'PROJECT_UPDATED',
  'PROJECT_CLOSED',
  'PROJECT_ASSIGNED',
  'PROJECT_TASK_ASSIGNED',
  'TIME_ENTRY_SUBMITTED',
  'TIME_ENTRY_APPROVED',
  'INVOICE_GENERATED',
  'INVOICE_FINALIZED',
  'CUSTOM_EVENT', // Added for test events
  'INVOICE_CREATED', // QBO Invoice Created
  'INVOICE_UPDATED', // QBO Invoice Updated
  'CLIENT_CREATED', // QBO Client Created
  'CLIENT_UPDATED', // QBO Client Updated
  'INBOUND_EMAIL_RECEIVED', // Inbound email processing
  'ACCOUNTING_EXPORT_COMPLETED',
  'ACCOUNTING_EXPORT_FAILED',
  'SCHEDULE_ENTRY_CREATED',
  'SCHEDULE_ENTRY_UPDATED',
  'SCHEDULE_ENTRY_DELETED',
  'CALENDAR_SYNC_STARTED',
  'CALENDAR_SYNC_COMPLETED',
  'CALENDAR_SYNC_FAILED',
  'CALENDAR_CONFLICT_DETECTED',
  'UNKNOWN'
]);

export type EventType = z.infer<typeof EventTypeEnum>;

/**
 * Interface for an event catalog entry
 */
export interface IEventCatalogEntry {
  event_id: string;
  event_type: EventType;
  name: string;
  description?: string;
  category?: string;
  payload_schema: Record<string, any>;
  tenant: string;
  created_at: string;
  updated_at: string;
}

/**
 * Interface for creating a new event catalog entry
 */
export interface ICreateEventCatalogEntry {
  event_type: EventType;
  name: string;
  description?: string;
  category?: string;
  payload_schema: Record<string, any>;
  tenant: string;
}

/**
 * Interface for updating an event catalog entry
 */
export interface IUpdateEventCatalogEntry {
  name?: string;
  description?: string;
  category?: string;
  payload_schema?: Record<string, any>;
}

/**
 * Interface for a workflow trigger
 */
export interface IWorkflowTrigger {
  trigger_id: string;
  tenant: string;
  name: string;
  description?: string;
  event_type: EventType;
  created_at: string;
  updated_at: string;
}

/**
 * Interface for creating a new workflow trigger
 */
export interface ICreateWorkflowTrigger {
  tenant: string;
  name: string;
  description?: string;
  event_type: EventType;
}

/**
 * Interface for updating a workflow trigger
 */
export interface IUpdateWorkflowTrigger {
  name?: string;
  description?: string;
  event_type?: EventType;
}

/**
 * Interface for a workflow event mapping
 */
export interface IWorkflowEventMapping {
  mapping_id: string;
  trigger_id: string;
  event_field_path: string;
  workflow_parameter: string;
  transform_function?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Interface for creating a new workflow event mapping
 */
export interface ICreateWorkflowEventMapping {
  trigger_id: string;
  event_field_path: string;
  workflow_parameter: string;
  transform_function?: string;
}

/**
 * Interface for updating a workflow event mapping
 */
export interface IUpdateWorkflowEventMapping {
  event_field_path?: string;
  workflow_parameter?: string;
  transform_function?: string;
}

/**
 * Interface for a workflow event attachment
 */
export interface IWorkflowEventAttachment {
  attachment_id: string;
  workflow_id: string;
  workflow_name: string;
  workflow_version: string;
  event_type: string;
  tenant: string;
  is_active: boolean;
  isSystemManaged?: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Interface for creating a new workflow event attachment
 */
export interface ICreateWorkflowEventAttachment {
  workflow_id: string;
  event_type: string;
  tenant: string;
  is_active?: boolean;
}

/**
 * Interface for updating a workflow event attachment
 */
export interface IUpdateWorkflowEventAttachment {
  is_active?: boolean;
}

/**
 * Zod schema for validating event catalog entries
 */
export const EventCatalogEntrySchema = z.object({
  event_id: z.string(),
  event_type: EventTypeEnum,
  name: z.string(),
  description: z.string().optional(),
  category: z.string().optional(),
  payload_schema: z.record(z.any()),
  tenant: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

/**
 * Zod schema for validating workflow triggers
 */
export const WorkflowTriggerSchema = z.object({
  trigger_id: z.string(),
  tenant: z.string(),
  name: z.string(),
  description: z.string().optional(),
  event_type: EventTypeEnum,
  created_at: z.string(),
  updated_at: z.string(),
});

/**
 * Zod schema for validating workflow event mappings
 */
export const WorkflowEventMappingSchema = z.object({
  mapping_id: z.string(),
  trigger_id: z.string(),
  event_field_path: z.string(),
  workflow_parameter: z.string(),
  transform_function: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

/**
 * Zod schema for validating workflow event attachments
 */
export const WorkflowEventAttachmentSchema = z.object({
  attachment_id: z.string(),
  workflow_id: z.string(),
  workflow_name: z.string(),
  workflow_version: z.string(),
  event_type: z.string(),
  tenant: z.string(),
  is_active: z.boolean().default(true),
  created_at: z.string(),
  updated_at: z.string(),
});
