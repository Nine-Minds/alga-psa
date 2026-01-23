/**
 * Shared Email Service
 * Contains core email processing logic that can be used by both server actions and workflows
 */

import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import logger from '@alga-psa/core/logger';

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

export interface CreateTicketFromEmailInput {
  title: string;
  description: string;
  client_id?: string;
  contact_id?: string;
  source: string;
  board_id: string;
  status_id: string;
  priority_id: string;
  email_metadata: {
    messageId: string;
    threadId?: string;
    from: {
      email: string;
      name?: string;
    };
    inReplyTo?: string;
    references?: string[];
    providerId: string;
  };
}

export interface CreateTicketFromEmailOutput {
  ticket_id: string;
  ticket_number: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  created_at: string;
}

export interface CreateCommentFromEmailInput {
  ticket_id: string;
  content: string;
  format: 'html' | 'text';
  source: string;
  author_type: 'system' | 'contact' | 'user';
  metadata: Record<string, any>;
}

export interface CreateCommentFromEmailOutput {
  comment_id: string;
  ticket_id: string;
  content: string;
  created_at: string;
}

export interface CreateClientFromEmailInput {
  client_name: string;
  email: string;
  source: string;
}

export interface CreateClientFromEmailOutput {
  client_id: string;
  client_name: string;
  email: string;
  created_at: string;
}

export interface GetClientByIdForEmailOutput {
  client_id: string;
  client_name: string;
  email?: string;
  phone?: string;
  address?: string;
}

export interface CreateBoardFromEmailInput {
  board_name: string;
  description: string;
  is_default: boolean;
}

export interface CreateBoardFromEmailOutput {
  board_id: string;
  board_name: string;
  description: string;
  is_default: boolean;
}

export interface FindBoardByNameOutput {
  id: string;
  board_name: string;
  description?: string;
  is_default: boolean;
}

export interface FindStatusByNameInput {
  name: string;
  item_type: string;
}

export interface FindStatusByNameOutput {
  id: string;
  name: string;
  item_type: string;
  is_closed: boolean;
}

export interface FindPriorityByNameOutput {
  id: string;
  priority_name: string;
  description?: string;
}

// =============================================================================
// SHARED EMAIL SERVICE CLASS
// =============================================================================

export class EmailService {
  constructor(private knex: Knex, private tenant: string) {}

  /**
   * Find contact by email address
   */
  async findContactByEmail(email: string): Promise<FindContactByEmailOutput | null> {
    try {
      const contact = await this.knex('contacts')
        .leftJoin('clients', 'contacts.client_id', 'clients.client_id')
        .select(
          'contacts.contact_name_id as contact_id',
          'contacts.full_name as name',
          'contacts.email',
          'contacts.client_id',
          'clients.client_name',
          'contacts.phone_number as phone',
          'contacts.role as title'
        )
        .where({
          'contacts.tenant': this.tenant,
          'contacts.email': email.toLowerCase()
        })
        .first();

      if (!contact) {
        return null;
      }

      return {
        contact_id: contact.contact_id,
        name: contact.name,
        email: contact.email,
        client_id: contact.client_id || '',
        client_name: contact.client_name || '',
        phone: contact.phone,
        title: contact.title
      };
    } catch (error: any) {
      logger.error('Error finding contact by email:', error);
      throw error;
    }
  }

