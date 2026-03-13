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
  it('builds selectable payload, step-output, and metadata options for Reference mode', () => {
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

  it('only exposes error options when the current step is inside catch context', () => {
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

  it('adds loop item and index variables when the current step is inside a forEach block', () => {
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
});
