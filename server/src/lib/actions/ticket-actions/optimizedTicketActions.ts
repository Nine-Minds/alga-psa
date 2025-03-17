'use server'

import { ITicket, ITicketListItem, ITicketListFilters, IAgentSchedule } from 'server/src/interfaces/ticket.interfaces';
import { IUser } from 'server/src/interfaces/auth.interfaces';
import { IComment } from 'server/src/interfaces/comment.interface';
import { ICompany } from 'server/src/interfaces/company.interfaces';
import { IContact } from 'server/src/interfaces/contact.interfaces';
import { IChannel } from 'server/src/interfaces/channel.interface';
import { ITicketCategory } from 'server/src/interfaces/ticket.interfaces';
import { ITicketResource } from 'server/src/interfaces/ticketResource.interfaces';
import { IDocument } from 'server/src/interfaces/document.interface';
import { createTenantKnex } from 'server/src/lib/db';
import { revalidatePath } from 'next/cache';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { z } from 'zod';
import { validateData } from 'server/src/lib/utils/validation';
import { getEventBus } from '../../../lib/eventBus';
import { 
  ticketFormSchema, 
  ticketSchema, 
  ticketUpdateSchema, 
  ticketAttributesQuerySchema,
  ticketListItemSchema,
  ticketListFiltersSchema
} from 'server/src/lib/schemas/ticket.schema';

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
    await getEventBus().publish({
      eventType,
      payload
    });
  } catch (error) {
    console.error(`Failed to publish ${eventType} event:`, error);
  }
}

/**
 * Consolidated function to get all ticket data for the ticket details page
 * This reduces multiple network calls by fetching all related data in a single server action
 */
