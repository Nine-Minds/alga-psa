import { getEventBus } from '../index';
import { 
  EventType, 
  BaseEvent,
  EventSchemas,
  TicketCreatedEvent,
  TicketUpdatedEvent,
  TicketClosedEvent,
  TicketAssignedEvent,
  TicketCommentAddedEvent
} from '../events';
import { getEmailService } from 'server/src/services/emailService';
import { sendEventEmail } from '../../notifications/sendEventEmail';
import logger from '@shared/core/logger';
import { createTenantKnex } from '../../db';
import { getSecret } from '../../utils/getSecret';

/**
 * Format changes record into a readable string
 */
async function formatChanges(db: any, changes: Record<string, unknown>, tenantId: string): Promise<string> {
  const formattedChanges = await Promise.all(
    Object.entries(changes).map(async ([field, value]): Promise<string> => {
      // Handle different types of values
      if (typeof value === 'object' && value !== null) {
        const { from, to } = value as { from?: unknown; to?: unknown };
        if (from !== undefined && to !== undefined) {
          const fromValue = await resolveValue(db, field, from, tenantId);
          const toValue = await resolveValue(db, field, to, tenantId);
          return `${formatFieldName(field)}: ${fromValue} → ${toValue}`;
        }
      }
      const resolvedValue = await resolveValue(db, field, value, tenantId);
      return `${formatFieldName(field)}: ${resolvedValue}`;
    })
  );
  return formattedChanges.join('\n');
}

/**
 * Resolve field values to human-readable names
 */
