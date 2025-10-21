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
import { sendEventEmail } from '../../notifications/sendEventEmail';
import logger from '@shared/core/logger';
import { getConnection } from '../../db/db';
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
    const db = await getConnection(tenantId);
    
    // Get ticket details
    console.log('[EmailSubscriber] Fetching ticket details:', { ticketId: payload.ticketId });
    const ticket = await db('tickets as t')
      .select(
        't.*',
        'dcl.email as client_email',
        'c.client_name',
        'co.email as contact_email',
        'co.full_name as contact_name',
        'co.phone_number as contact_phone',
        'p.priority_name',
        'p.color as priority_color',
        's.name as status_name',
        'au.email as assigned_to_email',
        db.raw("TRIM(CONCAT(COALESCE(au.first_name, ''), ' ', COALESCE(au.last_name, ''))) as assigned_to_name"),
        db.raw("TRIM(CONCAT(COALESCE(eb.first_name, ''), ' ', COALESCE(eb.last_name, ''))) as created_by_name"),
        'ch.board_name',
        'cat.category_name',
        'subcat.category_name as subcategory_name',
        'cl.location_name',
        'cl.address_line1',
        'cl.address_line2',
        'cl.city',
        'cl.state_province',
        'cl.postal_code',
        'cl.country_code'
      )
      .leftJoin('clients as c', function() {
        this.on('t.client_id', 'c.client_id')
            .andOn('t.tenant', 'c.tenant');
      })
      .leftJoin('client_locations as dcl', function() {
        this.on('dcl.client_id', '=', 't.client_id')
            .andOn('dcl.tenant', '=', 't.tenant')
            .andOn('dcl.is_default', '=', db.raw('true'))
            .andOn('dcl.is_active', '=', db.raw('true'));
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
      .leftJoin('boards as ch', function() {
        this.on('t.board_id', 'ch.board_id')
            .andOn('t.tenant', 'ch.tenant');
      })
      .leftJoin('categories as cat', function() {
        this.on('t.category_id', 'cat.category_id')
            .andOn('t.tenant', 'cat.tenant');
      })
      .leftJoin('categories as subcat', function() {
        this.on('t.subcategory_id', 'subcat.category_id')
            .andOn('t.tenant', 'subcat.tenant');
      })
      .leftJoin('client_locations as cl', function() {
        this.on('t.location_id', 'cl.location_id')
            .andOn('t.tenant', 'cl.tenant');
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

    const safeString = (value?: unknown) => {
      if (typeof value === 'string') {
        return value.trim();
      }
      if (value === null || value === undefined) {
        return '';
      }
      return String(value).trim();
    };

    // Send to contact email if available, otherwise client email
    const primaryEmail = safeString(ticket.contact_email) || safeString(ticket.client_email);
    const assignedEmail = safeString(ticket.assigned_to_email);

    if (!primaryEmail && !assignedEmail) {
      logger.warn('Could not send ticket created email - missing contact, client, and assigned user emails:', {
        eventId: event.id,
        ticketId: payload.ticketId
      });
      return;
    }

    if (!primaryEmail) {
      logger.warn('Ticket created email missing contact and client emails, falling back to other recipients only:', {
        eventId: event.id,
        ticketId: payload.ticketId
      });
    }

    const formatDateTime = (value?: Date | string | null) => {
      if (!value) {
        return 'Not available';
      }
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) {
        return typeof value === 'string' ? value : 'Not available';
      }
      return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: '2-digit',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short'
      }).format(date);
    };

    const priorityName = safeString(ticket.priority_name) || 'Unspecified';
    const statusName = safeString(ticket.status_name) || 'Unknown';
    const metaLine = `Ticket #${ticket.ticket_number} · ${priorityName} Priority · ${statusName}`;
    const priorityColor = safeString(ticket.priority_color) || '#8A4DEA';

    const clientName = safeString(ticket.client_name) || 'Unassigned Client';

    const createdAt = formatDateTime(ticket.entered_at as string | Date | null);
    const createdByName = safeString(ticket.created_by_name) || payload.userId || 'System';
    const createdDetails = `${createdAt} · ${createdByName}`;

    const assignedToName = safeString(ticket.assigned_to_name) || 'Unassigned';
    const rawAssignedEmail = assignedEmail;
    const assignedToEmailRaw = assignedToName === 'Unassigned' ? '' : rawAssignedEmail;
    const assignedToEmailDisplay = assignedToName === 'Unassigned'
      ? 'Not assigned'
      : assignedToEmailRaw || 'Not provided';
    const assignedDetails = assignedToName === 'Unassigned'
      ? 'Unassigned'
      : assignedToEmailRaw
        ? `${assignedToName} (${assignedToEmailRaw})`
        : assignedToName;

    const requesterName = safeString(ticket.contact_name) || 'Not specified';
    const requesterEmail = safeString(ticket.contact_email) || 'Not provided';
    const requesterPhone = safeString(ticket.contact_phone) || 'Not provided';
    const requesterContactParts: string[] = [];
    if (requesterEmail && requesterEmail !== 'Not provided') {
      requesterContactParts.push(requesterEmail);
    }
    if (requesterPhone && requesterPhone !== 'Not provided') {
      requesterContactParts.push(requesterPhone);
    }
    const requesterDetailsParts: string[] = [];
    if (requesterName && requesterName !== 'Not specified') {
      requesterDetailsParts.push(requesterName);
    }
    requesterDetailsParts.push(...requesterContactParts);
    const requesterContact = requesterContactParts.length > 0 ? requesterContactParts.join(' · ') : 'Not provided';
    const requesterDetails = requesterDetailsParts.length > 0 ? requesterDetailsParts.join(' · ') : 'Not specified';

    const boardName = safeString(ticket.board_name) || 'Not specified';
    const categoryName = safeString(ticket.category_name);
    const subcategoryName = safeString(ticket.subcategory_name);
    const categoryDetails = categoryName && subcategoryName
      ? `${categoryName} / ${subcategoryName}`
      : categoryName || subcategoryName || 'Not categorized';

    const locationSegments: string[] = [];
    const locationName = safeString(ticket.location_name);
    if (locationName) {
      locationSegments.push(locationName);
    }
    const addressLines = [safeString(ticket.address_line1), safeString(ticket.address_line2)].filter(Boolean);
    const cityState = [safeString(ticket.city), safeString(ticket.state_province)].filter(Boolean).join(', ');
    const postalCountry = [safeString(ticket.postal_code), safeString(ticket.country_code)].filter(Boolean).join(' ');
    const locationDetailsParts = [...addressLines];
    if (cityState) {
      locationDetailsParts.push(cityState);
    }
    if (postalCountry) {
      locationDetailsParts.push(postalCountry);
    }
    if (locationDetailsParts.length > 0) {
      locationSegments.push(locationDetailsParts.join(' · '));
    }
    const locationSummary = locationSegments.length > 0 ? locationSegments.join(' • ') : 'Not specified';

    let rawDescription = '';
    if (ticket.attributes && typeof ticket.attributes === 'object' && 'description' in ticket.attributes) {
      rawDescription = safeString((ticket.attributes as Record<string, unknown>).description);
    }
    if (!rawDescription && 'description' in ticket) {
      rawDescription = safeString((ticket as Record<string, unknown>).description);
    }
    const description = rawDescription || 'No description provided.';

    const requesterDetailsForText = requesterDetails;
    const assignedDetailsForText = assignedDetails;

    const emailContext = {
      ticket: {
        id: ticket.ticket_number,
        title: ticket.title,
        description,
        priority: priorityName,
        priorityColor,
        status: statusName,
        createdAt,
        createdBy: createdByName,
        createdDetails,
        assignedToName,
        assignedToEmail: assignedToEmailDisplay,
        assignedDetails: assignedDetailsForText,
        requesterName,
        requesterEmail,
        requesterPhone,
        requesterContact,
        requesterDetails: requesterDetailsForText,
        board: boardName,
        channel: boardName, // Alias for template compatibility
        category: categoryName || 'Not categorized',
        subcategory: subcategoryName || 'Not specified',
        categoryDetails,
        locationSummary,
        clientName,
        companyName: clientName, // Alias for template compatibility
        metaLine,
        url: `/tickets/${ticket.ticket_number}`
      }
    };

    const replyContext = {
      ticketId: ticket.ticket_id || payload.ticketId,
      threadId: ticket.email_metadata?.threadId
    };
    const emailSubject = `New Ticket • ${ticket.title} (${priorityName})`;

    // Send to primary recipient (contact or client)
    if (primaryEmail) {
      await sendEventEmail({
        tenantId,
        to: primaryEmail,
        subject: emailSubject,
        template: 'ticket-created',
        context: emailContext,
        replyContext
      });
    }

    // Send to assigned user if different from primary recipient
    if (assignedEmail && assignedEmail !== primaryEmail) {
      await sendEventEmail({
        tenantId,
        to: assignedEmail,
        subject: emailSubject,
        template: 'ticket-created',
        context: emailContext,
        replyContext
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
    const db = await getConnection(tenantId);
    
    console.log('[EmailSubscriber] Fetching ticket details from database:', {
      ticketId: payload.ticketId,
      tenantId
    });
    // Get ticket details
    const ticket = await db('tickets as t')
      .select(
        't.*',
        'dcl.email as client_email',
        'p.priority_name',
        's.name as status_name'
      )
      .leftJoin('clients as c', function() {
        this.on('t.client_id', 'c.client_id')
            .andOn('t.tenant', 'c.tenant');
      })
      .leftJoin('client_locations as dcl', function() {
        this.on('dcl.client_id', '=', 't.client_id')
            .andOn('dcl.tenant', '=', 't.tenant')
            .andOn('dcl.is_default', '=', db.raw('true'))
            .andOn('dcl.is_active', '=', db.raw('true'));
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

    // Send to contact email if available, otherwise client email
    const primaryEmail = ticket.contact_email || ticket.client_email;
    if (!primaryEmail) {
      console.warn('[EmailSubscriber] Ticket found but missing both contact and client email:', {
        eventId: event.id,
        ticketId: payload.ticketId,
        clientId: ticket.client_id
      });
      return;
    }

    console.log('[EmailSubscriber] Found ticket:', {
      ticketId: ticket.ticket_id,
      title: ticket.title,
      clientId: ticket.client_id,
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

    // Send to primary recipient (contact or client)
    await sendEventEmail({
      tenantId,
      to: primaryEmail,
      subject: `Ticket Updated: ${ticket.title}`,
      template: 'ticket-updated',
      context: emailContext,
      replyContext: {
        ticketId: ticket.ticket_id || payload.ticketId,
        threadId: ticket.email_metadata?.threadId
      }
    });

    // Send to assigned user if different from primary recipient
    if (ticket.assigned_to_email && ticket.assigned_to_email !== primaryEmail) {
      await sendEventEmail({
        tenantId,
        to: ticket.assigned_to_email,
        subject: `Ticket Updated: ${ticket.title}`,
        template: 'ticket-updated',
        context: emailContext,
        replyContext: {
          ticketId: ticket.ticket_id || payload.ticketId,
          threadId: ticket.email_metadata?.threadId
        }
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
          context: emailContext,
          replyContext: {
            ticketId: ticket.ticket_id || payload.ticketId,
            threadId: ticket.email_metadata?.threadId
          }
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
    const db = await getConnection(tenantId);
    
    // Get ticket details
    const ticket = await db('tickets as t')
      .select(
        't.*',
        'dcl.email as client_email',
        'p.priority_name',
        's.name as status_name',
        'u.email as assigned_to_email',
        'co.email as contact_email'
      )
      .leftJoin('clients as c', function() {
        this.on('t.client_id', 'c.client_id')
            .andOn('t.tenant', 'c.tenant');
      })
      .leftJoin('client_locations as dcl', function() {
        this.on('dcl.client_id', '=', 't.client_id')
            .andOn('dcl.tenant', '=', 't.tenant')
            .andOn('dcl.is_default', '=', db.raw('true'))
            .andOn('dcl.is_active', '=', db.raw('true'));
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
      .leftJoin('contacts as co', function() {
        this.on('t.contact_name_id', 'co.contact_name_id')
            .andOn('t.tenant', 'co.tenant');
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

    const assignerName = await db('users')
      .where({ user_id: payload.userId, tenant: tenantId })
      .first()
      .then(user => user ? `${user.first_name} ${user.last_name}` : 'System');

    const emailContext = {
      ticket: {
        id: ticket.ticket_number,
        title: ticket.title,
        priority: ticket.priority_name || 'Unknown',
        status: ticket.status_name || 'Unknown',
        assignedBy: assignerName,
        url: `/tickets/${ticket.ticket_number}`
      }
    };

    const replyContext = {
      ticketId: ticket.ticket_id || payload.ticketId,
      threadId: ticket.email_metadata?.threadId
    };

    // Send to assigned user
    if (ticket.assigned_to_email) {
      await sendEventEmail({
        tenantId,
        to: ticket.assigned_to_email,
        subject: `You have been assigned to ticket: ${ticket.title}`,
        template: 'ticket-assigned',
        context: emailContext,
        replyContext
      });
    }

    const locationEmail = ticket.client_email;
    const contactEmail = ticket.contact_email;

    // Notify the client's default location email
    if (locationEmail) {
      await sendEventEmail({
        tenantId,
        to: locationEmail,
        subject: `Ticket Assigned: ${ticket.title}`,
        template: 'ticket-assigned',
        context: emailContext,
        replyContext
      });
    }

    // Notify the ticket contact when different from the default location email
    if (contactEmail && contactEmail !== locationEmail) {
      await sendEventEmail({
        tenantId,
        to: contactEmail,
        subject: `Ticket Assigned: ${ticket.title}`,
        template: 'ticket-assigned',
        context: emailContext,
        replyContext
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
          context: emailContext,
          replyContext
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
    const db = await getConnection(tenantId);
    
    // Get ticket details with assigned user, client and contact emails
    const ticket = await db('tickets as t')
      .select(
        't.*',
        'u.email as assigned_to_email',
        'dcl.email as client_email',
        'co.email as contact_email'
      )
      .leftJoin('users as u', function() {
        this.on('t.assigned_to', 'u.user_id')
            .andOn('t.tenant', 'u.tenant');
      })
      .leftJoin('clients as c', function() {
        this.on('t.client_id', 'c.client_id')
            .andOn('t.tenant', 'c.tenant');
      })
      .leftJoin('client_locations as dcl', function() {
        this.on('dcl.client_id', '=', 't.client_id')
            .andOn('dcl.tenant', '=', 't.tenant')
            .andOn('dcl.is_default', '=', db.raw('true'))
            .andOn('dcl.is_active', '=', db.raw('true'));
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

    // Determine primary email (contact first, then client)
    const primaryEmail = ticket.contact_email || ticket.client_email;

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
        },
        replyContext: {
          ticketId: ticket.ticket_id || payload.ticketId,
          commentId: payload.comment?.id,
          threadId: ticket.email_metadata?.threadId
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
        },
        replyContext: {
          ticketId: ticket.ticket_id || payload.ticketId,
          commentId: payload.comment?.id,
          threadId: ticket.email_metadata?.threadId
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
          },
          replyContext: {
            ticketId: ticket.ticket_id || payload.ticketId,
            commentId: payload.comment?.id,
            threadId: ticket.email_metadata?.threadId
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
    const db = await getConnection(tenantId);
    
    // Get ticket details
    const ticket = await db('tickets as t')
      .select(
        't.*',
        'dcl.email as client_email',
        'p.priority_name',
        's.name as status_name'
      )
      .leftJoin('clients as c', function() {
        this.on('t.client_id', 'c.client_id')
            .andOn('t.tenant', 'c.tenant');
      })
      .leftJoin('client_locations as dcl', function() {
        this.on('dcl.client_id', '=', 't.client_id')
            .andOn('dcl.tenant', '=', 't.tenant')
            .andOn('dcl.is_default', '=', db.raw('true'))
            .andOn('dcl.is_active', '=', db.raw('true'));
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

    if (!ticket || !ticket.client_email) {
      logger.warn('Could not send ticket closed email - missing ticket or client email:', {
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

    // Send to client email
    await sendEventEmail({
      tenantId,
      to: ticket.client_email,
      subject: `Ticket Closed: ${ticket.title}`,
      template: 'ticket-closed',
      context: emailContext,
      replyContext: {
        ticketId: ticket.ticket_id || payload.ticketId,
        threadId: ticket.email_metadata?.threadId
      }
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
          context: emailContext,
          replyContext: {
            ticketId: ticket.ticket_id || payload.ticketId,
            threadId: ticket.email_metadata?.threadId
          }
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
