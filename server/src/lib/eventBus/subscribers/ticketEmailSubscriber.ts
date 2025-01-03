import { getEventBus } from '../index';
import { 
  EventType, 
  BaseEvent,
  EventSchemas,
  TicketCreatedEvent,
  TicketUpdatedEvent,
  TicketClosedEvent
} from '../events';
import { getEmailService } from '../../notifications/emailService';
import { sendEventEmail } from '../../notifications/sendEventEmail';
import logger from '../../../utils/logger';
import { createTenantKnex } from '../../db';
import { getSecret } from '../../utils/getSecret';

/**
 * Format changes record into a readable string
 */
async function formatChanges(db: any, changes: Record<string, unknown>): Promise<string> {
  const formattedChanges = await Promise.all(
    Object.entries(changes).map(async ([field, value]) => {
      // Handle different types of values
      if (typeof value === 'object' && value !== null) {
        const { from, to } = value as { from?: unknown; to?: unknown };
        if (from !== undefined && to !== undefined) {
          const fromValue = await resolveValue(db, field, from);
          const toValue = await resolveValue(db, field, to);
          return `${formatFieldName(field)}: ${fromValue} → ${toValue}`;
        }
      }
      const resolvedValue = await resolveValue(db, field, value);
      return `${formatFieldName(field)}: ${resolvedValue}`;
    })
  );
  return formattedChanges.join('\n');
}

/**
 * Resolve field values to human-readable names
 */
async function resolveValue(db: any, field: string, value: unknown): Promise<string> {
  if (value === null || value === undefined) {
    return 'None';
  }

  // Handle special fields that need resolution
  switch (field) {
    case 'status_id':
      const status = await db('statuses')
        .where('status_id', value)
        .first();
      return status?.name || String(value);

    case 'updated_by':
    case 'assigned_to':
    case 'closed_by':
      const user = await db('users')
        .where('user_id', value)
        .first();
      return user ? `${user.first_name} ${user.last_name}` : String(value);

    case 'priority_id':
      const priority = await db('priorities')
        .where('priority_id', value)
        .first();
      return priority?.priority_name || String(value);

    default:
      if (typeof value === 'boolean') {
        return value ? 'Yes' : 'No';
      }
      if (typeof value === 'object') {
        return JSON.stringify(value);
      }
      return String(value);
  }
}

/**
 * Format field names to be more readable
 */
