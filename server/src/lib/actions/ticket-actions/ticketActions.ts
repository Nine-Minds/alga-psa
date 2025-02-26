'use server'

import { ITicket, ITicketListItem, ITicketListFilters } from '@/interfaces/ticket.interfaces';
import { IUser } from '@/interfaces/auth.interfaces';
import Ticket from '@/lib/models/ticket';
import { revalidatePath } from 'next/cache';
import { getTicketAttributes } from '@/lib/actions/policyActions';
import { hasPermission } from '@/lib/auth/rbac';
import { createTenantKnex } from '@/lib/db';
import { 
  ticketFormSchema, 
  ticketSchema, 
  ticketUpdateSchema, 
  ticketAttributesQuerySchema,
  ticketListItemSchema,
  ticketListFiltersSchema,
  createTicketFromAssetSchema
} from '@/lib/schemas/ticket.schema';
import { z } from 'zod';
import { validateData } from '@/lib/utils/validation';
import { AssetAssociationModel } from '@/models/asset';
import { getEventBus } from '../../../lib/eventBus';
import { 
  TicketCreatedEvent,
  TicketUpdatedEvent,
  TicketClosedEvent
} from '../../../lib/eventBus/events';
import { NumberingService } from '@/lib/services/numberingService';

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

interface CreateTicketFromAssetData {
    title: string;
    description: string;
    priority_id: string;
    asset_id: string;
    company_id: string;
}

export async function createTicketFromAsset(data: CreateTicketFromAssetData, user: IUser): Promise<ITicket> {
    if (!await hasPermission(user, 'ticket', 'create')) {
        throw new Error('Permission denied: Cannot create ticket');
    }

    try {
        const {knex: db, tenant} = await createTenantKnex();
        if (!tenant) {
            throw new Error('Tenant not found');
        }

        // Validate the input data
        const validatedData = validateData(createTicketFromAssetSchema, data);

        const numberingService = new NumberingService();
        const result = await db.transaction(async (trx) => {
            const ticketNumber = await numberingService.getNextTicketNumber();
            
            // Create the ticket
          const ticketData: Partial<ITicket> = {
            ticket_number: ticketNumber,
            title: validatedData.title,
            company_id: validatedData.company_id,
            status_id: await getDefaultStatusId(trx, tenant),
            entered_by: user.user_id,
            priority_id: validatedData.priority_id,
            entered_at: new Date().toISOString(),
            attributes: {
              description: validatedData.description
            },
            estimated_hours: null,
            tenant: tenant
          };

            // Validate complete ticket data
            const validatedTicket = validateData(ticketSchema.partial(), ticketData);

            // Insert the ticket
            const [newTicket] = await trx('tickets')
                .insert(validatedTicket)
                .returning('*');

            if (!newTicket.ticket_id) {
                throw new Error('Failed to create ticket');
            }

            // Create initial description comment
            if (validatedData.description) {
                await trx('comments').insert({
                    tenant,
                    ticket_id: newTicket.ticket_id,
                    user_id: user.user_id,
                    author_type: 'internal',
                    note: validatedData.description,
                    is_internal: false,
                    is_resolution: false,
                    is_initial_description: true
                });
            }

            // Create the asset association
            await AssetAssociationModel.create({
                asset_id: validatedData.asset_id,
                entity_id: newTicket.ticket_id,
                entity_type: 'ticket',
                relationship_type: 'affected'
            }, user.user_id);

            // Publish ticket created event
            await safePublishEvent('TICKET_CREATED', {
                tenantId: tenant,
                ticketId: newTicket.ticket_id,
                userId: user.user_id,
            });

            return convertDates(newTicket);
        });

        // Revalidate relevant paths
        revalidatePath('/msp/tickets');
        revalidatePath('/msp/assets');

        return result;
    } catch (error) {
        console.error('Error creating ticket from asset:', error);
        throw new Error('Failed to create ticket from asset');
    }
}

// Helper function to get default status ID
async function getDefaultStatusId(trx: any, tenant: string): Promise<string> {
    const defaultStatus = await trx('statuses')
        .where({ 
            tenant,
            is_default: true,
            item_type: 'ticket'
        })
        .first();

    if (!defaultStatus) {
        throw new Error('No default status found for tickets');
    }

    return defaultStatus.status_id;
}

