import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  buildWorkflowJsonDescription,
  withWorkflowJsonSchemaMetadata,
  zodToWorkflowJsonSchema,
} from '../jsonSchemaMetadata';

describe('workflow json schema metadata', () => {
  it('T161/T162/T163/T164: preserves additive picker annotations through JSON-schema export', () => {
    const schema = z.object({
      board_id: withWorkflowJsonSchemaMetadata(
        z.string(),
        'Board id',
        {
          'x-workflow-picker-kind': 'board',
          'x-workflow-picker-dependencies': ['client_id'],
          'x-workflow-picker-fixed-value-hint': 'search',
          'x-workflow-picker-allow-dynamic-reference': true,
        }
      ),
      prompt: withWorkflowJsonSchemaMetadata(
        z.string(),
        'Prompt text sent to the configured AI provider',
        {
          'x-workflow-editor': {
            kind: 'text',
            inline: { mode: 'textarea' },
            dialog: { mode: 'large-text' },
          },
        }
      ),
    });

    const jsonSchema = zodToWorkflowJsonSchema(schema);
    const property = (jsonSchema.properties as Record<string, Record<string, unknown>>).board_id;
    const promptProperty = (jsonSchema.properties as Record<string, Record<string, unknown>>).prompt;

    expect(property.description).toBe('Board id');
    expect(property['x-workflow-picker-kind']).toBe('board');
    expect(property['x-workflow-picker-dependencies']).toEqual(['client_id']);
    expect(property['x-workflow-picker-fixed-value-hint']).toBe('search');
    expect(property['x-workflow-picker-allow-dynamic-reference']).toBe(true);
    expect(promptProperty.description).toBe('Prompt text sent to the configured AI provider');
    expect(promptProperty['x-workflow-editor']).toEqual({
      kind: 'text',
      inline: { mode: 'textarea' },
      dialog: { mode: 'large-text' },
    });
  });

  it('keeps plain descriptions readable when no additive workflow metadata is present', () => {
    const schema = z.object({
      summary: z.string().describe('Ticket summary'),
      client_id: z.string().describe(buildWorkflowJsonDescription('Client id')),
    });

    const jsonSchema = zodToWorkflowJsonSchema(schema);
    const properties = jsonSchema.properties as Record<string, Record<string, unknown>>;

    expect(properties.summary?.description).toBe('Ticket summary');
    expect(properties.client_id?.description).toBe('Client id');
  });
});