function formatFieldName(field: string): string {
  return field
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Format values to be more readable
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'None';
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Handle ticket created events
 */
async function handleTicketCreated(event: TicketCreatedEvent): Promise<void> {
  const { payload } = event;
  const { tenantId } = payload;
  
  try {
    console.log('[EmailSubscriber] Creating database connection');
    const { knex: db } = await createTenantKnex();
    
    // Get ticket details
    console.log('[EmailSubscriber] Fetching ticket details:', { ticketId: payload.ticketId });
    const ticket = await db('tickets as t')
      .select(
        't.*',
        'c.email as company_email',
        'p.priority_name',
        's.name as status_name',
        'u.first_name as updated_by_first_name',
        'u.last_name as updated_by_last_name'
      )
      .leftJoin('companies as c', 't.company_id', 'c.company_id')
      .leftJoin('priorities as p', 't.priority_id', 'p.priority_id')
      .leftJoin('statuses as s', 't.status_id', 's.status_id')
      .leftJoin('users as u', 't.updated_by', 'u.user_id')
      .where('t.ticket_id', payload.ticketId)
      .first();

    if (!ticket || !ticket.company_email) {
      logger.warn('Could not send ticket created email - missing ticket or company email:', {
        eventId: event.id,
        ticketId: payload.ticketId
      });
      return;
    }

    await sendEventEmail({
      tenantId,
      to: ticket.company_email,
      subject: `Ticket Created: ${ticket.title}`,
      template: 'ticket-created',
      context: {
        ticket: {
          id: ticket.ticket_number,
          title: ticket.title,
          description: ticket.attributes?.description || '',
          priority: ticket.priority_name || 'Unknown',
          status: ticket.status_name || 'Unknown',
          createdBy: payload.userId,
          url: `/tickets/${ticket.ticket_number}`
        }
      }
    });

  } catch (error) {
    logger.error('Error handling ticket created event:', {
      error,
      eventId: event.id,
      ticketId: payload.ticketId
    });
    throw error;
  }
}

/**
 * Handle ticket updated events
 */
async function handleTicketUpdated(event: TicketUpdatedEvent): Promise<void> {
    console.log('[EmailSubscriber] Starting ticket update handler:', { 
      eventId: event.id,
      ticketId: event.payload.ticketId,
      changes: event.payload.changes
    });

  const { payload } = event;
  const { tenantId } = payload;
  
  try {
    console.log('[EmailSubscriber] Creating tenant database connection:', {
      tenantId,
      ticketId: payload.ticketId
    });
    const { knex: db } = await createTenantKnex();
    
    console.log('[EmailSubscriber] Fetching ticket details from database:', {
      ticketId: payload.ticketId,
      tenantId
    });
    // Get ticket details
    const ticket = await db('tickets as t')
      .select(
        't.*',
        'c.email as company_email',
        'p.priority_name',
        's.name as status_name'
      )
      .leftJoin('companies as c', 't.company_id', 'c.company_id')
      .leftJoin('priorities as p', 't.priority_id', 'p.priority_id')
      .leftJoin('statuses as s', 't.status_id', 's.status_id')
      .where('t.ticket_id', payload.ticketId)
      .first();

    if (!ticket) {
      console.warn('[EmailSubscriber] Could not find ticket:', {
        eventId: event.id,
        ticketId: payload.ticketId
      });
      return;
    }

    if (!ticket.company_email) {
      console.warn('[EmailSubscriber] Ticket found but missing company email:', {
        eventId: event.id,
        ticketId: payload.ticketId,
        companyId: ticket.company_id
      });
      return;
    }

    console.log('[EmailSubscriber] Found ticket:', {
      ticketId: ticket.ticket_id,
      title: ticket.title,
      companyId: ticket.company_id,
      companyEmail: ticket.company_email,
      status: ticket.status_name
    });

    console.log('[EmailSubscriber] Executing SQL query:', {
      ticketId: payload.ticketId,
      query: db('tickets as t')
        .select(
          't.*',
          'c.email as company_email',
          'p.priority_name',
          's.name as status_name'
        )
        .leftJoin('companies as c', 't.company_id', 'c.company_id')
        .leftJoin('priorities as p', 't.priority_id', 'p.priority_id')
        .leftJoin('statuses as s', 't.status_id', 's.status_id')
        .where('t.ticket_id', payload.ticketId)
        .toSQL()
        .sql
    });

    // Format changes with database lookups
    const formattedChanges = await formatChanges(db, payload.changes || {});

    // Get updater's name
    const updater = await db('users')
      .where('user_id', payload.userId)
      .first();

    console.log('[EmailSubscriber] Sending update notification email:', {
      to: ticket.company_email,
      subject: `Ticket Updated: ${ticket.title}`,
      template: 'ticket-updated'
    });
    await sendEventEmail({
      tenantId,
      to: ticket.company_email,
      subject: `Ticket Updated: ${ticket.title}`,
      template: 'ticket-updated',
      context: {
        ticket: {
          id: ticket.ticket_number,
          title: ticket.title,
          priority: ticket.priority_name || 'Unknown',
          status: ticket.status_name || 'Unknown',
          changes: formattedChanges,
          updatedBy: updater ? `${updater.first_name} ${updater.last_name}` : payload.userId,
          url: `/tickets/${ticket.ticket_number}`
        }
      }
    });

  } catch (error) {
    logger.error('Error handling ticket updated event:', {
      error,
      eventId: event.id,
      ticketId: payload.ticketId
    });
    throw error;
  }
}

/**
 * Handle ticket closed events
 */
async function handleTicketClosed(event: TicketClosedEvent): Promise<void> {
  const { payload } = event;
  const { tenantId } = payload;
  
  try {
    const { knex: db } = await createTenantKnex();
    
    // Get ticket details
    const ticket = await db('tickets as t')
      .select(
        't.*',
        'c.email as company_email',
        'p.priority_name',
        's.name as status_name'
      )
      .leftJoin('companies as c', 't.company_id', 'c.company_id')
      .leftJoin('priorities as p', 't.priority_id', 'p.priority_id')
      .leftJoin('statuses as s', 't.status_id', 's.status_id')
      .where('t.ticket_id', payload.ticketId)
      .first();

    if (!ticket || !ticket.company_email) {
      logger.warn('Could not send ticket closed email - missing ticket or company email:', {
        eventId: event.id,
        ticketId: payload.ticketId
      });
      return;
    }

    await sendEventEmail({
      tenantId,
      to: ticket.company_email,
      subject: `Ticket Closed: ${ticket.title}`,
      template: 'ticket-closed',
      context: {
        ticket: {
          id: ticket.ticket_number,
          title: ticket.title,
          priority: ticket.priority_name || 'Unknown',
          status: ticket.status_name || 'Unknown',
          changes: await formatChanges(db, payload.changes || {}),
          closedBy: payload.userId,
          resolution: ticket.resolution || '',
          url: `/tickets/${ticket.ticket_number}`
        }
      }
    });

  } catch (error) {
    logger.error('Error handling ticket closed event:', {
      error,
      eventId: event.id,
      ticketId: payload.ticketId
    });
    throw error;
  }
}

/**
 * Handle all ticket events
 */
async function handleTicketEvent(event: BaseEvent): Promise<void> {
  console.log('[TicketEmailSubscriber] Handling ticket event:', {
    eventId: event.id,
    eventType: event.eventType,
    timestamp: event.timestamp
  });

  const eventSchema = EventSchemas[event.eventType];
  if (!eventSchema) {
    logger.warn('[TicketEmailSubscriber] Unknown event type:', {
      eventType: event.eventType,
      eventId: event.id
    });
    return;
  }

  const validatedEvent = eventSchema.parse(event);

  switch (event.eventType) {
    case 'TICKET_CREATED':
      await handleTicketCreated(validatedEvent as TicketCreatedEvent);
      break;
    case 'TICKET_UPDATED':
      await handleTicketUpdated(validatedEvent as TicketUpdatedEvent);
      break;
    case 'TICKET_CLOSED':
      await handleTicketClosed(validatedEvent as TicketClosedEvent);
      break;
    default:
      logger.warn('[TicketEmailSubscriber] Unhandled ticket event type:', {
        eventType: event.eventType,
        eventId: event.id
      });
  }
}

/**
 * Register email notification subscriber
 */
export async function registerTicketEmailSubscriber(): Promise<void> {
  try {
    console.log('[TicketEmailSubscriber] Starting registration');
    
    // Subscribe to all ticket events with a single handler
    const ticketEventTypes: EventType[] = [
      'TICKET_CREATED',
      'TICKET_UPDATED',
      'TICKET_CLOSED'
    ];

    for (const eventType of ticketEventTypes) {
      await getEventBus().subscribe(eventType, handleTicketEvent);
      console.log(`[TicketEmailSubscriber] Successfully subscribed to ${eventType} events`);
    }

    console.log('[TicketEmailSubscriber] Registered handler for all ticket events');
  } catch (error) {
    logger.error('Failed to register email notification subscribers:', error);
    throw error;
  }
}

/**
 * Unregister email notification subscriber
 */
export async function unregisterTicketEmailSubscriber(): Promise<void> {
  try {
    const ticketEventTypes: EventType[] = [
      'TICKET_CREATED',
      'TICKET_UPDATED',
      'TICKET_CLOSED'
    ];

    for (const eventType of ticketEventTypes) {
      await getEventBus().unsubscribe(eventType, handleTicketEvent);
    }

    logger.info('[TicketEmailSubscriber] Successfully unregistered from all ticket events');
  } catch (error) {
    logger.error('Failed to unregister email notification subscribers:', error);
    throw error;
  }
}
