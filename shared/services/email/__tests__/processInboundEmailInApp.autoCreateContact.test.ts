import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { EmailMessageDetails } from '../../../interfaces/inbound-email.interfaces';
import { parseEmailReply } from '../../../lib/email/replyParser';

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
const emailTicketLookupResults: unknown[] = [];

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

describe('processInboundEmailInApp auto-create contact', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    reopenPolicyRows.ticket = undefined;
    reopenPolicyRows.board = undefined;
    reopenPolicyRows.status = undefined;
    emailSendingLogsState.row = undefined;
    emailTicketLookupResults.length = 0;

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
        if (table === 'tickets as t') {
          return makeQueryBuilder(emailTicketLookupResults.shift());
        }
        if (table === 'comments as c' || table === 'comment_threads') {
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

  it('creates and attributes a contact for an aligned sender on an opted-in mapped domain', async () => {
    findInboundEmailDomainMappingMock.mockResolvedValue({ clientId: 'client-domain', autoCreateContacts: true });
    findValidClientPrimaryContactIdMock.mockResolvedValue('primary-contact');
    createContactForInboundSenderMock.mockResolvedValue({ contactId: 'created-contact', created: true });
    const { processInboundEmailInApp } = await import('../processInboundEmailInApp');
    await processInboundEmailInApp({ tenantId: 'tenant-1', providerId: 'provider-1', emailData: buildEmailData() });

    expect(createContactForInboundSenderMock).toHaveBeenCalledWith(
      { email: 'client@example.com', name: 'Client User', clientId: 'client-domain' }, 'tenant-1', expect.anything()
    );
    expect(createTicketFromEmailMock).toHaveBeenCalledWith(expect.objectContaining({ client_id: 'client-domain', contact_id: 'created-contact', email_metadata: expect.objectContaining({ autoCreatedContactId: 'created-contact' }) }), 'tenant-1');
    expect(createCommentFromEmailMock).toHaveBeenCalledWith(expect.objectContaining({ contact_id: 'created-contact', author_type: 'contact', metadata: expect.objectContaining({ unmatchedSender: false }) }), 'tenant-1');
    expect(upsertTicketWatchListRecipientsMock).not.toHaveBeenCalled();
  });

  it('leaves the primary-contact fallback when domain auto-create is disabled', async () => {
    findInboundEmailDomainMappingMock.mockResolvedValue({ clientId: 'client-domain', autoCreateContacts: false });
    findValidClientPrimaryContactIdMock.mockResolvedValue('primary-contact');
    const { processInboundEmailInApp } = await import('../processInboundEmailInApp');
    await processInboundEmailInApp({ tenantId: 'tenant-1', providerId: 'provider-1', emailData: buildEmailData() });
    expect(createContactForInboundSenderMock).not.toHaveBeenCalled();
    expect(createTicketFromEmailMock).toHaveBeenCalledWith(expect.objectContaining({ contact_id: 'primary-contact' }), 'tenant-1');
  });

  it('does not create contacts when sender authentication is not aligned', async () => {
    findInboundEmailDomainMappingMock.mockResolvedValue({ clientId: 'client-domain', autoCreateContacts: true });
    const { processInboundEmailInApp } = await import('../processInboundEmailInApp');
    await processInboundEmailInApp({ tenantId: 'tenant-1', providerId: 'provider-1', emailData: buildEmailData({ headers: { 'authentication-results': 'mx.example; spf=fail; dmarc=fail' } }) });
    expect(createContactForInboundSenderMock).not.toHaveBeenCalled();
  });

  it('skips automated messages and provider mailbox senders', async () => {
    findInboundEmailDomainMappingMock.mockResolvedValue({ clientId: 'client-domain', autoCreateContacts: true });
    const { processInboundEmailInApp } = await import('../processInboundEmailInApp');
    await processInboundEmailInApp({ tenantId: 'tenant-1', providerId: 'provider-1', emailData: buildEmailData({ headers: { 'authentication-results': 'mx.example; spf=pass smtp.mailfrom=example.com; dmarc=pass header.from=example.com', 'auto-submitted': 'auto-replied' } }) });
    expect(createContactForInboundSenderMock).not.toHaveBeenCalled();

    findContactByEmailMock.mockResolvedValue(null);
    await processInboundEmailInApp({ tenantId: 'tenant-1', providerId: 'provider-1', emailData: buildEmailData({ from: { email: 'support@example.com', name: 'Support' } }) });
    expect(createContactForInboundSenderMock).not.toHaveBeenCalled();
  });

  it('does not create a contact when the sender already matches a contact', async () => {
    findContactByEmailMock.mockResolvedValue({ contact_id: 'known-contact', client_id: 'default-client-id', email: 'client@example.com', name: 'Client User' });
    const { processInboundEmailInApp } = await import('../processInboundEmailInApp');
    await processInboundEmailInApp({ tenantId: 'tenant-1', providerId: 'provider-1', emailData: buildEmailData() });
    expect(createContactForInboundSenderMock).not.toHaveBeenCalled();
    expect(createTicketFromEmailMock).toHaveBeenCalledWith(expect.objectContaining({ contact_id: 'known-contact' }), 'tenant-1');
  });

  it('keeps the primary-contact fallback when the helper skips a known address', async () => {
    findInboundEmailDomainMappingMock.mockResolvedValue({ clientId: 'client-domain', autoCreateContacts: true });
    findValidClientPrimaryContactIdMock.mockResolvedValue('primary-contact');
    createContactForInboundSenderMock.mockResolvedValue(null);
    const { processInboundEmailInApp } = await import('../processInboundEmailInApp');
    await processInboundEmailInApp({ tenantId: 'tenant-1', providerId: 'provider-1', emailData: buildEmailData() });
    expect(createTicketFromEmailMock).toHaveBeenCalledWith(expect.objectContaining({ contact_id: 'primary-contact' }), 'tenant-1');
  });

  it('does not create a contact when the second dedupe gate finds a ticket', async () => {
    findInboundEmailDomainMappingMock.mockResolvedValue({ clientId: 'client-domain', autoCreateContacts: true });
    emailTicketLookupResults.push(undefined, { ticketId: 'already-created-ticket' });
    const { processInboundEmailInApp } = await import('../processInboundEmailInApp');
    const result = await processInboundEmailInApp({ tenantId: 'tenant-1', providerId: 'provider-1', emailData: buildEmailData() });
    expect(result.outcome).toBe('deduped');
    expect(createContactForInboundSenderMock).not.toHaveBeenCalled();
    expect(createTicketFromEmailMock).not.toHaveBeenCalled();
  });

  it('passes the durable transaction and contact event publisher to the helper', async () => {
    findInboundEmailDomainMappingMock.mockResolvedValue({ clientId: 'client-domain', autoCreateContacts: true });
    createContactForInboundSenderMock.mockResolvedValue({ contactId: 'created-contact', created: true });
    const trx = vi.fn();
    const contactPublisher = { publishContactCreated: vi.fn() } as any;
    const { processInboundEmailInApp } = await import('../processInboundEmailInApp');
    await processInboundEmailInApp({ tenantId: 'tenant-1', providerId: 'provider-1', emailData: buildEmailData() }, { durableExecution: { mode: 'enforce', trx: trx as any, inboxId: 'inbox-1', eventPublishers: { contact: contactPublisher } } });
    expect(createContactForInboundSenderMock).toHaveBeenCalledWith(expect.anything(), 'tenant-1', expect.objectContaining({ existingConnection: trx, inboxId: 'inbox-1', contactEventPublisher: contactPublisher }));
  });
});
