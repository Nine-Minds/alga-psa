'use server'

import { ITicket, ITicketListItem, ITicketListFilters, IAgentSchedule } from 'server/src/interfaces/ticket.interfaces';
import { IUser } from 'server/src/interfaces/auth.interfaces';
import { ITicketResource } from 'server/src/interfaces/ticketResource.interfaces';
import Ticket from 'server/src/lib/models/ticket';
import { revalidatePath } from 'next/cache';
import { getTicketAttributes } from 'server/src/lib/actions/policyActions';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { createTenantKnex } from 'server/src/lib/db';
import { withTransaction } from '@alga-psa/shared/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { Knex } from 'knex';
import { deleteEntityTags, deleteEntitiesTags } from '../../utils/tagCleanup';
import { 
  ticketSchema, 
  ticketUpdateSchema, 
  ticketAttributesQuerySchema,
  ticketListItemSchema,
  ticketListFiltersSchema
} from 'server/src/lib/schemas/ticket.schema';
import { z } from 'zod';
import { validateData } from 'server/src/lib/utils/validation';
import { AssetAssociationModel } from 'server/src/models/asset';
import { getEventBus } from '../../../lib/eventBus';
import { 
  TicketCreatedEvent,
  TicketUpdatedEvent,
  TicketClosedEvent
} from '../../../lib/eventBus/events';
import { analytics } from '../../analytics/posthog';
import { AnalyticsEvents } from '../../analytics/events';
import { TicketModel, CreateTicketInput } from '@alga-psa/shared/models/ticketModel';
import { ServerEventPublisher } from '../../adapters/serverEventPublisher';
import { ServerAnalyticsTracker } from '../../adapters/serverAnalyticsTracker';

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
    try {
        const {knex: db, tenant} = await createTenantKnex();
        if (!tenant) {
            throw new Error('Tenant not found');
        }

        const result = await db.transaction(async (trx) => {
            // Server-specific: Check permissions
            if (!await hasPermission(user, 'ticket', 'create', trx)) {
                throw new Error('Permission denied: Cannot create ticket');
            }

            // Server-specific: Create adapters for dependency injection
            const eventPublisher = new ServerEventPublisher();
            const analyticsTracker = new ServerAnalyticsTracker();

            // Use shared TicketModel for asset ticket creation
            const ticketResult = await TicketModel.createTicketFromAsset(
                data,
                user.user_id,
                tenant,
                trx,
                eventPublisher,
                analyticsTracker
            );

            // Server-specific: Create the asset association
            await AssetAssociationModel.create(trx, {
                asset_id: data.asset_id,
                entity_id: ticketResult.ticket_id,
                entity_type: 'ticket',
                relationship_type: 'affected'
            }, user.user_id);

            // Server-specific: Get full ticket data for return
            const fullTicket = await trx('tickets')
                .where({ ticket_id: ticketResult.ticket_id, tenant: tenant })
                .first();

            if (!fullTicket) {
                throw new Error('Failed to retrieve created ticket');
            }

            return convertDates(fullTicket);
        });

        // Server-specific: Revalidate cache paths
        revalidatePath('/msp/tickets');
        revalidatePath('/msp/assets');

        return result;
    } catch (error) {
        console.error('Error creating ticket from asset:', error);
        throw new Error('Failed to create ticket from asset');
    }
}


export async function addTicket(data: FormData, user: IUser): Promise<ITicket|undefined> {
  try {
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    return await db.transaction(async (trx) => {
      // Server-specific: Check permissions
      if (!await hasPermission(user, 'ticket', 'create', trx)) {
        throw new Error('Permission denied: Cannot create ticket');
      }

      // Server-specific: Parse FormData
      const contact_name_id = data.get('contact_name_id');
      const category_id = data.get('category_id');
      const subcategory_id = data.get('subcategory_id');
      const description = data.get('description');
      const location_id = data.get('location_id');

      // Convert FormData to CreateTicketInput format
      const createTicketInput: CreateTicketInput = {
        title: data.get('title') as string,
        channel_id: data.get('channel_id') as string,
        company_id: data.get('company_id') as string,
        location_id: location_id === '' ? undefined : (location_id as string),
        contact_id: contact_name_id === '' ? undefined : (contact_name_id as string), // Note: maps to contact_name_id
        status_id: data.get('status_id') as string,
        assigned_to: data.get('assigned_to') as string,
        priority_id: data.get('priority_id') as string,
        description: description as string,
        category_id: category_id === '' ? undefined : (category_id as string),
        subcategory_id: subcategory_id === '' ? undefined : (subcategory_id as string),
        entered_by: user.user_id,
        source: 'web_app'
      };

      // Server-specific: Create adapters for dependency injection
      const eventPublisher = new ServerEventPublisher();
      const analyticsTracker = new ServerAnalyticsTracker();

      // Use shared TicketModel with retry logic
      const ticketResult = await TicketModel.createTicketWithRetry(
        createTicketInput,
        tenant,
        trx,
        {}, // validation options
        eventPublisher,
        analyticsTracker,
        user.user_id,
        3 // max retries
      );

      // Server-specific: Handle assigned ticket event
      if (createTicketInput.assigned_to) {
        await safePublishEvent('TICKET_ASSIGNED', {
          tenantId: tenant,
          ticketId: ticketResult.ticket_id,
          userId: user.user_id,
        });
      }

      // Server-specific: Get full ticket data for return
      const fullTicket = await trx('tickets')
        .where({ ticket_id: ticketResult.ticket_id, tenant: tenant })
        .first();

      if (!fullTicket) {
        throw new Error('Failed to retrieve created ticket');
      }

      // Server-specific: Revalidate cache paths
      revalidatePath('/msp/tickets');
      
      return convertDates(fullTicket);
    });
  } catch (error) {
    console.error('Error in addTicket:', error);
    throw error;
  }
}

