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
});
