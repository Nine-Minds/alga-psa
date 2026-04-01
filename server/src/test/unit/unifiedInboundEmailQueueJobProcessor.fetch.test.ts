import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedInboundEmailQueueJob } from '@alga-psa/shared/interfaces/inbound-email.interfaces';

const getAdminConnectionMock = vi.fn();
const processInboundEmailInAppMock = vi.fn();
const microsoftConnectMock = vi.fn();
const microsoftDownloadMessageSourceMock = vi.fn();
const microsoftGetMessageDetailsMock = vi.fn();
const gmailConnectMock = vi.fn();
const gmailListMessagesSinceMock = vi.fn();
const gmailGetMessageDetailsMock = vi.fn();
const simpleParserMock = vi.fn();
const imapConnectMock = vi.fn();
const imapGetMailboxLockMock = vi.fn();
const imapFetchMock = vi.fn();
const imapLogoutMock = vi.fn();
const imapCloseMock = vi.fn();
const getTenantSecretMock = vi.fn();

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: (...args: any[]) => getAdminConnectionMock(...args),
}));

vi.mock('@alga-psa/shared/services/email/processInboundEmailInApp', () => ({
  processInboundEmailInApp: (...args: any[]) => processInboundEmailInAppMock(...args),
}));

vi.mock('@alga-psa/shared/services/email/providers/MicrosoftGraphAdapter', () => ({
  MicrosoftGraphAdapter: class MicrosoftGraphAdapter {
    connect(...args: any[]) {
      return microsoftConnectMock(...args);
    }
    downloadMessageSource(...args: any[]) {
      return microsoftDownloadMessageSourceMock(...args);
    }
    getMessageDetails(...args: any[]) {
      return microsoftGetMessageDetailsMock(...args);
    }
  },
}));

vi.mock('@alga-psa/shared/services/email/providers/GmailAdapter', () => ({
  GmailAdapter: class GmailAdapter {
    connect(...args: any[]) {
      return gmailConnectMock(...args);
    }
    listMessagesSince(...args: any[]) {
      return gmailListMessagesSinceMock(...args);
    }
    getMessageDetails(...args: any[]) {
      return gmailGetMessageDetailsMock(...args);
    }
  },
}));

vi.mock('mailparser', () => ({
  simpleParser: (...args: any[]) => simpleParserMock(...args),
}));

vi.mock('imapflow', () => ({
  ImapFlow: class ImapFlow {
    on() {}
    connect(...args: any[]) {
      return imapConnectMock(...args);
    }
    getMailboxLock(...args: any[]) {
      return imapGetMailboxLockMock(...args);
    }
    fetch(...args: any[]) {
      return imapFetchMock(...args);
    }
    logout(...args: any[]) {
      return imapLogoutMock(...args);
    }
    close(...args: any[]) {
      return imapCloseMock(...args);
    }
  },
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getTenantSecret: (...args: any[]) => getTenantSecretMock(...args),
  }),
}));

function createDbMock(params: {
  microsoftRow?: any;
  googleProviderRow?: any;
  googleConfigRow?: any;
  imapRow?: any;
}) {
  const emailProcessedInsertMock = vi.fn(async () => undefined);
  const emailProcessedUpdateMock = vi.fn(async () => 1);
  const googleConfigUpdateMock = vi.fn(async () => 1);

  const db = vi.fn((table: string) => {
    if (table === 'microsoft_email_provider_config as mc') {
      const builder = {
        join() {
          return builder;
        },
        where() {
          return builder;
        },
        andWhere() {
          return builder;
        },
        async first() {
          return params.microsoftRow || null;
        },
      };
      return builder;
    }

    if (table === 'email_providers') {
      const builder = {
        where() {
          return builder;
        },
        andWhere() {
          return builder;
        },
        async first() {
          return params.googleProviderRow || null;
        },
      };
      return builder;
    }

    if (table === 'google_email_provider_config') {
      const builder = {
        where() {
          return builder;
        },
        async first() {
          return params.googleConfigRow || null;
        },
        async update(...args: any[]) {
          return googleConfigUpdateMock(...args);
        },
      };
      return builder;
    }

    if (table === 'imap_email_provider_config as ic') {
      const builder = {
        join() {
          return builder;
        },
        where() {
          return builder;
        },
        andWhere() {
          return builder;
        },
        async first() {
          return params.imapRow || null;
        },
      };
      return builder;
    }

    if (table === 'email_processed_messages') {
      return {
        insert: (...args: any[]) => emailProcessedInsertMock(...args),
        where: () => ({
          update: (...args: any[]) => emailProcessedUpdateMock(...args),
        }),
      };
    }

    throw new Error(`Unexpected table access in test: ${table}`);
  }) as any;

  db.raw = (value: string) => value;
  db.fn = {
    now: () => new Date().toISOString(),
  };

  return { db, emailProcessedInsertMock, emailProcessedUpdateMock, googleConfigUpdateMock };
}

