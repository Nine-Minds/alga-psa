'use server'

import { ITicket, ITicketListItem, ITicketListFilters, IAgentSchedule } from 'server/src/interfaces/ticket.interfaces';
import { IUser } from 'server/src/interfaces/auth.interfaces';
import { IComment } from 'server/src/interfaces/comment.interface';
import { IClient } from 'server/src/interfaces/client.interfaces';
import { IContact } from 'server/src/interfaces/contact.interfaces';
import { IBoard } from 'server/src/interfaces/board.interface';
import { ITicketCategory } from 'server/src/interfaces/ticket.interfaces';
import { ITicketResource } from 'server/src/interfaces/ticketResource.interfaces';
import { IDocument } from 'server/src/interfaces/document.interface';
import { createTenantKnex } from 'server/src/lib/db';
import { withTransaction } from '@alga-psa/shared/db';
import { Knex } from 'knex';
import { revalidatePath } from 'next/cache';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { z } from 'zod';
import { validateData } from 'server/src/lib/utils/validation';
import { publishEvent } from '../../../lib/eventBus/publishers';
import { getEventBus } from '../../../lib/eventBus';
import { getEmailEventChannel } from '../../../lib/notifications/emailChannel';
import { convertBlockNoteToMarkdown } from 'server/src/lib/utils/blocknoteUtils';
import { getImageUrl } from 'server/src/lib/actions/document-actions/documentActions';
import { getClientLogoUrl, getUserAvatarUrl, getClientLogoUrlsBatch } from 'server/src/lib/utils/avatarUtils';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import {
  ticketFormSchema,
  ticketSchema,
  ticketUpdateSchema, 
  ticketAttributesQuerySchema,
  ticketListItemSchema,
  ticketListFiltersSchema
} from 'server/src/lib/schemas/ticket.schema';
import { analytics } from '../../analytics/posthog';
import { AnalyticsEvents } from '../../analytics/events';

// Helper function to safely convert dates
function convertDates<T extends { entered_at?: Date | string | null, updated_at?: Date | string | null, closed_at?: Date | string | null }>(record: T): T {
  return {
    ...record,
    entered_at: record.entered_at instanceof Date ? record.entered_at.toISOString() : record.entered_at,
    updated_at: record.updated_at instanceof Date ? record.updated_at.toISOString() : record.updated_at,
    closed_at: record.closed_at instanceof Date ? record.closed_at.toISOString() : record.closed_at,
  };
}

// Helper function to safely publish events
async function safePublishEvent(eventType: string, payload: any) {
  try {
    const event = { eventType, payload };

    await getEventBus().publish(event);
    await getEventBus().publish(event, { channel: getEmailEventChannel() });
  } catch (error) {
    console.error(`Failed to publish ${eventType} event:`, error);
  }
}

/**
 * Consolidated function to get all ticket data for the ticket details page
 * This reduces multiple network calls by fetching all related data in a single server action
 */
