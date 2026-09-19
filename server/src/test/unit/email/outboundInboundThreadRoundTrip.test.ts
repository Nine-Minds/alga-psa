import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  EmailMessage,
  EmailProviderCapabilities,
  EmailSendResult,
  IEmailProvider,
} from '@alga-psa/types';
import type { EmailMessageDetails } from '@alga-psa/shared/interfaces/inbound-email.interfaces';

type Criteria = Record<string, unknown>;

const dbState = vi.hoisted(() => ({
  comments: new Map<string, { comment_id: string; thread_id: string; parent_comment_id: string | null }>(),
  commentThreads: new Map<string, { thread_id: string; ticket_id: string }>(),
  tickets: new Map<string, Record<string, unknown>>(),
  boards: new Map<string, Record<string, unknown>>(),
  emailLogs: [] as Record<string, unknown>[],
}));

const mocks = vi.hoisted(() => ({
  parseEmailReplyBody: vi.fn(),
  findTicketByReplyToken: vi.fn(),
  findTicketByEmailThread: vi.fn(),
  resolveInboundTicketDefaults: vi.fn(),
  resolveEffectiveInboundTicketDefaults: vi.fn(),
  findContactByEmail: vi.fn(),
  findClientIdByInboundEmailDomain: vi.fn(),
  findValidClientPrimaryContactId: vi.fn(),
  findEmailProviderMailboxAddress: vi.fn(),
  upsertTicketWatchListRecipients: vi.fn(),
  createTicketFromEmail: vi.fn(),
  createCommentFromEmail: vi.fn(),
  processInboundEmailArtifactsBestEffort: vi.fn(),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({
    knex: vi.fn((table: string) => makeQueryBuilder(table)),
  })),
  withAdminTransaction: vi.fn(async (callback: (trx: any) => Promise<unknown>) => {
    const trx = vi.fn((table: string) => makeQueryBuilder(table));
    return callback(trx);
  }),
  tenantDb: (conn: any, tenant: string) => ({
    table: (table: string) => conn(table).where({ tenant }),
  }),
}));

// sendEmail publishes outbound-email lifecycle events (F071); stub the publisher
// so this round-trip test doesn't reach the real event bus.
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async () => {}),
}));

vi.mock('@alga-psa/shared/workflow/actions/emailWorkflowActions', () => ({
  parseEmailReplyBody: (...args: unknown[]) => mocks.parseEmailReplyBody(...args),
  findTicketByReplyToken: (...args: unknown[]) => mocks.findTicketByReplyToken(...args),
  findTicketByEmailThread: (...args: unknown[]) => mocks.findTicketByEmailThread(...args),
  resolveInboundTicketDefaults: (...args: unknown[]) => mocks.resolveInboundTicketDefaults(...args),
  resolveEffectiveInboundTicketDefaults: (...args: unknown[]) =>
    mocks.resolveEffectiveInboundTicketDefaults(...args),
  findContactByEmail: (...args: unknown[]) => mocks.findContactByEmail(...args),
  findClientIdByInboundEmailDomain: (...args: unknown[]) =>
    mocks.findClientIdByInboundEmailDomain(...args),
  findValidClientPrimaryContactId: (...args: unknown[]) =>
    mocks.findValidClientPrimaryContactId(...args),
  findEmailProviderMailboxAddress: (...args: unknown[]) =>
    mocks.findEmailProviderMailboxAddress(...args),
  upsertTicketWatchListRecipients: (...args: unknown[]) =>
    mocks.upsertTicketWatchListRecipients(...args),
  createTicketFromEmail: (...args: unknown[]) => mocks.createTicketFromEmail(...args),
  createCommentFromEmail: (...args: unknown[]) => mocks.createCommentFromEmail(...args),
}));

vi.mock('@alga-psa/shared/services/email/processInboundEmailArtifacts', () => ({
  processInboundEmailArtifactsBestEffort: (...args: unknown[]) =>
    mocks.processInboundEmailArtifactsBestEffort(...args),
}));

