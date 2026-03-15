import { describe, expect, it } from 'vitest';

import {
  buildWorkflowAiSimpleSchema,
  hydrateWorkflowAiSimpleFields,
  parseWorkflowAiSchemaText,
  resolveWorkflowAiSchemaFromConfig,
  validateWorkflowAiSchema,
  type WorkflowAiSimpleField,
  type WorkflowJsonSchema,
} from '../aiSchema';

const simpleFields: WorkflowAiSimpleField[] = [
  {
    id: 'summary',
    name: 'summary',
    type: 'string',
    required: true,
    description: 'Short summary',
  },
  {
    id: 'sentiment',
    name: 'sentiment',
    type: 'string',
    required: false,
    description: 'Overall tone',
  },
  {
    id: 'details',
    name: 'details',
    type: 'object',
    required: false,
    children: [
      {
        id: 'confidence',
        name: 'confidence',
        type: 'number',
        required: true,
      },
    ],
  },
  {
    id: 'tags',
    name: 'tags',
    type: 'array',
    required: false,
    arrayItemType: 'string',
  },
  {
    id: 'actions',
    name: 'actions',
    type: 'array',
    required: false,
    arrayItemType: 'object',
    children: [
      {
        id: 'label',
        name: 'label',
        type: 'string',
        required: true,
      },
      {
        id: 'priority',
        name: 'priority',
        type: 'integer',
        required: false,
      },
    ],
  },
];

describe('workflow ai schema utilities', () => {
  it('T011/T012/T013/T014/T015/T016/T017: simple builder serializes the supported object-root subset canonically', () => {
    expect(buildWorkflowAiSimpleSchema(simpleFields)).toEqual({
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'Short summary',
        },
        sentiment: {
          type: 'string',
          description: 'Overall tone',
        },
        details: {
          type: 'object',
          properties: {
            confidence: {
              type: 'number',
            },
          },
          additionalProperties: false,
          required: ['confidence'],
        },
        tags: {
          type: 'array',
          items: {
            type: 'string',
          },
        },
        actions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: {
                type: 'string',
              },
              priority: {
                type: 'integer',
              },
            },
            additionalProperties: false,
            required: ['label'],
          },
        },
      },
      additionalProperties: false,
      required: ['summary'],
    });
  });

  it('T019: advanced schema validation rejects invalid JSON and unsupported v1 constructs', () => {
    expect(parseWorkflowAiSchemaText('{')).toMatchObject({
      schema: null,
    });

    expect(
      validateWorkflowAiSchema(
        {
          type: 'object',
          properties: {
            result: {
              anyOf: [{ type: 'string' }, { type: 'number' }],
            },
          },
        },
        'advanced'
      )
    ).toContain('AI output schema.properties.result cannot use anyOf in v1.');
  });

  it('T020: simple-compatible saved schemas rehydrate into the simple field tree', () => {
    const schema = buildWorkflowAiSimpleSchema(simpleFields);
    const hydrated = hydrateWorkflowAiSimpleFields(schema);

    expect(hydrated.ok).toBe(true);
    if (!hydrated.ok) return;
    expect(hydrated.fields).toHaveLength(5);
    expect(hydrated.fields.find((field) => field.name === 'details')?.children?.[0]).toMatchObject({
      name: 'confidence',
      type: 'number',
      required: true,
    });
    expect(hydrated.fields.find((field) => field.name === 'actions')).toMatchObject({
      type: 'array',
      arrayItemType: 'object',
    });
  });

  it('T021: advanced-only schemas stay out of simple mode without lossy conversion', () => {
    const advancedOnlySchema: WorkflowJsonSchema = {
      type: 'object',
      properties: {
        result: {
          type: 'object',
          additionalProperties: {
            type: 'string',
          },
        },
      },
    };

    const hydrated = hydrateWorkflowAiSimpleFields(advancedOnlySchema);
    expect(hydrated).toEqual({
      ok: false,
      reason: 'Simple mode does not support map-style object fields on result.',
    });

    const resolved = resolveWorkflowAiSchemaFromConfig({
      actionId: 'ai.infer',
      aiOutputSchemaMode: 'advanced',
      aiOutputSchemaText: JSON.stringify(advancedOnlySchema),
    });
    expect(resolved.schema).toEqual(advancedOnlySchema);
    expect(resolved.errors).toEqual([]);
  });
});
