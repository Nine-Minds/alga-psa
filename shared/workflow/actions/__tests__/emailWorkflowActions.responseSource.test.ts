import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateTicketStateMock = vi.fn();
const ticketAuditLogInsertMock = vi.fn(async () => undefined);
const displayNameFirstMock = vi.fn(async () => null);
const tenantSettingsFirstMock = vi.fn(async () => ({
  ticket_display_settings: { responseStateTrackingEnabled: true },
}));
const ticketStateFirstMock = vi.fn(async () => ({ response_state: null as string | null }));
const trxMock = vi.fn((table: string) => {
  if (table === 'tenant_settings') {
    return {
      select: vi.fn().mockReturnThis(),
      first: tenantSettingsFirstMock,
    };
  }

  if (table === 'ticket_audit_logs') {
    return {
      insert: ticketAuditLogInsertMock,
    };
  }

  if (table === 'contacts' || table === 'users') {
    return {
      where: vi.fn().mockReturnThis(),
      first: displayNameFirstMock,
    };
  }

  if (table !== 'tickets') {
    throw new Error(`Unexpected table access in test: ${table}`);
  }

  return {
    select: () => ({ where: () => ({ first: ticketStateFirstMock }) }),
    where: vi.fn().mockReturnValue({ update: updateTicketStateMock }),
  };
});

const withAdminTransactionMock = vi.fn(async (callback: (trx: any) => Promise<any>) =>
  callback(trxMock)
);
const createCommentMock = vi.fn();
const publishWorkflowEventMock = vi.fn();
const registerActionMock = vi.fn();
const publisherOptionsMock = vi.fn();

vi.mock('../../runtime/registries/actionRegistry', () => ({
  getActionRegistryV2: () => ({ register: registerActionMock }),
}));

vi.mock('@alga-psa/db', () => ({
  registerAfterCommit: vi.fn(),
  withAdminTransaction: (callback: (trx: any) => Promise<any>) =>
    withAdminTransactionMock(callback),
  tenantDb: (trx: any) => ({
    table: (tableName: string) => trx(tableName),
  }),
}));

vi.mock('@alga-psa/shared/models/ticketModel', () => ({
  TicketModel: {
    createComment: (...args: any[]) => createCommentMock(...args),
  },
}));

vi.mock('../../adapters/workflowEventPublisher', () => ({
  WorkflowEventPublisher: class WorkflowEventPublisher {
    constructor(options: unknown) { publisherOptionsMock(options); }
  },
}));

