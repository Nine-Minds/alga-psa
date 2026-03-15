import { describe, expect, it } from 'vitest';

import {
  applyWorkflowActionPresentationHints,
  applyWorkflowActionPresentationHintsToList,
} from '../workflowActionPresentation';

describe('workflowActionPresentation', () => {
  it('adds unified editor metadata to ai.infer.prompt', () => {
    const action = {
      id: 'ai.infer',
      version: 1,
      inputSchema: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Prompt text sent to the configured AI provider',
          },
        },
      },
      outputSchema: {
        type: 'object',
        properties: {},
      },
    };

    const normalized = applyWorkflowActionPresentationHints(action);

    expect(normalized.inputSchema.properties?.prompt?.['x-workflow-editor']).toEqual({
      kind: 'text',
      inline: { mode: 'textarea' },
      dialog: { mode: 'large-text' },
    });
  });

  it('leaves non-ai actions unchanged', () => {
    const action = {
      id: 'tickets.create',
      version: 1,
      inputSchema: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
          },
        },
      },
      outputSchema: {
        type: 'object',
        properties: {},
      },
    };

    expect(applyWorkflowActionPresentationHints(action)).toEqual(action);
  });

  it('normalizes action lists', () => {
    const normalized = applyWorkflowActionPresentationHintsToList([
      {
        id: 'ai.infer',
        version: 1,
        inputSchema: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
            },
          },
        },
      },
      {
        id: 'tickets.create',
        version: 1,
        inputSchema: {
          type: 'object',
          properties: {
            summary: {
              type: 'string',
            },
          },
        },
      },
    ]);

    expect(normalized[0].inputSchema.properties?.prompt?.['x-workflow-editor']).toEqual({
      kind: 'text',
      inline: { mode: 'textarea' },
      dialog: { mode: 'large-text' },
    });
    expect(normalized[1].inputSchema.properties?.summary?.['x-workflow-editor']).toBeUndefined();
  });

  it('adds unified editor metadata when ai.infer inputSchema is rooted through a named definition', () => {
    const action = {
      id: 'ai.infer',
      version: 1,
      inputSchema: {
        $ref: '#/definitions/ai.infer@1.input',
        definitions: {
          'ai.infer@1.input': {
            type: 'object',
            properties: {
              prompt: {
                type: 'string',
              },
            },
          },
        },
      },
    };

    const normalized = applyWorkflowActionPresentationHints(action);
    const root = normalized.inputSchema.definitions?.['ai.infer@1.input'];

    expect(root?.properties?.prompt?.['x-workflow-editor']).toEqual({
      kind: 'text',
      inline: { mode: 'textarea' },
      dialog: { mode: 'large-text' },
    });
  });
});
