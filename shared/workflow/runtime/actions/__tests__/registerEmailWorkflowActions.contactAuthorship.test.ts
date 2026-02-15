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

const createTicketFromEmailMock = vi.fn(async (..._args: any[]) => ({
  ticket_id: 'ticket-1',
  ticket_number: 'T-1',
}));
const createCommentFromEmailMock = vi.fn(async (..._args: any[]) => 'comment-1');
const findContactByEmailMock = vi.fn(async (..._args: any[]) => null);

vi.mock('../../registries/actionRegistry', () => ({
  getActionRegistryV2: () => getActionRegistryV2Mock(),
}));

vi.mock('../../../actions/emailWorkflowActions', () => ({
  findContactByEmail: findContactByEmailMock,
  findTicketByEmailThread: vi.fn(),
  findTicketByReplyToken: vi.fn(),
  resolveInboundTicketDefaults: vi.fn(),
  createTicketFromEmail: createTicketFromEmailMock,
  createCommentFromEmail: createCommentFromEmailMock,
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
    findContactByEmailMock.mockClear();
    findContactByEmailMock.mockResolvedValue(null);
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

  it('T023: create_comment_from_parsed_email resolves sender within ticket context before writing comment', async () => {
    findContactByEmailMock.mockResolvedValue({
      contact_id: 'contact-ticket-1',
      client_id: 'client-1',
      user_id: 'client-user-1',
      email: 'contact@example.com',
      name: 'Contact',
      client_name: 'Client',
    });

    const { registerEmailWorkflowActionsV2 } = await import('../registerEmailWorkflowActions');
    registerEmailWorkflowActionsV2();

    const action = registeredActions.find((entry) => entry.id === 'create_comment_from_parsed_email');
    expect(action).toBeDefined();

    await action!.handler(
      {
        ticketId: 'ticket-ctx-1',
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
          confidence: 'high',
          metadata: {},
        },
      },
      { tenantId: 'tenant-1' }
    );

    expect(findContactByEmailMock).toHaveBeenCalledWith('contact@example.com', 'tenant-1', {
      ticketId: 'ticket-ctx-1',
    });
    expect(createCommentFromEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket_id: 'ticket-ctx-1',
        author_type: 'contact',
        author_id: 'client-user-1',
        contact_id: 'contact-ticket-1',
      }),
      'tenant-1'
    );
  });

  it('T024: find_contact_by_email action forwards optional matching context', async () => {
    findContactByEmailMock.mockResolvedValue(null);

    const { registerEmailWorkflowActionsV2 } = await import('../registerEmailWorkflowActions');
    registerEmailWorkflowActionsV2();

    const action = registeredActions.find((entry) => entry.id === 'find_contact_by_email');
    expect(action).toBeDefined();

    await action!.handler(
      {
        email: 'contact@example.com',
        ticketId: 'ticket-1',
        ticketClientId: 'client-1',
        ticketContactId: 'contact-1',
        defaultClientId: 'default-client-1',
      },
      { tenantId: 'tenant-1' }
    );

    expect(findContactByEmailMock).toHaveBeenCalledWith('contact@example.com', 'tenant-1', {
      ticketId: 'ticket-1',
      ticketClientId: 'client-1',
      ticketContactId: 'contact-1',
      defaultClientId: 'default-client-1',
    });
  });

});
