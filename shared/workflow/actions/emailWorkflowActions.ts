/**
 * Email Workflow Actions for the shared workflow system
 * These actions are used by the email processing workflow and are implemented
 * using shared database patterns to avoid cross-package dependencies.
 */

import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { buildInboundEmailReplyReceivedPayload } from '../streams/domainEventBuilders/inboundEmailReplyEventBuilders';

// =============================================================================
// INTERFACES
// =============================================================================

export interface FindContactByEmailOutput {
  contact_id: string;
  name: string;
  email: string;
  client_id: string;
  client_name: string;
  phone?: string;
  title?: string;
}

export interface CreateOrFindContactInput {
  email: string;
  name?: string;
  client_id: string;
  phone?: string;
  title?: string;
}

export interface CreateOrFindContactOutput {
  id: string;
  name: string;
  email: string;
  client_id: string;
  phone?: string;
  title?: string;
  created_at: string;
  is_new: boolean;
}

export interface FindTicketByEmailThreadInput {
  threadId?: string;
  inReplyTo?: string;
  references?: string[];
  originalMessageId?: string;
}

export interface FindTicketByEmailThreadOutput {
  ticketId: string;
  ticketNumber: string;
  subject: string;
  status: string;
  originalEmailId: string;
  threadInfo: {
    threadId?: string;
    originalMessageId?: string;
  };
}

export interface ProcessEmailAttachmentInput {
  emailId: string;
  attachmentId: string;
  ticketId: string;
  tenant: string;
  providerId: string;
  attachmentData: {
    id: string;
    name: string;
    contentType: string;
    size: number;
    contentId?: string;
  };
}

export interface ProcessEmailAttachmentOutput {
  documentId: string;
  success: boolean;
  fileName: string;
  fileSize: number;
  contentType: string;
}

export interface SaveEmailClientAssociationInput {
  email: string;
  client_id: string;
  contact_id?: string;
  confidence_score?: number;
  notes?: string;
}

export interface SaveEmailClientAssociationOutput {
  success: boolean;
  associationId: string;
  email: string;
  client_id: string;
}

// =============================================================================
// EMAIL CONTACT ACTIONS
// =============================================================================

/**
 * Find contact by email address
 */
export async function findContactByEmail(
  email: string,
  tenant: string
): Promise<FindContactByEmailOutput | null> {
  const { withAdminTransaction } = await import('@alga-psa/db');

  const contact = await withAdminTransaction(async (trx: Knex.Transaction) => {
      return await trx('contacts')
        .select(
          'contacts.contact_name_id as contact_id',
          'contacts.full_name as name',
          'contacts.email',
          'contacts.client_id',
          'clients.client_name',
          'contacts.phone_number as phone',
          'contacts.role as title'
        )
        .leftJoin('clients', function() {
          this.on('contacts.client_id', 'clients.client_id')
            .andOn('clients.tenant', 'contacts.tenant');
        })
        .where({
          'contacts.email': email.toLowerCase(),
          'contacts.tenant': tenant
        })
        .first();
    });

    return contact || null;
}

/**
 * Create or find contact by email and client
 */
export async function createOrFindContact(
  input: CreateOrFindContactInput,
  tenant: string
): Promise<CreateOrFindContactOutput> {
  const { withAdminTransaction } = await import('@alga-psa/db');

  return await withAdminTransaction(async (trx: Knex.Transaction) => {
      // First try to find existing contact
      const existingContact = await trx('contacts')
        .where({
          email: input.email.toLowerCase(),
          client_id: input.client_id,
          tenant
        })
        .first();

      if (existingContact) {
        return {
          id: existingContact.contact_name_id,
          name: existingContact.full_name,
          email: existingContact.email,
          client_id: existingContact.client_id,
          phone: existingContact.phone_number,
          title: existingContact.role,
          created_at: existingContact.created_at ? new Date(existingContact.created_at).toISOString() : new Date().toISOString(),
          is_new: false
        };
      }

      // Create new contact
      const contactId = uuidv4();
      const now = new Date();

      await trx('contacts').insert({
        contact_name_id: contactId,
        tenant,
        full_name: input.name || input.email,
        email: input.email.toLowerCase(),
        client_id: input.client_id,
        phone_number: input.phone,
        role: input.title,
        created_at: now,
        updated_at: now
      });

      return {
        id: contactId,
        name: input.name || input.email,
        email: input.email,
        client_id: input.client_id,
        phone: input.phone,
        title: input.title,
        created_at: now.toISOString(),
        is_new: true
      };
    });
}

