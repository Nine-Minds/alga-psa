import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeTable, fakeTransaction, type FakeTenantDbOptions } from '@alga-psa/db/testing';

let currentUser: any;

const hasPermissionMock = vi.fn();
const getConnectionMock = vi.fn();
const withTransactionMock = vi.fn();

// Row the shared Comment model and publication intent read back after insert.
const storedComment = {
  comment_id: 'comment-1',
  ticket_id: 'ticket-1',
  thread_id: 'thread-1',
  user_id: 'user-1',
  note: '[]',
  is_internal: false,
  publish_state: 'published',
  created_at: '2026-09-05T00:00:00.000Z',
};

/**
 * The portal comment path: the requester's user and contact, the ticket they
 * may see, and the comment the shared model reads back after insert. The
 * thread the model creates is appended to the table so the audience check that
 * immediately follows finds it.
 */
function buildTrx(capture: {
  onCommentInsert?: (row: Record<string, any>) => void;
  onThreadInsert?: (row: Record<string, any>) => void;
  onCommentUpdate?: (patch: Record<string, any>) => void;
} = {}) {
  const commentThreads: Array<Record<string, any>> = [];

  const tables: FakeTenantDbOptions = {
    tables: {
      users: [{
        user_id: 'user-1',
        contact_id: 'contact-1',
        first_name: 'Client',
        last_name: 'User',
        user_type: 'client',
      }],
      contacts: [{ contact_name_id: 'contact-1', client_id: 'client-1', portal_visibility_group_id: null }],
      boards: [],
      tickets: [{ ticket_id: 'ticket-1', board_id: 'board-1', client_id: 'client-1' }],
      comments: [storedComment],
      comment_threads: commentThreads,
      // No attachment drafts are claimed in these scenarios.
      ticket_comment_attachments: [],
    },
    perTable: {
      comment_threads: {
        onInsert: (rows) => {
          commentThreads.push(...rows);
          capture.onThreadInsert?.(rows[0]);
          return rows;
        },
      },
      comments: {
        onInsert: (rows) => {
          capture.onCommentInsert?.(rows[0]);
          return rows.map((row) => ({ comment_id: 'comment-1', ...row }));
        },
        onUpdate: (patch) => {
          capture.onCommentUpdate?.(patch);
          return 1;
        },
      },
    },
  };

  return Object.assign(
    (table: string) => fakeTable(tables, currentUser.tenant, table.split(' ')[0]),
    fakeTransaction({
      raw: vi.fn().mockResolvedValue({ rows: [{ comment_id: 'comment-1', thread_id: 'thread-1' }] }),
    }),
  ) as any;
}

const convertBlockNoteToMarkdownMock = vi.fn();
const publishEventMock = vi.fn();
const maybeReopenBundleMasterFromChildReplyMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: currentUser.tenant }, ...args),
  withOptionalAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: currentUser.tenant }, ...args),
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}));

vi.mock('@alga-psa/db', () => ({
  getConnection: (...args: any[]) => getConnectionMock(...args),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
  registerAfterCommit: vi.fn(),
  createTenantKnex: vi.fn(),
  tenantDb: (conn: any, _tenant: string) => ({
    table: (table: string) => conn(table),
    unscoped: (table: string) => conn(table),
    tenantJoin: (query: any, _table?: string, _left?: string, _right?: string, options: any = {}) => {
      const join = options?.type === 'left' ? query.leftJoin : query.join;
      return typeof join === 'function' ? join.call(query) : query;
    },
  }),
}));

vi.mock('@alga-psa/documents/lib/blocknoteUtils', () => ({
  convertBlockNoteToMarkdown: (...args: any[]) =>
    convertBlockNoteToMarkdownMock(...args),
}));

vi.mock('@alga-psa/formatting/blocknoteUtils', () => ({
  convertBlockNoteToMarkdown: (...args: any[]) =>
    convertBlockNoteToMarkdownMock(...args),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: (...args: any[]) => publishEventMock(...args),
}));

