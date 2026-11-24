import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailMessageDetails } from '../../../interfaces/inbound-email.interfaces';
import {
  buildGatewayMessage,
  mockDkimResolver,
  FROM_ADDRESS,
} from '../../../lib/email/__tests__/gatewayFixtures';
import { verifyArcSeal } from '../inboundAuthTrust';
import type { InboundAuthTrustPolicy } from '../../../lib/email/authResultsChain';

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
    from: { email: FROM_ADDRESS, name: 'Phill' },
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

  const GATEWAY_CONTACT = {
    contact_id: 'contact-phill',
    client_id: 'client-domotz',
    user_id: 'client-user-phill',
    email: FROM_ADDRESS,
    name: 'Phill',
    client_name: 'Domotz',
  };
  const policy = (mode: InboundAuthTrustPolicy['mode'], ids = ['mx.avanan.net']): InboundAuthTrustPolicy => ({
    mode,
    trustedAuthservIds: ids,
  });

  /** Runs a really-sealed (or not) gateway message through the pipeline with the inbox policy. */
  async function run(
    messageOptions: Parameters<typeof buildGatewayMessage>[0],
    inboxPolicy: InboundAuthTrustPolicy | undefined,
    emailOverrides: Partial<EmailMessageDetails> = {}
  ) {
    const { headers, rawMime } = await buildGatewayMessage(messageOptions);
    const arcSeal = inboxPolicy?.mode === 'arc-sealed'
      ? await verifyArcSeal(rawMime, { resolver: mockDkimResolver() })
      : undefined;
    const { processInboundEmailInApp } = await import('../processInboundEmailInApp');
    return processInboundEmailInApp({
      tenantId: 'tenant-1',
      providerId: 'provider-1',
      emailData: buildEmailData({ headers, ...emailOverrides }),
      inboundAuthTrust: inboxPolicy ? { policy: inboxPolicy, arcSeal } : undefined,
    }, { collectDiagnostics: true });
  }

  const ticketArgs = () => createTicketFromEmailMock.mock.calls[0][0];
  const watcherEmails = (watchList: any[] | undefined) => (watchList ?? []).map((w) => w.email);

  describe('trusted inbound gateway attribution', () => {
    beforeEach(() => {
      findContactByEmailMock.mockResolvedValue(GATEWAY_CONTACT);
      // The client's Default Contact, reached through the inbound-domain mapping.
      findInboundEmailDomainMappingMock.mockResolvedValue({ clientId: 'client-domotz', autoCreateContacts: false });
      findValidClientPrimaryContactIdMock.mockResolvedValue('contact-default');
    });

    it('mode off (no configuration): the contact match is dropped, as today', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await run({}, undefined);
      expect(ticketArgs().contact_id).not.toBe('contact-phill');
      expect(warn).toHaveBeenCalledWith(
        'processInboundEmailInApp: sender auth not aligned; discarding contact match',
        expect.objectContaining({ authSource: 'none', reason: expect.any(String) })
      );
      warn.mockRestore();
    });

    it('mode off (explicit policy): the contact match is dropped', async () => {
      await run({}, policy('off'));
      expect(ticketArgs().contact_id).not.toBe('contact-phill');
    });

    it('arc-sealed, trusted mx.avanan.net, valid seal: the contact match is kept', async () => {
      await run({}, policy('arc-sealed'));
      expect(createTicketFromEmailMock).toHaveBeenCalledWith(
        expect.objectContaining({ client_id: 'client-domotz', contact_id: 'contact-phill' }),
        'tenant-1'
      );
    });

    it('arc-sealed with a tampered (invalid) seal: dropped', async () => {
      await run({ tamperAfterSeal: true }, policy('arc-sealed'));
      expect(ticketArgs().contact_id).not.toBe('contact-phill');
    });

    it('arc-sealed with no seal and a forged lower block: dropped', async () => {
      await run({ seal: false }, policy('arc-sealed'));
      expect(ticketArgs().contact_id).not.toBe('contact-phill');
    });

    it('arc-sealed with a non-aligned pass from the trusted authserv-id: dropped', async () => {
      await run(
        { arcAuthResults: 'mx.avanan.net; spf=pass smtp.mailfrom=attacker.test; dkim=pass header.d=attacker.test' },
        policy('arc-sealed')
      );
      expect(ticketArgs().contact_id).not.toBe('contact-phill');
    });

    it('mta-arc-pass: kept when the top block reports arc=pass, dropped otherwise', async () => {
      await run({ topBlock: 'spf=none; dkim=none; dmarc=fail header.from=domotz.com; arc=pass (i=1 spf=pass dkim=pass)' }, policy('mta-arc-pass'));
      expect(ticketArgs().contact_id).toBe('contact-phill');

      createTicketFromEmailMock.mockClear();
      await run({}, policy('mta-arc-pass'));
      expect(ticketArgs().contact_id).not.toBe('contact-phill');
    });

    it('an internal sender arriving through a trusted gateway is still refused', async () => {
      findContactByEmailMock.mockResolvedValue({
        user_id: 'internal-user-1',
        user_type: 'internal',
        email: FROM_ADDRESS,
        name: 'Phill Internal',
      });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await run({}, policy('arc-sealed'));
      expect(warn).toHaveBeenCalledWith(
        'SECURITY_EVENT inbound_email_internal_sender_auth_failed',
        expect.any(Object)
      );
      // The internal identity is not attributed: the comment is stored as an unmatched sender.
      expect(createCommentFromEmailMock).toHaveBeenCalledWith(
        expect.objectContaining({
          author_id: expect.not.stringMatching(/internal-user-1/),
          metadata: expect.objectContaining({ unmatchedSender: true }),
        }),
        'tenant-1'
      );
      warn.mockRestore();
    });

    it('an unverified sender is not added as a watcher; the Default Contact stays on the ticket; From stays in metadata', async () => {
      await run({}, policy('off'));
      const args = ticketArgs();
      expect(watcherEmails(args.attributes?.watch_list)).not.toContain(FROM_ADDRESS);
      expect(args.contact_id).toBe('contact-default');
      expect(createCommentFromEmailMock).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            email: expect.objectContaining({ from: expect.objectContaining({ email: FROM_ADDRESS }) }),
          }),
        }),
        'tenant-1'
      );
    });

    it('an unverified sender is not upserted as a watcher on the reply-token path either', async () => {
      parseEmailReplyBodyMock.mockResolvedValue({
        sanitizedText: 'Reply body', sanitizedHtml: undefined, confidence: 0.95, strategy: 'plain',
        appliedHeuristics: [], warnings: [], tokens: { conversationToken: 'reply-token-123' },
      });
      findTicketByReplyTokenMock.mockResolvedValue({ ticketId: 'ticket-reply-123' });
      await run({}, policy('off'));
      const upserts = upsertTicketWatchListRecipientsMock.mock.calls.flatMap(([arg]) => arg.recipients ?? []);
      expect(watcherEmails(upserts)).not.toContain(FROM_ADDRESS);
    });

    it('a simply unknown sender (no contact match was dropped) is still added as a watcher, unchanged', async () => {
      findContactByEmailMock.mockResolvedValue(null);
      await run({}, policy('off'));
      expect(watcherEmails(ticketArgs().attributes?.watch_list)).toContain(FROM_ADDRESS);
    });

    it('a verified gateway sender is matched, so no inbound_from watcher is added either', async () => {
      await run({}, policy('arc-sealed'));
      expect(watcherEmails(ticketArgs().attributes?.watch_list)).not.toContain(FROM_ADDRESS);
    });
  });
});