export async function addTicket(data: FormData, user: IUser): Promise<ITicket|undefined> {
  if (!await hasPermission(user, 'ticket', 'create')) {
    throw new Error('Permission denied: Cannot create ticket');
  }

  try {
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const numberingService = new NumberingService();
    const MAX_RETRIES = 3;
    let retries = 0;

    while (retries < MAX_RETRIES) {
      try {
        return await db.transaction(async (trx) => {
          // Get form data and convert empty strings to null for nullable fields
          const contact_name_id = data.get('contact_name_id');
          const category_id = data.get('category_id');
          const subcategory_id = data.get('subcategory_id');
          const description = data.get('description');

          const formData = {
            title: data.get('title'),
            channel_id: data.get('channel_id'),
            company_id: data.get('company_id'),
            contact_name_id: contact_name_id === '' ? null : contact_name_id,
            status_id: data.get('status_id'),
            assigned_to: data.get('assigned_to'),
            priority_id: data.get('priority_id'),
            description: description,
            category_id: category_id === '' ? null : category_id,
            subcategory_id: subcategory_id === '' ? null : subcategory_id,
          };

          const validatedData = validateData(ticketFormSchema, formData);

          const ticketNumber = await numberingService.getNextTicketNumber();
            
          const ticketData: Partial<ITicket> = {
            ticket_number: ticketNumber,
            title: validatedData.title,
            channel_id: validatedData.channel_id,
            company_id: validatedData.company_id,
            contact_name_id: validatedData.contact_name_id,
            status_id: validatedData.status_id,
            entered_by: user.user_id,
            assigned_to: validatedData.assigned_to,
            priority_id: validatedData.priority_id,
            category_id: validatedData.category_id,
            subcategory_id: validatedData.subcategory_id,
            entered_at: new Date().toISOString(),
            attributes: {
              description: validatedData.description
            },
            estimated_hours: null,
            tenant: tenant
          };

      // Validate complete ticket data
      const validatedTicket = validateData(ticketSchema.partial(), ticketData);

      // Insert the ticket
      const [newTicket] = await trx('tickets').insert(validatedTicket).returning('*');

      if (!newTicket.ticket_id) {
        throw new Error('Failed to create a new ticket');
      }

      // Create the initial description comment
      if (validatedData.description) {
        await trx('comments').insert({
          tenant,
          ticket_id: newTicket.ticket_id,
          user_id: user.user_id,
          author_type: 'internal',
          note: validatedData.description,
          is_internal: false,
          is_resolution: false,
          is_initial_description: true
        });
      }

      // Publish ticket created event
      await safePublishEvent('TICKET_CREATED', {
        tenantId: tenant,
        ticketId: newTicket.ticket_id,
        userId: user.user_id,
      });

      // If ticket has assigned_to, publish assigned event
      if (newTicket.assigned_to) {
        await safePublishEvent('TICKET_ASSIGNED', {
          tenantId: tenant,
          ticketId: newTicket.ticket_id,
          userId: user.user_id,
        });
      }

          return convertDates(newTicket);
        });
      } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && err.code === '40P01') { // Deadlock detected
          retries++;
          continue;
        }
        throw err;
      }
    }
    throw new Error('Failed to create ticket after 3 retries');
  } catch (error) {
    console.error(error);
    throw error;
  }
}

export async function fetchTicketAttributes(ticketId: string, user: IUser) {
  if (!await hasPermission(user, 'ticket', 'read')) {
    throw new Error('Permission denied: Cannot view ticket attributes');
  }

  try {
    // Validate ticket ID
    const { ticketId: validatedTicketId } = validateData(
      ticketAttributesQuerySchema,
      { ticketId }
    );

    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const attributes = await getTicketAttributes(validatedTicketId);

    const ticketExists = await db('tickets')
      .where({
        ticket_id: validatedTicketId,
        tenant: tenant
      })
      .first();

    if (!ticketExists) {
      throw new Error('Ticket not found or does not belong to the current tenant');
    }

    return { success: true, attributes };
  } catch (error) {
    console.error(error);
    return { success: false, error: 'Failed to fetch ticket attributes' };
  }
}

