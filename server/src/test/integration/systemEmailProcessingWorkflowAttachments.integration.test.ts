import { describe, expect, it, vi } from 'vitest';

import { systemEmailProcessingWorkflow } from '@shared/workflow/workflows/system-email-processing-workflow';

function createWorkflowHarness(overrides?: {
  findTicketByEmailThreadResult?: any;
  processEmailAttachmentImpl?: (...args: any[]) => any;
  eventPayload?: any;
}) {
  const states: string[] = [];

  const actions = {
    parse_email_reply: vi.fn(async () => ({
      success: true,
      parsed: {
        sanitizedText: 'sanitized',
        sanitizedHtml: undefined,
        confidence: 'high',
        strategy: 'test',
        appliedHeuristics: [],
        warnings: [],
      },
    })),
    convert_html_to_blocks: vi.fn(async () => ({ success: true, blocks: [] })),
    find_ticket_by_email_thread: vi.fn(async () => overrides?.findTicketByEmailThreadResult ?? ({ success: true, ticket: null })),
    find_contact_by_email: vi.fn(async () => ({
      success: true,
      contact: {
        contact_id: 'contact-1',
        name: 'Contact',
        client_id: 'client-1',
        client_name: 'Client',
      },
    })),
    resolve_inbound_ticket_defaults: vi.fn(async () => ({
      board_id: 'board-1',
      status_id: 'status-1',
      priority_id: 'priority-1',
      category_id: null,
      subcategory_id: null,
      location_id: null,
      client_id: 'client-1',
      entered_by: 'system-user-1',
    })),
    create_ticket_from_email: vi.fn(async () => ({
      success: true,
      ticket_id: 'ticket-created-1',
      ticket_number: 'T-1',
    })),
    create_comment_from_email: vi.fn(async () => ({
      success: true,
      comment_id: 'comment-1',
    })),
    process_email_attachment: vi.fn(async (...args: any[]) => {
      if (overrides?.processEmailAttachmentImpl) {
        return await overrides.processEmailAttachmentImpl(...args);
      }
      return { success: true };
    }),
    create_or_find_contact: vi.fn(async () => ({ success: true, contact: { id: 'contact-1' } })),
    save_email_client_association: vi.fn(async () => ({ success: true })),
    get_client_by_id_for_email: vi.fn(async () => ({ success: true, client: { client_name: 'Client' } })),
    create_client_from_email: vi.fn(async () => ({ success: true, client: { client_id: 'client-1', client_name: 'Client' } })),
  };

  const data = {
    set: vi.fn(),
    get: vi.fn(),
  };

  const context = {
    actions,
    data,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    setState: (value: string) => states.push(value),
    events: {
      waitFor: vi.fn(async () => overrides?.eventPayload),
    },
  } as any;

  return { context, actions, states };
}

describe('systemEmailProcessingWorkflow: attachment processing behavior', () => {
  it('processes attachments for new tickets and does not fail ticket/comment creation on attachment errors', async () => {
    const processImpl = vi.fn(async () => {
      throw new Error('attachment failed');
    });

    const { context, actions, states } = createWorkflowHarness({
      processEmailAttachmentImpl: processImpl,
      findTicketByEmailThreadResult: { success: true, ticket: null },
      eventPayload: {
        tenantId: 'tenant-1',
        providerId: 'provider-1',
        emailData: {
          id: 'msg-1',
          subject: 'Subject',
          from: { email: 'from@example.com', name: 'From' },
          to: [{ email: 'to@example.com', name: 'To' }],
          body: { text: 'hello', html: undefined },
          receivedAt: new Date().toISOString(),
          attachments: [
            { id: 'a1', name: 'a1.txt', contentType: 'text/plain', size: 1 },
            { id: 'a2', name: 'a2.txt', contentType: 'text/plain', size: 1 },
          ],
          threadId: 'thread-1',
          inReplyTo: null,
          references: [],
          providerId: 'provider-1',
          tenant: 'tenant-1',
        },
      },
    });

    await expect(
      systemEmailProcessingWorkflow({
        ...context,
      })
    ).resolves.toBeUndefined();

    expect(actions.create_ticket_from_email).toHaveBeenCalledTimes(1);
    expect(actions.create_comment_from_email).toHaveBeenCalledTimes(1);
    expect(actions.process_email_attachment).toHaveBeenCalledTimes(2);
    expect(states).toContain('EMAIL_PROCESSED');
  });

  it('processes attachments for threaded replies and does not block comment creation', async () => {
    const attachmentCalls: string[] = [];
    const { context, actions } = createWorkflowHarness({
      findTicketByEmailThreadResult: {
        success: true,
        ticket: { ticketId: 'ticket-existing-1', ticketNumber: 'T-1', subject: 'Subject', status: 'open' },
      },
      processEmailAttachmentImpl: async (params: any) => {
        attachmentCalls.push(params.attachmentId);
        throw new Error('attachment failed');
      },
      eventPayload: {
        tenantId: 'tenant-1',
        providerId: 'provider-1',
        emailData: {
          id: 'msg-reply-1',
          subject: 'Re: Subject',
          from: { email: 'from@example.com', name: 'From' },
          to: [{ email: 'to@example.com', name: 'To' }],
          body: { text: 'reply', html: undefined },
          receivedAt: new Date().toISOString(),
          attachments: [{ id: 'r1', name: 'r1.txt', contentType: 'text/plain', size: 1 }],
          threadId: 'thread-1',
          inReplyTo: 'msg-1',
          references: ['msg-1'],
          providerId: 'provider-1',
          tenant: 'tenant-1',
        },
      },
    });

    await expect(
      systemEmailProcessingWorkflow({
        ...context,
      })
    ).resolves.toBeUndefined();

    expect(actions.create_comment_from_email).toHaveBeenCalledTimes(1);
    expect(actions.process_email_attachment).toHaveBeenCalledTimes(1);
    expect(attachmentCalls).toEqual(['r1']);
  });
});
