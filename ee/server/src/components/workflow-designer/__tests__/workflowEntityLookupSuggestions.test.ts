import { describe, expect, it } from 'vitest';
import type { Step } from '@alga-psa/workflows/runtime/client';

import { buildWorkflowEntityLookupSuggestions, buildWorkflowEventDetailTips } from '../workflowEntityLookupSuggestions';
import type { JsonSchema } from '../workflowDataContext';

const ticketCreatedPayload = {
  type: 'object',
  properties: {
    tenantId: { type: 'string' },
    ticketId: { type: 'string', 'x-workflow-picker-kind': 'ticket' },
    actorContactId: { type: 'string', 'x-workflow-picker-kind': 'contact' },
    createdByUserId: { type: 'string', 'x-workflow-picker-kind': 'user' },
  },
} as unknown as JsonSchema;

const findTicketStep = (expr: string): Step => ({
  id: 'find',
  type: 'action.call',
  config: { actionId: 'tickets.find', version: 1, inputMapping: { ticket_id: { $expr: expr } } },
} as unknown as Step);

describe('buildWorkflowEntityLookupSuggestions', () => {
  it('suggests the lookup action for payload ids of entities that have one, skipping actor metadata', () => {
    const suggestions = buildWorkflowEntityLookupSuggestions(ticketCreatedPayload, []);
    expect(suggestions).toEqual([
      {
        kind: 'ticket',
        payloadField: 'ticketId',
        lookup: { actionId: 'tickets.find', version: 1, idInputField: 'ticket_id', saveAs: 'ticketDetails' },
        carriedFields: ['createdByUserId'],
      },
    ]);
  });

  it('lists the details the payload already carries, leaving out event envelope fields', () => {
    const clientCreated = {
      type: 'object',
      properties: {
        tenantId: { type: 'string' },
        occurredAt: { type: 'string' },
        actorUserId: { type: 'string', 'x-workflow-picker-kind': 'user' },
        clientId: { type: 'string', 'x-workflow-picker-kind': 'client' },
        clientName: { type: 'string' },
        status: { type: 'string' },
      },
    } as unknown as JsonSchema;
    const [suggestion] = buildWorkflowEntityLookupSuggestions(clientCreated, []);
    expect(suggestion.payloadField).toBe('clientId');
    expect(suggestion.carriedFields).toEqual(['clientName', 'status']);
  });

  it('stops suggesting once a step looks the field up, including inside branches', () => {
    expect(buildWorkflowEntityLookupSuggestions(ticketCreatedPayload, [findTicketStep('payload.ticketId')])).toEqual([]);
    const nested = {
      id: 'if',
      type: 'control.if',
      condition: { $expr: '' },
      then: [findTicketStep('payload.ticketId')],
      else: [],
    } as unknown as Step;
    expect(buildWorkflowEntityLookupSuggestions(ticketCreatedPayload, [nested])).toEqual([]);
  });

  it('still suggests when the existing lookup reads a different field', () => {
    expect(buildWorkflowEntityLookupSuggestions(ticketCreatedPayload, [findTicketStep('payload.ticketIdOther')])).toHaveLength(1);
  });

  it('returns nothing without a payload schema', () => {
    expect(buildWorkflowEntityLookupSuggestions(null, [])).toEqual([]);
  });
});

describe('buildWorkflowEventDetailTips', () => {
  it('tells where a customer reply\'s text is, before and after Find Ticket is added', () => {
    const [before] = buildWorkflowEventDetailTips('TICKET_CUSTOMER_REPLIED', []);
    expect(before).toMatchObject({
      key: 'customerReplyText',
      detailPath: 'latest_customer_comment.note',
      availableAt: null,
    });
    expect(before.lookup.actionId).toBe('tickets.find');

    const withLookup = { ...findTicketStep('payload.ticketId'), config: { ...(findTicketStep('payload.ticketId') as { config: object }).config, saveAs: 'ticketDetails' } } as unknown as Step;
    const [after] = buildWorkflowEventDetailTips('TICKET_CUSTOMER_REPLIED', [withLookup]);
    expect(after.availableAt).toBe('vars.ticketDetails.latest_customer_comment.note');
  });

  it('has nothing to say for other events', () => {
    expect(buildWorkflowEventDetailTips('TICKET_CREATED', [])).toEqual([]);
    expect(buildWorkflowEventDetailTips(null, [])).toEqual([]);
  });
});

