/**
 * Ticket repository - data access layer for tickets
 *
 * This repository provides database operations for tickets.
 * It uses the @alga-psa/database package for connection management.
 */

import type { Knex } from 'knex';
import type {
  Ticket,
  CreateTicketInput,
  UpdateTicketInput,
  TicketFilters,
  TicketListResponse,
  TicketListItem,
} from '../types/index.js';

const TABLE_NAME = 'tickets';

/**
 * Create the ticket repository with database connection
 */
export function createTicketRepository(knex: Knex) {
  return {
    /**
     * Find a ticket by ID
     */
    async findById(
      tenantId: string,
      ticketId: string
    ): Promise<Ticket | null> {
      const result = await knex(TABLE_NAME)
        .where({ tenant: tenantId, ticket_id: ticketId })
        .first();
      return result || null;
    },

    /**
     * Find tickets matching filters with pagination
     */
    async findMany(
      tenantId: string,
      filters: TicketFilters = {}
    ): Promise<TicketListResponse> {
      const {
        search,
        board_id,
        status_id,
        priority_id,
        category_id,
        company_id,
        contact_name_id,
        assigned_to,
        channel_id,
        is_closed,
        tags,
        show_open_only,
        limit = 50,
        offset = 0,
        orderBy = 'entered_at',
        orderDirection = 'desc',
      } = filters;

      let query = knex(TABLE_NAME).where({ [`${TABLE_NAME}.tenant`]: tenantId });

      // Apply search filter
      if (search) {
        query = query.where((builder) => {
          builder
            .whereILike('title', `%${search}%`)
            .orWhereILike('ticket_number', `%${search}%`)
            .orWhereILike('description', `%${search}%`);
        });
      }

      // Apply filters
      if (board_id) {
        query = query.where({ board_id });
      }

      if (status_id) {
        query = query.where({ status_id });
      }

      if (priority_id) {
        query = query.where({ priority_id });
      }

      if (category_id) {
        query = query.where({ category_id });
      }

      if (company_id) {
        query = query.where({ company_id });
      }

      if (contact_name_id) {
        query = query.where({ contact_name_id });
      }

      if (assigned_to) {
        query = query.where({ assigned_to });
      }

      if (channel_id) {
        query = query.where({ channel_id });
      }

      if (is_closed !== undefined) {
        query = query.where({ is_closed });
      }

      if (show_open_only) {
        query = query.where({ is_closed: false });
      }

      // Apply tag filter
      if (tags && tags.length > 0) {
        query = query
          .join('entity_tags', function() {
            this.on('tickets.ticket_id', '=', 'entity_tags.entity_id')
              .andOn(knex.raw('entity_tags.entity_type = ?', ['ticket']));
          })
          .whereIn('entity_tags.tag_id', tags);
      }

      // Get total count
      const countResult = await query.clone().count('* as count').first();
      const total = Number(countResult?.count || 0);

      // Apply ordering and pagination
      const tickets = await query
        .select(`${TABLE_NAME}.*`)
        .orderBy(orderBy, orderDirection)
        .limit(limit)
        .offset(offset);

      return { tickets, total, limit, offset };
    },

    /**
     * Find tickets with joined display data
     */
    async findManyWithDetails(
      tenantId: string,
      filters: TicketFilters = {}
    ): Promise<{ items: TicketListItem[]; total: number; limit: number; offset: number }> {
      const {
        search,
        board_id,
        status_id,
        priority_id,
        category_id,
        company_id,
        contact_name_id,
        assigned_to,
        channel_id,
        is_closed,
        tags,
        show_open_only,
        limit = 50,
        offset = 0,
        orderBy = 'entered_at',
        orderDirection = 'desc',
      } = filters;

      let query = knex(TABLE_NAME)
        .where({ [`${TABLE_NAME}.tenant`]: tenantId })
        .leftJoin('statuses', 'tickets.status_id', 'statuses.status_id')
        .leftJoin('priorities', 'tickets.priority_id', 'priorities.priority_id')
        .leftJoin('ticket_boards', 'tickets.board_id', 'ticket_boards.board_id')
        .leftJoin('ticket_categories', 'tickets.category_id', 'ticket_categories.category_id')
        .leftJoin('companies', 'tickets.company_id', 'companies.company_id')
        .leftJoin('users as entered_by_user', 'tickets.entered_by', 'entered_by_user.user_id')
        .leftJoin('users as assigned_user', 'tickets.assigned_to', 'assigned_user.user_id');

      // Apply filters (same as findMany)
      if (search) {
        query = query.where((builder) => {
          builder
            .whereILike('tickets.title', `%${search}%`)
            .orWhereILike('tickets.ticket_number', `%${search}%`)
            .orWhereILike('tickets.description', `%${search}%`);
        });
      }

      if (board_id) query = query.where({ 'tickets.board_id': board_id });
      if (status_id) query = query.where({ 'tickets.status_id': status_id });
      if (priority_id) query = query.where({ 'tickets.priority_id': priority_id });
      if (category_id) query = query.where({ 'tickets.category_id': category_id });
      if (company_id) query = query.where({ 'tickets.company_id': company_id });
      if (contact_name_id) query = query.where({ 'tickets.contact_name_id': contact_name_id });
      if (assigned_to) query = query.where({ 'tickets.assigned_to': assigned_to });
      if (channel_id) query = query.where({ 'tickets.channel_id': channel_id });
      if (is_closed !== undefined) query = query.where({ 'tickets.is_closed': is_closed });
      if (show_open_only) query = query.where({ 'tickets.is_closed': false });

      if (tags && tags.length > 0) {
        query = query
          .join('entity_tags', function() {
            this.on('tickets.ticket_id', '=', 'entity_tags.entity_id')
              .andOn(knex.raw('entity_tags.entity_type = ?', ['ticket']));
          })
          .whereIn('entity_tags.tag_id', tags);
      }

      // Get total count
      const countResult = await query.clone().count('* as count').first();
      const total = Number(countResult?.count || 0);

      // Get items with joined data
      const items = await query
        .select(
          'tickets.*',
          'statuses.name as status_name',
          'priorities.priority_name',
          'priorities.color as priority_color',
          'ticket_boards.board_name',
          'ticket_categories.category_name',
          'companies.company_name',
          knex.raw('CONCAT(entered_by_user.first_name, \' \', entered_by_user.last_name) as entered_by_name'),
          knex.raw('CONCAT(assigned_user.first_name, \' \', assigned_user.last_name) as assigned_to_name')
        )
        .orderBy(`tickets.${orderBy}`, orderDirection)
        .limit(limit)
        .offset(offset);

      return { items, total, limit, offset };
    },

    /**
     * Create a new ticket
     */
    async create(
      tenantId: string,
      userId: string,
      input: CreateTicketInput
    ): Promise<Ticket> {
      const { tags, ...ticketData } = input;

      // Generate ticket number (simplified - in production, use sequence)
      const ticketNumber = `TKT-${Date.now()}`;

      const [ticket] = await knex(TABLE_NAME)
        .insert({
          ...ticketData,
          tenant: tenantId,
          ticket_number: ticketNumber,
          entered_by: userId,
          is_closed: false,
          entered_at: new Date(),
          updated_at: new Date(),
        })
        .returning('*');

      // Associate tags if provided
      if (tags && tags.length > 0) {
        await knex('entity_tags').insert(
          tags.map((tagId) => ({
            entity_id: ticket.ticket_id,
            entity_type: 'ticket',
            tag_id: tagId,
            tenant: tenantId,
          }))
        );
      }

      return ticket;
    },

    /**
     * Update an existing ticket
     */
    async update(
      tenantId: string,
      userId: string,
      input: UpdateTicketInput
    ): Promise<Ticket | null> {
      const { ticket_id, tags, ...updateData } = input;

      const [ticket] = await knex(TABLE_NAME)
        .where({ tenant: tenantId, ticket_id })
        .update({
          ...updateData,
          updated_by: userId,
          updated_at: new Date(),
        })
        .returning('*');

      if (!ticket) {
        return null;
      }

      // Update tags if provided
      if (tags !== undefined) {
        // Remove existing tags
        await knex('entity_tags')
          .where({ entity_id: ticket_id, entity_type: 'ticket', tenant: tenantId })
          .delete();

        // Add new tags
        if (tags.length > 0) {
          await knex('entity_tags').insert(
            tags.map((tagId) => ({
              entity_id: ticket_id,
              entity_type: 'ticket',
              tag_id: tagId,
              tenant: tenantId,
            }))
          );
        }
      }

      return ticket;
    },

    /**
     * Close a ticket
     */
    async close(
      tenantId: string,
      userId: string,
      ticketId: string,
      closedStatusId: string
    ): Promise<Ticket | null> {
      const [ticket] = await knex(TABLE_NAME)
        .where({ tenant: tenantId, ticket_id: ticketId })
        .update({
          status_id: closedStatusId,
          is_closed: true,
          closed_by: userId,
          closed_at: new Date(),
          updated_by: userId,
          updated_at: new Date(),
        })
        .returning('*');

      return ticket || null;
    },

    /**
     * Delete a ticket (soft delete by marking as closed)
     */
    async delete(tenantId: string, ticketId: string): Promise<boolean> {
      const result = await knex(TABLE_NAME)
        .where({ tenant: tenantId, ticket_id: ticketId })
        .update({ is_closed: true, updated_at: new Date() });

      return result > 0;
    },

    /**
     * Hard delete a ticket (permanent)
     */
    async hardDelete(tenantId: string, ticketId: string): Promise<boolean> {
      // Delete tags first
      await knex('entity_tags')
        .where({ entity_id: ticketId, entity_type: 'ticket', tenant: tenantId })
        .delete();

      const result = await knex(TABLE_NAME)
        .where({ tenant: tenantId, ticket_id: ticketId })
        .delete();

      return result > 0;
    },
  };
}

// Default export for convenience when used with dependency injection
export const ticketRepository = {
  create: createTicketRepository,
};
