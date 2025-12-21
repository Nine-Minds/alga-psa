import { z } from 'zod';
import { getActionRegistryV2 } from '../registries/actionRegistry';
import {
  findContactByEmail,
  findTicketByEmailThread,
  findTicketByReplyToken,
  resolveInboundTicketDefaults,
  createTicketFromEmail,
  createCommentFromEmail,
  processEmailAttachment,
  parseEmailReplyBody
} from '../../actions/emailWorkflowActions';

export function registerEmailWorkflowActionsV2(): void {
  const registry = getActionRegistryV2();

  registry.register({
    id: 'parse_email_reply',
    version: 1,
    inputSchema: z.object({
      text: z.string().optional(),
      html: z.string().optional(),
      config: z.record(z.any()).optional()
    }),
    outputSchema: z.object({
      success: z.boolean(),
      parsed: z.any().optional(),
      message: z.string().optional()
    }),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Parse Email Reply', category: 'Email' },
    handler: async (input) => {
      try {
        const parsed = await parseEmailReplyBody({ text: input.text, html: input.html }, input.config);
        return { success: true, parsed };
      } catch (error) {
        return { success: false, parsed: null, message: error instanceof Error ? error.message : String(error) };
      }
    }
  });

  registry.register({
    id: 'find_ticket_by_reply_token',
    version: 1,
    inputSchema: z.object({
      token: z.string()
    }),
    outputSchema: z.object({
      success: z.boolean(),
      match: z.any().nullable().optional(),
      message: z.string().optional()
    }),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Find Ticket by Reply Token', category: 'Email' },
    handler: async (input, ctx) => {
      try {
        const match = await findTicketByReplyToken(input.token, ctx.tenantId ?? '');
        return { success: !!match, match };
      } catch (error) {
        return { success: false, match: null, message: error instanceof Error ? error.message : String(error) };
      }
    }
  });

  registry.register({
    id: 'find_ticket_by_email_thread',
    version: 1,
    inputSchema: z.object({
      threadId: z.string().optional(),
      inReplyTo: z.string().optional(),
      references: z.array(z.string()).optional(),
      originalMessageId: z.string().optional()
    }),
    outputSchema: z.object({
      success: z.boolean(),
      ticket: z.any().nullable().optional(),
      message: z.string().optional()
    }),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Find Ticket by Thread', category: 'Email' },
    handler: async (input, ctx) => {
      try {
        const ticket = await findTicketByEmailThread(input, ctx.tenantId ?? '');
        return { success: !!ticket, ticket };
      } catch (error) {
        return { success: false, ticket: null, message: error instanceof Error ? error.message : String(error) };
      }
    }
  });

  registry.register({
    id: 'find_contact_by_email',
    version: 1,
    inputSchema: z.object({
      email: z.string().email()
    }),
    outputSchema: z.object({
      success: z.boolean(),
      contact: z.any().nullable().optional(),
      message: z.string().optional()
    }),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Find Contact by Email', category: 'Email' },
    handler: async (input, ctx) => {
      try {
        const contact = await findContactByEmail(input.email, ctx.tenantId ?? '');
        return { success: !!contact, contact };
      } catch (error) {
        return { success: false, contact: null, message: error instanceof Error ? error.message : String(error) };
      }
    }
  });

  registry.register({
    id: 'resolve_inbound_ticket_defaults',
    version: 1,
    inputSchema: z.object({
      tenant: z.string(),
      providerId: z.string()
    }),
    outputSchema: z.any(),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Resolve Ticket Defaults', category: 'Email' },
    handler: async (input) => {
      return resolveInboundTicketDefaults(input.tenant, input.providerId);
    }
  });

  registry.register({
    id: 'create_ticket_from_email',
    version: 1,
    inputSchema: z.object({
      title: z.string(),
      description: z.string(),
      client_id: z.string().nullable().optional(),
      contact_id: z.string().nullable().optional(),
      source: z.string().optional(),
      board_id: z.string().optional(),
      status_id: z.string().optional(),
      priority_id: z.string().optional(),
      category_id: z.string().optional(),
      subcategory_id: z.string().optional(),
      location_id: z.string().optional().nullable(),
      entered_by: z.string().optional(),
      email_metadata: z.record(z.any()).optional()
    }),
    outputSchema: z.object({
      ticket_id: z.string(),
      ticket_number: z.string().optional()
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Create Ticket from Email', category: 'Email' },
    handler: async (input, ctx) => {
      return createTicketFromEmail({
        title: input.title,
        description: input.description,
        client_id: input.client_id ?? undefined,
        contact_id: input.contact_id ?? undefined,
        location_id: input.location_id ?? undefined,
        source: input.source,
        board_id: input.board_id,
        status_id: input.status_id,
        priority_id: input.priority_id,
        category_id: input.category_id,
        subcategory_id: input.subcategory_id,
        entered_by: input.entered_by,
        email_metadata: input.email_metadata
      }, ctx.tenantId ?? '');
    }
  });

  registry.register({
    id: 'create_comment_from_email',
    version: 1,
    inputSchema: z.object({
      ticket_id: z.string(),
      content: z.string(),
      format: z.string().optional(),
      source: z.string().optional(),
      author_type: z.string().optional(),
      author_id: z.string().optional(),
      metadata: z.record(z.any()).optional()
    }),
    outputSchema: z.object({
      comment_id: z.string()
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Create Comment from Email', category: 'Email' },
    handler: async (input, ctx) => {
      const commentId = await createCommentFromEmail({
        ticket_id: input.ticket_id,
        content: input.content,
        format: input.format,
        source: input.source,
        author_type: input.author_type,
        author_id: input.author_id,
        metadata: input.metadata
      }, ctx.tenantId ?? '');
      return { comment_id: commentId };
    }
  });

  registry.register({
    id: 'process_email_attachment',
    version: 1,
    inputSchema: z.object({
      emailId: z.string(),
      attachmentId: z.string(),
      ticketId: z.string(),
      tenant: z.string(),
      providerId: z.string(),
      attachmentData: z.object({
        id: z.string(),
        name: z.string(),
        contentType: z.string(),
        size: z.number(),
        contentId: z.string().optional()
      })
    }),
    outputSchema: z.object({
      success: z.boolean(),
      documentId: z.string().optional(),
      fileName: z.string().optional(),
      fileSize: z.number().optional(),
      contentType: z.string().optional()
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Process Email Attachment', category: 'Email' },
    handler: async (input, ctx) => {
      return processEmailAttachment({
        emailId: input.emailId,
        attachmentId: input.attachmentId,
        ticketId: input.ticketId,
        tenant: input.tenant,
        providerId: input.providerId,
        attachmentData: {
          id: input.attachmentData.id,
          name: input.attachmentData.name,
          contentType: input.attachmentData.contentType,
          size: input.attachmentData.size,
          contentId: input.attachmentData.contentId
        }
      }, ctx.tenantId ?? '');
    }
  });

  registry.register({
    id: 'convert_html_to_blocks',
    version: 1,
    inputSchema: z.object({
      html: z.string()
    }),
    outputSchema: z.object({
      success: z.boolean(),
      blocks: z.any()
    }),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Convert HTML to Blocks', category: 'Email' },
    handler: async (input) => {
      const { convertHtmlToBlockNote } = await import('@alga-psa/shared/lib/utils/contentConversion');
      try {
        const blocks = convertHtmlToBlockNote(input.html);
        return { success: true, blocks };
      } catch (error) {
        return { success: false, blocks: [{ type: 'paragraph', content: [] }] };
      }
    }
  });

  registry.register({
    id: 'create_human_task_for_email_processing_failure',
    version: 1,
    inputSchema: z.object({
      title: z.string(),
      description: z.string().optional(),
      contextData: z.record(z.any()).optional()
    }),
    outputSchema: z.object({
      task_id: z.string()
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Create Human Task (Email Failure)', category: 'Email' },
    handler: async (input, ctx) => {
      const { default: WorkflowTaskModel, WorkflowTaskStatus } = await import('../../persistence/workflowTaskModel');
      const { getAdminConnection } = await import('@alga-psa/shared/db/admin');
      const knex = ctx.knex ?? await getAdminConnection();
      const taskId = await WorkflowTaskModel.createTask(knex, ctx.tenantId ?? '', {
        execution_id: ctx.runId,
        task_definition_type: 'system',
        system_task_definition_task_type: 'workflow_error',
        title: input.title,
        description: input.description ?? '',
        status: WorkflowTaskStatus.PENDING,
        priority: 'medium',
        context_data: input.contextData ?? {}
      } as any);
      return { task_id: taskId };
    }
  });

  registry.register({
    id: 'send_ticket_acknowledgement_email',
    version: 1,
    inputSchema: z.object({
      ticketId: z.string(),
      contactEmail: z.string().email().optional()
    }),
    outputSchema: z.object({
      success: z.boolean(),
      message: z.string().optional()
    }),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Send Ticket Acknowledgement', category: 'Email' },
    handler: async () => {
      return { success: true, message: 'stub' };
    }
  });
}
