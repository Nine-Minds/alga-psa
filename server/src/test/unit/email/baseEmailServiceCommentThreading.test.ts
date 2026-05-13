import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailMessage, EmailProviderCapabilities, EmailSendResult, IEmailProvider } from '@alga-psa/types';

type Criteria = Record<string, unknown>;

const dbState = vi.hoisted(() => ({
  commentRows: new Map<string, { thread_id: string | null; parent_comment_id: string | null }>(),
  latestOutboundRows: new Map<string, { rfc_message_id: string | null }>(),
  threadRows: new Map<string, { email_references: string[] | null }>(),
  insertedLogs: [] as Record<string, unknown>[],
  threadUpdates: [] as Array<{ where: Criteria; patch: Record<string, unknown> }>,
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
}));

function makeQueryBuilder(table: string) {
  const whereCriteria: Criteria = {};
  const builder = {
    select: vi.fn(() => builder),
    where: vi.fn((criteria: Criteria) => {
      Object.assign(whereCriteria, criteria);
      return builder;
    }),
    whereNotNull: vi.fn(() => builder),
    orderBy: vi.fn(() => builder),
    first: vi.fn(async () => {
      if (table === 'comments') {
        const commentId = String(whereCriteria.comment_id ?? '');
        return dbState.commentRows.get(commentId) ?? null;
      }
      if (table === 'email_sending_logs') {
        const threadId = String(whereCriteria.comment_thread_id ?? '');
        return dbState.latestOutboundRows.get(threadId) ?? null;
      }
      if (table === 'comment_threads') {
        const threadId = String(whereCriteria.thread_id ?? '');
        return dbState.threadRows.get(threadId) ?? null;
      }
      return null;
    }),
    insert: vi.fn(async (row: Record<string, unknown>) => {
      if (table === 'email_sending_logs') {
        dbState.insertedLogs.push(row);
      }
      return [1];
    }),
    update: vi.fn(async (patch: Record<string, unknown>) => {
      if (table === 'comment_threads') {
        dbState.threadUpdates.push({ where: { ...whereCriteria }, patch });
      }
      return 1;
    }),
  };
  return builder;
}

import { BaseEmailService } from '@alga-psa/email/BaseEmailService';

const capabilities: EmailProviderCapabilities = {
  supportsHtml: true,
  supportsAttachments: false,
  supportsTemplating: false,
  supportsBulkSending: false,
  supportsTracking: false,
  supportsCustomDomains: false,
};

class TestEmailService extends BaseEmailService {
  constructor(private readonly provider: IEmailProvider) {
    super();
  }

  protected async getEmailProvider(): Promise<IEmailProvider | null> {
    return this.provider;
  }

  protected getFromAddress(): string {
    return 'from@example.com';
  }

  protected getServiceName(): string {
    return 'TestEmailService';
  }
}

async function waitForThreadUpdate(timeoutMs = 500) {
  const startedAt = Date.now();
  while (dbState.threadUpdates.length === 0) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for comment_threads update');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function waitForInsertedLog(timeoutMs = 500) {
  const startedAt = Date.now();
  while (dbState.insertedLogs.length === 0) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for email_sending_logs insert');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return dbState.insertedLogs[0];
}

