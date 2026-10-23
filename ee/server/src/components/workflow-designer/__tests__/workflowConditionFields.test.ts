import { describe, expect, it } from 'vitest';

import { collectWorkflowConditionFields } from '../workflowConditionFields';
import type { DataContext, JsonSchema } from '../workflowDataContext';

const payloadSchema: JsonSchema = {
  type: 'object',
  properties: {
    ticketId: { type: 'string', 'x-workflow-picker-kind': 'ticket' } as JsonSchema,
    changes: { type: 'object', additionalProperties: true },
    tags: { type: 'array', items: { type: 'string' } },
  },
};

// Shape produced by zod-to-json-schema for `ticket: ticketSummarySchema.nullable()`.
const findTicketOutput: JsonSchema = {
  type: 'object',
  properties: {
    ticket: {
      anyOf: [
        {
          type: 'object',
          properties: {
            priority_id: {
              type: ['string', 'null'],
              description: 'Priority id',
              'x-workflow-picker-kind': 'ticket-priority',
              'x-workflow-picker-fixed-value-hint': 'Search priorities',
            } as JsonSchema,
            priority_name: { type: ['string', 'null'], description: 'Priority name' },
            is_closed: { type: ['boolean', 'null'] },
            response_state: { type: ['string', 'null'], enum: ['awaiting_client', 'awaiting_internal', null] },
          },
        },
        { type: 'null' },
      ],
    },
  },
};

const dataContext = {
  payload: [],
  payloadSchema,
  steps: [{ stepId: 's1', stepName: 'Find Ticket', saveAs: 'ticketDetails', outputSchema: findTicketOutput, fields: [] }],
  globals: { env: [], secrets: [], meta: [], error: [] },
} as unknown as DataContext;

describe('collectWorkflowConditionFields', () => {
  const fields = collectWorkflowConditionFields(payloadSchema, dataContext, { trigger: 'Trigger' });
  const byPath = new Map(fields.map((field) => [field.path, field]));

  it('lists trigger fields first, then earlier step outputs, skipping objects without properties and arrays', () => {
    expect(fields.map((field) => field.path)).toEqual([
      'payload.ticketId',
      'vars.ticketDetails.ticket.priority_id',
      'vars.ticketDetails.ticket.priority_name',
      'vars.ticketDetails.ticket.is_closed',
      'vars.ticketDetails.ticket.response_state',
    ]);
    expect(byPath.get('payload.ticketId')).toMatchObject({ sourceLabel: 'Trigger', fieldLabel: 'ticketId', pickerKind: 'ticket' });
  });

  it('carries entity picker metadata through nullable wrappers', () => {
    expect(byPath.get('vars.ticketDetails.ticket.priority_id')).toMatchObject({
      sourceLabel: 'Find Ticket',
      fieldLabel: 'ticket.priority_id',
      type: 'string',
      pickerKind: 'ticket-priority',
      pickerFixedValueHint: 'Search priorities',
      description: 'Priority id',
    });
    expect(byPath.get('vars.ticketDetails.ticket.priority_name')?.pickerKind).toBeUndefined();
  });

  it('keeps types and enum values for value editors', () => {
    expect(byPath.get('vars.ticketDetails.ticket.is_closed')?.type).toBe('boolean');
    expect(byPath.get('vars.ticketDetails.ticket.response_state')?.enumValues).toEqual(['awaiting_client', 'awaiting_internal']);
  });
});
