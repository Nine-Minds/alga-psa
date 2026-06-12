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
const processInboundEmailArtifactsBestEffortMock = vi.fn();
const evaluateInboundEmailRulesMock = vi.fn();

function buildEmailData(overrides: Partial<EmailMessageDetails> = {}): EmailMessageDetails {
  return {
    id: 'email-1',
    provider: 'google',
    providerId: 'provider-1',
    tenant: 'tenant-1',
    receivedAt: '2026-06-10T00:00:00.000Z',
    from: { email: 'alerts@huntress.com', name: 'Huntress Alerts' },
    to: [{ email: 'support@example.com', name: 'Support' }],
    subject: 'Critical Alert (Acme Corp) - EDR detection',
    body: { text: 'Incident details follow.', html: undefined },
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
    whereNotNull: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(firstResult),
  };
  return builder;
}

vi.mock('@alga-psa/db', () => ({
  withAdminTransaction: (callback: (trx: any) => Promise<any>) => withAdminTransactionMock(callback),
}));

vi.mock('../../../workflow/actions/emailWorkflowActions', () => ({
  parseEmailReplyBody: (...args: any[]) => parseEmailReplyBodyMock(...args),
  findTicketByReplyToken: (...args: any[]) => findTicketByReplyTokenMock(...args),
  findTicketByEmailThread: (...args: any[]) => findTicketByEmailThreadMock(...args),
  resolveInboundTicketDefaults: (...args: any[]) => resolveInboundTicketDefaultsMock(...args),
  resolveEffectiveInboundTicketDefaults: (...args: any[]) =>
    resolveEffectiveInboundTicketDefaultsMock(...args),
  findContactByEmail: (...args: any[]) => findContactByEmailMock(...args),
  findClientIdByInboundEmailDomain: (...args: any[]) => findClientIdByInboundEmailDomainMock(...args),
  findValidClientPrimaryContactId: (...args: any[]) => findValidClientPrimaryContactIdMock(...args),
  findEmailProviderMailboxAddress: (...args: any[]) => findEmailProviderMailboxAddressMock(...args),
  upsertTicketWatchListRecipients: (...args: any[]) => upsertTicketWatchListRecipientsMock(...args),
  createTicketFromEmail: (...args: any[]) => createTicketFromEmailMock(...args),
  createCommentFromEmail: (...args: any[]) => createCommentFromEmailMock(...args),
}));

vi.mock('../processInboundEmailArtifacts', () => ({
  processInboundEmailArtifactsBestEffort: (...args: any[]) =>
    processInboundEmailArtifactsBestEffortMock(...args),
}));

vi.mock('../inboundEmailRules', () => ({
  evaluateInboundEmailRules: (...args: any[]) => evaluateInboundEmailRulesMock(...args),
}));

const PROVIDER_DEFAULTS = {
  client_id: 'default-client-id',
  board_id: 'board-id',
  status_id: 'status-id',
  priority_id: 'priority-id',
  category_id: undefined,
  subcategory_id: undefined,
  location_id: undefined,
  entered_by: 'entered-by-user',
};

