// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { coManagedLifecycleMock } from '@alga-psa/db/testing';

const state = vi.hoisted(() => ({
  updatePayloads: [] as Array<Record<string, unknown>>,
  existingComment: null as Record<string, unknown> | null,
}));

vi.mock('@alga-psa/db', () => ({
  withTransaction: async (_conn: unknown, fn: (trx: unknown) => unknown) => fn(_conn),
  tenantDb: () => ({
    table: () => {
      const builder: Record<string, unknown> = {
        select: () => builder,
        where: () => builder,
        forUpdate: () => builder,
        forShare: () => builder,
        first: () => Promise.resolve(state.existingComment),
        update: (data: Record<string, unknown>) => {
          state.updatePayloads.push(data);
          return Promise.resolve(1);
        },
      };
      return builder;
    },
  }),
}));

// The shared write path is wrapped in co-managed lifecycle admission, which
// needs an open transaction and the licensing surface. This suite is about the
// view-only field, so the lifecycle is the independent (writable) no-op.
vi.mock('@alga-psa/licensing', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...coManagedLifecycleMock(),
}));

vi.mock('@shared/lib/ticketCommentAttachments', () => ({
  reconcileCommentAttachments: vi.fn(),
  withdrawCommentAttachments: vi.fn(),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import Comment from './comment';

describe('Comment.update view-only fields', () => {
  beforeEach(() => {
    state.updatePayloads.length = 0;
    state.existingComment = {
      comment_id: 'comment-1',
      user_id: null,
      author_type: 'unknown',
      is_system_generated: false,
    };
  });

  it('never persists bundle_mirror_source even when it is smuggled into the payload', async () => {
    await Comment.update(
      { isTransaction: true } as never,
      'tenant-1',
      'comment-1',
      {
        note: 'edited',
        bundle_mirror_source: { source_comment_id: 'source-1', master_ticket_id: 'master-9' },
      },
      'actor-1'
    );

    expect(state.updatePayloads).toHaveLength(1);
    expect(state.updatePayloads[0]).not.toHaveProperty('bundle_mirror_source');
    expect(state.updatePayloads[0].note).toBe('edited');
  });
});
