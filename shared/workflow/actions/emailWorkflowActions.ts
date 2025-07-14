/**
 * Email Workflow Actions for the shared workflow system
 * These actions are used by the email processing workflow and are implemented
 * using shared database patterns to avoid cross-package dependencies.
 */

import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

// =============================================================================
// INTERFACES
// =============================================================================

export interface FindContactByEmailOutput {
  contact_id: string;
  name: string;
  email: string;
  company_id: string;
  company_name: string;
  phone?: string;
  title?: string;
}

export interface CreateOrFindContactInput {
  email: string;
  name?: string;
  company_id: string;
  phone?: string;
  title?: string;
}

export interface CreateOrFindContactOutput {
  id: string;
  name: string;
  email: string;
  company_id: string;
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
  company_id: string;
  contact_id?: string;
  confidence_score?: number;
  notes?: string;
}

export interface SaveEmailClientAssociationOutput {
  success: boolean;
  associationId: string;
  email: string;
  company_id: string;
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
  const { getAdminConnection } = await import('@shared/db/admin.js');
  const { withTransaction } = await import('@shared/db/index.js');
  const knex = await getAdminConnection();
  
  try {
    const contact = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('contacts')
        .select(
          'contacts.contact_name_id as contact_id',
          'contacts.full_name as name',
          'contacts.email',
          'contacts.company_id',
          'companies.company_name',
          'contacts.phone_number as phone',
          'contacts.role as title'
        )
        .leftJoin('companies', function() {
          this.on('contacts.company_id', 'companies.company_id')
            .andOn('companies.tenant', 'contacts.tenant');
        })
        .where({
          'contacts.email': email.toLowerCase(),
          'contacts.tenant': tenant
        })
        .first();
    });
    
    return contact || null;
  } finally {
    await knex.destroy();
  }
}

/**
 * Create or find contact by email and company
 */
export async function createOrFindContact(
  input: CreateOrFindContactInput,
  tenant: string
): Promise<CreateOrFindContactOutput> {
  const { getAdminConnection } = await import('@shared/db/admin.js');
  const { withTransaction } = await import('@shared/db/index.js');
  const knex = await getAdminConnection();
  
  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      // First try to find existing contact
      const existingContact = await trx('contacts')
        .where({
          email: input.email.toLowerCase(),
          company_id: input.company_id,
          tenant
        })
        .first();
      
      if (existingContact) {
        return {
          id: existingContact.contact_name_id,
          name: existingContact.full_name,
          email: existingContact.email,
          company_id: existingContact.company_id,
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
        company_id: input.company_id,
        phone_number: input.phone,
        role: input.title,
        created_at: now,
        updated_at: now
      });
      
      return {
        id: contactId,
        name: input.name || input.email,
        email: input.email,
        company_id: input.company_id,
        phone: input.phone,
        title: input.title,
        created_at: now.toISOString(),
        is_new: true
      };
    });
  } finally {
    await knex.destroy();
  }
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
  const { getAdminConnection } = await import('@shared/db/admin.js');
  const { withTransaction } = await import('@shared/db/index.js');
  const knex = await getAdminConnection();
  
  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
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
  } finally {
    await knex.destroy();
  }
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
          .orWhereRaw("t.email_metadata->'references' ? ?", [messageId]);
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
  const { getAdminConnection } = await import('@shared/db/admin.js');
  const { withTransaction } = await import('@shared/db/index.js');
  const knex = await getAdminConnection();
  
  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
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
  } finally {
    await knex.destroy();
  }
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
  const { getAdminConnection } = await import('@shared/db/admin.js');
  const { withTransaction } = await import('@shared/db/index.js');
  const knex = await getAdminConnection();
  
  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const associationId = uuidv4();
      const now = new Date();

      // Check if association already exists
      const existing = await trx('email_client_associations')
        .where('tenant', tenant)
        .whereRaw('LOWER(email) = LOWER(?)', [input.email])
        .where('company_id', input.company_id)
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
          company_id: input.company_id
        };
      } else {
        // Create new association
        await trx('email_client_associations').insert({
          id: associationId,
          tenant,
          email: input.email.toLowerCase(),
          company_id: input.company_id,
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
          company_id: input.company_id
        };
      }
    });
  } finally {
    await knex.destroy();
  }
}

// =============================================================================
// EMAIL WORKFLOW WRAPPER FUNCTIONS
// =============================================================================

/**
 * Resolve email provider's inbound ticket defaults
 */
export async function resolveEmailProviderDefaults(
  providerId: string,
  tenant: string
): Promise<any> {
  const { getAdminConnection } = await import('@shared/db/admin.js');
  const knex = await getAdminConnection();
  
  try {
    // Get email provider with its defaults reference
    const provider = await knex('email_providers')
      .where({ id: providerId, tenant })
      .select('inbound_ticket_defaults_id')
      .first();

    if (!provider || !provider.inbound_ticket_defaults_id) {
      console.warn(`No inbound ticket defaults configured for provider ${providerId}`);
      return null;
    }

    // Get the defaults configuration with flat structure
    const defaults = await knex('inbound_ticket_defaults')
      .where({ id: provider.inbound_ticket_defaults_id, tenant })
      .select(
        'channel_id',
        'status_id',
        'priority_id',
        'company_id',
        'entered_by',
        'category_id',
        'subcategory_id',
        'location_id'
      )
      .first();

    if (!defaults) {
      console.warn(`Inbound ticket defaults not found for ID ${provider.inbound_ticket_defaults_id}`);
      return null;
    }

    // Return the flat defaults structure
    return defaults;
  } catch (error) {
    console.error('Error resolving email provider defaults:', error);
    return null;
  } finally {
    await knex.destroy();
  }
}

