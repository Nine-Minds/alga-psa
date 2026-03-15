import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resolveChatProviderMock = vi.fn();

vi.mock('../chatProviderResolver', () => ({
  resolveChatProvider: (...args: unknown[]) => resolveChatProviderMock(...args),
}));

import {
  inferWorkflowStructuredOutput,
  WorkflowInferenceServiceError,
} from '../workflowInferenceService';

const buildProvider = (createImpl: (params: Record<string, unknown>) => Promise<unknown>) => ({
  providerId: 'openrouter' as const,
  model: 'test-model',
  client: {
    chat: {
      completions: {
        create: createImpl,
      },
    },
  },
  requestOverrides: {
    resolveTurnOverrides: () => ({ temperature: 0 }),
  },
});

describe('workflowInferenceService', () => {
  beforeEach(() => {
    resolveChatProviderMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('T034/T035/T036: resolves the configured provider, submits a structured-output request, and validates the result', async () => {
    const createMock = vi.fn(async (params: Record<string, unknown>) => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              category: 'billing',
              confidence: 0.92,
            }),
          },
        },
      ],
    }));
    resolveChatProviderMock.mockResolvedValue(buildProvider(createMock));

    const result = await inferWorkflowStructuredOutput({
      prompt: 'Classify this ticket',
      schema: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['category'],
        additionalProperties: false,
      },
      runId: 'run-1',
      stepPath: 'root.steps[0]',
    });

    expect(resolveChatProviderMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'test-model',
        temperature: 0,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'workflow_ai_output',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                category: { type: 'string' },
                confidence: { type: 'number' },
              },
              required: ['category'],
              additionalProperties: false,
            },
          },
        },
      })
    );
    expect(result).toEqual({
      category: 'billing',
      confidence: 0.92,
    });
  });

  it('T037: malformed model output that fails schema validation surfaces as a workflow-safe validation error', async () => {
    resolveChatProviderMock.mockResolvedValue(
      buildProvider(async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                confidence: 'not-a-number',
              }),
            },
          },
        ],
      }))
    );

    await expect(
      inferWorkflowStructuredOutput({
        prompt: 'Classify this ticket',
        schema: {
          type: 'object',
          properties: {
            confidence: { type: 'number' },
          },
          required: ['confidence'],
          additionalProperties: false,
        },
        runId: 'run-1',
        stepPath: 'root.steps[0]',
      })
    ).rejects.toMatchObject<Partial<WorkflowInferenceServiceError>>({
      category: 'ValidationError',
      code: 'AI_OUTPUT_VALIDATION_FAILED',
    });
  });

  it('T038: missing provider configuration fails with an actionable inference error', async () => {
    resolveChatProviderMock.mockRejectedValue(new Error('OpenRouter API key is not configured'));

    await expect(
      inferWorkflowStructuredOutput({
        prompt: 'Classify this ticket',
        schema: {
          type: 'object',
          properties: {
            category: { type: 'string' },
          },
          required: ['category'],
        },
        runId: 'run-1',
        stepPath: 'root.steps[0]',
      })
    ).rejects.toMatchObject<Partial<WorkflowInferenceServiceError>>({
      category: 'ActionError',
      code: 'AI_PROVIDER_NOT_CONFIGURED',
    });
  });

  it('T039: provider rate limits are retried before surfacing failure', async () => {
    vi.useFakeTimers();

    const createMock = vi
      .fn()
      .mockRejectedValueOnce({ status: 429 })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({ category: 'ops' }),
            },
          },
        ],
      });
    resolveChatProviderMock.mockResolvedValue(buildProvider(createMock));

    const promise = inferWorkflowStructuredOutput({
      prompt: 'Classify this ticket',
      schema: {
        type: 'object',
        properties: {
          category: { type: 'string' },
        },
        required: ['category'],
      },
      runId: 'run-1',
      stepPath: 'root.steps[0]',
    });

    await vi.advanceTimersByTimeAsync(500);
    await expect(promise).resolves.toEqual({ category: 'ops' });
    expect(createMock).toHaveBeenCalledTimes(2);
  });
});
