import { describe, expect, it } from 'vitest';
import { getSchemaRegistry, initializeWorkflowRuntimeV2 } from '../index';

const tenantId = 'tenant-contract';
const occurredAt = '2026-07-16T12:00:00.000Z';
const ticketId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const commentId = '33333333-3333-4333-8333-333333333333';
const invoiceId = '44444444-4444-4444-8444-444444444444';

function expectPayloadValid(payloadSchemaRef: string, payload: Record<string, unknown>) {
  const registry = getSchemaRegistry();
  expect(registry.has(payloadSchemaRef)).toBe(true);

  const result = registry.get(payloadSchemaRef).safeParse(payload);
  if (!result.success) {
    throw new Error(
      `${payloadSchemaRef} rejected emitter payload: ${JSON.stringify(result.error.issues)}`
    );
  }
}

describe('workflow event payload schemas: product emitter contracts', () => {
  it.each([
    {
      name: 'comment-actions response state change',
      payload: {
        // packages/tickets/src/actions/comment-actions/commentActions.ts:145
        tenantId,
        occurredAt,
        ticketId,
        userId,
        previousResponseState: 'awaiting_internal',
        newResponseState: 'awaiting_client',
        previousState: 'awaiting_internal',
        newState: 'awaiting_client',
        trigger: 'comment',
      },
    },
    {
      name: 'optimized comment response state change',
      payload: {
        // packages/tickets/src/actions/optimizedTicketActions.ts:377
        tenantId,
        occurredAt,
        ticketId,
        userId,
        previousResponseState: 'awaiting_internal',
        newResponseState: 'awaiting_client',
        previousState: 'awaiting_internal',
        newState: 'awaiting_client',
        trigger: 'comment',
      },
    },
    {
      name: 'optimized manual response state change',
      payload: {
        // packages/tickets/src/actions/optimizedTicketActions.ts:2968
        tenantId,
        occurredAt,
        ticketId,
        userId,
        previousResponseState: 'awaiting_client',
        newResponseState: 'awaiting_internal',
        previousState: 'awaiting_client',
        newState: 'awaiting_internal',
        trigger: 'manual',
      },
    },
    {
      name: 'ticketActions response state change helper',
      payload: {
        // packages/tickets/src/actions/ticketActions.ts:288
        tenantId,
        occurredAt,
        ticketId,
        userId,
        previousResponseState: 'awaiting_client',
        newResponseState: 'awaiting_internal',
        previousState: 'awaiting_client',
        newState: 'awaiting_internal',
        trigger: 'manual',
      },
    },
    {
      name: 'first transition (previous state null)',
      payload: {
        tenantId,
        occurredAt,
        ticketId,
        userId,
        previousResponseState: null,
        newResponseState: 'awaiting_client',
        previousState: null,
        newState: 'awaiting_client',
        trigger: 'comment',
      },
    },
    {
      name: 'close clears response state (new state null)',
      payload: {
        tenantId,
        occurredAt,
        ticketId,
        userId,
        previousResponseState: 'awaiting_client',
        newResponseState: null,
        previousState: 'awaiting_client',
        newState: null,
        trigger: 'status_change',
      },
    },
  ])('validates TICKET_RESPONSE_STATE_CHANGED from $name', ({ payload }) => {
    initializeWorkflowRuntimeV2();
    expectPayloadValid('payload.TicketResponseStateChanged.v1', payload);
  });

  it.each([
    {
      name: 'comment-actions comment added',
      payload: {
        // packages/tickets/src/actions/comment-actions/commentActions.ts:313
        tenantId,
        occurredAt,
        ticketId,
        commentId,
        userId,
        thread_id: null,
        parent_comment_id: null,
        is_reply: false,
        comment: {
          id: commentId,
          content: 'Hello',
          author: 'Test User',
          isInternal: false,
          authorType: 'internal',
          thread_id: null,
          parent_comment_id: null,
          is_reply: false,
        },
      },
    },
    {
      name: 'optimized comment added',
      payload: {
        // packages/tickets/src/actions/optimizedTicketActions.ts:3283
        tenantId,
        occurredAt,
        ticketId,
        commentId,
        userId,
        comment: {
          id: commentId,
          content: 'Hello',
          author: 'Test User',
          isInternal: false,
          authorType: 'internal',
        },
      },
    },
    {
      name: 'ticketActions comment added',
      payload: {
        // packages/tickets/src/actions/ticketActions.ts:1561
        tenantId,
        occurredAt,
        ticketId,
        commentId,
        userId,
        comment: {
          id: commentId,
          content: 'Hello',
          author: 'Test User',
          isInternal: false,
        },
      },
    },
    {
      name: 'client-portal comment added',
      payload: {
        // packages/client-portal/src/actions/client-portal-actions/client-tickets.ts:620
        tenantId,
        occurredAt,
        ticketId,
        commentId,
        userId,
        comment: {
          id: commentId,
          content: 'Hello',
          author: 'Test User',
          isInternal: false,
        },
      },
    },
  ])('validates TICKET_COMMENT_ADDED from $name', ({ payload }) => {
    initializeWorkflowRuntimeV2();
    expectPayloadValid('payload.TicketCommentAdded.v1', payload);
  });

  it('validates client-portal non-closing TICKET_UPDATED', () => {
    initializeWorkflowRuntimeV2();
    expectPayloadValid('payload.TicketUpdated.v1', {
      // packages/client-portal/src/actions/client-portal-actions/client-tickets.ts:903
      tenantId,
      occurredAt,
      ticketId,
      userId,
      changes: {
        status_id: {
          old: 'status-open',
          previous: 'status-open',
          new: 'status-pending',
        },
      },
    });
  });

  it('validates INVOICE_FINALIZED', () => {
    initializeWorkflowRuntimeV2();
    // Mirror the emitter: it computes a numeric total and stringifies it
    // (server/src/lib/api/services/InvoiceService.ts finalizeInvoice).
    const numericTotalAmount = 100.5 + 24.5;
    expectPayloadValid('payload.InvoiceFinalized.v1', {
      tenantId,
      occurredAt,
      invoiceId,
      totalAmount: String(numericTotalAmount),
      userId,
      timestamp: occurredAt,
    });
  });

  it.each([
    {
      name: 'TicketModelEventPublisher TICKET_CREATED',
      payloadSchemaRef: 'payload.TicketCreated.v1',
      payload: {
        // packages/tickets/src/lib/adapters/TicketModelEventPublisher.ts:80
        tenantId,
        occurredAt,
        actorType: 'USER',
        actorUserId: userId,
        ticketId,
        userId,
      },
    },
    {
      name: 'TicketModelEventPublisher TICKET_CLOSED',
      payloadSchemaRef: 'payload.TicketClosed.v1',
      payload: {
        // packages/tickets/src/lib/adapters/TicketModelEventPublisher.ts:80
        tenantId,
        occurredAt,
        actorType: 'USER',
        actorUserId: userId,
        ticketId,
        userId,
      },
    },
  ])('validates publishWorkflowEvent happy path for $name', ({ payloadSchemaRef, payload }) => {
    initializeWorkflowRuntimeV2();
    expectPayloadValid(payloadSchemaRef, payload);
  });
});
