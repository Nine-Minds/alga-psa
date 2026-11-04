export const WORKFLOW_EVENT_CATALOG = {
  THING_CREATED: { schemaRef: 'payload.ThingCreated.v1' },
  THING_DELETED: { schemaRef: 'payload.ThingDeleted.v1' },
} as const;
export type WorkflowCatalogEventType = keyof typeof WORKFLOW_EVENT_CATALOG;
