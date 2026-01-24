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
  parseEmailReplyBody,
  createClientFromEmail,
  getClientByIdForEmail,
  createOrFindContact,
  saveEmailClientAssociation
} from '../../actions/emailWorkflowActions';

// =============================================================================
// SHARED OUTPUT SCHEMAS FOR EMAIL ACTIONS
// =============================================================================

/** Schema for contact data returned by email actions */
const contactOutputSchema = z.object({
  contact_id: z.string().describe('Unique identifier for the contact'),
  name: z.string().describe('Full name of the contact'),
  email: z.string().email().describe('Email address of the contact'),
  client_id: z.string().describe('ID of the associated client'),
  client_name: z.string().optional().describe('Name of the associated client'),
  phone: z.string().optional().describe('Phone number'),
  title: z.string().optional().describe('Job title or role')
});

/** Schema for ticket thread info */
const ticketThreadInfoSchema = z.object({
  ticketId: z.string().describe('Unique identifier of the ticket'),
  ticketNumber: z.string().describe('Human-readable ticket number'),
  subject: z.string().describe('Ticket subject/title'),
  status: z.string().describe('Current ticket status'),
  originalEmailId: z.string().describe('Message ID of the original email'),
  threadInfo: z.object({
    threadId: z.string().optional().describe('Email thread ID'),
    originalMessageId: z.string().optional().describe('Original message ID')
  }).describe('Email threading information')
});

/** Schema for reply token match */
const replyTokenMatchSchema = z.object({
  ticketId: z.string().optional().describe('Matched ticket ID'),
  commentId: z.string().optional().describe('Matched comment ID'),
  projectId: z.string().optional().describe('Matched project ID')
});

/** Schema for parsed email reply */
const parsedEmailReplySchema = z.object({
  sanitizedText: z.string().describe('Cleaned text content without quoted replies'),
  sanitizedHtml: z.string().optional().describe('Cleaned HTML content'),
  confidence: z.enum(['high', 'medium', 'low']).describe('Confidence level of parsing'),
  strategy: z.string().optional().describe('Parsing strategy used'),
  appliedHeuristics: z.array(z.string()).optional().describe('Heuristics applied'),
  warnings: z.array(z.string()).optional().describe('Parser warnings'),
  tokens: z.object({
    conversationToken: z.string().optional().describe('Extracted conversation reply token')
  }).optional().describe('Extracted tokens from email')
});

const parsedEmailSchema = z.object({
  sanitizedText: z.string().describe('Cleaned text content without quoted replies'),
  sanitizedHtml: z.string().optional().describe('Cleaned HTML content'),
  confidence: z.string().optional().describe('Parsing confidence'),
  metadata: z.record(z.unknown()).optional().describe('Parser metadata')
});

const emailAddressSchema = z.object({
  email: z.string().email().describe('Email address'),
  name: z.string().optional().describe('Display name')
});

const emailDataSchema = z.object({
  id: z.string().describe('Email message ID'),
  mailhogId: z.string().optional().describe('Mailhog ID (for testing)'),
  threadId: z.string().optional().describe('Email thread ID'),
  from: emailAddressSchema.describe('Sender address'),
  to: z.array(emailAddressSchema).optional().describe('Recipients'),
  cc: z.array(emailAddressSchema).optional().describe('CC recipients'),
  bcc: z.array(emailAddressSchema).optional().describe('BCC recipients'),
  subject: z.string().describe('Email subject line'),
  body: z.object({
    text: z.string().optional().describe('Plain text content'),
    html: z.string().optional().describe('HTML content')
  }).describe('Email body content'),
  inReplyTo: z.string().optional().describe('In-Reply-To header (for threading)'),
  references: z.array(z.string()).optional().describe('References header values'),
  attachments: z.array(z.object({
    id: z.string().describe('Attachment ID'),
    name: z.string().describe('Filename'),
    contentType: z.string().describe('MIME content type'),
    size: z.number().int().positive().describe('Size in bytes'),
    contentId: z.string().optional().describe('Content-ID for inline attachments')
  })).optional().describe('Email attachments'),
  receivedAt: z.string().optional().describe('When the email was received (ISO 8601)'),
  tenant: z.string().optional().describe('Tenant ID'),
  providerId: z.string().optional().describe('Email provider ID')
});

