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
    where: vi.fn((criteria: Criteria) => {
      if (typeof criteria === 'object') {
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

      if (table === 'comment_threads') {
        const threadId = String(whereCriteria.thread_id ?? '');
        const row = dbState.commentThreads.get(threadId);
        return row ? { ticketId: row.ticket_id, threadId: row.thread_id } : null;
      }

      if (table === 'email_sending_logs') {
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

    dbState.commentThreads.set(threadId, { thread_id: threadId, ticket_id: ticketId });
    dbState.comments.set(outboundCommentId, {
      comment_id: outboundCommentId,
      thread_id: threadId,
      parent_comment_id: null,
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
});
