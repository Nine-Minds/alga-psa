import { beforeEach, describe, expect, it, vi } from 'vitest';

const withAdminTransactionMock = vi.fn(async (callback: (trx: any) => Promise<any>) =>
  callback(trxMock)
);
const createCommentMock = vi.fn();
const publishWorkflowEventMock = vi.fn();

const tenantSettingsFirstMock = vi.fn(async () => ({
  ticket_display_settings: { responseStateTrackingEnabled: false },
}));

const trxMock = vi.fn((table: string) => {
  if (table === 'tenant_settings') {
    const whereMock = vi.fn().mockReturnValue({ first: tenantSettingsFirstMock });
    return {
      select: vi.fn().mockReturnValue({ where: whereMock }),
    };
  }

  throw new Error(`Unexpected table access in test: ${table}`);
});

vi.mock('@alga-psa/db', () => ({
  withAdminTransaction: (callback: (trx: any) => Promise<any>) =>
    withAdminTransactionMock(callback),
}));

vi.mock('@alga-psa/shared/models/ticketModel', () => ({
  TicketModel: {
    createComment: (...args: any[]) => createCommentMock(...args),
  },
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: (...args: any[]) => publishWorkflowEventMock(...args),
}));

vi.mock('@alga-psa/workflows/adapters/workflowEventPublisher', () => ({
  WorkflowEventPublisher: class WorkflowEventPublisher {},
}));

vi.mock('@alga-psa/workflows/adapters/workflowAnalyticsTracker', () => ({
  WorkflowAnalyticsTracker: class WorkflowAnalyticsTracker {},
}));

describe('createCommentFromEmail note_index overflow fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tenantSettingsFirstMock.mockResolvedValue({
      ticket_display_settings: { responseStateTrackingEnabled: false },
    });
    createCommentMock.mockResolvedValue({ comment_id: 'comment-1' });
  });

  it('retries with sanitized content when Postgres tsvector limit is exceeded', async () => {
    createCommentMock
      .mockRejectedValueOnce(
        new Error('insert into comments ... string is too long for tsvector (1479964 bytes, max 1048575 bytes)')
      )
      .mockResolvedValueOnce({ comment_id: 'comment-2' });

    const { createCommentFromEmail } = await import('@alga-psa/workflows/actions/emailWorkflowActions');
    const contentWithDataImage =
      'Intro <img src="data:image/png;base64,' + 'A'.repeat(6_000) + '" /> outro';

    const commentId = await createCommentFromEmail(
      {
        ticket_id: 'ticket-1',
        content: contentWithDataImage,
        author_type: 'contact',
      },
      'tenant-1'
    );

    expect(commentId).toBe('comment-2');
    expect(createCommentMock).toHaveBeenCalledTimes(2);
    expect(createCommentMock.mock.calls[1][0].content).not.toContain('data:image/');
    expect(createCommentMock.mock.calls[1][0].content).toContain('[inline-image]');
  });

  it('falls back to minimal placeholder content when sanitized retry still overflows', async () => {
    createCommentMock
      .mockRejectedValueOnce(new Error('string is too long for tsvector'))
      .mockRejectedValueOnce(new Error('string is too long for tsvector'))
      .mockResolvedValueOnce({ comment_id: 'comment-3' });

    const { createCommentFromEmail } = await import('@alga-psa/workflows/actions/emailWorkflowActions');
    const commentId = await createCommentFromEmail(
      {
        ticket_id: 'ticket-2',
        content: 'x'.repeat(2_000_000),
        author_type: 'contact',
      },
      'tenant-1'
    );

    expect(commentId).toBe('comment-3');
    expect(createCommentMock).toHaveBeenCalledTimes(3);
    expect(createCommentMock.mock.calls[2][0].content).toContain(
      'Inbound email content trimmed due to indexing limits'
    );
  });
});
