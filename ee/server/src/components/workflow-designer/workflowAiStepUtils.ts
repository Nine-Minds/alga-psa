import { isWorkflowAiInferAction } from '@shared/workflow/runtime/ai/aiSchema';

export const shouldRenderWorkflowAiSchemaSection = (
  stepType: string | null | undefined,
  actionId: string | null | undefined
): boolean => stepType === 'action.call' && isWorkflowAiInferAction(actionId);