export async function getConsolidatedTicketData(ticketId: string) {
  // Get current user from session (server-side) for security
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('No authenticated user found');
  }

  const {knex: db, tenant} = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  return withTransaction(db, async (trx) => {
    if (!await hasPermission(user, 'ticket', 'read', trx)) {
      throw new Error('Permission denied: Cannot view ticket');
    }

    try {

    // Fetch ticket with status and location info
    const ticket = await trx('tickets as t')
      .select(
        't.*',
        's.name as status_name',
        's.is_closed',
        'cl.location_id as location_location_id',
        'cl.location_name',
        'cl.address_line1',
        'cl.address_line2',
        'cl.address_line3',
        'cl.city',
        'cl.state_province',
        'cl.postal_code',
        'cl.country_code',
        'cl.country_name',
        'cl.region_code',
        'cl.phone as location_phone',
        'cl.fax as location_fax',
        'cl.email as location_email',
        'cl.is_billing_address',
        'cl.is_shipping_address',
        'cl.is_default as location_is_default'
      )
      .leftJoin('statuses as s', function() {
        this.on('t.status_id', 's.status_id')
           .andOn('t.tenant', 's.tenant')
      })
      .leftJoin('client_locations as cl', function() {
        this.on('t.location_id', 'cl.location_id')
           .andOn('t.tenant', 'cl.tenant')
      })
      .where({
        't.ticket_id': ticketId,
        't.tenant': tenant
      })
      .first();

    if (!ticket) {
      throw new Error('Ticket not found');
    }

    // Fetch all related data in parallel (including tags for immediate display)
    const [
      comments,
      documents,
      clients,
      resources,
      users,
      statuses,
      boards,
      priorities,
      categories,
      tags
    ] = await Promise.all([
      // Comments
      trx('comments')
        .where({
          ticket_id: ticketId,
          tenant: tenant
        })
        .orderBy('created_at', 'asc'),
      
      // Documents
      trx('documents as d')
        .select('d.*')
        .leftJoin('document_associations as da', function() {
          this.on('d.document_id', 'da.document_id')
             .andOn('d.tenant', 'da.tenant')
        })
        .where({
          'da.entity_id': ticketId,
          'da.entity_type': 'ticket',
          'd.tenant': tenant
        }),
      
      trx('clients as c')
        .select(
          'c.*',
          'da.document_id'
        )
        .leftJoin('document_associations as da', function() {
          this.on('da.entity_id', '=', 'c.client_id')
              .andOn('da.tenant', '=', 'c.tenant')
              .andOnVal('da.entity_type', '=', 'client');
        })
        .where({ 'c.tenant': tenant })
        .orderBy('c.client_name', 'asc'),

      trx('ticket_resources')
        .where({
          ticket_id: ticketId,
          tenant: tenant
        }),
      
      // Users - removed document joins that were causing duplicates
      // Avatar URLs are fetched later using getUserAvatarUrl()
      trx('users')
        .where({ tenant })
        .orderBy('first_name', 'asc'),
      
      // Statuses
      trx('statuses')
        .where({
          tenant: tenant,
          status_type: 'ticket'
        })
        .orderBy('order_number', 'asc')
        .orderBy('name', 'asc'),
      
      // Boards
      trx('boards')
        .where({ tenant })
        .orderBy('board_name', 'asc'),
      
      // Priorities - fetch only tenant-specific ticket priorities
      trx('priorities')
        .where({ tenant, item_type: 'ticket' })
        .orderBy('priority_name', 'asc'),
      
      // Categories
      trx('categories')
        .where({ tenant })
        .orderBy('category_name', 'asc'),

      // Tags for this ticket (pre-fetched for immediate display)
      trx('tag_mappings as tm')
        .select(
          'td.tag_id',
          'td.tag_text',
          'td.tagged_type',
          'td.background_color',
          'td.text_color',
          'tm.mapping_id',
          'tm.tagged_id'
        )
        .join('tag_definitions as td', function() {
          this.on('tm.tag_id', 'td.tag_id')
              .andOn('tm.tenant', 'td.tenant')
        })
        .where({
          'tm.tagged_id': ticketId,
          'tm.tagged_type': 'ticket',
          'tm.tenant': tenant
        })
    ]);

    // --- Add Logo URL Processing for the fetched 'clients' list ---
    const clientsData = clients as (IClient & { document_id?: string })[];
    const documentIds = clientsData
      .map((c: any) => c.document_id)
      .filter((id: any): id is string => !!id);

    let fileIdMap: Record<string, string> = {};
    if (documentIds.length > 0) {
      const fileRecords = await trx('documents')
        .select('document_id', 'file_id')
        .whereIn('document_id', documentIds)
        .andWhere({ tenant });

      fileIdMap = fileRecords.reduce((acc, record) => {
        if (record.file_id) {
          acc[record.document_id] = record.file_id;
        }
        return acc;
      }, {} as Record<string, string>);
    }

    // Process the full clients list to add logoUrl using batch loading
    const clientIds = clientsData.map(c => c.client_id);
    const logoUrlsMap = await getClientLogoUrlsBatch(clientIds, tenant);
    
    const clientsWithLogos = clientsData.map((clientData) => {
      const logoUrl = logoUrlsMap.get(clientData.client_id) || null;
      const { document_id, ...clientResult } = clientData;
      return {
        ...clientResult,
        properties: clientData.properties || {},
        logoUrl,
      };
    });
    // --- End Logo URL Processing for 'clients' list ---


    // Fetch specific client and contact data if available
    let client: any = null;
    let contacts: IContact[] = [];
    let contactInfo: any = null;
    let locations: any[] = [];
    
    if (ticket.client_id) {
      [client, contacts, locations] = await Promise.all([
        trx('clients as c')
          .select(
            'c.*',
            'd.file_id'
          )
          .leftJoin('document_associations as da', function() {
            this.on('da.entity_id', '=', 'c.client_id')
                .andOn('da.tenant', '=', 'c.tenant')
                .andOnVal('da.entity_type', '=', 'client');
          })
          .leftJoin('documents as d', function() {
             this.on('d.document_id', '=', 'da.document_id')
                .andOn('d.tenant', '=', 'c.tenant');
          })
          .where({
            'c.client_id': ticket.client_id,
            'c.tenant': tenant
          })
          .first(),

        trx('contacts')
          .where({
            client_id: ticket.client_id,
            tenant: tenant
          })
          .orderBy('full_name', 'asc'),
          
        trx('client_locations')
          .where({
            client_id: ticket.client_id,
            tenant: tenant,
            is_active: true
          })
          .orderBy('is_default', 'desc')
          .orderBy('location_name', 'asc')
      ]);
      
      if (client) {
        try {
          client.logoUrl = await getClientLogoUrl(client.client_id, tenant);
        } catch (imgError) {
          console.error(`Error fetching logo URL for client ${client.client_id}:`, imgError);
          client.logoUrl = null;
        }
        if ('file_id' in client) {
            delete client.file_id;
        }
      }
    }

    if (ticket.contact_name_id) {
      contactInfo = await trx('contacts')
        .where({
          contact_name_id: ticket.contact_name_id,
          tenant: tenant
        })
        .first();
    }

    // Fetch created by user
    const createdByUser = ticket.entered_by ? 
      await trx('users')
        .where({
          user_id: ticket.entered_by,
          tenant: tenant
        })
        .first() : null;

    // Fetch board
    const board = ticket.board_id ?
      await trx('boards')
        .where({
          board_id: ticket.board_id,
          tenant: tenant
        })
        .first() : null;

    // Process user data for userMap, including avatar URLs
    const usersWithAvatars = await Promise.all(users.map(async (user: any) => {
      let avatarUrl: string | null = null;
      try {
        avatarUrl = await getUserAvatarUrl(user.user_id, tenant);
      } catch (imgError) {
        console.error(`Error fetching avatar URL for user ${user.user_id}:`, imgError);
        avatarUrl = null;
      }

      return {
        ...user,
        avatarUrl,
      };
    }));

    const userMap = usersWithAvatars.reduce((acc, user) => {
      acc[user.user_id] = {
        user_id: user.user_id,
        first_name: user.first_name || '',
        last_name: user.last_name || '',
        email: user.email,
        user_type: user.user_type,
        avatarUrl: user.avatarUrl // Include avatarUrl
      };
      return acc;
    }, {} as Record<string, { user_id: string; first_name: string; last_name: string; email?: string, user_type: string, avatarUrl: string | null }>);

    // Format options for dropdowns
    const statusOptions = statuses.map((status) => ({
      value: status.status_id,
      label: status.name || ""
    }));

    const agentOptions = users.map((agent) => ({
      value: agent.user_id,
      label: `${agent.first_name} ${agent.last_name}`
    }));

    const boardOptions = boards
      .filter(board => board.board_id !== undefined)
      .map((board) => ({
        value: board.board_id,
        label: board.board_name || ""
      }));

    const priorityOptions = priorities.map((priority) => ({
      value: priority.priority_id,
      label: priority.priority_name,
      color: priority.color
    }));

    // Get scheduled hours for ticket
    const scheduleEntries = await trx('schedule_entries as se')
      .select(
        'se.*',
        'sea.user_id'
      )
      .leftJoin('schedule_entry_assignees as sea', function() {
        this.on('se.entry_id', 'sea.entry_id')
           .andOn('se.tenant', 'sea.tenant')
      })
      .where({
        'se.work_item_id': ticketId,
        'se.work_item_type': 'ticket',
        'se.tenant': tenant
      });

    // Calculate scheduled hours per agent
    const agentSchedules: Record<string, number> = {};
    
    scheduleEntries.forEach((entry: any) => {
      const userId = entry.user_id;
      if (!userId) {
        return; // Skip entries with no user_id
      }
      
      const startTime = new Date(entry.scheduled_start);
      const endTime = new Date(entry.scheduled_end);
      const durationMs = endTime.getTime() - startTime.getTime();
      const durationMinutes = Math.ceil(durationMs / (1000 * 60)); // Convert ms to minutes
      
      if (!agentSchedules[userId]) {
        agentSchedules[userId] = 0;
      }
      
      agentSchedules[userId] += durationMinutes;
    });

    // Convert to array format
    const agentSchedulesList: IAgentSchedule[] = Object.entries(agentSchedules).map(([userId, minutes]) => ({
      userId,
      minutes
    }));

    // Process location data from ticket query
    const location = ticket.location_location_id ? {
      location_id: ticket.location_location_id,
      location_name: ticket.location_name,
      address_line1: ticket.address_line1,
      address_line2: ticket.address_line2,
      address_line3: ticket.address_line3,
      city: ticket.city,
      state_province: ticket.state_province,
      postal_code: ticket.postal_code,
      country_code: ticket.country_code,
      country_name: ticket.country_name,
      region_code: ticket.region_code,
      phone: ticket.location_phone,
      fax: ticket.location_fax,
      email: ticket.location_email,
      is_billing_address: ticket.is_billing_address,
      is_shipping_address: ticket.is_shipping_address,
      is_default: ticket.location_is_default
    } : null;

    // Remove location fields from ticket object
    const {
      location_location_id,
      location_name,
      address_line1,
      address_line2,
      address_line3,
      city,
      state_province,
      postal_code,
      country_code,
      country_name,
      region_code,
      location_phone,
      location_fax,
      location_email,
      is_billing_address,
      is_shipping_address,
      location_is_default,
      ...ticketData
    } = ticket;

    // Track ticket view analytics
    analytics.capture('ticket_viewed', {
      ticket_id: ticketId,
      status_id: ticketData.status_id,
      status_name: ticketData.status_name,
      is_closed: ticketData.is_closed,
      priority_id: ticketData.priority_id,
      category_id: ticketData.category_id,
      board_id: ticketData.board_id,
      assigned_to: ticketData.assigned_to,
      client_id: ticketData.client_id,
      has_comments: comments.length > 0,
      comment_count: comments.length,
      has_documents: documents.length > 0,
      document_count: documents.length,
      has_additional_agents: resources.length > 0,
      additional_agent_count: resources.length,
      has_schedule: agentSchedulesList.length > 0,
      total_scheduled_minutes: agentSchedulesList.reduce((sum, schedule) => sum + schedule.minutes, 0),
      view_source: 'ticket_details'
    }, user.user_id);

    // Return all data in a single consolidated object
    return {
      ticket: {
        ...convertDates(ticketData),
        tenant,
        location
      },
      comments,
      documents,
      client,
      contacts,
      contactInfo,
      createdByUser,
      board,
      additionalAgents: resources,
      availableAgents: users,
      userMap,
      options: {
        status: statusOptions,
        agent: agentOptions,
        board: boardOptions,
        priority: priorityOptions
      },
      categories,
      clients: clientsWithLogos,
      locations,
      agentSchedules: agentSchedulesList,
      tags: tags.map((tag: any) => ({
        tag_id: tag.tag_id,
        tag_text: tag.tag_text,
        tagged_id: tag.tagged_id,
        tagged_type: tag.tagged_type,
        background_color: tag.background_color,
        text_color: tag.text_color
      }))
    };
    } catch (error) {
      console.error('Failed to fetch consolidated ticket data:', error);
      throw new Error('Failed to fetch ticket data');
    }
  });
}