/** Schema for inbound ticket defaults */
const inboundTicketDefaultsSchema = z.object({
  board_id: z.string().optional().describe('Default board ID'),
  status_id: z.string().optional().describe('Default status ID'),
  priority_id: z.string().optional().describe('Default priority ID'),
  client_id: z.string().optional().describe('Default client ID'),
  entered_by: z.string().optional().describe('Default entered_by user ID'),
  category_id: z.string().optional().describe('Default category ID'),
  subcategory_id: z.string().optional().describe('Default subcategory ID'),
  location_id: z.string().optional().describe('Default location ID')
});

function buildCommentPayload(parsedEmail: any, emailData: any) {
  const sanitizedHtml = parsedEmail?.sanitizedHtml;
  const sanitizedText = parsedEmail?.sanitizedText;
  const content = sanitizedHtml || sanitizedText || emailData?.body?.html || emailData?.body?.text || '';
  const format = sanitizedHtml
    ? 'html'
    : sanitizedText
      ? 'text'
      : emailData?.body?.html
        ? 'html'
        : 'text';
  const metadata = parsedEmail?.metadata;
  return { content, format, metadata };
}

/** Schema for client data */
const clientOutputSchema = z.object({
  client_id: z.string().describe('Unique identifier for the client'),
  client_name: z.string().describe('Name of the client/company')
});

/** Schema for create/find contact output */
const createOrFindContactOutputSchema = z.object({
  id: z.string().describe('Contact ID'),
  name: z.string().describe('Contact name'),
  email: z.string().email().describe('Contact email'),
  client_id: z.string().describe('Associated client ID'),
  phone: z.string().optional().describe('Phone number'),
  title: z.string().optional().describe('Job title'),
  created_at: z.string().describe('Creation timestamp (ISO 8601)'),
  is_new: z.boolean().describe('Whether the contact was newly created')
});

/** Schema for email-client association output */
const emailClientAssociationOutputSchema = z.object({
  success: z.boolean().describe('Whether the operation succeeded'),
  associationId: z.string().describe('ID of the association record'),
  email: z.string().email().describe('Email address'),
  client_id: z.string().describe('Associated client ID')
});

