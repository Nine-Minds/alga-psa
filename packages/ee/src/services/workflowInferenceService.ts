import { createWorkflowInferenceService } from '../../../../shared/workflow/services/workflowInferenceService';
import { resolveChatProvider } from './chatProviderResolver';
import { toAiCreditsError } from '../lib/aiGateway/errors';

export { WorkflowInferenceServiceError } from '../../../../shared/workflow/services/workflowInferenceService';
export type { WorkflowStructuredOutputRequest } from '../../../../shared/workflow/services/workflowInferenceService';
export const inferWorkflowStructuredOutput = createWorkflowInferenceService({ resolveChatProvider, toAiCreditsError });