/**
 * Get tickets for list with page-based pagination
 * This replaces cursor-based pagination with traditional page-based approach
 */
export async function getTicketsForList(
  user: IUser,
  filters: ITicketListFilters,
  page: number = 1,
  pageSize: number = 10
): Promise<{ tickets: ITicketListItem[], totalCount: number }> {
  const {knex: db, tenant} = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  return withTransaction(db, async (trx) => {
    if (!await hasPermission(user, 'ticket', 'read', trx)) {
      throw new Error('Permission denied: Cannot view tickets');
    }

    try {
      const validatedFilters = validateData(ticketListFiltersSchema, filters) as ITicketListFilters;

      // Explicitly clear "$undefined" string values for ID filters
      // to prevent them from being used as literal filter values if they bypass Zod.
      if (validatedFilters.boardId === '$undefined') {
        validatedFilters.boardId = undefined;
      }
      if (validatedFilters.categoryId === '$undefined') {
        validatedFilters.categoryId = undefined;
      }
      if (validatedFilters.clientId === '$undefined') {
        validatedFilters.clientId = undefined;
      }
      if (validatedFilters.contactId === '$undefined') {
        validatedFilters.contactId = undefined;
      }

    // Build base query for filtering
    let baseQuery = trx('tickets as t')
      .leftJoin('statuses as s', function() {
        this.on('t.status_id', 's.status_id')
           .andOn('t.tenant', 's.tenant')
      })
      .leftJoin('priorities as p', function() {
        this.on('t.priority_id', 'p.priority_id')
           .andOn('t.tenant', 'p.tenant')
           .andOnVal('p.item_type', '=', 'ticket')
      })
      .leftJoin('boards as c', function() {
        this.on('t.board_id', 'c.board_id')
           .andOn('t.tenant', 'c.tenant')
      })
      .leftJoin('categories as cat', function() {
        this.on('t.category_id', 'cat.category_id')
           .andOn('t.tenant', 'cat.tenant')
      })
      .leftJoin('clients as comp', function() {
        this.on('t.client_id', 'comp.client_id')
           .andOn('t.tenant', 'comp.tenant')
      })
      .leftJoin('users as u', function() {
        this.on('t.entered_by', 'u.user_id')
           .andOn('t.tenant', 'u.tenant')
      })
      .leftJoin('users as au', function() {
        this.on('t.assigned_to', 'au.user_id')
           .andOn('t.tenant', 'au.tenant')
      })
      .where({
        't.tenant': tenant
      });

    // Apply filters to base query
    if (validatedFilters.boardId) {
      baseQuery = baseQuery.where('t.board_id', validatedFilters.boardId);
    } else if (validatedFilters.boardFilterState !== 'all') {
      const boardSubquery = trx('boards')
        .select('board_id')
        .where('tenant', tenant)
        .where('is_inactive', validatedFilters.boardFilterState === 'inactive');

      baseQuery = baseQuery.whereIn('t.board_id', boardSubquery);
    }

    if (validatedFilters.showOpenOnly) {
      baseQuery = baseQuery.whereExists(function() {
        this.select('*')
            .from('statuses')
            .whereRaw('statuses.status_id = t.status_id')
            .andWhere('statuses.is_closed', false)
            .andWhere('statuses.tenant', tenant);
      });
    } else if (validatedFilters.statusId && validatedFilters.statusId !== 'all') {
      baseQuery = baseQuery.where('t.status_id', validatedFilters.statusId);
    }

    if (validatedFilters.priorityId && validatedFilters.priorityId !== 'all') {
      baseQuery = baseQuery.where('t.priority_id', validatedFilters.priorityId);
    }

    if (validatedFilters.categoryId) {
      if (validatedFilters.categoryId === 'no-category') {
        baseQuery = baseQuery.whereNull('t.category_id');
      } else if (validatedFilters.categoryId !== 'all') {
        baseQuery = baseQuery.where('t.category_id', validatedFilters.categoryId);
      }
    }

    if (validatedFilters.clientId) {
      baseQuery = baseQuery.where('t.client_id', validatedFilters.clientId);
    }

    if (validatedFilters.contactId) {
      baseQuery = baseQuery.where('t.contact_name_id', validatedFilters.contactId);
    }

    if (validatedFilters.searchQuery) {
      const searchTerm = `%${validatedFilters.searchQuery}%`;
      baseQuery = baseQuery.where(function(this: any) {
        this.where('t.title', 'ilike', searchTerm)
            .orWhere('t.ticket_number', 'ilike', searchTerm);
      });
    }

    // Apply tag filter if provided
    if (validatedFilters.tags && validatedFilters.tags.length > 0) {
      baseQuery = baseQuery.whereIn('t.ticket_id', function() {
        this.select('tm.tagged_id')
          .from('tag_mappings as tm')
          .join('tag_definitions as td', function() {
            this.on('tm.tenant', '=', 'td.tenant')
                .andOn('tm.tag_id', '=', 'td.tag_id');
          })
          .where('tm.tagged_type', 'ticket')
          .andWhere('tm.tenant', tenant)
          .whereIn('td.tag_text', validatedFilters.tags as string[]);
      });
    }

    // Apply assignee filter if provided
    if (validatedFilters.assignedToIds?.length || validatedFilters.includeUnassigned) {
      baseQuery = baseQuery.where(function(this: any) {
        // Handle specific assignee IDs
        if (validatedFilters.assignedToIds?.length) {
          this.whereIn('t.assigned_to', validatedFilters.assignedToIds);
        }

        // Handle unassigned (OR condition if both specified)
        if (validatedFilters.includeUnassigned) {
          if (validatedFilters.assignedToIds?.length) {
            this.orWhereNull('t.assigned_to');
          } else {
            this.whereNull('t.assigned_to');
          }
        }
      });
    }

    const sortBy = validatedFilters.sortBy ?? 'entered_at';
    const sortDirection: 'asc' | 'desc' = validatedFilters.sortDirection ?? 'desc';
    const sortColumnMap: Record<string, { column?: string; rawExpression?: string }> = {
      ticket_number: { column: 't.ticket_number' },
      title: { column: 't.title' },
      status_name: { column: 's.name' },
      priority_name: { column: 'p.priority_name' },
      board_name: { column: 'c.board_name' },
      category_name: { column: 'cat.category_name' },
      client_name: { column: 'comp.client_name' },
      entered_at: { column: 't.entered_at' },
      entered_by_name: { rawExpression: "COALESCE(CONCAT(u.first_name, ' ', u.last_name), '')" }
    };
    const selectedSort = sortColumnMap[sortBy] || sortColumnMap.entered_at;

    // Get total count
    const countQuery = baseQuery.clone().clearSelect().clearOrder().count('t.ticket_id as count');
    const [{ count }] = await countQuery;
    const totalCount = parseInt(String(count), 10);

    // Build query for paginated results
    const query = baseQuery
      .clone()
      .select(
        't.*',
        's.name as status_name',
        'p.priority_name',
        'p.color as priority_color',
        'c.board_name',
        'cat.category_name',
        'comp.client_name',
        trx.raw("CONCAT(u.first_name, ' ', u.last_name) as entered_by_name"),
        trx.raw("CONCAT(au.first_name, ' ', au.last_name) as assigned_to_name"),
        trx.raw("(SELECT COUNT(*) FROM ticket_resources tr WHERE tr.ticket_id = t.ticket_id AND tr.tenant = t.tenant)::int as additional_agent_count"),
        trx.raw(`(SELECT COALESCE(json_agg(json_build_object('user_id', uu.user_id, 'name', CONCAT(uu.first_name, ' ', uu.last_name))), '[]'::json) FROM ticket_resources tr2 JOIN users uu ON tr2.additional_user_id = uu.user_id AND tr2.tenant = uu.tenant WHERE tr2.ticket_id = t.ticket_id AND tr2.tenant = t.tenant) as additional_agents`)
      )
      .modify(queryBuilder => {
        if (selectedSort.rawExpression) {
          queryBuilder.orderByRaw(`${selectedSort.rawExpression} ${sortDirection}`);
        } else if (selectedSort.column) {
          queryBuilder.orderBy(selectedSort.column, sortDirection);
        } else {
          queryBuilder.orderBy('t.entered_at', sortDirection);
        }
      })
      .orderBy('t.ticket_id', 'desc')
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const tickets = await query;

    // Transform and validate the data
    const ticketListItems = tickets.map((ticket: any): ITicketListItem => {
      const {
        status_id,
        priority_id,
        board_id,
        category_id,
        entered_by,
        status_name,
        priority_name,
        priority_color,
        board_name,
        category_name,
        client_name,
        entered_by_name,
        assigned_to_name,
        additional_agent_count,
        additional_agents,
        // NOTE: Legacy ITIL fields removed - now using unified system
        ...rest
      } = ticket;

      const convertedRest = convertDates(rest);
      // Clean up null ITIL fields
      if (convertedRest.itil_impact === null) {
        convertedRest.itil_impact = undefined;
      }
      if (convertedRest.itil_urgency === null) {
        convertedRest.itil_urgency = undefined;
      }
      if (convertedRest.itil_priority_level === null) {
        convertedRest.itil_priority_level = undefined;
      }
      return {
        ...convertedRest,
        status_id: status_id || null,
        priority_id: priority_id || null,
        board_id: board_id || null,
        category_id: category_id || null,
        entered_by: entered_by || null,
        status_name: status_name || 'Unknown',
        priority_name: priority_name || 'Unknown',
        priority_color: priority_color || '#6B7280',
        board_name: board_name || 'Unknown',
        category_name: category_name || 'Unknown',
        client_name: client_name || 'Unknown',
        entered_by_name: entered_by_name || 'Unknown',
        assigned_to_name: assigned_to_name || null,
        additional_agent_count: additional_agent_count || 0,
        additional_agents: additional_agents || []
      };
    });

    return {
      tickets: ticketListItems as ITicketListItem[],
      totalCount
    };
    } catch (error) {
      console.error('Failed to fetch tickets:', error);
      throw new Error('Failed to fetch tickets');
    }
  });
}

