import {
  configureWorkflowAiInferenceService,
  registerAiActionsV2,
} from '../../../../../shared/workflow/runtime/actions/registerAiActions';
import { inferWorkflowStructuredOutput } from '../../../../../packages/ee/src/services/workflowInferenceService';
import { initializeWorkflowRuntimeV2 as initializeWorkflowRuntimeV2Core } from './core';

export * from './core';

export function initializeWorkflowRuntimeV2(): void {
  initializeWorkflowRuntimeV2Core();
  configureWorkflowAiInferenceService(inferWorkflowStructuredOutput);
  registerAiActionsV2();
}
