import { beforeEach, describe, expect, it, vi } from 'vitest';

const withAdminTransactionMock = vi.fn();
const parseEmailReplyBodyMock = vi.fn();
const findTicketByReplyTokenMock = vi.fn();
const findTicketByEmailThreadMock = vi.fn();
const resolveInboundTicketDefaultsMock = vi.fn();
const findContactByEmailMock = vi.fn();
const createTicketFromEmailMock = vi.fn();
const createCommentFromEmailMock = vi.fn();
const processEmailAttachmentMock = vi.fn();

function makeQueryBuilder(firstResult: unknown) {
  const builder: any = {
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhereRaw: vi.fn().mockReturnThis(),
    andWhere: vi.fn((arg: unknown) => {
      if (typeof arg === 'function') {
        const scopedWhere: any = {
          whereRaw: vi.fn().mockReturnThis(),
          orWhereRaw: vi.fn().mockReturnThis(),
        };
        arg.call(scopedWhere);
      }
      return builder;
    }),
    first: vi.fn().mockResolvedValue(firstResult),
  };

  return builder;
}

function buildEmailData(overrides: Partial<any> = {}) {
  return {
    id: 'email-1',
    provider: 'google',
    providerId: 'provider-1',
    tenant: 'tenant-1',
    receivedAt: '2026-02-11T00:00:00.000Z',
    from: { email: 'sender@example.com', name: 'Sender' },
    to: [{ email: 'support@example.com', name: 'Support' }],
    subject: 'Inbound subject',
    body: { text: 'Hello from client', html: undefined },
    attachments: [],
    ...overrides,
  };
}

vi.mock('@alga-psa/db', () => ({
  withAdminTransaction: (callback: (trx: any) => Promise<any>) =>
    withAdminTransactionMock(callback),
}));

vi.mock('../../../workflow/actions/emailWorkflowActions', () => ({
  parseEmailReplyBody: (...args: any[]) => parseEmailReplyBodyMock(...args),
  findTicketByReplyToken: (...args: any[]) => findTicketByReplyTokenMock(...args),
  findTicketByEmailThread: (...args: any[]) => findTicketByEmailThreadMock(...args),
  resolveInboundTicketDefaults: (...args: any[]) => resolveInboundTicketDefaultsMock(...args),
  findContactByEmail: (...args: any[]) => findContactByEmailMock(...args),
  createTicketFromEmail: (...args: any[]) => createTicketFromEmailMock(...args),
  createCommentFromEmail: (...args: any[]) => createCommentFromEmailMock(...args),
  processEmailAttachment: (...args: any[]) => processEmailAttachmentMock(...args),
}));

