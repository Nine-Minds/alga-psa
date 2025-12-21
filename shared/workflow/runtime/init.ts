import { getSchemaRegistry } from './registries/schemaRegistry';
import { registerDefaultNodes } from './nodes/registerDefaultNodes';
import { registerEmailWorkflowActionsV2 } from './actions/registerEmailWorkflowActions';
import { emailWorkflowPayloadSchema } from './schemas/emailWorkflowSchemas';

let initialized = false;

export function initializeWorkflowRuntimeV2(): void {
  if (initialized) return;
  const schemaRegistry = getSchemaRegistry();
  schemaRegistry.register('payload.EmailWorkflowPayload.v1', emailWorkflowPayloadSchema);

  registerDefaultNodes();
  registerEmailWorkflowActionsV2();

  initialized = true;
}

export function isWorkflowRuntimeV2Initialized(): boolean {
  return initialized;
}