export async function fetchTicketAttributes(ticketId: string, user: IUser) {
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

    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      if (!await hasPermission(user, 'ticket', 'read', trx)) {
        throw new Error('Permission denied: Cannot view ticket attributes');
      }

      const attributes = await getTicketAttributes(validatedTicketId);

      const ticketExists = await trx('tickets')
        .where({
          ticket_id: validatedTicketId,
          tenant: tenant
        })
        .first();

      if (!ticketExists) {
        throw new Error('Ticket not found or does not belong to the current tenant');
      }

      return { success: true, attributes };
    });

    return result;
  } catch (error) {
    console.error(error);
    return { success: false, error: 'Failed to fetch ticket attributes' };
  }
}

export async function updateTicket(id: string, data: Partial<ITicket>, user: IUser) {
  try {
    // Validate update data
    const validatedData = validateData(ticketUpdateSchema, data);

    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const result = await db.transaction(async (trx) => {
      if (!await hasPermission(user, 'ticket', 'update', trx)) {
        throw new Error('Permission denied: Cannot update ticket');
      }

      // Get current ticket state before update
      const currentTicket = await trx('tickets')
        .where({ ticket_id: id, tenant: tenant })
        .first();

      if (!currentTicket) {
        throw new Error('Ticket not found');
      }

      // Clean up the data before update
      const updateData = { ...validatedData };

      // Handle null values for category, subcategory, and location
      if ('category_id' in updateData && !updateData.category_id) {
        updateData.category_id = null;
      }
      if ('subcategory_id' in updateData && !updateData.subcategory_id) {
        updateData.subcategory_id = null;
      }
      if ('location_id' in updateData && !updateData.location_id) {
        updateData.location_id = null;
      }
      
      // Validate location belongs to the company if provided
      if ('location_id' in updateData && updateData.location_id) {
        const companyId = 'company_id' in updateData ? updateData.company_id : currentTicket.company_id;
        const location = await trx('company_locations')
          .where({
            location_id: updateData.location_id,
            company_id: companyId,
            tenant: tenant
          })
          .first();
        
        if (!location) {
          throw new Error('Invalid location: Location does not belong to the selected company');
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
        
        return updated;
      } else {
        // Regular update without changing assignment
        const [updated] = await trx('tickets')
          .where({ ticket_id: id, tenant: tenant })
          .update(updateData)
          .returning('*');
        
        updatedTicket = updated;
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

      // Publish appropriate event based on the update
      if (newStatus?.is_closed && !oldStatus?.is_closed) {
        // Ticket was closed
        await safePublishEvent('TICKET_CLOSED', {
          tenantId: tenant,
          ticketId: id,
          userId: user.user_id,
          changes: updateData
        });
        
        // Track ticket resolved analytics
        analytics.capture(AnalyticsEvents.TICKET_RESOLVED, {
          time_to_resolution: currentTicket.entered_at ? 
            Math.round((Date.now() - new Date(currentTicket.entered_at).getTime()) / 1000 / 60) : 0, // minutes
          priority_id: updatedTicket.priority_id,
          category_id: updatedTicket.category_id,
          had_assignment: !!updatedTicket.assigned_to,
        }, user.user_id);
      } else if (updateData.assigned_to && updateData.assigned_to !== currentTicket.assigned_to) {
        // Ticket was assigned
        await safePublishEvent('TICKET_ASSIGNED', {
          tenantId: tenant,
          ticketId: id,
          userId: user.user_id,
          changes: updateData
        });
        
        // Track ticket assignment analytics
        analytics.capture(AnalyticsEvents.TICKET_ASSIGNED, {
          was_reassignment: !!currentTicket.assigned_to,
          time_to_assignment: currentTicket.entered_at && !currentTicket.assigned_to ? 
            Math.round((Date.now() - new Date(currentTicket.entered_at).getTime()) / 1000 / 60) : 0, // minutes
        }, user.user_id);
      } else {
        // Regular update
        await safePublishEvent('TICKET_UPDATED', {
          tenantId: tenant,
          ticketId: id,
          userId: user.user_id,
          changes: updateData
        });
      }
      
      // Track general ticket update analytics
      analytics.capture(AnalyticsEvents.TICKET_UPDATED, {
        fields_updated: Object.keys(updateData),
        updated_priority: 'priority_id' in updateData,
        updated_status: 'status_id' in updateData,
        updated_category: 'category_id' in updateData || 'subcategory_id' in updateData,
        updated_assignment: 'assigned_to' in updateData,
      }, user.user_id);

      return updatedTicket;
    });

    return 'success';
  } catch (error) {
    console.error(error);
    throw new Error('Failed to update ticket');
  }
}

export async function getTickets(user: IUser): Promise<ITicket[]> {
  try {
    const {knex} = await createTenantKnex();
    
    const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
      if (!await hasPermission(user, 'ticket', 'read', trx)) {
        throw new Error('Permission denied: Cannot view tickets');
      }

      const tickets = await Ticket.getAll(trx);
      // Convert dates
      const processedTickets = tickets.map((ticket: ITicket): ITicket => {
        return convertDates(ticket);
      });
      return validateData(z.array(ticketSchema), processedTickets);
    });

    return result;
  } catch (error) {
    console.error('Failed to fetch tickets:', error);
    throw new Error('Failed to fetch tickets');
  }
}