describe('processInboundEmailInApp: inbound email rules integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    withAdminTransactionMock.mockImplementation(async (callback: (trx: any) => Promise<any>) => {
      const trx = vi.fn(() => makeQueryBuilder(undefined));
      return callback(trx);
    });

    parseEmailReplyBodyMock.mockResolvedValue({
      sanitizedText: 'Incident details follow.',
      sanitizedHtml: undefined,
      confidence: 0.95,
      strategy: 'plain',
      appliedHeuristics: [],
      warnings: [],
      tokens: {},
    });
    findTicketByReplyTokenMock.mockResolvedValue(null);
    findTicketByEmailThreadMock.mockResolvedValue(null);
    findContactByEmailMock.mockResolvedValue(null);
    findClientIdByInboundEmailDomainMock.mockResolvedValue(null);
    findValidClientPrimaryContactIdMock.mockResolvedValue(null);
    findEmailProviderMailboxAddressMock.mockResolvedValue('support@example.com');
    upsertTicketWatchListRecipientsMock.mockResolvedValue({ updated: true, watchList: [] });
    resolveInboundTicketDefaultsMock.mockResolvedValue(PROVIDER_DEFAULTS);
    resolveEffectiveInboundTicketDefaultsMock.mockResolvedValue({
      defaults: PROVIDER_DEFAULTS,
      source: 'provider_default',
    });
    createTicketFromEmailMock.mockResolvedValue({ ticket_id: 'ticket-1', ticket_number: 'T-1' });
    createCommentFromEmailMock.mockResolvedValue('comment-1');
    processInboundEmailArtifactsBestEffortMock.mockResolvedValue(undefined);
    evaluateInboundEmailRulesMock.mockResolvedValue({ outcome: { kind: 'none' }, trace: [] });
  });

  async function run(emailOverrides: Partial<EmailMessageDetails> = {}) {
    const { processInboundEmailInApp } = await import('../processInboundEmailInApp');
    return processInboundEmailInApp({
      tenantId: 'tenant-1',
      providerId: 'provider-1',
      emailData: buildEmailData(emailOverrides),
    });
  }

  it('skip outcome suppresses the ticket and reports the rule', async () => {
    evaluateInboundEmailRulesMock.mockResolvedValue({
      outcome: { kind: 'skip', ruleId: 'rule-9', ruleName: 'Status updates', via: 'action' },
      trace: [{ ruleId: 'rule-9' }],
    });

    const result = await run();

    expect(result).toMatchObject({
      outcome: 'skipped',
      reason: 'rule_skip',
      rule: { ruleId: 'rule-9', ruleName: 'Status updates' },
    });
    expect(createTicketFromEmailMock).not.toHaveBeenCalled();
    expect(createCommentFromEmailMock).not.toHaveBeenCalled();
    expect(processInboundEmailArtifactsBestEffortMock).not.toHaveBeenCalled();
  });

  it('skip outcome works without configured inbound defaults', async () => {
    resolveInboundTicketDefaultsMock.mockResolvedValue(null);
    evaluateInboundEmailRulesMock.mockResolvedValue({
      outcome: { kind: 'skip', ruleId: 'rule-9', ruleName: 'Status updates', via: 'action' },
      trace: [{ ruleId: 'rule-9' }],
    });

    const result = await run();

    expect(result).toMatchObject({ outcome: 'skipped', reason: 'rule_skip' });
    // The skip resolved before defaults were ever needed.
    expect(resolveInboundTicketDefaultsMock).not.toHaveBeenCalled();
  });

  it('assign_client outcome wins over sender/domain matching and uses the client primary contact', async () => {
    evaluateInboundEmailRulesMock.mockResolvedValue({
      outcome: {
        kind: 'assign_client',
        ruleId: 'rule-1',
        ruleName: 'Huntress routing',
        clientId: 'client-acme',
        extractedValue: 'acme corp',
        matchSource: 'rule_extraction',
      },
      trace: [{ ruleId: 'rule-1' }],
    });
    findValidClientPrimaryContactIdMock.mockResolvedValue('acme-primary-contact');

    const result = await run();

    expect(result).toMatchObject({ outcome: 'created', ticketId: 'ticket-1' });
    expect(findClientIdByInboundEmailDomainMock).not.toHaveBeenCalled();
    expect(findValidClientPrimaryContactIdMock).toHaveBeenCalledWith('client-acme', 'tenant-1');
    expect(createTicketFromEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: 'client-acme',
        contact_id: 'acme-primary-contact',
        email_metadata: expect.objectContaining({
          appliedRuleId: 'rule-1',
          appliedRuleName: 'Huntress routing',
          clientMatchSource: 'rule_extraction',
        }),
      }),
      'tenant-1'
    );
  });

  it('assign_client keeps the sender contact when it belongs to the assigned client', async () => {
    evaluateInboundEmailRulesMock.mockResolvedValue({
      outcome: {
        kind: 'assign_client',
        ruleId: 'rule-1',
        ruleName: 'Huntress routing',
        clientId: 'client-acme',
        extractedValue: 'acme corp',
        matchSource: 'rule_extraction',
      },
      trace: [{ ruleId: 'rule-1' }],
    });
    findContactByEmailMock.mockResolvedValue({
      contact_id: 'contact-in-acme',
      client_id: 'client-acme',
      email: 'alerts@huntress.com',
      name: 'Huntress Integration',
      client_name: 'Acme Corp',
    });

    await run();

    expect(findValidClientPrimaryContactIdMock).not.toHaveBeenCalled();
    expect(createTicketFromEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: 'client-acme',
        contact_id: 'contact-in-acme',
      }),
      'tenant-1'
    );
    expect(createCommentFromEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ contact_id: 'contact-in-acme' }),
      'tenant-1'
    );
  });

  it('assign_client overrides an exact sender contact match in a different client', async () => {
    evaluateInboundEmailRulesMock.mockResolvedValue({
      outcome: {
        kind: 'assign_client',
        ruleId: 'rule-1',
        ruleName: 'Huntress routing',
        clientId: 'client-acme',
        extractedValue: 'acme corp',
        matchSource: 'rule_extraction',
      },
      trace: [{ ruleId: 'rule-1' }],
    });
    findContactByEmailMock.mockResolvedValue({
      contact_id: 'contact-other',
      client_id: 'client-other',
      email: 'alerts@huntress.com',
      name: 'Huntress Vendor Contact',
      client_name: 'Huntress (vendor)',
    });
    findValidClientPrimaryContactIdMock.mockResolvedValue('acme-primary-contact');

    await run();

    expect(createTicketFromEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: 'client-acme',
        contact_id: 'acme-primary-contact',
      }),
      'tenant-1'
    );
    // The mismatched sender contact must not be attributed as the comment author.
    expect(createCommentFromEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ contact_id: undefined }),
      'tenant-1'
    );
    // Destination cascade sees the rule client via the domain-match slot.
    expect(resolveEffectiveInboundTicketDefaultsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        matchedContactId: null,
        domainMatchedClientId: 'client-acme',
      })
    );
  });

  it('set_destination outcome applies the rule defaults above the cascade', async () => {
    const ruleDefaults = {
      client_id: null,
      board_id: 'security-board',
      status_id: 'sec-status',
      priority_id: 'sec-priority',
      entered_by: null,
    };
    evaluateInboundEmailRulesMock.mockResolvedValue({
      outcome: {
        kind: 'set_destination',
        ruleId: 'rule-2',
        ruleName: 'Security routing',
        defaults: ruleDefaults,
      },
      trace: [{ ruleId: 'rule-2' }],
    });
    findContactByEmailMock.mockResolvedValue({
      contact_id: 'contact-123',
      client_id: 'client-123',
      email: 'alerts@huntress.com',
      name: 'Known Sender',
      client_name: 'Client Co',
    });

    await run();

    expect(resolveEffectiveInboundTicketDefaultsMock).not.toHaveBeenCalled();
    expect(createTicketFromEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        board_id: 'security-board',
        status_id: 'sec-status',
        priority_id: 'sec-priority',
        // Sender matching still attributes the client/contact.
        client_id: 'client-123',
        contact_id: 'contact-123',
      }),
      'tenant-1'
    );
  });

  it('fallback_destination outcome creates the ticket at the fallback even without provider defaults', async () => {
    resolveInboundTicketDefaultsMock.mockResolvedValue(null);
    const fallbackDefaults = {
      client_id: 'triage-client',
      board_id: 'triage-board',
      status_id: 'triage-status',
      priority_id: 'triage-priority',
      entered_by: null,
    };
    evaluateInboundEmailRulesMock.mockResolvedValue({
      outcome: {
        kind: 'fallback_destination',
        ruleId: 'rule-1',
        ruleName: 'Huntress routing',
        defaults: fallbackDefaults,
      },
      trace: [{ ruleId: 'rule-1' }],
    });

    const result = await run();

    expect(result).toMatchObject({ outcome: 'created' });
    expect(createTicketFromEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: 'triage-client',
        board_id: 'triage-board',
        email_metadata: expect.objectContaining({
          appliedRuleId: 'rule-1',
        }),
      }),
      'tenant-1'
    );
  });

  it('none outcome leaves the legacy pipeline behavior unchanged', async () => {
    const result = await run();

    expect(result).toMatchObject({ outcome: 'created', ticketId: 'ticket-1' });
    expect(createTicketFromEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: 'default-client-id',
        board_id: 'board-id',
        email_metadata: expect.objectContaining({
          clientMatchSource: 'provider_default',
        }),
      }),
      'tenant-1'
    );
    const ticketPayload = createTicketFromEmailMock.mock.calls[0][0];
    expect(ticketPayload.email_metadata.appliedRuleId).toBeUndefined();
  });

  it('rules are not evaluated for replies that thread onto existing tickets', async () => {
    findTicketByReplyTokenMock.mockResolvedValue(null);
    findTicketByEmailThreadMock.mockResolvedValue({ ticketId: 'ticket-existing' });
    // Threaded-reply path needs comment dedup + reopen policy lookups to resolve.
    withAdminTransactionMock.mockImplementation(async (callback: (trx: any) => Promise<any>) => {
      const trx = vi.fn((table: string) => {
        if (table === 'tickets') {
          return makeQueryBuilder({
            ticket_id: 'ticket-existing',
            board_id: 'board-id',
            status_id: 'status-open',
            is_closed: false,
            closed_at: null,
          });
        }
        return makeQueryBuilder(undefined);
      });
      return callback(trx);
    });

    const result = await run({
      inReplyTo: '<original@example.com>',
    });

    expect(result).toMatchObject({ outcome: 'replied', ticketId: 'ticket-existing' });
    expect(evaluateInboundEmailRulesMock).not.toHaveBeenCalled();
  });
});
