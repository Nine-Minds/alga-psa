import { describe, expect, it } from 'vitest';
import {
  createTicketCommentSchema,
  ticketCommentResponseSchema,
} from '../../../lib/api/schemas/ticket';

const COMMENT_ID = '11111111-1111-1111-1111-111111111111';
const TICKET_ID = '22222222-2222-2222-2222-222222222222';
const TENANT_ID = '33333333-3333-3333-3333-333333333333';
const THREAD_ID = '44444444-4444-4444-4444-444444444444';
const PARENT_ID = '55555555-5555-5555-5555-555555555555';

function baseResponsePayload() {
  return {
    comment_id: COMMENT_ID,
    ticket_id: TICKET_ID,
    comment_text: 'Reply body',
    is_internal: false,
    time_spent: null,
    created_by: null,
    created_at: '2026-05-18T12:00:00.000Z',
    updated_at: null,
    tenant: TENANT_ID,
  };
}

describe('ticketCommentResponseSchema threading fields', () => {
  it('T002: accepts and preserves thread_id, parent_comment_id, deleted_at', () => {
    const parsed = ticketCommentResponseSchema.parse({
      ...baseResponsePayload(),
      thread_id: THREAD_ID,
      parent_comment_id: PARENT_ID,
      deleted_at: '2026-05-18T13:00:00.000Z',
    });

    expect(parsed.thread_id).toBe(THREAD_ID);
    expect(parsed.parent_comment_id).toBe(PARENT_ID);
    expect(parsed.deleted_at).toBe('2026-05-18T13:00:00.000Z');
  });

  it('T002: accepts and preserves null threading fields', () => {
    const parsed = ticketCommentResponseSchema.parse({
      ...baseResponsePayload(),
      thread_id: THREAD_ID,
      parent_comment_id: null,
      deleted_at: null,
    });

    expect(parsed.thread_id).toBe(THREAD_ID);
    expect(parsed.parent_comment_id).toBeNull();
    expect(parsed.deleted_at).toBeNull();
  });

  it('T003: still accepts a payload with the three threading fields absent', () => {
    const parsed = ticketCommentResponseSchema.parse(baseResponsePayload());

    expect(parsed.thread_id).toBeUndefined();
    expect(parsed.parent_comment_id).toBeUndefined();
    expect(parsed.deleted_at).toBeUndefined();
    expect(parsed.comment_id).toBe(COMMENT_ID);
  });

  it('T002: rejects a non-uuid thread_id', () => {
    expect(() =>
      ticketCommentResponseSchema.parse({
        ...baseResponsePayload(),
        thread_id: 'not-a-uuid',
      })
    ).toThrow();
  });
});

describe('createTicketCommentSchema parent_comment_id', () => {
  it('T004: accepts a create payload with a uuid parent_comment_id', () => {
    const parsed = createTicketCommentSchema.parse({
      comment_text: 'A threaded reply',
      parent_comment_id: PARENT_ID,
    });

    expect(parsed.parent_comment_id).toBe(PARENT_ID);
    // is_internal still defaults to false on the schema; the service ignores
    // it for replies and inherits the thread root's visibility.
    expect(parsed.is_internal).toBe(false);
  });

  it('T004: accepts a create payload with no parent_comment_id', () => {
    const parsed = createTicketCommentSchema.parse({
      comment_text: 'A top-level comment',
    });

    expect(parsed.parent_comment_id).toBeUndefined();
  });

  it('T004: rejects a non-uuid parent_comment_id', () => {
    expect(() =>
      createTicketCommentSchema.parse({
        comment_text: 'Bad reply',
        parent_comment_id: 'not-a-uuid',
      })
    ).toThrow();
  });
});
