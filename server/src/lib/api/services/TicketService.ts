/**
 * Ticket Service
 * Business logic for ticket-related operations
 */

import { Knex } from 'knex';
import { BaseService, ServiceContext, ListResult } from './BaseService';
import { ITicket } from 'server/src/interfaces/ticket.interfaces';
import { withTransaction } from '@shared/db';
import { NumberingService } from 'server/src/lib/services/numberingService';
import { getEventBus } from 'server/src/lib/eventBus';
// Event types no longer needed as we create objects directly
import { 
  CreateTicketData, 
  UpdateTicketData, 
  TicketFilterData,
  CreateTicketCommentData,
  TicketSearchData,
  CreateTicketFromAssetData
} from '../schemas/ticket';
import { ListOptions } from '../controllers/BaseController';
import { analytics } from '../../analytics/posthog';
import { AnalyticsEvents } from '../../analytics/events';
// import { performanceTracker } from '../../analytics/performanceTracking';

export class TicketService extends BaseService<ITicket> {
  constructor() {
    super({
      tableName: 'tickets',
      primaryKey: 'ticket_id',
      tenantColumn: 'tenant',
      searchableFields: ['title', 'ticket_number'],
      defaultSort: 'entered_at',
      defaultOrder: 'desc'
    });
  }

  /**
   * List tickets with enhanced filtering and related data
   */
  async list(options: ListOptions, context: ServiceContext): Promise<ListResult<ITicket>> {
    const { knex } = await this.getKnex();
    
    const {
      page = 1,
      limit = 25,
      filters = {} as TicketFilterData,
      sort,
      order
    } = options;

    // Build base query with all necessary joins
    let dataQuery = knex('tickets as t')
      .leftJoin('companies as comp', function() {
        this.on('t.company_id', '=', 'comp.company_id')
            .andOn('t.tenant', '=', 'comp.tenant');
      })
      .leftJoin('contacts as cont', function() {
        this.on('t.contact_name_id', '=', 'cont.contact_name_id')
            .andOn('t.tenant', '=', 'cont.tenant');
      })
      .leftJoin('statuses as stat', function() {
        this.on('t.status_id', '=', 'stat.status_id')
            .andOn('t.tenant', '=', 'stat.tenant');
      })
      .leftJoin('priorities as pri', function() {
        this.on('t.priority_id', '=', 'pri.priority_id')
            .andOn('t.tenant', '=', 'pri.tenant');
      })
      .leftJoin('categories as cat', function() {
        this.on('t.category_id', '=', 'cat.category_id')
            .andOn('t.tenant', '=', 'cat.tenant');
      })
      .leftJoin('categories as subcat', function() {
        this.on('t.subcategory_id', '=', 'subcat.category_id')
            .andOn('t.tenant', '=', 'subcat.tenant');
      })
      .leftJoin('channels as chan', function() {
        this.on('t.channel_id', '=', 'chan.channel_id')
            .andOn('t.tenant', '=', 'chan.tenant');
      })
      .leftJoin('users as entered_user', function() {
        this.on('t.entered_by', '=', 'entered_user.user_id')
            .andOn('t.tenant', '=', 'entered_user.tenant');
      })
      .leftJoin('users as assigned_user', function() {
        this.on('t.assigned_to', '=', 'assigned_user.user_id')
            .andOn('t.tenant', '=', 'assigned_user.tenant');
      })
      .where('t.tenant', context.tenant);

    let countQuery = knex('tickets as t')
      .where('t.tenant', context.tenant);

    // Apply filters
    dataQuery = this.applyTicketFilters(dataQuery, filters);
    countQuery = this.applyTicketFilters(countQuery, filters);

    // Apply sorting
    const sortField = sort || this.defaultSort;
    const sortOrder = order || this.defaultOrder;
    
    // Handle sorting by related fields
    if (sortField === 'company_name') {
      dataQuery = dataQuery.orderBy('comp.company_name', sortOrder);
    } else if (sortField === 'status_name') {
      dataQuery = dataQuery.orderBy('stat.status_name', sortOrder);
    } else if (sortField === 'priority_name') {
      dataQuery = dataQuery.orderBy('pri.priority_name', sortOrder);
    } else {
      dataQuery = dataQuery.orderBy(`t.${sortField}`, sortOrder);
    }

    // Apply pagination
    const offset = (page - 1) * limit;
    dataQuery = dataQuery.limit(limit).offset(offset);

    // Select fields
    dataQuery = dataQuery.select(
      't.*',
      'comp.company_name',
      'cont.full_name as contact_name',
      'stat.status_name',
      'stat.is_closed as status_is_closed',
      'pri.priority_name',
      'cat.category_name',
      'subcat.category_name as subcategory_name',
      'chan.channel_name',
      knex.raw(`CASE 
        WHEN entered_user.first_name IS NOT NULL AND entered_user.last_name IS NOT NULL 
        THEN CONCAT(entered_user.first_name, ' ', entered_user.last_name) 
        ELSE NULL 
      END as entered_by_name`),
      knex.raw(`CASE 
        WHEN assigned_user.first_name IS NOT NULL AND assigned_user.last_name IS NOT NULL 
        THEN CONCAT(assigned_user.first_name, ' ', assigned_user.last_name) 
        ELSE NULL 
      END as assigned_to_name`)
    );

    // Execute queries
    const [tickets, [{ count }]] = await Promise.all([
      dataQuery,
      countQuery.count('* as count')
    ]);

    return {
      data: tickets as ITicket[],
      total: parseInt(count as string)
    };
  }