export async function getTicketsForList(user: IUser, filters: ITicketListFilters): Promise<ITicketListItem[]> {
  try {
    const validatedFilters = validateData(ticketListFiltersSchema, filters) as ITicketListFilters;
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      if (!await hasPermission(user, 'ticket', 'read', trx)) {
        throw new Error('Permission denied: Cannot view tickets');
      }

      let query = trx('tickets as t')
      .select(
        't.*',
        's.name as status_name',
        'p.priority_name',
        'c.channel_name',
        'cat.category_name',
        'co.company_name as company_name',
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
      .leftJoin('companies as co', function() {
        this.on('t.company_id', 'co.company_id')
           .andOn('t.tenant', 'co.tenant')
      })
      .where({
        't.tenant': tenant
      });

    // Apply filters
    if (validatedFilters.channelId) {
      query = query.where('t.channel_id', validatedFilters.channelId);
    } else if (validatedFilters.channelFilterState !== 'all') {
      const channelSubquery = trx('channels')
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
          company_name,
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
          company_name: company_name || 'Unknown',
          entered_by_name: entered_by_name || 'Unknown',
          assigned_to_name: assigned_to_name || 'Unknown',
          ...convertDates(rest)
        };
      });

      return validateData(z.array(ticketListItemSchema), ticketListItems);
    });

    return result;
  } catch (error) {
    console.error('Failed to fetch tickets:', error);
    throw new Error('Failed to fetch tickets');
  }
}

