// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

// alga-2026-0002798 D1: a client author can never create an internal comment,
// whatever the parent thread's visibility is.

const state = vi.hoisted(() => ({
  threadIsInternal: true,
  userType: 'client' as 'client' | 'internal',
  commentInserts: [] as Array<Record<string, any>>,
  threadInserts: [] as Array<Record<string, any>>,
  threadUpdates: [] as Array<Record<string, any>>,
}));

vi.mock('@alga-psa/db', () => ({
  withTransaction: async (conn: unknown, fn: (trx: unknown) => unknown) => fn(conn),
  tenantDb: () => ({
    table: (name: string) => {
      const builder: Record<string, any> = {
        select: () => builder,
        where: () => builder,
        join: () => builder,
        first: () => {
          if (name === 'users') return Promise.resolve({ user_type: state.userType });
          return Promise.resolve({
            comment_id: 'parent-1',
            ticket_id: 'ticket-1',
            thread_id: 'thread-internal',
            deleted_at: null,
            thread_is_internal: state.threadIsInternal,
          });
        },
        insert: (data: Record<string, any>) => {
          if (name === 'comment_threads') {
            state.threadInserts.push(data);
            return Promise.resolve([1]);
          }
          state.commentInserts.push(data);
          return { returning: () => Promise.resolve([{ comment_id: data.comment_id }]) };
        },
        update: (data: Record<string, any>) => {
          state.threadUpdates.push(data);
          return Promise.resolve(1);
        },
      };
      return builder;
    },
    tenantJoin: (query: unknown) => query,
  }),
}));

vi.mock('@shared/lib/ticketCommentAttachments', () => ({
  reconcileCommentAttachments: vi.fn(),
  withdrawCommentAttachments: vi.fn(),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import Comment from './comment';

const trx: any = {
  raw: vi.fn(async (sql: string) => ({
    rows: [sql.includes('thread_id') ? { comment_id: 'new-comment', thread_id: 'new-thread' } : { comment_id: 'new-comment' }],
  })),
};

function reply(overrides: Record<string, unknown>) {
  return Comment.insert(trx, 'tenant-1', {
    ticket_id: 'ticket-1',
    parent_comment_id: 'parent-1',
    note: 'reply',
    markdown_content: 'reply',
    author_type: 'client',
    user_id: 'user-1',
    ...overrides,
  } as any);
}

describe('Comment.insert visibility inheritance (D1)', () => {
  beforeEach(() => {
    state.threadIsInternal = true;
    state.userType = 'client';
    state.commentInserts.length = 0;
    state.threadInserts.length = 0;
    state.threadUpdates.length = 0;
  });

  it('client author replying to an internal-rooted parent stores a public top-level comment (explicit is_internal=false)', async () => {
    await reply({ is_internal: false });

    expect(state.commentInserts).toHaveLength(1);
    expect(state.commentInserts[0].is_internal).toBe(false);
    expect(state.commentInserts[0].parent_comment_id).toBeNull();
    expect(state.commentInserts[0].thread_id).toBe('new-thread');
    expect(state.threadInserts[0]).toMatchObject({ is_internal: false, thread_id: 'new-thread' });
    expect(state.threadUpdates).toHaveLength(0);
  });

  it('client author with no explicit visibility never inherits internal', async () => {
    await reply({});

    expect(state.commentInserts[0].is_internal).toBe(false);
    expect(state.commentInserts[0].parent_comment_id).toBeNull();
  });

  it('internal author still inherits the internal thread visibility', async () => {
    state.userType = 'internal';

    await reply({ author_type: 'internal' });

    expect(state.commentInserts[0].is_internal).toBe(true);
    expect(state.commentInserts[0].parent_comment_id).toBe('parent-1');
    expect(state.commentInserts[0].thread_id).toBe('thread-internal');
    expect(state.threadUpdates).toHaveLength(1);
  });

  it('internal author still cannot post a public reply into an internal thread', async () => {
    state.userType = 'internal';

    await expect(reply({ author_type: 'internal', is_internal: false })).rejects.toThrow(
      'Reply visibility must match the thread root visibility'
    );
  });
});
