import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentUser: any;

const hasPermissionMock = vi.fn();
const getConnectionMock = vi.fn();
const withTransactionMock = vi.fn();
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
    const commentsInsertMock = vi.fn((payload: any) => ({
      returning: vi.fn().mockResolvedValue([
        {
          comment_id: 'comment-1',
          ...payload,
        },
      ]),
    }));

    withTransactionMock.mockImplementation(
      async (_db: any, callback: (trx: any) => Promise<any>) => {
        const trx = Object.assign(
          (table: string) => {
            if (table === 'users') {
              return {
                where: () => ({
                  first: async () => ({
                    contact_id: 'contact-1',
                    first_name: 'Client',
                    last_name: 'User',
                  }),
                }),
              };
            }

            if (table === 'contacts') {
              return {
                where: () => ({
                  first: async () => ({
                    contact_name_id: 'contact-1',
                    client_id: 'client-1',
                    portal_visibility_group_id: null,
                  }),
                }),
              };
            }

            if (table === 'tickets as t') {
              const builder: any = {
                select: vi.fn(() => builder),
                where: vi.fn(() => builder),
                modify: vi.fn((cb: (query: any) => void) => {
                  cb(builder);
                  return builder;
                }),
                first: vi.fn().mockResolvedValue({
                  ticket_id: 'ticket-1',
                  board_id: 'board-1',
                  client_id: 'client-1',
                }),
              };
              return builder;
            }

            if (table === 'comment_threads') {
              return {
                insert: vi.fn().mockResolvedValue(undefined),
              };
            }

            if (table === 'comments') {
              return {
                insert: commentsInsertMock,
              };
            }

            if (table === 'tickets') {
              return {
                where: vi.fn().mockReturnValue({
                  update: vi.fn().mockResolvedValue(1),
                }),
              };
            }

            throw new Error(`Unexpected table: ${table}`);
          },
          {
            raw: vi.fn().mockResolvedValue({
              rows: [{ comment_id: 'comment-1', thread_id: 'thread-1' }],
            }),
          }
        );

        return callback(trx);
      }
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
    const commentThreadsInsertMock = vi.fn().mockResolvedValue(undefined);
    const commentsInsertMock = vi.fn((payload: any) => ({
      returning: vi.fn().mockResolvedValue([
        {
          comment_id: 'comment-1',
          ...payload,
        },
      ]),
    }));

    withTransactionMock.mockImplementation(
      async (_db: any, callback: (trx: any) => Promise<any>) => {
        const trx = Object.assign(
          (table: string) => {
            if (table === 'users') {
              return {
                where: () => ({
                  first: async () => ({
                    contact_id: 'contact-1',
                    first_name: 'Client',
                    last_name: 'User',
                  }),
                }),
              };
            }

            if (table === 'contacts') {
              return {
                where: () => ({
                  first: async () => ({
                    contact_name_id: 'contact-1',
                    client_id: 'client-1',
                    portal_visibility_group_id: null,
                  }),
                }),
              };
            }

            if (table === 'tickets as t') {
              const builder: any = {
                select: vi.fn(() => builder),
                where: vi.fn(() => builder),
                modify: vi.fn((cb: (query: any) => void) => {
                  cb(builder);
                  return builder;
                }),
                first: vi.fn().mockResolvedValue({
                  ticket_id: 'ticket-1',
                  board_id: 'board-1',
                  client_id: 'client-1',
                }),
              };
              return builder;
            }

            if (table === 'comment_threads') {
              return {
                insert: commentThreadsInsertMock,
              };
            }

            if (table === 'comments') {
              return {
                insert: commentsInsertMock,
              };
            }

            if (table === 'tickets') {
              return {
                where: vi.fn().mockReturnValue({
                  update: vi.fn().mockResolvedValue(1),
                }),
              };
            }

            throw new Error(`Unexpected table: ${table}`);
          },
          {
            raw: vi.fn().mockResolvedValue({
              rows: [{ comment_id: 'comment-1', thread_id: 'thread-1' }],
            }),
          }
        );

        return callback(trx);
      }
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
    const commentsUpdateMock = vi.fn().mockResolvedValue(1);

    withTransactionMock.mockImplementation(
      async (_db: any, callback: (trx: any) => Promise<any>) => {
        const trx = Object.assign(
          (table: string) => {
            if (table === 'users') {
              return {
                where: () => ({
                  first: async () => ({
                    contact_id: 'contact-1',
                    first_name: 'Client',
                    last_name: 'User',
                  }),
                }),
              };
            }

            if (table === 'contacts') {
              return {
                where: () => ({
                  first: async () => ({
                    contact_name_id: 'contact-1',
                    client_id: 'client-1',
                    portal_visibility_group_id: null,
                  }),
                }),
              };
            }

            if (table === 'tickets as t') {
              const builder: any = {
                select: vi.fn(() => builder),
                where: vi.fn(() => builder),
                modify: vi.fn((cb: (query: any) => void) => {
                  cb(builder);
                  return builder;
                }),
                first: vi.fn().mockResolvedValue({
                  ticket_id: 'ticket-1',
                  board_id: 'board-1',
                  client_id: 'client-1',
                }),
              };
              return builder;
            }

            if (table === 'comments') {
              return {
                where: vi.fn((criteria: any) => {
                  if (criteria && 'user_id' in criteria) {
                    // Ownership lookup: comment_id + user_id
                    return {
                      first: vi.fn().mockResolvedValue({
                        comment_id: 'comment-1',
                        ticket_id: 'ticket-1',
                        user_id: 'user-1',
                      }),
                    };
                  }
                  return {
                    update: commentsUpdateMock,
                  };
                }),
              };
            }

            throw new Error(`Unexpected table: ${table}`);
          },
          {
            raw: vi.fn().mockResolvedValue({ rows: [] }),
          }
        );

        return callback(trx);
      }
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
