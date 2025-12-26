import { BaseModel } from './BaseModel';
import type { Knex } from 'knex';
import { 
  IEventCatalogEntry, 
  ICreateEventCatalogEntry, 
  IUpdateEventCatalogEntry 
} from '@shared/workflow/types/eventCatalog';

/**
 * Model for event catalog entries
 */
export class EventCatalogModel extends BaseModel {
  /**
   * Create a new event catalog entry
   * 
   * @param knex Knex instance
   * @param data Event catalog entry data
   * @returns The created event catalog entry
   */
  static async create(
    knexOrTrx: Knex | Knex.Transaction,
    data: ICreateEventCatalogEntry
  ): Promise<IEventCatalogEntry> {
    const [entry] = await knexOrTrx('event_catalog')
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
    knexOrTrx: Knex | Knex.Transaction,
    eventId: string,
    tenantId: string
  ): Promise<IEventCatalogEntry | null> {
    const entry = await knexOrTrx('event_catalog')
      .where({
        event_id: eventId,
        tenant: tenantId
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
    knexOrTrx: Knex | Knex.Transaction,
    eventType: string,
    tenantId: string
  ): Promise<IEventCatalogEntry | null> {
    const entry = await knexOrTrx('event_catalog')
      .where({
        event_type: eventType,
        tenant: tenantId
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
    knexOrTrx: Knex | Knex.Transaction,
    tenantId: string,
    options: {
      category?: string;
      isSystemEvent?: boolean;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<IEventCatalogEntry[]> {
    const { category, isSystemEvent, limit = 100, offset = 0 } = options;
    
    let query;
    if (isSystemEvent === true) {
      query = knexOrTrx('system_event_catalog');
    } else if (isSystemEvent === false) {
      query = knexOrTrx('event_catalog').where('tenant', tenantId);
    } else {
      // If isSystemEvent is undefined, query both tables and combine
      const tenantEventsQuery = knexOrTrx('event_catalog')
        .where('tenant', tenantId);
      
      if (category !== undefined) {
        tenantEventsQuery.where('category', category);
      }

      const systemEventsQuery = knexOrTrx('system_event_catalog');

      if (category !== undefined) {
        systemEventsQuery.where('category', category);
      }

      // Combine results from both tables
      const tenantEvents = await tenantEventsQuery.orderBy('name', 'asc').limit(limit).offset(offset);
      const systemEvents = await systemEventsQuery.orderBy('name', 'asc').limit(limit).offset(offset);

      // Simple concatenation for now, pagination/ordering across combined results might need more complex logic
      return [...tenantEvents, ...systemEvents];
    }

    if (category !== undefined) {
      query.where('category', category);
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
    knexOrTrx: Knex | Knex.Transaction,
    eventId: string,
    tenantId: string,
    data: IUpdateEventCatalogEntry
  ): Promise<IEventCatalogEntry | null> {
    const [entry] = await knexOrTrx('event_catalog')
      .where({
        event_id: eventId,
        tenant: tenantId
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
    knexOrTrx: Knex | Knex.Transaction,
    eventId: string,
    tenantId: string
  ): Promise<boolean> {
    const result = await knexOrTrx('event_catalog')
      .where({
        event_id: eventId,
        tenant: tenantId
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
    knexOrTrx: Knex | Knex.Transaction,
    tenantId: string
  ): Promise<void> {
    // Check if system events already exist for this tenant
    // Check if system events already exist
    const existingEvents = await knexOrTrx('system_event_catalog')
      .count('* as count')
      .first();
    
    if (existingEvents && Number(existingEvents.count) > 0) {
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
        tenant: tenantId
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
        tenant: tenantId
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
        tenant: tenantId
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
        tenant: tenantId
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
            clientId: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid' },
            amount: { type: 'number' }
          },
          required: ['tenantId', 'invoiceId', 'clientId', 'userId', 'amount']
        },
        tenant: tenantId
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
            clientId: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid' },
            amount: { type: 'number' }
          },
          required: ['tenantId', 'invoiceId', 'clientId', 'userId', 'amount']
        },
        tenant: tenantId
      },
      {
        event_type: 'TICKET_RESPONSE_STATE_CHANGED',
        name: 'Ticket Response State Changed',
        description: 'Triggered when a ticket\'s response state changes (e.g., from awaiting client to awaiting internal)',
        category: 'Tickets',
        payload_schema: {
          type: 'object',
          properties: {
            tenantId: { type: 'string', format: 'uuid' },
            ticketId: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid', nullable: true },
            previousState: { type: 'string', enum: ['awaiting_client', 'awaiting_internal'], nullable: true },
            newState: { type: 'string', enum: ['awaiting_client', 'awaiting_internal'], nullable: true },
            trigger: { type: 'string', enum: ['comment', 'manual', 'close'] }
          },
          required: ['tenantId', 'ticketId', 'trigger']
        },
        tenant: tenantId
      },
      {
        event_type: 'INBOUND_EMAIL_RECEIVED',
        name: 'Inbound Email Received',
        description: 'Triggered when an inbound email is received and normalized for workflow processing',
        category: 'Email Processing',
        payload_schema: {
          type: 'object',
          properties: {
            emailData: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                mailhogId: { type: 'string' },
                threadId: { type: 'string' },
                from: {
                  type: 'object',
                  properties: {
                    email: { type: 'string', format: 'email' },
                    name: { type: 'string' }
                  },
                  required: ['email']
                },
                to: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      email: { type: 'string', format: 'email' },
                      name: { type: 'string' }
                    },
                    required: ['email']
                  }
                },
                cc: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      email: { type: 'string', format: 'email' },
                      name: { type: 'string' }
                    },
                    required: ['email']
                  }
                },
                bcc: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      email: { type: 'string', format: 'email' },
                      name: { type: 'string' }
                    },
                    required: ['email']
                  }
                },
                subject: { type: 'string' },
                body: {
                  type: 'object',
                  properties: {
                    text: { type: 'string' },
                    html: { type: 'string' }
                  }
                },
                inReplyTo: { type: 'string' },
                references: { type: 'array', items: { type: 'string' } },
                attachments: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      name: { type: 'string' },
                      contentType: { type: 'string' },
                      size: { type: 'number' },
                      contentId: { type: 'string' }
                    },
                    required: ['id', 'name', 'contentType', 'size']
                  }
                },
                receivedAt: { type: 'string' },
                tenant: { type: 'string' },
                providerId: { type: 'string' }
              },
              required: ['id', 'from', 'subject', 'body']
            },
            providerId: { type: 'string' },
            tenantId: { type: 'string' }
          },
          required: ['emailData', 'providerId', 'tenantId']
        },
        tenant: tenantId
      }
    ];

    // Insert system events
    // Insert system events
    await knexOrTrx('system_event_catalog').insert(systemEvents);
  }
}
