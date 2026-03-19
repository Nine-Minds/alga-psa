import { describe, expect, it } from 'vitest';

import { buildWorkflowReferenceFieldOptions } from '../workflowReferenceOptions';
import type { DataContext } from '../workflowDataContext';

const payloadSchema = {
  type: 'object',
  properties: {
    ticket: {
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
    },
    summary: { type: 'string' },
  },
};

const baseDataContext: DataContext = {
  payload: [],
  payloadSchema,
  steps: [
    {
      stepId: 'step-1',
      stepName: 'Create Ticket',
      saveAs: 'ticketResult',
      outputSchema: {
        type: 'object',
        properties: {
          ticket_id: { type: 'string' },
          requester: {
            type: 'object',
            properties: {
              email: { type: 'string' },
            },
          },
        },
      },
      fields: [],
    },
  ],
  globals: {
    env: [],
    secrets: [],
    meta: [],
    error: [],
  },
};

describe('workflow reference options', () => {
  it('T141/T142/T143/T146/T147/T148: builds selectable payload, step-output, and metadata options for Reference mode', () => {
    const options = buildWorkflowReferenceFieldOptions(payloadSchema, baseDataContext);
    const values = options.map((option) => option.value);

    expect(values).toContain('payload');
    expect(values).toContain('payload.ticket.id');
    expect(values).toContain('payload.summary');
    expect(values).toContain('vars');
    expect(values).toContain('vars.ticketResult');
    expect(values).toContain('vars.ticketResult.ticket_id');
    expect(values).toContain('vars.ticketResult.requester.email');
    expect(values).toContain('meta');
    expect(values).toContain('meta.traceId');
    expect(values).toContain('meta.tags');
    expect(options.find((option) => option.value === 'vars.ticketResult')?.label).toContain(
      'Create Ticket'
    );
  });

  it('T154: hides placeholder payload children when no payload schema is available', () => {
    const values = buildWorkflowReferenceFieldOptions(null, {
      ...baseDataContext,
      payloadSchema: null,
      steps: [
        {
          stepId: 'step-1',
          stepName: 'Unknown output',
          saveAs: 'unknownResult',
          outputSchema: {},
          fields: [],
        },
      ],
    }).map((option) => option.value);

    expect(values).toContain('payload');
    expect(values).toContain('vars.unknownResult');
    expect(values).not.toContain('payload.id');
    expect(values).not.toContain('payload.type');
    expect(values).not.toContain('payload.data');
  });

  it('T144/T317: only exposes error options when the current step is inside catch context', () => {
    const normalValues = buildWorkflowReferenceFieldOptions(payloadSchema, baseDataContext).map(
      (option) => option.value
    );
    const catchValues = buildWorkflowReferenceFieldOptions(payloadSchema, {
      ...baseDataContext,
      inCatchBlock: true,
    }).map((option) => option.value);

    expect(normalValues).not.toContain('error');
    expect(normalValues).not.toContain('error.message');
    expect(catchValues).toContain('error');
    expect(catchValues).toContain('error.message');
    expect(catchValues).toContain('error.stack');
  });

  it('T145/T316: adds loop item and index variables when the current step is inside a forEach block', () => {
    const values = buildWorkflowReferenceFieldOptions(payloadSchema, {
      ...baseDataContext,
      forEach: {
        itemVar: 'ticketItem',
        indexVar: '$index',
        itemType: 'object',
      },
    }).map((option) => option.value);

    expect(values).toContain('ticketItem');
    expect(values).toContain('$index');
  });

  it('T155/T156: refreshes step-output reference options when upstream action schemas or saveAs names change', () => {
    const initialValues = buildWorkflowReferenceFieldOptions(payloadSchema, baseDataContext).map(
      (option) => option.value
    );
    const updatedValues = buildWorkflowReferenceFieldOptions(payloadSchema, {
      ...baseDataContext,
      steps: [
        {
          stepId: 'step-1',
          stepName: 'Update Ticket',
          saveAs: 'updatedTicket',
          outputSchema: {
            type: 'object',
            properties: {
              updated: { type: 'boolean' },
            },
          },
          fields: [],
        },
      ],
    }).map((option) => option.value);

    expect(initialValues).toContain('vars.ticketResult.ticket_id');
    expect(updatedValues).not.toContain('vars.ticketResult');
    expect(updatedValues).not.toContain('vars.ticketResult.ticket_id');
    expect(updatedValues).toContain('vars.updatedTicket');
    expect(updatedValues).toContain('vars.updatedTicket.updated');
  });

  it('T232: transform outputs appear in later-step reference pickers using saveAs names and typed fields', () => {
    const options = buildWorkflowReferenceFieldOptions(payloadSchema, {
      ...baseDataContext,
      steps: [
        {
          stepId: 'transform-step',
          stepName: 'Truncate Text',
          saveAs: 'trimmedText',
          outputSchema: {
            type: 'object',
            properties: {
              text: { type: 'string' },
            },
          },
          fields: [],
        },
      ],
    });

    const values = options.map((option) => option.value);
    expect(values).toContain('vars.trimmedText');
    expect(values).toContain('vars.trimmedText.text');
    expect(options.find((option) => option.value === 'vars.trimmedText')?.label).toContain(
      'Truncate Text'
    );
  });

  it('T024: AI output fields appear in downstream reference browsing under vars.<saveAs>', () => {
    const options = buildWorkflowReferenceFieldOptions(payloadSchema, {
      ...baseDataContext,
      steps: [
        {
          stepId: 'ai-step',
          stepName: 'Infer',
          saveAs: 'classificationResult',
          outputSchema: {
            type: 'object',
            properties: {
              category: { type: 'string' },
              next_action: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                },
              },
            },
          },
          fields: [],
        },
      ],
    });

    const values = options.map((option) => option.value);
    expect(values).toContain('vars.classificationResult');
    expect(values).toContain('vars.classificationResult.category');
    expect(values).toContain('vars.classificationResult.next_action.label');
  });

  it('T280: object and value transform outputs participate in downstream reference pickers like business outputs', () => {
    const options = buildWorkflowReferenceFieldOptions(payloadSchema, {
      ...baseDataContext,
      steps: [
        {
          stepId: 'coalesce-step',
          stepName: 'Coalesce Value',
          saveAs: 'fallbackValue',
          outputSchema: {
            type: 'object',
            properties: {
              value: { type: 'string' },
              matchedIndex: { type: 'number' },
            },
          },
          fields: [],
        },
        {
          stepId: 'build-object-step',
          stepName: 'Build Object',
          saveAs: 'ticketSummary',
          outputSchema: {
            type: 'object',
            properties: {
              object: {
                type: 'object',
                properties: {
                  ticketId: { type: 'string' },
                  priority: { type: 'string' },
                },
              },
            },
          },
          fields: [],
        },
      ],
    });

    const values = options.map((option) => option.value);

    expect(values).toContain('vars.fallbackValue');
    expect(values).toContain('vars.fallbackValue.value');
    expect(values).toContain('vars.ticketSummary');
    expect(values).toContain('vars.ticketSummary.object');
    expect(values).toContain('vars.ticketSummary.object.ticketId');
    expect(options.find((option) => option.value === 'vars.fallbackValue')?.label).toContain(
      'Coalesce Value'
    );
    expect(options.find((option) => option.value === 'vars.ticketSummary')?.label).toContain(
      'Build Object'
    );
  });

  it('T026: compose-text output fields use stable-key paths while surfacing author-facing labels in downstream reference browsing', () => {
    const options = buildWorkflowReferenceFieldOptions(payloadSchema, {
      ...baseDataContext,
      steps: [
        {
          stepId: 'compose-step',
          stepName: 'Compose Text',
          saveAs: 'composed',
          outputSchema: {
            type: 'object',
            properties: {
              prompt: { type: 'string', description: 'Prompt' },
              email_body: { type: 'string', description: 'Email Body' },
            },
          },
          fields: [],
        },
      ],
    });

    expect(options.find((option) => option.value === 'vars.composed.prompt')?.label).toContain('Prompt');
    expect(options.find((option) => option.value === 'vars.composed.email_body')?.label).toContain('Email Body');
  });
});
