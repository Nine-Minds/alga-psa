import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailMessageDetails } from '../../../interfaces/inbound-email.interfaces';

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
const processEmailAttachmentMock = vi.fn();
const processInboundEmailArtifactsBestEffortMock = vi.fn();

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
  resolveEffectiveInboundTicketDefaults: (...args: any[]) => resolveEffectiveInboundTicketDefaultsMock(...args),
  findContactByEmail: (...args: any[]) => findContactByEmailMock(...args),
  findClientIdByInboundEmailDomain: (...args: any[]) => findClientIdByInboundEmailDomainMock(...args),
  findValidClientPrimaryContactId: (...args: any[]) => findValidClientPrimaryContactIdMock(...args),
  findEmailProviderMailboxAddress: (...args: any[]) => findEmailProviderMailboxAddressMock(...args),
  upsertTicketWatchListRecipients: (...args: any[]) => upsertTicketWatchListRecipientsMock(...args),
  createTicketFromEmail: (...args: any[]) => createTicketFromEmailMock(...args),
  createCommentFromEmail: (...args: any[]) => createCommentFromEmailMock(...args),
  processEmailAttachment: (...args: any[]) => processEmailAttachmentMock(...args),
}));

vi.mock('../processInboundEmailArtifacts', () => ({
  processInboundEmailArtifactsBestEffort: (...args: any[]) =>
    processInboundEmailArtifactsBestEffortMock(...args),
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
    findEmailProviderMailboxAddressMock.mockResolvedValue('support@example.com');
    upsertTicketWatchListRecipientsMock.mockResolvedValue({ updated: true, watchList: [] });
    resolveEffectiveInboundTicketDefaultsMock.mockResolvedValue({
      defaults: {
        client_id: 'default-client-id',
        board_id: 'board-id',
        status_id: 'status-id',
        priority_id: 'priority-id',
        category_id: undefined,
        subcategory_id: undefined,
        location_id: undefined,
        entered_by: 'entered-by-user',
      },
      source: 'provider_default',
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
    processInboundEmailArtifactsBestEffortMock.mockResolvedValue(undefined);
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

    expect(processInboundEmailArtifactsBestEffortMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        providerId: 'provider-1',
        ticketId: 'ticket-1',
        scopeLabel: 'new-ticket',
      })
    );
    expect(createCommentFromEmailMock.mock.invocationCallOrder[0]).toBeLessThan(
      processInboundEmailArtifactsBestEffortMock.mock.invocationCallOrder[0]
    );
  });

  it('new inbound email with matched internal user keeps routing defaults but stores internal authorship', async () => {
    findContactByEmailMock.mockResolvedValue({
      user_id: 'internal-user-123',
      user_type: 'internal',
      email: 'robert@nineminds.com',
      name: 'Robert Isaacs',
    });

    const { processInboundEmailInApp } = await import('../processInboundEmailInApp');

    const result = await processInboundEmailInApp({
      tenantId: 'tenant-1',
      providerId: 'provider-1',
      emailData: buildEmailData({
        from: { email: 'ROBERT@NINEMINDS.COM', name: 'Robert Isaacs' },
      }),
    });

    expect(result.outcome).toBe('created');
    expect(createTicketFromEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: 'default-client-id',
        contact_id: undefined,
      }),
      'tenant-1'
    );
    expect(createCommentFromEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket_id: 'ticket-1',
        author_type: 'internal',
        author_id: 'internal-user-123',
        contact_id: undefined,
        metadata: expect.objectContaining({
          unmatchedSender: true,
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
    expect(processInboundEmailArtifactsBestEffortMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        providerId: 'provider-1',
        ticketId: 'ticket-reply-123',
        scopeLabel: 'reply',
      })
    );
    expect(createCommentFromEmailMock.mock.invocationCallOrder[0]).toBeLessThan(
      processInboundEmailArtifactsBestEffortMock.mock.invocationCallOrder[0]
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
    expect(processInboundEmailArtifactsBestEffortMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        providerId: 'provider-1',
        ticketId: 'ticket-thread-123',
        scopeLabel: 'reply',
      })
    );
    expect(createCommentFromEmailMock.mock.invocationCallOrder[0]).toBeLessThan(
      processInboundEmailArtifactsBestEffortMock.mock.invocationCallOrder[0]
    );
  });

  it('skips self-sent notification emails from provider mailbox', async () => {
    parseEmailReplyBodyMock.mockResolvedValue({
      sanitizedText: 'Notification body',
      sanitizedHtml: undefined,
      confidence: 0.95,
      strategy: 'plain',
      appliedHeuristics: [],
      warnings: [],
      tokens: { conversationToken: 'self-token-123' },
    });

    const { processInboundEmailInApp } = await import('../processInboundEmailInApp');

    const result = await processInboundEmailInApp({
      tenantId: 'tenant-1',
      providerId: 'provider-1',
      emailData: buildEmailData({
        id: 'email-self-notification-1',
        from: { email: 'support@example.com', name: 'Support Mailbox' },
        inReplyTo: 'outbound-message-id-1',
        references: ['outbound-message-id-1'],
        threadId: 'thread-1',
      }),
    });

    expect(result).toEqual({
      outcome: 'skipped',
      reason: 'self_notification',
    });
    expect(findTicketByReplyTokenMock).not.toHaveBeenCalled();
    expect(findTicketByEmailThreadMock).not.toHaveBeenCalled();
    expect(createTicketFromEmailMock).not.toHaveBeenCalled();
    expect(createCommentFromEmailMock).not.toHaveBeenCalled();
    expect(processInboundEmailArtifactsBestEffortMock).not.toHaveBeenCalled();
  });

  it('skips token-only inbound emails with no content above reply marker', async () => {
    parseEmailReplyBodyMock.mockResolvedValue({
      sanitizedText:
        '\\[ALGA-REPLY-TOKEN 5723f287-affb-4166-b674-fd05c9df98ed ticketId=9dc3ffd6-2342-4a85-bddb-fbb1975efd25\\]',
      sanitizedHtml: undefined,
      confidence: 0.95,
      strategy: 'plain',
      appliedHeuristics: [],
      warnings: [],
      tokens: { conversationToken: '5723f287-affb-4166-b674-fd05c9df98ed' },
    });

    const { processInboundEmailInApp } = await import('../processInboundEmailInApp');

    const result = await processInboundEmailInApp({
      tenantId: 'tenant-1',
      providerId: 'provider-1',
      emailData: buildEmailData({
        id: 'email-token-only-1',
        from: { email: 'client@example.com', name: 'Client' },
      }),
    });

    expect(result).toEqual({
      outcome: 'skipped',
      reason: 'self_notification',
    });
    expect(findTicketByReplyTokenMock).not.toHaveBeenCalled();
    expect(findTicketByEmailThreadMock).not.toHaveBeenCalled();
    expect(createTicketFromEmailMock).not.toHaveBeenCalled();
    expect(createCommentFromEmailMock).not.toHaveBeenCalled();
    expect(processInboundEmailArtifactsBestEffortMock).not.toHaveBeenCalled();
  });

  it('rewrites data:image embeds to served attachment URLs in stored comment note after artifacts persist', async () => {
    const updatedNotes: any[] = [];
    withAdminTransactionMock.mockImplementation(async (callback: (trx: any) => Promise<any>) => {
      const trx = vi.fn((table: string) => {
        if (table === 'tickets as t') {
          return makeQueryBuilder(undefined);
        }

        if (table === 'comments as c') {
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
            first: vi.fn().mockResolvedValue(undefined),
            update: vi.fn().mockImplementation(async (payload: any) => {
              updatedNotes.push(payload);
              return 1;
            }),
          };
          return builder;
        }

        throw new Error(`Unexpected table in unit test: ${table}`);
      });

      return callback(trx);
    });

    parseEmailReplyBodyMock.mockResolvedValue({
      sanitizedText: 'body',
      sanitizedHtml: '<p>Hello<img src="data:image/png;base64,aGVsbG8=" /></p>',
      confidence: 0.95,
      strategy: 'plain',
      appliedHeuristics: [],
      warnings: [],
      tokens: {},
    });

    processInboundEmailArtifactsBestEffortMock.mockResolvedValue({
      embeddedImageUrlMappings: [
        {
          source: 'data-url',
          reference: 'data:image/png;base64,aGVsbG8=',
          fileId: 'file-123',
          documentId: 'doc-123',
          url: '/api/documents/view/file-123',
        },
      ],
    });

    const { processInboundEmailInApp } = await import('../processInboundEmailInApp');

    const result = await processInboundEmailInApp({
      tenantId: 'tenant-1',
      providerId: 'provider-1',
      emailData: buildEmailData({
        id: 'email-with-embed',
        body: {
          text: 'body',
          html: '<p>Hello<img src="data:image/png;base64,aGVsbG8=" /></p>',
        },
      }),
    });

    expect(result.outcome).toBe('created');
    expect(updatedNotes).toHaveLength(1);
    expect(typeof updatedNotes[0].note).toBe('string');
    expect(updatedNotes[0].note).toContain('/api/documents/view/file-123');
    expect(updatedNotes[0].note).not.toContain('data:image/png;base64,aGVsbG8=');
  });

  it('T019: new ticket path includes watch-list attributes from To/CC recipients', async () => {
    findContactByEmailMock.mockResolvedValue(null);

    const { processInboundEmailInApp } = await import('../processInboundEmailInApp');

    await processInboundEmailInApp({
      tenantId: 'tenant-1',
      providerId: 'provider-1',
      emailData: buildEmailData({
        from: { email: 'client@example.com', name: 'Client User' },
        to: [
          { email: 'support@example.com', name: 'Support' },
          { email: 'watch-to@example.com', name: 'Watcher To' },
        ],
        cc: [{ email: 'watch-cc@example.com', name: 'Watcher Cc' }],
      }),
    });

    expect(createTicketFromEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: {
          watch_list: [
            {
              email: 'watch-to@example.com',
              active: true,
              name: 'Watcher To',
              source: 'inbound_to',
            },
            {
              email: 'watch-cc@example.com',
              active: true,
              name: 'Watcher Cc',
              source: 'inbound_cc',
            },
            {
              email: 'client@example.com',
              active: true,
              name: 'Client User',
              source: 'inbound_from',
            },
          ],
        },
      }),
      'tenant-1'
    );
  });

  it('T020: new ticket watch-list seed excludes sender email', async () => {
    findContactByEmailMock.mockResolvedValue(null);

    const { processInboundEmailInApp } = await import('../processInboundEmailInApp');

    await processInboundEmailInApp({
      tenantId: 'tenant-1',
      providerId: 'provider-1',
      emailData: buildEmailData({
        from: { email: 'client@example.com', name: 'Client User' },
        to: [
          { email: 'client@example.com', name: 'Client User' },
          { email: 'watcher@example.com', name: 'Watcher' },
        ],
      }),
    });

    expect(createTicketFromEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: {
          watch_list: [
            {
              email: 'watcher@example.com',
              active: true,
              name: 'Watcher',
              source: 'inbound_to',
            },
            {
              email: 'client@example.com',
              active: true,
              name: 'Client User',
              source: 'inbound_from',
            },
          ],
        },
      }),
      'tenant-1'
    );
  });

  it('T021: new ticket watch-list seed excludes provider mailbox', async () => {
    findContactByEmailMock.mockResolvedValue(null);
    findEmailProviderMailboxAddressMock.mockResolvedValue('mailbox@example.com');

    const { processInboundEmailInApp } = await import('../processInboundEmailInApp');

    await processInboundEmailInApp({
      tenantId: 'tenant-1',
      providerId: 'provider-1',
      emailData: buildEmailData({
        from: { email: 'client@example.com', name: 'Client User' },
        to: [
          { email: 'mailbox@example.com', name: 'Provider Mailbox' },
          { email: 'watcher@example.com', name: 'Watcher' },
        ],
      }),
    });

    expect(createTicketFromEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: {
          watch_list: [
            {
              email: 'watcher@example.com',
              active: true,
              name: 'Watcher',
              source: 'inbound_to',
            },
            {
              email: 'client@example.com',
              active: true,
              name: 'Client User',
              source: 'inbound_from',
            },
          ],
        },
      }),
      'tenant-1'
    );
  });

  it('T022: reply-token path calls watch-list upsert for existing ticket', async () => {
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

    await processInboundEmailInApp({
      tenantId: 'tenant-1',
      providerId: 'provider-1',
      emailData: buildEmailData({
        from: { email: 'client@example.com', name: 'Client User' },
        to: [
          { email: 'support@example.com', name: 'Support' },
          { email: 'watcher@example.com', name: 'Watcher' },
        ],
      }),
    });

    expect(upsertTicketWatchListRecipientsMock).toHaveBeenCalledWith(
      {
        ticketId: 'ticket-reply-123',
        recipients: [
          {
            email: 'watcher@example.com',
            active: true,
            name: 'Watcher',
            source: 'inbound_to',
          },
          {
            email: 'client@example.com',
            active: true,
            name: 'Client User',
            source: 'inbound_from',
          },
        ],
      },
      'tenant-1'
    );
  });

  it('T023: thread-header path calls watch-list upsert for existing ticket', async () => {
    findTicketByReplyTokenMock.mockResolvedValue(null);
    findTicketByEmailThreadMock.mockResolvedValue({
      ticketId: 'ticket-thread-123',
    });

    const { processInboundEmailInApp } = await import('../processInboundEmailInApp');

    await processInboundEmailInApp({
      tenantId: 'tenant-1',
      providerId: 'provider-1',
      emailData: buildEmailData({
        id: 'email-thread-123',
        from: { email: 'client@example.com', name: 'Client User' },
        to: [
          { email: 'support@example.com', name: 'Support' },
          { email: 'watcher@example.com', name: 'Watcher' },
        ],
      }),
    });

    expect(upsertTicketWatchListRecipientsMock).toHaveBeenCalledWith(
      {
        ticketId: 'ticket-thread-123',
        recipients: [
          {
            email: 'watcher@example.com',
            active: true,
            name: 'Watcher',
            source: 'inbound_to',
          },
          {
            email: 'client@example.com',
            active: true,
            name: 'Client User',
            source: 'inbound_from',
          },
        ],
      },
      'tenant-1'
    );
  });

  it('T024: when sender is unmatched and To/CC recipients are excluded, sender is still upserted to watch-list', async () => {
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
    findEmailProviderMailboxAddressMock.mockResolvedValue('support@example.com');

    const { processInboundEmailInApp } = await import('../processInboundEmailInApp');

    await processInboundEmailInApp({
      tenantId: 'tenant-1',
      providerId: 'provider-1',
      emailData: buildEmailData({
        from: { email: 'client@example.com', name: 'Client User' },
        to: [
          { email: 'client@example.com', name: 'Client User' },
          { email: 'support@example.com', name: 'Support' },
        ],
      }),
    });

    expect(upsertTicketWatchListRecipientsMock).toHaveBeenCalledWith(
      {
        ticketId: 'ticket-reply-123',
        recipients: [
          {
            email: 'client@example.com',
            active: true,
            name: 'Client User',
            source: 'inbound_from',
          },
        ],
      },
      'tenant-1'
    );
  });
});
