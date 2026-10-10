import { describe, expect, it } from 'vitest';
import type { WorkflowCatalogEventType } from '@alga-psa/event-schemas';
import { runEmitterCase } from './harness';

/**
 * Proves the harness catches the drift classes it exists for. These payloads are deliberately
 * wrong hand-written literals: this file tests the harness, not a product emitter.
 */

const TICKET_ID = '11111111-1111-4111-8111-111111111111';
const COMMENT_ID = '33333333-3333-4333-8333-333333333333';

// What `convertToWorkflowEvent` did before it backstopped occurredAt.
const convertWithoutBackstop = (event: { payload: Record<string, unknown> }) => ({ payload: event.payload });

describe('harness self-test: drift replay', () => {
  it('alga0002101: {previousState,newState} with no occurredAt is rejected at occurredAt when the backstop is bypassed', () => {
    const result = runEmitterCase(
      'TICKET_RESPONSE_STATE_CHANGED' as WorkflowCatalogEventType,
      {
        site: 'selftest#alga0002101',
        build: () => ({ tenantId: 'tenant-contract', ticketId: TICKET_ID, previousState: null, newState: 'awaiting_client' }),
      },
      { publishPath: 'rawPublishEvent', convert: convertWithoutBackstop as never }
    );
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.path)).toContain('occurredAt');
  });

  it('the real backstop would have hidden alga0002101 (why the bypass seam exists)', () => {
    const result = runEmitterCase('TICKET_RESPONSE_STATE_CHANGED', {
      site: 'selftest#alga0002101-backstopped',
      build: () => ({ tenantId: 'tenant-contract', ticketId: TICKET_ID, previousState: null, newState: 'awaiting_client' }),
    }, { publishPath: 'rawPublishEvent' });
    expect(result.issues.map((i) => i.path)).not.toContain('occurredAt');
  });

  it('comment drift: a payload carrying comment.id instead of commentId is flagged at commentId via expectFields', () => {
    const result = runEmitterCase(
      'TICKET_RESPONSE_STATE_CHANGED' as WorkflowCatalogEventType,
      {
        site: 'selftest#comment-id',
        build: () => ({ ticketId: TICKET_ID, comment: { id: COMMENT_ID } }),
        expectFields: ['commentId'],
      },
      { schemaRef: 'payload.TicketCommentAdded.v1' }
    );
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.path)).toContain('commentId');
  });

  it('a correct commentId payload passes', () => {
    const result = runEmitterCase(
      'TICKET_RESPONSE_STATE_CHANGED' as WorkflowCatalogEventType,
      {
        site: 'selftest#comment-ok',
        build: () => ({ ticketId: TICKET_ID, commentId: COMMENT_ID }),
        expectFields: ['commentId'],
      },
      { schemaRef: 'payload.TicketCommentAdded.v1' }
    );
    expect(result.issues).toEqual([]);
  });

  it('reports an unregistered ref instead of throwing', () => {
    const result = runEmitterCase(
      'TICKET_RESPONSE_STATE_CHANGED' as WorkflowCatalogEventType,
      { site: 'selftest#unregistered', build: () => ({}) },
      { schemaRef: 'payload.DoesNotExist.v1' }
    );
    expect(result.issues[0]?.code).toBe('schema_not_registered');
  });
});
