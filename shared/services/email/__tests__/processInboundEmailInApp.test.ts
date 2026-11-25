import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EmailMessageDetails } from '../../../interfaces/inbound-email.interfaces';
import { parseEmailReply } from '../../../lib/email/replyParser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readEmailFixture = (file: string) =>
  fs.readFileSync(path.join(__dirname, '..', '..', '..', 'lib', 'email', '__fixtures__', file), 'utf8');

/** Non-empty visible text of each stored BlockNote block, inline links included. */
function blockTexts(blocks: any[]): string[] {
  const inlineText = (node: any): string =>
    typeof node?.text === 'string' ? node.text : (node?.content ?? []).map(inlineText).join('');
  return blocks
    .map((block) => (block?.content ?? []).map(inlineText).join('').trim())
    .filter(Boolean);
}

/** Same algorithm as BaseEmailService.logEmailSendResult / notificationLoopDetection.ts. */
function replyTokenHash(token: string): string {
  return createHash('sha256').update(token.trim()).digest('hex');
}

/**
 * The exact RFC 3834 headers AUTO_GENERATED_MAIL_HEADERS stamps on every
 * outbound notification (see shared/lib/email/automatedMessage.ts and the
 * production incident's inspected headers). Suppression-positive fixtures
 * carry these so they suppress via the genuine automated-message signal
 * rather than by accident of a matching subject string.
 */
const LOOPED_NOTIFICATION_HEADERS = {
  'auto-submitted': 'auto-generated',
  'x-auto-response-suppress': 'OOF, AutoReply, AutoForward',
};

const withAdminTransactionMock = vi.fn();
const parseEmailReplyBodyMock = vi.fn();
const findTicketByReplyTokenMock = vi.fn();
const findTicketByEmailThreadMock = vi.fn();
const resolveInboundTicketDefaultsMock = vi.fn();
const resolveEffectiveInboundTicketDefaultsMock = vi.fn();
const findContactByEmailMock = vi.fn();
const findInboundEmailDomainMappingMock = vi.fn();
const createContactForInboundSenderMock = vi.fn();
const findValidClientPrimaryContactIdMock = vi.fn();
const findEmailProviderMailboxAddressMock = vi.fn();
const upsertTicketWatchListRecipientsMock = vi.fn();
const createTicketFromEmailMock = vi.fn();
const createCommentFromEmailMock = vi.fn();
const processEmailAttachmentMock = vi.fn();
const processInboundEmailArtifactsBestEffortMock = vi.fn();

// Rows returned by the inbound reply-reopen policy lookup (loadInboundReplyPolicyContext).
// The thread-header hijack guard authorizes a thread-header reply only when the
// sender is the ticket's own client contact / internal user / active watcher, so
// tests that exercise the legitimate reply path seed the ticket (with its client)
// here. Reset per test in beforeEach.
const reopenPolicyRows: { ticket?: unknown; board?: unknown; status?: unknown } = {};

// Row returned by the notification-loop ledger lookup(s) against
// `email_sending_logs` (see notificationLoopDetection.ts). `undefined` (the
// default, reset per test in beforeEach) means "no matching outbound send" —
// i.e. never a loop — so tests that don't care about loop detection are
// unaffected. Tests exercising loop suppression set this before calling
// processInboundEmailInApp.
const emailSendingLogsState: { row: unknown } = { row: undefined };

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
    headers: { 'authentication-results': 'mx.example; spf=pass smtp.mailfrom=example.com; dmarc=pass header.from=example.com' },
    ...overrides,
  };
}

function makeQueryBuilder(firstResult: unknown) {
  const builder: any = {
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    whereIn: vi.fn().mockReturnThis(),
    whereRaw: vi.fn().mockReturnThis(),
    whereNotNull: vi.fn().mockReturnThis(),
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
    orderBy: vi.fn().mockReturnThis(),
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

// The sender-organization lookup is a database read of its own (covered against the real schema by
// the seat technician journey test). Here every internal sender is ordinary MSP staff.
vi.mock('../../../lib/notificationAudience', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/notificationAudience')>()),
  resolveInboundReplyAudience: vi.fn(async () => ({ seat: false })),
}));

vi.mock('../../../workflow/actions/emailWorkflowActions', () => ({
  parseEmailReplyBody: (...args: any[]) => parseEmailReplyBodyMock(...args),
  findTicketByReplyToken: (...args: any[]) => findTicketByReplyTokenMock(...args),
  findTicketByEmailThread: (...args: any[]) => findTicketByEmailThreadMock(...args),
  resolveInboundTicketDefaults: (...args: any[]) => resolveInboundTicketDefaultsMock(...args),
  resolveEffectiveInboundTicketDefaults: (...args: any[]) => resolveEffectiveInboundTicketDefaultsMock(...args),
  findContactByEmail: (...args: any[]) => findContactByEmailMock(...args),
  findInboundEmailDomainMapping: (...args: any[]) => findInboundEmailDomainMappingMock(...args),
  createContactForInboundSender: (...args: any[]) => createContactForInboundSenderMock(...args),
  findValidClientPrimaryContactId: (...args: any[]) => findValidClientPrimaryContactIdMock(...args),
  findEmailProviderMailboxAddress: (...args: any[]) => findEmailProviderMailboxAddressMock(...args),
  upsertTicketWatchListRecipients: (...args: any[]) => upsertTicketWatchListRecipientsMock(...args),
  createTicketFromEmail: (...args: any[]) => createTicketFromEmailMock(...args),
  createCommentFromEmail: (...args: any[]) => createCommentFromEmailMock(...args),
  processEmailAttachment: (...args: any[]) => processEmailAttachmentMock(...args),
}));

// Rule evaluation is passed through to the real implementation unless a test seeds an outcome
// (forwarded-sender matrix row 2).
const ruleOutcomeOverride: { value: any } = { value: undefined };
vi.mock('../inboundEmailRules', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../inboundEmailRules')>();
  return {
    ...actual,
    evaluateInboundEmailRules: (...args: any[]) =>
      ruleOutcomeOverride.value
        ? Promise.resolve({ outcome: ruleOutcomeOverride.value, trace: [] })
        : (actual.evaluateInboundEmailRules as any)(...args),
  };
});

vi.mock('../processInboundEmailArtifacts', () => ({
  processInboundEmailArtifactsBestEffort: (...args: any[]) =>
    processInboundEmailArtifactsBestEffortMock(...args),
}));

