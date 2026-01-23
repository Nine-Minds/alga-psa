'use server'

import { findContactByEmailAddress, createOrFindContactByEmail } from '@alga-psa/clients/actions';
import { createTenantKnex } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

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
    client_id: contact.client_id || '',
    client_name: (contact as any).client_name || '',
    phone: contact.phone_number,
    title: contact.role
  };
}

/**
 * Create or find contact by email and client
 * This is a thin wrapper around the contactActions domain function
 */
export async function createOrFindContact(input: CreateOrFindContactInput): Promise<CreateOrFindContactOutput> {
  const result = await createOrFindContactByEmail({
    email: input.email,
    name: input.name,
    clientId: input.client_id,
    phone: input.phone,
    title: input.title
  });

  // Transform to email workflow expected format
  return {
    id: result.contact.contact_name_id,
    name: result.contact.full_name,
    email: result.contact.email,
    client_id: result.contact.client_id || '',
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
      .where('client_id', input.client_id)
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

// REMOVED: createTicketFromEmail function has been moved to shared workflow actions
// This eliminates duplicate ticket creation logic and ensures consistency
// Use shared/workflow/actions/emailWorkflowActions.ts:createTicketFromEmail instead

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
 * Create client from email data - wrapper for email workflows
 */
export async function createClientFromEmail(clientData: {
  client_name: string;
  email?: string;
  source?: string;
}): Promise<{ client_id: string; client_name: string }> {
  const { knex: db, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    const [client] = await trx('clients')
      .insert({
        tenant,
        client_name: clientData.client_name,
        email: clientData.email,
        source: clientData.source || 'email',
        created_at: new Date(),
        updated_at: new Date()
      })
      .returning(['client_id', 'client_name']);

    return {
      client_id: client.client_id,
      client_name: client.client_name
    };
  });
}

/**
 * Get client by ID - wrapper for email workflows
 */
export async function getClientByIdForEmail(clientId: string): Promise<{ client_id: string; client_name: string } | null> {
  const { knex: db, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    const client = await trx('clients')
      .select('client_id', 'client_name')
      .where({ client_id: clientId, tenant })
      .first();

    return client || null;
  });
}

/**
 * Create board from email data - wrapper for email workflows
 */
export async function createBoardFromEmail(boardData: {
  board_name: string;
  description?: string;
  is_default?: boolean;
}): Promise<{ board_id: string; board_name: string }> {
  const { knex: db, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    const [board] = await trx('boards')
      .insert({
        tenant,
        board_name: boardData.board_name,
        description: boardData.description || '',
        is_default: boardData.is_default || false,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date()
      })
      .returning(['board_id', 'board_name']);

    return {
      board_id: board.board_id,
      board_name: board.board_name
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