export async function addTicketComment(ticketId: string, comment: string, isInternal: boolean, user: IUser): Promise<void> {
  try {
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    await withTransaction(db, async (trx: Knex.Transaction) => {
      if (!await hasPermission(user, 'ticket', 'update', trx)) {
        throw new Error('Permission denied: Cannot add comment');
      }

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

      // Insert comment
      const [newComment] = await trx('comments').insert({
      tenant,
      ticket_id: ticketId,
      user_id: user.user_id,
      author_type: 'internal',
      note: comment,
      is_internal: isInternal,
      is_resolution: false
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
    });
  } catch (error) {
    console.error('Failed to add ticket comment:', error);
    throw new Error('Failed to add ticket comment');
  }
}

async function performTicketDeletion(ticketIds: string[], user: IUser): Promise<void> {
  const uniqueTicketIds = Array.from(
    new Set(
      ticketIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    )
  );

  if (uniqueTicketIds.length === 0) {
    throw new Error('No tickets provided for deletion');
  }

  const {knex: db, tenant} = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  await withTransaction(db, async (trx: Knex.Transaction) => {
    if (!await hasPermission(user, 'ticket', 'delete', trx)) {
      throw new Error('Permission denied: Cannot delete ticket');
    }

    const tickets = await trx('tickets')
      .where({ tenant })
      .whereIn('ticket_id', uniqueTicketIds);

    if (tickets.length !== uniqueTicketIds.length) {
      throw new Error('Ticket not found');
    }

    await trx('comments')
      .where({ tenant })
      .whereIn('ticket_id', uniqueTicketIds)
      .delete();

    if (uniqueTicketIds.length === 1) {
      await deleteEntityTags(trx, uniqueTicketIds[0], 'ticket');
    } else {
      await deleteEntitiesTags(trx, uniqueTicketIds, 'ticket');
    }

    await trx('tickets')
      .where({ tenant })
      .whereIn('ticket_id', uniqueTicketIds)
      .delete();

    for (const ticket of tickets) {
      await safePublishEvent('TICKET_DELETED', {
        tenantId: tenant,
        ticketId: ticket.ticket_id,
        userId: user.user_id
      });

      analytics.capture('ticket_deleted', {
        was_resolved: !!ticket.closed_at,
        had_comments: false,
        age_in_days: ticket.entered_at
          ? Math.round((Date.now() - new Date(ticket.entered_at).getTime()) / 1000 / 60 / 60 / 24)
          : 0,
      }, user.user_id);
    }
  });

  revalidatePath('/msp/tickets');
}

export async function deleteTicket(ticketId: string, user: IUser): Promise<void> {
  try {
    await performTicketDeletion([ticketId], user);
  } catch (error: any) {
    console.error('Failed to delete ticket:', error);

    if (error.message && error.message.includes('ticket_resources_tenant_ticket_id_assigned_to_foreign')) {
      throw new Error('VALIDATION_ERROR: This ticket cannot be deleted because it has associated resources or tasks. Please remove them first.');
    }
    throw new Error('Failed to delete ticket');
  }
}

export async function deleteTickets(ticketIds: string[], user: IUser): Promise<void> {
  try {
    await performTicketDeletion(ticketIds, user);
  } catch (error: any) {
    console.error('Failed to delete tickets:', error);

    if (error.message && error.message.includes('ticket_resources_tenant_ticket_id_assigned_to_foreign')) {
      throw new Error('VALIDATION_ERROR: One or more selected tickets cannot be deleted because they have associated resources or tasks. Please remove them first.');
    }
    throw new Error('Failed to delete tickets');
  }
}

export async function getScheduledHoursForTicket(ticketId: string): Promise<IAgentSchedule[]> {
  try {
    // Get the current user from the session
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }
    
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      if (!await hasPermission(currentUser, 'ticket', 'read', trx)) {
        throw new Error('Permission denied: Cannot view ticket schedule');
      }

      // Query schedule entries for the ticket
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

    console.log('Schedule entries for ticket', ticketId, ':', scheduleEntries);

    // Calculate scheduled hours per agent
    const agentSchedules: Record<string, number> = {};
    
    scheduleEntries.forEach((entry: any) => {
      const userId = entry.user_id;
      if (!userId) {
        console.log('Warning: Schedule entry has no user_id:', entry);
        return; // Skip entries with no user_id
      }
      
      const startTime = new Date(entry.scheduled_start);
      const endTime = new Date(entry.scheduled_end);
      const durationMs = endTime.getTime() - startTime.getTime();
      const durationMinutes = Math.ceil(durationMs / (1000 * 60)); // Convert ms to minutes
      
      console.log('Entry for user', userId, ':', startTime, 'to', endTime, '=', durationMinutes, 'minutes');
      
      if (!agentSchedules[userId]) {
        agentSchedules[userId] = 0;
      }
      
      agentSchedules[userId] += durationMinutes;
    });

    console.log('Agent schedules:', agentSchedules);

    // Convert to array format
    const result: IAgentSchedule[] = Object.entries(agentSchedules).map(([userId, minutes]) => ({
      userId,
      minutes
    }));

    console.log('Final result:', result);

    // If no schedules found, add some dummy data for testing
    if (result.length === 0) {
      // Get the ticket to find the assigned agent
      const ticketData = await trx('tickets')
        .where({
          ticket_id: ticketId,
          tenant
        })
        .first();
        
      if (ticketData && ticketData.assigned_to) {
        result.push({
          userId: ticketData.assigned_to,
          minutes: 180 // 3 hours
        });
      }
      
      // Add dummy data for additional agents
      const additionalAgents = await trx('ticket_resources')
        .where({
          ticket_id: ticketId,
          tenant
        })
        .select('additional_user_id');
        
      additionalAgents.forEach((agent: any) => {
        if (agent.additional_user_id) {
          result.push({
            userId: agent.additional_user_id,
            minutes: 180 // 3 hours
          });
        }
      });
      }

      return result;
    });

    return result;
  } catch (error) {
    console.error('Error fetching scheduled hours:', error);
    // Provide more detailed error information
    if (error instanceof Error) {
      throw new Error(`Failed to fetch scheduled hours: ${error.message}`);
    }
    throw new Error('Failed to fetch scheduled hours');
  }
}

