import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailMessageDetails } from '@alga-psa/shared/interfaces/inbound-email.interfaces';

const withAdminTransactionMock = vi.fn();
const parseEmailReplyBodyMock = vi.fn();
const findTicketByReplyTokenMock = vi.fn();
const findTicketByEmailThreadMock = vi.fn();
const resolveInboundTicketDefaultsMock = vi.fn();
const resolveEffectiveInboundTicketDefaultsMock = vi.fn();
const findContactByEmailMock = vi.fn();
const findClientIdByInboundEmailDomainMock = vi.fn();
const findValidClientPrimaryContactIdMock = vi.fn();
const findEmailProviderMailboxAddressMock = vi.fn();
const upsertTicketWatchListRecipientsMock = vi.fn();
const createTicketFromEmailMock = vi.fn();
const createCommentFromEmailMock = vi.fn();
const processInboundEmailArtifactsBestEffortMock = vi.fn();

function buildEmailData(overrides: Partial<EmailMessageDetails> = {}): EmailMessageDetails {
  return {
    id: 'email-1',
    provider: 'google',
    providerId: 'provider-1',
    tenant: 'tenant-1',
    receivedAt: '2026-05-13T00:00:00.000Z',
    from: { email: 'client@example.com', name: 'Client User' },
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
  tenantDb: (conn: any, tenant: string) => ({
    table: (table: string) => conn(table).where({ tenant }),
  }),
}));

vi.mock('@alga-psa/shared/workflow/actions/emailWorkflowActions', () => ({
  parseEmailReplyBody: (...args: any[]) => parseEmailReplyBodyMock(...args),
  findTicketByReplyToken: (...args: any[]) => findTicketByReplyTokenMock(...args),
  findTicketByEmailThread: (...args: any[]) => findTicketByEmailThreadMock(...args),
  resolveInboundTicketDefaults: (...args: any[]) => resolveInboundTicketDefaultsMock(...args),
  resolveEffectiveInboundTicketDefaults: (...args: any[]) => resolveEffectiveInboundTicketDefaultsMock(...args),
  findContactByEmail: (...args: any[]) => findContactByEmailMock(...args),
  findClientIdByInboundEmailDomain: (...args: any[]) => findClientIdByInboundEmailDomainMock(...args),
  findValidClientPrimaryContactId: (...args: any[]) => findValidClientPrimaryContactIdMock(...args),
  findEmailProviderMailboxAddress: (...args: any[]) => findEmailProviderMailboxAddressMock(...args),
  upsertTicketWatchListRecipients: (...args: any[]) => upsertTicketWatchListRecipientsMock(...args),
  createTicketFromEmail: (...args: any[]) => createTicketFromEmailMock(...args),
  createCommentFromEmail: (...args: any[]) => createCommentFromEmailMock(...args),
}));

vi.mock('@alga-psa/shared/services/email/processInboundEmailArtifacts', () => ({
  processInboundEmailArtifactsBestEffort: (...args: any[]) =>
    processInboundEmailArtifactsBestEffortMock(...args),
}));

