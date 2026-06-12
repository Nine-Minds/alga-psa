import { getSchemaRegistry } from './registries/schemaRegistry';
import { registerDefaultNodes } from './nodes/registerDefaultNodes';
import { registerEmailWorkflowActionsV2 } from './actions/registerEmailWorkflowActions';
import { registerBusinessOperationsActionsV2 } from './actions/registerBusinessOperationsActions';
import { registerTransformActionsV2 } from './actions/registerTransformActions';
import { emailWorkflowPayloadSchema } from './schemas/emailWorkflowSchemas';
import { emptyWorkflowPayloadSchema, EMPTY_WORKFLOW_PAYLOAD_SCHEMA_REF } from './schemas/emptyWorkflowPayloadSchema';
import { workflowClockTriggerPayloadSchema, WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF } from './schemas/workflowClockTriggerSchema';
import { workflowEventPayloadSchemas } from './schemas/workflowEventPayloadSchemas';

let initialized = false;

export function initializeWorkflowRuntimeV2(): void {
  if (initialized) return;
  const schemaRegistry = getSchemaRegistry();
  // Use has() guards so re-init (e.g. via HMR or dual module instances) is safe.
  if (!schemaRegistry.has(EMPTY_WORKFLOW_PAYLOAD_SCHEMA_REF)) {
    schemaRegistry.register(EMPTY_WORKFLOW_PAYLOAD_SCHEMA_REF, emptyWorkflowPayloadSchema);
  }
  if (!schemaRegistry.has('payload.EmailWorkflowPayload.v1')) {
    schemaRegistry.register('payload.EmailWorkflowPayload.v1', emailWorkflowPayloadSchema);
  }
  if (!schemaRegistry.has(WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF)) {
    schemaRegistry.register(WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF, workflowClockTriggerPayloadSchema);
  }
  for (const [ref, schema] of Object.entries(workflowEventPayloadSchemas)) {
    if (!schemaRegistry.has(ref)) {
      schemaRegistry.register(ref, schema);
    }
  }

  registerDefaultNodes();
  registerEmailWorkflowActionsV2();
  registerBusinessOperationsActionsV2();
  registerTransformActionsV2();

  initialized = true;
}

export function isWorkflowRuntimeV2Initialized(): boolean {
  return initialized;
}