async function resolveValue(db: any, field: string, value: unknown, tenantId: string): Promise<string> {
  if (value === null || value === undefined) {
    return 'None';
  }

  // Handle special fields that need resolution
  switch (field) {
    case 'status_id': {
      const status = await db('statuses')
        .where({ status_id: value, tenant: tenantId })
        .first();
      return status?.name || String(value);
    }

    case 'updated_by':
    case 'assigned_to':
    case 'closed_by': {
      const user = await db('users')
        .where({ user_id: value, tenant: tenantId })
        .first();
      return user ? `${user.first_name} ${user.last_name}` : String(value);
    }

    case 'priority_id': {
      const priority = await db('priorities')
        .where({ priority_id: value, tenant: tenantId })
        .first();
      return priority?.priority_name || String(value);
    }

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
    .map((word): string => word.charAt(0).toUpperCase() + word.slice(1))
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
        'co.email as contact_email',
        'p.priority_name',
        's.name as status_name',
        'au.email as assigned_to_email',
        'eb.first_name',
        'eb.last_name'
      )
      .leftJoin('companies as c', function() {
        this.on('t.company_id', 'c.company_id')
            .andOn('t.tenant', 'c.tenant');
      })
      .leftJoin('contacts as co', function() {
        this.on('t.contact_name_id', 'co.contact_name_id')
            .andOn('t.tenant', 'co.tenant');
      })
      .leftJoin('users as au', function() {
        this.on('t.assigned_to', 'au.user_id')
            .andOn('t.tenant', 'au.tenant');
      })
      .leftJoin('users as eb', function() {
        this.on('t.entered_by', 'eb.user_id')
            .andOn('t.tenant', 'eb.tenant');
      })
      .leftJoin('priorities as p', function() {
        this.on('t.priority_id', 'p.priority_id')
            .andOn('t.tenant', 'p.tenant');
      })
      .leftJoin('statuses as s', function() {
        this.on('t.status_id', 's.status_id')
            .andOn('t.tenant', 's.tenant');
      })
      .where('t.ticket_id', payload.ticketId)
      .first();

    if (!ticket) {
      logger.warn('Could not send ticket created email - missing ticket:', {
        eventId: event.id,
        ticketId: payload.ticketId
      });
      return;
    }

    // Send to contact email if available, otherwise company email
    const primaryEmail = ticket.contact_email || ticket.company_email;
    if (!primaryEmail) {
      logger.warn('Could not send ticket created email - missing both contact and company email:', {
        eventId: event.id,
        ticketId: payload.ticketId
      });
      return;
    }

    const emailContext = {
      ticket: {
        id: ticket.ticket_number,
        title: ticket.title,
        description: ticket.attributes?.description || '',
        priority: ticket.priority_name || 'Unknown',
        status: ticket.status_name || 'Unknown',
        createdBy: payload.userId,
        url: `/tickets/${ticket.ticket_number}`
      }
    };

    // Send to primary recipient (contact or company)
    await sendEventEmail({
      tenantId,
      to: primaryEmail,
      subject: `Ticket Created: ${ticket.title}`,
      template: 'ticket-created',
      context: emailContext
    });

    // Send to assigned user if different from primary recipient
    if (ticket.assigned_to_email && ticket.assigned_to_email !== primaryEmail) {
      await sendEventEmail({
        tenantId,
        to: ticket.assigned_to_email,
        subject: `Ticket Created: ${ticket.title}`,
        template: 'ticket-created',
        context: emailContext
      });
    }

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
      .leftJoin('companies as c', function() {
        this.on('t.company_id', 'c.company_id')
            .andOn('t.tenant', 'c.tenant');
      })
      .leftJoin('priorities as p', function() {
        this.on('t.priority_id', 'p.priority_id')
            .andOn('t.tenant', 'p.tenant');
      })
      .leftJoin('statuses as s', function() {
        this.on('t.status_id', 's.status_id')
            .andOn('t.tenant', 's.tenant');
      })
      .where('t.ticket_id', payload.ticketId)
      .first();

    if (!ticket) {
      console.warn('[EmailSubscriber] Could not find ticket:', {
        eventId: event.id,
        ticketId: payload.ticketId
      });
      return;
    }

    // Send to contact email if available, otherwise company email
    const primaryEmail = ticket.contact_email || ticket.company_email;
    if (!primaryEmail) {
      console.warn('[EmailSubscriber] Ticket found but missing both contact and company email:', {
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
      primaryEmail,
      status: ticket.status_name
    });

    // Format changes with database lookups
    const formattedChanges = await formatChanges(db, payload.changes || {}, tenantId);

    // Get updater's name
    const updater = await db('users')
      .where({ user_id: payload.userId, tenant: tenantId })
      .first();

    const emailContext = {
      ticket: {
        id: ticket.ticket_number,
        title: ticket.title,
        priority: ticket.priority_name || 'Unknown',
        status: ticket.status_name || 'Unknown',
        changes: formattedChanges,
        updatedBy: updater ? `${updater.first_name} ${updater.last_name}` : payload.userId,
        url: `/tickets/${ticket.ticket_number}`
      }
    };

    // Send to primary recipient (contact or company)
    await sendEventEmail({
      tenantId,
      to: primaryEmail,
      subject: `Ticket Updated: ${ticket.title}`,
      template: 'ticket-updated',
      context: emailContext
    });

    // Send to assigned user if different from primary recipient
    if (ticket.assigned_to_email && ticket.assigned_to_email !== primaryEmail) {
      await sendEventEmail({
        tenantId,
        to: ticket.assigned_to_email,
        subject: `Ticket Updated: ${ticket.title}`,
        template: 'ticket-updated',
        context: emailContext
      });
    }

    // Get and notify all additional resources
    const additionalResources = await db('ticket_resources as tr')
      .select('u.email as email')
      .leftJoin('users as u', function() {
        this.on('tr.additional_user_id', 'u.user_id')
            .andOn('tr.tenant', 'u.tenant');
      })
      .where({
        'tr.ticket_id': payload.ticketId,
        'tr.tenant': tenantId
      });

    // Send to all additional resources
    for (const resource of additionalResources) {
      if (resource.email) {
        await sendEventEmail({
          tenantId,
          to: resource.email,
          subject: `Ticket Updated: ${ticket.title}`,
          template: 'ticket-updated',
          context: emailContext
        });
      }
    }

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
async function handleTicketAssigned(event: TicketAssignedEvent): Promise<void> {
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
        's.name as status_name',
        'u.email as assigned_to_email'
      )
      .leftJoin('companies as c', function() {
        this.on('t.company_id', 'c.company_id')
            .andOn('t.tenant', 'c.tenant');
      })
      .leftJoin('priorities as p', function() {
        this.on('t.priority_id', 'p.priority_id')
            .andOn('t.tenant', 'p.tenant');
      })
      .leftJoin('statuses as s', function() {
        this.on('t.status_id', 's.status_id')
            .andOn('t.tenant', 's.tenant');
      })
      .leftJoin('users as u', function() {
        this.on('t.assigned_to', 'u.user_id')
            .andOn('t.tenant', 'u.tenant');
      })
      .where('t.ticket_id', payload.ticketId)
      .first();

    if (!ticket) {
      logger.warn('Could not send ticket assigned email - missing ticket:', {
        eventId: event.id,
        ticketId: payload.ticketId
      });
      return;
    }

    // Send to assigned user
    if (ticket.assigned_to_email) {
      await sendEventEmail({
        tenantId,
        to: ticket.assigned_to_email,
        subject: `You have been assigned to ticket: ${ticket.title}`,
        template: 'ticket-assigned',
        context: {
          ticket: {
            id: ticket.ticket_number,
            title: ticket.title,
            priority: ticket.priority_name || 'Unknown',
            status: ticket.status_name || 'Unknown',
            assignedBy: await db('users')
              .where({ user_id: payload.userId, tenant: tenantId })
              .first()
              .then(user => user ? `${user.first_name} ${user.last_name}` : 'System'),
            url: `/tickets/${ticket.ticket_number}`
          }
        }
      });
    }

    // Get all additional resources
    const additionalResources = await db('ticket_resources as tr')
      .select('u.email as email')
      .leftJoin('users as u', function() {
        this.on('tr.additional_user_id', 'u.user_id')
            .andOn('tr.tenant', 'u.tenant');
      })
      .where({
        'tr.ticket_id': payload.ticketId,
        'tr.tenant': tenantId
      });

    // Send to all additional resources
    for (const resource of additionalResources) {
      if (resource.email) {
        await sendEventEmail({
          tenantId,
          to: resource.email,
          subject: `You have been added as additional resource to ticket: ${ticket.title}`,
          template: 'ticket-assigned',
          context: {
            ticket: {
              id: ticket.ticket_number,
              title: ticket.title,
              priority: ticket.priority_name || 'Unknown',
              status: ticket.status_name || 'Unknown',
              assignedBy: payload.userId,
              url: `/tickets/${ticket.ticket_number}`
            }
          }
        });
      }
    }

  } catch (error) {
    logger.error('Error handling ticket assigned event:', {
      error,
      eventId: event.id,
      ticketId: payload.ticketId
    });
    throw error;
  }
}

