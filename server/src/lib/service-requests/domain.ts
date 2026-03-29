export const SERVICE_REQUEST_EXECUTION_MODES = {
  TICKET_ONLY: 'ticket-only',
  WORKFLOW_ONLY: 'workflow-only',
  TICKET_PLUS_WORKFLOW: 'ticket-plus-workflow',
} as const;

export type ServiceRequestExecutionMode =
  (typeof SERVICE_REQUEST_EXECUTION_MODES)[keyof typeof SERVICE_REQUEST_EXECUTION_MODES];

export const SERVICE_REQUEST_LIFECYCLE_STATES = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
} as const;

export type ServiceRequestLifecycleState =
  (typeof SERVICE_REQUEST_LIFECYCLE_STATES)[keyof typeof SERVICE_REQUEST_LIFECYCLE_STATES];

export interface ServiceRequestPortalMetadata {
  name: string;
  description?: string | null;
  icon?: string | null;
  categoryId?: string | null;
  sortOrder?: number | null;
}

export interface ServiceRequestProviderSelection {
  executionProvider: string;
  executionConfig: Record<string, unknown>;
  formBehaviorProvider: string;
  formBehaviorConfig: Record<string, unknown>;
  visibilityProvider: string;
  visibilityConfig: Record<string, unknown>;
}

export interface ServiceRequestDefinitionShape {
  tenant: string;
  metadata: ServiceRequestPortalMetadata;
  linkedServiceId?: string | null;
  lifecycleState: ServiceRequestLifecycleState;
  providers: ServiceRequestProviderSelection;
}
