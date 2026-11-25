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
const findTicketByReplyTokenMock = vi.fn(async (..._args: any[]) => null);
const findTicketByEmailThreadMock = vi.fn(async (..._args: any[]) => null);

vi.mock('../../registries/actionRegistry', () => ({
  getActionRegistryV2: () => getActionRegistryV2Mock(),
}));

vi.mock('../../../actions/emailWorkflowActions', () => ({
  findContactByEmail: findContactByEmailMock,
  findTicketByEmailThread: (...args: any[]) => findTicketByEmailThreadMock(...args),
  findTicketByReplyToken: (...args: any[]) => findTicketByReplyTokenMock(...args),
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
    findTicketByReplyTokenMock.mockReset();
    findTicketByEmailThreadMock.mockReset();
    findTicketByEmailThreadMock.mockResolvedValue(null);
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

  it('marks the initial comment as the opener with the non-inline attachment count (and does not use the legacy suppress flag)', async () => {
    const { registerEmailWorkflowActionsV2 } = await import('../registerEmailWorkflowActions');
    registerEmailWorkflowActionsV2();
    const action = registeredActions.find((entry) => entry.id === 'create_ticket_with_initial_comment');

    await action!.handler(
      {
        emailData: {
          id: 'email-1',
          subject: 'Inbound subject',
          body: { text: 'Inbound body' },
          from: { email: 'contact@example.com' },
          to: [{ email: 'support@example.com' }],
          attachments: [
            { id: 'a1', name: 'invoice.pdf', contentType: 'application/pdf', size: 10 },
            { id: 'a2', name: 'logo.png', contentType: 'image/png', size: 5, contentId: 'cid-logo' },
            { id: 'a3', name: 'photo.jpg', contentType: 'image/jpeg', size: 7 },
          ],
        },
        parsedEmail: { sanitizedText: 'Inbound body' },
        ticketDefaults: { board_id: 'board-1', status_id: 'status-1', priority_id: 'priority-1', entered_by: 'user-1' },
        targetClientId: 'client-1',
        targetContactId: 'contact-1',
        targetLocationId: null,
      },
      { tenantId: 'tenant-1' }
    );

    const payload = createCommentFromEmailMock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.opensTicket).toBe(true);
    expect(payload.attachmentCount).toBe(2); // inline cid image is not counted
    expect('suppressTechEmailNotification' in payload).toBe(false);
  });

  it('leaves attachmentCount undefined when the email lists no attachments array', async () => {
    const { registerEmailWorkflowActionsV2 } = await import('../registerEmailWorkflowActions');
    registerEmailWorkflowActionsV2();
    const action = registeredActions.find((entry) => entry.id === 'create_ticket_with_initial_comment');
    await action!.handler(
      {
        emailData: { id: 'email-1', subject: 's', body: { text: 'b' }, from: { email: 'c@example.com' }, to: [{ email: 's@example.com' }] },
        parsedEmail: { sanitizedText: 'b' },
        ticketDefaults: { board_id: 'b', status_id: 's', priority_id: 'p' },
        targetClientId: 'client-1', targetContactId: 'contact-1', targetLocationId: null,
      },
      { tenantId: 'tenant-1' }
    );
    expect(createCommentFromEmailMock.mock.calls[0][0]).toMatchObject({ opensTicket: true, attachmentCount: undefined });
  });

  it('reply actions (create_comment_from_email) never set opensTicket', async () => {
    const { registerEmailWorkflowActionsV2 } = await import('../registerEmailWorkflowActions');
    registerEmailWorkflowActionsV2();
    const action = registeredActions.find((entry) => entry.id === 'create_comment_from_email');
    await action!.handler({ ticket_id: 'ticket-1', content: 'hello', author_type: 'contact' }, { tenantId: 'tenant-1' });
    expect('opensTicket' in (createCommentFromEmailMock.mock.calls[0][0] as object)).toBe(false);
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

  it('stamps the inbound sender onto comment metadata for an unmatched sender', async () => {
    findContactByEmailMock.mockResolvedValue(null);

    const { registerEmailWorkflowActionsV2 } = await import('../registerEmailWorkflowActions');
    registerEmailWorkflowActionsV2();

    const emailData = {
      id: 'email-sender-1',
      subject: 'Inbound subject',
      body: { text: 'Inbound body' },
      from: { email: 'unknown@example.com', name: 'Unknown Sender' },
      to: [{ email: 'support@example.com' }],
    };
    const parsedEmail = { sanitizedText: 'Inbound body', confidence: 'high', metadata: {} };
    const senderMetadata = expect.objectContaining({
      email: { fromAddress: 'unknown@example.com', fromName: 'Unknown Sender' },
    });

    const parsed = registeredActions.find((entry) => entry.id === 'create_comment_from_parsed_email');
    await parsed!.handler({ ticketId: 'ticket-sender-1', emailData, parsedEmail }, { tenantId: 'tenant-1' });
    expect(createCommentFromEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: senderMetadata }),
      'tenant-1'
    );

    const initial = registeredActions.find((entry) => entry.id === 'create_ticket_with_initial_comment');
    await initial!.handler(
      {
        emailData,
        parsedEmail,
        ticketDefaults: { board_id: 'board-1' },
        targetClientId: null,
        targetContactId: null,
        targetLocationId: null,
      },
      { tenantId: 'tenant-1' }
    );
    expect(createCommentFromEmailMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ metadata: senderMetadata }),
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

  it.each([
    ['fresh', true, true],
    ['expired', false, false],
    ['null-expiry', false, false],
  ])('find_ticket_by_reply_token reports %s cm2 credentials as expiry-aware matches', async (_label, expiryValid, success) => {
    findTicketByReplyTokenMock.mockResolvedValue({ ticketId: 'ticket-1', expiryValid } as any);
    const { registerEmailWorkflowActionsV2 } = await import('../registerEmailWorkflowActions');
    registerEmailWorkflowActionsV2();

    const action = registeredActions.find((entry) => entry.id === 'find_ticket_by_reply_token');
    expect(action).toBeDefined();
    const result = await action!.handler({ token: 'cm2:reply-token' }, { tenantId: 'tenant-1' });
    const parsed = action!.outputSchema!.parse(result);
    expect(parsed).toMatchObject({ success, match: { expiryValid } });
    expect(parsed.match?.ticketId).toBe(success ? 'ticket-1' : undefined);
  });

  it.each([
    ['fresh', true, true],
    ['expired', false, false],
    ['null-expiry', false, false],
  ])('resolve_existing_ticket_from_email handles %s cm2 credentials before thread-header fallback', async (_label, expiryValid, success) => {
    findTicketByReplyTokenMock.mockResolvedValue({ ticketId: 'ticket-1', expiryValid } as any);
    findTicketByEmailThreadMock.mockResolvedValue({
      ticketId: 'header-ticket', ticketNumber: 'T-2', subject: 'Matched header', status: 'Open',
      originalEmailId: '<original@example.test>', threadInfo: { originalMessageId: '<original@example.test>' },
    } as any);
    const { registerEmailWorkflowActionsV2 } = await import('../registerEmailWorkflowActions');
    registerEmailWorkflowActionsV2();

    const action = registeredActions.find((entry) => entry.id === 'resolve_existing_ticket_from_email');
    expect(action).toBeDefined();
    const result = await action!.handler({
      emailData: {
        id: 'inbound-1', from: { email: 'requester@example.test' }, subject: 'Re: ticket',
        body: { text: 'reply' }, inReplyTo: '<original@example.test>', references: ['<original@example.test>'],
      },
      parsedEmail: { metadata: { parser: { tokens: { conversationToken: 'cm2:reply-token' } } } },
    }, { tenantId: 'tenant-1' });

    if (expiryValid) {
      expect(result).toMatchObject({ success: true, source: 'replyToken', ticket: { ticketId: 'ticket-1' } });
      expect(findTicketByEmailThreadMock).not.toHaveBeenCalled();
    } else {
      expect(result).toMatchObject({ success: false, source: 'replyToken', ticket: null });
      expect(findTicketByEmailThreadMock).not.toHaveBeenCalled();
    }
    expect(action!.outputSchema!.parse(result)).toMatchObject({ success, source: 'replyToken' });
  });

  // alga-2026-0003353: a successful parse owns the comment body on this path too. When the
  // parser's safety net rejects its own HTML trim it hands back only the text, and the raw
  // body — still carrying every level of quoted history — must not be revived.
  describe('comment body after a safety-net rejection', () => {
    const AUTHORED = 'Thursday afternoon works for us. Please go ahead and book it.';
    const QUOTED_MAIL = {
      text: `${AUTHORED}\n\nOn Mon, Nov 17, 2026 at 8:42 AM Jane Client <jane.client@example.test>\nwrote:\n\n> [ALGA-REPLY-TOKEN OWNREPLY-TOKEN-11]\n> --- Please reply above this line ---\n> Comment from Dana Tech\n`,
      html: `<div>${AUTHORED}</div><blockquote class="gmail_quote"><div>[ALGA-REPLY-TOKEN OWNREPLY-TOKEN-11]</div><div>--- Please reply above this line ---</div><div>Comment from Dana Tech</div></blockquote>`,
    };
    const LEAKS = ['[ALGA-REPLY-TOKEN', 'Please reply above this line', 'Comment from Dana Tech'];

    const emailData = {
      id: 'email-own-reply',
      subject: 'Re: Laptop deployment',
      body: QUOTED_MAIL,
      from: { email: 'jane.client@example.test' },
      to: [{ email: 'support@example.com' }],
    };

    /** Visible text of the stored body, which is serialized BlockNote blocks. */
    const visibleText = (content: string): string => {
      const collect = (node: any): string[] => {
        if (Array.isArray(node)) return node.flatMap(collect);
        if (!node || typeof node !== 'object') return [];
        return [
          ...(typeof node.text === 'string' ? [node.text] : []),
          ...collect(node.content),
          ...collect(node.children),
        ];
      };
      return collect(JSON.parse(content)).join(' ').trim();
    };

    const expectNoLeaks = (content: string) => {
      // Markup is converted, never stored as literal tags.
      expect(content).not.toContain('<div');
      expect(content).not.toContain('<br');
      for (const leaked of LEAKS) {
        expect(visibleText(content)).not.toContain(leaked);
      }
    };

    const commentActionResult = async (parsedEmail: any, inboundEmail: any = emailData) => {
      const { registerEmailWorkflowActionsV2 } = await import('../registerEmailWorkflowActions');
      registerEmailWorkflowActionsV2();
      const action = registeredActions.find((entry) => entry.id === 'create_comment_from_parsed_email');
      expect(action).toBeDefined();

      const result = await action!.handler(
        { ticketId: 'ticket-own-reply', emailData: inboundEmail, parsedEmail },
        { tenantId: 'tenant-1' }
      );
      // Whatever the handler decides, its output still has to satisfy the registered schema.
      action!.outputSchema!.parse(result);
      return result as any;
    };

    const writtenComment = async (parsedEmail: any, inboundEmail: any = emailData) => {
      await commentActionResult(parsedEmail, inboundEmail);

      expect(createCommentFromEmailMock).toHaveBeenCalledTimes(1);
      return createCommentFromEmailMock.mock.calls[0][0] as any;
    };

    const writtenTicket = async (parsedEmail: any, inboundEmail: any = emailData) => {
      const { registerEmailWorkflowActionsV2 } = await import('../registerEmailWorkflowActions');
      registerEmailWorkflowActionsV2();
      const action = registeredActions.find((entry) => entry.id === 'create_ticket_with_initial_comment');
      expect(action).toBeDefined();

      await action!.handler(
        {
          emailData: inboundEmail,
          parsedEmail,
          ticketDefaults: { board_id: 'board-1' },
          targetClientId: 'client-1',
          targetContactId: 'contact-1',
          targetLocationId: null,
        },
        { tenantId: 'tenant-1' }
      );

      return {
        ticket: createTicketFromEmailMock.mock.calls[0][0] as any,
        comment: createCommentFromEmailMock.mock.calls[0][0] as any,
      };
    };

    const REJECTED_TRIM = {
      sanitizedText: AUTHORED,
      sanitizedHtml: undefined,
      confidence: 'high',
      strategy: 'custom-boundary',
      appliedHeuristics: ['token-strip', 'explicit-boundary', 'html-blockquote-trim', 'html-trim-rejected'],
      warnings: [
        'HTML blockquote trim removed significantly more content than text heuristics; using text result.',
      ],
      metadata: {},
    };
    const EMPTY_PARSE = {
      sanitizedText: '',
      sanitizedHtml: undefined,
      confidence: 'high',
      strategy: 'custom-boundary',
      appliedHeuristics: ['token-strip', 'explicit-boundary'],
      warnings: [],
      metadata: {},
    };

    it('writes the parsed text, not the untrimmed original body', async () => {
      const comment = await writtenComment(REJECTED_TRIM);

      expect(visibleText(comment.content)).toBe(AUTHORED);
      expectNoLeaks(comment.content);
    });

    it.each([
      { fixture: 'authored-trailing-quotation.txt', introduction: 'Le 17 novembre le script a écrit :' },
      { fixture: 'authored-trailing-quotation.txt', introduction: 'Am 17. November schrieb das Skript:' },
      { fixture: 'authored-forwarded-report.txt', introduction: undefined },
      { fixture: 'authored-forwarded-report.txt', introduction: undefined, removeSeparator: true },
    ])('stores authored evidence from $fixture ($introduction, removeSeparator: $removeSeparator)', async ({ fixture, introduction, removeSeparator }) => {
      const { parseEmailReply } = await import('../../../../lib/email/replyParser');
      const fixturePath = new URL(`../../../../lib/email/__fixtures__/${fixture}`, import.meta.url);
      let text = fs.readFileSync(fixturePath, 'utf8');
      if (introduction) {
        text = text.replace('The deployment failed with this error:', `Deployment details:\n${introduction}`);
      }
      if (removeSeparator) {
        text = text.replace('-----Original Message-----\n', '');
      }
      const authored = text.split('\n\n--- Please reply above this line ---')[0];
      const body = { text };
      const comment = await writtenComment(parseEmailReply(body), { ...emailData, body });

      for (const line of authored.split('\n').filter(Boolean)) {
        expect(visibleText(comment.content)).toContain(line.replace(/^>\s*/, ''));
      }
      expect(visibleText(comment.content)).not.toContain('Old notification');
      expect(visibleText(comment.content)).not.toContain('Please reply above this line');
    });

    // Same judgement the in-app processor makes before a comment exists: a reply that held
    // nothing above the Alga boundary leaves no comment at all, rather than a blank one.
    it('writes no comment at all for an empty parse', async () => {
      const result = await commentActionResult(EMPTY_PARSE);

      expect(createCommentFromEmailMock).not.toHaveBeenCalled();
      expect(result.comment_id).toBeUndefined();
    });

    it.each([false, true])('creates a comment for an attachment-only reply (Alga token: %j)', async (withToken) => {
      const { parseEmailReply } = await import('../../../../lib/email/replyParser');
      const body = {
        text: withToken ? '[ALGA-REPLY-TOKEN attachment-token]\n--- Please reply above this line ---\nOld notification' : '',
        html: '<div dir="ltr"><br></div>',
      };
      const comment = await writtenComment(parseEmailReply(body), {
        ...emailData,
        body,
        inReplyTo: '<original-message@example.test>',
        attachments: [{ id: 'attachment-1', name: 'diagnostics.txt', contentType: 'text/plain', size: 128 }],
      });

      expect(comment.author_type).toBe('contact');
      expect(comment.source).toBe('email');
      expect(visibleText(comment.content)).toBe('');
      expect(comment.content.length).toBeGreaterThan(0);
      expectNoLeaks(comment.content);
    });

    // The parser reports an empty reply through sanitizedText alone; its HTML side may still
    // hold the quoted notification when no blockquote wrapped it.
    it('ignores the retained HTML of a reply the parser reported as empty', async () => {
      await commentActionResult({ ...EMPTY_PARSE, sanitizedHtml: QUOTED_MAIL.html });

      expect(createCommentFromEmailMock).not.toHaveBeenCalled();
    });

    it('stores a trimmed HTML-only reply as blocks, not as literal markup', async () => {
      const comment = await writtenComment(
        { ...REJECTED_TRIM, sanitizedText: '', sanitizedHtml: `<div dir="ltr">${AUTHORED}</div><br>` },
        { ...emailData, body: { html: QUOTED_MAIL.html } }
      );

      expect(visibleText(comment.content)).toContain(AUTHORED);
      expectNoLeaks(comment.content);
    });

    it.each([
      ['', false],
      ['<div>On Mon, Nov 17, 2026 Dana Tech wrote:</div>', false],
      ['', true],
      ['<div>On Mon, Nov 17, 2026 Dana Tech wrote:</div>', true],
    ])(
      'keeps a bottom answer with attribution %j and text part %j', async (attribution, multipart) => {
        const { parseEmailReply } = await import('../../../../lib/email/replyParser');
        const answer = 'No, do not restart it. Payroll is still running.';
        const html = '<p>See my answer below.</p>' + attribution
          + '<div style="display:none">[ALGA-REPLY-TOKEN bottom-token]</div>'
          + '<p>--- Please reply above this line ---</p><p>Old notification</p>'
          + `<p>${answer}</p>`;
        const text = multipart ? 'See my answer below.\n'
          + (attribution ? 'On Mon, Nov 17, 2026 Dana Tech wrote:\n' : '')
          + '[ALGA-REPLY-TOKEN bottom-token]\n--- Please reply above this line ---\nOld notification\n'
          + answer : '';
        const comment = await writtenComment(
          parseEmailReply({ text, html }),
          { ...emailData, body: { text, html } },
        );

        expect(visibleText(comment.content)).toContain(answer);
      },
    );

    it('builds the new ticket description and first comment from the parsed body', async () => {
      const metadata = { parser: {
        strategy: REJECTED_TRIM.strategy,
        confidence: REJECTED_TRIM.confidence,
        heuristics: REJECTED_TRIM.appliedHeuristics,
        warnings: REJECTED_TRIM.warnings,
      } };
      const { ticket, comment } = await writtenTicket({ ...REJECTED_TRIM, metadata });

      expect(visibleText(ticket.description)).toBe(AUTHORED);
      expect(comment.content).toBe(ticket.description);
      expect(comment.opensTicket).toBe(true);
      expect(comment.metadata.parser).toEqual(metadata.parser);
      expectNoLeaks(ticket.description);
    });

    it.each([
      ['reply', false],
      ['new ticket', false],
      ['reply', true],
      ['new ticket', true],
    ])('preserves an image-only %s (multipart: %j)', async (kind, multipart) => {
      const { parseEmailReply } = await import('../../../../lib/email/replyParser');
      const html = '<img src="https://example.test/screenshot.png">'
        + (multipart ? '<div data-alga-reply-boundary="true">--- Please reply above this line ---</div>'
          + '<div style="display:none">[ALGA-REPLY-TOKEN image-token]</div>'
          + '<p>Old notification</p><img src="https://example.test/quoted-logo.png">' : '');
      const text = multipart
        ? '[ALGA-REPLY-TOKEN image-token]\n--- Please reply above this line ---\nOld notification' : '';
      const inboundEmail = { ...emailData, body: { text, html }, attachments: [] };
      const parsed = parseEmailReply({ text, html });
      expect(parsed.sanitizedText).toBe('');
      expect(parsed.sanitizedHtml).toContain('https://example.test/screenshot.png');
      let content: string;
      if (kind === 'reply') {
        content = (await writtenComment(parsed, inboundEmail)).content;
      } else {
        const { ticket, comment } = await writtenTicket(parsed, inboundEmail);
        content = ticket.description;
        expect(comment.content).toBe(content);
      }

      expect(JSON.parse(content)).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'image', props: expect.objectContaining({ url: 'https://example.test/screenshot.png' }) }),
      ]));
      expectNoLeaks(content);
      expect(content).not.toContain('Old notification');
      expect(content).not.toContain('quoted-logo.png');
    });

    it('does not restore the raw text into the description of an empty parse', async () => {
      const { ticket, comment } = await writtenTicket(EMPTY_PARSE);

      expect(visibleText(ticket.description)).toBe('');
      expectNoLeaks(ticket.description);
      // Still a valid body: an empty string would fail comment validation and leave the
      // ticket behind with no comment at all.
      expect(comment.content.length).toBeGreaterThan(0);
      expectNoLeaks(comment.content);
    });

    it('still falls back to the raw body when parsing never produced a result', async () => {
      const comment = await writtenComment(undefined);

      expect(visibleText(comment.content)).toContain(AUTHORED);
    });
  });

});