/**
 * Get all options needed for ticket forms and filters
 * This consolidates multiple API calls into a single request
 */
export async function getTicketFormOptions(user: IUser) {
  const {knex: db, tenant} = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  return withTransaction(db, async (trx) => {
    if (!await hasPermission(user, 'ticket', 'read', trx)) {
      throw new Error('Permission denied: Cannot view ticket options');
    }

    try {

    // Fetch all options in parallel
    const [
      statuses,
      priorities,
      boards,
      categories,
      clients,
      users,
      tags
    ] = await Promise.all([
      trx('statuses')
        .where({
          tenant: tenant,
          status_type: 'ticket'  // Changed from item_type to status_type
        })
        .orderBy('order_number', 'asc')
        .orderBy('name', 'asc'),

      // Fetch only tenant-specific ticket priorities (includes ITIL ones copied to tenant)
      trx('priorities')
        .where({ tenant, item_type: 'ticket' })
        .orderBy('order_number', 'asc')
        .orderBy('priority_name', 'asc'),
      
      trx('boards')
        .where({ tenant })
        .orderBy('board_name', 'asc'),

      // Fetch only tenant-specific categories (includes ITIL ones copied to tenant)
      trx('categories')
        .where({ tenant })
        .orderBy('display_order', 'asc')
        .orderBy('category_name', 'asc'),
      
      trx('clients as c')
        .select('c.*')
        .where({ 'c.tenant': tenant })
        .orderBy('c.client_name', 'asc'),

      trx('users')
        .where({ tenant })
        .orderBy('first_name', 'asc'),
      
      // Fetch all unique tags for tickets
      trx('tag_definitions')
        .distinct('tag_text')
        .where({ tenant, tagged_type: 'ticket' })
        .orderBy('tag_text', 'asc')
    ]);

    // Format options for dropdowns
    const statusOptions = [
      { value: 'open', label: 'All open statuses' },
      { value: 'all', label: 'All Statuses' },
      ...statuses.map((status: any) => ({
        value: status.status_id,
        label: status.name || "",
        className: status.is_closed ? 'bg-gray-200 text-gray-600' : undefined
      }))
    ];

    const priorityOptions = [
      { value: 'all', label: 'All Priorities' },
      ...priorities.map((priority: any) => ({
        value: priority.priority_id,
        label: priority.priority_name,
        color: priority.color
      }))
    ];

    const boardOptions: IBoard[] = boards.filter((board: IBoard) => board.board_id !== undefined);

    const agentOptions = users.map((user: any) => ({
      value: user.user_id,
      label: `${user.first_name} ${user.last_name}`
    }));

    // --- Add Logo URL Processing ---
    const clientsData = clients; 

    // Process clients to add logoUrl using batch loading
    const clientIds = clientsData.map(c => c.client_id);
    const logoUrlsMap = await getClientLogoUrlsBatch(clientIds, tenant);
    
    const clientsWithLogos = clientsData.map((clientData) => {
      const logoUrl = logoUrlsMap.get(clientData.client_id) || null;
      return {
        ...clientData,
        properties: clientData.properties || {},
        logoUrl,
      };
    });
    // --- End Logo URL Processing ---

    // Use tenant categories directly (includes ITIL ones if copied)

    return {
      statusOptions,
      priorityOptions,
      boardOptions,
      agentOptions,
      categories,
      clients: clientsWithLogos, // Return clients with logos
      users,
      tags: Array.isArray(tags) ? tags.map((tag: any) => tag.tag_text) : [] // Return unique tag texts
    };
    } catch (error) {
      console.error('Failed to fetch ticket form options:', error);
      throw new Error('Failed to fetch ticket form options');
    }
  });
}

