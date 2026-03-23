import {
  configureWorkflowAiInferenceService,
  registerAiActionsV2,
} from '../../../../../shared/workflow/runtime/actions/registerAiActions';
import {
  inferWorkflowStructuredOutput,
} from '../../../../../packages/ee/src/services/workflowInferenceService';
import {
  initializeWorkflowRuntimeV2 as initializeSharedWorkflowRuntimeV2,
  isWorkflowRuntimeV2Initialized,
} from '../../../../../shared/workflow/runtime/init';

export * from '../../../../../shared/workflow/runtime';
export * from '../../../../../shared/workflow/runtime/ai/aiSchema';
export * from '../../../../../shared/workflow/runtime/client';
export * from '../../../../../shared/workflow/runtime/designer/actionCatalog';
export * from '../../../../../shared/workflow/runtime/jsonSchemaMetadata';
export * from '../../../../../shared/workflow/runtime/actions/actionOutputSchemaResolver';
export * from '../../../../../shared/workflow/runtime/actions/registerEmailWorkflowActions';
export * from '../../../../../shared/workflow/runtime/registries/actionRegistry';
export * from '../../../../../shared/workflow/runtime/registries/schemaRegistry';
export * from '../../../../../shared/workflow/runtime/schemas/assetMediaEventSchemas';
export * from '../../../../../shared/workflow/runtime/schemas/billingEventSchemas';
export * from '../../../../../shared/workflow/runtime/schemas/commonEventPayloadSchemas';
export * from '../../../../../shared/workflow/runtime/schemas/communicationsEventSchemas';
export * from '../../../../../shared/workflow/runtime/schemas/crmEventSchemas';
export * from '../../../../../shared/workflow/runtime/schemas/documentEventSchemas';
export * from '../../../../../shared/workflow/runtime/schemas/emailWorkflowSchemas';
export * from '../../../../../shared/workflow/runtime/schemas/emptyWorkflowPayloadSchema';
export * from '../../../../../shared/workflow/runtime/schemas/integrationEventSchemas';
export * from '../../../../../shared/workflow/runtime/schemas/projectEventSchemas';
export * from '../../../../../shared/workflow/runtime/schemas/schedulingEventSchemas';
export * from '../../../../../shared/workflow/runtime/schemas/ticketEventSchemas';
export * from '../../../../../shared/workflow/runtime/schemas/timeEventSchemas';
export * from '../../../../../shared/workflow/runtime/schemas/workflowClockTriggerSchema';
export * from '../../../../../shared/workflow/runtime/schemas/workflowEventPayloadSchemas';
export * from '../../../../../shared/workflow/runtime/types';
export * from '../../../../../shared/workflow/runtime/utils/assignmentUtils';
export * from '../../../../../shared/workflow/runtime/utils/idempotencyUtils';
export * from '../../../../../shared/workflow/runtime/utils/mappingResolver';
export * from '../../../../../shared/workflow/runtime/utils/nodePathUtils';
export * from '../../../../../shared/workflow/runtime/utils/redactionUtils';
export * from '../../../../../shared/workflow/runtime/utils/retryUtils';
export * from '../../../../../shared/workflow/runtime/validation/mappingValidator';
export * from '../../../../../shared/workflow/runtime/validation/publishValidation';
export { validateExpressionSource } from '../../../../../shared/workflow/runtime/expressionEngine';
export { WORKFLOW_RUNTIME_ALLOWED_FUNCTIONS } from '../../../../../shared/workflow/runtime/expressionFunctions';

export function initializeWorkflowRuntimeV2(): void {
  initializeSharedWorkflowRuntimeV2();
  configureWorkflowAiInferenceService(inferWorkflowStructuredOutput);
  registerAiActionsV2();
}

export { isWorkflowRuntimeV2Initialized };