  /**
   * Get ticket by ID with all related data
   */
  async getById(id: string, context: ServiceContext): Promise<ITicket | null> {
    const { knex } = await this.getKnex();

    const ticket = await knex('tickets as t')
      .leftJoin('companies as comp', function() {
        this.on('t.company_id', '=', 'comp.company_id')
            .andOn('t.tenant', '=', 'comp.tenant');
      })
      .leftJoin('contacts as cont', function() {
        this.on('t.contact_name_id', '=', 'cont.contact_name_id')
            .andOn('t.tenant', '=', 'cont.tenant');
      })
      .leftJoin('statuses as stat', function() {
        this.on('t.status_id', '=', 'stat.status_id')
            .andOn('t.tenant', '=', 'stat.tenant');
      })
      .leftJoin('priorities as pri', function() {
        this.on('t.priority_id', '=', 'pri.priority_id')
            .andOn('t.tenant', '=', 'pri.tenant');
      })
      .leftJoin('categories as cat', function() {
        this.on('t.category_id', '=', 'cat.category_id')
            .andOn('t.tenant', '=', 'cat.tenant');
      })
      .leftJoin('users as assigned_user', function() {
        this.on('t.assigned_to', '=', 'assigned_user.user_id')
            .andOn('t.tenant', '=', 'assigned_user.tenant');
      })
      .select(
        't.*',
        'comp.company_name',
        'comp.email as company_email',
        'comp.phone_no as company_phone',
        'cont.full_name as contact_name',
        'cont.email as contact_email',
        'cont.phone_number as contact_phone',
        'stat.status_name',
        'stat.is_closed as status_is_closed',
        'pri.priority_name',
        'cat.category_name',
        knex.raw(`CASE 
          WHEN assigned_user.first_name IS NOT NULL AND assigned_user.last_name IS NOT NULL 
          THEN CONCAT(assigned_user.first_name, ' ', assigned_user.last_name) 
          ELSE NULL 
        END as assigned_to_name`)
      )
      .where({ 't.ticket_id': id, 't.tenant': context.tenant })
      .first();

    return ticket as ITicket | null;
  }