/**
 * Update ticket with proper caching
 */
export async function updateTicketWithCache(id: string, data: Partial<ITicket>, user: IUser) {
  const {knex: db, tenant} = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  return withTransaction(db, async (trx) => {
    if (!await hasPermission(user, 'ticket', 'update', trx)) {
      throw new Error('Permission denied: Cannot update ticket');
    }

    try {
      // Validate update data
      const validatedData = validateData(ticketUpdateSchema, data);

    // Get current ticket state before update
    const currentTicket = await trx('tickets')
      .where({ ticket_id: id, tenant: tenant })
      .first();

    if (!currentTicket) {
      throw new Error('Ticket not found');
    }

    // Clean up the data before update
    const updateData = { ...validatedData };

    // Handle null values for category and subcategory
    if ('category_id' in updateData && !updateData.category_id) {
      updateData.category_id = null;
    }
    if ('subcategory_id' in updateData && !updateData.subcategory_id) {
      updateData.subcategory_id = null;
    }

    // Validate board_id belongs to the same tenant if being updated
    if ('board_id' in updateData && updateData.board_id) {
      const board = await trx('boards')
        .where({
          board_id: updateData.board_id,
          tenant: tenant
        })
        .first();

      if (!board) {
        throw new Error('Invalid board_id: Board does not exist or does not belong to this tenant');
      }
    }

    // Handle ITIL priority calculation if impact or urgency is being updated
    if (('itil_impact' in updateData || 'itil_urgency' in updateData)) {
      const newImpact = 'itil_impact' in updateData ? updateData.itil_impact : currentTicket.itil_impact;
      const newUrgency = 'itil_urgency' in updateData ? updateData.itil_urgency : currentTicket.itil_urgency;

      if (newImpact && newUrgency) {
        // Calculate ITIL priority level
        const { calculateItilPriority } = require('../../utils/itilUtils');
        const priorityLevel = calculateItilPriority(newImpact, newUrgency);

        // Map priority level to ITIL priority name pattern
        const priorityNamePattern = `P${priorityLevel} -%`;

        // Get the corresponding ITIL priority record from tenant's priorities table
        const itilPriorityRecord = await trx('priorities')
          .where('tenant', tenant)
          .where('is_from_itil_standard', true)
          .where('priority_name', 'like', priorityNamePattern)
          .where('item_type', 'ticket')
          .first();

        if (itilPriorityRecord) {
          updateData.priority_id = itilPriorityRecord.priority_id;
          updateData.itil_priority_level = priorityLevel;
        }
      }
    }

    // Check if we're updating the assigned_to field
    const isChangingAssignment = 'assigned_to' in updateData &&
                                updateData.assigned_to !== currentTicket.assigned_to;

    // If updating category or subcategory, ensure they are compatible
    if ('subcategory_id' in updateData || 'category_id' in updateData) {
      const newSubcategoryId = updateData.subcategory_id;
      const newCategoryId = updateData.category_id || currentTicket?.category_id;

      if (newSubcategoryId) {
        // If setting a subcategory, verify it's a valid child of the category
        const subcategory = await trx('categories')
          .where({ category_id: newSubcategoryId, tenant: tenant })
          .first();

        if (subcategory && subcategory.parent_category !== newCategoryId) {
          throw new Error('Invalid category combination: subcategory must belong to the selected parent category');
        }
      }
    }

    // Get the status before and after update to check for closure
    const oldStatus = await trx('statuses')
      .where({
        status_id: currentTicket.status_id,
        tenant: tenant
      })
      .first();
    
    let updatedTicket;
    
    // If we're changing the assigned_to field, we need to handle the ticket_resources table
    if (isChangingAssignment) {
      // Use the existing transaction instead of creating a nested one
        // Step 1: Delete any ticket_resources where the new assigned_to is an additional_user_id
        // to avoid constraint violations after the update
        await trx('ticket_resources')
          .where({
            tenant: tenant,
            ticket_id: id,
            additional_user_id: updateData.assigned_to
          })
          .delete();
        
        // Step 2: Get existing resources with the old assigned_to value
        const existingResources = await trx('ticket_resources')
          .where({
            tenant: tenant,
            ticket_id: id,
            assigned_to: currentTicket.assigned_to
          })
          .select('*');
          
        // Step 3: Store resources for recreation, excluding those that would violate constraints
        const resourcesToRecreate: any[] = [];
        for (const resource of existingResources) {
          // Skip resources where additional_user_id would equal the new assigned_to
          if (resource.additional_user_id !== updateData.assigned_to) {
            // Clone the resource but exclude the primary key fields
            const { assignment_id, ...resourceData } = resource;
            resourcesToRecreate.push(resourceData);
          }
        }
        
        // Step 4: Delete the existing resources with the old assigned_to
        if (existingResources.length > 0) {
          await trx('ticket_resources')
            .where({
              tenant: tenant,
              ticket_id: id,
              assigned_to: currentTicket.assigned_to
            })
            .delete();
        }
        
        // Step 5: Update the ticket with the new assigned_to
        const [updated] = await trx('tickets')
          .where({ ticket_id: id, tenant: tenant })
          .update(updateData)
          .returning('*');
          
        // Step 6: Re-create the resources with the new assigned_to
        for (const resourceData of resourcesToRecreate) {
          await trx('ticket_resources').insert({
            ...resourceData,
            assigned_to: updateData.assigned_to
          });
        }
        
        updatedTicket = updated;
    } else {
      // Regular update without changing assignment
      [updatedTicket] = await trx('tickets')
        .where({ ticket_id: id, tenant: tenant })
        .update(updateData)
        .returning('*');
    }

    if (!updatedTicket) {
      throw new Error('Ticket not found or update failed');
    }

    // Get the new status if it was updated
    const newStatus = updateData.status_id ? 
      await trx('statuses')
        .where({ 
          status_id: updateData.status_id,
          tenant: tenant
        })
        .first() :
      oldStatus;

    // Build structured changes object with old/new values
    const structuredChanges: Record<string, any> = {};

    if (updateData.status_id !== undefined && updateData.status_id !== currentTicket.status_id) {
      structuredChanges.status_id = {
        old: currentTicket.status_id,
        new: updateData.status_id
      };
    }

    if (updateData.priority_id !== undefined && updateData.priority_id !== currentTicket.priority_id) {
      structuredChanges.priority_id = {
        old: currentTicket.priority_id,
        new: updateData.priority_id
      };
    }

    if (updateData.assigned_to !== undefined && updateData.assigned_to !== currentTicket.assigned_to) {
      structuredChanges.assigned_to = {
        old: currentTicket.assigned_to,
        new: updateData.assigned_to
      };
    }

    if (updateData.board_id !== undefined && updateData.board_id !== currentTicket.board_id) {
      structuredChanges.board_id = {
        old: currentTicket.board_id,
        new: updateData.board_id
      };
    }

    if (updateData.category_id !== undefined && updateData.category_id !== currentTicket.category_id) {
      structuredChanges.category_id = {
        old: currentTicket.category_id,
        new: updateData.category_id
      };
    }

    if (updateData.subcategory_id !== undefined && updateData.subcategory_id !== currentTicket.subcategory_id) {
      structuredChanges.subcategory_id = {
        old: currentTicket.subcategory_id,
        new: updateData.subcategory_id
      };
    }

    // Publish appropriate event based on the update
    if (newStatus?.is_closed && !oldStatus?.is_closed) {
      // Ticket was closed
      await publishEvent({
        eventType: 'TICKET_CLOSED',
        payload: {
          tenantId: tenant,
          ticketId: id,
          userId: user.user_id,
          changes: structuredChanges
        }
      });
    } else if (updateData.assigned_to && updateData.assigned_to !== currentTicket.assigned_to) {
      // Ticket was assigned - userId should be the user being assigned, not the one making the update
      await publishEvent({
        eventType: 'TICKET_ASSIGNED',
        payload: {
          tenantId: tenant,
          ticketId: id,
          userId: updateData.assigned_to,  // The user being assigned to the ticket
          changes: structuredChanges
        }
      });
    } else {
      // Regular update
      await publishEvent({
        eventType: 'TICKET_UPDATED',
        payload: {
          tenantId: tenant,
          ticketId: id,
          userId: user.user_id,
          changes: structuredChanges
        }
      });
    }

    // Revalidate paths to update UI
    revalidatePath(`/msp/tickets/${id}`);
    revalidatePath('/msp/tickets');

    return 'success';
    } catch (error) {
      console.error(error);
      throw new Error('Failed to update ticket');
    }
  });
}