// =============================================================================
// EMAIL TICKET THREADING ACTIONS
// =============================================================================

/**
 * Find existing ticket by email thread information
 */
export async function findTicketByEmailThread(
  input: FindTicketByEmailThreadInput,
  tenant: string
): Promise<FindTicketByEmailThreadOutput | null> {
  const { withAdminTransaction } = await import('@alga-psa/db');

  return await withAdminTransaction(async (trx: Knex.Transaction) => {
      // Strategy 1: Search by thread ID if available
      if (input.threadId) {
        const ticket = await findTicketByThreadId(trx, tenant, input.threadId);
        if (ticket) return ticket;
      }

      // Strategy 2: Search by In-Reply-To header (most reliable)
      if (input.inReplyTo) {
        const ticket = await findTicketByOriginalMessageId(trx, tenant, input.inReplyTo);
        if (ticket) return ticket;
      }

      // Strategy 3: Search by References headers
      if (input.references && input.references.length > 0) {
        for (const messageId of input.references) {
          const ticket = await findTicketByOriginalMessageId(trx, tenant, messageId);
          if (ticket) return ticket;
        }
      }

      // Strategy 4: Search by original message ID directly
      if (input.originalMessageId) {
        const ticket = await findTicketByOriginalMessageId(trx, tenant, input.originalMessageId);
        if (ticket) return ticket;
      }

      return null;
    });
}

/**
 * Find ticket by thread ID
 */
async function findTicketByThreadId(
  trx: Knex.Transaction,
  tenant: string,
  threadId: string
): Promise<FindTicketByEmailThreadOutput | null> {
  const ticket = await trx('tickets as t')
    .leftJoin('statuses as s', function() {
      this.on('t.status_id', 's.status_id')
        .andOn('t.tenant', 's.tenant');
    })
    .select(
      't.ticket_id as ticketId',
      't.ticket_number as ticketNumber',
      't.title as subject',
      's.name as status',
      't.email_metadata'
    )
    .where('t.tenant', tenant)
    .where(function() {
      this.whereRaw("t.email_metadata->>'threadId' = ?", [threadId])
          .orWhereRaw("t.email_metadata->'threadInfo'->>'threadId' = ?", [threadId]);
    })
    .first();

  if (!ticket) return null;

  const emailMetadata = ticket.email_metadata || {};

  return {
    ticketId: ticket.ticketId,
    ticketNumber: ticket.ticketNumber,
    subject: ticket.subject,
    status: ticket.status || 'Unknown',
    originalEmailId: emailMetadata.messageId || emailMetadata.originalEmailId || '',
    threadInfo: {
      threadId: emailMetadata.threadId || threadId,
      originalMessageId: emailMetadata.messageId
    }
  };
}

/**
 * Find ticket by original message ID from email metadata
 */
async function findTicketByOriginalMessageId(
  trx: Knex.Transaction,
  tenant: string,
  messageId: string
): Promise<FindTicketByEmailThreadOutput | null> {
  const ticket = await trx('tickets as t')
    .leftJoin('statuses as s', function() {
      this.on('t.status_id', 's.status_id')
        .andOn('t.tenant', 's.tenant');
    })
    .select(
      't.ticket_id as ticketId',
      't.ticket_number as ticketNumber',
      't.title as subject',
      's.name as status',
      't.email_metadata'
    )
    .where('t.tenant', tenant)
    .where(function() {
      this.whereRaw("t.email_metadata->>'messageId' = ?", [messageId])
          .orWhereRaw("t.email_metadata->>'inReplyTo' = ?", [messageId])
          .orWhereRaw("t.email_metadata->'references' \\? ?", [messageId]);
    })
    .first();

  if (!ticket) return null;

  const emailMetadata = ticket.email_metadata || {};

  return {
    ticketId: ticket.ticketId,
    ticketNumber: ticket.ticketNumber,
    subject: ticket.subject,
    status: ticket.status || 'Unknown',
    originalEmailId: emailMetadata.messageId || messageId,
    threadInfo: {
      threadId: emailMetadata.threadId,
      originalMessageId: emailMetadata.messageId || messageId
    }
  };
}