export async function getConsolidatedTicketData(ticketId: string, user: IUser) {
  if (!await hasPermission(user, 'ticket', 'read')) {
    throw new Error('Permission denied: Cannot view ticket');
  }

  try {
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // Fetch ticket with status info
    const ticket = await db('tickets as t')
      .select(
        't.*',
        's.name as status_name',
        's.is_closed'
      )
      .leftJoin('statuses as s', function() {
        this.on('t.status_id', 's.status_id')
           .andOn('t.tenant', 's.tenant')
      })
      .where({
        't.ticket_id': ticketId,
        't.tenant': tenant
      })
      .first();

    if (!ticket) {
      throw new Error('Ticket not found');
    }

    // Fetch all related data in parallel
    const [
      comments,
      documents,
      companies,
      resources,
      users,
      statuses,
      channels,
      priorities,
      categories
    ] = await Promise.all([
      // Comments
      db('comments')
        .where({
          ticket_id: ticketId,
          tenant: tenant
        })
        .orderBy('created_at', 'asc'),
      
      // Documents
      db('documents as d')
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
      
      // Companies
      db('companies')
        .where({ tenant })
        .orderBy('company_name', 'asc'),
      
      // Ticket resources (additional agents)
      db('ticket_resources')
        .where({
          ticket_id: ticketId,
          tenant: tenant
        }),
      
      // Users
      db('users')
        .where({ tenant })
        .orderBy('first_name', 'asc'),
      
      // Statuses
      db('statuses')
        .where({
          tenant: tenant,
          status_type: 'ticket'
        })
        .orderBy('name', 'asc'),
      
      // Channels
      db('channels')
        .where({ tenant })
        .orderBy('channel_name', 'asc'),
      
      // Priorities
      db('priorities')
        .where({ tenant })
        .orderBy('priority_name', 'asc'),
      
      // Categories
      db('categories')
        .where({ tenant })
        .orderBy('category_name', 'asc')
    ]);

    // Fetch company and contact data if available
    let company = null;
    let contacts: IContact[] = [];
    let contactInfo = null;
    
    if (ticket.company_id) {
      [company, contacts] = await Promise.all([
        db('companies')
          .where({
            company_id: ticket.company_id,
            tenant: tenant
          })
          .first(),
        
        db('contacts')
          .where({
            company_id: ticket.company_id,
            tenant: tenant
          })
          .orderBy('full_name', 'asc')
      ]);
    }
    
    if (ticket.contact_name_id) {
      contactInfo = await db('contacts')
        .where({
          contact_name_id: ticket.contact_name_id,
          tenant: tenant
        })
        .first();
    }

    // Fetch created by user
    const createdByUser = ticket.entered_by ? 
      await db('users')
        .where({
          user_id: ticket.entered_by,
          tenant: tenant
        })
        .first() : null;

    // Fetch channel
    const channel = ticket.channel_id ?
      await db('channels')
        .where({
          channel_id: ticket.channel_id,
          tenant: tenant
        })
        .first() : null;

    // Process user data for userMap
    const userMap = users.reduce((acc, user) => {
      acc[user.user_id] = {
        user_id: user.user_id,
        first_name: user.first_name || '',
        last_name: user.last_name || '',
        email: user.email,
        user_type: user.user_type
      };
      return acc;
    }, {} as Record<string, { user_id: string; first_name: string; last_name: string; email?: string, user_type: string }>);

    // Format options for dropdowns
    const statusOptions = statuses.map((status) => ({
      value: status.status_id,
      label: status.name || ""
    }));

    const agentOptions = users.map((agent) => ({
      value: agent.user_id,
      label: `${agent.first_name} ${agent.last_name}`
    }));

    const channelOptions = channels
      .filter(channel => channel.channel_id !== undefined)
      .map((channel) => ({
        value: channel.channel_id,
        label: channel.channel_name || ""
      }));

    const priorityOptions = priorities.map((priority) => ({
      value: priority.priority_id,
      label: priority.priority_name
    }));

    // Get scheduled hours for ticket
    const scheduleEntries = await db('schedule_entries as se')
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

    // Return all data in a single consolidated object
    return {
      ticket: {
        ...convertDates(ticket),
        tenant
      },
      comments,
      documents,
      company,
      contacts,
      contactInfo,
      createdByUser,
      channel,
      additionalAgents: resources,
      availableAgents: users,
      userMap,
      options: {
        status: statusOptions,
        agent: agentOptions,
        channel: channelOptions,
        priority: priorityOptions
      },
      categories,
      companies,
      agentSchedules: agentSchedulesList
    };
  } catch (error) {
    console.error('Failed to fetch consolidated ticket data:', error);
    throw new Error('Failed to fetch ticket data');
  }
}

/**
 * Get tickets for list with cursor-based pagination
 * This is more efficient than offset-based pagination for large datasets
 */