describe('BaseEmailService comment thread outbound headers', () => {
  beforeEach(() => {
    dbState.commentRows.clear();
    dbState.latestOutboundRows.clear();
    dbState.threadRows.clear();
    dbState.insertedLogs.length = 0;
    dbState.threadUpdates.length = 0;
  });

  it('T039: top-level comment send generates Message-ID, omits In-Reply-To, and stores it on the thread', async () => {
    const tenantId = 'tenant-t039';
    const commentId = 'comment-t039';
    const threadId = 'thread-t039';
    let capturedMessage: EmailMessage | null = null;

    dbState.commentRows.set(commentId, {
      thread_id: threadId,
      parent_comment_id: null,
    });

    const provider: IEmailProvider = {
      providerId: 'test-provider',
      providerType: 'test',
      capabilities,
      async initialize() {
        // no-op
      },
      async sendEmail(message: EmailMessage, _tenantId: string): Promise<EmailSendResult> {
        capturedMessage = message;
        return {
          success: true,
          messageId: 'provider-message-t039',
          providerMessageId: 'provider-message-t039',
          providerId: 'test-provider',
          providerType: 'test',
          sentAt: new Date('2026-05-13T12:00:00.000Z'),
        };
      },
      async healthCheck() {
        return { healthy: true };
      },
    };

    const service = new TestEmailService(provider);
    const result = await service.sendEmail({
      tenantId,
      to: 'client@example.com',
      subject: 'Top-level comment',
      html: '<p>Top-level comment</p>',
      replyContext: {
        ticketId: 'ticket-t039',
        commentId,
        threadId: 'provider-thread-t039',
      },
    });

    expect(result.success).toBe(true);
    expect(capturedMessage?.headers?.['Message-ID']).toMatch(/^<.+@tenant-t039\.alga-psa\.local>$/);
    expect(capturedMessage?.headers).not.toHaveProperty('In-Reply-To');
    expect(capturedMessage?.headers).not.toHaveProperty('References');
    expect(result.rfcMessageId).toBe(capturedMessage?.headers?.['Message-ID']);

    await waitForThreadUpdate();

    expect(dbState.threadUpdates).toContainEqual({
      where: { tenant: tenantId, thread_id: threadId },
      patch: {
        email_message_id: capturedMessage?.headers?.['Message-ID'],
        email_provider_thread_id: 'provider-thread-t039',
      },
    });
  });

  it('T040: reply send sets In-Reply-To from the latest outbound message in the comment thread', async () => {
    const tenantId = 'tenant-t040';
    const commentId = 'comment-t040';
    const threadId = 'thread-t040';
    const previousMessageId = '<previous-t040@example.test>';
    let capturedMessage: EmailMessage | null = null;

    dbState.commentRows.set(commentId, {
      thread_id: threadId,
      parent_comment_id: 'parent-comment-t040',
    });
    dbState.latestOutboundRows.set(threadId, {
      rfc_message_id: previousMessageId,
    });
    dbState.threadRows.set(threadId, {
      email_references: [],
    });

    const provider: IEmailProvider = {
      providerId: 'test-provider',
      providerType: 'test',
      capabilities,
      async initialize() {
        // no-op
      },
      async sendEmail(message: EmailMessage, _tenantId: string): Promise<EmailSendResult> {
        capturedMessage = message;
        return {
          success: true,
          messageId: 'provider-message-t040',
          providerMessageId: 'provider-message-t040',
          providerId: 'test-provider',
          providerType: 'test',
          sentAt: new Date('2026-05-13T12:05:00.000Z'),
        };
      },
      async healthCheck() {
        return { healthy: true };
      },
    };

    const service = new TestEmailService(provider);
    const result = await service.sendEmail({
      tenantId,
      to: 'client@example.com',
      subject: 'Reply comment',
      html: '<p>Reply comment</p>',
      replyContext: {
        ticketId: 'ticket-t040',
        commentId,
        threadId: 'provider-thread-t040',
      },
    });

    expect(result.success).toBe(true);
    expect(capturedMessage?.headers?.['In-Reply-To']).toBe(previousMessageId);
    expect(capturedMessage?.headers?.['Message-ID']).toMatch(/^<.+@tenant-t040\.alga-psa\.local>$/);
  });

  it('T041: reply send appends previous Message-ID to References and persists the chain', async () => {
    const tenantId = 'tenant-t041';
    const commentId = 'comment-t041';
    const threadId = 'thread-t041';
    const storedReferences = ['<root-t041@example.test>', '<middle-t041@example.test>'];
    const previousMessageId = '<latest-t041@example.test>';
    let capturedMessage: EmailMessage | null = null;

    dbState.commentRows.set(commentId, {
      thread_id: threadId,
      parent_comment_id: 'parent-comment-t041',
    });
    dbState.latestOutboundRows.set(threadId, {
      rfc_message_id: previousMessageId,
    });
    dbState.threadRows.set(threadId, {
      email_references: storedReferences,
    });

    const provider: IEmailProvider = {
      providerId: 'test-provider',
      providerType: 'test',
      capabilities,
      async initialize() {
        // no-op
      },
      async sendEmail(message: EmailMessage, _tenantId: string): Promise<EmailSendResult> {
        capturedMessage = message;
        return {
          success: true,
          messageId: 'provider-message-t041',
          providerMessageId: 'provider-message-t041',
          providerId: 'test-provider',
          providerType: 'test',
          sentAt: new Date('2026-05-13T12:10:00.000Z'),
        };
      },
      async healthCheck() {
        return { healthy: true };
      },
    };

    const service = new TestEmailService(provider);
    const result = await service.sendEmail({
      tenantId,
      to: 'client@example.com',
      subject: 'Reply with references',
      html: '<p>Reply with references</p>',
      replyContext: {
        ticketId: 'ticket-t041',
        commentId,
        threadId: 'provider-thread-t041',
      },
    });

    const expectedReferences = [...storedReferences, previousMessageId];

    expect(result.success).toBe(true);
    expect(capturedMessage?.headers?.References).toBe(expectedReferences.join(' '));
    expect(dbState.threadUpdates).toContainEqual({
      where: { tenant: tenantId, thread_id: threadId },
      patch: {
        email_references: expectedReferences,
      },
    });
  });

  it('T043: email_sending_logs row stores comment thread, RFC Message-ID, provider id, and reply token hash', async () => {
    const tenantId = 'tenant-t043';
    const commentId = 'comment-t043';
    const threadId = 'thread-t043';
    const conversationToken = 'conversation-token-t043';
    const providerMessageId = 'provider-message-t043';

    dbState.commentRows.set(commentId, {
      thread_id: threadId,
      parent_comment_id: null,
    });

    const provider: IEmailProvider = {
      providerId: 'test-provider',
      providerType: 'test',
      capabilities,
      async initialize() {
        // no-op
      },
      async sendEmail(_message: EmailMessage, _tenantId: string): Promise<EmailSendResult> {
        return {
          success: true,
          messageId: providerMessageId,
          providerMessageId,
          providerId: 'test-provider',
          providerType: 'test',
          sentAt: new Date('2026-05-13T12:15:00.000Z'),
        };
      },
      async healthCheck() {
        return { healthy: true };
      },
    };

    const service = new TestEmailService(provider);
    const result = await service.sendEmail({
      tenantId,
      to: 'client@example.com',
      subject: 'Logged comment',
      html: '<p>Logged comment</p>',
      replyContext: {
        ticketId: 'ticket-t043',
        commentId,
        threadId: 'provider-thread-t043',
        conversationToken,
      },
    });

    expect(result.success).toBe(true);

    const log = await waitForInsertedLog();

    expect(log).toMatchObject({
      tenant: tenantId,
      message_id: providerMessageId,
      provider_message_id: providerMessageId,
      provider_id: 'test-provider',
      provider_type: 'test',
      thread_id: 'provider-thread-t043',
      comment_thread_id: threadId,
      comment_id: commentId,
      reply_token_suffix: conversationToken.slice(-8),
    });
    expect(log.rfc_message_id).toMatch(/^<.+@tenant-t043\.alga-psa\.local>$/);
    expect(log.reply_token_hash).toEqual(expect.stringMatching(/^[a-f0-9]{64}$/));
  });
});