// =============================================================================
// EMAIL ATTACHMENT ACTIONS
// =============================================================================

/**
 * Process email attachment and associate with ticket
 */
export async function processEmailAttachment(
  input: ProcessEmailAttachmentInput,
  tenant: string
): Promise<ProcessEmailAttachmentOutput> {
  const { withAdminTransaction } = await import('@alga-psa/db');

  return await withAdminTransaction(async (trx: Knex.Transaction) => {
      const documentId = uuidv4();
      const now = new Date();

      // Create document record for the attachment
      await trx('documents').insert({
        document_id: documentId,
        tenant,
        name: input.attachmentData.name,
        file_size: input.attachmentData.size,
        content_type: input.attachmentData.contentType,
        source: 'email_attachment',
        metadata: JSON.stringify({
          emailId: input.emailId,
          attachmentId: input.attachmentId,
          providerId: input.providerId,
          contentId: input.attachmentData.contentId
        }),
        created_at: now,
        updated_at: now
      });

      // Associate document with ticket
      await trx('document_associations').insert({
        document_id: documentId,
        entity_type: 'ticket',
        entity_id: input.ticketId,
        tenant,
        created_at: now
      });

      return {
        documentId,
        success: true,
        fileName: input.attachmentData.name,
        fileSize: input.attachmentData.size,
        contentType: input.attachmentData.contentType
      };
    });
}

// =============================================================================
// EMAIL CLIENT ASSOCIATION ACTIONS
// =============================================================================

/**
 * Save email-to-client association
 */
export async function saveEmailClientAssociation(
  input: SaveEmailClientAssociationInput,
  tenant: string
): Promise<SaveEmailClientAssociationOutput> {
  const { withAdminTransaction } = await import('@alga-psa/db');

  return await withAdminTransaction(async (trx: Knex.Transaction) => {
      const associationId = uuidv4();
      const now = new Date();

      // Check if association already exists
      const existing = await trx('email_client_associations')
        .where('tenant', tenant)
        .whereRaw('LOWER(email) = LOWER(?)', [input.email])
        .where('client_id', input.client_id)
        .first();

      if (existing) {
        // Update existing association
        await trx('email_client_associations')
          .where('id', existing.id)
          .andWhere('tenant', tenant)
          .update({
            contact_id: input.contact_id,
            confidence_score: input.confidence_score || 1.0,
            notes: input.notes,
            updated_at: now
          });

        return {
          success: true,
          associationId: existing.id,
          email: input.email,
          client_id: input.client_id
        };
      } else {
        // Create new association
        await trx('email_client_associations').insert({
          id: associationId,
          tenant,
          email: input.email.toLowerCase(),
          client_id: input.client_id,
          contact_id: input.contact_id,
          confidence_score: input.confidence_score || 1.0,
          notes: input.notes,
          created_at: now,
          updated_at: now
        });

        return {
          success: true,
          associationId,
          email: input.email,
          client_id: input.client_id
        };
      }
    });
}

// =============================================================================
// EMAIL WORKFLOW WRAPPER FUNCTIONS
// =============================================================================

/**
 * Resolve default inbound ticket settings for a tenant
 */