vi.mock('@alga-psa/tickets/actions/ticketBundleUtils', () => ({
  maybeReopenBundleMasterFromChildReply: (...args: any[]) =>
    maybeReopenBundleMasterFromChildReplyMock(...args),
}));

vi.mock('@alga-psa/tickets/lib/liveUpdates', () => ({
  publishTicketUpdate: vi.fn().mockResolvedValue(undefined),
}));

describe('addClientTicketComment response source metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = {
      user_id: 'user-1',
      user_type: 'client',
      email: 'client@example.com',
      tenant: 'tenant-1',
    };
    getConnectionMock.mockResolvedValue({ db: true });
    hasPermissionMock.mockResolvedValue(true);
    convertBlockNoteToMarkdownMock.mockReturnValue('markdown-content');
    publishEventMock.mockResolvedValue(undefined);
    maybeReopenBundleMasterFromChildReplyMock.mockResolvedValue(undefined);
  });

  it('T001: stores metadata.responseSource=client_portal when inserting a client comment', async () => {
    const commentsInsertMock = vi.fn();

    const trx = buildTrx({ onCommentInsert: commentsInsertMock });
    withTransactionMock.mockImplementation(
      async (_db: any, callback: (trx: any) => Promise<any>) => callback(trx)
    );

    const { addClientTicketComment } = await import('./client-tickets');

    const result = await addClientTicketComment(
      'ticket-1',
      '[{"type":"paragraph","content":[{"type":"text","text":"Hello","styles":{}}]}]',
      false,
      false
    );

    const insertedComment = commentsInsertMock.mock.calls[0][0];
    const metadata =
      typeof insertedComment.metadata === 'string'
        ? JSON.parse(insertedComment.metadata)
        : insertedComment.metadata;

    expect(result).toBe(true);
    expect(metadata.responseSource).toBe('client_portal');
  });

  it('T019: forces is_internal=false on the comment and thread even when the caller passes true', async () => {
    const commentThreadsInsertMock = vi.fn();
    const commentsInsertMock = vi.fn();

    const trx = buildTrx({
      onCommentInsert: commentsInsertMock,
      onThreadInsert: commentThreadsInsertMock,
    });
    withTransactionMock.mockImplementation(
      async (_db: any, callback: (trx: any) => Promise<any>) => callback(trx)
    );

    const { addClientTicketComment } = await import('./client-tickets');

    const result = await addClientTicketComment(
      'ticket-1',
      '[{"type":"paragraph","content":[{"type":"text","text":"Hello","styles":{}}]}]',
      true,
      false
    );

    expect(result).toBe(true);
    expect(commentThreadsInsertMock.mock.calls[0][0].is_internal).toBe(false);
    expect(commentsInsertMock.mock.calls[0][0].is_internal).toBe(false);
  });

  it('T020: updateClientTicketComment only persists the note body, ignoring caller-supplied fields', async () => {
    const commentsUpdateMock = vi.fn();

    const trx = buildTrx({ onCommentUpdate: commentsUpdateMock });
    withTransactionMock.mockImplementation(
      async (_db: any, callback: (trx: any) => Promise<any>) => callback(trx)
    );

    const { updateClientTicketComment } = await import('./client-tickets');

    const result = await updateClientTicketComment('comment-1', {
      note: '[{"type":"paragraph","content":[{"type":"text","text":"Edited","styles":{}}]}]',
      ticket_id: 'ticket-evil',
      user_id: 'internal-user-1',
      author_type: 'internal',
      is_internal: true,
      is_resolution: true,
    } as any);

    expect(result).toBeUndefined();
    const persisted = commentsUpdateMock.mock.calls[0][0];
    expect(persisted.note).toContain('Edited');
    expect(persisted.markdown_content).toBe('markdown-content');
    expect(persisted.updated_at).toEqual(expect.any(String));
    expect(persisted).not.toHaveProperty('ticket_id');
    expect(persisted).not.toHaveProperty('user_id');
    expect(persisted).not.toHaveProperty('author_type');
    expect(persisted).not.toHaveProperty('is_internal');
    expect(persisted).not.toHaveProperty('is_resolution');
  });
});