describe('processInboundEmailInApp threaded inbound routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    parseEmailReplyBodyMock.mockResolvedValue({
      sanitizedText: 'Reply body',
      sanitizedHtml: undefined,
      confidence: 0.95,
      strategy: 'plain',
      appliedHeuristics: [],
      warnings: [],
      tokens: { conversationToken: 'reply-token-456' },
    });
    findTicketByReplyTokenMock.mockResolvedValue(null);
    findTicketByEmailThreadMock.mockResolvedValue(null);
    resolveInboundTicketDefaultsMock.mockResolvedValue({
      client_id: 'default-client-id',
      board_id: 'board-id',
      status_id: 'status-id',
      priority_id: 'priority-id',
      entered_by: 'entered-by-user',
    });
    resolveEffectiveInboundTicketDefaultsMock.mockResolvedValue({
      defaults: {
        client_id: 'default-client-id',
        board_id: 'board-id',
        status_id: 'status-id',
        priority_id: 'priority-id',
        entered_by: 'entered-by-user',
      },
      source: 'provider_default',
    });
    findContactByEmailMock.mockResolvedValue(null);
    findClientIdByInboundEmailDomainMock.mockResolvedValue(null);
    findValidClientPrimaryContactIdMock.mockResolvedValue(null);
    findEmailProviderMailboxAddressMock.mockResolvedValue('support@example.com');
    upsertTicketWatchListRecipientsMock.mockResolvedValue({ updated: true, watchList: [] });
    createTicketFromEmailMock.mockResolvedValue({ ticket_id: 'ticket-1', ticket_number: 'T-1' });
    createCommentFromEmailMock.mockResolvedValue('comment-1');
    processInboundEmailArtifactsBestEffortMock.mockResolvedValue(undefined);
  });

  it('T033: reply token tied to a comment routes to latest comment in that thread', async () => {
    findTicketByReplyTokenMock.mockResolvedValue({
      ticketId: 'ticket-reply-456',
      commentId: 'root-comment-456',
    });

    let commentsQueryCount = 0;
    withAdminTransactionMock.mockImplementation(async (callback: (trx: any) => Promise<any>) => {
      const trx = vi.fn((table: string) => {
        if (table === 'tickets as t' || table === 'comments as c' || table === 'tickets') {
          return makeQueryBuilder(undefined);
        }

        if (table === 'comments') {
          commentsQueryCount += 1;
          const firstResult = commentsQueryCount === 1
            ? { ticketId: 'ticket-reply-456', threadId: 'thread-456' }
            : { parentCommentId: 'latest-comment-456' };
          const builder: any = {
            select: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            first: vi.fn().mockResolvedValue(firstResult),
          };
          return builder;
        }

        throw new Error(`Unexpected table in unit test: ${table}`);
      });

      return callback(trx);
    });

    const { processInboundEmailInApp } = await import(
      '@alga-psa/shared/services/email/processInboundEmailInApp'
    );

    const result = await processInboundEmailInApp({
      tenantId: 'tenant-1',
      providerId: 'provider-1',
      emailData: buildEmailData({ id: 'email-reply-comment-token-1' }),
    });

    expect(result).toMatchObject({
      outcome: 'replied',
      matchedBy: 'reply_token',
      ticketId: 'ticket-reply-456',
      commentId: 'comment-1',
    });
    expect(createTicketFromEmailMock).not.toHaveBeenCalled();
    expect(findContactByEmailMock).toHaveBeenCalledWith('client@example.com', 'tenant-1', {
      ticketId: 'ticket-reply-456',
    });
    expect(createCommentFromEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket_id: 'ticket-reply-456',
        parent_comment_id: 'latest-comment-456',
        inboundReplyEvent: expect.objectContaining({
          matchedBy: 'reply_token',
        }),
      }),
      'tenant-1'
    );
    expect(commentsQueryCount).toBe(2);
  });

  it('T034: In-Reply-To resolves outbound message id to comment thread', async () => {
    parseEmailReplyBodyMock.mockResolvedValue({
      sanitizedText: 'Header reply body',
      sanitizedHtml: undefined,
      confidence: 0.95,
      strategy: 'plain',
      appliedHeuristics: [],
      warnings: [],
      tokens: {},
    });

    let commentsQueryCount = 0;
    withAdminTransactionMock.mockImplementation(async (callback: (trx: any) => Promise<any>) => {
      const trx = vi.fn((table: string) => {
        if (table === 'tickets as t' || table === 'comments as c' || table === 'tickets') {
          return makeQueryBuilder(undefined);
        }

        if (table === 'email_sending_logs') {
          const builder: any = {
            select: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            whereNotNull: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            first: vi.fn().mockResolvedValue({ threadId: 'thread-789' }),
          };
          return builder;
        }

        if (table === 'comment_threads') {
          const builder: any = {
            select: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            first: vi.fn().mockResolvedValue({
              ticketId: 'ticket-thread-789',
              threadId: 'thread-789',
            }),
          };
          return builder;
        }

        if (table === 'comments') {
          commentsQueryCount += 1;
          const builder: any = {
            select: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            first: vi.fn().mockResolvedValue({ parentCommentId: 'latest-comment-789' }),
          };
          return builder;
        }

        throw new Error(`Unexpected table in unit test: ${table}`);
      });

      return callback(trx);
    });

    const { processInboundEmailInApp } = await import(
      '@alga-psa/shared/services/email/processInboundEmailInApp'
    );

    const result = await processInboundEmailInApp({
      tenantId: 'tenant-1',
      providerId: 'provider-1',
      emailData: buildEmailData({
        id: 'email-in-reply-to-1',
        inReplyTo: '<outbound-789@example.test>',
      }),
    });

    expect(result).toMatchObject({
      outcome: 'replied',
      matchedBy: 'thread_headers',
      ticketId: 'ticket-thread-789',
      commentId: 'comment-1',
    });
    expect(findTicketByEmailThreadMock).not.toHaveBeenCalled();
    expect(createTicketFromEmailMock).not.toHaveBeenCalled();
    expect(findContactByEmailMock).toHaveBeenCalledWith('client@example.com', 'tenant-1', {
      ticketId: 'ticket-thread-789',
    });
    expect(createCommentFromEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket_id: 'ticket-thread-789',
        parent_comment_id: 'latest-comment-789',
        inboundReplyEvent: expect.objectContaining({
          matchedBy: 'thread_headers',
        }),
      }),
      'tenant-1'
    );
    expect(commentsQueryCount).toBe(1);
  });

  it('T035: References are walked from newest to oldest and first match wins', async () => {
    parseEmailReplyBodyMock.mockResolvedValue({
      sanitizedText: 'References reply body',
      sanitizedHtml: undefined,
      confidence: 0.95,
      strategy: 'plain',
      appliedHeuristics: [],
      warnings: [],
      tokens: {},
    });

    const rfcLookups: string[] = [];
    withAdminTransactionMock.mockImplementation(async (callback: (trx: any) => Promise<any>) => {
      const trx = vi.fn((table: string) => {
        if (table === 'tickets as t' || table === 'comments as c' || table === 'tickets') {
          return makeQueryBuilder(undefined);
        }

        if (table === 'email_sending_logs') {
          let rfcMessageId = '';
          const builder: any = {
            select: vi.fn().mockReturnThis(),
            where: vi.fn((criteria: Record<string, unknown>) => {
              if (!('rfc_message_id' in criteria)) {
                return builder;
              }
              rfcMessageId = String(criteria.rfc_message_id ?? '');
              rfcLookups.push(rfcMessageId);
              return builder;
            }),
            whereNotNull: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            first: vi.fn(async () =>
              rfcMessageId === '<target-reference@example.test>'
                ? { threadId: 'thread-ref-123' }
                : undefined
            ),
          };
          return builder;
        }

        if (table === 'comment_threads') {
          const builder: any = {
            select: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            first: vi.fn().mockResolvedValue({
              ticketId: 'ticket-ref-123',
              threadId: 'thread-ref-123',
            }),
          };
          return builder;
        }

        if (table === 'comments') {
          const builder: any = {
            select: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            first: vi.fn().mockResolvedValue({ parentCommentId: 'latest-comment-ref-123' }),
          };
          return builder;
        }

        throw new Error(`Unexpected table in unit test: ${table}`);
      });

      return callback(trx);
    });

    const { processInboundEmailInApp } = await import(
      '@alga-psa/shared/services/email/processInboundEmailInApp'
    );

    const result = await processInboundEmailInApp({
      tenantId: 'tenant-1',
      providerId: 'provider-1',
      emailData: buildEmailData({
        id: 'email-references-1',
        references: [
          '<old-reference@example.test>',
          '<target-reference@example.test>',
          '<newer-unmatched-reference@example.test>',
        ],
      }),
    });

    expect(result).toMatchObject({
      outcome: 'replied',
      matchedBy: 'thread_headers',
      ticketId: 'ticket-ref-123',
      commentId: 'comment-1',
    });
    expect(rfcLookups).toEqual([
      '<newer-unmatched-reference@example.test>',
      '<target-reference@example.test>',
    ]);
    expect(findTicketByEmailThreadMock).not.toHaveBeenCalled();
    expect(createCommentFromEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket_id: 'ticket-ref-123',
        parent_comment_id: 'latest-comment-ref-123',
      }),
      'tenant-1'
    );
  });

  it('T036: provider thread id resolves directly through comment_threads', async () => {
    parseEmailReplyBodyMock.mockResolvedValue({
      sanitizedText: 'Provider thread reply body',
      sanitizedHtml: undefined,
      confidence: 0.95,
      strategy: 'plain',
      appliedHeuristics: [],
      warnings: [],
      tokens: {},
    });

    let commentThreadQueryCount = 0;
    withAdminTransactionMock.mockImplementation(async (callback: (trx: any) => Promise<any>) => {
      const trx = vi.fn((table: string) => {
        if (table === 'tickets as t' || table === 'comments as c' || table === 'tickets') {
          return makeQueryBuilder(undefined);
        }

        if (table === 'comment_threads') {
          commentThreadQueryCount += 1;
          const firstResult = commentThreadQueryCount === 1
            ? { threadId: 'thread-provider-123' }
            : { ticketId: 'ticket-provider-123', threadId: 'thread-provider-123' };
          const builder: any = {
            select: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            whereNotNull: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            first: vi.fn().mockResolvedValue(firstResult),
          };
          return builder;
        }

        if (table === 'comments') {
          const builder: any = {
            select: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            first: vi.fn().mockResolvedValue({ parentCommentId: 'latest-comment-provider-123' }),
          };
          return builder;
        }

        throw new Error(`Unexpected table in unit test: ${table}`);
      });

      return callback(trx);
    });

    const { processInboundEmailInApp } = await import(
      '@alga-psa/shared/services/email/processInboundEmailInApp'
    );

    const result = await processInboundEmailInApp({
      tenantId: 'tenant-1',
      providerId: 'provider-1',
      emailData: buildEmailData({
        id: 'email-provider-thread-1',
        threadId: 'provider-thread-abc',
      }),
    });

    expect(result).toMatchObject({
      outcome: 'replied',
      matchedBy: 'thread_headers',
      ticketId: 'ticket-provider-123',
      commentId: 'comment-1',
    });
    expect(commentThreadQueryCount).toBe(2);
    expect(findTicketByEmailThreadMock).not.toHaveBeenCalled();
    expect(createTicketFromEmailMock).not.toHaveBeenCalled();
    expect(createCommentFromEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket_id: 'ticket-provider-123',
        parent_comment_id: 'latest-comment-provider-123',
      }),
      'tenant-1'
    );
  });

  it('T037: legacy ticket-level fallback creates a top-level thread reply', async () => {
    parseEmailReplyBodyMock.mockResolvedValue({
      sanitizedText: 'Legacy fallback reply body',
      sanitizedHtml: undefined,
      confidence: 0.95,
      strategy: 'plain',
      appliedHeuristics: [],
      warnings: [],
      tokens: {},
    });
    findTicketByEmailThreadMock.mockResolvedValue({
      ticketId: 'ticket-legacy-fallback-123',
    });

    withAdminTransactionMock.mockImplementation(async (callback: (trx: any) => Promise<any>) => {
      const trx = vi.fn((table: string) => {
        if (table === 'tickets as t' || table === 'comments as c' || table === 'tickets') {
          return makeQueryBuilder(undefined);
        }

        if (table === 'email_sending_logs' || table === 'comment_threads') {
          const builder: any = {
            select: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            whereNotNull: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            first: vi.fn().mockResolvedValue(undefined),
          };
          return builder;
        }

        throw new Error(`Unexpected table in unit test: ${table}`);
      });

      return callback(trx);
    });

    const { processInboundEmailInApp } = await import(
      '@alga-psa/shared/services/email/processInboundEmailInApp'
    );

    const result = await processInboundEmailInApp({
      tenantId: 'tenant-1',
      providerId: 'provider-1',
      emailData: buildEmailData({
        id: 'email-legacy-fallback-1',
        threadId: 'legacy-provider-thread-id',
        inReplyTo: '<legacy-ticket-message@example.test>',
        references: ['<legacy-ticket-message@example.test>'],
      }),
    });

    expect(result).toMatchObject({
      outcome: 'replied',
      matchedBy: 'thread_headers',
      ticketId: 'ticket-legacy-fallback-123',
      commentId: 'comment-1',
    });
    expect(createTicketFromEmailMock).not.toHaveBeenCalled();
    expect(createCommentFromEmailMock).toHaveBeenCalledWith(
      expect.not.objectContaining({
        parent_comment_id: expect.anything(),
      }),
      'tenant-1'
    );
  });

  it('T038: reply token wins over In-Reply-To when both are present', async () => {
    parseEmailReplyBodyMock.mockResolvedValue({
      sanitizedText: 'Precedence reply body',
      sanitizedHtml: undefined,
      confidence: 0.95,
      strategy: 'plain',
      appliedHeuristics: [],
      warnings: [],
      tokens: { conversationToken: 'reply-token-precedence' },
    });
    findTicketByReplyTokenMock.mockResolvedValue({
      ticketId: 'ticket-token-precedence',
      commentId: 'root-comment-precedence',
    });

    let emailLogQueried = false;
    let commentsQueryCount = 0;
    withAdminTransactionMock.mockImplementation(async (callback: (trx: any) => Promise<any>) => {
      const trx = vi.fn((table: string) => {
        if (table === 'tickets as t' || table === 'comments as c' || table === 'tickets') {
          return makeQueryBuilder(undefined);
        }

        if (table === 'comments') {
          commentsQueryCount += 1;
          const firstResult = commentsQueryCount === 1
            ? { ticketId: 'ticket-token-precedence', threadId: 'thread-token-precedence' }
            : { parentCommentId: 'latest-token-precedence' };
          const builder: any = {
            select: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            first: vi.fn().mockResolvedValue(firstResult),
          };
          return builder;
        }

        if (table === 'email_sending_logs') {
          emailLogQueried = true;
          return makeQueryBuilder({ threadId: 'thread-header-that-should-not-win' });
        }

        throw new Error(`Unexpected table in unit test: ${table}`);
      });

      return callback(trx);
    });

    const { processInboundEmailInApp } = await import(
      '@alga-psa/shared/services/email/processInboundEmailInApp'
    );

    const result = await processInboundEmailInApp({
      tenantId: 'tenant-1',
      providerId: 'provider-1',
      emailData: buildEmailData({
        id: 'email-precedence-1',
        inReplyTo: '<header-message-that-should-not-win@example.test>',
      }),
    });

    expect(result).toMatchObject({
      outcome: 'replied',
      matchedBy: 'reply_token',
      ticketId: 'ticket-token-precedence',
      commentId: 'comment-1',
    });
    expect(emailLogQueried).toBe(false);
    expect(createCommentFromEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket_id: 'ticket-token-precedence',
        parent_comment_id: 'latest-token-precedence',
        inboundReplyEvent: expect.objectContaining({
          matchedBy: 'reply_token',
        }),
      }),
      'tenant-1'
    );
  });

});