export async function resolveInboundTicketDefaults(
  tenant: string,
  providerId?: string
): Promise<any> {
  const { withAdminTransaction } = await import('@alga-psa/db');

  return await withAdminTransaction(async (trx: Knex.Transaction) => {
      // Require provider-specific defaults; no tenant-level fallback
      let defaults: any | null = null;

      if (!providerId) {
        console.warn('resolveInboundTicketDefaults: providerId is required but missing');
        return null;
      }

      const provider = await trx('email_providers')
        .select('id', 'tenant', 'inbound_ticket_defaults_id')
        .where({ id: providerId, tenant })
        .first();

      if (!provider) {
        console.warn(`resolveInboundTicketDefaults: provider ${providerId} not found in tenant ${tenant}`);
        return null;
      }
      if (!provider.inbound_ticket_defaults_id) {
        console.warn(`resolveInboundTicketDefaults: provider ${providerId} has no inbound_ticket_defaults_id set (tenant ${tenant})`);
        return null;
      }

      defaults = await trx('inbound_ticket_defaults')
        .where({ tenant, id: provider.inbound_ticket_defaults_id, is_active: true })
        .select(
          'board_id',
          'status_id',
          'priority_id',
          'client_id',
          'entered_by',
          'category_id',
          'subcategory_id',
          'location_id'
        )
        .first();

      if (!defaults) {
        console.warn(`resolveInboundTicketDefaults: defaults not found or inactive for id ${provider.inbound_ticket_defaults_id} (tenant ${tenant}). Attempting tenant-level fallback.`);
        const fallback = await trx('inbound_ticket_defaults')
          .where({ tenant, is_active: true })
          .orderBy('updated_at', 'desc')
          .select('board_id','status_id','priority_id','client_id','entered_by','category_id','subcategory_id','location_id')
          .first();
        if (!fallback) {
          console.warn(`resolveInboundTicketDefaults: no active tenant-level defaults found for tenant ${tenant}`);
          return null;
        }
        defaults = fallback;
      }

      console.log(`Retrieved inbound ticket defaults:`, defaults);
      // Return the flat defaults structure
      return defaults;
    });
}

/**
 * @deprecated Use resolveInboundTicketDefaults instead
 * Resolve email provider's inbound ticket defaults
 */
export async function resolveEmailProviderDefaults(
  providerId: string,
  tenant: string
): Promise<any> {
  console.warn('resolveEmailProviderDefaults is deprecated, use resolveInboundTicketDefaults instead');
  return await resolveInboundTicketDefaults(tenant);
}

/**
 * Create ticket from email data - Enhanced with events and analytics
 */
export async function createTicketFromEmail(
  ticketData: {
    title: string;
    description: string;
    client_id?: string;
    contact_id?: string;
    source?: string;
    board_id?: string;
    status_id?: string;
    priority_id?: string;
    category_id?: string;
    subcategory_id?: string;
    location_id?: string;
    entered_by?: string | null;
    assigned_to?: string;
    email_metadata?: any;
  },
  tenant: string,
  userId?: string
): Promise<{ ticket_id: string; ticket_number: string }> {
  const { withAdminTransaction } = await import('@alga-psa/db');
  const { TicketModel } = await import('@alga-psa/shared/models/ticketModel');
  const { WorkflowEventPublisher } = await import('../adapters/workflowEventPublisher');
  const { WorkflowAnalyticsTracker } = await import('../adapters/workflowAnalyticsTracker');

  return await withAdminTransaction(async (trx: Knex.Transaction) => {
      // Create adapters for workflow context
      const eventPublisher = new WorkflowEventPublisher();
      const analyticsTracker = new WorkflowAnalyticsTracker();

      // Determine assigned_to: use provided value or fall back to board's default
      let assignedTo = ticketData.assigned_to;
      if (!assignedTo && ticketData.board_id) {
        const board = await trx('boards')
          .select('default_assigned_to')
          .where({ board_id: ticketData.board_id, tenant })
          .first();
        if (board?.default_assigned_to) {
          assignedTo = board.default_assigned_to;
        }
      }

      // Use enhanced TicketModel with events and analytics
      const result = await TicketModel.createTicketWithRetry({
        title: ticketData.title,
        description: ticketData.description,
        client_id: ticketData.client_id,
        contact_id: ticketData.contact_id,
        source: ticketData.source || 'email',
        board_id: ticketData.board_id,
        status_id: ticketData.status_id,
        priority_id: ticketData.priority_id,
        category_id: ticketData.category_id,
        subcategory_id: ticketData.subcategory_id,
        location_id: ticketData.location_id,
        entered_by: ticketData.entered_by || undefined,
        assigned_to: assignedTo,
        email_metadata: ticketData.email_metadata
      }, tenant, trx, {}, eventPublisher, analyticsTracker, userId, 3);

      // Publish TICKET_ASSIGNED event if an agent was assigned
      // Note: Event publishing failure should not prevent ticket creation
      if (assignedTo) {
        try {
          await eventPublisher.publishTicketAssigned({
            tenantId: tenant,
            ticketId: result.ticket_id,
            userId: assignedTo,
            assignedByUserId: userId || ticketData.entered_by || undefined
          });
        } catch (eventError) {
          console.error('Failed to publish TICKET_ASSIGNED event:', eventError);
          // Continue - ticket was created successfully, event can be retried or logged
        }
      }

      return {
        ticket_id: result.ticket_id,
        ticket_number: result.ticket_number
      };
    });
}