export type DetailedTicket = ITicket & { 
  tenant: string; 
  status_name: string; 
  is_closed: boolean;
  channel_name?: string;
  assigned_to_first_name?: string;
  assigned_to_last_name?: string;
  assigned_to_name?: string;
  contact_name?: string;
  company_name?: string;

  additionalAgents?: ITicketResource[];
  availableAgents?: IUser[];
};

export async function getTicketById(id: string, user: IUser): Promise<DetailedTicket> {
  try {
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      if (!await hasPermission(user, 'ticket', 'read', trx)) {
        throw new Error('Permission denied: Cannot view ticket');
      }

    type TicketQueryResult = ITicket & {
      status_name: string;
      is_closed: boolean;
      channel_name?: string;
      assigned_to_first_name?: string;
      assigned_to_last_name?: string;
      contact_name?: string;
      company_name?: string;
    };

      const ticket: TicketQueryResult | undefined = await trx('tickets as t')
      .select(
        't.*',
        's.name as status_name',
        's.is_closed',
        'ch.channel_name as channel_name',
        'u_assignee.first_name as assigned_to_first_name',
        'u_assignee.last_name as assigned_to_last_name',
        'ct.full_name as contact_name',
        'co.company_name'
      )
      .leftJoin('statuses as s', function() {
        this.on('t.status_id', 's.status_id')
           .andOn('t.tenant', 's.tenant');
      })
      .leftJoin('channels as ch', function() {
        this.on('t.channel_id', 'ch.channel_id')
           .andOn('t.tenant', 'ch.tenant');
      })
      .leftJoin('users as u_assignee', function() {
        this.on('t.assigned_to', 'u_assignee.user_id')
           .andOn('t.tenant', 'u_assignee.tenant');
      })
      .leftJoin('contacts as ct', function() {
        this.on('t.contact_name_id', 'ct.contact_name_id')
           .andOn('t.tenant', 'ct.tenant');
      })
      .leftJoin('companies as co', function() {
        this.on('t.company_id', 'co.company_id')
           .andOn('t.tenant', 'co.tenant');
      })
      .where({
        't.ticket_id': id,
        't.tenant': tenant
      })
      .first();

    if (!ticket) {
      throw new Error('Ticket not found');
    }

      // Fetch additional resources and available agents in parallel
      const [additionalAgents, availableAgents] = await Promise.all([
        trx('ticket_resources')
          .where({
            ticket_id: id,
            tenant: tenant
          }),
        trx('users')
          .where({ tenant: tenant })
          .orderBy('first_name', 'asc')
      ]);


    const assigned_to_name = (ticket.assigned_to_first_name || ticket.assigned_to_last_name)
      ? `${ticket.assigned_to_first_name || ''} ${ticket.assigned_to_last_name || ''}`.trim()
      : undefined;

    const detailedTicket: DetailedTicket = {
      ...ticket,
      tenant: tenant,
      status_name: ticket.status_name || 'Unknown',
      is_closed: ticket.is_closed || false,
      channel_name: ticket.channel_name || undefined,
      assigned_to_name: assigned_to_name,
      contact_name: ticket.contact_name || undefined,
      company_name: ticket.company_name || undefined,
      additionalAgents: additionalAgents,
      availableAgents: availableAgents,
    };

    delete (detailedTicket as any).assigned_to_first_name;
    delete (detailedTicket as any).assigned_to_last_name;

    // Track ticket view analytics
    analytics.capture('ticket_viewed', {
      ticket_id: id,
      status_id: ticket.status_id,
      status_name: ticket.status_name,
      is_closed: ticket.is_closed,
      priority_id: ticket.priority_id,
      category_id: ticket.category_id,
      channel_id: ticket.channel_id,
      assigned_to: ticket.assigned_to,
      company_id: ticket.company_id,
      has_additional_agents: additionalAgents.length > 0,
      additional_agent_count: additionalAgents.length,
      view_source: 'ticket_by_id'
    }, user.user_id);

      return convertDates(detailedTicket);
    });

    return result;
  } catch (error) {
    console.error('Failed to fetch ticket:', error);
    throw new Error('Failed to fetch ticket');
  }
}
