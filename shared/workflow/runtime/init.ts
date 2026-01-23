import { getSchemaRegistry } from './registries/schemaRegistry';
import { registerDefaultNodes } from './nodes/registerDefaultNodes';
import { registerEmailWorkflowActionsV2 } from './actions/registerEmailWorkflowActions';
import { registerBusinessOperationsActionsV2 } from './actions/registerBusinessOperationsActions';
import { emailWorkflowPayloadSchema } from './schemas/emailWorkflowSchemas';
import { workflowEventPayloadSchemas } from './schemas/workflowEventPayloadSchemas';

let initialized = false;

export function initializeWorkflowRuntimeV2(): void {
  if (initialized) return;
  const schemaRegistry = getSchemaRegistry();
  schemaRegistry.register('payload.EmailWorkflowPayload.v1', emailWorkflowPayloadSchema);
  for (const [ref, schema] of Object.entries(workflowEventPayloadSchemas)) {
    schemaRegistry.register(ref, schema);
  }

  registerDefaultNodes();
  registerEmailWorkflowActionsV2();
  registerBusinessOperationsActionsV2();

  initialized = true;
}

export function isWorkflowRuntimeV2Initialized(): boolean {
  return initialized;
}
