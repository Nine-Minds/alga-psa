import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateTicketStateMock = vi.fn();
const trxMock = vi.fn((table: string) => {
  if (table !== 'tickets') {
    throw new Error(`Unexpected table access in test: ${table}`);
  }

  return {
    where: vi.fn().mockReturnValue({
      update: updateTicketStateMock,
    }),
  };
});

const withAdminTransactionMock = vi.fn(async (callback: (trx: any) => Promise<any>) =>
  callback(trxMock)
);
const createCommentMock = vi.fn();
const publishWorkflowEventMock = vi.fn();

vi.mock('@alga-psa/db', () => ({
  withAdminTransaction: (callback: (trx: any) => Promise<any>) =>
    withAdminTransactionMock(callback),
}));

vi.mock('@alga-psa/shared/models/ticketModel', () => ({
  TicketModel: {
    createComment: (...args: any[]) => createCommentMock(...args),
  },
}));

vi.mock('../../adapters/workflowEventPublisher', () => ({
  WorkflowEventPublisher: class WorkflowEventPublisher {},
}));

vi.mock('../../adapters/workflowAnalyticsTracker', () => ({
  WorkflowAnalyticsTracker: class WorkflowAnalyticsTracker {},
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: (...args: any[]) => publishWorkflowEventMock(...args),
}));

describe('createCommentFromEmail response source metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createCommentMock.mockResolvedValue({
      comment_id: 'comment-1',
    });
    updateTicketStateMock.mockResolvedValue(1);
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
});