  /**
   * Create new ticket
    // Override for BaseService compatibility  
    async create(data: Partial<ITicket>, context: ServiceContext): Promise<ITicket>;
    async create(data: CreateTicketData, context: ServiceContext): Promise<ITicket>;
    async create(data: CreateTicketData | Partial<ITicket>, context: ServiceContext): Promise<ITicket> {
      // Ensure we have required fields for CreateTicketData
      if (!data.company_id || !data.title || !data.channel_id || !data.status_id || !data.priority_id) {
        throw new Error('Required ticket fields missing: company_id, title, channel_id, status_id, priority_id');
      }
      return this.createTicket(data as CreateTicketData, context);
    }
  
    private async createTicket(data: CreateTicketData, context: ServiceContext): Promise<ITicket> {
   */
    // Override for BaseService compatibility  
    async create(data: Partial<ITicket>, context: ServiceContext): Promise<ITicket>;
    async create(data: CreateTicketData, context: ServiceContext): Promise<ITicket>;
    async create(data: CreateTicketData | Partial<ITicket>, context: ServiceContext): Promise<ITicket> {
      // Ensure we have required fields for CreateTicketData
      if (!data.company_id || !data.title || !data.channel_id || !data.status_id || !data.priority_id) {
        throw new Error('Required ticket fields missing: company_id, title, channel_id, status_id, priority_id');
      }
      return this.createTicket(data as CreateTicketData, context);
    }
  
    private async createTicket(data: CreateTicketData, context: ServiceContext): Promise<ITicket> {
      const { knex } = await this.getKnex();
  
      return withTransaction(knex, async (trx) => {
        // Generate ticket number
        const numberingService = new NumberingService();
        const ticketNumber = await numberingService.getNextTicketNumber();
  
        // Prepare ticket data
        const ticketData = {
          ticket_id: knex.raw('gen_random_uuid()'),
          ticket_number: ticketNumber,
          title: data.title,
          url: data.url || null,
          channel_id: data.channel_id,
          company_id: data.company_id,
          location_id: data.location_id || null,
          contact_name_id: data.contact_name_id || null,
          status_id: data.status_id,
          category_id: data.category_id || null,
          subcategory_id: data.subcategory_id || null,
          entered_by: context.userId,
          updated_by: context.userId,
          assigned_to: data.assigned_to || null,
          priority_id: data.priority_id,
          attributes: data.attributes || null,
          entered_at: knex.raw('now()'),
          updated_at: knex.raw('now()'),
          tenant: context.tenant
        };
  
        // Insert ticket
        const [ticket] = await trx('tickets').insert(ticketData).returning('*');
  
        // Handle tags if provided
        if (data.tags && data.tags.length > 0) {
          await this.handleTags(ticket.ticket_id, data.tags, context, trx);
        }
  
        // Publish ticket created event
        await this.safePublishEvent('TicketCreated', {
          id: require("crypto").randomUUID(),
          eventType: "TICKET_CREATED" as const,
          timestamp: new Date().toISOString(),
          payload: {
            tenantId: context.tenant,
            ticketId: ticket.ticket_id,
            userId: context.userId
          }
        });
  
        return ticket as ITicket;
      });
    }


  /**
   * Update ticket
   */
  async update(id: string, data: UpdateTicketData, context: ServiceContext): Promise<ITicket> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Get current ticket for event comparison
      const currentTicket = await trx('tickets')
        .where({ ticket_id: id, tenant: context.tenant })
        .first();

      if (!currentTicket) {
        throw new Error('Ticket not found or permission denied');
      }

      // Remove undefined values from data object
      const cleanedData = { ...data };
      Object.keys(cleanedData).forEach(key => {
        if ((cleanedData as any)[key] === undefined) {
          delete (cleanedData as any)[key];
        }
      });
      
      const updateData = {
        ...cleanedData,
        updated_by: context.userId,
        updated_at: knex.raw('now()')
      };

      // Update ticket
      const [ticket] = await trx('tickets')
        .where({ ticket_id: id, tenant: context.tenant })
        .update(updateData)
        .returning('*');

      // Handle tags if provided
      if (data.tags) {
        await this.handleTags(id, data.tags, context, trx);
      }

