/**
 * Event type enum is sourced from the shared event bus schema so catalog types
 * stay aligned with publish/ingest validation.
 */
import { z } from 'zod';
import { EventTypeEnum, type EventType } from '../streams/eventBusSchema';

export { EventTypeEnum, type EventType };

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
  payload_schema_ref?: string;
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
  payload_schema_ref?: string;
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
  payload_schema_ref?: string;
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
  payload_schema_ref: z.string().optional(),
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