/**
 * Create comment from email data - Enhanced with events and analytics
 */
export async function createCommentFromEmail(
  commentData: {
    ticket_id: string;
    content: string;
    format?: string;
    source?: string;
    author_type?: string;
    author_id?: string;
    metadata?: any;
    inboundReplyEvent?: {
      messageId: string;
      threadId?: string;
      from: string;
      to: string[];
      subject?: string;
      receivedAt?: string;
      provider: string;
      matchedBy: string;
    };
  },
  tenant: string,
  userId?: string
): Promise<string> {
  const { withAdminTransaction } = await import('@alga-psa/db');
  const { TicketModel } = await import('@alga-psa/shared/models/ticketModel');
  const { WorkflowEventPublisher } = await import('../adapters/workflowEventPublisher');
  const { WorkflowAnalyticsTracker } = await import('../adapters/workflowAnalyticsTracker');

  const normalizedAuthorType: 'internal' | 'client' | 'unknown' = (() => {
    switch (commentData.author_type) {
      case 'contact':
      case 'client':
        return 'client';
      case 'internal':
      case 'system':
        return 'internal';
      default:
        return 'unknown';
    }
  })();

  const ticketModelAuthorType: 'internal' | 'contact' | 'system' =
    normalizedAuthorType === 'client'
      ? 'contact'
      : normalizedAuthorType === 'internal'
        ? 'internal'
        : 'system';

  const commentId = await withAdminTransaction(async (trx: Knex.Transaction) => {
      // Create adapters for workflow context
      const eventPublisher = new WorkflowEventPublisher();
      const analyticsTracker = new WorkflowAnalyticsTracker();

      // Use enhanced TicketModel with events and analytics
      const result = await TicketModel.createComment({
        ticket_id: commentData.ticket_id,
        content: commentData.content,
        is_internal: false,
        is_resolution: false,
        author_type: ticketModelAuthorType,
        author_id: commentData.author_id,
        metadata: commentData.metadata
      }, tenant, trx, eventPublisher, analyticsTracker, userId);

      if (normalizedAuthorType === 'client') {
        await trx('tickets')
          .where({ ticket_id: commentData.ticket_id, tenant })
          .update({ response_state: 'awaiting_internal' });
      } else if (normalizedAuthorType === 'internal') {
        await trx('tickets')
          .where({ ticket_id: commentData.ticket_id, tenant })
          .update({ response_state: 'awaiting_client' });
      }

      return result.comment_id;
    });

  if (commentData.inboundReplyEvent) {
    try {
      const threadId = commentData.inboundReplyEvent.threadId || commentData.inboundReplyEvent.messageId;
      const to = commentData.inboundReplyEvent.to?.length
        ? commentData.inboundReplyEvent.to
        : [commentData.inboundReplyEvent.from];

      await publishWorkflowEvent({
        eventType: 'INBOUND_EMAIL_REPLY_RECEIVED',
        payload: buildInboundEmailReplyReceivedPayload({
          messageId: commentData.inboundReplyEvent.messageId,
          threadId,
          ticketId: commentData.ticket_id,
          from: commentData.inboundReplyEvent.from,
          to,
          subject: commentData.inboundReplyEvent.subject,
          receivedAt: commentData.inboundReplyEvent.receivedAt,
          provider: commentData.inboundReplyEvent.provider,
          matchedBy: commentData.inboundReplyEvent.matchedBy,
        }),
        ctx: {
          tenantId: tenant,
          occurredAt: commentData.inboundReplyEvent.receivedAt ?? new Date(),
        },
        idempotencyKey: `inbound-email-reply:${tenant}:${commentData.ticket_id}:${commentData.inboundReplyEvent.messageId}`,
      });
    } catch (eventError) {
      console.warn('Failed to publish INBOUND_EMAIL_REPLY_RECEIVED event:', eventError);
    }
  }

  return commentId;
}

