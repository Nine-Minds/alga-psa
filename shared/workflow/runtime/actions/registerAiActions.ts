import { z } from 'zod';

import { getActionRegistryV2 } from '../registries/actionRegistry';
import { isWorkflowAiInferAction, resolveWorkflowAiSchemaFromConfig } from '../ai/aiSchema';
import { throwActionError } from './businessOperations/shared';
import {
  inferWorkflowStructuredOutput,
  WorkflowInferenceServiceError,
} from '../../../../packages/ee/src/services/workflowInferenceService';

const aiInferInputSchema = z.object({
  prompt: z.string().min(1).describe('Prompt text sent to the configured AI provider')
});

const aiInferOutputSchema = z.object({}).passthrough();

export function registerAiActionsV2(): void {
  const registry = getActionRegistryV2();

  if (registry.get('ai.infer', 1)) {
    return;
  }

  registry.register({
    id: 'ai.infer',
    version: 1,
    inputSchema: aiInferInputSchema,
    outputSchema: aiInferOutputSchema,
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Infer Structured Output',
      category: 'AI',
      description: 'Generate structured workflow data from a prompt using the configured AI provider.',
      icon: 'ai',
    },
    handler: async (input, ctx) => {
      const actionId = typeof ctx.stepConfig === 'object' && ctx.stepConfig !== null
        ? (ctx.stepConfig as { actionId?: unknown }).actionId
        : null;
      if (!isWorkflowAiInferAction(actionId)) {
        throwActionError(ctx, {
          category: 'ValidationError',
          code: 'AI_INFERENCE_CONFIG_INVALID',
          message: 'AI inference step config is missing or invalid.',
        });
      }

      const resolvedSchema = resolveWorkflowAiSchemaFromConfig(ctx.stepConfig);
      if (!resolvedSchema.schema || resolvedSchema.errors.length > 0) {
        throwActionError(ctx, {
          category: 'ValidationError',
          code: 'AI_OUTPUT_SCHEMA_INVALID',
          message: resolvedSchema.errors[0] ?? 'AI output schema is missing or invalid.',
          details: {
            errors: resolvedSchema.errors,
            mode: resolvedSchema.mode,
          },
        });
      }

      try {
        return await inferWorkflowStructuredOutput({
          prompt: input.prompt,
          schema: resolvedSchema.schema,
          tenantId: ctx.tenantId ?? null,
          runId: ctx.runId,
          stepPath: ctx.stepPath,
        });
      } catch (error) {
        if (error instanceof WorkflowInferenceServiceError) {
          throwActionError(ctx, {
            category: error.category,
            code: error.code,
            message: error.message,
            details: error.details,
          });
        }
        throw error;
      }
    },
  });
}