async function handleTicketCommentAdded(event: TicketCommentAddedEvent): Promise<void> {
  const { payload } = event;
  const { tenantId } = payload;
  
  try {
    const { knex: db } = await createTenantKnex();
    
    // Get ticket details with assigned user, company and contact emails
    const ticket = await db('tickets as t')
      .select(
        't.*',
        'u.email as assigned_to_email',
        'c.email as company_email',
        'co.email as contact_email'
      )
      .leftJoin('users as u', function() {
        this.on('t.assigned_to', 'u.user_id')
            .andOn('t.tenant', 'u.tenant');
      })
      .leftJoin('companies as c', function() {
        this.on('t.company_id', 'c.company_id')
            .andOn('t.tenant', 'c.tenant');
      })
      .leftJoin('contacts as co', function() {
        this.on('t.contact_name_id', 'co.contact_name_id')
            .andOn('t.tenant', 'co.tenant');
      })
      .where('t.ticket_id', payload.ticketId)
      .first();

    if (!ticket) {
      logger.warn('Could not send ticket comment email - missing ticket:', {
        eventId: event.id,
        ticketId: payload.ticketId
      });
      return;
    }

    // Get all additional resources
    const additionalResources = await db('ticket_resources as tr')
      .select('u.email as email')
      .leftJoin('users as u', function() {
        this.on('tr.additional_user_id', 'u.user_id')
            .andOn('tr.tenant', 'u.tenant');
      })
      .where({
        'tr.ticket_id': payload.ticketId,
        'tr.tenant': tenantId
      });

    // Determine primary email (contact first, then company)
    const primaryEmail = ticket.contact_email || ticket.company_email;

    // Send to primary email if available
    if (primaryEmail) {
      await sendEventEmail({
        tenantId,
        to: primaryEmail,
        subject: `New Comment on Ticket: ${ticket.title}`,
        template: 'ticket-comment-added',
        context: {
          ticket: {
            id: ticket.ticket_number,
            title: ticket.title,
            url: `/tickets/${ticket.ticket_number}`
          },
          comment: payload.comment
        }
      });
    }

    // Send to assigned user if different from primary email
    if (ticket.assigned_to_email && ticket.assigned_to_email !== primaryEmail) {
      await sendEventEmail({
        tenantId,
        to: ticket.assigned_to_email,
        subject: `New Comment on Ticket: ${ticket.title}`,
        template: 'ticket-comment-added',
        context: {
          ticket: {
            id: ticket.ticket_number,
            title: ticket.title,
            url: `/tickets/${ticket.ticket_number}`
          },
          comment: payload.comment
        }
      });
    }

    // Send to all additional resources
    for (const resource of additionalResources) {
      if (resource.email) {
        await sendEventEmail({
          tenantId,
          to: resource.email,
          subject: `New Comment on Ticket: ${ticket.title}`,
          template: 'ticket-comment-added',
          context: {
            ticket: {
              id: ticket.ticket_number,
              title: ticket.title,
              url: `/tickets/${ticket.ticket_number}`
            },
            comment: payload.comment
          }
        });
      }
    }

  } catch (error) {
    logger.error('Error handling ticket comment added event:', {
      error,
      eventId: event.id,
      ticketId: payload.ticketId
    });
    throw error;
  }
}

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
      .leftJoin('companies as c', function() {
        this.on('t.company_id', 'c.company_id')
            .andOn('t.tenant', 'c.tenant');
      })
      .leftJoin('priorities as p', function() {
        this.on('t.priority_id', 'p.priority_id')
            .andOn('t.tenant', 'p.tenant');
      })
      .leftJoin('statuses as s', function() {
        this.on('t.status_id', 's.status_id')
            .andOn('t.tenant', 's.tenant');
      })
      .where('t.ticket_id', payload.ticketId)
      .first();

    if (!ticket || !ticket.company_email) {
      logger.warn('Could not send ticket closed email - missing ticket or company email:', {
        eventId: event.id,
        ticketId: payload.ticketId
      });
      return;
    }

    const emailContext = {
      ticket: {
        id: ticket.ticket_number,
        title: ticket.title,
        priority: ticket.priority_name || 'Unknown',
        status: ticket.status_name || 'Unknown',
        changes: await formatChanges(db, payload.changes || {}, tenantId),
        closedBy: payload.userId,
        resolution: ticket.resolution || '',
        url: `/tickets/${ticket.ticket_number}`
      }
    };

    // Send to company email
    await sendEventEmail({
      tenantId,
      to: ticket.company_email,
      subject: `Ticket Closed: ${ticket.title}`,
      template: 'ticket-closed',
      context: emailContext
    });

    // Get and notify all additional resources
    const additionalResources = await db('ticket_resources as tr')
      .select('u.email as email')
      .leftJoin('users as u', function() {
        this.on('tr.additional_user_id', 'u.user_id')
            .andOn('tr.tenant', 'u.tenant');
      })
      .where({
        'tr.ticket_id': payload.ticketId,
        'tr.tenant': tenantId
      });

    // Send to all additional resources
    for (const resource of additionalResources) {
      if (resource.email) {
        await sendEventEmail({
          tenantId,
          to: resource.email,
          subject: `Ticket Closed: ${ticket.title}`,
          template: 'ticket-closed',
          context: emailContext
        });
      }
    }

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
    case 'TICKET_ASSIGNED':
      await handleTicketAssigned(validatedEvent as TicketAssignedEvent);
      break;
    case 'TICKET_COMMENT_ADDED':
      await handleTicketCommentAdded(validatedEvent as TicketCommentAddedEvent);
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
      'TICKET_CLOSED',
      'TICKET_ASSIGNED',
      'TICKET_COMMENT_ADDED'
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
