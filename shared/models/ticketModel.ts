/**
 * Shared Ticket Model - Core business logic for ticket operations
 * This model contains the essential ticket business logic extracted from
 * server actions and used by both server actions and workflow actions.
 */

import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

// =============================================================================
// INTERFACES
// =============================================================================

export interface CreateTicketInput {
  title: string;
  description?: string;
  company_id?: string;
  contact_id?: string; // Note: Maps to contact_name_id in database
  location_id?: string;
  status_id?: string;
  assigned_to?: string;
  priority_id?: string;
  category_id?: string;
  subcategory_id?: string;
  channel_id?: string;
  source?: string;
  entered_by?: string;
  email_metadata?: any;
  attributes?: Record<string, any>;
  // Additional fields for server compatibility
  url?: string;
  severity_id?: string;
  urgency_id?: string;
  impact_id?: string;
  updated_by?: string;
  closed_by?: string;
  closed_at?: string;
  is_closed?: boolean;
}

export interface CreateTicketOutput {
  ticket_id: string;
  ticket_number: string;
  title: string;
  company_id?: string;
  contact_id?: string; // Note: Mapped from contact_name_id
  status_id?: string;
  priority_id?: string;
  channel_id?: string;
  entered_at: string;
  tenant: string;
}

export interface CreateCommentInput {
  ticket_id: string;
  content: string;
  is_internal?: boolean;
  is_resolution?: boolean;
  author_type?: 'internal' | 'contact' | 'system';
  author_id?: string;
  metadata?: any;
}

export interface CreateCommentOutput {
  comment_id: string;
  ticket_id: string;
  content: string;
  author_type: string;
  created_at: string;
}

// =============================================================================
// CORE TICKET MODEL
// =============================================================================

export class TicketModel {
  /**
   * Create a new ticket with proper number generation and validation
   */
  static async createTicket(
    input: CreateTicketInput,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<CreateTicketOutput> {
    // Validate required fields
    if (!input.title) {
      throw new Error('Ticket title is required');
    }

    if (!tenant) {
      throw new Error('Tenant is required');
    }

    // Generate ticket number using the database function
    const numberResult = await trx.raw(
      'SELECT generate_next_number(?::uuid, ?::text) as number',
      [tenant, 'TICKET']
    );
    
    const ticketNumber = numberResult?.rows?.[0]?.number;
    if (!ticketNumber) {
      throw new Error('Failed to generate ticket number');
    }

    const ticketId = uuidv4();
    const now = new Date();

    // Validate location belongs to company if both are provided
    if (input.location_id && input.company_id) {
      const location = await trx('company_locations')
        .where({
          location_id: input.location_id,
          company_id: input.company_id,
          tenant: tenant
        })
        .first();
      
      if (!location) {
        throw new Error('Invalid location: Location does not belong to the selected company');
      }
    }

    // Validate category/subcategory compatibility if both are provided
    if (input.subcategory_id && input.category_id) {
      const subcategory = await trx('categories')
        .where({ category_id: input.subcategory_id, tenant: tenant })
        .first();

      if (subcategory && subcategory.parent_category !== input.category_id) {
        throw new Error('Invalid category combination: subcategory must belong to the selected parent category');
      }
    }

    // Prepare attributes object - description goes into attributes.description
    const attributes = { ...input.attributes };
    if (input.description) {
      attributes.description = input.description;
    }

    // Prepare ticket data
    const ticketData = {
      ticket_id: ticketId,
      tenant,
      title: input.title,
      ticket_number: ticketNumber,
      company_id: input.company_id || null,
      contact_name_id: input.contact_id || null, // Map contact_id to contact_name_id
      location_id: input.location_id || null,
      status_id: input.status_id || null,
      assigned_to: input.assigned_to || null,
      priority_id: input.priority_id || null,
      category_id: input.category_id || null,
      subcategory_id: input.subcategory_id || null,
      channel_id: input.channel_id || null,
      source: input.source || null,
      entered_by: input.entered_by || null,
      entered_at: now,
      updated_at: now,
      // Store attributes and email_metadata as JSON
      attributes: Object.keys(attributes).length > 0 ? JSON.stringify(attributes) : null,
      email_metadata: input.email_metadata ? JSON.stringify(input.email_metadata) : null
    };

    // Insert the ticket
    await trx('tickets').insert(ticketData);

    return {
      ticket_id: ticketId,
      ticket_number: ticketNumber,
      title: input.title,
      company_id: input.company_id,
      contact_id: input.contact_id,
      status_id: input.status_id,
      priority_id: input.priority_id,
      channel_id: input.channel_id,
      entered_at: now.toISOString(),
      tenant
    };
  }

  /**
   * Create a comment for a ticket
   */
  static async createComment(
    input: CreateCommentInput,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<CreateCommentOutput> {
    // Validate required fields
    if (!input.ticket_id) {
      throw new Error('Ticket ID is required');
    }

    if (!input.content) {
      throw new Error('Comment content is required');
    }

    if (!tenant) {
      throw new Error('Tenant is required');
    }

    // Verify ticket exists and belongs to tenant
    const ticket = await trx('tickets')
      .where({
        ticket_id: input.ticket_id,
        tenant: tenant
      })
      .first();

    if (!ticket) {
      throw new Error('Ticket not found or does not belong to tenant');
    }

    const commentId = uuidv4();
    const now = new Date();

    const commentData = {
      comment_id: commentId,
      tenant,
      ticket_id: input.ticket_id,
      note: input.content,
      is_internal: input.is_internal || false,
      is_resolution: input.is_resolution || false,
      author_type: input.author_type || 'system',
      user_id: input.author_id || null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      created_at: now,
      updated_at: now
    };

    await trx('comments').insert(commentData);

    return {
      comment_id: commentId,
      ticket_id: input.ticket_id,
      content: input.content,
      author_type: input.author_type || 'system',
      created_at: now.toISOString()
    };
  }

  /**
   * Get default status ID for tickets
   */
  static async getDefaultStatusId(tenant: string, trx: Knex.Transaction): Promise<string | null> {
    const defaultStatus = await trx('statuses')
      .where({
        tenant,
        is_default: true,
        item_type: 'ticket'
      })
      .first();

    return defaultStatus?.status_id || null;
  }

  /**
   * Find or create a channel by name
   */
  static async findOrCreateChannel(
    channelName: string,
    tenant: string,
    trx: Knex.Transaction,
    description?: string
  ): Promise<string> {
    // Try to find existing channel
    const existingChannel = await trx('channels')
      .where({
        channel_name: channelName,
        tenant: tenant
      })
      .first();

    if (existingChannel) {
      return existingChannel.channel_id;
    }

    // Create new channel
    const channelId = uuidv4();
    const now = new Date();

    await trx('channels').insert({
      channel_id: channelId,
      tenant,
      channel_name: channelName,
      description: description || '',
      is_default: false,
      is_active: true,
      created_at: now,
      updated_at: now
    });

    return channelId;
  }

  /**
   * Find status by name and type
   */
  static async findStatusByName(
    statusName: string,
    itemType: string,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<string | null> {
    const status = await trx('statuses')
      .where({
        name: statusName,
        item_type: itemType,
        tenant: tenant
      })
      .first();

    return status?.status_id || null;
  }

  /**
   * Find priority by name
   */
  static async findPriorityByName(
    priorityName: string,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<string | null> {
    const priority = await trx('priorities')
      .where({
        priority_name: priorityName,
        tenant: tenant
      })
      .first();

    return priority?.priority_id || null;
  }
}