function makeQueryBuilder(table: string) {
  const whereCriteria: Criteria = {};
  const builder = {
    select: vi.fn(() => builder),
    where: vi.fn((criteria: Criteria | string, value?: unknown) => {
      if (typeof criteria === 'string') {
        whereCriteria[criteria] = value;
      } else if (typeof criteria === 'object') {
        Object.assign(whereCriteria, criteria);
      }
      return builder;
    }),
    andWhereRaw: vi.fn(() => builder),
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
    whereNotNull: vi.fn(() => builder),
    orderBy: vi.fn(() => builder),
    first: vi.fn(async () => {
      if (table === 'comments') {
        const commentId = whereCriteria.comment_id ? String(whereCriteria.comment_id) : null;
        if (commentId) {
          return dbState.comments.get(commentId) ?? null;
        }
        const threadId = String(whereCriteria.thread_id ?? '');
        const latest = Array.from(dbState.comments.values())
          .filter((comment) => comment.thread_id === threadId)
          .at(-1);
        return latest ? { parentCommentId: latest.comment_id } : null;
      }

      if (table === 'tickets') {
        const ticketId = whereCriteria.ticket_id ? String(whereCriteria.ticket_id) : null;
        return ticketId ? dbState.tickets.get(ticketId) ?? null : null;
      }

      if (table === 'boards') {
        const boardId = whereCriteria.board_id ? String(whereCriteria.board_id) : null;
        return boardId ? dbState.boards.get(boardId) ?? null : null;
      }

      if (table === 'comment_threads') {
        const threadId = String(whereCriteria.thread_id ?? '');
        const row = dbState.commentThreads.get(threadId);
        return row ? { ticketId: row.ticket_id, threadId: row.thread_id } : null;
      }

      if (table === 'email_sending_logs') {
        // notificationLoopDetection's Tier 1 lookup: raw row, tenant + reply_token_hash.
        if (whereCriteria.reply_token_hash) {
          return (
            dbState.emailLogs.find(
              (log) =>
                log.tenant === whereCriteria.tenant &&
                log.reply_token_hash === whereCriteria.reply_token_hash,
            ) ?? null
          );
        }
        // notificationLoopDetection's Tier 2 fallback lookup adds from_address/created_at
        // filters via andWhereRaw, which this harness does not capture; it is exercised
        // against precise canned rows in processInboundEmailInApp.test.ts instead, so no
        // special-case is needed here (it falls through to the generic branch below and
        // correctly finds nothing).
        const row = dbState.emailLogs.find(
          (log) =>
            log.tenant === whereCriteria.tenant &&
            log.rfc_message_id === whereCriteria.rfc_message_id &&
            log.comment_thread_id,
        );
        return row ? { threadId: row.comment_thread_id, rfc_message_id: row.rfc_message_id } : null;
      }

      return null;
    }),
    insert: vi.fn(async (row: Record<string, unknown>) => {
      if (table === 'email_sending_logs') {
        dbState.emailLogs.push({ id: dbState.emailLogs.length + 1, ...row });
      }
      return [1];
    }),
    update: vi.fn(async () => 1),
  };
  return builder;
}

function buildEmailData(overrides: Partial<EmailMessageDetails> = {}): EmailMessageDetails {
  return {
    id: 'round-trip-inbound-email',
    provider: 'google',
    providerId: 'provider-1',
    tenant: 'tenant-t044',
    receivedAt: '2026-05-13T00:00:00.000Z',
    from: { email: 'client@example.com', name: 'Client User' },
    to: [{ email: 'support@example.com', name: 'Support' }],
    subject: 'Re: Round trip',
    body: { text: 'Inbound response', html: undefined },
    attachments: [],
    // Provider-fetched mail always carries the receiving MTA's
    // Authentication-Results; contact attribution now needs an aligned pass.
    headers: {
      'Authentication-Results':
        'mx.google.com; dkim=pass header.d=example.com; spf=pass smtp.mailfrom=client@example.com',
    },
    ...overrides,
  };
}

const capabilities: EmailProviderCapabilities = {
  supportsHtml: true,
  supportsAttachments: false,
  supportsTemplating: false,
  supportsBulkSending: false,
  supportsTracking: false,
  supportsCustomDomains: false,
};

import { BaseEmailService } from '@alga-psa/email/BaseEmailService';

class TestEmailService extends BaseEmailService {
  constructor(private readonly provider: IEmailProvider) {
    super();
  }

  protected async getEmailProvider(): Promise<IEmailProvider | null> {
    return this.provider;
  }

  protected getFromAddress(): string {
    return 'support@example.com';
  }

  protected getServiceName(): string {
    return 'RoundTripEmailService';
  }
}

async function waitForOutboundLog(timeoutMs = 500) {
  const startedAt = Date.now();
  while (dbState.emailLogs.length === 0) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for outbound email log');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return dbState.emailLogs[0];
}

