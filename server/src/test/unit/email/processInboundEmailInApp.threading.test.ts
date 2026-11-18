import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailMessageDetails } from '@alga-psa/shared/interfaces/inbound-email.interfaces';

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
    // Provider-fetched mail always carries the receiving MTA's
    // Authentication-Results; contact attribution now needs an aligned pass.
    // Aligned to the default From domain only, so overrides that forge a
    // different sender stay unauthenticated.
    headers: {
      'Authentication-Results':
        'mx.google.com; dkim=pass header.d=example.com; spf=pass smtp.mailfrom=client@example.com',
    },
    ...overrides,
  };
}

function makeQueryBuilder(firstResult: unknown) {
  const builder: any = {
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    whereIn: vi.fn().mockReturnThis(),
    whereRaw: vi.fn().mockReturnThis(),
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

/**
 * email_sending_logs stub for the batched outbound-id lookup: records the forms bound to the
 * `rfc_message_id = ANY(?)` predicate and resolves (as an array) to rows built by `rowFor(forms)`.
 * `queries` counts every query issued against the table.
 */
const logQueries = { count: 0 };
function makeLogsBuilder(rowFor: (forms: string[]) => Record<string, unknown> | undefined) {
  logQueries.count += 1;
  let forms: string[] = [];
  const builder: any = {
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhereRaw: vi.fn().mockReturnThis(),
    whereNotNull: vi.fn().mockReturnThis(),
    whereRaw: vi.fn((sql: string, bindings?: unknown[]) => {
      if (sql.includes('rfc_message_id = ANY(?)')) forms = (bindings?.[0] as string[]) ?? [];
      return builder;
    }),
    orderBy: vi.fn().mockReturnThis(),
    whereIn: vi.fn().mockReturnThis(),
    // notificationLoopDetection awaits `.first()`; header lookups await the builder for rows.
    first: vi.fn().mockResolvedValue(undefined),
    then: (resolve: any, reject: any) => {
      const row = rowFor(forms);
      const bracketed = forms.find((f) => f.startsWith('<'));
      return Promise.resolve(row ? [{ rfc_message_id: bracketed, ...row }] : []).then(resolve, reject);
    },
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
vi.mock('@alga-psa/shared/lib/notificationAudience', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/shared/lib/notificationAudience')>()),
  resolveInboundReplyAudience: vi.fn(async () => ({ seat: false })),
}));

vi.mock('@alga-psa/shared/workflow/actions/emailWorkflowActions', () => ({
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
    findContactByEmailMock.mockResolvedValue({
      contact_id: 'client-contact-1',
      client_id: 'client-1',
      email: 'client@example.com',
      matched_email: 'client@example.com',
      user_type: 'client',
    });
    findInboundEmailDomainMappingMock.mockResolvedValue(null);
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
        if (table === 'tickets as t' || table === 'comments as c') {
          return makeQueryBuilder(undefined);
        }

        if (table === 'tickets') {
          return makeQueryBuilder({
            ticket_id: 'ticket-reply-456',
            board_id: 'board-1',
            client_id: 'client-1',
            attributes: {},
          });
        }

        if (table === 'statuses') return makeQueryBuilder({ is_closed: false });
        if (table === 'boards') return makeQueryBuilder({});

        // Internal-thread guard (alga-2026-0002798): the matched thread is public.
        if (table === 'comment_threads') {
          return makeQueryBuilder({ threadId: 'matched-thread', isInternal: false });
        }

        if (table === 'comments') {
          commentsQueryCount += 1;
          const firstResult = commentsQueryCount === 1
            ? { ticketId: 'ticket-reply-456', threadId: 'thread-456' }
            : { parentCommentId: 'latest-comment-456' };
          const builder: any = {
            select: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            whereRaw: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            first: vi.fn().mockResolvedValue(firstResult),
            // The one-off Cc/Bcc lookup awaits the builder for a row list.
            then: (resolve: any, reject: any) => Promise.resolve([]).then(resolve, reject),
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
    // Two reply-target queries plus the per-ticket one-off Cc/Bcc lookup. The
    // new comment's visibility is read only for a body that embeds an image.
    expect(commentsQueryCount).toBe(3);
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
        if (table === 'tickets as t' || table === 'comments as c') {
          return makeQueryBuilder(undefined);
        }

        if (table === 'tickets') return makeQueryBuilder({ ticket_id: 'ticket-thread-789', board_id: 'board-1', client_id: 'client-1', attributes: {} });
        if (table === 'statuses') return makeQueryBuilder({ is_closed: false });
        if (table === 'boards') return makeQueryBuilder({});

        if (table === 'email_sending_logs') {
          return makeLogsBuilder(() => ({ threadId: 'thread-789' }));
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
            whereRaw: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            first: vi.fn().mockResolvedValue({ parentCommentId: 'latest-comment-789' }),
            // The one-off Cc/Bcc lookup awaits the builder for a row list.
            then: (resolve: any, reject: any) => Promise.resolve([]).then(resolve, reject),
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
    // One reply-target query plus the per-ticket one-off Cc/Bcc lookup. The
    // new comment's visibility is read only for a body that embeds an image.
    expect(commentsQueryCount).toBe(2);
  });

  it('quarantines a forged In-Reply-To from an unrelated sender before comment, artifacts, or watcher effects', async () => {
    parseEmailReplyBodyMock.mockResolvedValue({
      sanitizedText: 'Forged reply body', sanitizedHtml: undefined, confidence: 0.95,
      strategy: 'plain', appliedHeuristics: [], warnings: [], tokens: {},
    });
    findContactByEmailMock.mockResolvedValue(null);
    withAdminTransactionMock.mockImplementation(async (callback: (trx: any) => Promise<any>) => {
      const trx = vi.fn((table: string) => {
        if (table === 'tickets as t' || table === 'comments as c') return makeQueryBuilder(undefined);
        if (table === 'email_sending_logs') return makeLogsBuilder(() => ({ threadId: 'thread-forged' }));
        if (table === 'comment_threads') return makeQueryBuilder({ ticketId: 'ticket-target', threadId: 'thread-forged' });
        if (table === 'comments') return makeQueryBuilder({ parentCommentId: 'parent-comment-target' });
        if (table === 'tickets') return makeQueryBuilder({ ticket_id: 'ticket-target', board_id: 'board-1', client_id: 'client-1', attributes: {} });
        if (table === 'statuses') return makeQueryBuilder({ is_closed: false });
        if (table === 'boards') return makeQueryBuilder({});
        throw new Error(`Unexpected table in unit test: ${table}`);
      });
      return callback(trx);
    });

    const { processInboundEmailInApp } = await import('@alga-psa/shared/services/email/processInboundEmailInApp');
    const result = await processInboundEmailInApp({
      tenantId: 'tenant-1', providerId: 'provider-1',
      emailData: buildEmailData({
        id: 'email-forged-header-1', from: { email: 'attacker@example.net', name: 'Attacker' },
        inReplyTo: '<outbound-forged@example.test>', attachments: [{ filename: 'payload.txt' } as any],
      }),
    });

    expect(result).toMatchObject({
      outcome: 'quarantined', reason: 'unauthorized_thread_header_sender', ticketId: 'ticket-target', matchedBy: 'thread_headers',
    });
    expect(createCommentFromEmailMock).not.toHaveBeenCalled();
    expect(processInboundEmailArtifactsBestEffortMock).not.toHaveBeenCalled();
    expect(upsertTicketWatchListRecipientsMock).not.toHaveBeenCalled();
  });

  // alga-2026-0003119: an MSP tech mailing their own M365 helpdesk mailbox about an
  // existing ticket carries no Authentication-Results (intra-tenant Exchange delivery),
  // so the internal-user gate used to drop the identity and the thread-header gate then
  // quarantined the message with no ticket, comment, or UI trace.
  it('applies a Microsoft intra-org internal reply to the threaded ticket without a security event', async () => {
    parseEmailReplyBodyMock.mockResolvedValue({
      sanitizedText: 'Forwarding the customer chain', sanitizedHtml: undefined, confidence: 0.95,
      strategy: 'plain', appliedHeuristics: [], warnings: [], tokens: {},
    });
    findContactByEmailMock.mockResolvedValue({
      contact_id: null,
      client_id: null,
      user_id: 'internal-user-1',
      email: 'tech@msp.example',
      matched_email: 'tech@msp.example',
      user_type: 'internal',
      is_inactive: false,
    });
    withAdminTransactionMock.mockImplementation(async (callback: (trx: any) => Promise<any>) => {
      const trx = vi.fn((table: string) => {
        if (table === 'tickets as t' || table === 'comments as c') return makeQueryBuilder(undefined);
        if (table === 'email_sending_logs') return makeLogsBuilder(() => ({ threadId: 'thread-intraorg' }));
        if (table === 'comment_threads') return makeQueryBuilder({ ticketId: 'ticket-intraorg', threadId: 'thread-intraorg' });
        if (table === 'comments') {
          const builder: any = {
            select: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            whereRaw: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            first: vi.fn().mockResolvedValue({ parentCommentId: 'parent-comment-intraorg' }),
            // The one-off Cc/Bcc lookup awaits the builder for a row list.
            then: (resolve: any, reject: any) => Promise.resolve([]).then(resolve, reject),
          };
          return builder;
        }
        if (table === 'tickets') return makeQueryBuilder({ ticket_id: 'ticket-intraorg', board_id: 'board-1', client_id: 'client-1', attributes: {} });
        if (table === 'statuses') return makeQueryBuilder({ is_closed: false });
        if (table === 'boards') return makeQueryBuilder({});
        throw new Error(`Unexpected table in unit test: ${table}`);
      });
      return callback(trx);
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { processInboundEmailInApp } = await import('@alga-psa/shared/services/email/processInboundEmailInApp');
      const result = await processInboundEmailInApp({
        tenantId: 'tenant-1', providerId: 'provider-1',
        emailData: buildEmailData({
          id: 'email-intraorg-internal-1',
          provider: 'microsoft',
          from: { email: 'tech@msp.example', name: 'MSP Tech' },
          inReplyTo: '<outbound-intraorg@example.test>',
          // Intra-tenant Exchange delivery: the org stamp stands alone.
          headers: { 'X-MS-Exchange-Organization-AuthAs': 'Internal' },
        }),
      }, { collectDiagnostics: true });

      expect(result).toMatchObject({
        outcome: 'replied', matchedBy: 'thread_headers', ticketId: 'ticket-intraorg', commentId: 'comment-1',
      });
      expect(result.diagnostics?.threading.matchedBy).toBe('thread_headers');
      expect(result.diagnostics?.threading.failureReason ?? null).toBeNull();
      expect(createCommentFromEmailMock).toHaveBeenCalledWith(
        expect.objectContaining({
          ticket_id: 'ticket-intraorg',
          author_type: 'internal',
          author_id: 'internal-user-1',
        }),
        'tenant-1'
      );
      const warnings = warnSpy.mock.calls.map((call) => String(call[0]));
      expect(warnings).not.toContain('SECURITY_EVENT inbound_email_internal_sender_auth_failed');
      expect(warnings).not.toContain('security_event: inbound_thread_header_sender_quarantined');
    } finally {
      warnSpy.mockRestore();
    }
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
        if (table === 'tickets as t' || table === 'comments as c') {
          return makeQueryBuilder(undefined);
        }

        if (table === 'tickets') return makeQueryBuilder({ ticket_id: 'ticket-ref-123', board_id: 'board-1', client_id: 'client-1', attributes: {} });
        if (table === 'statuses') return makeQueryBuilder({ is_closed: false });
        if (table === 'boards') return makeQueryBuilder({});

        if (table === 'email_sending_logs') {
          // Batched lookup: ONE query over every reference's forms. Only the older reference matches.
          return makeLogsBuilder((forms) => {
            if (forms.length > 0) rfcLookups.push(forms.join('|'));
            return forms.includes('<target-reference@example.test>')
              ? { rfc_message_id: '<target-reference@example.test>', threadId: 'thread-ref-123' }
              : undefined;
          });
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
    // One on-wire query covered the whole chain (not one per reference).
    expect(rfcLookups).toHaveLength(1);
    expect(rfcLookups[0]).toContain('<newer-unmatched-reference@example.test>');
    expect(rfcLookups[0]).toContain('<target-reference@example.test>');
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
        if (table === 'tickets as t' || table === 'comments as c') {
          return makeQueryBuilder(undefined);
        }

        if (table === 'tickets') return makeQueryBuilder({ ticket_id: 'ticket-provider-123', board_id: 'board-1', client_id: 'client-1', attributes: {} });
        if (table === 'statuses') return makeQueryBuilder({ is_closed: false });
        if (table === 'boards') return makeQueryBuilder({});

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
    // Provider-thread lookup, thread->comment lookup, plus the internal-thread guard.
    expect(commentThreadQueryCount).toBe(3);
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
        if (table === 'tickets as t' || table === 'comments as c') {
          return makeQueryBuilder(undefined);
        }

        if (table === 'tickets') return makeQueryBuilder({ ticket_id: 'ticket-legacy-fallback-123', board_id: 'board-1', client_id: 'client-1', attributes: {} });
        if (table === 'statuses') return makeQueryBuilder({ is_closed: false });
        if (table === 'boards') return makeQueryBuilder({});

        if (table === 'email_sending_logs' || table === 'comment_threads') {
          const builder: any = {
            select: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            whereIn: vi.fn().mockReturnThis(),
            whereRaw: vi.fn().mockReturnThis(),
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

  it('a miss across a long References chain makes a bounded number of outbound-id queries', async () => {
    parseEmailReplyBodyMock.mockResolvedValue({
      sanitizedText: 'Forwarded thread body', sanitizedHtml: undefined, confidence: 0.95,
      strategy: 'plain', appliedHeuristics: [], warnings: [], tokens: {},
    });
    findTicketByEmailThreadMock.mockResolvedValue({ ticketId: 'ticket-legacy-fallback-123' });

    const onWireQueries: string[][] = [];
    const generatedQueries: unknown[][] = [];
    const generatedSql: string[] = [];
    withAdminTransactionMock.mockImplementation(async (callback: (trx: any) => Promise<any>) => {
      const trx = vi.fn((table: string) => {
        if (table === 'tickets as t' || table === 'comments as c') return makeQueryBuilder(undefined);
        if (table === 'tickets') return makeQueryBuilder({ ticket_id: 'ticket-legacy-fallback-123', board_id: 'board-1', client_id: 'client-1', attributes: {} });
        if (table === 'statuses') return makeQueryBuilder({ is_closed: false });
        if (table === 'boards') return makeQueryBuilder({});
        if (table === 'email_sending_logs') {
          const builder = makeLogsBuilder(() => undefined);
          const whereRaw = builder.whereRaw;
          builder.whereRaw = vi.fn((sql: string, bindings?: unknown[]) => {
            if (sql.includes('rfc_message_id = ANY(?)')) onWireQueries.push((bindings?.[0] as string[]) ?? []);
            if (sql.includes('generatedRfcMessageId')) {
              generatedQueries.push(bindings ?? []);
              generatedSql.push(sql);
            }
            return whereRaw(sql, bindings);
          });
          return builder;
        }
        if (table === 'comment_threads') return makeQueryBuilder(undefined);
        throw new Error(`Unexpected table in unit test: ${table}`);
      });
      return callback(trx);
    });

    const references = Array.from({ length: 12 }, (_, i) => `<outside-${i}@elsewhere.example>`);
    const { processInboundEmailInApp } = await import('@alga-psa/shared/services/email/processInboundEmailInApp');
    await processInboundEmailInApp({
      tenantId: 'tenant-1',
      providerId: 'provider-1',
      emailData: buildEmailData({ id: 'email-forward-1', inReplyTo: references[11], references }),
    });

    // One statement for In-Reply-To and one for the whole References chain, each matching the on-wire
    // and the generated id together — never a second (generated-id) statement, never one per entry.
    expect(onWireQueries.length).toBeLessThanOrEqual(2);
    expect(generatedQueries.length).toBe(onWireQueries.length);
    // Must stay the exact expression + predicate of idx_email_sending_logs_tenant_generated_rfc_message.
    for (const sql of generatedSql) {
      expect(sql).toContain("(metadata->>'generatedRfcMessageId') IS NOT NULL");
      expect(sql).toContain("(metadata->>'generatedRfcMessageId') = ANY(?)");
    }
    expect(generatedSql.length).toBeGreaterThan(0);
    const referenceQuery = onWireQueries.find((forms) => forms.length >= references.length);
    expect(referenceQuery).toBeDefined();
    expect(referenceQuery).toEqual(expect.arrayContaining(references));
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

        // Internal-thread guard (alga-2026-0002798): the matched thread is public.
        if (table === 'comment_threads') {
          return makeQueryBuilder({ threadId: 'matched-thread', isInternal: false });
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
          // notificationLoopDetection.ts also queries this table (by
          // reply_token_hash / status, tenant-scoped) as part of the loop
          // guard that now runs before any threading decision — that is
          // expected and does not indicate header threading ran. Only a
          // query keyed on rfc_message_id is the header-threading lookup
          // this test cares about (resolveReplyTargetFromOutboundMessageId),
          // so track that specifically.
          const builder: any = {
            select: vi.fn().mockReturnThis(),
            where: vi.fn((criteria: Record<string, unknown>) => {
              if (criteria && typeof criteria === 'object' && 'rfc_message_id' in criteria) {
                emailLogQueried = true;
              }
              return builder;
            }),
            whereIn: vi.fn().mockReturnThis(),
            whereRaw: vi.fn((sql: string) => {
              if (sql.includes('rfc_message_id')) emailLogQueried = true;
              return builder;
            }),
            andWhereRaw: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            // Lacks from_address/to_addresses, so notificationLoopDetection's
            // sender/recipient correlation can never match it — only the
            // header-threading path's `{ threadId }` shape is meaningful here.
            first: vi.fn().mockResolvedValue({ threadId: 'thread-header-that-should-not-win' }),
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


  // ---------------------------------------------------------------------
  // alga-2026-0002798: external replies must never land in internal threads
  // ---------------------------------------------------------------------
  describe('external reply that header-matches an internal thread (production shape)', () => {
    const TICKET = 'ticket-prod-1';
    const INTERNAL_NOTE_MSG_ID = '<61dbd732-internal-note@alga.test>';
    const SES_IN_REPLY_TO = '<0100019abc-0000-000000@email.amazonses.com>';

    function installDb(opts: {
      sendingLogs?: Record<string, string>; // rfc_message_id -> comment_thread_id
      providerThreads?: Record<string, string>; // provider thread id -> thread_id
      internalThreads: string[];
      publicThreadId: string | null;
      latestByThread: Record<string, string>;
    }) {
      withAdminTransactionMock.mockImplementation(async (callback: (trx: any) => Promise<any>) => {
        const trx = vi.fn((table: string) => {
          if (table === 'tickets as t' || table === 'comments as c') return makeQueryBuilder(undefined);
          if (table === 'tickets') {
            return makeQueryBuilder({ ticket_id: TICKET, board_id: 'board-1', client_id: 'client-1', attributes: {} });
          }
          if (table === 'statuses') return makeQueryBuilder({ is_closed: false });
          if (table === 'boards') return makeQueryBuilder({});

          let criteria: Record<string, any> = {};
          const builder: any = {
            select: vi.fn().mockReturnThis(),
            whereNotNull: vi.fn().mockReturnThis(),
            whereRaw: vi.fn((sql: string, bindings?: unknown[]) => {
              if (sql.includes('rfc_message_id = ANY(?)')) {
                const values = (bindings?.[0] as string[]) ?? [];
                criteria = { ...criteria, rfc_message_id: values.find((v) => opts.sendingLogs?.[v]) ?? values[0], forms: values };
              }
              return builder;
            }),
            andWhereRaw: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            where: vi.fn((c: Record<string, any>) => {
              criteria = { ...criteria, ...(typeof c === 'object' ? c : {}) };
              return builder;
            }),
            whereIn: vi.fn().mockReturnThis(),
            // The one-off Cc/Bcc lookup awaits the comments builder for a row list.
            then: (resolve: any, reject: any) => Promise.resolve([]).then(resolve, reject),
          };

          if (table === 'email_sending_logs') {
            builder.first = vi.fn(async () => {
              const threadId = opts.sendingLogs?.[criteria.rfc_message_id];
              return threadId ? { threadId } : undefined;
            });
            // Batched header lookup resolves to the rows whose rfc_message_id is among the forms.
            builder.then = (resolve: any, reject: any) => {
              const rows = ((criteria.forms as string[] | undefined) ?? [])
                .filter((form) => opts.sendingLogs?.[form])
                .map((form) => ({ rfc_message_id: form, threadId: opts.sendingLogs![form] }));
              return Promise.resolve(rows).then(resolve, reject);
            };
            return builder;
          }

          if (table === 'comment_threads') {
            builder.first = vi.fn(async () => {
              if (criteria.email_provider_thread_id) {
                const threadId = opts.providerThreads?.[criteria.email_provider_thread_id];
                return threadId ? { threadId } : undefined;
              }
              if (criteria.thread_id) {
                return {
                  ticketId: TICKET,
                  threadId: criteria.thread_id,
                  isInternal: opts.internalThreads.includes(criteria.thread_id),
                };
              }
              if (criteria.ticket_id && criteria.is_internal === false) {
                return opts.publicThreadId ? { threadId: opts.publicThreadId } : undefined;
              }
              return undefined;
            });
            return builder;
          }

          if (table === 'comments') {
            builder.first = vi.fn(async () => {
              const parentCommentId = opts.latestByThread[criteria.thread_id];
              return parentCommentId ? { parentCommentId } : undefined;
            });
            return builder;
          }

          throw new Error(`Unexpected table in unit test: ${table}`);
        });
        return callback(trx);
      });
    }

    beforeEach(() => {
      parseEmailReplyBodyMock.mockResolvedValue({
        sanitizedText: 'Customer reply',
        sanitizedHtml: undefined,
        confidence: 0.95,
        strategy: 'plain',
        appliedHeuristics: [],
        warnings: [],
        tokens: {}, // the reply token missed on the production reply
      });
    });

    async function run(emailOverrides: Partial<EmailMessageDetails>) {
      const { processInboundEmailInApp } = await import(
        '@alga-psa/shared/services/email/processInboundEmailInApp'
      );
      return processInboundEmailInApp({
        tenantId: 'tenant-1',
        providerId: 'provider-1',
        emailData: buildEmailData({ id: 'email-prod-shape-1', ...emailOverrides }),
      });
    }

    const productionHeaders = {
      // SES-assigned id: matches nothing we stored.
      inReplyTo: SES_IN_REPLY_TO,
      // Chain ends with the internal note's id; the public reply's id is missing.
      references: ['<root@alga.test>', INTERNAL_NOTE_MSG_ID],
    };

    it('References fallback: external reply to an internal thread retargets to the newest public thread', async () => {
      installDb({
        sendingLogs: { [INTERNAL_NOTE_MSG_ID]: 'thread-internal' },
        internalThreads: ['thread-internal'],
        publicThreadId: 'thread-public',
        latestByThread: { 'thread-internal': 'internal-latest', 'thread-public': 'public-latest' },
      });

      const result = await run(productionHeaders);

      expect(result).toMatchObject({ outcome: 'replied', matchedBy: 'thread_headers', ticketId: TICKET });
      const call = createCommentFromEmailMock.mock.calls[0][0];
      expect(call.parent_comment_id).toBe('public-latest');
      expect(call.author_type).toBe('contact');
    });

    it('References fallback: with no public thread the reply becomes a top-level public comment', async () => {
      installDb({
        sendingLogs: { [INTERNAL_NOTE_MSG_ID]: 'thread-internal' },
        internalThreads: ['thread-internal'],
        publicThreadId: null,
        latestByThread: { 'thread-internal': 'internal-latest' },
      });

      const result = await run(productionHeaders);

      expect(result).toMatchObject({ outcome: 'replied', ticketId: TICKET });
      const call = createCommentFromEmailMock.mock.calls[0][0];
      expect(call.parent_comment_id).toBeUndefined();
      expect(call.ticket_id).toBe(TICKET);
    });

    it('provider thread id path: external reply to an internal thread retargets to the newest public thread', async () => {
      installDb({
        providerThreads: { 'provider-thread-xyz': 'thread-internal' },
        internalThreads: ['thread-internal'],
        publicThreadId: 'thread-public',
        latestByThread: { 'thread-internal': 'internal-latest', 'thread-public': 'public-latest' },
      });

      const result = await run({ threadId: 'provider-thread-xyz' });

      expect(result).toMatchObject({ outcome: 'replied', ticketId: TICKET });
      expect(createCommentFromEmailMock.mock.calls[0][0].parent_comment_id).toBe('public-latest');
    });

    it('provider thread id path: with no public thread the reply becomes a top-level public comment', async () => {
      installDb({
        providerThreads: { 'provider-thread-xyz': 'thread-internal' },
        internalThreads: ['thread-internal'],
        publicThreadId: null,
        latestByThread: { 'thread-internal': 'internal-latest' },
      });

      await run({ threadId: 'provider-thread-xyz' });

      expect(createCommentFromEmailMock.mock.calls[0][0].parent_comment_id).toBeUndefined();
    });

    it('In-Reply-To path: external reply to an internal notification id is retargeted too', async () => {
      installDb({
        sendingLogs: { [INTERNAL_NOTE_MSG_ID]: 'thread-internal' },
        internalThreads: ['thread-internal'],
        publicThreadId: 'thread-public',
        latestByThread: { 'thread-internal': 'internal-latest', 'thread-public': 'public-latest' },
      });

      await run({ inReplyTo: INTERNAL_NOTE_MSG_ID });

      expect(createCommentFromEmailMock.mock.calls[0][0].parent_comment_id).toBe('public-latest');
    });

    it('reply-token path: external reply whose token resolves to an internal thread is retargeted', async () => {
      parseEmailReplyBodyMock.mockResolvedValue({
        sanitizedText: 'Customer reply', sanitizedHtml: undefined, confidence: 0.95, strategy: 'plain',
        appliedHeuristics: [], warnings: [], tokens: { conversationToken: 'token-internal' },
      });
      findTicketByReplyTokenMock.mockResolvedValue({ ticketId: TICKET, commentId: 'internal-root' });
      // comments lookup for the token's comment resolves its thread.
      withAdminTransactionMock.mockImplementation(async (callback: (trx: any) => Promise<any>) => {
        const trx = vi.fn((table: string) => {
          if (table === 'tickets as t' || table === 'comments as c') return makeQueryBuilder(undefined);
          if (table === 'tickets') return makeQueryBuilder({ ticket_id: TICKET, board_id: 'board-1', client_id: 'client-1', attributes: {} });
          if (table === 'statuses') return makeQueryBuilder({ is_closed: false });
          if (table === 'boards') return makeQueryBuilder({});
          let criteria: Record<string, any> = {};
          const builder: any = {
            select: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            where: vi.fn((c: any) => { criteria = { ...criteria, ...c }; return builder; }),
            then: (resolve: any, reject: any) => Promise.resolve([]).then(resolve, reject),
          };
          if (table === 'comments') {
            builder.first = vi.fn(async () => {
              if (criteria.comment_id) return { ticketId: TICKET, threadId: 'thread-internal' };
              return { parentCommentId: criteria.thread_id === 'thread-public' ? 'public-latest' : 'internal-latest' };
            });
            return builder;
          }
          if (table === 'comment_threads') {
            builder.first = vi.fn(async () => {
              if (criteria.thread_id) return { threadId: criteria.thread_id, isInternal: true };
              return { threadId: 'thread-public' };
            });
            return builder;
          }
          throw new Error(`Unexpected table in unit test: ${table}`);
        });
        return callback(trx);
      });

      const result = await run({});

      expect(result).toMatchObject({ outcome: 'replied', matchedBy: 'reply_token' });
      expect(createCommentFromEmailMock.mock.calls[0][0].parent_comment_id).toBe('public-latest');
    });

    it('an internal-user sender replying to the internal thread stays in it', async () => {
      findContactByEmailMock.mockResolvedValue({
        contact_id: undefined,
        user_id: 'internal-user-1',
        client_id: undefined,
        email: 'client@example.com',
        matched_email: 'client@example.com',
        user_type: 'internal',
      });
      installDb({
        sendingLogs: { [INTERNAL_NOTE_MSG_ID]: 'thread-internal' },
        internalThreads: ['thread-internal'],
        publicThreadId: 'thread-public',
        latestByThread: { 'thread-internal': 'internal-latest', 'thread-public': 'public-latest' },
      });

      await run(productionHeaders);

      const call = createCommentFromEmailMock.mock.calls[0][0];
      expect(call.author_type).toBe('internal');
      expect(call.parent_comment_id).toBe('internal-latest');
    });

    it('a public thread match is left untouched', async () => {
      installDb({
        sendingLogs: { [INTERNAL_NOTE_MSG_ID]: 'thread-public' },
        internalThreads: [],
        publicThreadId: 'thread-other-public',
        latestByThread: { 'thread-public': 'public-latest', 'thread-other-public': 'other-latest' },
      });

      await run(productionHeaders);

      expect(createCommentFromEmailMock.mock.calls[0][0].parent_comment_id).toBe('public-latest');
    });
  });

  describe('Gmail reply headers (no reply token)', () => {
    const plainBody = {
      sanitizedText: 'Gmail reply body',
      sanitizedHtml: undefined,
      confidence: 0.95,
      strategy: 'plain',
      appliedHeuristics: [],
      warnings: [],
      tokens: {},
    };

    it('T004: In-Reply-To equal to a stored rfc_message_id attaches to that ticket; candidate is the Message-ID', async () => {
      parseEmailReplyBodyMock.mockResolvedValue(plainBody);

      withAdminTransactionMock.mockImplementation(async (callback: (trx: any) => Promise<any>) => {
        const trx = vi.fn((table: string) => {
          if (table === 'tickets as t' || table === 'comments as c') return makeQueryBuilder(undefined);
          if (table === 'tickets') return makeQueryBuilder({ ticket_id: 'ticket-gmail-1', board_id: 'board-1', client_id: 'client-1', attributes: {} });
          if (table === 'statuses') return makeQueryBuilder({ is_closed: false });
          if (table === 'boards') return makeQueryBuilder({});
          if (table === 'email_sending_logs') {
            return makeLogsBuilder(() => ({ threadId: 'thread-gmail-1' }));
          }
          if (table === 'comment_threads') {
            return {
              select: vi.fn().mockReturnThis(),
              where: vi.fn().mockReturnThis(),
              first: vi.fn().mockResolvedValue({ ticketId: 'ticket-gmail-1', threadId: 'thread-gmail-1' }),
            };
          }
          if (table === 'comments') {
            return {
              select: vi.fn().mockReturnThis(),
              where: vi.fn().mockReturnThis(),
              whereRaw: vi.fn().mockReturnThis(),
              orderBy: vi.fn().mockReturnThis(),
              first: vi.fn().mockResolvedValue({ parentCommentId: 'latest-comment-gmail-1' }),
              then: (resolve: any, reject: any) => Promise.resolve([]).then(resolve, reject),
            };
          }
          throw new Error(`Unexpected table in unit test: ${table}`);
        });
        return callback(trx);
      });

      const { processInboundEmailInApp } = await import(
        '@alga-psa/shared/services/email/processInboundEmailInApp'
      );

      // Shape produced by GmailAdapter.getMessageDetails: Gmail API id as `id`, header-derived
      // inReplyTo/references, Gmail API threadId.
      const result: any = await processInboundEmailInApp(
        {
          tenantId: 'tenant-1',
          providerId: 'provider-1',
          emailData: buildEmailData({
            id: '1a127f5b0fabfb0d',
            provider: 'google',
            inReplyTo: '<outbound-gmail-1@example.test>',
            references: ['<outbound-gmail-1@example.test>'],
            threadId: 'gmail-api-thread-1',
          }),
        },
        { collectDiagnostics: true }
      );

      expect(result).toMatchObject({
        outcome: 'replied',
        matchedBy: 'thread_headers',
        ticketId: 'ticket-gmail-1',
        commentId: 'comment-1',
      });
      expect(createTicketFromEmailMock).not.toHaveBeenCalled();
      expect(result.diagnostics.threading.originalMessageIdCandidate).toBe('outbound-gmail-1@example.test');
    });

    it('T005: a second message in the same Gmail conversation lands on the ticket the first created', async () => {
      parseEmailReplyBodyMock.mockResolvedValue(plainBody);
      createTicketFromEmailMock.mockResolvedValue({ ticket_id: 'ticket-first', ticket_number: 'T-1' });

      const noRows = () => {
        const builder: any = {
          select: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          whereIn: vi.fn().mockReturnThis(),
          whereRaw: vi.fn().mockReturnThis(),
          whereNotNull: vi.fn().mockReturnThis(),
          andWhereRaw: vi.fn().mockReturnThis(),
          andWhere: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue(undefined),
          then: (resolve: any, reject: any) => Promise.resolve([]).then(resolve, reject),
        };
        return builder;
      };
      withAdminTransactionMock.mockImplementation(async (callback: (trx: any) => Promise<any>) => {
        const trx = vi.fn((table: string) => {
          if (table === 'tickets') return makeQueryBuilder({ ticket_id: 'ticket-first', board_id: 'board-1', client_id: 'client-1', attributes: {} });
          if (table === 'statuses') return makeQueryBuilder({ is_closed: false });
          if (table === 'boards') return makeQueryBuilder({});
          return noRows();
        });
        return callback(trx);
      });

      const { processInboundEmailInApp } = await import(
        '@alga-psa/shared/services/email/processInboundEmailInApp'
      );

      // First message: no headers; Gmail supplies only its API threadId.
      const first: any = await processInboundEmailInApp({
        tenantId: 'tenant-1',
        providerId: 'provider-1',
        emailData: buildEmailData({ id: 'gmail-msg-1', threadId: 'gmail-api-thread-7' }),
      });
      expect(first.outcome).toBe('created');
      const storedMetadata = createTicketFromEmailMock.mock.calls[0][0].email_metadata;
      expect(storedMetadata.threadId).toBe('gmail-api-thread-7');

      // findTicketByEmailThread compares tickets.email_metadata.threadId to the inbound
      // threadId; emulate that comparison against what the first message stored.
      findTicketByEmailThreadMock.mockImplementation(async (input: any) =>
        input.threadId && input.threadId === storedMetadata.threadId ? { ticketId: 'ticket-first' } : null
      );

      const second: any = await processInboundEmailInApp({
        tenantId: 'tenant-1',
        providerId: 'provider-1',
        emailData: buildEmailData({
          id: 'gmail-msg-2',
          threadId: 'gmail-api-thread-7',
          inReplyTo: '<client-first@example.test>',
          references: ['<client-first@example.test>'],
        }),
      });

      expect(second).toMatchObject({ outcome: 'replied', ticketId: 'ticket-first' });
      expect(createTicketFromEmailMock).toHaveBeenCalledTimes(1);
    });
  });
});