describe('processInboundEmailInApp additional authorship paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    withAdminTransactionMock.mockImplementation(async (callback: (trx: any) => Promise<any>) => {
      const trx = vi.fn((table: string) => {
        if (table === 'tickets as t' || table === 'comments as c') {
          return makeQueryBuilder(undefined);
        }
        throw new Error(`Unexpected table in unit test: ${table}`);
      });

      return callback(trx);
    });

    parseEmailReplyBodyMock.mockResolvedValue({
      sanitizedText: 'Sanitized inbound body',
      sanitizedHtml: undefined,
      confidence: 0.95,
      strategy: 'plain',
      appliedHeuristics: [],
      warnings: [],
      tokens: {},
    });
    findTicketByReplyTokenMock.mockResolvedValue(null);
    findTicketByEmailThreadMock.mockResolvedValue(null);
    resolveInboundTicketDefaultsMock.mockResolvedValue({
      client_id: 'default-client-id',
      board_id: 'board-id',
      status_id: 'status-id',
      priority_id: 'priority-id',
      category_id: undefined,
      subcategory_id: undefined,
      location_id: undefined,
      entered_by: 'entered-by-user',
    });
    createTicketFromEmailMock.mockResolvedValue({
      ticket_id: 'ticket-1',
      ticket_number: 'T-1',
    });
    createCommentFromEmailMock.mockResolvedValue('comment-1');
    processEmailAttachmentMock.mockResolvedValue({
      success: true,
    });
  });

  it('T015: unmatched new-ticket sender keeps fallback path without contact_id', async () => {
    findContactByEmailMock.mockResolvedValue(null);

    const { processInboundEmailInApp } = await import('../processInboundEmailInApp');

    const result = await processInboundEmailInApp({
      tenantId: 'tenant-1',
      providerId: 'provider-1',
      emailData: buildEmailData(),
    });

    expect(result.outcome).toBe('created');
    expect(findContactByEmailMock).toHaveBeenCalledWith('sender@example.com', 'tenant-1', {
      defaultClientId: 'default-client-id',
    });
    expect(createTicketFromEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        contact_id: undefined,
      }),
      'tenant-1'
    );
    expect(createCommentFromEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        author_type: 'system',
        author_id: undefined,
        contact_id: undefined,
        metadata: expect.objectContaining({
          unmatchedSender: true,
        }),
      }),
      'tenant-1'
    );
  });

  it('T017: reply-token path forwards both author_id and contact_id when contact has user', async () => {
    findContactByEmailMock.mockResolvedValue({
      contact_id: 'contact-reply-1',
      client_id: 'client-1',
      user_id: 'client-user-1',
      email: 'sender@example.com',
      name: 'Sender',
      client_name: 'Client',
    });
    parseEmailReplyBodyMock.mockResolvedValue({
      sanitizedText: 'Reply body',
      sanitizedHtml: undefined,
      confidence: 0.95,
      strategy: 'plain',
      appliedHeuristics: [],
      warnings: [],
      tokens: { conversationToken: 'reply-token-1' },
    });
    findTicketByReplyTokenMock.mockResolvedValue({ ticketId: 'ticket-reply-1' });

    const { processInboundEmailInApp } = await import('../processInboundEmailInApp');

    const result = await processInboundEmailInApp({
      tenantId: 'tenant-1',
      providerId: 'provider-1',
      emailData: buildEmailData({ id: 'email-reply-1' }),
    });

    expect(result).toMatchObject({
      outcome: 'replied',
      matchedBy: 'reply_token',
      ticketId: 'ticket-reply-1',
    });
    expect(findContactByEmailMock).toHaveBeenCalledWith('sender@example.com', 'tenant-1', {
      ticketId: 'ticket-reply-1',
    });
    expect(createCommentFromEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket_id: 'ticket-reply-1',
        author_type: 'contact',
        author_id: 'client-user-1',
        contact_id: 'contact-reply-1',
      }),
      'tenant-1'
    );
  });

  it('T019: thread-header path without sender contact keeps fallback behavior', async () => {
    findContactByEmailMock.mockResolvedValue(null);
    findTicketByReplyTokenMock.mockResolvedValue(null);
    findTicketByEmailThreadMock.mockResolvedValue({ ticketId: 'ticket-thread-1' });

    const { processInboundEmailInApp } = await import('../processInboundEmailInApp');

    const result = await processInboundEmailInApp({
      tenantId: 'tenant-1',
      providerId: 'provider-1',
      emailData: buildEmailData({
        id: 'email-thread-1',
        threadId: 'thread-1',
        inReplyTo: 'message-parent',
        references: ['message-parent'],
      }),
    });

    expect(result).toMatchObject({
      outcome: 'replied',
      matchedBy: 'thread_headers',
      ticketId: 'ticket-thread-1',
    });
    expect(findContactByEmailMock).toHaveBeenCalledWith('sender@example.com', 'tenant-1', {
      ticketId: 'ticket-thread-1',
    });
    expect(createCommentFromEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket_id: 'ticket-thread-1',
        author_type: 'contact',
        author_id: undefined,
        contact_id: undefined,
      }),
      'tenant-1'
    );
  });
});
