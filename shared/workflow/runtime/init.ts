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
  schemaRegistry.register(EMPTY_WORKFLOW_PAYLOAD_SCHEMA_REF, emptyWorkflowPayloadSchema);
  schemaRegistry.register('payload.EmailWorkflowPayload.v1', emailWorkflowPayloadSchema);
  schemaRegistry.register(WORKFLOW_CLOCK_PAYLOAD_SCHEMA_REF, workflowClockTriggerPayloadSchema);
  for (const [ref, schema] of Object.entries(workflowEventPayloadSchemas)) {
    schemaRegistry.register(ref, schema);
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
