import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailMessageDetails } from '../../../interfaces/inbound-email.interfaces';

const withAdminTransactionMock = vi.fn();
const parseEmailReplyBodyMock = vi.fn();
const findTicketByReplyTokenMock = vi.fn();
const findTicketByEmailThreadMock = vi.fn();
const resolveInboundTicketDefaultsMock = vi.fn();
const findContactByEmailMock = vi.fn();
const findClientIdByInboundEmailDomainMock = vi.fn();
const findValidClientPrimaryContactIdMock = vi.fn();
const createTicketFromEmailMock = vi.fn();
const createCommentFromEmailMock = vi.fn();
const processEmailAttachmentMock = vi.fn();

function buildEmailData(
  overrides: Partial<EmailMessageDetails> = {}
): EmailMessageDetails {
  return {
    id: 'email-1',
    provider: 'google',
    providerId: 'provider-1',
    tenant: 'tenant-1',
    receivedAt: '2026-02-11T00:00:00.000Z',
    from: { email: '"Client User" <CLIENT@EXAMPLE.COM>', name: 'Client User' },
    to: [{ email: 'support@example.com', name: 'Support' }],
    subject: 'Inbound subject',
    body: { text: 'Hello from client', html: undefined },
    attachments: [],
    ...overrides,
  };
}

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
  findClientIdByInboundEmailDomain: (...args: any[]) => findClientIdByInboundEmailDomainMock(...args),
  findValidClientPrimaryContactId: (...args: any[]) => findValidClientPrimaryContactIdMock(...args),
  createTicketFromEmail: (...args: any[]) => createTicketFromEmailMock(...args),
  createCommentFromEmail: (...args: any[]) => createCommentFromEmailMock(...args),
  processEmailAttachment: (...args: any[]) => processEmailAttachmentMock(...args),
}));

