import { isWorkflowAiInferAction } from '@alga-psa/workflows/authoring';

export const shouldRenderWorkflowAiSchemaSection = (
  stepType: string | null | undefined,
  actionId: string | null | undefined
): boolean => stepType === 'action.call' && isWorkflowAiInferAction(actionId);