export async function getTicketsForListWithCursor(
  user: IUser, 
  filters: ITicketListFilters,
  cursor?: string,
  limit: number = 50
): Promise<{ tickets: ITicketListItem[], nextCursor: string | null }> {
  if (!await hasPermission(user, 'ticket', 'read')) {
    throw new Error('Permission denied: Cannot view tickets');
  }

  try {
    const validatedFilters = validateData(ticketListFiltersSchema, filters) as ITicketListFilters;
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    let query = db('tickets as t')
      .select(
        't.*',
        's.name as status_name',
        'p.priority_name',
        'c.channel_name',
        'cat.category_name',
        db.raw("CONCAT(u.first_name, ' ', u.last_name) as entered_by_name"),
        db.raw("CONCAT(au.first_name, ' ', au.last_name) as assigned_to_name")
      )
      .leftJoin('statuses as s', function() {
        this.on('t.status_id', 's.status_id')
           .andOn('t.tenant', 's.tenant')
      })
      .leftJoin('priorities as p', function() {
        this.on('t.priority_id', 'p.priority_id')
           .andOn('t.tenant', 'p.tenant')
      })
      .leftJoin('channels as c', function() {
        this.on('t.channel_id', 'c.channel_id')
           .andOn('t.tenant', 'c.tenant')
      })
      .leftJoin('categories as cat', function() {
        this.on('t.category_id', 'cat.category_id')
           .andOn('t.tenant', 'cat.tenant')
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

    // Apply cursor-based pagination
    if (cursor) {
      const [timestamp, id] = cursor.split('_');
      query = query.where(function() {
        this.where('t.entered_at', '<', timestamp)
            .orWhere(function() {
              this.where('t.entered_at', '=', timestamp)
                  .andWhere('t.ticket_id', '<', id);
            });
      });
    }

    // Apply filters
    if (validatedFilters.channelId) {
      query = query.where('t.channel_id', validatedFilters.channelId);
    } else if (validatedFilters.channelFilterState !== 'all') {
      const channelSubquery = db('channels')
        .select('channel_id')
        .where('tenant', tenant)
        .where('is_inactive', validatedFilters.channelFilterState === 'inactive');

      query = query.whereIn('t.channel_id', channelSubquery);
    }

    if (validatedFilters.showOpenOnly) {
      query = query.whereExists(function() {
        this.select('*')
            .from('statuses')
            .whereRaw('statuses.status_id = t.status_id')
            .andWhere('statuses.is_closed', false)
            .andWhere('statuses.tenant', tenant);
      });
    } else if (validatedFilters.statusId && validatedFilters.statusId !== 'all') {
      query = query.where('t.status_id', validatedFilters.statusId);
    }

    if (validatedFilters.priorityId && validatedFilters.priorityId !== 'all') {
      query = query.where('t.priority_id', validatedFilters.priorityId);
    }

    if (validatedFilters.categoryId && validatedFilters.categoryId !== 'all') {
      query = query.where('t.category_id', validatedFilters.categoryId);
    }

    if (validatedFilters.companyId) {
      query = query.where('t.company_id', validatedFilters.companyId);
    }

    if (validatedFilters.searchQuery) {
      const searchTerm = `%${validatedFilters.searchQuery}%`;
      query = query.where(function(this: any) {
        this.where('t.title', 'ilike', searchTerm)
            .orWhere('t.ticket_number', 'ilike', searchTerm);
      });
    }

    // Order by entered_at desc and ticket_id desc for cursor pagination
    query = query.orderBy('t.entered_at', 'desc')
                 .orderBy('t.ticket_id', 'desc')
                 .limit(limit + 1); // Get one extra to determine if there's a next page

    const tickets = await query;

    // Check if we have more results
    const hasNextPage = tickets.length > limit;
    const results = hasNextPage ? tickets.slice(0, limit) : tickets;
    
    // Create the next cursor if we have more results
    let nextCursor = null;
    if (hasNextPage && results.length > 0) {
      const lastTicket = results[results.length - 1];
      nextCursor = `${lastTicket.entered_at}_${lastTicket.ticket_id}`;
    }

    // Transform and validate the data
    const ticketListItems = results.map((ticket: any): ITicketListItem => {
      const {
        status_id,
        priority_id,
        channel_id,
        category_id,
        entered_by,
        status_name,
        priority_name,
        channel_name,
        category_name,
        entered_by_name,
        assigned_to_name,
        ...rest
      } = ticket;

      return {
        status_id: status_id || null,
        priority_id: priority_id || null,
        channel_id: channel_id || null,
        category_id: category_id || null,
        entered_by: entered_by || null,
        status_name: status_name || 'Unknown',
        priority_name: priority_name || 'Unknown',
        channel_name: channel_name || 'Unknown',
        category_name: category_name || 'Unknown',
        entered_by_name: entered_by_name || 'Unknown',
        assigned_to_name: assigned_to_name || 'Unknown',
        ...convertDates(rest)
      };
    });

    return {
      tickets: validateData(z.array(ticketListItemSchema), ticketListItems),
      nextCursor
    };
  } catch (error) {
    console.error('Failed to fetch tickets:', error);
    throw new Error('Failed to fetch tickets');
  }
}

/**
 * Get all options needed for ticket forms and filters
 * This consolidates multiple API calls into a single request
 */
export async function getTicketFormOptions(user: IUser) {
  if (!await hasPermission(user, 'ticket', 'read')) {
    throw new Error('Permission denied: Cannot view ticket options');
  }

  try {
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // Fetch all options in parallel
    const [
      statuses,
      priorities,
      channels,
      categories,
      companies,
      users
    ] = await Promise.all([
      db('statuses')
        .where({
          tenant: tenant,
          status_type: 'ticket'  // Changed from item_type to status_type
        })
        .orderBy('name', 'asc'),
      
      db('priorities')
        .where({ tenant })
        .orderBy('priority_name', 'asc'),
      
      db('channels')
        .where({ tenant })
        .orderBy('channel_name', 'asc'),
      
      db('categories')
        .where({ tenant })
        .orderBy('category_name', 'asc'),
      
      db('companies')
        .where({ tenant })
        .orderBy('company_name', 'asc'),
      
      db('users')
        .where({ tenant })
        .orderBy('first_name', 'asc')
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
        label: priority.priority_name
      }))
    ];

    const channelOptions = channels
      .filter((channel: any) => channel.channel_id !== undefined)
      .map((channel: any) => ({
        value: channel.channel_id,
        label: channel.channel_name || ""
      }));

    const agentOptions = users.map((user: any) => ({
      value: user.user_id,
      label: `${user.first_name} ${user.last_name}`
    }));

    return {
      statusOptions,
      priorityOptions,
      channelOptions,
      agentOptions,
      categories,
      companies,
      users
    };
  } catch (error) {
    console.error('Failed to fetch ticket form options:', error);
    throw new Error('Failed to fetch ticket form options');
  }
}