export async function updateTicket(id: string, data: Partial<ITicket>, user: IUser) {
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
    
    const [updatedTicket] = await db('tickets')
      .where({ ticket_id: id, tenant: tenant })
      .update(updateData)
      .returning('*');

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

    return 'success';
  } catch (error) {
    console.error(error);
    throw new Error('Failed to update ticket');
  }
}

export async function getTickets(user: IUser): Promise<ITicket[]> {
  if (!await hasPermission(user, 'ticket', 'read')) {
    throw new Error('Permission denied: Cannot view tickets');
  }

  try {
    const tickets = await Ticket.getAll();
    // Convert dates and validate
    const processedTickets = tickets.map((ticket: ITicket): ITicket => convertDates(ticket));
    return validateData(z.array(ticketSchema), processedTickets);
  } catch (error) {
    console.error('Failed to fetch tickets:', error);
    throw new Error('Failed to fetch tickets');
  }
}

export async function getTicketsForList(user: IUser, filters: ITicketListFilters): Promise<ITicketListItem[]> {
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

    const tickets = await query.orderBy('t.entered_at', 'desc');

    // Transform and validate the data
    const ticketListItems = tickets.map((ticket: any): ITicketListItem => {
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

    return validateData(z.array(ticketListItemSchema), ticketListItems);
  } catch (error) {
    console.error('Failed to fetch tickets:', error);
    throw new Error('Failed to fetch tickets');
  }
}

export async function addTicketComment(ticketId: string, comment: string, isInternal: boolean, user: IUser): Promise<void> {
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
      note: comment,
      is_internal: isInternal,
      is_resolution: false,
      is_initial_description: false
    }).returning('*');

    // Publish comment added event
    await safePublishEvent('TICKET_COMMENT_ADDED', {
      tenantId: tenant,
      ticketId: ticketId,
      userId: user.user_id,
      comment: {
        id: newComment.id,
        content: comment,
        author: `${user.first_name} ${user.last_name}`,
        isInternal
      }
    });

  } catch (error) {
    console.error('Failed to add ticket comment:', error);
    throw new Error('Failed to add ticket comment');
  }
}

export async function deleteTicket(ticketId: string, user: IUser): Promise<void> {
  if (!await hasPermission(user, 'ticket', 'delete')) {
    throw new Error('Permission denied: Cannot delete ticket');
  }

  try {
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // Verify ticket exists and belongs to tenant
    const ticket = await db('tickets')
      .where({
        ticket_id: ticketId,
        tenant: tenant
      })
      .first();

    if (!ticket) {
      throw new Error('Ticket not found');
    }

    // Start transaction for atomic operations
    await db.transaction(async (trx) => {
      // Delete associated comments
      await trx('comments')
        .where({ 
          ticket_id: ticketId,
          tenant: tenant
        })
        .delete();

      // Delete the ticket
      await trx('tickets')
        .where({ 
          ticket_id: ticketId,
          tenant: tenant
        })
        .delete();

      // Publish ticket deleted event
      await safePublishEvent('TICKET_DELETED', {
        tenantId: tenant,
        ticketId: ticketId,
        userId: user.user_id
      });
    });

    // Revalidate relevant paths
    revalidatePath('/msp/tickets');
  } catch (error) {
    console.error('Failed to delete ticket:', error);
    throw new Error('Failed to delete ticket');
  }
}

export async function getTicketById(id: string, user: IUser): Promise<ITicket & { tenant: string; status_name: string; is_closed: boolean }> {
  if (!await hasPermission(user, 'ticket', 'read')) {
    throw new Error('Permission denied: Cannot view ticket');
  }

  try {
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

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
        't.ticket_id': id,
        't.tenant': tenant
      })
      .first();

    if (!ticket) {
      throw new Error('Ticket not found');
    }

    // Add tenant and status info to the ticket
    const ticketWithTenant = {
      ...ticket,
      tenant: tenant,
      status_name: ticket.status_name || 'Unknown',
      is_closed: ticket.is_closed || false
    };

    return convertDates(ticketWithTenant);
  } catch (error) {
    console.error('Failed to fetch ticket:', error);
    throw new Error('Failed to fetch ticket');
  }
}
