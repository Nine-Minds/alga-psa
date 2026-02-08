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
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}));

vi.mock('@alga-psa/db', () => ({
  getConnection: (...args: any[]) => getConnectionMock(...args),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
  createTenantKnex: vi.fn(),
}));

vi.mock('@alga-psa/documents/lib/blocknoteUtils', () => ({
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
        const trx = (table: string) => {
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

          if (table === 'comments') {
            return {
              insert: commentsInsertMock,
            };
          }

          throw new Error(`Unexpected table: ${table}`);
        };

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
});