vi.mock('../../adapters/workflowAnalyticsTracker', () => ({
  WorkflowAnalyticsTracker: class WorkflowAnalyticsTracker {},
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: (...args: any[]) => publishWorkflowEventMock(...args),
  publishEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

describe('createCommentFromEmail response source metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createCommentMock.mockResolvedValue({
      comment_id: 'comment-1',
    });
    tenantSettingsFirstMock.mockResolvedValue({
      ticket_display_settings: { responseStateTrackingEnabled: true },
    });
    updateTicketStateMock.mockResolvedValue(1);
    ticketAuditLogInsertMock.mockResolvedValue(undefined);
    displayNameFirstMock.mockResolvedValue(null);
    ticketStateFirstMock.mockResolvedValue({ response_state: null });
  });

  it('processes an attachment-only workflow reply through the writer and its side effects', async () => {
    const { registerEmailWorkflowActionsV2 } = await import('../../runtime/actions/registerEmailWorkflowActions');
    const { parseEmailReply } = await import('../../../lib/email/replyParser');
    registerEmailWorkflowActionsV2();
    const action = registerActionMock.mock.calls.map(([entry]) => entry)
      .find((entry) => entry.id === 'create_comment_from_parsed_email');
    ticketStateFirstMock.mockResolvedValue({ response_state: 'awaiting_client' });
    createCommentMock.mockResolvedValue({ comment_id: 'comment-1', is_internal: false });
    const body = { text: '', html: '<div dir="ltr"><br></div>' };
    const input = action.inputSchema.parse({
      ticketId: 'ticket-1',
      contact_id: 'contact-1',
      emailData: {
        id: 'attachment-only-reply',
        subject: 'Re: Deployment failed',
        from: { email: 'client@example.com' },
        inReplyTo: '<original-message@example.com>',
        body,
        attachments: [{ id: 'attachment-1', name: 'diagnostics.txt', contentType: 'text/plain', size: 128 }],
      },
      parsedEmail: parseEmailReply(body),
    });

    expect(await action.handler(input, { tenantId: 'tenant-1' })).toEqual({ comment_id: 'comment-1' });
    expect(createCommentMock).toHaveBeenCalledTimes(1);
    expect(createCommentMock.mock.calls[0][0]).toMatchObject({
      author_type: 'contact',
      is_internal: false,
      metadata: { responseSource: 'inbound_email' },
    });
    expect(updateTicketStateMock).toHaveBeenCalledWith({ response_state: 'awaiting_internal' });
    expect(ticketAuditLogInsertMock).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'TICKET_CUSTOMER_REPLIED',
      entity_id: 'comment-1',
      source: 'inbound_email',
    }));
    // The model receives its normal event publisher with comment notifications enabled.
    expect(publisherOptionsMock).toHaveBeenCalledWith(expect.objectContaining({ suppressCommentEmail: false }));
    expect(createCommentMock.mock.calls[0][3]).toBeDefined();
  });

  it('T002: persists metadata.responseSource=inbound_email', async () => {
    const { createCommentFromEmail } = await import('../emailWorkflowActions');

    await createCommentFromEmail(
      {
        ticket_id: 'ticket-1',
        content: 'hello',
        author_type: 'contact',
        metadata: {
          email: {
            messageId: 'message-1',
          },
        },
      },
      'tenant-1'
    );

    const createCommentInput = createCommentMock.mock.calls[0][0];
    expect(createCommentInput.metadata.responseSource).toBe('inbound_email');
  });

  it('T003: includes normalized provider type when available', async () => {
    const { createCommentFromEmail } = await import('../emailWorkflowActions');

    await createCommentFromEmail(
      {
        ticket_id: 'ticket-1',
        content: 'hello',
        author_type: 'contact',
        metadata: {
          email: {
            messageId: 'message-2',
          },
        },
        inboundReplyEvent: {
          messageId: 'message-2',
          from: 'client@example.com',
          to: ['support@example.com'],
          provider: 'microsoft',
          matchedBy: 'thread_headers',
        },
      },
      'tenant-1'
    );

    const createCommentInput = createCommentMock.mock.calls[0][0];
    expect(createCommentInput.metadata.email.provider).toBe('microsoft');
    expect(createCommentInput.metadata.email.providerType).toBe('microsoft');
  });

  it('backfills the sender address so an unmatched sender still has a display identity', async () => {
    const { createCommentFromEmail } = await import('../emailWorkflowActions');

    await createCommentFromEmail(
      {
        ticket_id: 'ticket-1',
        content: 'hello',
        inboundReplyEvent: {
          messageId: 'message-3',
          from: 'stranger@example.com',
          to: ['support@example.com'],
          provider: 'google',
          matchedBy: 'thread_headers',
        },
      },
      'tenant-1'
    );

    const createCommentInput = createCommentMock.mock.calls[0][0];
    expect(createCommentInput.metadata.email.fromAddress).toBe('stranger@example.com');
  });

  it('never overwrites a sender address the parser already captured', async () => {
    const { createCommentFromEmail } = await import('../emailWorkflowActions');

    await createCommentFromEmail(
      {
        ticket_id: 'ticket-1',
        content: 'hello',
        metadata: { email: { fromAddress: 'parsed@example.com' } },
        inboundReplyEvent: {
          messageId: 'message-4',
          from: 'envelope@example.com',
          to: ['support@example.com'],
          provider: 'google',
          matchedBy: 'thread_headers',
        },
      },
      'tenant-1'
    );

    const createCommentInput = createCommentMock.mock.calls[0][0];
    expect(createCommentInput.metadata.email.fromAddress).toBe('parsed@example.com');
  });

  it.each([
    ['google', 'T017'],
    ['microsoft', 'T018'],
    ['imap', 'T019'],
  ])(
    '%s inbound flow resolves to inbound_email metadata source (%s)',
    async (provider) => {
      const { createCommentFromEmail } = await import('../emailWorkflowActions');

      await createCommentFromEmail(
        {
          ticket_id: `ticket-${provider}`,
          content: `content-${provider}`,
          author_type: 'contact',
          metadata: {
            email: {
              messageId: `message-${provider}`,
            },
          },
          inboundReplyEvent: {
            messageId: `message-${provider}`,
            from: 'client@example.com',
            to: ['support@example.com'],
            provider,
            matchedBy: 'thread_headers',
          },
        },
        'tenant-1'
      );

      const createCommentInput = createCommentMock.mock.calls[0][0];
      expect(createCommentInput.metadata.responseSource).toBe('inbound_email');
      expect(createCommentInput.metadata.email.provider).toBe(provider);
    }
  );

  it('T011: forwards contact_id to TicketModel.createComment when provided', async () => {
    const { createCommentFromEmail } = await import('../emailWorkflowActions');

    await createCommentFromEmail(
      {
        ticket_id: 'ticket-1',
        content: 'hello',
        author_type: 'contact',
        contact_id: '00000000-0000-0000-0000-000000000456',
      },
      'tenant-1'
    );

    const createCommentInput = createCommentMock.mock.calls[0][0];
    expect(createCommentInput.contact_id).toBe('00000000-0000-0000-0000-000000000456');
  });

  it('T012: forwards both author_id and contact_id when both are present', async () => {
    const { createCommentFromEmail } = await import('../emailWorkflowActions');

    await createCommentFromEmail(
      {
        ticket_id: 'ticket-1',
        content: 'hello',
        author_type: 'contact',
        author_id: '00000000-0000-0000-0000-000000000123',
        contact_id: '00000000-0000-0000-0000-000000000456',
      },
      'tenant-1'
    );

    const createCommentInput = createCommentMock.mock.calls[0][0];
    expect(createCommentInput.author_id).toBe('00000000-0000-0000-0000-000000000123');
    expect(createCommentInput.contact_id).toBe('00000000-0000-0000-0000-000000000456');
  });

  it('T020: keeps comment response-state semantics unchanged (still non-internal)', async () => {
    const { createCommentFromEmail } = await import('../emailWorkflowActions');

    await createCommentFromEmail(
      {
        ticket_id: 'ticket-1',
        content: 'reply',
      },
      'tenant-1'
    );

    const createCommentInput = createCommentMock.mock.calls[0][0];
    expect(createCommentInput.is_internal).toBe(false);
    expect(createCommentInput.is_resolution).toBe(false);
  });

  it('T021: forwards author_id when provided for matched client user association', async () => {
    const { createCommentFromEmail } = await import('../emailWorkflowActions');

    await createCommentFromEmail(
      {
        ticket_id: 'ticket-1',
        content: 'hello',
        author_type: 'contact',
        author_id: '00000000-0000-0000-0000-000000000123',
      },
      'tenant-1'
    );

    const createCommentInput = createCommentMock.mock.calls[0][0];
    expect(createCommentInput.author_id).toBe('00000000-0000-0000-0000-000000000123');
  });

  it('D3: response_state follows the stored visibility — a comment stored internal never flips it', async () => {
    createCommentMock.mockResolvedValue({ comment_id: 'comment-1', is_internal: true });
    const { createCommentFromEmail } = await import('../emailWorkflowActions');

    await createCommentFromEmail(
      { ticket_id: 'ticket-1', content: 'reply', author_type: 'contact' },
      'tenant-1'
    );

    expect(updateTicketStateMock).not.toHaveBeenCalled();
  });

  it('D3: a contact comment stored public sets awaiting_internal ("waiting on us")', async () => {
    createCommentMock.mockResolvedValue({ comment_id: 'comment-1', is_internal: false });
    const { createCommentFromEmail } = await import('../emailWorkflowActions');

    await createCommentFromEmail(
      { ticket_id: 'ticket-1', content: 'reply', author_type: 'contact' },
      'tenant-1'
    );

    expect(updateTicketStateMock).toHaveBeenCalledWith({ response_state: 'awaiting_internal' });
  });
});
