import { Knex } from 'knex';
import { 
  IEventCatalogEntry, 
  ICreateEventCatalogEntry, 
  IUpdateEventCatalogEntry 
} from '@shared/workflow/types/eventCatalog';

/**
 * Model for event catalog entries
 */
export class EventCatalogModel {
  /**
   * Create a new event catalog entry
   * 
   * @param knex Knex instance
   * @param data Event catalog entry data
   * @returns The created event catalog entry
   */
  static async create(
    knex: Knex,
    data: ICreateEventCatalogEntry
  ): Promise<IEventCatalogEntry> {
    const [entry] = await knex('event_catalog')
      .insert(data)
      .returning('*');
    
    return entry;
  }

  /**
   * Get an event catalog entry by ID
   * 
   * @param knex Knex instance
   * @param eventId Event ID
   * @param tenantId Tenant ID
   * @returns The event catalog entry or null if not found
   */
  static async getById(
    knex: Knex,
    eventId: string,
    tenantId: string
  ): Promise<IEventCatalogEntry | null> {
    const entry = await knex('event_catalog')
      .where({
        event_id: eventId,
        tenant_id: tenantId
      })
      .first();
    
    return entry || null;
  }

  /**
   * Get an event catalog entry by event type
   * 
   * @param knex Knex instance
   * @param eventType Event type
   * @param tenantId Tenant ID
   * @returns The event catalog entry or null if not found
   */
  static async getByEventType(
    knex: Knex,
    eventType: string,
    tenantId: string
  ): Promise<IEventCatalogEntry | null> {
    const entry = await knex('event_catalog')
      .where({
        event_type: eventType,
        tenant_id: tenantId
      })
      .first();
    
    return entry || null;
  }

  /**
   * Get all event catalog entries for a tenant
   * 
   * @param knex Knex instance
   * @param tenantId Tenant ID
   * @param options Query options
   * @returns Array of event catalog entries
   */
  static async getAll(
    knex: Knex,
    tenantId: string,
    options: {
      category?: string;
      isSystemEvent?: boolean;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<IEventCatalogEntry[]> {
    const { category, isSystemEvent, limit = 100, offset = 0 } = options;
    
    const query = knex('event_catalog')
      .where('tenant_id', tenantId);
    
    if (category !== undefined) {
      query.where('category', category);
    }
    
    if (isSystemEvent !== undefined) {
      query.where('is_system_event', isSystemEvent);
    }
    
    const entries = await query
      .orderBy('name', 'asc')
      .limit(limit)
      .offset(offset);
    
    return entries;
  }

  /**
   * Update an event catalog entry
   * 
   * @param knex Knex instance
   * @param eventId Event ID
   * @param tenantId Tenant ID
   * @param data Update data
   * @returns The updated event catalog entry
   */
  static async update(
    knex: Knex,
    eventId: string,
    tenantId: string,
    data: IUpdateEventCatalogEntry
  ): Promise<IEventCatalogEntry | null> {
    const [entry] = await knex('event_catalog')
      .where({
        event_id: eventId,
        tenant_id: tenantId
      })
      .update({
        ...data,
        updated_at: new Date().toISOString()
      })
      .returning('*');
    
    return entry || null;
  }

  /**
   * Delete an event catalog entry
   * 
   * @param knex Knex instance
   * @param eventId Event ID
   * @param tenantId Tenant ID
   * @returns True if the entry was deleted, false otherwise
   */
  static async delete(
    knex: Knex,
    eventId: string,
    tenantId: string
  ): Promise<boolean> {
    const result = await knex('event_catalog')
      .where({
        event_id: eventId,
        tenant_id: tenantId
      })
      .delete();
    
    return result !== 0;
  }

  /**
   * Initialize the event catalog with system events
   * 
   * @param knex Knex instance
   * @param tenantId Tenant ID
   */
  static async initializeSystemEvents(
    knex: Knex,
    tenantId: string
  ): Promise<void> {
    // Check if system events already exist for this tenant
    const existingEvents = await knex('event_catalog')
      .where({
        tenant_id: tenantId,
        is_system_event: true
      })
      .count('* as count')
      .first();
    
    if (existingEvents && existingEvents.count > 0) {
      return; // System events already initialized
    }

    // Define system events with their schemas
    const systemEvents: ICreateEventCatalogEntry[] = [
      {
        event_type: 'TICKET_CREATED',
        name: 'Ticket Created',
        description: 'Triggered when a new ticket is created',
        category: 'Tickets',
        payload_schema: {
          type: 'object',
          properties: {
            tenantId: { type: 'string', format: 'uuid' },
            ticketId: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid' }
          },
          required: ['tenantId', 'ticketId', 'userId']
        },
        is_system_event: true,
        tenant_id: tenantId
      },
      {
        event_type: 'TICKET_UPDATED',
        name: 'Ticket Updated',
        description: 'Triggered when a ticket is updated',
        category: 'Tickets',
        payload_schema: {
          type: 'object',
          properties: {
            tenantId: { type: 'string', format: 'uuid' },
            ticketId: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid' },
            changes: { type: 'object' }
          },
          required: ['tenantId', 'ticketId', 'userId']
        },
        is_system_event: true,
        tenant_id: tenantId
      },
      {
        event_type: 'TICKET_CLOSED',
        name: 'Ticket Closed',
        description: 'Triggered when a ticket is closed',
        category: 'Tickets',
        payload_schema: {
          type: 'object',
          properties: {
            tenantId: { type: 'string', format: 'uuid' },
            ticketId: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid' },
            changes: { 
              type: 'object',
              properties: {
                status: {
                  type: 'object',
                  properties: {
                    is_closed: { type: 'boolean', enum: [true] }
                  }
                }
              }
            }
          },
          required: ['tenantId', 'ticketId', 'userId']
        },
        is_system_event: true,
        tenant_id: tenantId
      },
      {
        event_type: 'PROJECT_CREATED',
        name: 'Project Created',
        description: 'Triggered when a new project is created',
        category: 'Projects',
        payload_schema: {
          type: 'object',
          properties: {
            tenantId: { type: 'string', format: 'uuid' },
            projectId: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid' }
          },
          required: ['tenantId', 'projectId', 'userId']
        },
        is_system_event: true,
        tenant_id: tenantId
      },
      {
        event_type: 'INVOICE_GENERATED',
        name: 'Invoice Generated',
        description: 'Triggered when a new invoice is generated',
        category: 'Billing',
        payload_schema: {
          type: 'object',
          properties: {
            tenantId: { type: 'string', format: 'uuid' },
            invoiceId: { type: 'string', format: 'uuid' },
            companyId: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid' },
            amount: { type: 'number' }
          },
          required: ['tenantId', 'invoiceId', 'companyId', 'userId', 'amount']
        },
        is_system_event: true,
        tenant_id: tenantId
      },
      {
        event_type: 'INVOICE_FINALIZED',
        name: 'Invoice Finalized',
        description: 'Triggered when an invoice is finalized',
        category: 'Billing',
        payload_schema: {
          type: 'object',
          properties: {
            tenantId: { type: 'string', format: 'uuid' },
            invoiceId: { type: 'string', format: 'uuid' },
            companyId: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid' },
            amount: { type: 'number' }
          },
          required: ['tenantId', 'invoiceId', 'companyId', 'userId', 'amount']
        },
        is_system_event: true,
        tenant_id: tenantId
      }
    ];

    // Insert system events
    await knex('event_catalog').insert(systemEvents);
  }
}