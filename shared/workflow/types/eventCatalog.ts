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
  payload_schema: Record<string, any>; // JSON Schema for the event payload
  // is_system_event: boolean; // Removed as per system_event_catalog introduction
  tenant_id: string;
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
  // is_system_event?: boolean; // Removed as per system_event_catalog introduction
  tenant_id: string;
}

/**
 * Interface for updating an event catalog entry
 */
export interface IUpdateEventCatalogEntry {
  name?: string;
  description?: string;
  category?: string;
  payload_schema?: Record<string, any>;
  // is_system_event?: boolean; // Removed as per system_event_catalog introduction
}

/**
 * Interface for a workflow trigger
 */
export interface IWorkflowTrigger {
  trigger_id: string;
  tenant_id: string;
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
  tenant_id: string;
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
  workflow_name: string; // Added workflow name
  workflow_version: string; // Added workflow version
  event_type: string; // Changed from event_id
  tenant_id: string;
  is_active: boolean;
  isSystemManaged?: boolean; // Added flag for system managed workflows
  created_at: string;
  updated_at: string;
}

/**
 * Interface for creating a new workflow event attachment
 */
export interface ICreateWorkflowEventAttachment {
  workflow_id: string;
  event_type: string; // Changed from event_id
  tenant_id: string;
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
  event_id: z.string().uuid(),
  event_type: EventTypeEnum,
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  payload_schema: z.record(z.any()),
  // is_system_event: z.boolean().default(false), // Removed as per system_event_catalog introduction
  tenant_id: z.string().uuid(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
});

/**
 * Zod schema for validating workflow triggers
 */
export const WorkflowTriggerSchema = z.object({
  trigger_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().optional(),
  event_type: EventTypeEnum,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
});

/**
 * Zod schema for validating workflow event mappings
 */
export const WorkflowEventMappingSchema = z.object({
  mapping_id: z.string().uuid(),
  trigger_id: z.string().uuid(),
  event_field_path: z.string().min(1),
  workflow_parameter: z.string().min(1),
  transform_function: z.string().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
});

/**
 * Zod schema for validating workflow event attachments
 */
export const WorkflowEventAttachmentSchema = z.object({
  attachment_id: z.string().uuid(),
  workflow_id: z.string().uuid(),
  workflow_name: z.string(), // Added workflow name
  workflow_version: z.string(), // Added workflow version
  event_type: z.string(), // Changed from event_id: z.string().uuid()
  tenant_id: z.string().uuid(),
  is_active: z.boolean().default(true),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
});