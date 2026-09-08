import { createWorkflowInferenceService } from '../../../../packages/workflow-inference/src/index';
import { resolveChatProvider } from './chatProviderResolver';
import { toAiCreditsError } from '../lib/aiGateway/errors';
import { notifyAiCreditsUnavailable } from '../lib/aiGateway/notifications';

export { WorkflowInferenceServiceError } from '../../../../packages/workflow-inference/src/index';
export type { WorkflowStructuredOutputRequest } from '../../../../packages/workflow-inference/src/index';
export const inferWorkflowStructuredOutput = createWorkflowInferenceService({ resolveChatProvider, toAiCreditsError, notifyAiCreditsUnavailable });
