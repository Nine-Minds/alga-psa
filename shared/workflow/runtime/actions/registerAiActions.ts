import { z } from 'zod';

import { getActionRegistryV2 } from '../registries/actionRegistry';
import type { WorkflowJsonSchema } from '../ai/aiSchema';
import { isWorkflowAiInferAction, resolveWorkflowAiSchemaFromConfig } from '../ai/aiSchema';
import { withWorkflowJsonSchemaMetadata } from '../jsonSchemaMetadata';
import { throwActionError } from './businessOperations/shared';

const aiInferInputSchema = z.object({
  prompt: withWorkflowJsonSchemaMetadata(
    z.string().min(1),
    'Prompt text sent to the configured AI provider',
    {
      'x-workflow-editor': {
        kind: 'text',
        inline: { mode: 'textarea' },
        dialog: { mode: 'large-text' },
      },
    }
  )
});

const aiInferOutputSchema = z.object({}).passthrough();

type WorkflowAiInferenceRequest = {
  prompt: string;
  schema: WorkflowJsonSchema;
  tenantId?: string | null;
  runId: string;
  stepPath: string;
};

type WorkflowAiInferenceResult = Promise<Record<string, unknown>>;

type WorkflowAiInferenceService = (request: WorkflowAiInferenceRequest) => WorkflowAiInferenceResult;

type WorkflowInferenceServiceErrorLike = {
  category: 'ValidationError' | 'ActionError' | 'TransientError';
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

let workflowAiInferenceService: WorkflowAiInferenceService | null = null;

const isWorkflowInferenceServiceErrorLike = (error: unknown): error is WorkflowInferenceServiceErrorLike => {
  if (!error || typeof error !== 'object') return false;
  const category = (error as { category?: unknown }).category;
  const code = (error as { code?: unknown }).code;
  const message = (error as { message?: unknown }).message;
  return (
    (category === 'ValidationError' || category === 'ActionError' || category === 'TransientError')
    && typeof code === 'string'
    && typeof message === 'string'
  );
};

export function configureWorkflowAiInferenceService(service: WorkflowAiInferenceService | null): void {
  workflowAiInferenceService = service;
}

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
        if (!workflowAiInferenceService) {
          throwActionError(ctx, {
            category: 'ActionError',
            code: 'AI_PROVIDER_NOT_REGISTERED',
            message: 'AI workflow inference service is not registered.',
          });
        }

        return await workflowAiInferenceService({
          prompt: input.prompt,
          schema: resolvedSchema.schema,
          tenantId: ctx.tenantId ?? null,
          runId: ctx.runId,
          stepPath: ctx.stepPath,
        });
      } catch (error) {
        if (isWorkflowInferenceServiceErrorLike(error)) {
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