export function registerEmailWorkflowActionsV2(): void {
  const registry = getActionRegistryV2();

  registry.register({
    id: 'parse_email_reply',
    version: 1,
    inputSchema: z.object({
      text: z.string().optional().describe('Plain text email body'),
      html: z.string().optional().describe('HTML email body'),
      config: z.record(z.any()).optional().describe('Parser configuration options')
    }),
    outputSchema: z.object({
      success: z.boolean().describe('Whether parsing succeeded'),
      parsed: parsedEmailReplySchema.nullable().optional().describe('Parsed email content'),
      message: z.string().optional().describe('Error message if parsing failed')
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
      token: z.string().describe('Reply token extracted from email')
    }),
    outputSchema: z.object({
      success: z.boolean().describe('Whether a match was found'),
      match: replyTokenMatchSchema.nullable().optional().describe('Matched ticket/comment/project info'),
      message: z.string().optional().describe('Error message if lookup failed')
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
      threadId: z.string().optional().describe('Email thread ID (Gmail-style)'),
      inReplyTo: z.string().optional().describe('In-Reply-To header value'),
      references: z.array(z.string()).optional().describe('References header values'),
      originalMessageId: z.string().optional().describe('Original message ID to search for')
    }),
    outputSchema: z.object({
      success: z.boolean().describe('Whether a matching ticket was found'),
      ticket: ticketThreadInfoSchema.nullable().optional().describe('Matched ticket with thread info'),
      message: z.string().optional().describe('Error message if lookup failed')
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
    id: 'resolve_existing_ticket_from_email',
    version: 1,
    inputSchema: z.object({
      emailData: emailDataSchema.describe('Inbound email data'),
      parsedEmail: parsedEmailSchema.optional().describe('Parsed email body result')
    }),
    outputSchema: z.object({
      success: z.boolean().describe('Whether a matching ticket was found'),
      ticket: z.object({
        ticketId: z.string().describe('Ticket ID'),
        ticketNumber: z.string().optional().describe('Ticket number'),
        subject: z.string().optional().describe('Ticket subject'),
        status: z.string().optional().describe('Ticket status')
      }).nullable().optional().describe('Matched ticket info'),
      source: z.enum(['replyToken', 'threadHeaders']).nullable().optional().describe('Match source'),
      message: z.string().optional().describe('Error message if lookup failed')
    }),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Resolve Existing Ticket', category: 'Email' },
    handler: async (input, ctx) => {
      try {
        const token = (input.parsedEmail as any)?.metadata?.parser?.tokens?.conversationToken;
        if (token) {
          const match = await findTicketByReplyToken(String(token), ctx.tenantId ?? '');
	          if (match?.ticketId) {
	            return {
	              success: true,
	              ticket: { ticketId: match.ticketId },
	              source: 'replyToken' as const
	            };
	          }
	        }

        const ticket = await findTicketByEmailThread({
          threadId: input.emailData.threadId,
          inReplyTo: input.emailData.inReplyTo,
          references: input.emailData.references,
          originalMessageId: input.emailData.inReplyTo
        }, ctx.tenantId ?? '');

	        if (ticket) {
	          return {
	            success: true,
	            ticket: {
	              ticketId: ticket.ticketId,
	              ticketNumber: ticket.ticketNumber,
	              subject: ticket.subject,
	              status: ticket.status
	            },
	            source: 'threadHeaders' as const
	          };
	        }

        return { success: false, ticket: null, source: null };
      } catch (error) {
        return {
          success: false,
          ticket: null,
          source: null,
          message: error instanceof Error ? error.message : String(error)
        };
      }
    }
  });

  registry.register({
    id: 'find_contact_by_email',
    version: 1,
    inputSchema: z.object({
      email: z.string().email().describe('Email address to search for')
    }),
    outputSchema: z.object({
      success: z.boolean().describe('Whether a contact was found'),
      contact: contactOutputSchema.nullable().optional().describe('Found contact with client info'),
      message: z.string().optional().describe('Error message if lookup failed')
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
      tenant: z.string().describe('Tenant ID'),
      providerId: z.string().describe('Email provider ID')
    }),
    outputSchema: inboundTicketDefaultsSchema.describe('Default settings for creating tickets from inbound emails'),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Resolve Ticket Defaults', category: 'Email' },
    handler: async (input) => {
      return resolveInboundTicketDefaults(input.tenant, input.providerId);
    }
  });

  registry.register({
    id: 'resolve_inbound_ticket_context',
    version: 1,
    inputSchema: z.object({
      tenantId: z.string().describe('Tenant ID'),
      providerId: z.string().describe('Email provider ID'),
      senderEmail: z.string().email().describe('Sender email address')
    }),
    outputSchema: z.object({
      ticketDefaults: inboundTicketDefaultsSchema.nullable().describe('Resolved inbound ticket defaults'),
      matchedClient: contactOutputSchema.nullable().optional().describe('Matched contact for sender email'),
      targetClientId: z.string().nullable().describe('Resolved target client ID'),
      targetContactId: z.string().nullable().describe('Resolved target contact ID'),
      targetLocationId: z.string().nullable().describe('Resolved target location ID')
    }),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Resolve Ticket Context', category: 'Email' },
    handler: async (input, ctx) => {
      const tenant = input.tenantId || ctx.tenantId || '';
      const providerId = input.providerId;

      const ticketDefaults = await resolveInboundTicketDefaults(tenant, providerId);

      let matchedClient: any = null;
      try {
        matchedClient = await findContactByEmail(input.senderEmail, tenant);
      } catch (error) {
        matchedClient = null;
      }

      if (!ticketDefaults) {
        return {
          ticketDefaults: null,
          matchedClient,
          targetClientId: null,
          targetContactId: null,
          targetLocationId: null
        };
      }

      const targetClientId = matchedClient?.client_id ?? ticketDefaults.client_id ?? null;
      const targetContactId = matchedClient?.contact_id ?? null;
      const targetLocationId = (matchedClient?.client_id && ticketDefaults.client_id && matchedClient.client_id !== ticketDefaults.client_id)
        ? null
        : ticketDefaults.location_id ?? null;

      return {
        ticketDefaults,
        matchedClient,
        targetClientId,
        targetContactId,
        targetLocationId
      };
    }
  });

  registry.register({
    id: 'create_ticket_from_email',
    version: 1,
    inputSchema: z.object({
      title: z.string().describe('Ticket title (usually email subject)'),
      description: z.string().describe('Ticket description (email body content)'),
      client_id: z.string().nullable().optional().describe('Client ID to associate with ticket'),
      contact_id: z.string().nullable().optional().describe('Contact ID who sent the email'),
      source: z.string().optional().describe('Ticket source (defaults to "email")'),
      board_id: z.string().optional().describe('Board to create ticket on'),
      status_id: z.string().optional().describe('Initial status for the ticket'),
      priority_id: z.string().optional().describe('Priority level for the ticket'),
      category_id: z.string().optional().describe('Category for the ticket'),
      subcategory_id: z.string().optional().describe('Subcategory for the ticket'),
      location_id: z.string().optional().nullable().describe('Location associated with ticket'),
      entered_by: z.string().optional().describe('User ID who entered the ticket'),
      email_metadata: z.object({
        messageId: z.string().optional().describe('Email message ID'),
        mailhogId: z.string().optional().describe('Mailhog ID for testing'),
        threadId: z.string().optional().describe('Email thread ID'),
        from: z.object({
          email: z.string().email().describe('Sender email address'),
          name: z.string().optional().describe('Sender display name')
        }).optional().describe('Email sender information'),
        inReplyTo: z.string().optional().describe('In-Reply-To header'),
        references: z.array(z.string()).optional().describe('References header values'),
        providerId: z.string().optional().describe('Email provider ID')
      }).optional().describe('Email metadata for threading')
    }),
    outputSchema: z.object({
      ticket_id: z.string().describe('Created ticket unique identifier'),
      ticket_number: z.string().optional().describe('Human-readable ticket number')
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
    id: 'create_ticket_with_initial_comment',
    version: 1,
    inputSchema: z.object({
      emailData: emailDataSchema.describe('Inbound email data'),
      parsedEmail: parsedEmailSchema.describe('Parsed email body result'),
      ticketDefaults: inboundTicketDefaultsSchema.describe('Resolved ticket defaults'),
      targetClientId: z.string().nullable().describe('Resolved client ID'),
      targetContactId: z.string().nullable().describe('Resolved contact ID'),
      targetLocationId: z.string().nullable().describe('Resolved location ID')
    }),
    outputSchema: z.object({
      ticket_id: z.string().describe('Created ticket unique identifier'),
      ticket_number: z.string().optional().describe('Human-readable ticket number'),
      comment_id: z.string().describe('Created comment unique identifier')
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Create Ticket + Initial Comment', category: 'Email' },
    handler: async (input, ctx) => {
      const tenant = ctx.tenantId ?? '';
      const emailData = input.emailData;

      const ticketResult = await createTicketFromEmail({
        title: emailData.subject,
        description: input.parsedEmail?.sanitizedText || emailData.body?.text || '',
        client_id: input.targetClientId ?? undefined,
        contact_id: input.targetContactId ?? undefined,
        source: 'email',
        board_id: input.ticketDefaults.board_id,
        status_id: input.ticketDefaults.status_id,
        priority_id: input.ticketDefaults.priority_id,
        category_id: input.ticketDefaults.category_id,
        subcategory_id: input.ticketDefaults.subcategory_id,
        location_id: input.targetLocationId ?? undefined,
        entered_by: input.ticketDefaults.entered_by ?? undefined,
        email_metadata: {
          messageId: emailData.id,
          mailhogId: emailData.mailhogId,
          threadId: emailData.threadId,
          from: emailData.from,
          inReplyTo: emailData.inReplyTo,
          references: emailData.references,
          providerId: emailData.providerId
        }
      }, tenant);

      const commentPayload = buildCommentPayload(input.parsedEmail, emailData);
      const commentId = await createCommentFromEmail({
        ticket_id: ticketResult.ticket_id,
        content: commentPayload.content,
        format: commentPayload.format,
        source: 'email',
        author_type: 'internal',
        metadata: commentPayload.metadata
      }, tenant);

      return {
        ticket_id: ticketResult.ticket_id,
        ticket_number: ticketResult.ticket_number,
        comment_id: commentId
      };
    }
  });

  registry.register({
    id: 'create_comment_from_email',
    version: 1,
    inputSchema: z.object({
      ticket_id: z.string().describe('Ticket ID to add comment to'),
      content: z.string().describe('Comment content (text or HTML)'),
      format: z.enum(['text', 'html']).optional().describe('Content format'),
      source: z.string().optional().describe('Source of the comment (e.g., "email")'),
      author_type: z.enum(['contact', 'internal', 'system']).optional().describe('Type of author'),
      author_id: z.string().optional().describe('Author user/contact ID'),
      inboundReplyEvent: z.object({
        messageId: z.string().min(1).describe('Inbound email message ID'),
        threadId: z.string().optional().describe('Email thread ID (provider conversation id)'),
        from: z.string().email().describe('Email from address'),
        to: z.array(z.string().email()).min(1).describe('Email to recipients'),
        subject: z.string().optional().describe('Email subject'),
        receivedAt: z.string().datetime().optional().describe('When the email was received (ISO 8601)'),
        provider: z.string().min(1).describe('Email provider identifier'),
        matchedBy: z.string().min(1).describe('Reply matching strategy'),
      }).optional().describe('When present, publishes INBOUND_EMAIL_REPLY_RECEIVED after comment creation'),
      metadata: z.object({
        parser: z.object({
          confidence: z.enum(['high', 'medium', 'low']).optional(),
          strategy: z.string().optional(),
          heuristics: z.array(z.string()).optional(),
          warnings: z.array(z.string()).optional()
        }).optional().describe('Email parser metadata')
      }).optional().describe('Additional metadata for the comment')
    }),
    outputSchema: z.object({
      comment_id: z.string().describe('Created comment unique identifier')
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
        inboundReplyEvent: input.inboundReplyEvent,
        metadata: input.metadata
      }, ctx.tenantId ?? '');
      return { comment_id: commentId };
    }
  });

  registry.register({
    id: 'create_comment_from_parsed_email',
    version: 1,
    inputSchema: z.object({
      ticketId: z.string().describe('Ticket ID to add comment to'),
      emailData: emailDataSchema.describe('Inbound email data'),
      parsedEmail: parsedEmailSchema.describe('Parsed email body result'),
      author_type: z.enum(['contact', 'internal', 'system']).optional().describe('Type of author'),
      source: z.string().optional().describe('Source of the comment (e.g., "email")')
    }),
    outputSchema: z.object({
      comment_id: z.string().describe('Created comment unique identifier')
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Create Comment from Parsed Email', category: 'Email' },
    handler: async (input, ctx) => {
      const tenant = ctx.tenantId ?? '';
      const commentPayload = buildCommentPayload(input.parsedEmail, input.emailData);
      const commentId = await createCommentFromEmail({
        ticket_id: input.ticketId,
        content: commentPayload.content,
        format: commentPayload.format,
        source: input.source ?? 'email',
        author_type: input.author_type ?? 'system',
        metadata: commentPayload.metadata
      }, tenant);
      return { comment_id: commentId };
    }
  });

  registry.register({
    id: 'process_email_attachment',
    version: 1,
    inputSchema: z.object({
      emailId: z.string().describe('Email message ID'),
      attachmentId: z.string().describe('Attachment ID within the email'),
      ticketId: z.string().describe('Ticket ID to associate attachment with'),
      tenant: z.string().describe('Tenant ID'),
      providerId: z.string().describe('Email provider ID'),
      attachmentData: z.object({
        id: z.string().describe('Attachment identifier'),
        name: z.string().describe('Original filename'),
        contentType: z.string().describe('MIME content type'),
        size: z.number().int().positive().describe('File size in bytes'),
        contentId: z.string().optional().describe('Content-ID for inline attachments')
      }).describe('Attachment metadata')
    }),
    outputSchema: z.object({
      success: z.boolean().describe('Whether processing succeeded'),
      documentId: z.string().optional().describe('Created document ID'),
      fileName: z.string().optional().describe('Stored filename'),
      fileSize: z.number().optional().describe('File size in bytes'),
      contentType: z.string().optional().describe('MIME content type')
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
    id: 'process_email_attachments_batch',
    version: 1,
    inputSchema: z.object({
      emailId: z.string().describe('Email message ID'),
      attachments: z.array(z.object({
        id: z.string().describe('Attachment identifier'),
        name: z.string().describe('Original filename'),
        contentType: z.string().describe('MIME content type'),
        size: z.number().int().positive().describe('File size in bytes'),
        contentId: z.string().optional().describe('Content-ID for inline attachments')
      })).optional().describe('Attachment list'),
      ticketId: z.string().describe('Ticket ID to associate attachments with'),
      tenant: z.string().describe('Tenant ID'),
      providerId: z.string().describe('Email provider ID')
    }),
    outputSchema: z.object({
      processed: z.number().int().describe('Number of attachments processed'),
      failed: z.number().int().describe('Number of attachments that failed'),
      failures: z.array(z.object({
        attachmentId: z.string(),
        message: z.string()
      })).optional()
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Process Email Attachments (Batch)', category: 'Email' },
    handler: async (input, ctx) => {
      const attachments = input.attachments ?? [];
      let processed = 0;
      let failed = 0;
      const failures: Array<{ attachmentId: string; message: string }> = [];

      for (const attachment of attachments) {
        try {
          await processEmailAttachment({
            emailId: input.emailId,
            attachmentId: attachment.id,
            ticketId: input.ticketId,
            tenant: input.tenant,
            providerId: input.providerId,
            attachmentData: attachment as { id: string; name: string; contentType: string; size: number; contentId?: string }
          }, ctx.tenantId ?? '');
          processed += 1;
        } catch (error) {
          failed += 1;
          failures.push({
            attachmentId: attachment.id,
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }

      return {
        processed,
        failed,
        failures: failures.length > 0 ? failures : undefined
      };
    }
  });

  registry.register({
    id: 'convert_html_to_blocks',
    version: 1,
    inputSchema: z.object({
      html: z.string().describe('HTML content to convert')
    }),
    outputSchema: z.object({
      success: z.boolean().describe('Whether conversion succeeded'),
      blocks: z.array(z.record(z.any())).describe('BlockNote editor blocks - each block has type, content, and optional props')
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
      title: z.string().describe('Task title describing the failure'),
      description: z.string().optional().describe('Detailed description of what failed'),
      contextData: z.object({
        emailSubject: z.string().optional().describe('Subject of the failed email'),
        senderEmail: z.string().optional().describe('Sender email address'),
        errorMessage: z.string().optional().describe('Error message from processing'),
        emailId: z.string().optional().describe('Email message ID'),
        providerId: z.string().optional().describe('Email provider ID')
      }).optional().describe('Context data for debugging')
    }),
    outputSchema: z.object({
      task_id: z.string().describe('Created human task ID')
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
      ticketId: z.string().describe('Ticket ID to acknowledge'),
      contactEmail: z.string().email().optional().describe('Contact email to send acknowledgement to')
    }),
    outputSchema: z.object({
      success: z.boolean().describe('Whether email was sent successfully'),
      message: z.string().optional().describe('Status message or error details')
    }),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Send Ticket Acknowledgement', category: 'Email' },
    handler: async () => {
      return { success: true, message: 'stub' };
    }
  });

  // =============================================================================
  // ADDITIONAL EMAIL CLIENT MANAGEMENT ACTIONS
  // =============================================================================

  registry.register({
    id: 'create_client_from_email',
    version: 1,
    inputSchema: z.object({
      client_name: z.string().describe('Name for the new client'),
      email: z.string().email().optional().describe('Primary email address for the client'),
      source: z.string().optional().describe('Source of the client (defaults to "email")')
    }),
    outputSchema: z.object({
      success: z.boolean().describe('Whether client was created successfully'),
      client: clientOutputSchema.optional().describe('Created client data'),
      message: z.string().optional().describe('Error message if creation failed')
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Create Client from Email', category: 'Email' },
    handler: async (input, ctx) => {
      try {
        const result = await createClientFromEmail({
          client_name: input.client_name,
          email: input.email,
          source: input.source
        }, ctx.tenantId ?? '');
        return { success: true, client: result };
      } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : String(error) };
      }
    }
  });

  registry.register({
    id: 'get_client_by_id_for_email',
    version: 1,
    inputSchema: z.object({
      clientId: z.string().describe('Client ID to look up')
    }),
    outputSchema: z.object({
      success: z.boolean().describe('Whether client was found'),
      client: clientOutputSchema.nullable().optional().describe('Found client data'),
      message: z.string().optional().describe('Error message if lookup failed')
    }),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Get Client by ID', category: 'Email' },
    handler: async (input, ctx) => {
      try {
        const client = await getClientByIdForEmail(input.clientId, ctx.tenantId ?? '');
        return { success: !!client, client };
      } catch (error) {
        return { success: false, client: null, message: error instanceof Error ? error.message : String(error) };
      }
    }
  });

  registry.register({
    id: 'create_or_find_contact',
    version: 1,
    inputSchema: z.object({
      email: z.string().email().describe('Contact email address'),
      name: z.string().optional().describe('Contact name (defaults to email if not provided)'),
      client_id: z.string().describe('Client ID to associate contact with'),
      phone: z.string().optional().describe('Contact phone number'),
      title: z.string().optional().describe('Contact job title')
    }),
    outputSchema: z.object({
      success: z.boolean().describe('Whether operation succeeded'),
      contact: createOrFindContactOutputSchema.optional().describe('Found or created contact'),
      message: z.string().optional().describe('Error message if operation failed')
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Create or Find Contact', category: 'Email' },
    handler: async (input, ctx) => {
      try {
        const contact = await createOrFindContact({
          email: input.email,
          name: input.name,
          client_id: input.client_id,
          phone: input.phone,
          title: input.title
        }, ctx.tenantId ?? '');
        return { success: true, contact };
      } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : String(error) };
      }
    }
  });

  registry.register({
    id: 'save_email_client_association',
    version: 1,
    inputSchema: z.object({
      email: z.string().email().describe('Email address to associate'),
      client_id: z.string().describe('Client ID to associate with'),
      contact_id: z.string().optional().describe('Optional contact ID'),
      confidence_score: z.number().min(0).max(1).optional().describe('Confidence score (0-1)'),
      notes: z.string().optional().describe('Notes about the association')
    }),
    outputSchema: emailClientAssociationOutputSchema.describe('Association result'),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Save Email-Client Association', category: 'Email' },
    handler: async (input, ctx) => {
      return saveEmailClientAssociation({
        email: input.email,
        client_id: input.client_id,
        contact_id: input.contact_id,
        confidence_score: input.confidence_score,
        notes: input.notes
      }, ctx.tenantId ?? '');
    }
  });
}
