import { describe, expect, it } from 'vitest';

import {
  buildWorkflowReferenceExpressionContext,
  buildWorkflowReferenceSourceTypeLookup,
} from '../workflowReferenceContext';
import type { WorkflowDataContext } from '../mapping/MappingPanel';

const dataContext: WorkflowDataContext = {
  payload: [
    {
      name: 'ticket',
      type: 'object',
      required: false,
      nullable: false,
      children: [
        {
          name: 'id',
          type: 'string',
          required: false,
          nullable: false,
        },
      ],
    },
  ],
  payloadSchema: {
    type: 'object',
    properties: {
      ticket: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
      },
    },
  },
  steps: [
    {
      stepId: 'step-1',
      stepName: 'Create Ticket',
      saveAs: 'ticketResult',
      outputSchema: {
        type: 'object',
        properties: {
          ticket_id: { type: 'string' },
        },
      },
      fields: [
        {
          name: 'ticket_id',
          type: 'string',
          required: false,
          nullable: false,
        },
      ],
    },
  ],
  globals: {
    env: [],
    secrets: [],
    meta: [
      {
        name: 'traceId',
        type: 'string',
        required: false,
        nullable: true,
      },
    ],
    error: [
      {
        name: 'message',
        type: 'string',
        required: false,
        nullable: true,
      },
    ],
  },
  forEach: {
    itemVar: 'ticketItem',
    indexVar: '$index',
    itemType: 'object',
  },
};

describe('workflow reference context', () => {
  it('T149: builds expression autocomplete context from payload, step outputs, metadata, catch state, and loop state', () => {
    const baseContext = buildWorkflowReferenceExpressionContext(dataContext);
    const catchContext = buildWorkflowReferenceExpressionContext({
      ...dataContext,
      inCatchBlock: true,
    });

    expect(baseContext.payloadSchema).toMatchObject({
      type: 'object',
      properties: {
        ticket: { type: 'object' },
      },
    });
    expect(baseContext.varsSchema).toMatchObject({
      type: 'object',
      properties: {
        ticketResult: { type: 'object' },
      },
    });
    expect(baseContext.metaSchema).toMatchObject({
      type: 'object',
      properties: {
        traceId: { type: 'string' },
      },
    });
    expect(baseContext.errorSchema).toBeUndefined();
    expect(baseContext.forEachItemVar).toBe('ticketItem');
    expect(baseContext.forEachIndexVar).toBe('$index');
    expect(catchContext.errorSchema).toMatchObject({
      type: 'object',
      properties: {
        message: { type: 'string' },
      },
    });
  });

  it('T150: builds type lookup entries from payload, step outputs, metadata, catch sources, and loop variables', () => {
    const baseLookup = buildWorkflowReferenceSourceTypeLookup(dataContext, 'payload');
    const catchLookup = buildWorkflowReferenceSourceTypeLookup(
      { ...dataContext, inCatchBlock: true },
      'payload'
    );

    expect(baseLookup.get('payload.ticket.id')).toBe('string');
    expect(baseLookup.get('vars.ticketResult')).toBe('object');
    expect(baseLookup.get('vars.ticketResult.ticket_id')).toBe('string');
    expect(baseLookup.get('meta.traceId')).toBe('string');
    expect(baseLookup.get('ticketItem')).toBe('object');
    expect(baseLookup.get('$index')).toBe('number');
    expect(baseLookup.has('error.message')).toBe(false);
    expect(catchLookup.get('error.message')).toBe('string');
  });
});
