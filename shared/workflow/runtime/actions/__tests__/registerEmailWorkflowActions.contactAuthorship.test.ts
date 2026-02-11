import { beforeEach, describe, expect, it, vi } from 'vitest';

type RegisteredAction = {
  id: string;
  inputSchema: { parse: (input: unknown) => any };
  handler: (input: any, ctx: { tenantId?: string }) => Promise<any>;
};

const registeredActions: RegisteredAction[] = [];
const registerMock = vi.fn((action: RegisteredAction) => {
  registeredActions.push(action);
});
const getActionRegistryV2Mock = vi.fn(() => ({ register: registerMock }));

const createTicketFromEmailMock = vi.fn(async () => ({
  ticket_id: 'ticket-1',
  ticket_number: 'T-1',
}));
const createCommentFromEmailMock = vi.fn(async () => 'comment-1');

vi.mock('../../registries/actionRegistry', () => ({
  getActionRegistryV2: () => getActionRegistryV2Mock(),
}));

vi.mock('../../../actions/emailWorkflowActions', () => ({
  findContactByEmail: vi.fn(),
  findTicketByEmailThread: vi.fn(),
  findTicketByReplyToken: vi.fn(),
  resolveInboundTicketDefaults: vi.fn(),
  createTicketFromEmail: (...args: any[]) => createTicketFromEmailMock(...args),
  createCommentFromEmail: (...args: any[]) => createCommentFromEmailMock(...args),
  processEmailAttachment: vi.fn(),
  parseEmailReplyBody: vi.fn(),
  createClientFromEmail: vi.fn(),
  getClientByIdForEmail: vi.fn(),
  createOrFindContact: vi.fn(),
  saveEmailClientAssociation: vi.fn(),
}));

describe('registerEmailWorkflowActionsV2 contact authorship', () => {
  beforeEach(() => {
    registeredActions.length = 0;
    registerMock.mockClear();
    getActionRegistryV2Mock.mockClear();
    createTicketFromEmailMock.mockClear();
    createCommentFromEmailMock.mockClear();
  });

  it('T020: create_comment_from_email action schema accepts contact_id in input', async () => {
    const { registerEmailWorkflowActionsV2 } = await import('../registerEmailWorkflowActions');
    registerEmailWorkflowActionsV2();

    const action = registeredActions.find((entry) => entry.id === 'create_comment_from_email');
    expect(action).toBeDefined();

    const parsed = action!.inputSchema.parse({
      ticket_id: 'ticket-1',
      content: 'hello',
      author_type: 'contact',
      contact_id: 'contact-1',
    });

    expect(parsed.contact_id).toBe('contact-1');
  });

  it('T021: initial ticket+comment runtime action forwards contact_id to createCommentFromEmail', async () => {
    const { registerEmailWorkflowActionsV2 } = await import('../registerEmailWorkflowActions');
    registerEmailWorkflowActionsV2();

    const action = registeredActions.find((entry) => entry.id === 'create_ticket_with_initial_comment');
    expect(action).toBeDefined();

    await action!.handler(
      {
        emailData: {
          id: 'email-1',
          subject: 'Inbound subject',
          body: { text: 'Inbound body' },
          from: { email: 'contact@example.com' },
          to: [{ email: 'support@example.com' }],
        },
        parsedEmail: {
          sanitizedText: 'Inbound body',
          sanitizedHtml: undefined,
        },
        ticketDefaults: {
          board_id: 'board-1',
          status_id: 'status-1',
          priority_id: 'priority-1',
          entered_by: 'user-1',
        },
        targetClientId: 'client-1',
        targetContactId: 'contact-1',
        targetAuthorUserId: undefined,
        targetLocationId: null,
      },
      { tenantId: 'tenant-1' }
    );

    expect(createCommentFromEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket_id: 'ticket-1',
        contact_id: 'contact-1',
      }),
      'tenant-1'
    );
  });

  it('T022: create_comment_from_email runtime action forwards contact_id to shared email action', async () => {
    const { registerEmailWorkflowActionsV2 } = await import('../registerEmailWorkflowActions');
    registerEmailWorkflowActionsV2();

    const action = registeredActions.find((entry) => entry.id === 'create_comment_from_email');
    expect(action).toBeDefined();

    await action!.handler(
      {
        ticket_id: 'ticket-1',
        content: 'hello',
        author_type: 'contact',
        contact_id: 'contact-1',
      },
      { tenantId: 'tenant-1' }
    );

    expect(createCommentFromEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket_id: 'ticket-1',
        contact_id: 'contact-1',
      }),
      'tenant-1'
    );
  });
});