describe('processInboundEmailInApp', () => {
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
    findClientIdByInboundEmailDomainMock.mockResolvedValue(null);
    findValidClientPrimaryContactIdMock.mockResolvedValue(null);
    createTicketFromEmailMock.mockResolvedValue({
      ticket_id: 'ticket-1',
      ticket_number: 'T-1',
    });
    createCommentFromEmailMock.mockResolvedValue('comment-1');
    processEmailAttachmentMock.mockResolvedValue({
      success: true,
    });
  });

  it('new inbound email with matched contact+user forwards both author_id and contact_id', async () => {
    findContactByEmailMock.mockResolvedValue({
      contact_id: 'contact-123',
      client_id: 'client-123',
      user_id: 'client-user-123',
      email: 'client@example.com',
      name: 'Client User',
      client_name: 'Client Co',
    });

    const { processInboundEmailInApp } = await import('../processInboundEmailInApp');

    const result = await processInboundEmailInApp({
      tenantId: 'tenant-1',
      providerId: 'provider-1',
      emailData: {
        id: 'email-1',
        provider: 'google',
        providerId: 'provider-1',
        tenant: 'tenant-1',
        receivedAt: '2026-02-11T00:00:00.000Z',
        from: { email: '"Client User" <CLIENT@EXAMPLE.COM>', name: 'Client User' },
        to: [{ email: 'support@example.com', name: 'Support' }],
        subject: 'Inbound subject',
        body: { text: 'Hello from client', html: undefined },
        attachments: [],
      } as any,
    });

    expect(result).toMatchObject({
      outcome: 'created',
      ticketId: 'ticket-1',
      commentId: 'comment-1',
    });

    expect(findContactByEmailMock).toHaveBeenCalledWith('client@example.com', 'tenant-1', {
      defaultClientId: 'default-client-id',
    });

    expect(createTicketFromEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: 'client-123',
        contact_id: 'contact-123',
        source: 'email',
      }),
      'tenant-1'
    );

    expect(createCommentFromEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket_id: 'ticket-1',
        source: 'email',
        author_type: 'contact',
        author_id: 'client-user-123',
        contact_id: 'contact-123',
        metadata: expect.objectContaining({
          unmatchedSender: false,
        }),
      }),
      'tenant-1'
    );
  });

  it('new inbound email with matched contact-only sender forwards contact_id and omits author_id', async () => {
    findContactByEmailMock.mockResolvedValue({
      contact_id: 'contact-only-123',
      client_id: 'client-123',
      user_id: undefined,
      email: 'client@example.com',
      name: 'Client Contact',
      client_name: 'Client Co',
    });

    const { processInboundEmailInApp } = await import('../processInboundEmailInApp');

    const result = await processInboundEmailInApp({
      tenantId: 'tenant-1',
      providerId: 'provider-1',
      emailData: buildEmailData(),
    });

    expect(result.outcome).toBe('created');
    expect(createTicketFromEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: 'client-123',
        contact_id: 'contact-only-123',
      }),
      'tenant-1'
    );
    expect(createCommentFromEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket_id: 'ticket-1',
        author_type: 'contact',
        author_id: undefined,
        contact_id: 'contact-only-123',
      }),
      'tenant-1'
    );
  });

  it('reply-token path resolves sender contact and forwards contact_id for contact-only sender', async () => {
    findContactByEmailMock.mockResolvedValue({
      contact_id: 'contact-only-reply',
      client_id: 'client-123',
      user_id: undefined,
      email: 'client@example.com',
      name: 'Client Contact',
      client_name: 'Client Co',
    });
    parseEmailReplyBodyMock.mockResolvedValue({
      sanitizedText: 'Reply body',
      sanitizedHtml: undefined,
      confidence: 0.95,
      strategy: 'plain',
      appliedHeuristics: [],
      warnings: [],
      tokens: { conversationToken: 'reply-token-123' },
    });
    findTicketByReplyTokenMock.mockResolvedValue({
      ticketId: 'ticket-reply-123',
    });

    const { processInboundEmailInApp } = await import('../processInboundEmailInApp');

    const result = await processInboundEmailInApp({
      tenantId: 'tenant-1',
      providerId: 'provider-1',
      emailData: buildEmailData({ id: 'email-reply-1' }),
    });

    expect(result).toMatchObject({
      outcome: 'replied',
      matchedBy: 'reply_token',
      ticketId: 'ticket-reply-123',
      commentId: 'comment-1',
    });
    expect(createTicketFromEmailMock).not.toHaveBeenCalled();
    expect(findContactByEmailMock).toHaveBeenCalledWith('client@example.com', 'tenant-1', {
      ticketId: 'ticket-reply-123',
    });
    expect(createCommentFromEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket_id: 'ticket-reply-123',
        author_type: 'contact',
        author_id: undefined,
        contact_id: 'contact-only-reply',
        inboundReplyEvent: expect.objectContaining({
          matchedBy: 'reply_token',
        }),
      }),
      'tenant-1'
    );
  });

  it('thread-header path resolves sender contact and forwards contact_id for contact-only sender', async () => {
    findContactByEmailMock.mockResolvedValue({
      contact_id: 'contact-only-thread',
      client_id: 'client-123',
      user_id: undefined,
      email: 'client@example.com',
      name: 'Client Contact',
      client_name: 'Client Co',
    });
    parseEmailReplyBodyMock.mockResolvedValue({
      sanitizedText: 'Reply body',
      sanitizedHtml: undefined,
      confidence: 0.95,
      strategy: 'plain',
      appliedHeuristics: [],
      warnings: [],
      tokens: {},
    });
    findTicketByReplyTokenMock.mockResolvedValue(null);
    findTicketByEmailThreadMock.mockResolvedValue({
      ticketId: 'ticket-thread-123',
    });

    const { processInboundEmailInApp } = await import('../processInboundEmailInApp');

    const result = await processInboundEmailInApp({
      tenantId: 'tenant-1',
      providerId: 'provider-1',
      emailData: buildEmailData({
        id: 'email-thread-1',
        threadId: 'thread-abc',
        inReplyTo: 'message-parent',
        references: ['message-parent'],
      }),
    });

    expect(result).toMatchObject({
      outcome: 'replied',
      matchedBy: 'thread_headers',
      ticketId: 'ticket-thread-123',
      commentId: 'comment-1',
    });
    expect(createTicketFromEmailMock).not.toHaveBeenCalled();
    expect(findContactByEmailMock).toHaveBeenCalledWith('client@example.com', 'tenant-1', {
      ticketId: 'ticket-thread-123',
    });
    expect(createCommentFromEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket_id: 'ticket-thread-123',
        author_type: 'contact',
        author_id: undefined,
        contact_id: 'contact-only-thread',
        inboundReplyEvent: expect.objectContaining({
          matchedBy: 'thread_headers',
        }),
      }),
      'tenant-1'
    );
  });
});
