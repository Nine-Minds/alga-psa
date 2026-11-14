import {
  configureWorkflowAiInferenceService,
  registerAiActionsV2,
} from '../../../../../shared/workflow/runtime/actions/registerAiActions';
import { initializeWorkflowRuntimeV2 as initializeWorkflowRuntimeV2Core } from './core';

export * from './core';

export function initializeWorkflowRuntimeV2(): void {
  initializeWorkflowRuntimeV2Core();
  // Catalog registration must not load provider SDKs before an AI action runs.
  configureWorkflowAiInferenceService(async (request) => {
    const { inferWorkflowStructuredOutput } = await import('../../../../../packages/ee/src/services/workflowInferenceService');
    return inferWorkflowStructuredOutput(request);
  });
  registerAiActionsV2();
}
