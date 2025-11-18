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
import { sendEventEmail, SendEmailParams } from '../../notifications/sendEventEmail';
import logger from '@shared/core/logger';
import { runWithTenant } from '../../db';
import { getConnection } from '../../db/db';
import { getSecret } from '../../utils/getSecret';
import { formatBlockNoteContent } from '../../utils/blocknoteUtils';
import { getEmailEventChannel } from '@/lib/notifications/emailChannel';
import type { Knex } from 'knex';
import { getPortalDomain } from 'server/src/models/PortalDomainModel';
import { buildTenantPortalSlug } from '@shared/utils/tenantSlug';

/**
 * Get the base URL from NEXTAUTH_URL environment variable
 */
function getBaseUrl(): string {
  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

function normalizeHost(host: string): string {
  return host.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

async function resolveTicketLinks(
  knex: Knex,
  tenantId: string,
  ticketId: string,
  ticketNumber?: string | null
): Promise<{ internalUrl: string; portalUrl: string }> {
  const internalBase = getBaseUrl();
  const internalUrl = `${internalBase}/msp/tickets/${ticketId}`;

  let portalHost: string | null = null;
  let isActiveVanityDomain = false;

  try {
    const portalDomain = await getPortalDomain(knex, tenantId);
    if (portalDomain) {
      // Only use custom domain if it's active and ready to serve traffic
      if (portalDomain.status === 'active' && portalDomain.domain) {
        portalHost = portalDomain.domain;
        isActiveVanityDomain = true;
      } else if (portalDomain.canonicalHost) {
        // Use canonical host if:
        // - No custom domain is configured, OR
        // - Custom domain exists but is not yet active
        portalHost = portalDomain.canonicalHost;
        isActiveVanityDomain = false;
      }
    }
  } catch (error) {
    logger.warn('[TicketEmailSubscriber] Failed to resolve portal domain for ticket link', {
      tenantId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }

  const tenantSlug = buildTenantPortalSlug(tenantId);
  const baseParams = new URLSearchParams();
  // Always use ticket UUID for the URL path
  const clientPortalPath = `/client-portal/tickets/${ticketId}`;
  let portalUrl: string;

  if (portalHost) {
    const sanitizedHost = normalizeHost(portalHost);

    if (isActiveVanityDomain) {
      // Active vanity domains don't need tenant parameter (they use OTT/domain-based detection)
      portalUrl = `https://${sanitizedHost}${clientPortalPath}${baseParams.toString() ? '?' + baseParams.toString() : ''}`;
    } else {
      // Canonical host always needs tenant parameter for authentication
      baseParams.set('tenant', tenantSlug);
      portalUrl = `https://${sanitizedHost}${clientPortalPath}?${baseParams.toString()}`;
    }
  } else {
    // Fallback to canonical host with tenant parameter
    const fallbackBase = internalBase.endsWith('/') ? internalBase.slice(0, -1) : internalBase;
    baseParams.set('tenant', tenantSlug);
    portalUrl = `${fallbackBase}${clientPortalPath}?${baseParams.toString()}`;
  }

  return { internalUrl, portalUrl };
}

/**
 * Wrapper function that checks notification preferences before sending email
 * @param params - Same params as sendEventEmail
 * @param subtypeName - Name of the notification subtype (e.g., "Ticket Created")
 * @param recipientUserId - Optional user ID for preference checking (only for internal users)
 */
async function sendNotificationIfEnabled(
  params: SendEmailParams,
  subtypeName: string,
  recipientUserId?: string
): Promise<void> {
  try {
    await runWithTenant(params.tenantId, async () => {
      const knex = await getConnection(params.tenantId);

    // 1. Check global notification settings
    const settings = await knex('notification_settings')
      .where({ tenant: params.tenantId })
      .first();

    if (settings && !settings.is_enabled) {
      logger.info('[TicketEmailSubscriber] Notifications disabled globally for tenant:', {
        tenantId: params.tenantId,
        recipient: params.to,
        subtypeName
      });
      return;
    }

    // 2. Look up notification subtype ID
    const subtype = await knex('notification_subtypes')
      .where({ name: subtypeName })
      .first();

    if (!subtype) {
      logger.warn('[TicketEmailSubscriber] Notification subtype not found:', {
        subtypeName,
        recipient: params.to
      });
      // Continue anyway to avoid breaking existing functionality
      await sendEventEmail(params);
      return;
    }

    // 3. Check if subtype is enabled
    if (!subtype.is_enabled) {
      logger.info('[TicketEmailSubscriber] Notification subtype disabled:', {
        subtypeName,
        recipient: params.to,
        tenantId: params.tenantId
      });
      return;
    }

    // 4. For internal users, check user preferences and rate limiting
    if (recipientUserId) {
      // Check user preferences
      const preference = await knex('user_notification_preferences')
        .where({
          tenant: params.tenantId,
          user_id: recipientUserId,
          subtype_id: subtype.id
        })
        .first();

      if (preference && !preference.is_enabled) {
        logger.info('[TicketEmailSubscriber] User has opted out of this notification type:', {
          userId: recipientUserId,
          subtypeName,
          recipient: params.to
        });
        return;
      }

      // Check rate limiting (only if settings exist)
      if (settings) {
        const recentCount = await knex('notification_logs')
          .where({
            tenant: params.tenantId,
            user_id: recipientUserId
          })
          .where('created_at', '>', new Date(Date.now() - 60000))
          .count('id')
          .first()
          .then((result): number => Number(result?.count));

        if (recentCount >= settings.rate_limit_per_minute) {
          logger.warn('[TicketEmailSubscriber] Rate limit exceeded for user:', {
            userId: recipientUserId,
            recentCount,
            limit: settings.rate_limit_per_minute,
            recipient: params.to
          });
          return;
        }
      }
    }

    // 5. All checks passed - send the email
    await sendEventEmail(params);

    // 6. Log the notification (only for internal users with userId)
    if (recipientUserId && subtype) {
      try {
        await knex('notification_logs').insert({
          tenant: params.tenantId,
          user_id: recipientUserId,
          subtype_id: subtype.id,
          email_address: params.to,
          subject: params.subject,
          status: 'sent'
        });
      } catch (logError) {
        logger.warn('[TicketEmailSubscriber] Failed to log notification:', {
          error: logError instanceof Error ? logError.message : 'Unknown error',
          userId: recipientUserId,
          recipient: params.to
        });
      }
    }
    }); // end runWithTenant

  } catch (error) {
    logger.error('[TicketEmailSubscriber] Error in sendNotificationIfEnabled:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      subtypeName,
      recipient: params.to,
      tenantId: params.tenantId
    });
    throw error;
  }
}

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
      if (value instanceof Date) {
        return value.toISOString();
      }
      if (typeof value === 'boolean') {
        return value ? 'Yes' : 'No';
      }
      if (typeof value === 'string') {
        const formatted = formatBlockNoteContent(value);
        const formattedText = formatted.text?.trim?.();
        if (formattedText) {
          return formattedText;
        }
        return value;
      }
      if (typeof value === 'object') {
        const formatted = formatBlockNoteContent(value);
        const formattedText = formatted.text?.trim?.();
        if (formattedText && formattedText !== JSON.stringify(value)) {
          return formattedText;
        }
        try {
          return JSON.stringify(value);
        } catch {
          return String(value);
        }
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
    const descriptionFormatting = rawDescription ? formatBlockNoteContent(rawDescription) : formatBlockNoteContent('');
    const descriptionText = descriptionFormatting.text || rawDescription;
    const description = descriptionText || 'No description provided.';
    const descriptionHtml = rawDescription ? descriptionFormatting.html : `<p>${description}</p>`;

    const requesterDetailsForText = requesterDetails;
    const assignedDetailsForText = assignedDetails;

    const { internalUrl, portalUrl } = await resolveTicketLinks(db, tenantId, ticket.ticket_id, ticket.ticket_number);

    const baseTicketContext = {
      id: ticket.ticket_number,
      title: ticket.title,
      description,
      descriptionText: description,
      descriptionHtml: descriptionHtml,
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
      category: categoryName || 'Not categorized',
      subcategory: subcategoryName || 'Not specified',
      categoryDetails,
      locationSummary,
      clientName,
      metaLine
    };

    const buildContext = (url: string) => ({
      ticket: {
        ...baseTicketContext,
        url
      }
    });

    const replyContext = {
      ticketId: ticket.ticket_id || payload.ticketId,
      threadId: ticket.email_metadata?.threadId
    };
    const emailSubject = `New Ticket • ${ticket.title} (${priorityName})`;

    // Send to primary recipient (contact or client) - external user, no userId
    if (primaryEmail) {
      await sendNotificationIfEnabled({
        tenantId,
        to: primaryEmail,
        subject: emailSubject,
        template: 'ticket-created',
        context: buildContext(portalUrl),
        replyContext
      }, 'Ticket Created');
    }

    // Send to assigned user if different from primary recipient
    if (assignedEmail && assignedEmail !== primaryEmail) {
      await sendNotificationIfEnabled({
        tenantId,
        to: assignedEmail,
        subject: emailSubject,
        template: 'ticket-created',
        context: buildContext(internalUrl),
        replyContext
      }, 'Ticket Created', ticket.assigned_to);
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
    // Get ticket details with all required fields
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
      console.warn('[EmailSubscriber] Could not find ticket:', {
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

    const assignedToName = safeString(ticket.assigned_to_name) || 'Unassigned';
    const assignedToEmailDisplay = assignedToName === 'Unassigned'
      ? 'Not assigned'
      : assignedEmail || 'Not provided';
    const assignedDetails = assignedToName === 'Unassigned'
      ? 'Unassigned'
      : assignedEmail
        ? `${assignedToName} (${assignedEmail})`
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
    const descriptionFormatting = rawDescription ? formatBlockNoteContent(rawDescription) : formatBlockNoteContent('');
    const descriptionText = descriptionFormatting.text || rawDescription;
    const description = descriptionText || 'No description provided.';

    // Format changes with database lookups
    const formattedChanges = await formatChanges(db, payload.changes || {}, tenantId);

    // Get updater's name
    const updater = await db('users')
      .where({ user_id: payload.userId, tenant: tenantId })
      .first();

    const { internalUrl, portalUrl } = await resolveTicketLinks(db, tenantId, ticket.ticket_id, ticket.ticket_number);

    const baseTicketContext = {
      id: ticket.ticket_number,
      title: ticket.title,
      description,
      priority: priorityName,
      priorityColor,
      status: statusName,
      metaLine,
      clientName,
      assignedToName,
      assignedToEmail: assignedToEmailDisplay,
      assignedDetails,
      requesterName,
      requesterEmail,
      requesterPhone,
      requesterContact,
      requesterDetails,
      board: boardName,
      category: categoryName || 'Not categorized',
      subcategory: subcategoryName || 'Not specified',
      categoryDetails,
      locationSummary,
      changes: formattedChanges,
      updatedBy: updater ? `${updater.first_name} ${updater.last_name}` : payload.userId
    };

    const buildContext = (url: string) => ({
      ticket: {
        ...baseTicketContext,
        url
      }
    });

    // Send to primary recipient (contact or client) - external user, no userId
    await sendNotificationIfEnabled({
      tenantId,
      to: primaryEmail,
      subject: `Ticket Updated: ${ticket.title}`,
      template: 'ticket-updated',
      context: buildContext(portalUrl),
      replyContext: {
        ticketId: ticket.ticket_id || payload.ticketId,
        threadId: ticket.email_metadata?.threadId
      }
    }, 'Ticket Updated');

    // Send to assigned user if different from primary recipient
    if (assignedEmail && assignedEmail !== primaryEmail) {
      await sendNotificationIfEnabled({
      tenantId,
      to: assignedEmail,
      subject: `Ticket Updated: ${ticket.title}`,
      template: 'ticket-updated',
      context: buildContext(internalUrl),
      replyContext: {
        ticketId: ticket.ticket_id || payload.ticketId,
        threadId: ticket.email_metadata?.threadId
      }
    }, 'Ticket Updated', ticket.assigned_to);
    }

    // Get and notify all additional resources
    const additionalResources = await db('ticket_resources as tr')
      .select('u.email as email', 'u.user_id as user_id')
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
        await sendNotificationIfEnabled({
        tenantId,
        to: resource.email,
        subject: `Ticket Updated: ${ticket.title}`,
        template: 'ticket-updated',
        context: buildContext(internalUrl),
        replyContext: {
          ticketId: ticket.ticket_id || payload.ticketId,
          threadId: ticket.email_metadata?.threadId
        }
      }, 'Ticket Updated', resource.user_id);
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

    // Get ticket details with all required fields
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

    const safeString = (value?: unknown) => {
      if (typeof value === 'string') {
        return value.trim();
      }
      if (value === null || value === undefined) {
        return '';
      }
      return String(value).trim();
    };

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

    const assignedToName = safeString(ticket.assigned_to_name) || 'Unassigned';
    const assignedEmail = safeString(ticket.assigned_to_email);
    const assignedToEmailDisplay = assignedToName === 'Unassigned'
      ? 'Not assigned'
      : assignedEmail || 'Not provided';
    const assignedDetails = assignedToName === 'Unassigned'
      ? 'Unassigned'
      : assignedEmail
        ? `${assignedToName} (${assignedEmail})`
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
    const descriptionFormatting = rawDescription ? formatBlockNoteContent(rawDescription) : formatBlockNoteContent('');
    const descriptionText = descriptionFormatting.text || rawDescription;
    const description = descriptionText || 'No description provided.';

    const { internalUrl, portalUrl } = await resolveTicketLinks(db, tenantId, ticket.ticket_id, ticket.ticket_number);

    const baseTicketContext = {
      id: ticket.ticket_number,
      title: ticket.title,
      description,
      priority: priorityName,
      priorityColor,
      status: statusName,
      assignedBy: assignerName,
      assignedToName,
      assignedToEmail: assignedToEmailDisplay,
      assignedDetails,
      requesterName,
      requesterEmail,
      requesterPhone,
      requesterContact,
      requesterDetails,
      board: boardName,
      category: categoryName || 'Not categorized',
      subcategory: subcategoryName || 'Not specified',
      categoryDetails,
      locationSummary,
      clientName,
      metaLine
    };

    const buildContext = (url: string) => ({
      ticket: {
        ...baseTicketContext,
        url
      }
    });

    const replyContext = {
      ticketId: ticket.ticket_id || payload.ticketId,
      threadId: ticket.email_metadata?.threadId
    };

    const sentEmails = new Set<string>();
    const normalizeEmail = (email: string) => email.trim().toLowerCase();
    const sendIfUnique = async (
      params: SendEmailParams,
      subtypeName: string,
      recipientUserId?: string | null
    ) => {
      const email = params.to?.trim();
      if (!email) {
        return;
      }
      const key = normalizeEmail(email);
      if (sentEmails.has(key)) {
        return;
      }
      sentEmails.add(key);
      await sendNotificationIfEnabled(
        params,
        subtypeName,
        recipientUserId ?? undefined
      );
    };

    // Send to assigned user
    if (ticket.assigned_to_email) {
      await sendIfUnique({
        tenantId,
        to: ticket.assigned_to_email,
        subject: `You have been assigned to ticket: ${ticket.title}`,
        template: 'ticket-assigned',
        context: buildContext(internalUrl),
        replyContext
      }, 'Ticket Assigned', ticket.assigned_to);
    }

    const locationEmail = ticket.client_email;
    const contactEmail = ticket.contact_email;

    // Notify the client's default location email - external user, no userId
    if (locationEmail) {
      await sendIfUnique({
        tenantId,
        to: locationEmail,
        subject: `Ticket Assigned: ${ticket.title}`,
        template: 'ticket-assigned',
        context: buildContext(portalUrl),
        replyContext
      }, 'Ticket Assigned');
    }

    // Notify the ticket contact when different from the default location email - external user, no userId
    if (contactEmail) {
      await sendIfUnique({
        tenantId,
        to: contactEmail,
        subject: `Ticket Assigned: ${ticket.title}`,
        template: 'ticket-assigned',
        context: buildContext(portalUrl),
        replyContext
      }, 'Ticket Assigned');
    }

    // Get all additional resources
    const additionalResources = await db('ticket_resources as tr')
      .select('u.email as email', 'u.user_id as user_id')
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
        await sendIfUnique({
          tenantId,
          to: resource.email,
          subject: `You have been added as additional resource to ticket: ${ticket.title}`,
          template: 'ticket-assigned',
          context: buildContext(internalUrl),
          replyContext
        }, 'Ticket Assigned', resource.user_id);
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

    // Get ticket details with all required fields
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
      logger.warn('Could not send ticket comment email - missing ticket:', {
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

    const assignedToName = safeString(ticket.assigned_to_name) || 'Unassigned';
    const assignedEmail = safeString(ticket.assigned_to_email);
    const assignedToEmailDisplay = assignedToName === 'Unassigned'
      ? 'Not assigned'
      : assignedEmail || 'Not provided';
    const assignedDetails = assignedToName === 'Unassigned'
      ? 'Unassigned'
      : assignedEmail
        ? `${assignedToName} (${assignedEmail})`
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
    const descriptionFormatting = rawDescription ? formatBlockNoteContent(rawDescription) : formatBlockNoteContent('');
    const descriptionText = descriptionFormatting.text || rawDescription;
    const description = descriptionText || 'No description provided.';

    // Get all additional resources
    const additionalResources = await db('ticket_resources as tr')
      .select('u.email as email', 'u.user_id as user_id')
      .leftJoin('users as u', function() {
        this.on('tr.additional_user_id', 'u.user_id')
            .andOn('tr.tenant', 'u.tenant');
      })
      .where({
        'tr.ticket_id': payload.ticketId,
        'tr.tenant': tenantId
      });

    const commentFormatting = formatBlockNoteContent(payload.comment?.content);
    const commentContext = {
      ...(payload.comment ?? {}),
      content: commentFormatting.html,
      html: commentFormatting.html,
      text: commentFormatting.text,
      plainText: commentFormatting.text,
      rawContent: payload.comment?.content ?? null
    };

    const { internalUrl, portalUrl } = await resolveTicketLinks(db, tenantId, ticket.ticket_id, ticket.ticket_number);

    const baseTicketContext = {
      id: ticket.ticket_number,
      title: ticket.title,
      description,
      priority: priorityName,
      priorityColor,
      status: statusName,
      metaLine,
      clientName,
      assignedToName,
      assignedToEmail: assignedToEmailDisplay,
      assignedDetails,
      requesterName,
      requesterEmail,
      requesterPhone,
      requesterContact,
      requesterDetails,
      board: boardName,
      category: categoryName || 'Not categorized',
      subcategory: subcategoryName || 'Not specified',
      categoryDetails,
      locationSummary
    };

    const buildContext = (url: string) => ({
      ticket: {
        ...baseTicketContext,
        url
      },
      comment: commentContext
    });

    // Determine primary email (contact first, then client)
    const primaryEmail = safeString(ticket.contact_email) || safeString(ticket.client_email);

    // Send to primary email if available - external user, no userId
    if (primaryEmail) {
      // For client portal users (contacts), pass the clientId so locale resolution respects client preferences
      const emailParams: SendEmailParams = {
        tenantId,
        to: primaryEmail,
        subject: `New Comment on Ticket: ${ticket.title}`,
        template: 'ticket-comment-added',
        context: buildContext(portalUrl),
        replyContext: {
          ticketId: ticket.ticket_id || payload.ticketId,
          commentId: payload.comment?.id,
          threadId: ticket.email_metadata?.threadId
        }
      };

      // Add clientId for locale resolution if we're sending to a contact/client
      if (ticket.client_id) {
        emailParams.recipientClientId = ticket.client_id;
      }

      await sendNotificationIfEnabled(emailParams, 'Ticket Comment Added');
    }

    // Send to assigned user if different from primary email
    if (assignedEmail && assignedEmail !== primaryEmail) {
      await sendNotificationIfEnabled({
        tenantId,
        to: assignedEmail,
        subject: `New Comment on Ticket: ${ticket.title}`,
        template: 'ticket-comment-added',
        context: buildContext(internalUrl),
        replyContext: {
          ticketId: ticket.ticket_id || payload.ticketId,
          commentId: payload.comment?.id,
          threadId: ticket.email_metadata?.threadId
        }
      }, 'Ticket Comment Added', ticket.assigned_to);
    }

    // Send to all additional resources
    for (const resource of additionalResources) {
      if (resource.email) {
        await sendNotificationIfEnabled({
          tenantId,
          to: resource.email,
          subject: `New Comment on Ticket: ${ticket.title}`,
          template: 'ticket-comment-added',
          context: buildContext(internalUrl),
          replyContext: {
            ticketId: ticket.ticket_id || payload.ticketId,
            commentId: payload.comment?.id,
            threadId: ticket.email_metadata?.threadId
          }
        }, 'Ticket Comment Added', resource.user_id);
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

    // Get ticket details with all required fields
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
      logger.warn('Could not send ticket closed email - missing ticket:', {
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

    const assignedToName = safeString(ticket.assigned_to_name) || 'Unassigned';
    const assignedEmail = safeString(ticket.assigned_to_email);
    const assignedToEmailDisplay = assignedToName === 'Unassigned'
      ? 'Not assigned'
      : assignedEmail || 'Not provided';
    const assignedDetails = assignedToName === 'Unassigned'
      ? 'Unassigned'
      : assignedEmail
        ? `${assignedToName} (${assignedEmail})`
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
    const descriptionFormatting = rawDescription ? formatBlockNoteContent(rawDescription) : formatBlockNoteContent('');
    const descriptionText = descriptionFormatting.text || rawDescription;
    const description = descriptionText || 'No description provided.';

    const changes = await formatChanges(db, payload.changes || {}, tenantId);

    // Get closer's name
    const closer = await db('users')
      .where({ user_id: payload.userId, tenant: tenantId })
      .first();
    const closedBy = closer ? `${closer.first_name} ${closer.last_name}` : payload.userId;

    const { internalUrl, portalUrl } = await resolveTicketLinks(db, tenantId, ticket.ticket_id, ticket.ticket_number);

    const baseTicketContext = {
      id: ticket.ticket_number,
      title: ticket.title,
      description,
      priority: priorityName,
      priorityColor,
      status: statusName,
      metaLine,
      clientName,
      assignedToName,
      assignedToEmail: assignedToEmailDisplay,
      assignedDetails,
      requesterName,
      requesterEmail,
      requesterPhone,
      requesterContact,
      requesterDetails,
      board: boardName,
      category: categoryName || 'Not categorized',
      subcategory: subcategoryName || 'Not specified',
      categoryDetails,
      locationSummary,
      changes,
      closedBy,
      resolution: ticket.resolution || ''
    };

    const externalContext = {
      ticket: {
        ...baseTicketContext,
        url: portalUrl
      }
    };
    const internalContext = {
      ticket: {
        ...baseTicketContext,
        url: internalUrl
      }
    };

    // Send to contact email if available, otherwise client email
    const primaryEmail = safeString(ticket.contact_email) || safeString(ticket.client_email);

    if (!primaryEmail) {
      logger.warn('Could not send ticket closed email - missing contact and client email:', {
        eventId: event.id,
        ticketId: payload.ticketId
      });
    } else {
      // Send to primary recipient - external user, no userId
      await sendNotificationIfEnabled({
        tenantId,
        to: primaryEmail,
        subject: `Ticket Closed: ${ticket.title}`,
        template: 'ticket-closed',
        context: externalContext,
        replyContext: {
          ticketId: ticket.ticket_id || payload.ticketId,
          threadId: ticket.email_metadata?.threadId
        }
      }, 'Ticket Closed');
    }

    // Send to assigned user if different from primary email
    if (assignedEmail && assignedEmail !== primaryEmail) {
      await sendNotificationIfEnabled({
        tenantId,
        to: assignedEmail,
        subject: `Ticket Closed: ${ticket.title}`,
        template: 'ticket-closed',
        context: internalContext,
        replyContext: {
          ticketId: ticket.ticket_id || payload.ticketId,
          threadId: ticket.email_metadata?.threadId
        }
      }, 'Ticket Closed', ticket.assigned_to);
    }

    // Get and notify all additional resources
    const additionalResources = await db('ticket_resources as tr')
      .select('u.email as email', 'u.user_id as user_id')
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
        await sendNotificationIfEnabled({
          tenantId,
          to: resource.email,
          subject: `Ticket Closed: ${ticket.title}`,
          template: 'ticket-closed',
          context: internalContext,
          replyContext: {
            ticketId: ticket.ticket_id || payload.ticketId,
            threadId: ticket.email_metadata?.threadId
          }
        }, 'Ticket Closed', resource.user_id);
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
    const ticketEventTypes = [
      'TICKET_CREATED',
      'TICKET_UPDATED',
      'TICKET_CLOSED',
      'TICKET_ASSIGNED',
      'TICKET_COMMENT_ADDED'
    ] as const;

    const channel = getEmailEventChannel();
    console.log(`[TicketEmailSubscriber] Using channel "${channel}" for ticket email events`);

    for (const eventType of ticketEventTypes) {
      // @ts-ignore - EventType union
      await getEventBus().subscribe(eventType, handleTicketEvent, { channel });
      console.log(`[TicketEmailSubscriber] Successfully subscribed to ${eventType} events on channel "${channel}"`);
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
    const ticketEventTypes = [
      'TICKET_CREATED',
      'TICKET_UPDATED',
      'TICKET_CLOSED',
      'TICKET_ASSIGNED',
      'TICKET_COMMENT_ADDED'
    ] as const;

    const channel = getEmailEventChannel();

    for (const eventType of ticketEventTypes) {
      // @ts-ignore - EventType union
      await getEventBus().unsubscribe(eventType, handleTicketEvent, { channel });
    }

    logger.info(`[TicketEmailSubscriber] Successfully unregistered from ticket events on channel "${channel}"`);
  } catch (error) {
    logger.error('Failed to unregister email notification subscribers:', error);
    throw error;
  }
}