  /**
   * Create or find contact by email and client
   */
  async createOrFindContact(input: CreateOrFindContactInput): Promise<CreateOrFindContactOutput> {
    try {
      // First try to find existing contact
      const existingContact = await this.findContactByEmail(input.email);

      if (existingContact && existingContact.client_id === input.client_id) {
        return {
          id: existingContact.contact_id,
          name: existingContact.name,
          email: existingContact.email,
          client_id: existingContact.client_id,
          phone: existingContact.phone,
          title: existingContact.title,
          created_at: new Date().toISOString(), // We don't have the actual created_at
          is_new: false
        };
      }

      // Create new contact
      const contactId = uuidv4();
      const now = new Date();

      await this.knex('contacts').insert({
        contact_name_id: contactId,
        tenant: this.tenant,
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
    } catch (error: any) {
      logger.error('Error creating or finding contact:', error);
      throw error;
    }
  }

  /**
   * Find ticket by email thread information
   */
  async findTicketByEmailThread(input: FindTicketByEmailThreadInput): Promise<FindTicketByEmailThreadOutput | null> {
    try {
      // Look for existing ticket with matching email metadata
      let query = this.knex('tickets')
        .leftJoin('statuses', 'tickets.status_id', 'statuses.status_id')
        .select(
          'tickets.ticket_id as ticketId',
          'tickets.ticket_number as ticketNumber',
          'tickets.title as subject',
          'statuses.status_name as status',
          'tickets.email_metadata'
        )
        .where('tickets.tenant', this.tenant)
        .where('tickets.email_metadata', '!=', null);

      // Add conditions based on available threading info
      if (input.originalMessageId) {
        query = query.whereRaw("tickets.email_metadata->>'messageId' = ?", [input.originalMessageId]);
      } else if (input.threadId) {
        query = query.whereRaw("tickets.email_metadata->>'threadId' = ?", [input.threadId]);
      } else if (input.inReplyTo) {
        query = query.whereRaw("tickets.email_metadata->>'messageId' = ?", [input.inReplyTo]);
      }

      const ticket = await query.first();

      if (!ticket) {
        return null;
      }

      const emailMetadata = ticket.email_metadata || {};

      return {
        ticketId: ticket.ticketId,
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
        status: ticket.status,
        originalEmailId: emailMetadata.messageId || '',
        threadInfo: {
          threadId: emailMetadata.threadId,
          originalMessageId: emailMetadata.messageId
        }
      };
    } catch (error: any) {
      logger.error('Error finding ticket by email thread:', error);
      throw error;
    }
  }

  /**
   * Create ticket from email
   */
  async createTicketFromEmail(input: CreateTicketFromEmailInput): Promise<CreateTicketFromEmailOutput> {
    try {
      const ticketId = uuidv4();
      const now = new Date();

      // Generate ticket number
      const nextNumber = await this.knex('next_number')
        .select('next_number')
        .where({ tenant: this.tenant, entity_type: 'tickets' })
        .first();

      const ticketNumber = nextNumber?.next_number || 1;

      // Update next number
      await this.knex('next_number')
        .where({ tenant: this.tenant, entity_type: 'tickets' })
        .update({ next_number: ticketNumber + 1 });

      // Create ticket
      await this.knex('tickets').insert({
        ticket_id: ticketId,
        tenant: this.tenant,
        ticket_number: ticketNumber,
        title: input.title,
        description: input.description,
        client_id: input.client_id,
        contact_name_id: input.contact_id,
        board_id: input.board_id,
        status_id: input.status_id,
        priority_id: input.priority_id,
        source: input.source,
        email_metadata: JSON.stringify(input.email_metadata),
        created_at: now,
        updated_at: now
      });

      // Get status and priority names for response
      const [status, priority] = await Promise.all([
        this.knex('statuses').select('status_name').where('status_id', input.status_id).first(),
        this.knex('priorities').select('priority_name').where('priority_id', input.priority_id).first()
      ]);

      return {
        ticket_id: ticketId,
        ticket_number: ticketNumber.toString(),
        title: input.title,
        description: input.description,
        status: status?.status_name || 'Unknown',
        priority: priority?.priority_name || 'Unknown',
        created_at: now.toISOString()
      };
    } catch (error: any) {
      logger.error('Error creating ticket from email:', error);
      throw error;
    }
  }

  /**
   * Create comment from email
   */
  async createCommentFromEmail(input: CreateCommentFromEmailInput): Promise<CreateCommentFromEmailOutput> {
    try {
      const commentId = uuidv4();
      const now = new Date();

      await this.knex('comments').insert({
        comment_id: commentId,
        tenant: this.tenant,
        ticket_id: input.ticket_id,
        comment_text: input.content,
        comment_type: input.format,
        source: input.source,
        author_type: input.author_type,
        metadata: JSON.stringify(input.metadata),
        created_at: now,
        updated_at: now
      });

      return {
        comment_id: commentId,
        ticket_id: input.ticket_id,
        content: input.content,
        created_at: now.toISOString()
      };
    } catch (error: any) {
      logger.error('Error creating comment from email:', error);
      throw error;
    }
  }

  /**
   * Create client from email
   */
  async createClientFromEmail(input: CreateClientFromEmailInput): Promise<CreateClientFromEmailOutput> {
    try {
      const clientId = uuidv4();
      const now = new Date();

      await this.knex('clients').insert({
        client_id: clientId,
        tenant: this.tenant,
        client_name: input.client_name,
        email: input.email,
        source: input.source,
        created_at: now,
        updated_at: now
      });

      return {
        client_id: clientId,
        client_name: input.client_name,
        email: input.email,
        created_at: now.toISOString()
      };
    } catch (error: any) {
      logger.error('Error creating client from email:', error);
      throw error;
    }
  }

  /**
   * Get client by ID for email processing
   */
  async getClientByIdForEmail(clientId: string): Promise<GetClientByIdForEmailOutput | null> {
    try {
      const client = await this.knex('clients')
        .select('client_id', 'client_name', 'email', 'phone', 'address')
        .where({
          client_id: clientId,
          tenant: this.tenant
        })
        .first();

      if (!client) {
        return null;
      }

      return {
        client_id: client.client_id,
        client_name: client.client_name,
        email: client.email,
        phone: client.phone,
        address: client.address
      };
    } catch (error: any) {
      logger.error('Error getting client by ID:', error);
      throw error;
    }
  }

  /**
   * Create board from email
   */
  async createBoardFromEmail(input: CreateBoardFromEmailInput): Promise<CreateBoardFromEmailOutput> {
    try {
      const boardId = uuidv4();
      const now = new Date();

      await this.knex('boards').insert({
        board_id: boardId,
        tenant: this.tenant,
        board_name: input.board_name,
        description: input.description,
        is_default: input.is_default,
        created_at: now,
        updated_at: now
      });

      return {
        board_id: boardId,
        board_name: input.board_name,
        description: input.description,
        is_default: input.is_default
      };
    } catch (error: any) {
      logger.error('Error creating board from email:', error);
      throw error;
    }
  }

  /**
   * Find board by name
   */
  async findBoardByName(name: string): Promise<FindBoardByNameOutput | null> {
    try {
      const board = await this.knex('boards')
        .select('board_id as id', 'board_name', 'description', 'is_default')
        .where({
          board_name: name,
          tenant: this.tenant
        })
        .first();

      return board || null;
    } catch (error: any) {
      logger.error('Error finding board by name:', error);
      throw error;
    }
  }

  /**
   * Find status by name and item type
   */
  async findStatusByName(input: FindStatusByNameInput): Promise<FindStatusByNameOutput | null> {
    try {
      const status = await this.knex('statuses')
        .select('status_id as id', 'status_name as name', 'item_type', 'is_closed')
        .where({
          status_name: input.name,
          item_type: input.item_type,
          tenant: this.tenant
        })
        .first();

      return status || null;
    } catch (error: any) {
      logger.error('Error finding status by name:', error);
      throw error;
    }
  }

  /**
   * Find priority by name
   */
  async findPriorityByName(name: string): Promise<FindPriorityByNameOutput | null> {
    try {
      const priority = await this.knex('priorities')
        .select('priority_id as id', 'priority_name', 'description')
        .where({
          priority_name: name,
          tenant: this.tenant
        })
        .first();

      return priority || null;
    } catch (error: any) {
      logger.error('Error finding priority by name:', error);
      throw error;
    }
  }

  /**
   * Process email attachment (placeholder - would need file storage integration)
   */
  async processEmailAttachment(input: ProcessEmailAttachmentInput): Promise<ProcessEmailAttachmentOutput> {
    try {
      // This is a placeholder implementation
      // In a real implementation, this would:
      // 1. Download the attachment from the email provider
      // 2. Store it in the file storage system
      // 3. Create a document record
      // 4. Associate it with the ticket

      const documentId = uuidv4();

      logger.info(`Processing email attachment: ${input.attachmentData.name} for ticket ${input.ticketId}`);

      return {
        documentId,
        success: true,
        fileName: input.attachmentData.name,
        fileSize: input.attachmentData.size,
        contentType: input.attachmentData.contentType
      };
    } catch (error: any) {
      logger.error('Error processing email attachment:', error);
      throw error;
    }
  }

  /**
   * Save email client association (placeholder)
   */
  async saveEmailClientAssociation(input: SaveEmailClientAssociationInput): Promise<SaveEmailClientAssociationOutput> {
    try {
      const associationId = uuidv4();

      // This would typically save the association to a dedicated table
      // for learning email-to-client mappings

      logger.info(`Saving email association: ${input.email} -> client ${input.client_id}`);

      return {
        success: true,
        associationId,
        email: input.email,
        client_id: input.client_id
      };
    } catch (error: any) {
      logger.error('Error saving email client association:', error);
      throw error;
    }
  }
}

/**
 * Factory function to create EmailService instance
 */
export function createEmailService(knex: Knex, tenant: string): EmailService {
  return new EmailService(knex, tenant);
}