/**
 * Add comment to ticket with proper caching
 */
export async function addTicketCommentWithCache(
  ticketId: string,
  content: string,
  isInternal: boolean,
  isResolution: boolean,
  user: IUser
): Promise<IComment> {
  const {knex: db, tenant} = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  return withTransaction(db, async (trx) => {
    if (!await hasPermission(user, 'ticket', 'update', trx)) {
      throw new Error('Permission denied: Cannot add comment');
    }

    try {

    // Verify ticket exists
    const ticket = await trx('tickets')
      .where({
        ticket_id: ticketId,
        tenant: tenant
      })
      .first();

    if (!ticket) {
      throw new Error('Ticket not found');
    }

    // Use the centralized utility to convert BlockNote JSON to markdown
    let markdownContent = "";
    try {
      markdownContent = await convertBlockNoteToMarkdown(content);
      console.log("Converted markdown content for optimized comment:", markdownContent);
    } catch (e) {
      console.error("Error converting content to markdown:", e);
      // If conversion fails, use a fallback message
      markdownContent = "[Error converting content to markdown]";
    }
    
    // Insert comment with markdown_content
    const [newComment] = await trx('comments').insert({
      tenant,
      ticket_id: ticketId,
      user_id: user.user_id,
      author_type: 'internal',
      note: content,
      is_internal: isInternal,
      is_resolution: isResolution,
      markdown_content: markdownContent, // Add markdown content
      created_at: new Date().toISOString()
    }).returning('*');

    // Publish comment added event
    await publishEvent({
      eventType: 'TICKET_COMMENT_ADDED',
      payload: {
        tenantId: tenant,
        ticketId: ticketId,
        userId: user.user_id,
        comment: {
          id: newComment.comment_id,
          content: content,
          author: `${user.first_name} ${user.last_name}`,
          isInternal
        }
      }
    });
    
    // Track comment analytics
    analytics.capture('ticket_comment_added', {
      is_internal: isInternal,
      is_resolution: isResolution,
      content_length: markdownContent.length,
      has_formatting: content.includes('"type"'), // BlockNote content has type field
    }, user.user_id);

    // Revalidate paths to update UI
    revalidatePath(`/msp/tickets/${ticketId}`);

    return newComment;
    } catch (error) {
      console.error('Failed to add ticket comment:', error);
      throw new Error('Failed to add ticket comment');
    }
  });
}