describe('processInboundEmailInApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    reopenPolicyRows.ticket = undefined;
    reopenPolicyRows.board = undefined;
    reopenPolicyRows.status = undefined;
    emailSendingLogsState.row = undefined;
    ruleOutcomeOverride.value = undefined;
    delete process.env.INBOUND_RESOLVE_FORWARDED_SENDER;

    withAdminTransactionMock.mockImplementation(async (callback: (trx: any) => Promise<any>) => {
      const trx = vi.fn((table: string) => {
        if (table === 'tickets') {
          return makeQueryBuilder(reopenPolicyRows.ticket);
        }
        if (table === 'boards') {
          return makeQueryBuilder(reopenPolicyRows.board);
        }
        if (table === 'statuses') {
          return makeQueryBuilder(reopenPolicyRows.status);
        }
        if (table === 'email_sending_logs') {
          return makeQueryBuilder(emailSendingLogsState.row);
        }
        if (
          table === 'tickets as t' ||
          table === 'comments as c' ||
          table === 'comment_threads'
        ) {
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
    findInboundEmailDomainMappingMock.mockResolvedValue(null);
    findValidClientPrimaryContactIdMock.mockResolvedValue(null);
    // Default: sender does not match a contact. clearAllMocks keeps
    // implementations, so without a per-run default every test that skips
    // setting this inherits an earlier test's matched contact (order-dependent
    // under seed shuffle). Tests needing a match override it locally.
    findContactByEmailMock.mockResolvedValue(null);
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
    findInboundEmailDomainMappingMock.mockResolvedValue(null);
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

  it('stores the MIME digest with ticket and first-comment metadata so same Message-ID content cannot cross-attribute', async () => {
    const { processInboundEmailInApp } = await import('../processInboundEmailInApp');
    const result = await processInboundEmailInApp({
      tenantId: 'tenant-1',
      providerId: 'provider-1',
      emailData: buildEmailData({ id: '<shared@example.com>', sourceSha256: 'digest-content-a' }),
    });

    expect(result.outcome).toBe('created');
    expect(createTicketFromEmailMock).toHaveBeenCalledWith(expect.objectContaining({
      email_metadata: expect.objectContaining({ messageId: 'shared@example.com', sourceSha256: 'digest-content-a' }),
    }), 'tenant-1');
    expect(createCommentFromEmailMock).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ email: expect.objectContaining({ messageId: 'shared@example.com', sourceSha256: 'digest-content-a' }) }),
    }), 'tenant-1');
  });

  it('creates independent tickets for distinct MIME sources that reuse a standalone RFC Message-ID', async () => {
    // Simulates the pre-fix `thread_headers` match: the lookup would find a
    // ticket from the first message if this message's own Message-ID were
    // incorrectly supplied as a parent candidate.
    findTicketByEmailThreadMock.mockResolvedValue({ ticketId: 'ticket-first-message' });
    createTicketFromEmailMock
      .mockResolvedValueOnce({ ticket_id: 'ticket-1', ticket_number: 'T-1' })
      .mockResolvedValueOnce({ ticket_id: 'ticket-2', ticket_number: 'T-2' });
    createCommentFromEmailMock
      .mockResolvedValueOnce('comment-1')
      .mockResolvedValueOnce('comment-2');

    const { processInboundEmailInApp } = await import('../processInboundEmailInApp');
    const first = await processInboundEmailInApp({
      tenantId: 'tenant-1',
      providerId: 'provider-1',
      emailData: buildEmailData({
        id: '<forged-shared@example.com>',
        providerIdentity: 'imap:101',
        sourceSha256: 'digest-first-mime',
      }),
    });
    const second = await processInboundEmailInApp({
      tenantId: 'tenant-1',
      providerId: 'provider-1',
      emailData: buildEmailData({
        id: '<forged-shared@example.com>',
        providerIdentity: 'imap:102',
        sourceSha256: 'digest-second-mime',
      }),
    });

    expect(first.outcome).toBe('created');
    expect(second.outcome).toBe('created');
    expect(createTicketFromEmailMock).toHaveBeenCalledTimes(2);
    expect(createCommentFromEmailMock).toHaveBeenCalledTimes(2);
    expect(findTicketByEmailThreadMock).not.toHaveBeenCalled();
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
        headers: { 'authentication-results': 'mx.example; spf=pass smtp.mailfrom=example.com' },
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
        headers: { 'authentication-results': 'mx.nineminds.com; dmarc=pass header.from=nineminds.com' },
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
    // Sender is the ticket's own client contact, so the thread-header hijack
    // guard authorizes the reply rather than quarantining it.
    reopenPolicyRows.ticket = {
      ticket_id: 'ticket-thread-123',
      board_id: 'board-id',
      status_id: null,
      is_closed: false,
      closed_at: null,
      client_id: 'client-123',
      attributes: {},
    };
    reopenPolicyRows.board = {
      inbound_reply_reopen_enabled: false,
      inbound_reply_reopen_cutoff_hours: 168,
      inbound_reply_reopen_status_id: null,
      inbound_reply_ai_ack_suppression_enabled: false,
    };
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

  it.each(['', 'The restart worked.'])('processes actual notification parsing with reply %j', async (reply) => {
    parseEmailReplyBodyMock.mockImplementation(async (body) => parseEmailReply(body));
    findTicketByReplyTokenMock.mockResolvedValue({ ticketId: 'ticket-1' });
    const token = '[ALGA-REPLY-TOKEN test-token ticketId=ticket-1 commentId=comment-1]';
    const { processInboundEmailInApp } = await import('../processInboundEmailInApp');
    const result = await processInboundEmailInApp({
      tenantId: 'tenant-1',
      providerId: 'provider-1',
      emailData: buildEmailData({
        from: { email: 'hello@example.com' },
        body: {
          text: `${reply}\n${token}\n--- Please reply above this line ---\nNew comment added\nA new comment has been added to your ticket.`,
          html: `<p>${reply}</p><div>${token}</div><div data-alga-reply-boundary="true">New comment added</div>`,
        },
      }),
    });
    if (reply) {
      expect(result.outcome).toBe('replied');
      expect(createCommentFromEmailMock).toHaveBeenCalledTimes(1);
    } else {
      expect(result).toEqual({ outcome: 'skipped', reason: 'self_notification' });
      expect(createCommentFromEmailMock).not.toHaveBeenCalled();
      expect(processInboundEmailArtifactsBestEffortMock).not.toHaveBeenCalled();
    }
    expect(createTicketFromEmailMock).not.toHaveBeenCalled();
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

  it('threads an HTML-only reply (no text part) onto the ticket instead of skipping it as self_notification', async () => {
    const html = '<div>Thanks, that fixed it.</div>';
    parseEmailReplyBodyMock.mockResolvedValue({
      sanitizedText: undefined,
      sanitizedHtml: html,
      confidence: 0.9,
      strategy: 'html',
      appliedHeuristics: [],
      warnings: [],
      tokens: { conversationToken: 'html-only-token-1' },
    });
    findTicketByReplyTokenMock.mockResolvedValue({ ticketId: 'ticket-html-only' });

    const { processInboundEmailInApp } = await import('../processInboundEmailInApp');

    const result = await processInboundEmailInApp({
      tenantId: 'tenant-1',
      providerId: 'provider-1',
      emailData: buildEmailData({ id: 'email-html-only-1', body: { text: '', html } }),
    });

    expect(result).toMatchObject({ outcome: 'replied', ticketId: 'ticket-html-only' });
    expect(createCommentFromEmailMock).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('processes an attachment-only reply and reaches the comment writer (Alga token: %j)', async (withToken) => {
    parseEmailReplyBodyMock.mockImplementation(async (body: any) => parseEmailReply(body));
    findContactByEmailMock.mockResolvedValue({ contact_id: 'contact-1', client_id: 'client-1' });
    reopenPolicyRows.ticket = { ticket_id: 'ticket-attachments', board_id: 'board-1', client_id: 'client-1', is_closed: false };
    if (withToken) {
      findTicketByReplyTokenMock.mockResolvedValue({ ticketId: 'ticket-attachments' });
    } else {
      findTicketByEmailThreadMock.mockResolvedValue({ ticketId: 'ticket-attachments', matchedBy: 'in_reply_to' });
    }
    const attachments = [{ id: 'attachment-1', name: 'diagnostics.txt', contentType: 'text/plain', size: 128 }];
    const { processInboundEmailInApp } = await import('../processInboundEmailInApp');
    const result = await processInboundEmailInApp({
      tenantId: 'tenant-1',
      providerId: 'provider-1',
      emailData: buildEmailData({
        from: { email: 'client@example.com', name: 'Client' },
        inReplyTo: '<previous-message@example.test>',
        body: {
          text: withToken ? '[ALGA-REPLY-TOKEN attachment-token]\n--- Please reply above this line ---\nOld notification' : '',
          html: '<div dir="ltr"><br></div>',
        },
        attachments,
      }),
    });

    expect(result).toMatchObject({ outcome: 'replied', ticketId: 'ticket-attachments' });
    expect(createCommentFromEmailMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        ticket_id: 'ticket-attachments',
        author_type: 'contact',
        contact_id: 'contact-1',
        source: 'email',
        inboundReplyEvent: expect.objectContaining({ from: 'client@example.com' }),
      }),
      'tenant-1',
    );
    expect(processInboundEmailArtifactsBestEffortMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: 'ticket-attachments',
        scopeLabel: 'reply',
        emailData: expect.objectContaining({ attachments }),
      }),
    );
    expect(createTicketFromEmailMock).not.toHaveBeenCalled();
  });

  it.each([
    ['&nbsp;-only', '<div>&nbsp;&nbsp;</div><p>&nbsp;</p>'],
    ['whitespace-only', '<div> \n </div><br>'],
  ])('does not count a %s HTML reply as substantive content', async (_label, html) => {
    parseEmailReplyBodyMock.mockResolvedValue({
      sanitizedText: undefined,
      sanitizedHtml: html,
      confidence: 0.9,
      strategy: 'html',
      appliedHeuristics: [],
      warnings: [],
      tokens: { conversationToken: 'blank-html-token-1' },
    });

    const { processInboundEmailInApp } = await import('../processInboundEmailInApp');

    const result = await processInboundEmailInApp({
      tenantId: 'tenant-1',
      providerId: 'provider-1',
      emailData: buildEmailData({ id: 'email-blank-html-1', body: { text: '', html } }),
    });

    expect(result).toEqual({ outcome: 'skipped', reason: 'self_notification' });
    expect(createCommentFromEmailMock).not.toHaveBeenCalled();
  });

  it('rewrites data:image embeds to served attachment URLs in the stored comment and description after artifacts persist', async () => {
    const updatedNotes: any[] = [];
    const updatedTicketAttributes: any[] = [];
    let storedCommentContent: string | null = null;
    let storedTicketAttributes: Record<string, unknown> | null = null;

    createCommentFromEmailMock.mockImplementation(async (data: any) => {
      storedCommentContent = data.content;
      return 'comment-1';
    });
    createTicketFromEmailMock.mockImplementation(async (data: any) => {
      storedTicketAttributes = { ...(data.attributes ?? {}), description: data.description };
      return { ticket_id: 'ticket-1', ticket_number: 'T-1' };
    });

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

        if (table === 'comments') {
          const builder: any = {
            where: vi.fn().mockReturnThis(),
            first: vi.fn().mockImplementation(async () => (
              storedCommentContent === null ? undefined : { note: storedCommentContent }
            )),
            update: vi.fn().mockImplementation(async (payload: any) => {
              updatedNotes.push(payload);
              storedCommentContent = payload.note;
              return 1;
            }),
          };
          return builder;
        }

        if (table === 'tickets') {
          const builder: any = {
            where: vi.fn().mockReturnThis(),
            first: vi.fn().mockImplementation(async () => (
              storedTicketAttributes === null
                ? undefined
                : { attributes: JSON.stringify(storedTicketAttributes) }
            )),
            update: vi.fn().mockImplementation(async (payload: any) => {
              updatedTicketAttributes.push(payload);
              storedTicketAttributes = JSON.parse(payload.attributes);
              return 1;
            }),
          };
          return builder;
        }

        throw new Error(`Unexpected table in unit test: ${table}`);
      });

      (trx as any).fn = { now: () => 'DB_NOW' };
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
    expect(updatedTicketAttributes).toHaveLength(1);
    expect(JSON.parse(updatedTicketAttributes[0].attributes).description).toContain('/api/documents/view/file-123');
    expect(JSON.parse(updatedTicketAttributes[0].attributes).description).not.toContain('data:image/png;base64,aGVsbG8=');
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
    // Pin the sender as UNMATCHED: beforeEach only clears calls, so without
    // this the mock inherits whichever mockResolvedValue an earlier test set
    // (order-dependent under seed shuffle), and matched senders are excluded
    // from the watch-list since 85887803bc.
    findContactByEmailMock.mockResolvedValue(null);
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
    // Sender is the ticket's own client contact so the thread-header hijack
    // guard authorizes the reply; an unauthorized sender would be quarantined
    // before any watch-list upsert (that is the watcher-injection vector the
    // guard blocks — covered separately in the threading suite).
    findContactByEmailMock.mockResolvedValue({
      contact_id: 'contact-thread-123',
      client_id: 'client-123',
      user_id: undefined,
      email: 'client@example.com',
      name: 'Client User',
    });
    reopenPolicyRows.ticket = {
      ticket_id: 'ticket-thread-123',
      board_id: 'board-id',
      status_id: null,
      is_closed: false,
      closed_at: null,
      client_id: 'client-123',
      attributes: {},
    };
    reopenPolicyRows.board = {
      inbound_reply_reopen_enabled: false,
      inbound_reply_reopen_cutoff_hours: 168,
      inbound_reply_reopen_status_id: null,
      inbound_reply_ai_ack_suppression_enabled: false,
    };
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
        inReplyTo: 'parent-message@example.com',
        from: { email: 'client@example.com', name: 'Client User' },
        to: [
          { email: 'support@example.com', name: 'Support' },
          { email: 'watcher@example.com', name: 'Watcher' },
        ],
      }),
    });

    // Thread-header correlation is not sender-authenticated, so the thread-header
    // reply path never turns To/Cc addresses into active ticket watchers — even
    // for an authorized reply. This closes the watcher-injection vector where a
    // spoofed In-Reply-To could silently add arbitrary watchers.
    expect(upsertTicketWatchListRecipientsMock).not.toHaveBeenCalled();
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

  // --- Cross-mailbox notification-loop suppression ------------------------
  //
  // Production incident: tenant with two connected inbound mailboxes A
  // (`hello@jayscomputers.com.au`) and B (`jamie@jayscomputers.com.au`, also
  // the ticket assignee/watcher). Alga's own outbound notifications sent FROM
  // A TO B were delivered into B's own connected inbox and re-ingested as new
  // inbound mail, each becoming a client comment (27 in the incident).

  it('BUG REPRODUCTION -> FIX: an outbound notification from mailbox A, redelivered into connected mailbox B of the same tenant, must not become a new ticket', async () => {
    const token = 'cross-mailbox-loop-token';
    emailSendingLogsState.row = {
      id: 9001,
      from_address: 'hello@jayscomputers.com.au',
      to_addresses: ['jamie@jayscomputers.com.au'],
      cc_addresses: null,
      bcc_addresses: null,
      entity_type: 'ticket',
      entity_id: 'ticket-tk-26014',
      subject: 'Ticket Assigned: TK-26014',
      created_at: '2026-02-10T00:00:00.000Z',
      reply_token_hash: replyTokenHash(token),
    };
    findEmailProviderMailboxAddressMock.mockResolvedValue('jamie@jayscomputers.com.au');
    parseEmailReplyBodyMock.mockResolvedValue({
      sanitizedText: 'This ticket has been assigned to Jamie. Full notification template body text describing the ticket.',
      sanitizedHtml: undefined,
      confidence: 0.95,
      strategy: 'plain',
      appliedHeuristics: [],
      warnings: [],
      tokens: { conversationToken: token },
    });

    const { processInboundEmailInApp } = await import('../processInboundEmailInApp');
    const result = await processInboundEmailInApp(
      {
        tenantId: 'tenant-1',
        providerId: 'provider-mailbox-b',
        emailData: buildEmailData({
          id: 'redelivered-ticket-assigned-1',
          from: { email: 'hello@jayscomputers.com.au', name: 'Jays Computers' },
          to: [{ email: 'jamie@jayscomputers.com.au' }],
          subject: 'Ticket Assigned: TK-26014',
          body: {
            text: 'This ticket has been assigned to Jamie. Full notification template body text describing the ticket.',
            html: undefined,
          },
          headers: LOOPED_NOTIFICATION_HEADERS,
        }),
      },
      { collectDiagnostics: true }
    );

    // Fixed expectation. Before notificationLoopDetection.ts existed, this
    // exact test (with the ledger row and inputs above) asserted
    // `result.outcome === 'created'` and passed — that assertion was verified
    // to PASS against the pre-fix code by temporarily reverting
    // processInboundEmailInApp.ts / notificationLoopDetection.ts (git stash)
    // and re-running this test before implementing the fix; see the commit
    // history and draftSummary for that verification.
    expect(result).toMatchObject({ outcome: 'skipped', reason: 'notification_loop' });
    expect(result.diagnostics?.threading.failureReason).toBe('notification_loop');
    expect(result.diagnostics?.notificationLoop?.tier).toBe('reply_token_ledger');
    expect(createTicketFromEmailMock).not.toHaveBeenCalled();
    expect(createCommentFromEmailMock).not.toHaveBeenCalled();
    expect(upsertTicketWatchListRecipientsMock).not.toHaveBeenCalled();
    expect(findTicketByReplyTokenMock).not.toHaveBeenCalled();
    expect(findTicketByEmailThreadMock).not.toHaveBeenCalled();
  });

  it.each([
    ['Ticket Updated', 'Ticket Updated: TK-100', 'The status of this ticket has changed to In Progress. Full template body describing the update.'],
    ['Ticket Assigned', 'Ticket Assigned: TK-100', 'This ticket has been assigned to Jamie Support. Full template body describing the assignment.'],
    ['New Ticket', 'New Ticket Created: TK-100', 'A new ticket has been created and requires triage. Full template body describing the ticket.'],
    ['New Comment', 'New Comment on: TK-100', 'A new comment has been added to your ticket. Full template body containing the comment text.'],
  ])(
    'suppresses a looped %s notification with full substantive template text before any mutation',
    async (_label, subject, bodyText) => {
      const token = `loop-token-${subject}`;
      emailSendingLogsState.row = {
        id: 9100,
        from_address: 'hello@jayscomputers.com.au',
        to_addresses: ['jamie@jayscomputers.com.au'],
        cc_addresses: null,
        bcc_addresses: null,
        entity_type: 'ticket',
        entity_id: 'ticket-100',
        subject,
        created_at: '2026-02-10T00:00:00.000Z',
        reply_token_hash: replyTokenHash(token),
      };
      findEmailProviderMailboxAddressMock.mockResolvedValue('jamie@jayscomputers.com.au');
      parseEmailReplyBodyMock.mockResolvedValue({
        sanitizedText: bodyText,
        sanitizedHtml: undefined,
        confidence: 0.95,
        strategy: 'plain',
        appliedHeuristics: [],
        warnings: [],
        tokens: { conversationToken: token },
      });

      const { processInboundEmailInApp } = await import('../processInboundEmailInApp');
      const result = await processInboundEmailInApp(
        {
          tenantId: 'tenant-1',
          providerId: 'provider-mailbox-b',
          emailData: buildEmailData({
            id: `looped-${subject}`,
            from: { email: 'hello@jayscomputers.com.au' },
            to: [{ email: 'jamie@jayscomputers.com.au' }],
            subject,
            body: { text: bodyText, html: undefined },
            headers: LOOPED_NOTIFICATION_HEADERS,
          }),
        },
        { collectDiagnostics: true }
      );

      expect(result).toMatchObject({ outcome: 'skipped', reason: 'notification_loop' });
      expect(result.diagnostics?.threading.failureReason).toBe('notification_loop');
      expect(createTicketFromEmailMock).not.toHaveBeenCalled();
      expect(createCommentFromEmailMock).not.toHaveBeenCalled();
      expect(upsertTicketWatchListRecipientsMock).not.toHaveBeenCalled();
    }
  );

  it('retry / duplicate delivery of an already-suppressed looped notification stays suppressed', async () => {
    const token = 'loop-token-retry';
    emailSendingLogsState.row = {
      id: 9200,
      from_address: 'hello@jayscomputers.com.au',
      to_addresses: ['jamie@jayscomputers.com.au'],
      cc_addresses: null,
      bcc_addresses: null,
      entity_type: 'ticket',
      entity_id: 'ticket-200',
      subject: 'Ticket Updated: TK-200',
      created_at: '2026-02-10T00:00:00.000Z',
      reply_token_hash: replyTokenHash(token),
    };
    findEmailProviderMailboxAddressMock.mockResolvedValue('jamie@jayscomputers.com.au');
    parseEmailReplyBodyMock.mockResolvedValue({
      sanitizedText: 'Full template body describing the update.',
      sanitizedHtml: undefined,
      confidence: 0.95,
      strategy: 'plain',
      appliedHeuristics: [],
      warnings: [],
      tokens: { conversationToken: token },
    });

    const { processInboundEmailInApp } = await import('../processInboundEmailInApp');
    const input = {
      tenantId: 'tenant-1',
      providerId: 'provider-mailbox-b',
      emailData: buildEmailData({
        id: 'looped-retry-1',
        from: { email: 'hello@jayscomputers.com.au' },
        to: [{ email: 'jamie@jayscomputers.com.au' }],
        subject: 'Ticket Updated: TK-200',
        body: { text: 'Full template body describing the update.', html: undefined },
        headers: LOOPED_NOTIFICATION_HEADERS,
      }),
    };

    const first = await processInboundEmailInApp(input);
    const second = await processInboundEmailInApp(input);

    expect(first).toMatchObject({ outcome: 'skipped', reason: 'notification_loop' });
    expect(second).toMatchObject({ outcome: 'skipped', reason: 'notification_loop' });
    expect(createTicketFromEmailMock).not.toHaveBeenCalled();
    expect(createCommentFromEmailMock).not.toHaveBeenCalled();
  });

  it('REGRESSION (code review finding): a genuine human reply sent FROM the shared outbound mailbox address is not suppressed', async () => {
    // hello@jayscomputers.com.au is BOTH Alga's outbound From address AND a
    // real staffed mailbox a human reads and replies from — the incident
    // tenant's exact shape. Before the Tier-1 tightening, sender==from_address
    // and recipient-contains-providerMailboxEmail alone were enough to
    // suppress this, which would have silently dropped a genuine staff reply.
    const token = 'probe-token-shared-mailbox-reply';
    emailSendingLogsState.row = {
      id: 9400,
      from_address: 'hello@jayscomputers.com.au',
      to_addresses: ['jamie@jayscomputers.com.au', 'client@example.com'],
      cc_addresses: null,
      bcc_addresses: null,
      entity_type: 'ticket',
      entity_id: 'ticket-probe',
      subject: 'Ticket Updated: TK-PROBE',
      created_at: '2026-02-10T00:00:00.000Z',
      reply_token_hash: replyTokenHash(token),
    };
    findEmailProviderMailboxAddressMock.mockResolvedValue('jamie@jayscomputers.com.au');
    findTicketByReplyTokenMock.mockResolvedValue({ ticketId: 'ticket-probe' });
    findContactByEmailMock.mockResolvedValue({
      user_id: 'internal-user-hello',
      user_type: 'internal',
      email: 'hello@jayscomputers.com.au',
      name: 'Shared Support Mailbox',
    });
    parseEmailReplyBodyMock.mockResolvedValue({
      sanitizedText: 'Hi Jamie, I already called the customer, please close it out.',
      sanitizedHtml: undefined,
      confidence: 0.95,
      strategy: 'plain',
      appliedHeuristics: [],
      warnings: [],
      tokens: { conversationToken: token },
    });

    const { processInboundEmailInApp } = await import('../processInboundEmailInApp');
    const result = await processInboundEmailInApp({
      tenantId: 'tenant-1',
      providerId: 'provider-mailbox-b',
      emailData: buildEmailData({
        id: 'probe-shared-mailbox-reply-1',
        // A human composed this from the shared mailbox — no automated
        // headers — and their mail client prepended "Re:", so neither of the
        // Tier-1 discriminators (automated signal, exact subject match) hold.
        from: { email: 'hello@jayscomputers.com.au', name: 'Jays Computers' },
        to: [{ email: 'jamie@jayscomputers.com.au' }],
        subject: 'Re: Ticket Updated: TK-PROBE',
        body: { text: 'Hi Jamie, I already called the customer, please close it out.', html: undefined },
        headers: { 'authentication-results': 'mx.jayscomputers.com.au; dmarc=pass header.from=jayscomputers.com.au' },
      }),
    }, { collectDiagnostics: true });

    expect(result).toMatchObject({ outcome: 'replied', matchedBy: 'reply_token', ticketId: 'ticket-probe' });
    expect(result.diagnostics?.notificationLoop?.evidence).toMatchObject({
      senderMatchesLoggedFromAddress: true,
      recipientMatchedLoggedSend: true,
      subjectMatchedLoggedSend: false,
    });
    expect(result.diagnostics?.notificationLoop?.evidence.automated.isAutomated).toBe(false);
    expect(createCommentFromEmailMock).toHaveBeenCalledTimes(1);
    expect(createCommentFromEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ ticket_id: 'ticket-probe' }),
      'tenant-1'
    );
  });

  it('negative: internal staff reply from a tenant-domain address, quoting the notification, is not suppressed and creates exactly one comment', async () => {
    const token = 'staff-reply-token-1';
    emailSendingLogsState.row = {
      id: 9300,
      from_address: 'hello@jayscomputers.com.au',
      to_addresses: ['jamie@jayscomputers.com.au'],
      cc_addresses: null,
      bcc_addresses: null,
      entity_type: 'ticket',
      entity_id: 'ticket-99',
      subject: 'Ticket Assigned: TK-99',
      created_at: '2026-02-10T00:00:00.000Z',
      reply_token_hash: replyTokenHash(token),
    };
    // The reply lands back at mailbox A (hello@) — the receiving provider here.
    findEmailProviderMailboxAddressMock.mockResolvedValue('hello@jayscomputers.com.au');
    findTicketByReplyTokenMock.mockResolvedValue({ ticketId: 'ticket-99' });
    findContactByEmailMock.mockResolvedValue({
      user_id: 'internal-user-bob',
      user_type: 'internal',
      email: 'bob@jayscomputers.com.au',
      name: 'Bob Staff',
    });
    parseEmailReplyBodyMock.mockResolvedValue({
      sanitizedText: 'Looping in the customer on this — please see the details below.',
      sanitizedHtml: undefined,
      confidence: 0.95,
      strategy: 'plain',
      appliedHeuristics: [],
      warnings: [],
      tokens: { conversationToken: token },
    });

    const { processInboundEmailInApp } = await import('../processInboundEmailInApp');
    const result = await processInboundEmailInApp({
      tenantId: 'tenant-1',
      providerId: 'provider-1',
      emailData: buildEmailData({
        id: 'internal-staff-reply-1',
        from: { email: 'bob@jayscomputers.com.au', name: 'Bob Staff' },
        to: [{ email: 'hello@jayscomputers.com.au' }],
        subject: 'Re: Ticket Assigned: TK-99',
        body: { text: 'Looping in the customer on this — please see the details below.', html: undefined },
        headers: { 'authentication-results': 'mx.jayscomputers.com.au; dmarc=pass header.from=jayscomputers.com.au' },
      }),
    });

    expect(result).toMatchObject({ outcome: 'replied', matchedBy: 'reply_token', ticketId: 'ticket-99' });
    expect(createCommentFromEmailMock).toHaveBeenCalledTimes(1);
    expect(createCommentFromEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket_id: 'ticket-99',
        author_type: 'internal',
        author_id: 'internal-user-bob',
      }),
      'tenant-1'
    );
  });

  it('negative: a reply carrying attachments is not suppressed and the artifact path still runs', async () => {
    findTicketByReplyTokenMock.mockResolvedValue({ ticketId: 'ticket-77' });
    parseEmailReplyBodyMock.mockResolvedValue({
      sanitizedText: 'See the attached screenshot.',
      sanitizedHtml: undefined,
      confidence: 0.95,
      strategy: 'plain',
      appliedHeuristics: [],
      warnings: [],
      tokens: { conversationToken: 'attachment-reply-token-1' },
    });

    const { processInboundEmailInApp } = await import('../processInboundEmailInApp');
    const result = await processInboundEmailInApp({
      tenantId: 'tenant-1',
      providerId: 'provider-1',
      emailData: buildEmailData({
        id: 'reply-with-attachment-1',
        from: { email: 'client@example.com', name: 'Client User' },
        body: { text: 'See the attached screenshot.', html: undefined },
        attachments: [
          { id: 'att-1', name: 'screenshot.png', contentType: 'image/png', size: 1024 },
        ],
      }),
    });

    expect(result).toMatchObject({ outcome: 'replied', matchedBy: 'reply_token', ticketId: 'ticket-77' });
    expect(createCommentFromEmailMock).toHaveBeenCalledTimes(1);
    expect(processInboundEmailArtifactsBestEffortMock).toHaveBeenCalledWith(
      expect.objectContaining({ ticketId: 'ticket-77', scopeLabel: 'reply' })
    );
  });

  it('negative: genuinely automated third-party mail (e.g. a vendor out-of-office) is handled by existing behavior, not swallowed by the loop rule', async () => {
    // No ledger row exists for this unrelated third-party sender, so Tier 2
    // (which requires an automated header AND a ledger correlation) cannot fire.
    findTicketByReplyTokenMock.mockResolvedValue(null);
    findTicketByEmailThreadMock.mockResolvedValue(null);
    parseEmailReplyBodyMock.mockResolvedValue({
      sanitizedText: 'I am currently out of the office and will return next week.',
      sanitizedHtml: undefined,
      confidence: 0.95,
      strategy: 'plain',
      appliedHeuristics: [],
      warnings: [],
      tokens: {},
    });

    const { processInboundEmailInApp } = await import('../processInboundEmailInApp');
    const result = await processInboundEmailInApp({
      tenantId: 'tenant-1',
      providerId: 'provider-1',
      emailData: buildEmailData({
        id: 'vendor-ooo-1',
        from: { email: 'vendor@othercompany.example', name: 'Vendor Auto-Reply' },
        subject: 'Automatic reply: Out of office',
        body: { text: 'I am currently out of the office and will return next week.', html: undefined },
        headers: {
          'auto-submitted': 'auto-replied',
          'authentication-results': 'mx.example; dmarc=pass header.from=othercompany.example',
        },
      }),
    });

    // Existing behavior for un-threaded automated mail is unchanged by this
    // card: it is not a reply to anything this tenant sent, so it proceeds
    // through ordinary new-ticket handling rather than being caught by the
    // new loop rule.
    expect(result.outcome).toBe('created');
    expect(createTicketFromEmailMock).toHaveBeenCalled();
  });

  it('negative: a reply token not present in the outbound ledger (forged/replayed) does not suppress', async () => {
    // emailSendingLogsState.row stays undefined (beforeEach default): no
    // outbound send in this tenant ever used this token.
    findTicketByReplyTokenMock.mockResolvedValue(null);
    parseEmailReplyBodyMock.mockResolvedValue({
      sanitizedText: 'Full template-looking text an attacker copied from a real notification.',
      sanitizedHtml: undefined,
      confidence: 0.95,
      strategy: 'plain',
      appliedHeuristics: [],
      warnings: [],
      tokens: { conversationToken: 'attacker-forged-token-does-not-exist' },
    });

    const { processInboundEmailInApp } = await import('../processInboundEmailInApp');
    const result = await processInboundEmailInApp(
      {
        tenantId: 'tenant-1',
        providerId: 'provider-1',
        emailData: buildEmailData({
          id: 'forged-token-1',
          from: { email: 'attacker@example.com' },
          body: { text: 'Full template-looking text an attacker copied from a real notification.', html: undefined },
        }),
      },
      { collectDiagnostics: true }
    );

    expect(result.diagnostics?.notificationLoop?.evidence.tokenHashMatched).toBe(false);
    expect(result.outcome).not.toBe('skipped');
    expect(createTicketFromEmailMock).toHaveBeenCalled();
  });

  // alga-2026-0003353: the parser's safety net hands back the text result when it rejects its
  // own HTML trim. The comment must then be built from that text, never from the original body,
  // which still carries every level of quoted history.
  describe('safety-net rejection of the HTML trim', () => {
    const AUTHORED = 'Thursday afternoon works for us. Please go ahead and book it.';
    const QUOTED_HISTORY = [
      'ALGA-REPLY-TOKEN',
      'Please reply above this line',
      'still sealed in the shipping box',
      'Comment from Dana Tech',
      'Enroll both machines in Intune before delivery',
      'runbooks/laptop-imaging',
    ];

    const storedCommentContent = async (emailId: string, body = {
      text: readEmailFixture('gmail-reply-own-reply.txt'),
      html: readEmailFixture('gmail-reply-own-reply.html'),
    }): Promise<string> => {
      findTicketByReplyTokenMock.mockResolvedValue({ ticketId: 'ticket-own-reply' });
      let content = '';
      createCommentFromEmailMock.mockImplementation(async (data: any) => {
        content = String(data.content ?? '');
        return 'comment-own-reply';
      });

      const { processInboundEmailInApp } = await import('../processInboundEmailInApp');
      const result = await processInboundEmailInApp({
        tenantId: 'tenant-1',
        providerId: 'provider-1',
        emailData: buildEmailData({
          id: emailId,
          from: { email: 'jane.client@example.test', name: 'Jane Client' },
          body,
        }),
      });

      expect(result).toMatchObject({ outcome: 'replied', ticketId: 'ticket-own-reply' });
      expect(createCommentFromEmailMock).toHaveBeenCalledTimes(1);
      return content;
    };

    it('builds the comment from the text result, not the original HTML', async () => {
      parseEmailReplyBodyMock.mockResolvedValue({
        sanitizedText: AUTHORED,
        sanitizedHtml: undefined,
        confidence: 'high',
        strategy: 'custom-boundary',
        appliedHeuristics: ['token-strip', 'explicit-boundary', 'html-blockquote-trim', 'html-trim-rejected'],
        warnings: [
          'HTML blockquote trim removed significantly more content than text heuristics; using text result.',
        ],
        tokens: { conversationToken: 'OWNREPLY-TOKEN-11', ticketId: 'ticket-own-reply' },
      });

      const content = await storedCommentContent('email-safety-net-rejected-1');

      expect(content).toContain(AUTHORED);
      for (const leaked of QUOTED_HISTORY) {
        expect(content).not.toContain(leaked);
      }
    });

    it('stores only the authored reply for the real Gmail reply-to-own-reply mail', async () => {
      parseEmailReplyBodyMock.mockImplementation(async (body: any) => parseEmailReply(body));

      const content = await storedCommentContent('email-own-reply-end-to-end-1');

      expect(content).toContain(AUTHORED);
      for (const leaked of QUOTED_HISTORY) {
        expect(content).not.toContain(leaked);
      }
      // The comment the reporter saw was 65 blocks of thread. All that is left here is the
      // authored line and the attribution ahead of the cut quote (existing parser behaviour).
      const texts = blockTexts(JSON.parse(content));
      expect(texts[0]).toBe(AUTHORED);
      expect(texts).toHaveLength(2);
      expect(texts[1]).toMatch(/^On Mon, .*wrote:$/);
    });

    it('stores a multipart bottom answer below a legacy notification', async () => {
      parseEmailReplyBodyMock.mockImplementation(async (body: any) => parseEmailReply(body));
      const answer = 'No, do not restart it. Payroll is still running.';
      const content = await storedCommentContent('email-multipart-bottom-reply', {
        text: 'See my answer below.\nOn Mon, Nov 17, 2026 Dana Tech wrote:\n'
          + '[ALGA-REPLY-TOKEN OWNREPLY-TOKEN-11]\n--- Please reply above this line ---\n'
          + `Old notification\n${answer}`,
        html: '<p>See my answer below.</p><div>On Mon, Nov 17, 2026 Dana Tech wrote:</div>'
          + '<div style="display:none">[ALGA-REPLY-TOKEN OWNREPLY-TOKEN-11]</div>'
          + `<p>--- Please reply above this line ---</p><p>Old notification</p><p>${answer}</p>`,
      });

      expect(content).toContain(answer);
    });

    it.each([
      'The deployment failed with this error:',
      'Subject: Deployment failure',
      'Here is what the deployment script wrote:',
      'Deployment details:\n> Here is what the deployment script wrote:',
      'On startup the deployment script wrote:',
      'Deployment details:\nOn startup the deployment script wrote:',
      'Deployment details:\n> On startup the deployment script wrote:',
      'Deployment details:\nOn startup at 09:15 the deployment script wrote:',
      'Deployment details:\n> On startup at 09:15 the deployment script wrote:',
      'Deployment details:\nOn Nov 17 the deployment script wrote:',
      'Deployment details:\n> On Nov 17 the deployment script wrote:',
      'Le 17 novembre le script a écrit :',
      'Deployment details:\n> Le 17 novembre le script a écrit :',
      'Am 17. November schrieb das Skript:',
      'Deployment details:\n> Am 17. November schrieb das Skript:',
    ])(
      'stores the trailing error quotation introduced by %s above an explicit reply boundary', async (prefix) => {
        parseEmailReplyBodyMock.mockImplementation(async (body: any) => parseEmailReply(body));
        const content = await storedCommentContent('email-trailing-error-quotation', {
          text: readEmailFixture('authored-trailing-quotation.txt').replace('The deployment failed with this error:', prefix)
            + '\n[ALGA-REPLY-TOKEN OWNREPLY-TOKEN-11]',
          html: '',
        });

        expect(content).toContain('ACCESS DENIED (code 5). The service account cannot access the deployment share.');
        expect(content).toContain('Retry failed. No machines were updated.');
        expect(content).not.toContain('Old notification');
        expect(content).not.toContain('[ALGA-REPLY-TOKEN');
      },
    );
    it.each(['-----Original Message-----', ''])(
      'stores pasted report evidence and subsequent instructions with separator %j', async (separator) => {
        parseEmailReplyBodyMock.mockImplementation(async (body: any) => parseEmailReply(body));
        const content = await storedCommentContent('email-forwarded-report', {
          text: readEmailFixture('authored-forwarded-report.txt').replace('-----Original Message-----\n', separator ? `${separator}\n` : '')
            + '\n[ALGA-REPLY-TOKEN OWNREPLY-TOKEN-11]',
          html: '',
        });

        expect(content).toContain('Delivery failed: 550 5.1.1 Recipient address rejected.');
        expect(content).toContain('Recipient: operations@example.test');
        expect(content).toContain('This is the recipient we need you to restore. Please call me before making changes.');
        expect(content).not.toContain('Old notification');
        expect(content).not.toContain('[ALGA-REPLY-TOKEN');
      },
    );
  });

  describe('forwarded-sender attribution (new-ticket path)', () => {
    const TECH_AUTH = { 'authentication-results': 'mx.nineminds.com; dmarc=pass header.from=nineminds.com' };
    const technician = {
      contact_id: '',
      client_id: '',
      user_id: 'tech-user-1',
      user_type: 'internal',
      email: 'tom@nineminds.com',
      name: 'Tom Technician',
    };
    const clientContact = {
      contact_id: 'contact-dana',
      client_id: 'client-a',
      user_id: undefined,
      email: 'dana@client-a.example',
      name: 'Dana Whitfield',
      client_name: 'Client A',
    };
    const forwardText = (from = 'Dana Whitfield <dana@client-a.example>') => [
      'Please open a ticket for this.',
      '',
      `From: ${from}`,
      'Sent: Tuesday, November 18, 2025 9:14 AM',
      'To: Tom Technician <tom@nineminds.com>',
      'Subject: VPN keeps dropping',
      '',
      'Hello Tom, the VPN has dropped three times today.',
    ].join('\n');
    const techEmail = (overrides: Partial<EmailMessageDetails> = {}) =>
      buildEmailData({
        from: { email: 'tom@nineminds.com', name: 'Tom Technician' },
        headers: TECH_AUTH,
        body: { text: forwardText(), html: undefined },
        ...overrides,
      });
    const lookupBy = (map: Record<string, unknown>) =>
      findContactByEmailMock.mockImplementation(async (email: string) => map[email.toLowerCase()] ?? null);

    const run = async (emailData: EmailMessageDetails) => {
      const { processInboundEmailInApp } = await import('../processInboundEmailInApp');
      return processInboundEmailInApp({ tenantId: 'tenant-1', providerId: 'provider-1', emailData });
    };
    const expectTodaysRouting = () => {
      expect(createTicketFromEmailMock).toHaveBeenCalledWith(
        expect.objectContaining({ client_id: 'default-client-id', contact_id: undefined }),
        'tenant-1'
      );
      expect(createCommentFromEmailMock).toHaveBeenCalledWith(
        expect.objectContaining({ author_type: 'internal', author_id: 'tech-user-1' }),
        'tenant-1'
      );
      expect(createTicketFromEmailMock.mock.calls[0][0]).not.toHaveProperty('sender_contact_id');
    };

    it('row 1: internal forwarder + contact original sender files under the contact/client, technician stays author', async () => {
      lookupBy({ 'tom@nineminds.com': technician, 'dana@client-a.example': clientContact });
      const info = vi.spyOn(console, 'info').mockImplementation(() => {});

      const result = await run(techEmail());

      expect(result.outcome).toBe('created');
      // The ticket is Dana's, but Dana did not send this email: the sender identity is withheld so
      // the creation activity/event is not credited to the recovered (unauthenticated) address.
      expect(createTicketFromEmailMock).toHaveBeenCalledWith(
        expect.objectContaining({ client_id: 'client-a', contact_id: 'contact-dana', sender_contact_id: null }),
        'tenant-1'
      );
      expect(createCommentFromEmailMock).toHaveBeenCalledWith(
        expect.objectContaining({ author_type: 'internal', author_id: 'tech-user-1', contact_id: undefined }),
        'tenant-1'
      );
      const attributed = info.mock.calls.find((c) => c[0] === 'inbound_email_forwarded_sender_attributed');
      expect(attributed?.[1]).toMatchObject({
        tenantId: 'tenant-1', source: 'text-block', original_contact_id: 'contact-dana',
        client_id: 'client-a', forwarder_user_id: 'tech-user-1',
      });
      expect(JSON.stringify(attributed)).not.toContain('dana@client-a.example');
      info.mockRestore();
    });

    it('row 2: a rule-assigned client wins over the forwarded contact', async () => {
      lookupBy({ 'tom@nineminds.com': technician, 'dana@client-a.example': clientContact });
      ruleOutcomeOverride.value = {
        kind: 'assign_client', ruleId: 'rule-1', ruleName: 'Route', clientId: 'client-b', matchSource: 'rule_extraction', matchedBy: 'x',
      };
      findValidClientPrimaryContactIdMock.mockResolvedValue('contact-b-primary');
      const info = vi.spyOn(console, 'info').mockImplementation(() => {});

      await run(techEmail());

      expect(createTicketFromEmailMock).toHaveBeenCalledWith(
        expect.objectContaining({ client_id: 'client-b', contact_id: 'contact-b-primary' }),
        'tenant-1'
      );
      expect(info.mock.calls.find((c) => c[0] === 'inbound_email_forwarded_sender_not_applied')?.[1])
        .toMatchObject({ reason: 'rule-assigned-client' });
      expect(findContactByEmailMock).not.toHaveBeenCalledWith('dana@client-a.example', 'tenant-1', expect.anything());
      info.mockRestore();
    });

    it('row 3: original sender with no contact match leaves today\'s behaviour', async () => {
      lookupBy({ 'tom@nineminds.com': technician });
      const info = vi.spyOn(console, 'info').mockImplementation(() => {});
      await run(techEmail());
      expectTodaysRouting();
      expect(info.mock.calls.find((c) => c[0] === 'inbound_email_forwarded_sender_not_applied')?.[1])
        .toMatchObject({ reason: 'no-contact-match' });
      info.mockRestore();
    });

    it('row 4: original sender who is an internal user is never promoted', async () => {
      lookupBy({
        'tom@nineminds.com': technician,
        'dana@client-a.example': { ...technician, user_id: 'other-user', email: 'dana@client-a.example' },
      });
      const info = vi.spyOn(console, 'info').mockImplementation(() => {});
      await run(techEmail());
      expectTodaysRouting();
      expect(info.mock.calls.find((c) => c[0] === 'inbound_email_forwarded_sender_not_applied')?.[1])
        .toMatchObject({ reason: 'internal-match' });
      info.mockRestore();
    });

    it('row 5: a contact forwarding keeps the forwarder as the contact', async () => {
      lookupBy({
        'client@example.com': { ...clientContact, contact_id: 'contact-forwarder', client_id: 'client-f' },
        'dana@client-a.example': clientContact,
      });
      await run(buildEmailData({ body: { text: forwardText(), html: undefined } }));
      expect(createTicketFromEmailMock).toHaveBeenCalledWith(
        expect.objectContaining({ client_id: 'client-f', contact_id: 'contact-forwarder' }),
        'tenant-1'
      );
      // The forwarding contact really is the sender, so the ticket contact stays the actor.
      expect(createTicketFromEmailMock.mock.calls[0][0]).not.toHaveProperty('sender_contact_id');
      expect(findContactByEmailMock).not.toHaveBeenCalledWith('dana@client-a.example', 'tenant-1', expect.anything());
    });

    it('row 6: an internal From that fails the gate gets no forward attribution and still logs the auth failure', async () => {
      lookupBy({ 'tom@nineminds.com': technician, 'dana@client-a.example': clientContact });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});

      await run(techEmail({ headers: {} }));

      expect(warn.mock.calls.some((c) => c[0] === 'SECURITY_EVENT inbound_email_internal_sender_auth_failed')).toBe(true);
      // The audit write is attempted (it fails in this table-restricted mock, which is swallowed).
      expect(error.mock.calls.some((c) => String(c[0]).includes('Failed to persist inbound sender-auth security event'))).toBe(true);
      expect(findContactByEmailMock).not.toHaveBeenCalledWith('dana@client-a.example', 'tenant-1', expect.anything());
      expect(createTicketFromEmailMock).toHaveBeenCalledWith(
        expect.objectContaining({ client_id: 'default-client-id', contact_id: undefined }),
        'tenant-1'
      );
      warn.mockRestore();
      error.mockRestore();
    });

    it('row 7: two candidate addresses in the block leave today\'s behaviour', async () => {
      lookupBy({ 'tom@nineminds.com': technician, 'dana@client-a.example': clientContact });
      const info = vi.spyOn(console, 'info').mockImplementation(() => {});
      await run(techEmail({
        body: { text: forwardText('Dana <dana@client-a.example>; Eve <eve@client-b.example>'), html: undefined },
      }));
      expectTodaysRouting();
      expect(info.mock.calls.find((c) => c[0] === 'inbound_email_forwarded_sender_not_applied')?.[1])
        .toMatchObject({ reason: 'ambiguous' });
      info.mockRestore();
    });

    it('row 8: a forward into an existing thread keeps the thread path', async () => {
      lookupBy({ 'tom@nineminds.com': technician, 'dana@client-a.example': clientContact });
      findTicketByEmailThreadMock.mockResolvedValue({ ticketId: 'ticket-thread-1' });
      const info = vi.spyOn(console, 'info').mockImplementation(() => {});

      const result = await run(techEmail({ threadId: 'thread-1', inReplyTo: 'parent', references: ['parent'] }));

      expect(result).toMatchObject({ outcome: 'replied', ticketId: 'ticket-thread-1' });
      expect(createTicketFromEmailMock).not.toHaveBeenCalled();
      expect(createCommentFromEmailMock).toHaveBeenCalledWith(
        expect.objectContaining({ ticket_id: 'ticket-thread-1', author_type: 'internal', author_id: 'tech-user-1' }),
        'tenant-1'
      );
      expect(findContactByEmailMock).not.toHaveBeenCalledWith('dana@client-a.example', 'tenant-1', expect.anything());
      expect(info.mock.calls.find((c) => c[0] === 'inbound_email_forwarded_sender_not_applied')?.[1])
        .toMatchObject({ reason: 'thread-path' });
      info.mockRestore();
    });

    it('kill switch: INBOUND_RESOLVE_FORWARDED_SENDER=false turns row 1 back into today\'s behaviour', async () => {
      process.env.INBOUND_RESOLVE_FORWARDED_SENDER = 'false';
      lookupBy({ 'tom@nineminds.com': technician, 'dana@client-a.example': clientContact });
      await run(techEmail());
      expectTodaysRouting();
      expect(findContactByEmailMock).not.toHaveBeenCalledWith('dana@client-a.example', 'tenant-1', expect.anything());
    });
  });
});
