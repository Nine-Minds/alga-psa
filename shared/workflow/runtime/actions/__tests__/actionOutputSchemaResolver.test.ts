import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ActionRegistry } from '../../registries/actionRegistry';
import { resolveActionCallOutputSchema } from '../actionOutputSchemaResolver';

describe('resolveActionCallOutputSchema', () => {
  it('T030/T043: publish-time vars typing resolves inline AI schemas while non-AI actions keep registry output schemas', () => {
    const registry = new ActionRegistry();
    registry.register({
      id: 'test.echo',
      version: 1,
      inputSchema: z.object({ value: z.string() }),
      outputSchema: z.object({
        value: z.string(),
      }),
      sideEffectful: false,
      idempotency: { mode: 'engineProvided' },
      handler: async () => ({ value: 'ok' }),
    });

    const aiSchema = resolveActionCallOutputSchema(registry, {
      actionId: 'ai.infer',
      version: 1,
      aiOutputSchemaMode: 'simple',
      aiOutputSchema: {
        type: 'object',
        properties: {
          category: { type: 'string' },
        },
        required: ['category'],
        additionalProperties: false,
      },
    });

    const nonAiSchema = resolveActionCallOutputSchema(registry, {
      actionId: 'test.echo',
      version: 1,
    });

    expect(aiSchema).toEqual({
      type: 'object',
      properties: {
        category: { type: 'string' },
      },
      required: ['category'],
      additionalProperties: false,
    });
    expect(nonAiSchema).toMatchObject({
      $ref: expect.stringContaining('test.echo@1.output'),
    });
  });
});