/**
 * Update ticket with proper caching
 */
export async function updateTicketWithCache(id: string, data: Partial<ITicket>, user: IUser) {
  if (!await hasPermission(user, 'ticket', 'update')) {
    throw new Error('Permission denied: Cannot update ticket');
  }

  try {
    // Validate update data
    const validatedData = validateData(ticketUpdateSchema, data);

    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // Get current ticket state before update
    const currentTicket = await db('tickets')
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

    // Check if we're updating the assigned_to field
    const isChangingAssignment = 'assigned_to' in updateData &&
                                updateData.assigned_to !== currentTicket.assigned_to;

    // If updating category or subcategory, ensure they are compatible
    if ('subcategory_id' in updateData || 'category_id' in updateData) {
      const newSubcategoryId = updateData.subcategory_id;
      const newCategoryId = updateData.category_id || currentTicket?.category_id;

      if (newSubcategoryId) {
        // If setting a subcategory, verify it's a valid child of the category
        const subcategory = await db('categories')
          .where({ category_id: newSubcategoryId, tenant: tenant })
          .first();

        if (subcategory && subcategory.parent_category !== newCategoryId) {
          throw new Error('Invalid category combination: subcategory must belong to the selected parent category');
        }
      }
    }

    // Get the status before and after update to check for closure
    const oldStatus = await db('statuses')
      .where({
        status_id: currentTicket.status_id,
        tenant: tenant
      })
      .first();
    
    let updatedTicket;
    
    // If we're changing the assigned_to field, we need to handle the ticket_resources table
    if (isChangingAssignment) {
      updatedTicket = await db.transaction(async (trx) => {
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
        const resourcesToRecreate = [];
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
        
        return updated;
      });
    } else {
      // Regular update without changing assignment
      [updatedTicket] = await db('tickets')
        .where({ ticket_id: id, tenant: tenant })
        .update(updateData)
        .returning('*');
    }

    if (!updatedTicket) {
      throw new Error('Ticket not found or update failed');
    }

    // Get the new status if it was updated
    const newStatus = updateData.status_id ? 
      await db('statuses')
        .where({ 
          status_id: updateData.status_id,
          tenant: tenant
        })
        .first() :
      oldStatus;

    // Publish appropriate event based on the update
    if (newStatus?.is_closed && !oldStatus?.is_closed) {
      // Ticket was closed
      await safePublishEvent('TICKET_CLOSED', {
        tenantId: tenant,
        ticketId: id,
        userId: user.user_id,
        changes: updateData
      });
    } else if (updateData.assigned_to && updateData.assigned_to !== currentTicket.assigned_to) {
      // Ticket was assigned
      await safePublishEvent('TICKET_ASSIGNED', {
        tenantId: tenant,
        ticketId: id,
        userId: user.user_id,
        changes: updateData
      });
    } else {
      // Regular update
      await safePublishEvent('TICKET_UPDATED', {
        tenantId: tenant,
        ticketId: id,
        userId: user.user_id,
        changes: updateData
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
}

/**
 * Add comment to ticket with proper caching
 */
export async function addTicketCommentWithCache(
  ticketId: string, 
  content: string, 
  isInternal: boolean, 
  isResolution: boolean,
  isInitialDescription: boolean,
  user: IUser
): Promise<IComment> {
  if (!await hasPermission(user, 'ticket', 'update')) {
    throw new Error('Permission denied: Cannot add comment');
  }

  try {
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // Verify ticket exists
    const ticket = await db('tickets')
      .where({
        ticket_id: ticketId,
        tenant: tenant
      })
      .first();

    if (!ticket) {
      throw new Error('Ticket not found');
    }

    // Insert comment
    const [newComment] = await db('comments').insert({
      tenant,
      ticket_id: ticketId,
      user_id: user.user_id,
      author_type: 'internal',
      note: content,
      is_internal: isInternal,
      is_resolution: isResolution,
      is_initial_description: isInitialDescription,
      created_at: new Date().toISOString()
    }).returning('*');

    // Publish comment added event
    await safePublishEvent('TICKET_COMMENT_ADDED', {
      tenantId: tenant,
      ticketId: ticketId,
      userId: user.user_id,
      comment: {
        id: newComment.comment_id,
        content: content,
        author: `${user.first_name} ${user.last_name}`,
        isInternal
      }
    });

    // Revalidate paths to update UI
    revalidatePath(`/msp/tickets/${ticketId}`);

    return newComment;
  } catch (error) {
    console.error('Failed to add ticket comment:', error);
    throw new Error('Failed to add ticket comment');
  }
}

/**
 * Get consolidated data for the ticket list page including filter options and tickets
 * This reduces multiple network calls by fetching all related data in a single server action
 */
export async function getConsolidatedTicketListData(
  user: IUser,
  filters: ITicketListFilters,
  cursor?: string,
  limit: number = 50
) {
  if (!await hasPermission(user, 'ticket', 'read')) {
    throw new Error('Permission denied: Cannot view tickets');
  }

  try {
    // Fetch filter options and tickets in parallel
    const [formOptions, ticketsData] = await Promise.all([
      getTicketFormOptions(user),
      getTicketsForListWithCursor(user, filters, cursor, limit)
    ]);

    // Return consolidated data
    return {
      options: formOptions,
      tickets: ticketsData.tickets,
      nextCursor: ticketsData.nextCursor
    };
  } catch (error) {
    console.error('Failed to fetch consolidated ticket list data:', error);
    throw new Error('Failed to fetch ticket list data');
  }
}

/**
 * Load more tickets using cursor-based pagination
 * This is used for the "Load More" button in the ticket list
 */
export async function loadMoreTickets(
  user: IUser,
  filters: ITicketListFilters,
  cursor: string,
  limit: number = 50
) {
  if (!await hasPermission(user, 'ticket', 'read')) {
    throw new Error('Permission denied: Cannot view tickets');
  }

  try {
    return await getTicketsForListWithCursor(user, filters, cursor, limit);
  } catch (error) {
    console.error('Failed to load more tickets:', error);
    throw new Error('Failed to load more tickets');
  }
}