export async function parseEmailReplyBody(
  body: {
    text?: string;
    html?: string;
  },
  config?: Record<string, any>
): Promise<any> {
  const module = await import('@shared/lib/email/replyParser');
  const parseEmailReply = module.parseEmailReply as (input: { text: string; html?: string }, cfg?: Record<string, any>) => any;
  return parseEmailReply({
    text: body?.text || '',
    html: body?.html || undefined,
  }, config);
}

export async function findTicketByReplyToken(
  token: string,
  tenant: string
): Promise<{ ticketId?: string; commentId?: string; projectId?: string } | null> {
  if (!token) {
    return null;
  }

  const { withAdminTransaction } = await import('@alga-psa/db');

  return withAdminTransaction(async (trx: Knex.Transaction) => {
    const record = await trx('email_reply_tokens')
      .where({ tenant, token })
      .first();

    if (!record) {
      return null;
    }

    return {
      ticketId: record.ticket_id || undefined,
      commentId: record.comment_id || undefined,
      projectId: record.project_id || undefined,
    };
  });
}

/**
 * Create client from email data
 */
export async function createClientFromEmail(
  clientData: {
    client_name: string;
    email?: string;
    source?: string;
  },
  tenant: string
): Promise<{ client_id: string; client_name: string }> {
  const { withAdminTransaction } = await import('@alga-psa/db');

  return await withAdminTransaction(async (trx: Knex.Transaction) => {
      const clientId = uuidv4();

      await trx('clients')
        .insert({
          client_id: clientId,
          tenant,
          client_name: clientData.client_name,
          email: clientData.email,
          source: clientData.source || 'email',
          created_at: new Date(),
          updated_at: new Date()
        });

      return {
        client_id: clientId,
        client_name: clientData.client_name
      };
    });
}

/**
 * Get client by ID
 */
export async function getClientByIdForEmail(
  clientId: string,
  tenant: string
): Promise<{ client_id: string; client_name: string } | null> {
  const { withAdminTransaction } = await import('@alga-psa/db');

  return await withAdminTransaction(async (trx: Knex.Transaction) => {
      const client = await trx('clients')
        .select('client_id', 'client_name')
        .where({ client_id: clientId, tenant })
        .first();

      return client || null;
    });
}

/**
 * Create board from email data
 */
export async function createBoardFromEmail(
  boardData: {
    board_name: string;
    description?: string;
    is_default?: boolean;
  },
  tenant: string
): Promise<{ board_id: string; board_name: string }> {
  const { withAdminTransaction } = await import('@alga-psa/db');

  return await withAdminTransaction(async (trx: Knex.Transaction) => {
      const boardId = uuidv4();

      await trx('boards')
        .insert({
          board_id: boardId,
          tenant,
          board_name: boardData.board_name,
          description: boardData.description || '',
          is_default: boardData.is_default || false,
          is_inactive: false,
          created_at: new Date(),
          updated_at: new Date()
        });

      return {
        board_id: boardId,
        board_name: boardData.board_name
      };
    });
}
