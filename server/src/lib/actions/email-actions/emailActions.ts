'use server'

import { findContactByEmailAddress, createOrFindContactByEmail } from '../contact-actions/contactActions.js';
import { createTenantKnex } from '../../db/index.js';
import { withTransaction } from '@shared/db/index.js';
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
// EMAIL CONTACT ACTIONS (Thin wrappers around contact domain functions)
// =============================================================================

/**
 * Find contact by email address
 * This is a thin wrapper around the contactActions domain function
 */
export async function findContactByEmail(email: string): Promise<FindContactByEmailOutput | null> {
  const contact = await findContactByEmailAddress(email);
  
  if (!contact) {
    return null;
  }

  // Transform to email workflow expected format
  return {
    contact_id: contact.contact_name_id,
    name: contact.full_name,
    email: contact.email,
    company_id: contact.company_id || '',
    company_name: (contact as any).company_name || '',
    phone: contact.phone_number,
    title: contact.role
  };
}

/**
 * Create or find contact by email and company
 * This is a thin wrapper around the contactActions domain function
 */
export async function createOrFindContact(input: CreateOrFindContactInput): Promise<CreateOrFindContactOutput> {
  const result = await createOrFindContactByEmail({
    email: input.email,
    name: input.name,
    companyId: input.company_id,
    phone: input.phone,
    title: input.title
  });

  // Transform to email workflow expected format
  return {
    id: result.contact.contact_name_id,
    name: result.contact.full_name,
    email: result.contact.email,
    company_id: result.contact.company_id || '',
    phone: result.contact.phone_number,
    title: result.contact.role,
    created_at: result.contact.created_at ? new Date(result.contact.created_at).toISOString() : new Date().toISOString(),
    is_new: result.isNew
  };
}

// =============================================================================
// EMAIL TICKET THREADING ACTIONS
// =============================================================================

/**
 * Find existing ticket by email thread information
 * This action searches for tickets that were created from emails in the same conversation thread
 */
export async function findTicketByEmailThread(input: FindTicketByEmailThreadInput): Promise<FindTicketByEmailThreadOutput | null> {
  const { knex: db, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  return await withTransaction(db, async (trx: Knex.Transaction) => {
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

// =============================================================================
// EMAIL ATTACHMENT ACTIONS  
// =============================================================================

/**
 * Process email attachment and associate with ticket
 * This action handles downloading, storing, and linking email attachments to tickets
 */
export async function processEmailAttachment(input: ProcessEmailAttachmentInput): Promise<ProcessEmailAttachmentOutput> {
  const { knex: db, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  return await withTransaction(db, async (trx: Knex.Transaction) => {
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
      metadata: {
        emailId: input.emailId,
        attachmentId: input.attachmentId,
        providerId: input.providerId,
        contentId: input.attachmentData.contentId
      },
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
 * This action saves the mapping between an email address and client for future automatic matching
 */
export async function saveEmailClientAssociation(input: SaveEmailClientAssociationInput): Promise<SaveEmailClientAssociationOutput> {
  const { knex: db, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  return await withTransaction(db, async (trx: Knex.Transaction) => {
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
}

// =============================================================================
// EMAIL WORKFLOW WRAPPER FUNCTIONS
// =============================================================================

/**
 * Create ticket from email data - wrapper for email workflows
 * Converts email workflow interface to server action requirements
 */
export async function createTicketFromEmail(ticketData: {
  title: string;
  description: string;
  company_id?: string;
  contact_id?: string;
  source?: string;
  channel_id?: string;
  status_id?: string;
  priority_id?: string;
  email_metadata?: any;
}): Promise<{ ticket_id: string; ticket_number: string }> {
  const { knex: db, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    // Get next ticket number
    const nextNumber = await trx('next_numbers')
      .where({ tenant, entity_type: 'ticket' })
      .first();
    
    const ticketNumber = `TKT-${String(nextNumber?.next_value || 1).padStart(6, '0')}`;
    
    // Create ticket
    const [ticket] = await trx('tickets')
      .insert({
        tenant,
        title: ticketData.title,
        description: ticketData.description,
        company_id: ticketData.company_id,
        contact_id: ticketData.contact_id,
        source: ticketData.source || 'email',
        channel_id: ticketData.channel_id,
        status_id: ticketData.status_id,
        priority_id: ticketData.priority_id,
        ticket_number: ticketNumber,
        email_metadata: JSON.stringify(ticketData.email_metadata),
        created_at: new Date(),
        updated_at: new Date()
      })
      .returning(['ticket_id', 'ticket_number']);

    // Update next number
    await trx('next_numbers')
      .where({ tenant, entity_type: 'ticket' })
      .increment('next_value', 1);

    return {
      ticket_id: ticket.ticket_id,
      ticket_number: ticket.ticket_number
    };
  });
}

/**
 * Create comment from email data - wrapper for email workflows
 */
export async function createCommentFromEmail(commentData: {
  ticket_id: string;
  content: string;
  format?: string;
  source?: string;
  author_type?: string;
  author_id?: string;
  metadata?: any;
}): Promise<string> {
  const { knex: db, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    const [comment] = await trx('comments')
      .insert({
        tenant,
        ticket_id: commentData.ticket_id,
        note: commentData.content,
        is_internal: false,
        is_resolution: false,
        author_type: commentData.author_type || 'system',
        metadata: JSON.stringify(commentData.metadata),
        created_at: new Date(),
        updated_at: new Date()
      })
      .returning('comment_id');

    return comment.comment_id;
  });
}

/**
 * Create company from email data - wrapper for email workflows
 */
export async function createCompanyFromEmail(companyData: {
  company_name: string;
  email?: string;
  source?: string;
}): Promise<{ company_id: string; company_name: string }> {
  const { knex: db, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    const [company] = await trx('companies')
      .insert({
        tenant,
        company_name: companyData.company_name,
        email: companyData.email,
        source: companyData.source || 'email',
        created_at: new Date(),
        updated_at: new Date()
      })
      .returning(['company_id', 'company_name']);

    return {
      company_id: company.company_id,
      company_name: company.company_name
    };
  });
}

/**
 * Get company by ID - wrapper for email workflows
 */
export async function getCompanyByIdForEmail(companyId: string): Promise<{ company_id: string; company_name: string } | null> {
  const { knex: db, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    const company = await trx('companies')
      .select('company_id', 'company_name')
      .where({ company_id: companyId, tenant })
      .first();

    return company || null;
  });
}

/**
 * Create channel from email data - wrapper for email workflows
 */
export async function createChannelFromEmail(channelData: {
  channel_name: string;
  description?: string;
  is_default?: boolean;
}): Promise<{ channel_id: string; channel_name: string }> {
  const { knex: db, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    const [channel] = await trx('channels')
      .insert({
        tenant,
        channel_name: channelData.channel_name,
        description: channelData.description || '',
        is_default: channelData.is_default || false,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date()
      })
      .returning(['channel_id', 'channel_name']);

    return {
      channel_id: channel.channel_id,
      channel_name: channel.channel_name
    };
  });
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Find ticket by thread ID
 */
async function findTicketByThreadId(trx: Knex.Transaction, tenant: string, threadId: string): Promise<FindTicketByEmailThreadOutput | null> {
  const ticket = await trx('tickets as t')
    .leftJoin('statuses as s', 't.status_id', 's.status_id')
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
async function findTicketByOriginalMessageId(trx: Knex.Transaction, tenant: string, messageId: string): Promise<FindTicketByEmailThreadOutput | null> {
  const ticket = await trx('tickets as t')
    .leftJoin('statuses as s', 't.status_id', 's.status_id')
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