/**
 * Get consolidated data for the ticket list page including filter options and tickets
 * This reduces multiple network calls by fetching all related data in a single server action
 */
export async function getConsolidatedTicketListData(
  user: IUser,
  filters: ITicketListFilters,
  page: number = 1,
  pageSize: number = 10
) {
  const {knex: db, tenant} = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  return withTransaction(db, async (trx) => {
    if (!await hasPermission(user, 'ticket', 'read', trx)) {
      throw new Error('Permission denied: Cannot view tickets');
    }

    try {
      // Fetch filter options and tickets in parallel
      const [formOptions, ticketsData] = await Promise.all([
        getTicketFormOptions(user),
        getTicketsForList(user, filters, page, pageSize)
      ]);

      // Return consolidated data
      return {
        options: formOptions,
        tickets: ticketsData.tickets,
        totalCount: ticketsData.totalCount
      };
    } catch (error) {
      console.error('Failed to fetch consolidated ticket list data:', error);
      throw new Error('Failed to fetch ticket list data');
    }
  });
}

/**
 * Fetch tickets with pagination
 * This is used when changing pages or page size
 */
export async function fetchTicketsWithPagination(
  user: IUser,
  filters: ITicketListFilters,
  page: number = 1,
  pageSize: number = 10
) {
  const {knex: db, tenant} = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  return withTransaction(db, async (trx) => {
    if (!await hasPermission(user, 'ticket', 'read', trx)) {
      throw new Error('Permission denied: Cannot view tickets');
    }

    try {
      return await getTicketsForList(user, filters, page, pageSize);
    } catch (error) {
      console.error('Failed to fetch tickets:', error);
      throw new Error('Failed to fetch tickets');
    }
  });
}

/**
 * Legacy wrapper for cursor-based pagination - kept for backward compatibility
 * @deprecated Use getTicketsForList with page-based pagination instead
 */
export async function getTicketsForListWithCursor(
  user: IUser,
  filters: ITicketListFilters,
  cursor?: string,
  limit: number = 50
): Promise<{ tickets: ITicketListItem[], nextCursor: string | null }> {
  // For backward compatibility, we'll use page 1 with the specified limit
  // This doesn't support cursor pagination anymore, but prevents breaking existing code
  const result = await getTicketsForList(user, filters, 1, limit);

  return {
    tickets: result.tickets,
    nextCursor: null // No more cursor-based pagination
  };
}
