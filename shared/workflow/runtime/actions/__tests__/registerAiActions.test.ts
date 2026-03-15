import { beforeAll, describe, expect, it, vi } from 'vitest';

import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { configureWorkflowAiInferenceService, registerAiActionsV2 } from '../registerAiActions';

describe('registerAiActionsV2', () => {
  beforeAll(() => {
    if (!getActionRegistryV2().get('ai.infer', 1)) {
      registerAiActionsV2();
    }
  });

  it('T002/T034: registers ai.infer with structured prompt input and object output metadata', () => {
    const action = getActionRegistryV2().get('ai.infer', 1);

    expect(action).toBeDefined();
    expect(action?.ui).toMatchObject({
      label: 'Infer Structured Output',
      category: 'AI',
      icon: 'ai',
    });
    expect(action?.inputSchema.safeParse({ prompt: 'Summarize this ticket.' }).success).toBe(true);
    expect(action?.inputSchema.safeParse({}).success).toBe(false);
    expect(action?.outputSchema.safeParse({ summary: 'short' }).success).toBe(true);
    expect(action?.sideEffectful).toBe(false);
  });

  it('T040: ai.infer delegates to the workflow inference service with the resolved inline schema', async () => {
    const action = getActionRegistryV2().get('ai.infer', 1);
    expect(action).toBeDefined();

    const inferSpy = vi.fn().mockResolvedValueOnce({
        category: 'billing',
        confidence: 0.82,
      });
    configureWorkflowAiInferenceService(inferSpy);

    const result = await action!.handler(
      { prompt: 'Classify this ticket.' },
      {
        runId: 'run-1',
        stepPath: 'root.steps[0]',
        stepConfig: {
          actionId: 'ai.infer',
          version: 1,
          aiOutputSchemaMode: 'simple',
          aiOutputSchema: {
            type: 'object',
            properties: {
              category: { type: 'string' },
              confidence: { type: 'number' },
            },
            required: ['category'],
            additionalProperties: false,
          },
        },
        tenantId: 'tenant-1',
        idempotencyKey: 'idem-1',
        attempt: 1,
        nowIso: () => new Date('2026-03-14T00:00:00.000Z').toISOString(),
        env: {},
      }
    );

    expect(result).toEqual({
      category: 'billing',
      confidence: 0.82,
    });
    expect(inferSpy).toHaveBeenCalledWith({
      prompt: 'Classify this ticket.',
      schema: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['category'],
        additionalProperties: false,
      },
      tenantId: 'tenant-1',
      runId: 'run-1',
      stepPath: 'root.steps[0]',
    });

    configureWorkflowAiInferenceService(null);
  });
});