describe('email thread outbound/inbound round trip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbState.comments.clear();
    dbState.commentThreads.clear();
    dbState.tickets.clear();
    dbState.boards.clear();
    dbState.emailLogs.length = 0;

    mocks.parseEmailReplyBody.mockResolvedValue({
      sanitizedText: 'Inbound response',
      sanitizedHtml: undefined,
      confidence: 0.95,
      strategy: 'plain',
      appliedHeuristics: [],
      warnings: [],
      tokens: {},
    });
    mocks.findTicketByReplyToken.mockResolvedValue(null);
    mocks.findTicketByEmailThread.mockResolvedValue(null);
    mocks.resolveInboundTicketDefaults.mockResolvedValue({
      client_id: 'client-id',
      board_id: 'board-id',
      status_id: 'status-id',
      priority_id: 'priority-id',
      entered_by: 'entered-by',
    });
    mocks.resolveEffectiveInboundTicketDefaults.mockResolvedValue({
      defaults: {
        client_id: 'client-id',
        board_id: 'board-id',
        status_id: 'status-id',
        priority_id: 'priority-id',
        entered_by: 'entered-by',
      },
      source: 'provider_default',
    });
    mocks.findContactByEmail.mockResolvedValue(null);
    mocks.findClientIdByInboundEmailDomain.mockResolvedValue(null);
    mocks.findValidClientPrimaryContactId.mockResolvedValue(null);
    mocks.findEmailProviderMailboxAddress.mockResolvedValue('support@example.com');
    mocks.upsertTicketWatchListRecipients.mockResolvedValue({ updated: true, watchList: [] });
    mocks.createTicketFromEmail.mockResolvedValue({ ticket_id: 'unexpected', ticket_number: 'T-0' });
    mocks.createCommentFromEmail.mockResolvedValue('inbound-comment-t044');
    mocks.processInboundEmailArtifactsBestEffort.mockResolvedValue(undefined);
  });

  it('T044: outbound Message-ID matched by inbound In-Reply-To lands in the originating comment thread', async () => {
    const tenantId = 'tenant-t044';
    const ticketId = 'ticket-t044';
    const threadId = 'thread-t044';
    const outboundCommentId = 'outbound-comment-t044';

    const clientId = 'client-t044';
    const boardId = 'board-t044';

    dbState.commentThreads.set(threadId, { thread_id: threadId, ticket_id: ticketId });
    dbState.comments.set(outboundCommentId, {
      comment_id: outboundCommentId,
      thread_id: threadId,
      parent_comment_id: null,
    });
    // The thread-header hijack guard quarantines thread-header matches from
    // senders that are not the ticket's client contact / internal user / active
    // watcher. This round trip is a legitimate reply from the ticket's own
    // client contact, so model the ticket (with its client) and resolve the
    // sender to that client's contact.
    dbState.tickets.set(ticketId, {
      ticket_id: ticketId,
      board_id: boardId,
      status_id: null,
      is_closed: false,
      closed_at: null,
      client_id: clientId,
      attributes: {},
    });
    dbState.boards.set(boardId, {
      inbound_reply_reopen_enabled: false,
      inbound_reply_reopen_cutoff_hours: 168,
      inbound_reply_reopen_status_id: null,
      inbound_reply_ai_ack_suppression_enabled: false,
    });
    mocks.findContactByEmail.mockResolvedValue({
      contact_id: 'contact-t044',
      user_type: 'client',
      client_id: clientId,
    });

    const service = new TestEmailService({
      providerId: 'test-provider',
      providerType: 'test',
      capabilities,
      async initialize() {
        // no-op
      },
      async sendEmail(_message: EmailMessage, _tenantId: string): Promise<EmailSendResult> {
        return {
          success: true,
          messageId: 'provider-message-t044',
          providerMessageId: 'provider-message-t044',
          providerId: 'test-provider',
          providerType: 'test',
          sentAt: new Date('2026-05-13T12:20:00.000Z'),
        };
      },
      async healthCheck() {
        return { healthy: true };
      },
    });

    const outbound = await service.sendEmail({
      tenantId,
      to: 'client@example.com',
      subject: 'Round trip',
      html: '<p>Round trip</p>',
      replyContext: {
        ticketId,
        commentId: outboundCommentId,
        threadId: 'provider-thread-t044',
        conversationToken: 'round-trip-token-t044',
      },
    });
    expect(outbound.success).toBe(true);

    const outboundLog = await waitForOutboundLog();
    const rfcMessageId = String(outboundLog.rfc_message_id);
    expect(outboundLog.comment_thread_id).toBe(threadId);

    const { processInboundEmailInApp } = await import(
      '@alga-psa/shared/services/email/processInboundEmailInApp'
    );
    const result = await processInboundEmailInApp({
      tenantId,
      providerId: 'provider-1',
      emailData: buildEmailData({
        tenant: tenantId,
        inReplyTo: rfcMessageId,
        references: [rfcMessageId],
      }),
    });

    expect(result).toMatchObject({
      outcome: 'replied',
      matchedBy: 'thread_headers',
      ticketId,
    });
    expect(mocks.createCommentFromEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket_id: ticketId,
        parent_comment_id: outboundCommentId,
        inboundReplyEvent: expect.objectContaining({
          matchedBy: 'thread_headers',
        }),
      }),
      tenantId,
    );
  });

  // --- Notification-loop suppression (cross-mailbox) ---------------------
  //
  // These round-trip tests send a REAL outbound notification through
  // BaseEmailService (producing a real `email_sending_logs` row with a real
  // SHA-256 reply-token hash — the same code path production traffic uses,
  // not a hand-rolled fixture), then feed a synthetic redelivery of that same
  // notification into processInboundEmailInApp and assert on the composite
  // predicate in notificationLoopDetection.ts. Deliberately no
  // inReplyTo/references/threadId are set on the inbound side, so a pass here
  // proves suppression does not depend on thread-header matching at all.

  async function sendRealNotification(params: {
    tenantId: string;
    ticketId: string;
    to: string;
    conversationToken: string;
  }) {
    const service = new TestEmailService({
      providerId: 'test-provider',
      providerType: 'test',
      capabilities,
      async initialize() {},
      async sendEmail(_message: EmailMessage, _tenantId: string): Promise<EmailSendResult> {
        return {
          success: true,
          messageId: `provider-message-${params.ticketId}`,
          providerMessageId: `provider-message-${params.ticketId}`,
          providerId: 'test-provider',
          providerType: 'test',
          sentAt: new Date('2026-05-13T12:20:00.000Z'),
        };
      },
      async healthCheck() {
        return { healthy: true };
      },
    });

    const outbound = await service.sendEmail({
      tenantId: params.tenantId,
      to: params.to,
      subject: 'Ticket Assigned: full template notification body',
      html: '<p>This ticket has been assigned to you. Full template text describing the assignment, the ticket details, and a link back into the portal.</p>',
      replyContext: {
        ticketId: params.ticketId,
        conversationToken: params.conversationToken,
      },
    });
    expect(outbound.success).toBe(true);
    return waitForOutboundLog();
  }

  it('T-loop-1: redelivery of our own outbound notification into a second connected mailbox in the same tenant is suppressed before any mutation', async () => {
    const tenantId = 'tenant-loop-1';
    const mailboxA = 'support@example.com'; // TestEmailService's fixed from-address
    const mailboxB = 'jamie@example.com'; // assignee/watcher whose address is ALSO a connected inbound mailbox

    await sendRealNotification({
      tenantId,
      ticketId: 'ticket-loop-1',
      to: mailboxB,
      conversationToken: 'loop-token-1',
    });

    mocks.parseEmailReplyBody.mockResolvedValue({
      sanitizedText: 'This ticket has been assigned to you. Full template text describing the assignment.',
      sanitizedHtml: undefined,
      confidence: 0.95,
      strategy: 'plain',
      appliedHeuristics: [],
      warnings: [],
      tokens: { conversationToken: 'loop-token-1' },
    });
    mocks.findEmailProviderMailboxAddress.mockResolvedValue(mailboxB);

    const { processInboundEmailInApp } = await import(
      '@alga-psa/shared/services/email/processInboundEmailInApp'
    );
    const result = await processInboundEmailInApp(
      {
        tenantId,
        providerId: 'provider-mailbox-b',
        emailData: buildEmailData({
          id: 'redelivered-notification-1',
          tenant: tenantId,
          from: { email: mailboxA, name: 'Support Mailbox' },
          to: [{ email: mailboxB }],
          subject: 'Ticket Assigned: full template notification body',
          body: {
            text: 'This ticket has been assigned to you. Full template text describing the assignment.',
            html: undefined,
          },
          // Deliberately no inReplyTo/references/threadId: suppression must not
          // depend on thread-header matching.
          inReplyTo: undefined,
          references: undefined,
          threadId: undefined,
        }),
      },
      { collectDiagnostics: true }
    );

    expect(result).toMatchObject({ outcome: 'skipped', reason: 'notification_loop' });
    expect(result.diagnostics?.threading.failureReason).toBe('notification_loop');
    expect(result.diagnostics?.notificationLoop?.tier).toBe('reply_token_ledger');
    expect(result.diagnostics?.notificationLoop?.evidence.senderMatchesLoggedFromAddress).toBe(true);
    expect(result.diagnostics?.notificationLoop?.evidence.recipientMatchedLoggedSend).toBe(true);

    expect(mocks.findTicketByReplyToken).not.toHaveBeenCalled();
    expect(mocks.findTicketByEmailThread).not.toHaveBeenCalled();
    expect(mocks.createTicketFromEmail).not.toHaveBeenCalled();
    expect(mocks.createCommentFromEmail).not.toHaveBeenCalled();
    expect(mocks.upsertTicketWatchListRecipients).not.toHaveBeenCalled();
  });

  it('T-loop-2: a ledger row from one tenant does not suppress an identical-looking message ingested under a different tenant', async () => {
    const mailboxA = 'support@example.com';
    const mailboxB = 'jamie@example.com';

    // Tenant A sends the real notification and gets a real ledger row.
    await sendRealNotification({
      tenantId: 'tenant-loop-iso-a',
      ticketId: 'ticket-iso-a',
      to: mailboxB,
      conversationToken: 'iso-shared-token',
    });

    // Tenant B ingests a message carrying the SAME token string, sender, and
    // recipient — the only difference is the tenant. If the ledger lookup
    // were not tenant-scoped, this would incorrectly match tenant A's row.
    mocks.parseEmailReplyBody.mockResolvedValue({
      sanitizedText: 'Full template text',
      sanitizedHtml: undefined,
      confidence: 0.95,
      strategy: 'plain',
      appliedHeuristics: [],
      warnings: [],
      tokens: { conversationToken: 'iso-shared-token' },
    });
    mocks.findEmailProviderMailboxAddress.mockResolvedValue(mailboxB);
    mocks.findTicketByReplyToken.mockResolvedValueOnce({ ticketId: 'ticket-iso-b' });

    const { processInboundEmailInApp } = await import(
      '@alga-psa/shared/services/email/processInboundEmailInApp'
    );
    const result = await processInboundEmailInApp({
      tenantId: 'tenant-loop-iso-b',
      providerId: 'provider-mailbox-b',
      emailData: buildEmailData({
        id: 'cross-tenant-message-1',
        tenant: 'tenant-loop-iso-b',
        from: { email: mailboxA, name: 'Support Mailbox' },
        to: [{ email: mailboxB }],
        subject: 'Ticket Assigned: full template notification body',
        body: { text: 'Full template text', html: undefined },
      }),
    });

    expect(result).toMatchObject({ outcome: 'replied', matchedBy: 'reply_token', ticketId: 'ticket-iso-b' });
    expect(mocks.createCommentFromEmail).toHaveBeenCalled();
  });

  it('T-loop-3: a genuine reply from the actual recipient, reusing the same reply token, is NOT suppressed', async () => {
    const mailboxA = 'support@example.com';
    const customer = 'client@example.com';

    await sendRealNotification({
      tenantId: 'tenant-loop-genuine',
      ticketId: 'ticket-genuine',
      to: customer,
      conversationToken: 'genuine-token-1',
    });

    // The customer hits reply: From is THEIR address, not our outbound
    // from_address, even though the quoted body still carries our token.
    mocks.parseEmailReplyBody.mockResolvedValue({
      sanitizedText: 'Thanks, that resolved it for me.',
      sanitizedHtml: undefined,
      confidence: 0.95,
      strategy: 'plain',
      appliedHeuristics: [],
      warnings: [],
      tokens: { conversationToken: 'genuine-token-1' },
    });
    mocks.findEmailProviderMailboxAddress.mockResolvedValue(mailboxA);
    mocks.findTicketByReplyToken.mockResolvedValueOnce({ ticketId: 'ticket-genuine' });
    mocks.findContactByEmail.mockResolvedValueOnce({
      contact_id: 'contact-genuine',
      user_type: 'client',
      client_id: 'client-genuine',
      email: customer,
    });

    const { processInboundEmailInApp } = await import(
      '@alga-psa/shared/services/email/processInboundEmailInApp'
    );
    const result = await processInboundEmailInApp({
      tenantId: 'tenant-loop-genuine',
      providerId: 'provider-mailbox-a',
      emailData: buildEmailData({
        id: 'genuine-reply-1',
        tenant: 'tenant-loop-genuine',
        from: { email: customer, name: 'Client User' },
        to: [{ email: mailboxA }],
        subject: 'Re: Ticket Assigned: full template notification body',
        body: { text: 'Thanks, that resolved it for me.', html: undefined },
      }),
    });

    expect(result).toMatchObject({ outcome: 'replied', matchedBy: 'reply_token', ticketId: 'ticket-genuine' });
    expect(mocks.createCommentFromEmail).toHaveBeenCalledTimes(1);
    expect(mocks.createCommentFromEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket_id: 'ticket-genuine',
        author_type: 'contact',
        contact_id: 'contact-genuine',
      }),
      'tenant-loop-genuine',
    );
  });
});