      // Publish appropriate events
      if (data.status_id && data.status_id !== currentTicket.status_id) {
        // Check if ticket is being closed
        const newStatus = await trx('statuses')
          .where({ status_id: data.status_id, tenant: context.tenant })
          .first();

        if (newStatus?.is_closed) {
          await this.safePublishEvent('TicketClosed', {
            id: require("crypto").randomUUID(),
            eventType: "TICKET_CLOSED" as const,
            timestamp: new Date().toISOString(),
            payload: {
              tenantId: context.tenant,
              ticketId: ticket.ticket_id,
              userId: context.userId
            }
          });
        }
      }

      await this.safePublishEvent('TicketUpdated', {
        id: require("crypto").randomUUID(),
        eventType: "TICKET_UPDATED" as const,
        timestamp: new Date().toISOString(),
        payload: {
          tenantId: context.tenant,
          ticketId: ticket.ticket_id,
          userId: context.userId
        }
      });

      return ticket as ITicket;
    });
  }

  /**
   * Create ticket from asset
   */
  async createFromAsset(data: CreateTicketFromAssetData, context: ServiceContext): Promise<ITicket> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Verify asset exists and get default values
      const asset = await trx('assets')
        .where({ asset_id: data.asset_id, tenant: context.tenant })
        .first();

      if (!asset) {
        throw new Error('Asset not found');
      }

      // Get default channel and status for tickets
      const [defaultChannel, defaultStatus] = await Promise.all([
        trx('channels').where({ tenant: context.tenant, is_default: true }).first(),
        trx('statuses').where({ tenant: context.tenant, is_default: true }).first()
      ]);

      if (!defaultChannel || !defaultStatus) {
        throw new Error('Default channel or status not configured');
      }

      // Create ticket with asset association
      const ticketData: CreateTicketData = {
        title: data.title,
        channel_id: defaultChannel.channel_id,
        company_id: data.company_id,
        contact_name_id: data.contact_name_id,
        status_id: defaultStatus.status_id,
        category_id: data.category_id,
        priority_id: data.priority_id,
        attributes: {
          description: data.description,
          asset_id: data.asset_id,
          asset_name: asset.asset_name
        }
      };

      const ticket = await this.create(ticketData, context);

      // Create asset association
      await trx('asset_ticket_associations').insert({
        asset_id: data.asset_id,
        ticket_id: ticket.ticket_id,
        tenant: context.tenant,
        created_at: knex.raw('now()')
      });

      return ticket;
    });
  }

  /**
   * Get ticket comments
   */
  async getTicketComments(ticketId: string, context: ServiceContext): Promise<any[]> {
    const { knex } = await this.getKnex();

    const comments = await knex('ticket_comments as tc')
      .leftJoin('users as u', function() {
        this.on('tc.created_by', '=', 'u.user_id')
            .andOn('tc.tenant', '=', 'u.tenant');
      })
      .select(
        'tc.*',
        knex.raw(`CASE 
          WHEN u.first_name IS NOT NULL AND u.last_name IS NOT NULL 
          THEN CONCAT(u.first_name, ' ', u.last_name) 
          ELSE NULL 
        END as created_by_name`)
      )
      .where({
        'tc.ticket_id': ticketId,
        'tc.tenant': context.tenant
      })
      .orderBy('tc.created_at', 'asc');

    return comments;
  }

  /**
   * Add comment to ticket
   */
  async addComment(
    ticketId: string, 
    data: CreateTicketCommentData, 
    context: ServiceContext
  ): Promise<any> {
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      // Verify ticket exists
      const ticket = await trx('tickets')
        .where({ ticket_id: ticketId, tenant: context.tenant })
        .first();

      if (!ticket) {
        throw new Error('Ticket not found');
      }

      const commentData = {
        comment_id: knex.raw('gen_random_uuid()'),
        ticket_id: ticketId,
        comment_text: data.comment_text,
        is_internal: data.is_internal || false,
        time_spent: data.time_spent || null,
        created_by: context.userId,
        tenant: context.tenant,
        created_at: knex.raw('now()'),
        updated_at: knex.raw('now()')
      };

      const [comment] = await trx('ticket_comments').insert(commentData).returning('*');

      // Update ticket updated_at
      await trx('tickets')
        .where({ ticket_id: ticketId, tenant: context.tenant })
        .update({
          updated_by: context.userId,
          updated_at: knex.raw('now()')
        });

      return comment;
    });
  }

  /**
   * Search tickets
   */
  async search(searchData: TicketSearchData, context: ServiceContext): Promise<ITicket[]> {
    const { knex } = await this.getKnex();
    const searchStartTime = Date.now();

    let query = knex('tickets as t')
      .leftJoin('companies as comp', function() {
        this.on('t.company_id', '=', 'comp.company_id')
            .andOn('t.tenant', '=', 'comp.tenant');
      })
      .leftJoin('contacts as cont', function() {
        this.on('t.contact_name_id', '=', 'cont.contact_name_id')
            .andOn('t.tenant', '=', 'cont.tenant');
      })
      .leftJoin('statuses as stat', function() {
        this.on('t.status_id', '=', 'stat.status_id')
            .andOn('t.tenant', '=', 'stat.tenant');
      })
      .where('t.tenant', context.tenant);

    // Apply search filters
    if (!searchData.include_closed) {
      query = query.where('stat.is_closed', false);
    }

    if (searchData.status_ids && searchData.status_ids.length > 0) {
      query = query.whereIn('t.status_id', searchData.status_ids);
    }

    if (searchData.priority_ids && searchData.priority_ids.length > 0) {
      query = query.whereIn('t.priority_id', searchData.priority_ids);
    }

    if (searchData.company_ids && searchData.company_ids.length > 0) {
      query = query.whereIn('t.company_id', searchData.company_ids);
    }

    if (searchData.assigned_to_ids && searchData.assigned_to_ids.length > 0) {
      query = query.whereIn('t.assigned_to', searchData.assigned_to_ids);
    }

    // Apply search query
    const searchFields = searchData.fields || ['title', 'ticket_number'];
    query = query.where(subQuery => {
      searchFields.forEach((field, index) => {
        if (field === 'company_name') {
          if (index === 0) {
            subQuery.whereILike('comp.company_name', `%${searchData.query}%`);
          } else {
            subQuery.orWhereILike('comp.company_name', `%${searchData.query}%`);
          }
        } else if (field === 'contact_name') {
          if (index === 0) {
            subQuery.whereILike('cont.full_name', `%${searchData.query}%`);
          } else {
            subQuery.orWhereILike('cont.full_name', `%${searchData.query}%`);
          }
        } else {
          if (index === 0) {
            subQuery.whereILike(`t.${field}`, `%${searchData.query}%`);
          } else {
            subQuery.orWhereILike(`t.${field}`, `%${searchData.query}%`);
          }
        }
      });
    });

    // Execute query
    const tickets = await query
      .select('t.*', 'comp.company_name', 'cont.full_name as contact_name')
      .limit(searchData.limit || 25)
      .orderBy('t.entered_at', 'desc');

    const searchDuration = Date.now() - searchStartTime;

    // Track search analytics
    analytics.capture(AnalyticsEvents.TICKET_SEARCHED, {
      query_length: searchData.query.length,
      search_fields: searchFields,
      filters_used: {
        status: !!searchData.status_ids?.length,
        priority: !!searchData.priority_ids?.length,
        company: !!searchData.company_ids?.length,
        assigned_to: !!searchData.assigned_to_ids?.length,
        include_closed: searchData.include_closed,
      },
      result_count: tickets.length,
      limit: searchData.limit || 25,
    }, context.userId);

    // Track search performance - commented out due to removed performanceTracker
    // performanceTracker.trackSearchPerformance(
    //   'ticket',
    //   searchData.query,
    //   tickets.length,
    //   searchDuration,
    //   context.userId,
    //   {
    //     search_complexity: searchFields.length,
    //     filter_count: Object.values({
    //       status: !!searchData.status_ids?.length,
    //       priority: !!searchData.priority_ids?.length,
    //       company: !!searchData.company_ids?.length,
    //       assigned_to: !!searchData.assigned_to_ids?.length,
    //     }).filter(Boolean).length
    //   }
    // );

    return tickets as ITicket[];
  }

  /**
   * Get ticket statistics
   */
  async getTicketStats(context: ServiceContext): Promise<any> {
    const { knex } = await this.getKnex();

    const [
      totalStats,
      statusStats,
      priorityStats,
      categoryStats,
      channelStats,
      timeStats
    ] = await Promise.all([
      // Total and basic counts
      knex('tickets as t')
        .leftJoin('statuses as s', function() {
          this.on('t.status_id', '=', 's.status_id')
              .andOn('t.tenant', '=', 's.tenant');
        })
        .where('t.tenant', context.tenant)
        .select(
          knex.raw('COUNT(*) as total_tickets'),
          knex.raw('COUNT(CASE WHEN s.is_closed = false THEN 1 END) as open_tickets'),
          knex.raw('COUNT(CASE WHEN s.is_closed = true THEN 1 END) as closed_tickets'),
          knex.raw('COUNT(CASE WHEN t.assigned_to IS NULL THEN 1 END) as unassigned_tickets')
        )
        .first(),

      // Tickets by status
      knex('tickets as t')
        .leftJoin('statuses as s', function() {
          this.on('t.status_id', '=', 's.status_id')
              .andOn('t.tenant', '=', 's.tenant');
        })
        .where('t.tenant', context.tenant)
        .groupBy('s.status_name')
        .select('s.status_name', knex.raw('COUNT(*) as count')),

      // Tickets by priority
      knex('tickets as t')
        .leftJoin('priorities as p', function() {
          this.on('t.priority_id', '=', 'p.priority_id')
              .andOn('t.tenant', '=', 'p.tenant');
        })
        .where('t.tenant', context.tenant)
        .groupBy('p.priority_name')
        .select('p.priority_name', knex.raw('COUNT(*) as count')),

      // Tickets by category
      knex('tickets as t')
        .leftJoin('categories as c', function() {
          this.on('t.category_id', '=', 'c.category_id')
              .andOn('t.tenant', '=', 'c.tenant');
        })
        .where('t.tenant', context.tenant)
        .whereNotNull('t.category_id')
        .groupBy('c.category_name')
        .select('c.category_name', knex.raw('COUNT(*) as count')),

      // Tickets by channel
      knex('tickets as t')
        .leftJoin('channels as ch', function() {
          this.on('t.channel_id', '=', 'ch.channel_id')
              .andOn('t.tenant', '=', 'ch.tenant');
        })
        .where('t.tenant', context.tenant)
        .groupBy('ch.channel_name')
        .select('ch.channel_name', knex.raw('COUNT(*) as count')),

      // Time-based statistics
      knex('tickets')
        .where('tenant', context.tenant)
        .select(
          knex.raw("COUNT(CASE WHEN entered_at >= CURRENT_DATE THEN 1 END) as tickets_created_today"),
          knex.raw("COUNT(CASE WHEN entered_at >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as tickets_created_this_week"),
          knex.raw("COUNT(CASE WHEN entered_at >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END) as tickets_created_this_month")
        )
        .first()
    ]);

    return {
      ...totalStats,
      overdue_tickets: 0, // Would need SLA configuration to calculate
      tickets_by_status: statusStats.reduce((acc: any, row: any) => {
        acc[row.status_name] = parseInt(row.count);
        return acc;
      }, {}),
      tickets_by_priority: priorityStats.reduce((acc: any, row: any) => {
        acc[row.priority_name] = parseInt(row.count);
        return acc;
      }, {}),
      tickets_by_category: categoryStats.reduce((acc: any, row: any) => {
        acc[row.category_name] = parseInt(row.count);
        return acc;
      }, {}),
      tickets_by_channel: channelStats.reduce((acc: any, row: any) => {
        acc[row.channel_name] = parseInt(row.count);
        return acc;
      }, {}),
      average_resolution_time: null, // Would need to calculate from closed tickets
      ...timeStats
    };
  }

  /**
   * Apply ticket-specific filters
   */
  private applyTicketFilters(query: Knex.QueryBuilder, filters: TicketFilterData): Knex.QueryBuilder {
    Object.entries(filters).forEach(([key, value]) => {
      if (value === undefined || value === null) return;

      switch (key) {
        case 'title':
          query.whereILike('t.title', `%${value}%`);
          break;
        case 'ticket_number':
          query.whereILike('t.ticket_number', `%${value}%`);
          break;
        case 'channel_id':
        case 'company_id':
        case 'location_id':
        case 'contact_name_id':
        case 'status_id':
        case 'category_id':
        case 'subcategory_id':
        case 'entered_by':
        case 'assigned_to':
        case 'priority_id':
          query.where(`t.${key}`, value);
          break;
        case 'is_open':
          if (value) {
            query.whereExists(function() {
              this.select('*')
                  .from('statuses as s')
                  .whereRaw('s.status_id = t.status_id')
                  .andWhere('s.tenant', query.client.raw('t.tenant'))
                  .andWhere('s.is_closed', false);
            });
          }
          break;
        case 'is_closed':
          if (value) {
            query.whereExists(function() {
              this.select('*')
                  .from('statuses as s')
                  .whereRaw('s.status_id = t.status_id')
                  .andWhere('s.tenant', query.client.raw('t.tenant'))
                  .andWhere('s.is_closed', true);
            });
          }
          break;
        case 'has_assignment':
          if (value) {
            query.whereNotNull('t.assigned_to');
          } else {
            query.whereNull('t.assigned_to');
          }
          break;
        case 'company_name':
          query.whereExists(function() {
            this.select('*')
                .from('companies as c')
                .whereRaw('c.company_id = t.company_id')
                .andWhere('c.tenant', query.client.raw('t.tenant'))
                .andWhereILike('c.company_name', `%${value}%`);
          });
          break;
        case 'search':
          if (this.searchableFields.length > 0) {
            query.where(subQuery => {
              this.searchableFields.forEach((field, index) => {
                if (index === 0) {
                  subQuery.whereILike(`t.${field}`, `%${value}%`);
                } else {
                  subQuery.orWhereILike(`t.${field}`, `%${value}%`);
                }
              });
              
              // Also search in company name
              subQuery.orWhereExists(function() {
                this.select('*')
                    .from('companies as c')
                    .whereRaw('c.company_id = t.company_id')
                    .andWhere('c.tenant', query.client.raw('t.tenant'))
                    .andWhereILike('c.company_name', `%${value}%`);
              });
            });
          }
          break;
        case 'entered_from':
          query.where('t.entered_at', '>=', value);
          break;
        case 'entered_to':
          query.where('t.entered_at', '<=', value);
          break;
        case 'closed_from':
          query.where('t.closed_at', '>=', value);
          break;
        case 'closed_to':
          query.where('t.closed_at', '<=', value);
          break;
        case 'created_from':
          query.where('t.entered_at', '>=', value);
          break;
        case 'created_to':
          query.where('t.entered_at', '<=', value);
          break;
      }
    });

    return query;
  }

  /**
   * Handle tag associations
   */
  private async handleTags(
    ticketId: string,
    tags: string[],
    context: ServiceContext,
    trx: Knex.Transaction
  ): Promise<void> {
    // Remove existing tags
    await trx('ticket_tags')
      .where({ ticket_id: ticketId, tenant: context.tenant })
      .delete();

    // Add new tags
    if (tags.length > 0) {
      const tagInserts = tags.map(tag => ({
        ticket_id: ticketId,
        tag_name: tag,
        tenant: context.tenant,
        created_at: trx.raw('now()')
      }));

      await trx('ticket_tags').insert(tagInserts);
    }
  }

  /**
   * Safely publish events
   */
  private async safePublishEvent(eventType: string, event: any): Promise<void> {
    try {
      await getEventBus().publish({
        eventType,
        payload: event
      });
    } catch (error) {
      console.error(`Failed to publish ${eventType} event:`, error);
    }
  }
}