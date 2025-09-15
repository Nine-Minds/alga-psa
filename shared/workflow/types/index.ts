/**
 * Types index - exports all workflow type definitions
 */

// Export event catalog types with specific names to avoid conflicts
export type { 
  IEventCatalogEntry,
  ICreateEventCatalogEntry,
  IUpdateEventCatalogEntry,
  IWorkflowTrigger,
  ICreateWorkflowTrigger,
  IUpdateWorkflowTrigger,
  IWorkflowEventMapping,
  ICreateWorkflowEventMapping,
  IUpdateWorkflowEventMapping,
  IWorkflowEventAttachment,
  ICreateWorkflowEventAttachment,
  IUpdateWorkflowEventAttachment
} from './eventCatalog';

// Don't export EventType/EventTypeEnum from here - let streams handle it
