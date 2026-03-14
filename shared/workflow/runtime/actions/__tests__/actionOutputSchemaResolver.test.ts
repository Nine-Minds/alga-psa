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

  it('T023/T024: resolves compose-text outputs from config-derived stable keys instead of the registry catch-all schema', () => {
    const registry = new ActionRegistry();
    registry.register({
      id: 'transform.compose_text',
      version: 1,
      inputSchema: z.object({}),
      outputSchema: z.record(z.string()),
      sideEffectful: false,
      idempotency: { mode: 'engineProvided' },
      handler: async () => ({ prompt: 'ok' }),
    });

    const composeSchema = resolveActionCallOutputSchema(registry, {
      actionId: 'transform.compose_text',
      version: 1,
      outputs: [
        {
          id: 'out-1',
          label: 'Prompt',
          stableKey: 'prompt',
          document: { version: 1, blocks: [] },
        },
        {
          id: 'out-2',
          label: 'Email Body',
          stableKey: 'email_body',
          document: { version: 1, blocks: [] },
        },
      ],
    });

    expect(composeSchema).toEqual({
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Prompt' },
        email_body: { type: 'string', description: 'Email Body' },
      },
      required: ['prompt', 'email_body'],
      additionalProperties: false,
    });
  });

  it('T024: updates compose-text output schemas when outputs change while keeping stable-key paths deterministic', () => {
    const registry = new ActionRegistry();
    registry.register({
      id: 'transform.compose_text',
      version: 1,
      inputSchema: z.object({}),
      outputSchema: z.record(z.string()),
      sideEffectful: false,
      idempotency: { mode: 'engineProvided' },
      handler: async () => ({ prompt: 'ok' }),
    });

    const renamedSchema = resolveActionCallOutputSchema(registry, {
      actionId: 'transform.compose_text',
      version: 1,
      outputs: [
        {
          id: 'out-1',
          label: 'Customer Prompt',
          stableKey: 'prompt',
          document: { version: 1, blocks: [] },
        },
      ],
    });
    const expandedSchema = resolveActionCallOutputSchema(registry, {
      actionId: 'transform.compose_text',
      version: 1,
      outputs: [
        {
          id: 'out-1',
          label: 'Customer Prompt',
          stableKey: 'prompt',
          document: { version: 1, blocks: [] },
        },
        {
          id: 'out-2',
          label: 'Summary',
          stableKey: 'summary',
          document: { version: 1, blocks: [] },
        },
      ],
    });

    expect(renamedSchema).toEqual({
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Customer Prompt' },
      },
      required: ['prompt'],
      additionalProperties: false,
    });
    expect(expandedSchema).toEqual({
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Customer Prompt' },
        summary: { type: 'string', description: 'Summary' },
      },
      required: ['prompt', 'summary'],
      additionalProperties: false,
    });
  });
});
