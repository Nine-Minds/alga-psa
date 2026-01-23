'use server'

import type {
  ITicket,
  ITicketListItem,
  ITicketListFilters,
  IAgentSchedule,
  IUser,
  IComment,
  IClient,
  IContact,
  IBoard,
  ITicketCategory,
  ITicketResource,
  IDocument,
} from '@alga-psa/types';
import { withTransaction } from '@alga-psa/db';
import { createTenantKnex } from '@alga-psa/db';
import { Knex } from 'knex';
import { revalidatePath } from 'next/cache';
import { hasPermission } from '@alga-psa/auth/rbac';
import { z } from 'zod';
import { validateData } from '@alga-psa/validation';
import { publishEvent, publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { getEventBus } from '@alga-psa/event-bus';
import { convertBlockNoteToMarkdown } from '@alga-psa/documents/lib/blocknoteUtils';
import { getImageUrl } from '@alga-psa/documents/actions/documentActions';
import { getClientLogoUrl, getUserAvatarUrl, getClientLogoUrlsBatch } from '@alga-psa/documents/lib/avatarUtils';
import {
  ticketFormSchema,
  ticketSchema,
  ticketUpdateSchema,
  ticketAttributesQuerySchema,
  ticketListItemSchema,
  ticketListFiltersSchema
} from '../schemas/ticket.schema';
import { Temporal } from '@js-temporal/polyfill';
import { resolveUserTimeZone, normalizeIanaTimeZone } from '@alga-psa/db';
import { calculateItilPriority } from '@alga-psa/tickets/lib/itilUtils';
import { getCurrentUser } from '@alga-psa/auth/getCurrentUser';
import { buildTicketTransitionWorkflowEvents } from '../lib/workflowTicketTransitionEvents';
import { buildTicketCommunicationWorkflowEvents } from '../lib/workflowTicketCommunicationEvents';
import { buildTicketResolutionSlaStageCompletionEvent } from '../lib/workflowTicketSlaStageEvents';

// Email event channel constant - inlined to avoid circular dependency with notifications
// Must match the value in @alga-psa/notifications/emailChannel
const EMAIL_EVENT_CHANNEL = 'emailservice::v7';
function getEmailEventChannel(): string {
  return EMAIL_EVENT_CHANNEL;
}

function captureAnalytics(_event: string, _properties?: Record<string, any>, _userId?: string): void {
  // Intentionally no-op: avoid pulling analytics (and its tenancy/client-portal deps) into tickets.
}

// Helper function to safely convert dates
function convertDates<T extends { entered_at?: Date | string | null, updated_at?: Date | string | null, closed_at?: Date | string | null, due_date?: Date | string | null }>(record: T): T {
  return {
    ...record,
    entered_at: record.entered_at instanceof Date ? record.entered_at.toISOString() : record.entered_at,
    updated_at: record.updated_at instanceof Date ? record.updated_at.toISOString() : record.updated_at,
    closed_at: record.closed_at instanceof Date ? record.closed_at.toISOString() : record.closed_at,
    due_date: record.due_date instanceof Date ? record.due_date.toISOString() : record.due_date,
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
export async function getConsolidatedTicketData(ticketId: string, user: IUser) {
  const {knex: db, tenant} = await createTenantKnex(user.tenant);
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

    // Fetch all related data in parallel
    const [
      comments,
      documents,
      clients,
      resources,
      users,
      statuses,
      boards,
      priorities,
      categories
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
        .orderBy('category_name', 'asc')
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

    const normalizedTicketData = convertDates(ticketData);

    // Bundle context (master/child + settings + children list)
    const masterTicketId = normalizedTicketData.master_ticket_id ?? null;
    const bundleRootId = masterTicketId ?? ticketId;
    const bundleSettings = await trx('ticket_bundle_settings')
      .where({ tenant, master_ticket_id: bundleRootId })
      .first();

    const bundleChildren = await trx('tickets as ct')
      .select(
        'ct.ticket_id',
        'ct.ticket_number',
        'ct.title',
        'ct.client_id',
        'comp.client_name',
        'ct.status_id',
        'ct.entered_at',
        'ct.updated_at'
      )
      .leftJoin('clients as comp', function() {
        this.on('ct.client_id', 'comp.client_id')
          .andOn('ct.tenant', 'comp.tenant');
      })
      .where({ 'ct.tenant': tenant, 'ct.master_ticket_id': bundleRootId })
      .orderBy('ct.updated_at', 'desc');

    const bundleMaster = masterTicketId
      ? await trx('tickets as mt')
        .select(
          'mt.ticket_id',
          'mt.ticket_number',
          'mt.title',
          'mt.client_id',
          'comp.client_name',
          'mt.status_id',
          'mt.entered_at',
          'mt.updated_at'
        )
        .leftJoin('clients as comp', function() {
          this.on('mt.client_id', 'comp.client_id')
            .andOn('mt.tenant', 'comp.tenant');
        })
        .where({ 'mt.tenant': tenant, 'mt.ticket_id': masterTicketId })
        .first()
      : null;

    const isBundleChild = Boolean(masterTicketId);
    const isBundleMaster = !isBundleChild && bundleChildren.length > 0;

    // Aggregated child inbound replies surfaced on master (view-only; not duplicated onto master)
    const aggregatedChildClientComments = isBundleMaster
      ? await trx('comments as c')
        .select(
          'c.*',
          'ct.ticket_id as child_ticket_id',
          'ct.ticket_number as child_ticket_number',
          'ct.title as child_ticket_title',
          'comp.client_name as child_client_name'
        )
        .leftJoin('tickets as ct', function() {
          this.on('c.ticket_id', 'ct.ticket_id')
            .andOn('c.tenant', 'ct.tenant');
        })
        .leftJoin('clients as comp', function() {
          this.on('ct.client_id', 'comp.client_id')
            .andOn('ct.tenant', 'comp.tenant');
        })
        .where({ 'c.tenant': tenant })
        .andWhere('c.is_internal', false)
        .andWhere('ct.master_ticket_id', ticketId)
        .orderBy('c.created_at', 'desc')
        .limit(200)
      : [];

    // Track ticket view analytics
    captureAnalytics('ticket_viewed', {
      ticket_id: ticketId,
      status_id: normalizedTicketData.status_id,
      status_name: normalizedTicketData.status_name,
      is_closed: normalizedTicketData.is_closed,
      priority_id: normalizedTicketData.priority_id,
      category_id: normalizedTicketData.category_id,
      board_id: normalizedTicketData.board_id,
      assigned_to: normalizedTicketData.assigned_to,
      client_id: normalizedTicketData.client_id,
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
        ...normalizedTicketData,
        tenant,
        location
      },
      bundle: {
        isBundleChild,
        isBundleMaster,
        masterTicketId: bundleRootId,
        mode: bundleSettings?.mode ?? null,
        reopenOnChildReply: Boolean(bundleSettings?.reopen_on_child_reply),
        masterTicket: bundleMaster,
        children: bundleChildren
      },
      aggregatedChildClientComments,
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
      agentSchedules: agentSchedulesList
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
  const {knex: db, tenant} = await createTenantKnex(user.tenant);
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
      .leftJoin('tickets as mt', function() {
        this.on('t.master_ticket_id', 'mt.ticket_id')
          .andOn('t.tenant', 'mt.tenant');
      })
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

    // Bundle view filter: hide children in bundled view
    if (validatedFilters.bundleView === 'bundled') {
      baseQuery = baseQuery.whereNull('t.master_ticket_id');
    }

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
      if (validatedFilters.bundleView === 'bundled') {
        baseQuery = baseQuery.where(function(this: any) {
          this.where('t.client_id', validatedFilters.clientId)
            .orWhereExists(function(this: any) {
              this.select('*')
                .from('tickets as tc')
                .whereRaw('tc.tenant = t.tenant')
                .andWhereRaw('tc.master_ticket_id = t.ticket_id')
                .andWhere('tc.client_id', validatedFilters.clientId);
            });
        });
      } else {
        baseQuery = baseQuery.where('t.client_id', validatedFilters.clientId);
      }
    }

    if (validatedFilters.contactId) {
      if (validatedFilters.bundleView === 'bundled') {
        baseQuery = baseQuery.where(function(this: any) {
          this.where('t.contact_name_id', validatedFilters.contactId)
            .orWhereExists(function(this: any) {
              this.select('*')
                .from('tickets as tc')
                .whereRaw('tc.tenant = t.tenant')
                .andWhereRaw('tc.master_ticket_id = t.ticket_id')
                .andWhere('tc.contact_name_id', validatedFilters.contactId);
            });
        });
      } else {
        baseQuery = baseQuery.where('t.contact_name_id', validatedFilters.contactId);
      }
    }

    if (validatedFilters.searchQuery) {
      const searchTerm = `%${validatedFilters.searchQuery}%`;
      baseQuery = baseQuery.where(function(this: any) {
        this.where('t.title', 'ilike', searchTerm)
          .orWhere('t.ticket_number', 'ilike', searchTerm);

        if (validatedFilters.bundleView === 'bundled') {
          this.orWhereExists(function(this: any) {
            this.select('*')
              .from('tickets as tc')
              .whereRaw('tc.tenant = t.tenant')
              .andWhereRaw('tc.master_ticket_id = t.ticket_id')
              .andWhere(function(this: any) {
                this.where('tc.title', 'ilike', searchTerm)
                  .orWhere('tc.ticket_number', 'ilike', searchTerm);
              });
          });
        }
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

    // Apply due date filters (timezone-aware for 'today' filter)
    if (validatedFilters.dueDateFilter && validatedFilters.dueDateFilter !== 'all') {
      const nowInstant = Temporal.Now.instant();
      const nowIso = nowInstant.toString();

      switch (validatedFilters.dueDateFilter) {
        case 'overdue':
          // Due date is in the past
          baseQuery = baseQuery.where('t.due_date', '<', nowIso);
          break;
        case 'upcoming':
          // Due date is within the next 7 days (not overdue)
          const weekFromNow = nowInstant.add({ hours: 24 * 7 });
          baseQuery = baseQuery
            .where('t.due_date', '>=', nowIso)
            .where('t.due_date', '<=', weekFromNow.toString());
          break;
        case 'today':
          // Due date is today in user's timezone
          const userTz = await resolveUserTimeZone(trx, tenant, user.user_id);
          const zonedNow = nowInstant.toZonedDateTimeISO(userTz);
          const startOfTodayZoned = zonedNow.startOfDay();
          const endOfTodayZoned = startOfTodayZoned.add({ days: 1 });
          baseQuery = baseQuery
            .where('t.due_date', '>=', startOfTodayZoned.toInstant().toString())
            .where('t.due_date', '<', endOfTodayZoned.toInstant().toString());
          break;
        case 'no_due_date':
          // No due date set
          baseQuery = baseQuery.whereNull('t.due_date');
          break;
        case 'before':
          // Due date is before a specific date
          if (validatedFilters.dueDateTo) {
            baseQuery = baseQuery.where('t.due_date', '<', validatedFilters.dueDateTo);
          }
          break;
        case 'after':
          // Due date is after a specific date
          if (validatedFilters.dueDateFrom) {
            baseQuery = baseQuery.where('t.due_date', '>', validatedFilters.dueDateFrom);
          }
          break;
        case 'custom':
          // Custom date range
          if (validatedFilters.dueDateFrom) {
            baseQuery = baseQuery.where('t.due_date', '>=', validatedFilters.dueDateFrom);
          }
          if (validatedFilters.dueDateTo) {
            baseQuery = baseQuery.where('t.due_date', '<=', validatedFilters.dueDateTo);
          }
          break;
      }
    }

    // Apply response state filter if provided (F017-F021)
    if (validatedFilters.responseState && validatedFilters.responseState !== 'all') {
      if (validatedFilters.responseState === 'none') {
        // Filter for tickets with no response state set
        baseQuery = baseQuery.whereNull('t.response_state');
      } else {
        // Filter for specific response state
        baseQuery = baseQuery.where('t.response_state', validatedFilters.responseState);
      }
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
      entered_by_name: { rawExpression: "COALESCE(CONCAT(u.first_name, ' ', u.last_name), '')" },
      due_date: { column: 't.due_date' }
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
        trx.raw(
          `(
            SELECT COUNT(*)::int
            FROM tickets as tc
            WHERE tc.tenant = t.tenant
              AND tc.master_ticket_id = t.ticket_id
          ) as bundle_child_count`
        ),
        trx.raw(
          `(
            SELECT COUNT(DISTINCT x.client_id)::int
            FROM (
              SELECT t2.client_id as client_id
              FROM tickets as t2
              WHERE t2.tenant = t.tenant
                AND t2.ticket_id = t.ticket_id
              UNION ALL
              SELECT tc.client_id
              FROM tickets as tc
              WHERE tc.tenant = t.tenant
                AND tc.master_ticket_id = t.ticket_id
            ) as x
            WHERE x.client_id IS NOT NULL
          ) as bundle_distinct_client_count`
        ),
        'mt.ticket_number as bundle_master_ticket_number',
        's.name as status_name',
        'p.priority_name',
        'p.color as priority_color',
        'c.board_name',
        'cat.category_name',
        'comp.client_name',
        trx.raw("CONCAT(u.first_name, ' ', u.last_name) as entered_by_name"),
        trx.raw("CONCAT(au.first_name, ' ', au.last_name) as assigned_to_name"),
        trx.raw("(SELECT COUNT(*) FROM ticket_resources tr WHERE tr.ticket_id = t.ticket_id AND tr.tenant = t.tenant AND tr.additional_user_id IS NOT NULL)::int as additional_agent_count"),
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
        bundle_child_count,
        bundle_distinct_client_count,
        bundle_master_ticket_number,
        // NOTE: Legacy ITIL fields removed - now using unified system
        ...rest
      } = ticket;

      const convertedRest = convertDates(rest);
      // Clean up null optional fields to undefined for type compatibility
      if (convertedRest.itil_impact === null) {
        convertedRest.itil_impact = undefined;
      }
      if (convertedRest.itil_urgency === null) {
        convertedRest.itil_urgency = undefined;
      }
      if (convertedRest.itil_priority_level === null) {
        convertedRest.itil_priority_level = undefined;
      }
      if (convertedRest.due_date === null) {
        convertedRest.due_date = undefined;
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
        additional_agents: additional_agents || [],
        bundle_child_count: typeof bundle_child_count === 'number' ? bundle_child_count : Number.parseInt(String(bundle_child_count ?? '0'), 10) || 0,
        bundle_distinct_client_count: typeof bundle_distinct_client_count === 'number' ? bundle_distinct_client_count : Number.parseInt(String(bundle_distinct_client_count ?? '0'), 10) || 0,
        bundle_master_ticket_number: bundle_master_ticket_number ?? null
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
  const {knex: db, tenant} = await createTenantKnex(user.tenant);
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
  const {knex: db, tenant} = await createTenantKnex(user.tenant);
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

    // Bundled child tickets lock workflow fields by default
    const isBundledChild = Boolean(currentTicket.master_ticket_id);
    const lockedFields = new Set(['status_id', 'assigned_to', 'priority_id']);
    if (isBundledChild) {
      const attempted = Object.keys(validatedData).filter((k) => lockedFields.has(k));
      if (attempted.length > 0) {
        throw new Error(`This ticket is bundled; workflow fields are locked (${attempted.join(', ')}). Update the master ticket instead.`);
      }
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

    // Handle ITIL priority calculation if impact or urgency is being updated
    if (('itil_impact' in updateData || 'itil_urgency' in updateData)) {
      const newImpact = 'itil_impact' in updateData ? updateData.itil_impact : currentTicket.itil_impact;
      const newUrgency = 'itil_urgency' in updateData ? updateData.itil_urgency : currentTicket.itil_urgency;

      if (newImpact && newUrgency) {
        // Calculate ITIL priority level
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

    // Emit expanded domain transition events for workflow v2 triggers.
    const occurredAt = new Date().toISOString();
    const workflowCtx = {
      tenantId: tenant,
      actor: { actorType: 'USER' as const, actorUserId: user.user_id },
      occurredAt,
    };

    const transitionEvents = buildTicketTransitionWorkflowEvents({
      before: {
        ticketId: id,
        statusId: currentTicket.status_id,
        priorityId: currentTicket.priority_id,
        assignedTo: currentTicket.assigned_to,
        boardId: currentTicket.board_id,
        escalated: currentTicket.escalated,
      },
      after: {
        ticketId: id,
        statusId: updatedTicket.status_id,
        priorityId: updatedTicket.priority_id,
        assignedTo: updatedTicket.assigned_to,
        boardId: updatedTicket.board_id,
        escalated: updatedTicket.escalated,
      },
      ctx: {
        occurredAt,
        actorUserId: user.user_id,
        previousStatusIsClosed: !!oldStatus?.is_closed,
        newStatusIsClosed: !!newStatus?.is_closed,
      },
    });

    for (const ev of transitionEvents) {
      await publishWorkflowEvent({
        eventType: ev.eventType,
        payload: ev.payload,
        ctx: workflowCtx,
        eventName: ev.workflow?.eventName,
        fromState: ev.workflow?.fromState,
        toState: ev.workflow?.toState,
      });
    }

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
      await publishWorkflowEvent({
        eventType: 'TICKET_CLOSED',
        payload: {
          ticketId: id,
          userId: user.user_id,
          closedByUserId: user.user_id,
          closedAt: occurredAt,
          changes: structuredChanges,
        },
        ctx: workflowCtx,
        eventName: 'Ticket Closed',
        fromState: currentTicket.status_id,
        toState: updatedTicket.status_id,
      });

      const slaCompletionEvent = buildTicketResolutionSlaStageCompletionEvent({
        tenantId: tenant,
        ticketId: id,
        itilPriorityLevel: currentTicket.itil_priority_level,
        enteredAt: currentTicket.entered_at,
        closedAt: occurredAt,
      });
      if (slaCompletionEvent) {
        await publishWorkflowEvent({
          eventType: slaCompletionEvent.eventType,
          payload: slaCompletionEvent.payload,
          ctx: workflowCtx,
          idempotencyKey: slaCompletionEvent.idempotencyKey,
        });
      }
    } else if (updateData.assigned_to && updateData.assigned_to !== currentTicket.assigned_to) {
      // Ticket was assigned - userId should be the user being assigned, not the one making the update
      await publishWorkflowEvent({
        eventType: 'TICKET_ASSIGNED',
        payload: {
          ticketId: id,
          userId: updateData.assigned_to, // Legacy: assigned user
          assignedByUserId: user.user_id,
          previousAssigneeId: currentTicket.assigned_to ?? undefined,
          previousAssigneeType: currentTicket.assigned_to ? 'user' : undefined,
          newAssigneeId: updateData.assigned_to,
          newAssigneeType: 'user',
          assignedAt: occurredAt,
          changes: structuredChanges,
        },
        ctx: workflowCtx,
        eventName: 'Ticket Assigned',
      });
    } else {
      // Regular update
      await publishWorkflowEvent({
        eventType: 'TICKET_UPDATED',
        payload: {
          ticketId: id,
          userId: user.user_id,
          updatedByUserId: user.user_id,
          changes: structuredChanges,
        },
        ctx: workflowCtx,
        eventName: 'Ticket Updated',
      });
    }

    // If this is a bundle master in sync_updates mode, propagate selected workflow updates to children.
    const bundleSettings = await trx('ticket_bundle_settings')
      .where({ tenant, master_ticket_id: id })
      .first();

    if (bundleSettings?.mode === 'sync_updates') {
      const propagate: Record<string, any> = {};
      for (const key of ['status_id', 'assigned_to', 'priority_id', 'closed_by', 'closed_at']) {
        if (Object.prototype.hasOwnProperty.call(updateData, key)) {
          propagate[key] = (updateData as any)[key];
        }
      }

      if (Object.keys(propagate).length > 0) {
        propagate.updated_by = user.user_id;
        propagate.updated_at = new Date().toISOString();
        await trx('tickets')
          .where({ tenant, master_ticket_id: id })
          .update(propagate);
      }
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
 * Client-safe wrapper: resolves current user on the server.
 * Use this from Client Components to avoid importing server-only auth modules into the browser bundle.
 */
export async function updateTicketWithCacheForCurrentUser(id: string, data: Partial<ITicket>) {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }
  return updateTicketWithCache(id, data, user);
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
  const {knex: db, tenant} = await createTenantKnex(user.tenant);
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

    // If this is a bundle master in sync_updates mode, mirror public comments to children (idempotent).
    if (!isInternal) {
      const bundleSettings = await trx('ticket_bundle_settings')
        .where({ tenant, master_ticket_id: ticketId })
        .first();

      if (bundleSettings?.mode === 'sync_updates') {
        const children = await trx('tickets')
          .select('ticket_id')
          .where({ tenant, master_ticket_id: ticketId });

        const now = new Date().toISOString();
        for (const child of children) {
          await trx.raw(
            `
            WITH existing AS (
              SELECT 1
              FROM ticket_bundle_mirrors
              WHERE tenant = ?
                AND source_comment_id = ?
                AND child_ticket_id = ?
              LIMIT 1
            ),
            ins_comment AS (
              INSERT INTO comments (
                tenant,
                ticket_id,
                user_id,
                author_type,
                note,
                is_internal,
                is_resolution,
                is_system_generated,
                markdown_content,
                created_at
              )
              SELECT ?, ?, NULL, 'unknown', ?, false, ?, true, ?, ?
              WHERE NOT EXISTS (SELECT 1 FROM existing)
              RETURNING comment_id
            )
            INSERT INTO ticket_bundle_mirrors (tenant, source_comment_id, child_ticket_id, child_comment_id)
            SELECT ?, ?, ?, comment_id
            FROM ins_comment
            ON CONFLICT DO NOTHING;
            `,
            [
              tenant, newComment.comment_id, child.ticket_id,
              tenant, child.ticket_id, content, isResolution, markdownContent, now,
              tenant, newComment.comment_id, child.ticket_id
            ]
          );
        }
      }
    }

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

    // Publish workflow v2 ticket message events (additive).
    try {
      const occurredAt = newComment.created_at ?? new Date().toISOString();
      const workflowCtx = {
        tenantId: tenant,
        actor: { actorType: 'USER' as const, actorUserId: user.user_id },
        occurredAt,
        correlationId: newComment.comment_id,
      };

      const events = buildTicketCommunicationWorkflowEvents({
        ticketId,
        messageId: newComment.comment_id,
        visibility: isInternal ? 'internal' : 'public',
        author: { authorType: 'user', authorId: user.user_id },
        channel: 'ui',
        createdAt: occurredAt,
      });

      for (const ev of events) {
        await publishWorkflowEvent({ eventType: ev.eventType, payload: ev.payload, ctx: workflowCtx });
      }
    } catch (eventError) {
      console.error('[addTicketCommentWithCache] Failed to publish workflow ticket message events:', eventError);
    }
    
    // Track comment analytics
    captureAnalytics('ticket_comment_added', {
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
 * Client-safe wrapper: resolves current user on the server.
 * Use this from Client Components to avoid importing server-only auth modules into the browser bundle.
 */
export async function addTicketCommentWithCacheForCurrentUser(
  ticketId: string,
  content: string,
  isInternal: boolean,
  isResolution: boolean
): Promise<IComment> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }
  return addTicketCommentWithCache(ticketId, content, isInternal, isResolution, user);
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
  const {knex: db, tenant} = await createTenantKnex(user.tenant);
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
  const {knex: db, tenant} = await createTenantKnex(user.tenant);
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
 * Fetch bundle children for a given master ticket.
 * Used by the ticket list when in "bundled" view and expanding a master inline.
 */
export async function fetchBundleChildrenForMaster(
  user: IUser,
  masterTicketId: string
): Promise<ITicketListItem[]> {
  const { knex: db, tenant } = await createTenantKnex(user.tenant);
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  return withTransaction(db, async (trx) => {
    if (!await hasPermission(user, 'ticket', 'read', trx)) {
      throw new Error('Permission denied: Cannot view tickets');
    }

    const rows = await trx('tickets as t')
      .leftJoin('tickets as mt', function () {
        this.on('t.master_ticket_id', 'mt.ticket_id')
          .andOn('t.tenant', 'mt.tenant');
      })
      .leftJoin('statuses as s', function () {
        this.on('t.status_id', 's.status_id')
          .andOn('t.tenant', 's.tenant');
      })
      .leftJoin('priorities as p', function () {
        this.on('t.priority_id', 'p.priority_id')
          .andOn('t.tenant', 'p.tenant')
          .andOnVal('p.item_type', '=', 'ticket');
      })
      .leftJoin('boards as c', function () {
        this.on('t.board_id', 'c.board_id')
          .andOn('t.tenant', 'c.tenant');
      })
      .leftJoin('categories as cat', function () {
        this.on('t.category_id', 'cat.category_id')
          .andOn('t.tenant', 'cat.tenant');
      })
      .leftJoin('clients as comp', function () {
        this.on('t.client_id', 'comp.client_id')
          .andOn('t.tenant', 'comp.tenant');
      })
      .leftJoin('users as u', function () {
        this.on('t.entered_by', 'u.user_id')
          .andOn('t.tenant', 'u.tenant');
      })
      .leftJoin('users as au', function () {
        this.on('t.assigned_to', 'au.user_id')
          .andOn('t.tenant', 'au.tenant');
      })
      .select(
        't.*',
        's.name as status_name',
        'p.priority_name',
        'p.color as priority_color',
        'c.board_name',
        'cat.category_name',
        'comp.client_name as client_name',
        trx.raw("CONCAT(u.first_name, ' ', u.last_name) as entered_by_name"),
        trx.raw("CONCAT(au.first_name, ' ', au.last_name) as assigned_to_name"),
        'mt.ticket_number as bundle_master_ticket_number'
      )
      .where({ 't.tenant': tenant, 't.master_ticket_id': masterTicketId })
      .orderBy('t.updated_at', 'desc');

    return rows.map((ticket: any): ITicketListItem => {
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
        bundle_master_ticket_number,
        ...rest
      } = ticket;

      return {
        ...rest,
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
        assigned_to_name: assigned_to_name || 'Unknown',
        // Children are not masters; keep these fields stable for the list UI.
        bundle_child_count: 0,
        bundle_distinct_client_count: 0,
        bundle_master_ticket_number: bundle_master_ticket_number ?? null,
      };
    });
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
