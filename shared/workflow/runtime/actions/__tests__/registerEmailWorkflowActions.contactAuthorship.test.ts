import fs from 'fs';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type RegisteredAction = {
  id: string;
  inputSchema: { parse: (input: unknown) => any };
  outputSchema?: { parse: (output: unknown) => any };
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
  resolveEffectiveInboundTicketDefaults: vi.fn(async (input: any) => ({
    defaults: input?.providerDefaults ?? null,
    source: 'provider_default',
  })),
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

  it('T037: workflow acknowledgement mapping keeps using matchedClient.email as the primary contact email', async () => {
    const workflowPath = path.resolve(
      __dirname,
      '../../workflows/email-processing-workflow.v2.json'
    );
    const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
    const findStepById = (node: any, id: string): any | null => {
      if (Array.isArray(node)) {
        for (const entry of node) {
          const found = findStepById(entry, id);
          if (found) return found;
        }
        return null;
      }
      if (node && typeof node === 'object') {
        if (node.id === id) {
          return node;
        }
        for (const value of Object.values(node)) {
          const found = findStepById(value, id);
          if (found) return found;
        }
      }
      return null;
    };
    const sendAckStep = findStepById(workflow, 'ack-email-action');

    expect(sendAckStep.config.actionId).toBe('send_ticket_acknowledgement_email');
    expect(sendAckStep.config.inputMapping.contactEmail).toEqual({
      $expr: 'vars.ticketContext.matchedClient.email',
    });
  });

  it('T038: find_contact_by_email output schema preserves matched_email separately from the primary contact email', async () => {
    findContactByEmailMock.mockResolvedValue({
      contact_id: 'contact-1',
      name: 'Billing Contact',
      email: 'primary@example.com',
      matched_email: 'billing@example.com',
      client_id: 'client-1',
      client_name: 'Client 1',
    });

    const { registerEmailWorkflowActionsV2 } = await import('../registerEmailWorkflowActions');
    registerEmailWorkflowActionsV2();

    const action = registeredActions.find((entry) => entry.id === 'find_contact_by_email');
    expect(action).toBeDefined();

    const output = await action!.handler(
      {
        email: 'billing@example.com',
      },
      { tenantId: 'tenant-1' }
    );

    expect(action!.outputSchema?.parse(output)).toEqual({
      success: true,
      contact: {
        contact_id: 'contact-1',
        name: 'Billing Contact',
        email: 'primary@example.com',
        matched_email: 'billing@example.com',
        client_id: 'client-1',
        client_name: 'Client 1',
      },
    });
  });

  it('T025: unmatched parsed-email sender defaults to contact authorship', async () => {
    findContactByEmailMock.mockResolvedValue(null);

    const { registerEmailWorkflowActionsV2 } = await import('../registerEmailWorkflowActions');
    registerEmailWorkflowActionsV2();

    const action = registeredActions.find((entry) => entry.id === 'create_comment_from_parsed_email');
    expect(action).toBeDefined();

    await action!.handler(
      {
        ticketId: 'ticket-unmatched-1',
        emailData: {
          id: 'email-unmatched-1',
          subject: 'Inbound subject',
          body: { text: 'Inbound body' },
          from: { email: 'unknown@example.com' },
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

    expect(createCommentFromEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket_id: 'ticket-unmatched-1',
        author_type: 'contact',
        author_id: undefined,
        contact_id: undefined,
      }),
      'tenant-1'
    );
  });

  it('runtime email actions keep primary contact email and matched sender email separate', async () => {
    findContactByEmailMock.mockResolvedValue({
      contact_id: 'contact-1',
      client_id: 'client-1',
      user_id: 'client-user-1',
      email: 'primary@example.com',
      matched_email: 'billing@example.com',
      name: 'Billing Contact',
      client_name: 'Client One',
    });

    const { registerEmailWorkflowActionsV2 } = await import('../registerEmailWorkflowActions');
    registerEmailWorkflowActionsV2();

    const findContactAction = registeredActions.find((entry) => entry.id === 'find_contact_by_email');
    expect(findContactAction).toBeDefined();

    const findContactResult = await findContactAction!.handler(
      {
        email: 'billing@example.com',
      },
      { tenantId: 'tenant-1' }
    );

    const parsedFindContactResult = findContactAction!.outputSchema!.parse(findContactResult);
    expect(parsedFindContactResult.contact?.email).toBe('primary@example.com');
    expect(parsedFindContactResult.contact?.matched_email).toBe('billing@example.com');

    const resolveContextAction = registeredActions.find((entry) => entry.id === 'resolve_inbound_ticket_context');
    expect(resolveContextAction).toBeDefined();

    const contextResult = await resolveContextAction!.handler(
      {
        senderEmail: 'billing@example.com',
        providerId: 'provider-1',
      },
      { tenantId: 'tenant-1' }
    );

    expect(contextResult.matchedClient).toMatchObject({
      email: 'primary@example.com',
      matched_email: 'billing@example.com',
      contact_id: 'contact-1',
    });
  });

});
