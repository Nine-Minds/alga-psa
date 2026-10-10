import { describe, it } from 'vitest';
import type { WorkflowCatalogEventType } from '@alga-psa/event-schemas';
import { buildTicketCommentAddedPayload } from '@alga-psa/shared/lib/tickets/ticketWorkflowEventPayloads';
import { assertEmitterCase, type EmitterCase } from './harness';
import { IDS, NOW, ticket } from './fixtures';

/**
 * Events that product code publishes and the worker has a payload schema for, but that are not in
 * the DB-backed workflow catalog (so they have no entry in the catalog-keyed registry).
 * TICKET_COMMENT_ADDED is the one today. Same rule as the registry: real builder, real schema.
 */
const COMMENT_ADDED_REF = 'payload.TicketCommentAdded.v1';

const comment = { content: 'Hello', author: 'Test User', isInternal: false };
const base = { tenantId: 'tenant-contract', occurredAt: NOW, ticketId: ticket.ticket_id!, commentId: IDS.comment, userId: IDS.user };

const commentAddedCases: EmitterCase[] = [
  {
    site: 'packages/tickets/src/actions/comment-actions/commentActions.ts#createComment',
    build: () =>
      buildTicketCommentAddedPayload({
        ...base,
        thread_id: null,
        parent_comment_id: null,
        is_reply: false,
        comment: { ...comment, authorType: 'internal', thread_id: null, parent_comment_id: null, is_reply: false },
      }),
  },
  {
    site: 'packages/tickets/src/actions/optimizedTicketActions.ts#addTicketCommentWithCache',
    build: () => buildTicketCommentAddedPayload({ ...base, comment: { ...comment, authorType: 'internal' }, suppressContactNotifications: false }),
  },
  {
    site: 'packages/tickets/src/actions/ticketActions.ts#addTicketComment',
    build: () => buildTicketCommentAddedPayload({ ...base, comment }),
  },
  {
    site: 'packages/client-portal/src/actions/client-portal-actions/client-tickets.ts#addClientTicketComment',
    build: () => buildTicketCommentAddedPayload({ ...base, comment }),
  },
].map((c) => ({ ...c, expectFields: ['commentId'] }));

describe('schema-only events (not in the workflow catalog)', () => {
  describe('TICKET_COMMENT_ADDED', () => {
    for (const emitterCase of commentAddedCases) {
      it(`${emitterCase.site} passes ${COMMENT_ADDED_REF}`, () => {
        assertEmitterCase('TICKET_COMMENT_ADDED' as WorkflowCatalogEventType, emitterCase, { schemaRef: COMMENT_ADDED_REF });
      });
    }
  });
});