describe('unified inbound queue processor consume-time provider fetch', () => {
  beforeEach(() => {
    getAdminConnectionMock.mockReset();
    processInboundEmailInAppMock.mockReset();
    microsoftConnectMock.mockReset();
    microsoftDownloadMessageSourceMock.mockReset();
    microsoftGetMessageDetailsMock.mockReset();
    gmailConnectMock.mockReset();
    gmailListMessagesSinceMock.mockReset();
    gmailGetMessageDetailsMock.mockReset();
    simpleParserMock.mockReset();
    imapConnectMock.mockReset();
    imapGetMailboxLockMock.mockReset();
    imapFetchMock.mockReset();
    imapLogoutMock.mockReset();
    imapCloseMock.mockReset();
    getTenantSecretMock.mockReset();

    processInboundEmailInAppMock.mockResolvedValue({
      outcome: 'created',
      ticketId: 'ticket-1',
      commentId: 'comment-1',
    });

    imapConnectMock.mockResolvedValue(undefined);
    imapGetMailboxLockMock.mockResolvedValue({ release: vi.fn() });
    imapLogoutMock.mockResolvedValue(undefined);
    imapCloseMock.mockResolvedValue(undefined);
    getTenantSecretMock.mockResolvedValue('password-1');
  });

  it('T012: Microsoft pointer fetch resolves full email payload before processing', async () => {
    const { db } = createDbMock({
      microsoftRow: {
        id: 'provider-ms-1',
        tenant: 'tenant-1',
        mailbox: 'support@example.com',
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });
    getAdminConnectionMock.mockResolvedValue(db);

    const rawMimeBuffer = Buffer.from('microsoft raw mime payload');
    microsoftDownloadMessageSourceMock.mockResolvedValue(rawMimeBuffer);
    simpleParserMock.mockResolvedValue({
      messageId: '<ms-msg-1@example.com>',
      date: new Date('2026-03-01T00:00:00.000Z'),
      from: { value: [{ address: 'sender@example.com', name: 'Sender' }] },
      to: { value: [{ address: 'support@example.com', name: 'Support' }] },
      cc: { value: [] },
      subject: 'Microsoft Subject',
      text: 'Microsoft Body',
      html: '<p>Microsoft Body<img src="cid:inline-image-1" /></p>',
      attachments: [
        {
          contentId: 'inline-image-1',
          filename: 'image.png',
          contentType: 'image/png',
          size: 4,
          contentDisposition: 'inline',
          content: Buffer.from('png!'),
        },
      ],
    });

    const { processUnifiedInboundEmailQueueJob } = await import(
      '../../services/email/unifiedInboundEmailQueueJobProcessor'
    );
    const result = await processUnifiedInboundEmailQueueJob({
      jobId: 'job-ms-1',
      schemaVersion: 1,
      tenantId: 'tenant-1',
      providerId: 'provider-ms-1',
      provider: 'microsoft',
      pointer: {
        subscriptionId: 'sub-ms-1',
        messageId: 'ms-msg-1',
        resource: '/users/user/messages/ms-msg-1',
        changeType: 'created',
      },
      enqueuedAt: new Date().toISOString(),
      attempt: 0,
      maxAttempts: 5,
    } as UnifiedInboundEmailQueueJob);

    expect(result).toMatchObject({
      outcome: 'processed',
      processedCount: 1,
      dedupedCount: 0,
    });
    expect(microsoftConnectMock).toHaveBeenCalledTimes(1);
    expect(microsoftDownloadMessageSourceMock).toHaveBeenCalledWith('ms-msg-1');
    expect(microsoftGetMessageDetailsMock).not.toHaveBeenCalled();
    expect(simpleParserMock).toHaveBeenCalledWith(rawMimeBuffer);
    const processedEmail = processInboundEmailInAppMock.mock.calls[0][0].emailData;
    expect(processedEmail).toMatchObject({
      id: '<ms-msg-1@example.com>',
      subject: 'Microsoft Subject',
      rawMimeBase64: rawMimeBuffer.toString('base64'),
    });
    expect(processedEmail.attachments).toEqual([
      expect.objectContaining({
        contentId: 'inline-image-1',
        isInline: true,
        content: Buffer.from('png!').toString('base64'),
      }),
    ]);
  });

  it('T013: Google pointer fetch resolves full email payload before processing', async () => {
    const { db, googleConfigUpdateMock } = createDbMock({
      googleProviderRow: {
        id: 'provider-g-1',
        tenant: 'tenant-1',
        mailbox: 'support@example.com',
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      googleConfigRow: {
        email_provider_id: 'provider-g-1',
        tenant: 'tenant-1',
        project_id: 'project-1',
        history_id: '40',
      },
    });
    getAdminConnectionMock.mockResolvedValue(db);

    gmailListMessagesSinceMock.mockResolvedValue(['g-msg-1']);
    gmailGetMessageDetailsMock.mockResolvedValue({
      id: 'g-msg-1',
      provider: 'google',
      providerId: 'provider-g-1',
      tenant: 'tenant-1',
      receivedAt: new Date().toISOString(),
      from: { email: 'sender@example.com' },
      to: [{ email: 'support@example.com' }],
      subject: 'Google Subject',
      body: { text: 'Body', html: '<p>Body</p>' },
      attachments: [],
    } as any);

    const { processUnifiedInboundEmailQueueJob } = await import(
      '../../services/email/unifiedInboundEmailQueueJobProcessor'
    );
    const result = await processUnifiedInboundEmailQueueJob({
      jobId: 'job-g-1',
      schemaVersion: 1,
      tenantId: 'tenant-1',
      providerId: 'provider-g-1',
      provider: 'google',
      pointer: {
        historyId: '41',
        emailAddress: 'support@example.com',
      },
      enqueuedAt: new Date().toISOString(),
      attempt: 0,
      maxAttempts: 5,
    } as UnifiedInboundEmailQueueJob);

    expect(result).toMatchObject({
      outcome: 'processed',
      processedCount: 1,
      dedupedCount: 0,
    });
    expect(gmailConnectMock).toHaveBeenCalledTimes(1);
    expect(gmailListMessagesSinceMock).toHaveBeenCalledWith('40');
    expect(gmailGetMessageDetailsMock).toHaveBeenCalledWith('g-msg-1');
    expect(googleConfigUpdateMock).toHaveBeenCalledTimes(1);
    expect(processInboundEmailInAppMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        providerId: 'provider-g-1',
        emailData: expect.objectContaining({
          id: 'g-msg-1',
          subject: 'Google Subject',
        }),
      })
    );
  });

  it('T013b: Google history cursor is not advanced when processing fails', async () => {
    const { db, googleConfigUpdateMock } = createDbMock({
      googleProviderRow: {
        id: 'provider-g-1',
        tenant: 'tenant-1',
        mailbox: 'support@example.com',
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      googleConfigRow: {
        email_provider_id: 'provider-g-1',
        tenant: 'tenant-1',
        project_id: 'project-1',
        history_id: '40',
      },
    });
    getAdminConnectionMock.mockResolvedValue(db);

    gmailListMessagesSinceMock.mockResolvedValue(['g-msg-1']);
    gmailGetMessageDetailsMock.mockResolvedValue({
      id: 'g-msg-1',
      provider: 'google',
      providerId: 'provider-g-1',
      tenant: 'tenant-1',
      receivedAt: new Date().toISOString(),
      from: { email: 'sender@example.com' },
      to: [{ email: 'support@example.com' }],
      subject: 'Google Subject',
      body: { text: 'Body', html: '<p>Body</p>' },
      attachments: [],
    } as any);
    processInboundEmailInAppMock.mockRejectedValueOnce(new Error('processing failed'));

    const { processUnifiedInboundEmailQueueJob } = await import(
      '../../services/email/unifiedInboundEmailQueueJobProcessor'
    );

    await expect(
      processUnifiedInboundEmailQueueJob({
        jobId: 'job-g-1b',
        schemaVersion: 1,
        tenantId: 'tenant-1',
        providerId: 'provider-g-1',
        provider: 'google',
        pointer: {
          historyId: '41',
          emailAddress: 'support@example.com',
        },
        enqueuedAt: new Date().toISOString(),
        attempt: 0,
        maxAttempts: 5,
      } as UnifiedInboundEmailQueueJob)
    ).rejects.toThrow('processing failed');

    expect(googleConfigUpdateMock).not.toHaveBeenCalled();
  });

  it('T014: IMAP pointer fetch resolves full email payload before processing', async () => {
    const { db } = createDbMock({
      imapRow: {
        id: 'provider-imap-1',
        tenant: 'tenant-1',
        mailbox: 'support@example.com',
        host: 'imap.example.com',
        port: 993,
        secure: true,
        allow_starttls: false,
        auth_type: 'password',
        username: 'imap-user',
        access_token: null,
      },
    });
    getAdminConnectionMock.mockResolvedValue(db);

    imapFetchMock.mockReturnValue(
      (async function* () {
        yield {
          uid: 300,
          source: Buffer.from('raw mime payload'),
        };
      })()
    );

    simpleParserMock.mockResolvedValue({
      messageId: '<imap-msg-300@example.com>',
      date: new Date('2026-03-01T00:00:00.000Z'),
      from: { value: [{ address: 'sender@example.com', name: 'Sender' }] },
      to: { value: [{ address: 'support@example.com', name: 'Support' }] },
      cc: { value: [] },
      subject: 'IMAP Subject',
      text: 'IMAP Body',
      html: '<p>IMAP Body</p>',
      references: ['<thread-1@example.com>'],
      inReplyTo: '<reply-1@example.com>',
      attachments: [],
    });

    const { processUnifiedInboundEmailQueueJob } = await import(
      '../../services/email/unifiedInboundEmailQueueJobProcessor'
    );
    const result = await processUnifiedInboundEmailQueueJob({
      jobId: 'job-imap-1',
      schemaVersion: 1,
      tenantId: 'tenant-1',
      providerId: 'provider-imap-1',
      provider: 'imap',
      pointer: {
        mailbox: 'INBOX',
        uid: '300',
        uidValidity: '400',
      },
      enqueuedAt: new Date().toISOString(),
      attempt: 0,
      maxAttempts: 5,
    } as UnifiedInboundEmailQueueJob);

    expect(result).toMatchObject({
      outcome: 'processed',
      processedCount: 1,
      dedupedCount: 0,
    });
    expect(imapConnectMock).toHaveBeenCalledTimes(1);
    expect(simpleParserMock).toHaveBeenCalledTimes(1);
    expect(processInboundEmailInAppMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        providerId: 'provider-imap-1',
        emailData: expect.objectContaining({
          id: '<imap-msg-300@example.com>',
          subject: 'IMAP Subject',
          rawMimeBase64: expect.any(String),
        }),
      })
    );
  });

  it('T015: first consume processes and persists consume-time idempotency marker', async () => {
    const { db, emailProcessedInsertMock } = createDbMock({
      microsoftRow: {
        id: 'provider-ms-1',
        tenant: 'tenant-1',
        mailbox: 'support@example.com',
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });
    getAdminConnectionMock.mockResolvedValue(db);

    microsoftDownloadMessageSourceMock.mockResolvedValue(Buffer.from('idempotent microsoft mime'));
    simpleParserMock.mockResolvedValue({
      messageId: '<ms-idempotent-1@example.com>',
      date: new Date('2026-03-01T00:00:00.000Z'),
      from: { value: [{ address: 'sender@example.com' }] },
      to: { value: [{ address: 'support@example.com' }] },
      cc: { value: [] },
      subject: 'Idempotent Subject',
      text: 'Body',
      html: '<p>Body</p>',
      attachments: [],
    });

    const { processUnifiedInboundEmailQueueJob } = await import(
      '../../services/email/unifiedInboundEmailQueueJobProcessor'
    );
    const result = await processUnifiedInboundEmailQueueJob({
      jobId: 'job-ms-idempotent-1',
      schemaVersion: 1,
      tenantId: 'tenant-1',
      providerId: 'provider-ms-1',
      provider: 'microsoft',
      pointer: {
        subscriptionId: 'sub-ms-1',
        messageId: 'ms-idempotent-1',
      },
      enqueuedAt: new Date().toISOString(),
      attempt: 0,
      maxAttempts: 5,
    } as UnifiedInboundEmailQueueJob);

    expect(result).toMatchObject({
      outcome: 'processed',
      processedCount: 1,
      dedupedCount: 0,
    });
    expect(emailProcessedInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message_id: 'microsoft:<ms-idempotent-1@example.com>',
        provider_id: 'provider-ms-1',
        tenant: 'tenant-1',
        processing_status: 'processing',
      })
    );
    expect(processInboundEmailInAppMock).toHaveBeenCalledTimes(1);
  });

  it('T016: duplicate consume of the same normalized identity no-ops downstream processing', async () => {
    const { db, emailProcessedInsertMock } = createDbMock({
      microsoftRow: {
        id: 'provider-ms-1',
        tenant: 'tenant-1',
        mailbox: 'support@example.com',
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });
    getAdminConnectionMock.mockResolvedValue(db);

    emailProcessedInsertMock.mockRejectedValueOnce({ code: '23505' });
    microsoftDownloadMessageSourceMock.mockResolvedValue(Buffer.from('duplicate microsoft mime'));
    simpleParserMock.mockResolvedValue({
      messageId: '<ms-idempotent-dup-1@example.com>',
      date: new Date('2026-03-01T00:00:00.000Z'),
      from: { value: [{ address: 'sender@example.com' }] },
      to: { value: [{ address: 'support@example.com' }] },
      cc: { value: [] },
      subject: 'Duplicate Subject',
      text: 'Body',
      html: '<p>Body</p>',
      attachments: [],
    });

    const { processUnifiedInboundEmailQueueJob } = await import(
      '../../services/email/unifiedInboundEmailQueueJobProcessor'
    );
    const result = await processUnifiedInboundEmailQueueJob({
      jobId: 'job-ms-idempotent-dup-1',
      schemaVersion: 1,
      tenantId: 'tenant-1',
      providerId: 'provider-ms-1',
      provider: 'microsoft',
      pointer: {
        subscriptionId: 'sub-ms-1',
        messageId: 'ms-idempotent-dup-1',
      },
      enqueuedAt: new Date().toISOString(),
      attempt: 0,
      maxAttempts: 5,
    } as UnifiedInboundEmailQueueJob);

    expect(result).toMatchObject({
      outcome: 'skipped',
      processedCount: 0,
      dedupedCount: 1,
      skippedCount: 1,
    });
    expect(processInboundEmailInAppMock).not.toHaveBeenCalled();
  });

  it('T023: source-unavailable IMAP pointer is marked skipped with deterministic reason', async () => {
    const { db, emailProcessedInsertMock } = createDbMock({
      imapRow: {
        id: 'provider-imap-1',
        tenant: 'tenant-1',
        mailbox: 'support@example.com',
        host: 'imap.example.com',
        port: 993,
        secure: true,
        allow_starttls: false,
        auth_type: 'password',
        username: 'imap-user',
        access_token: null,
      },
    });
    getAdminConnectionMock.mockResolvedValue(db);

    imapFetchMock.mockReturnValue((async function* () {})());

    const { processUnifiedInboundEmailQueueJob } = await import(
      '../../services/email/unifiedInboundEmailQueueJobProcessor'
    );
    const result = await processUnifiedInboundEmailQueueJob({
      jobId: 'job-imap-missing-1',
      schemaVersion: 1,
      tenantId: 'tenant-1',
      providerId: 'provider-imap-1',
      provider: 'imap',
      pointer: {
        mailbox: 'INBOX',
        uid: '301',
      },
      enqueuedAt: new Date().toISOString(),
      attempt: 0,
      maxAttempts: 5,
    } as UnifiedInboundEmailQueueJob);

    expect(result).toMatchObject({
      outcome: 'skipped',
      processedCount: 0,
      skippedCount: 1,
      reason: 'source_unavailable:imap_message_not_found',
    });
    expect(emailProcessedInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message_id: 'imap:uid:301',
        processing_status: 'processing',
      })
    );
    expect(processInboundEmailInAppMock).not.toHaveBeenCalled();
  });
});