/**
 * Create ticket from email data - Enhanced with events and analytics
 */
export async function createTicketFromEmail(
  ticketData: {
    title: string;
    description: string;
    company_id?: string;
    contact_id?: string;
    source?: string;
    channel_id?: string;
    status_id?: string;
    priority_id?: string;
    category_id?: string;
    subcategory_id?: string;
    location_id?: string;
    entered_by?: string | null;
    email_metadata?: any;
  },
  tenant: string,
  userId?: string
): Promise<{ ticket_id: string; ticket_number: string }> {
  const { getAdminConnection } = await import('@shared/db/admin.js');
  const { withTransaction } = await import('@shared/db/index.js');
  const { TicketModel } = await import('@shared/models/ticketModel.js');
  const { WorkflowEventPublisher } = await import('../adapters/workflowEventPublisher.js');
  const { WorkflowAnalyticsTracker } = await import('../adapters/workflowAnalyticsTracker.js');
  const knex = await getAdminConnection();
  
  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Create adapters for workflow context
      const eventPublisher = new WorkflowEventPublisher();
      const analyticsTracker = new WorkflowAnalyticsTracker();

      // Use enhanced TicketModel with events and analytics
      const result = await TicketModel.createTicketWithRetry({
        title: ticketData.title,
        description: ticketData.description,
        company_id: ticketData.company_id,
        contact_id: ticketData.contact_id,
        source: ticketData.source || 'email',
        channel_id: ticketData.channel_id,
        status_id: ticketData.status_id,
        priority_id: ticketData.priority_id,
        category_id: ticketData.category_id,
        subcategory_id: ticketData.subcategory_id,
        location_id: ticketData.location_id,
        entered_by: ticketData.entered_by || undefined,
        email_metadata: ticketData.email_metadata
      }, tenant, trx, {}, eventPublisher, analyticsTracker, userId, 3);

      return {
        ticket_id: result.ticket_id,
        ticket_number: result.ticket_number
      };
    });
  } finally {
    await knex.destroy();
  }
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
  },
  tenant: string,
  userId?: string
): Promise<string> {
  const { getAdminConnection } = await import('@shared/db/admin.js');
  const { withTransaction } = await import('@shared/db/index.js');
  const { TicketModel } = await import('@shared/models/ticketModel.js');
  const { WorkflowEventPublisher } = await import('../adapters/workflowEventPublisher.js');
  const { WorkflowAnalyticsTracker } = await import('../adapters/workflowAnalyticsTracker.js');
  const knex = await getAdminConnection();
  
  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Create adapters for workflow context
      const eventPublisher = new WorkflowEventPublisher();
      const analyticsTracker = new WorkflowAnalyticsTracker();

      // Use enhanced TicketModel with events and analytics
      const result = await TicketModel.createComment({
        ticket_id: commentData.ticket_id,
        content: commentData.content,
        is_internal: false,
        is_resolution: false,
        author_type: commentData.author_type as any || 'system',
        author_id: commentData.author_id,
        metadata: commentData.metadata
      }, tenant, trx, eventPublisher, analyticsTracker, userId);

      return result.comment_id;
    });
  } finally {
    await knex.destroy();
  }
}

/**
 * Create company from email data
 */
export async function createCompanyFromEmail(
  companyData: {
    company_name: string;
    email?: string;
    source?: string;
  },
  tenant: string
): Promise<{ company_id: string; company_name: string }> {
  const { getAdminConnection } = await import('@shared/db/admin.js');
  const { withTransaction } = await import('@shared/db/index.js');
  const knex = await getAdminConnection();
  
  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const companyId = uuidv4();
      
      await trx('companies')
        .insert({
          company_id: companyId,
          tenant,
          company_name: companyData.company_name,
          email: companyData.email,
          source: companyData.source || 'email',
          created_at: new Date(),
          updated_at: new Date()
        });

      return {
        company_id: companyId,
        company_name: companyData.company_name
      };
    });
  } finally {
    await knex.destroy();
  }
}

/**
 * Get company by ID
 */
export async function getCompanyByIdForEmail(
  companyId: string,
  tenant: string
): Promise<{ company_id: string; company_name: string } | null> {
  const { getAdminConnection } = await import('@shared/db/admin.js');
  const { withTransaction } = await import('@shared/db/index.js');
  const knex = await getAdminConnection();
  
  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const company = await trx('companies')
        .select('company_id', 'company_name')
        .where({ company_id: companyId, tenant })
        .first();

      return company || null;
    });
  } finally {
    await knex.destroy();
  }
}

/**
 * Create channel from email data
 */
export async function createChannelFromEmail(
  channelData: {
    channel_name: string;
    description?: string;
    is_default?: boolean;
  },
  tenant: string
): Promise<{ channel_id: string; channel_name: string }> {
  const { getAdminConnection } = await import('@shared/db/admin.js');
  const { withTransaction } = await import('@shared/db/index.js');
  const knex = await getAdminConnection();
  
  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const channelId = uuidv4();
      
      await trx('channels')
        .insert({
          channel_id: channelId,
          tenant,
          channel_name: channelData.channel_name,
          description: channelData.description || '',
          is_default: channelData.is_default || false,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date()
        });

      return {
        channel_id: channelId,
        channel_name: channelData.channel_name
      };
    });
  } finally {
    await knex.destroy();
  }
}