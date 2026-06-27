import { getEventBus } from '../index';
import {
  EventType,
  BaseEvent,
  EventSchemas,
  ProjectCreatedEvent,
  ProjectUpdatedEvent,
  ProjectClosedEvent,
  ProjectAssignedEvent,
  ProjectTaskAssignedEvent,
  TaskCommentAddedEvent
} from '@alga-psa/event-schemas';
import { sendEventEmail, SendEmailParams } from '../../notifications/sendEventEmail';
import { EventEmailRetryQueue } from '../../notifications/EventEmailRetryQueue';
import logger from '@alga-psa/core/logger';
import { createTenantKnex } from '../../db';
import { formatBlockNoteContent, convertBlockNoteToMarkdown } from '@alga-psa/formatting/blocknoteUtils';
import { getEmailEventChannel } from '@alga-psa/notifications';
import { isValidEmail } from '@alga-psa/core';
import { tenantDb } from '@alga-psa/db';
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

type PortalLinkContext = {
  internalBase: string;
  portalHost: string | null;
  isActiveVanityDomain: boolean;
  tenantSlug: string;
};

/**
 * Resolve the tenant-level portal-domain context once per handler invocation.
 * Mirrors the ticket subscriber so project emails to external (client/contact)
 * recipients link to the client portal, while internal recipients link to MSP.
 */
async function resolvePortalLinkContext(
  knex: Knex,
  tenantId: string
): Promise<PortalLinkContext> {
  const internalBase = getBaseUrl();
  let portalHost: string | null = null;
  let isActiveVanityDomain = false;

  try {
    const portalDomain = await getPortalDomain(knex, tenantId);
    // Only use a portal-specific host when the tenant has an *active* custom
    // (vanity) domain. Otherwise leave portalHost null so we emit
    // https://<NEXTAUTH host>/client-portal/...?tenant=<slug>.
    if (portalDomain && portalDomain.status === 'active' && portalDomain.domain) {
      portalHost = portalDomain.domain;
      isActiveVanityDomain = true;
    }
  } catch (error) {
    logger.warn('[ProjectEmailSubscriber] Failed to resolve portal domain for project link', {
      tenantId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }

  return {
    internalBase,
    portalHost,
    isActiveVanityDomain,
    tenantSlug: buildTenantPortalSlug(tenantId),
  };
}

/**
 * Build both the MSP (internal) and client-portal (external) URLs for a project.
 * Internal recipients (assigned users) get /msp/projects/...; external
 * recipients (client contacts) get /client-portal/projects/....
 */
function buildProjectLinks(
  ctx: PortalLinkContext,
  projectId: string
): { internalUrl: string; portalUrl: string } {
  const internalUrl = `${ctx.internalBase}/msp/projects/${projectId}`;
  const baseParams = new URLSearchParams();
  const clientPortalPath = `/client-portal/projects/${projectId}`;
  let portalUrl: string;

  if (ctx.portalHost) {
    const sanitizedHost = normalizeHost(ctx.portalHost);
    if (ctx.isActiveVanityDomain) {
      portalUrl = `https://${sanitizedHost}${clientPortalPath}${baseParams.toString() ? '?' + baseParams.toString() : ''}`;
    } else {
      baseParams.set('tenant', ctx.tenantSlug);
      portalUrl = `https://${sanitizedHost}${clientPortalPath}?${baseParams.toString()}`;
    }
  } else {
    const fallbackBase = ctx.internalBase.endsWith('/') ? ctx.internalBase.slice(0, -1) : ctx.internalBase;
    baseParams.set('tenant', ctx.tenantSlug);
    portalUrl = `${fallbackBase}${clientPortalPath}?${baseParams.toString()}`;
  }

  return { internalUrl, portalUrl };
}

async function resolveProjectLinks(
  knex: Knex,
  tenantId: string,
  projectId: string
): Promise<{ internalUrl: string; portalUrl: string }> {
  const ctx = await resolvePortalLinkContext(knex, tenantId);
  return buildProjectLinks(ctx, projectId);
}

async function fetchProjectForEmail(
  db: Knex,
  tenantId: string,
  projectId: string
): Promise<Record<string, any> | undefined> {
  const scopedDb = tenantDb(db, tenantId);
  const query = scopedDb.table('projects as p')
    .select(
      'p.*',
      'dcl.email as client_email',
      'c.client_name',
      's.name as status_name',
      'u.first_name as manager_first_name',
      'u.last_name as manager_last_name',
      'u.email as assigned_user_email',
      'ct.email as contact_email'
    );

  scopedDb.tenantJoin(query, 'clients as c', 'c.client_id', 'p.client_id', { type: 'left' });
  scopedDb.tenantJoin(query, 'client_locations as dcl', 'dcl.client_id', 'p.client_id', {
    type: 'left',
    on(join) {
      join
        .andOn('dcl.is_default', '=', db.raw('true'))
        .andOn('dcl.is_active', '=', db.raw('true'));
    },
  });
  scopedDb.tenantJoin(query, 'statuses as s', 's.status_id', 'p.status', { type: 'left' });
  scopedDb.tenantJoin(query, 'users as u', 'u.user_id', 'p.assigned_to', {
    type: 'left',
    on(join) {
      join.andOn('u.is_inactive', '=', db.raw('false'));
    },
  });
  scopedDb.tenantJoin(query, 'contacts as ct', 'ct.contact_name_id', 'p.contact_name_id', { type: 'left' });

  return query
    .where('p.project_id', projectId)
    .first<any>();
}

async function fetchTaskResourceEmails(
  db: Knex,
  tenantId: string,
  taskId: string
): Promise<Array<{ email?: string | null; user_id?: string | null }>> {
  const scopedDb = tenantDb(db, tenantId);
  const query = scopedDb.table('task_resources as tr')
    .select('u.email', 'u.user_id');

  scopedDb.tenantJoin(query, 'users as u', 'u.user_id', 'tr.additional_user_id', {
    type: 'left',
    on(join) {
      join.andOn('u.is_inactive', '=', db.raw('false'));
    },
  });

  return query
    .where('tr.task_id', taskId)
    .whereNotNull('tr.additional_user_id') as unknown as Promise<Array<{ email?: string | null; user_id?: string | null }>>;
}

/**
 * Wrapper function that checks notification preferences before sending email
 * @param params - Same params as sendEventEmail
 * @param subtypeName - Name of the notification subtype (e.g., "Project Created")
 * @param recipientUserId - Optional user ID for preference checking (only for internal users)
 */
async function sendNotificationIfEnabled(
  params: SendEmailParams,
  subtypeName: string,
  recipientUserId?: string
): Promise<void> {
  try {
    const { knex } = await createTenantKnex();
    const scopedDb = tenantDb(knex, params.tenantId);

    // 1. Check global notification settings
    const settings = await scopedDb.table('notification_settings').first();

    if (settings && !settings.is_enabled) {
      logger.info('[ProjectEmailSubscriber] Notifications disabled globally for tenant:', {
        tenantId: params.tenantId,
        recipient: params.to,
        subtypeName
      });
      return;
    }

    // 2. Look up notification subtype ID
    const subtype = await scopedDb.table('notification_subtypes')
      .where({ name: subtypeName })
      .first();

    if (!subtype) {
      logger.warn('[ProjectEmailSubscriber] Notification subtype not found:', {
        subtypeName,
        recipient: params.to
      });
      // Continue anyway to avoid breaking existing functionality
      await sendEventEmail(params);
      return;
    }

    // 3. Check tenant-specific subtype setting
    const subtypeSetting = await scopedDb.table('tenant_notification_subtype_settings')
      .where({ subtype_id: subtype.id })
      .first();

    const isSubtypeEnabled = subtypeSetting?.is_enabled ?? true;
    if (!isSubtypeEnabled) {
      logger.info('[ProjectEmailSubscriber] Subtype disabled for tenant:', {
        subtypeName,
        tenantId: params.tenantId,
        recipient: params.to
      });
      return;
    }

    // 4. Check tenant-specific category setting
    const categorySetting = await scopedDb.table('tenant_notification_category_settings')
      .where({ category_id: subtype.category_id })
      .first();

    const isCategoryEnabled = categorySetting?.is_enabled ?? true;
    if (!isCategoryEnabled) {
      logger.info('[ProjectEmailSubscriber] Category disabled for tenant:', {
        categoryId: subtype.category_id,
        tenantId: params.tenantId,
        recipient: params.to
      });
      return;
    }

    // 5. For internal users, check user preferences and rate limiting
    if (recipientUserId) {
      // Check user preferences
      const preference = await scopedDb.table('user_notification_preferences')
        .where({
          user_id: recipientUserId,
          subtype_id: subtype.id
        })
        .first();

      if (preference && !preference.is_enabled) {
        logger.info('[ProjectEmailSubscriber] User has opted out of this notification type:', {
          userId: recipientUserId,
          subtypeName,
          recipient: params.to
        });
        return;
      }

      // Rate limiting is now centralized in TenantEmailService.sendEmail()
    }

    // 6. All checks passed - send the email
    // Pass recipientUserId for rate limiting in TenantEmailService
    await sendEventEmail({
      ...params,
      recipientUserId
    });

    // 7. Log the notification (only for internal users with userId)
    if (recipientUserId && subtype) {
      try {
        await scopedDb.table('notification_logs').insert({
          tenant: params.tenantId,
          user_id: recipientUserId,
          subtype_id: subtype.id,
          email_address: params.to,
          subject: params.subject,
          status: 'sent'
        });
      } catch (logError) {
        logger.warn('[ProjectEmailSubscriber] Failed to log notification:', {
          error: logError instanceof Error ? logError.message : 'Unknown error',
          userId: recipientUserId,
          recipient: params.to
        });
      }
    }

  } catch (error) {
    const isEmailProviderError =
      typeof error === 'object' &&
      error !== null &&
      (error as any).name === 'EmailProviderError' &&
      typeof (error as any).isRetryable === 'boolean';

    if (isEmailProviderError && (error as any).isRetryable === false) {
      logger.warn('[ProjectEmailSubscriber] Non-retryable email send failure; skipping:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        subtypeName,
        recipient: params.to,
        tenantId: params.tenantId
      });
      return;
    }

    if (isEmailProviderError && (error as any).isRetryable === true) {
      const queue = EventEmailRetryQueue.getInstance();
      if (queue.isReady()) {
        await queue.enqueue(params, {
          retryAfterMs:
            typeof (error as any).metadata?.retryAfterMs === 'number'
              ? (error as any).metadata.retryAfterMs
              : undefined,
        });

        logger.warn('[ProjectEmailSubscriber] Retryable email send failure queued for delayed retry:', {
          error: error instanceof Error ? error.message : 'Unknown error',
          subtypeName,
          recipient: params.to,
          tenantId: params.tenantId
        });
        return;
      }
    }

    logger.error('[ProjectEmailSubscriber] Error in sendNotificationIfEnabled:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      subtypeName,
      recipient: params.to,
      tenantId: params.tenantId
    });
    throw error;
  }
}

/**
 * HTML-escape a string for safe interpolation into the email body.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CHANGE_LIST_STYLE = 'margin:0;padding:0;list-style:none;';
const CHANGE_ITEM_STYLE = 'margin:0 0 10px 0;padding:0;';
const CHANGE_FIELD_LABEL_STYLE = 'font-weight:600;color:#1f2933;';
const CHANGE_OLD_VALUE_STYLE = 'color:#94595d;text-decoration:line-through;word-break:break-word;';
const CHANGE_NEW_VALUE_STYLE = 'color:#0a7c3c;font-weight:600;word-break:break-word;';
const CHANGE_SINGLE_VALUE_STYLE = 'color:#1f2933;word-break:break-word;';

function renderChangeItemHtml(fieldLabel: string, oldValue: string | null, newValue: string): string {
  const fieldHtml = `<div style="${CHANGE_FIELD_LABEL_STYLE}">${escapeHtml(fieldLabel)}</div>`;
  if (oldValue === null) {
    return `<li style="${CHANGE_ITEM_STYLE}">${fieldHtml}<div style="${CHANGE_SINGLE_VALUE_STYLE}">${escapeHtml(newValue)}</div></li>`;
  }
  return `<li style="${CHANGE_ITEM_STYLE}">${fieldHtml}<div style="${CHANGE_OLD_VALUE_STYLE}">${escapeHtml(oldValue)}</div><div style="${CHANGE_NEW_VALUE_STYLE}">${escapeHtml(newValue)}</div></li>`;
}

/**
 * Format changes record into an HTML fragment for use in the "Changes Made" email box.
 */
async function formatChanges(db: any, changes: Record<string, unknown>, tenantId: string): Promise<string> {
  const items = await Promise.all(
    Object.entries(changes).map(async ([field, value]) => {
      const fieldLabel = formatFieldName(field);
      if (typeof value === 'object' && value !== null) {
        const { from, to, previous, new: newValue } = value as {
          from?: unknown;
          to?: unknown;
          previous?: unknown;
          new?: unknown;
        };

        if (from !== undefined && to !== undefined) {
          const fromValue = await resolveValue(db, field, from, tenantId);
          const toValue = await resolveValue(db, field, to, tenantId);
          return renderChangeItemHtml(fieldLabel, fromValue, toValue);
        }

        if (previous !== undefined && newValue !== undefined) {
          const fromValue = await resolveValue(db, field, previous, tenantId);
          const toValue = await resolveValue(db, field, newValue, tenantId);
          return renderChangeItemHtml(fieldLabel, fromValue, toValue);
        }
      }
      const resolvedValue = await resolveValue(db, field, value, tenantId);
      return renderChangeItemHtml(fieldLabel, null, resolvedValue);
    })
  );
  if (items.length === 0) {
    return '';
  }
  return `<ul style="${CHANGE_LIST_STYLE}">${items.join('')}</ul>`;
}

/**
 * Resolve field values to human-readable names
 */
async function resolveValue(db: any, field: string, value: unknown, tenantId: string): Promise<string> {
  if (value === null || value === undefined) {
    return 'None';
  }

  const scopedDb = tenantDb(db, tenantId);

  switch (field) {
    case 'status':
      const status = await scopedDb.table('statuses')
        .where('status_id', value)
        .first();
      return status?.name || String(value);

    case 'assigned_to':
    case 'assignedTo':
    case 'updated_by':
    case 'closed_by':
      const user = await scopedDb.table('users')
        .where({
          user_id: value,
          is_inactive: false
        })
        .first();
      return user ? `${user.first_name} ${user.last_name}` : String(value);

    case 'client_id':
    case 'clientId':
      const client = await scopedDb.table('clients')
        .where('client_id', value)
        .first();
      return client ? client.client_name : String(value);

      case 'contact_name_id':
      case 'contactNameId':
        const contact_name = await scopedDb.table('contacts')
          .where('contact_name_id', value)
          .first();
        return contact_name ? contact_name.full_name : String(value);

  default:
    if (typeof value === 'boolean') {
      return value ? 'Yes' : 'No';
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.startsWith('[') && trimmed.includes('"type"')) {
        const { text } = formatBlockNoteContent(value);
        return text;
      }
      return value;
    }
    if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
      const { text } = formatBlockNoteContent(value);
      return text;
    }
    return value !== undefined && value !== null ? String(value) : '';
}
}

/**
 * Format field names to be more readable
 */
function formatFieldName(field: string): string {
  const specialCases: Record<string, string> = {
    client_id: 'Client',
    project_name: 'Project Name',
    description: 'Description',
    start_date: 'Start Date',
    end_date: 'End Date',
    is_inactive: 'Is Inactive',
    status: 'Status',
    assigned_to: 'Assigned To',
    contact_name_id: 'Contact'
  };

  if (specialCases[field]) return specialCases[field];

  const camelSpecialCases: Record<string, string> = {
    clientId: 'Client',
    projectName: 'Project Name',
    startDate: 'Start Date',
    endDate: 'End Date',
    isInactive: 'Is Inactive',
    assignedTo: 'Assigned To',
    contactNameId: 'Contact',
  };

  if (camelSpecialCases[field]) return camelSpecialCases[field];

  if (field.includes('_')) {
    return field
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  return field
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Handle project created events
 */
async function handleProjectCreated(event: ProjectCreatedEvent): Promise<void> {
  const { payload } = event;
  const { tenantId } = payload;
  
  try {
    logger.info('[ProjectEmailSubscriber] Handling project created event:', {
      eventId: event.id,
      projectId: payload.projectId,
      tenantId
    });

    const { knex: db } = await createTenantKnex();
    
    logger.info('[ProjectEmailSubscriber] Fetching project details');
    
    // Get project details with debug logging
    const project = await fetchProjectForEmail(db, tenantId, payload.projectId);

    // Log the project details for debugging
    logger.info('[ProjectEmailSubscriber] Project details:', {
      projectId: payload.projectId,
      tenantId,
      contactNameId: project?.contact_name_id,
      contactEmail: project?.contact_email,
      project
    });

    // If contact exists but email is missing, check the contact directly
    if (project?.contact_name_id && !project.contact_email) {
      const contact = await tenantDb(db, tenantId).table('contacts')
        .where({
          contact_name_id: project.contact_name_id,
        })
        .first();
      logger.info('[ProjectEmailSubscriber] Direct contact lookup:', {
        contactNameId: project.contact_name_id,
        contact
      });
    }
    
    if (!project){
      logger.warn('[ProjectEmailSubscriber] Project not found:',{
        eventId: event.id,
        projectId: payload.projectId
      });
      return;
    }

    const descriptionFormatting = project.description ? formatBlockNoteContent(project.description) : null;
    const projectDescriptionText = descriptionFormatting ? descriptionFormatting.text : '';
    const projectDescriptionHtml = descriptionFormatting ? descriptionFormatting.html : '';

    // Collect all recipient emails
    const recipients: string[] = [];

    // Add contact or client email
    if (isValidEmail(project.contact_email)) {
      recipients.push(project.contact_email);
      logger.info('[ProjectEmailSubscriber] Adding contact email as recipient', {
        contactEmail: project.contact_email
      });
    } else if (isValidEmail(project.client_email)) {
      recipients.push(project.client_email);
      logger.info('[ProjectEmailSubscriber] Adding client email as recipient', {
        clientEmail: project.client_email
      });
    }

    // Always add assigned user email if available
    if (isValidEmail(project.assigned_user_email)) {
      recipients.push(project.assigned_user_email);
      logger.info('[ProjectEmailSubscriber] Adding assigned user email as recipient', {
        assignedUserEmail: project.assigned_user_email
      });
    }

    if (recipients.length === 0) {
      logger.warn('[ProjectEmailSubscriber] No valid recipients found for project created notification', {
        projectId: payload.projectId,
        hasContactEmail: !!project.contact_email,
        hasAssignedUserEmail: !!project.assigned_user_email,
        hasClientEmail: !!project.client_email
      });
      return;
    }

    const { internalUrl, portalUrl } = await resolveProjectLinks(db, tenantId, project.project_id);
    const buildContext = (url: string) => ({
      project: {
        id: project.project_number,
        name: project.project_name,
        description: projectDescriptionText,
        descriptionText: projectDescriptionText,
        descriptionHtml: projectDescriptionHtml,
        status: project.status_name || 'Unknown',
        manager: project.manager_first_name && project.manager_last_name ?
          `${project.manager_first_name} ${project.manager_last_name}` : 'Unassigned',
        startDate: project.start_date,
        endDate: project.end_date,
        createdBy: payload.userId,
        url,
        client: project.client_name || 'No Client'
      }
    });

    const replyContext = {
      projectId: project.project_id || payload.projectId
    };

    // Send to contact or client (external users - no userId check) - client portal link
    if (isValidEmail(project.contact_email)) {
      await sendNotificationIfEnabled({
        tenantId,
        to: project.contact_email,
        subject: `Project Created: ${project.project_name}`,
        template: 'project-created',
        context: buildContext(portalUrl),
        replyContext
      }, 'Project Created');
    } else if (isValidEmail(project.client_email)) {
      await sendNotificationIfEnabled({
        tenantId,
        to: project.client_email,
        subject: `Project Created: ${project.project_name}`,
        template: 'project-created',
        context: buildContext(portalUrl),
        replyContext
      }, 'Project Created');
    }

    // Send to assigned user (internal user - check preferences) - MSP link
    if (isValidEmail(project.assigned_user_email)) {
      await sendNotificationIfEnabled({
        tenantId,
        to: project.assigned_user_email,
        subject: `Project Created: ${project.project_name}`,
        template: 'project-created',
        context: buildContext(internalUrl),
        replyContext
      }, 'Project Created', project.assigned_to);
    }

  } catch (error) {
    logger.error('Error handling project created event:', {
      error,
      eventId: event.id,
      projectId: payload.projectId
    });
    throw error;
  }
}

/**
 * Handle project updated events
 */
async function handleProjectUpdated(event: ProjectUpdatedEvent): Promise<void> {
  const { payload } = event;
  const tenantId = (payload as any).tenantId as string;
  const changes = ((payload as any).changes ?? {}) as Record<string, unknown>;
  const updaterUserId = ((payload as any).actorUserId ?? (payload as any).userId) as string | undefined;

  // Check if the status change indicates the project is being closed
  const statusValue = (() => {
    const raw = (changes as any).status;
    if (!raw) return undefined;
    if (typeof raw === 'object' && raw !== null) {
      return (raw as any).to ?? (raw as any).new;
    }
    return raw;
  })();

  if (statusValue) {
    const { knex: db } = await createTenantKnex();
    const status = await tenantDb(db, tenantId).table('statuses')
      .where('status_id', statusValue)
      .first();
    
    if (status?.is_closed) {
      // Convert this to a ProjectClosedEvent
      const closedEvent: ProjectClosedEvent = {
        ...event,
        eventType: 'PROJECT_CLOSED',
        payload: {
          ...payload,
          changes,
        },
      };
      return handleProjectClosed(closedEvent);
    }
  }

  try {
    const { knex: db } = await createTenantKnex();
    
    // Get project details with debug logging
    const project = await fetchProjectForEmail(db, tenantId, payload.projectId);

    // Log the project details for debugging
    logger.info('[ProjectEmailSubscriber] Project details:', {
      projectId: payload.projectId,
      tenantId,
      contactNameId: project?.contact_name_id,
      contactEmail: project?.contact_email,
      project
    });

    // If contact exists but email is missing, check the contact directly
    if (project?.contact_name_id && !project.contact_email) {
      const contact = await tenantDb(db, tenantId).table('contacts')
        .where({
          contact_name_id: project.contact_name_id,
        })
        .first();
      logger.info('[ProjectEmailSubscriber] Direct contact lookup:', {
        contactNameId: project.contact_name_id,
        contact
      });

      // Use the contact email if found
      if (contact?.email) {
        project.contact_email = contact.email;
      }
    }

    if (!project) {
      logger.warn('[ProjectEmailSubscriber] Project not found:', {
        eventId: event.id,
        projectId: payload.projectId
      });
      return;
    }

    // Collect all recipient emails
    const recipients: string[] = [];

    // Add contact or client email
    if (isValidEmail(project.contact_email)) {
      recipients.push(project.contact_email);
      logger.info('[ProjectEmailSubscriber] Adding contact email as recipient', {
        contactEmail: project.contact_email
      });
    } else if (isValidEmail(project.client_email)) {
      recipients.push(project.client_email);
      logger.info('[ProjectEmailSubscriber] Adding client email as recipient', {
        clientEmail: project.client_email
      });
    }

    // Always add assigned user email if available
    if (isValidEmail(project.assigned_user_email)) {
      recipients.push(project.assigned_user_email);
      logger.info('[ProjectEmailSubscriber] Adding assigned user email as recipient', {
        assignedUserEmail: project.assigned_user_email
      });
    }

    // Debug log all potential email sources
    logger.info('[ProjectEmailSubscriber] Available email addresses:', {
      projectId: payload.projectId,
      contactEmail: project.contact_email,
      clientEmail: project.client_email,
      assignedUserEmail: project.assigned_user_email
    });

    if (recipients.length === 0) {
      logger.warn('[ProjectEmailSubscriber] No valid recipients found for project updated notification', {
        projectId: payload.projectId,
        hasContactEmail: !!project.contact_email,
        hasAssignedUserEmail: !!project.assigned_user_email,
        hasClientEmail: !!project.client_email,
        project: project // Log the full project object for debugging
      });
      return;
    }

    // Log the changes being made
    logger.info('[ProjectEmailSubscriber] Project changes:', {
      projectId: payload.projectId,
      changes: payload.changes || {}
    });

    // Format changes with database lookups
    const formattedChanges = await formatChanges(db, payload.changes || {}, tenantId);

    // Log the formatted changes
    logger.info('[ProjectEmailSubscriber] Formatted changes:', {
      projectId: payload.projectId,
      formattedChanges
    });

    // Get updater's name
    const updater = updaterUserId
      ? await tenantDb(db, tenantId).table('users')
          .where({
            user_id: updaterUserId,
            is_inactive: false,
          })
          .first()
      : null;

    const { internalUrl, portalUrl } = await resolveProjectLinks(db, tenantId, project.project_id);
    const buildContext = (url: string) => ({
      project: {
        id: project.project_number,
        name: project.project_name,
        status: project.status_name || 'Unknown',
        manager: project.manager_first_name && project.manager_last_name ?
          `${project.manager_first_name} ${project.manager_last_name}` : 'Unassigned',
        changes: formattedChanges,
        updatedBy: updater ? `${updater.first_name} ${updater.last_name}` : updaterUserId,
        url,
        client: project.client_name || 'No Client'
      }
    });

    const replyContext = {
      projectId: project.project_id || payload.projectId
    };

    // Send to contact or client (external users - no userId check) - client portal link
    if (isValidEmail(project.contact_email)) {
      await sendNotificationIfEnabled({
        tenantId,
        to: project.contact_email,
        subject: `Project Updated: ${project.project_name}`,
        template: 'project-updated',
        context: buildContext(portalUrl),
        replyContext
      }, 'Project Updated');
    } else if (isValidEmail(project.client_email)) {
      await sendNotificationIfEnabled({
        tenantId,
        to: project.client_email,
        subject: `Project Updated: ${project.project_name}`,
        template: 'project-updated',
        context: buildContext(portalUrl),
        replyContext
      }, 'Project Updated');
    }

    // Send to assigned user (internal user - check preferences) - MSP link
    if (isValidEmail(project.assigned_user_email)) {
      await sendNotificationIfEnabled({
        tenantId,
        to: project.assigned_user_email,
        subject: `Project Updated: ${project.project_name}`,
        template: 'project-updated',
        context: buildContext(internalUrl),
        replyContext
      }, 'Project Updated', project.assigned_to);
    }

  } catch (error) {
    logger.error('Error handling project updated event:', {
      error,
      eventId: event.id,
      projectId: payload.projectId
    });
    throw error;
  }
}

/**
 * Handle project closed events
 */
async function handleProjectClosed(event: ProjectClosedEvent): Promise<void> {
  const { payload } = event;
  const { tenantId } = payload;
  const closedByUserId = ((payload as any).actorUserId ?? (payload as any).userId) as string | undefined;
  
  try {
    const { knex: db } = await createTenantKnex();
    
    // Get project details with debug logging
    const project = await fetchProjectForEmail(db, tenantId, payload.projectId);

    // Log the project details for debugging
    logger.info('[ProjectEmailSubscriber] Project details:', {
      projectId: payload.projectId,
      tenantId,
      contactNameId: project?.contact_name_id,
      contactEmail: project?.contact_email,
      project
    });

    // If contact exists but email is missing, check the contact directly
    if (project?.contact_name_id && !project.contact_email) {
      const contact = await tenantDb(db, tenantId).table('contacts')
        .where({
          contact_name_id: project.contact_name_id,
        })
        .first();
      logger.info('[ProjectEmailSubscriber] Direct contact lookup:', {
        contactNameId: project.contact_name_id,
        contact
      });

      // Use the contact email if found
      if (contact?.email) {
        project.contact_email = contact.email;
      }
    }

    if (!project) {
      logger.warn('[ProjectEmailSubscriber] Project not found:', {
        eventId: event.id,
        projectId: payload.projectId
      });
      return;
    }

    // Collect all recipient emails
    const recipients: string[] = [];

    // Add contact or client email
    if (isValidEmail(project.contact_email)) {
      recipients.push(project.contact_email);
      logger.info('[ProjectEmailSubscriber] Adding contact email as recipient', {
        contactEmail: project.contact_email
      });
    } else if (isValidEmail(project.client_email)) {
      recipients.push(project.client_email);
      logger.info('[ProjectEmailSubscriber] Adding client email as recipient', {
        clientEmail: project.client_email
      });
    }

    // Always add assigned user email if available
    if (isValidEmail(project.assigned_user_email)) {
      recipients.push(project.assigned_user_email);
      logger.info('[ProjectEmailSubscriber] Adding assigned user email as recipient', {
        assignedUserEmail: project.assigned_user_email
      });
    }

    if (recipients.length === 0) {
      logger.warn('[ProjectEmailSubscriber] No valid recipients found for project closed notification', {
        projectId: payload.projectId,
        hasContactEmail: !!project.contact_email,
        hasAssignedUserEmail: !!project.assigned_user_email,
        hasClientEmail: !!project.client_email
      });
      return;
    }

    const closedDescriptionFormatting = project.description ? formatBlockNoteContent(project.description) : null;
    const closedDescriptionText = closedDescriptionFormatting ? closedDescriptionFormatting.text : '';
    const closedDescriptionHtml = closedDescriptionFormatting ? closedDescriptionFormatting.html : '';

    const { internalUrl, portalUrl } = await resolveProjectLinks(db, tenantId, project.project_id);
    const formattedClosedChanges = await formatChanges(db, payload.changes || {}, tenantId);
    const closedByValue = await resolveValue(db, 'closed_by', closedByUserId, tenantId);
    const closedAtValue = new Date().toISOString();
    const buildContext = (url: string) => ({
      project: {
        id: project.project_number,
        name: project.project_name,
        status: project.status_name || 'Unknown',
        manager: project.manager_first_name && project.manager_last_name ?
          `${project.manager_first_name} ${project.manager_last_name}` : 'Unassigned',
        description: closedDescriptionText,
        descriptionText: closedDescriptionText,
        descriptionHtml: closedDescriptionHtml,
        startDate: project.start_date,
        endDate: project.end_date,
        changes: formattedClosedChanges,
        closedBy: closedByValue,
        closedAt: closedAtValue,
        url,
        client: project.client_name || 'No Client'
      }
    });

    const closedContextPortal = buildContext(portalUrl);
    const closedContextInternal = buildContext(internalUrl);

    const replyContext = {
      projectId: project.project_id || payload.projectId
    };

    // Send to contact or client (external users - no userId check) - client portal link
    if (isValidEmail(project.contact_email)) {
      await sendNotificationIfEnabled({
        tenantId,
        to: project.contact_email,
        subject: `Project Closed: ${project.project_name}`,
        template: 'project-closed',
        context: closedContextPortal,
        replyContext
      }, 'Project Closed');
    } else if (isValidEmail(project.client_email)) {
      await sendNotificationIfEnabled({
        tenantId,
        to: project.client_email,
        subject: `Project Closed: ${project.project_name}`,
        template: 'project-closed',
        context: closedContextPortal,
        replyContext
      }, 'Project Closed');
    }

    // Send to assigned user (internal user - check preferences) - MSP link
    if (isValidEmail(project.assigned_user_email)) {
      await sendNotificationIfEnabled({
        tenantId,
        to: project.assigned_user_email,
        subject: `Project Closed: ${project.project_name}`,
        template: 'project-closed',
        context: closedContextInternal,
        replyContext
      }, 'Project Closed', project.assigned_to);
    }

  } catch (error) {
    logger.error('Error handling project closed event:', {
      error,
      eventId: event.id,
      projectId: payload.projectId
    });
    throw error;
  }
}

/**
 * Handle project assigned events
 */
async function handleProjectAssigned(event: ProjectAssignedEvent): Promise<void> {
  const { payload } = event;
  const { tenantId, assignedTo } = payload;
  
  try {
    const { knex: db } = await createTenantKnex();
    const scopedDb = tenantDb(db, tenantId);
    
    // Get project and user details
    const query = scopedDb.table('projects as p')
      .select(
        'p.*',
        'c.client_name',
        'dcl.email as client_email',
        'u.email as user_email',
        'u.first_name as user_first_name',
        'u.last_name as user_last_name'
      );
    scopedDb.tenantJoin(query, 'clients as c', 'c.client_id', 'p.client_id', { type: 'left' });
    scopedDb.tenantJoin(query, 'client_locations as dcl', 'dcl.client_id', 'p.client_id', {
      type: 'left',
      on(join) {
        join
          .andOn('dcl.is_default', '=', db.raw('true'))
          .andOn('dcl.is_active', '=', db.raw('true'));
      },
    });
    scopedDb.tenantJoin(query, 'users as u', 'u.user_id', 'p.assigned_to', {
      type: 'left',
      on(join) {
        join.andOn('u.is_inactive', '=', db.raw('false'));
      },
    });

    const project = await query
      .where('p.project_id', payload.projectId)
      .first<any>();

    // Log the project details for debugging
    logger.info('[ProjectEmailSubscriber] Project details:', {
      projectId: payload.projectId,
      tenantId,
      assignedTo,
      project
    });

    if (!project) {
      logger.warn('Could not send project assigned email - project not found:', {
        eventId: event.id,
        projectId: payload.projectId,
        userId: assignedTo
      });
      return;
    }

    const assignedUser = await scopedDb.table('users')
      .select('email', 'first_name', 'last_name')
      .where({ user_id: assignedTo, is_inactive: false })
      .first();
    if (assignedUser) {
      project.user_email = assignedUser.email;
      project.user_first_name = assignedUser.first_name;
      project.user_last_name = assignedUser.last_name;
    }

    if (!isValidEmail(project.user_email)) {
      logger.warn('Could not send project assigned email - user email not found or invalid:', {
        eventId: event.id,
        projectId: payload.projectId,
        userId: assignedTo,
        userEmail: project.user_email,
        project
      });
      return;
    }

    const assigner = payload.userId
      ? await scopedDb.table('users')
          .select('first_name', 'last_name')
          .where({ user_id: payload.userId, is_inactive: false })
          .first()
      : null;

    const projectDescriptionFormatting = project.description ? formatBlockNoteContent(project.description) : null;
    const projectDescriptionText = projectDescriptionFormatting ? projectDescriptionFormatting.text : '';
    const projectDescriptionHtml = projectDescriptionFormatting ? projectDescriptionFormatting.html : '';

    await sendNotificationIfEnabled({
      tenantId,
      to: project.user_email,
      subject: `You have been assigned to project: ${project.project_name}`,
      template: 'project-assigned',
      context: {
        project: {
          name: project.project_name,
          description: projectDescriptionText,
          descriptionText: projectDescriptionText,
          descriptionHtml: projectDescriptionHtml,
          startDate: project.start_date,
          assignedBy: assigner ? `${assigner.first_name} ${assigner.last_name}` : 'Someone',
          url: `${getBaseUrl()}/msp/projects/${project.project_id}`,
          client: project.client_name || 'No Client'
        }
      },
      replyContext: {
        projectId: project.project_id || payload.projectId
      }
    }, 'Project Assigned', assignedTo);

  } catch (error) {
    logger.error('Error handling project assigned event:', {
      error,
      eventId: event.id,
      projectId: payload.projectId
    });
    throw error;
  }
}

/**
 * Handle project task assigned events
 */
async function handleProjectTaskAssigned(event: ProjectTaskAssignedEvent): Promise<void> {
  const { payload } = event;
  const tenantId = (payload as any).tenantId;
  const assignedToUserId =
    (payload as any).assignedToId ?? (payload as any).assignedTo ?? (payload as any).userId;
  // Get assigner name directly from payload to avoid complex Citus join
  const assignedByNameFromPayload = (payload as any).assignedByName as string | undefined;

  try {
    const { knex: db } = await createTenantKnex();
    const scopedDb = tenantDb(db, tenantId);

    // Get task, project and user details
    // Note: We removed the 'users as au' join for the assigner because it caused
    // Citus errors with complex joins. The assigner name is now passed in the event payload.
    const query = scopedDb.table('project_tasks as t')
      .select(
        't.task_id',
        't.task_name',
        't.description',
        't.due_date',
        't.phase_id',
        'p.project_name',
        'p.project_id',
        'u.email as user_email',
        'u.first_name as user_first_name',
        'u.last_name as user_last_name'
      );
    scopedDb.tenantJoin(query, 'project_phases as ph', 'ph.phase_id', 't.phase_id', { type: 'left' });
    scopedDb.tenantJoin(query, 'projects as p', 'p.project_id', 'ph.project_id', {
      type: 'left',
      rootTenantColumn: 'ph.tenant',
    });
    scopedDb.tenantJoin(query, 'users as u', 'u.user_id', 't.assigned_to', {
      type: 'left',
      on(join) {
        join.andOn('u.is_inactive', '=', db.raw('false'));
      },
    });
    query.where('t.task_id', payload.taskId);

    logger.debug('[ProjectEmailSubscriber] Task query:', {
      sql: query.toString(),
      bindings: query.toSQL().bindings
    });

    const task = await query
      .first<any>();

    if (!task) {
      logger.warn('Could not send task assigned email - task not found:', {
        eventId: event.id,
        taskId: payload.taskId
      });
      return;
    }

    // Get additional users' emails from task_resources
    const additionalUserEmails = await fetchTaskResourceEmails(db, tenantId, payload.taskId);

    // Build task URL using URLSearchParams for consistency
    const taskUrlParams = new URLSearchParams();
    taskUrlParams.set('phaseId', task.phase_id);
    taskUrlParams.set('taskId', task.task_id);
    const taskUrl = `${getBaseUrl()}/msp/projects/${task.project_id}?${taskUrlParams.toString()}`;

    // Use assigner name from payload, fallback to 'Someone' if not available
    const assignedByName = assignedByNameFromPayload || 'Someone';

    // Send email to primary assignee
    if (isValidEmail(task.user_email)) {
      await sendNotificationIfEnabled({
        tenantId,
        to: task.user_email,
        subject: `You have been assigned to task: ${task.task_name}`,
        template: 'project-task-assigned-primary',
        context: {
          task: {
            name: task.task_name,
            project: task.project_name,
            dueDate: task.due_date,
            assignedBy: assignedByName,
            url: taskUrl,
            role: 'Primary Assignee'
          }
        },
        replyContext: {
          projectId: task.project_id || payload.projectId
        }
      }, 'Project Task Assigned', assignedToUserId);
    }

    // Send emails to additional users (deduplicate by user_id/email)
    const uniqueAdditionalUsers = additionalUserEmails.reduce<Map<string, typeof additionalUserEmails[number]>>(
      (acc, user) => {
        if (!isValidEmail(user.email)) {
          return acc;
        }
        const key = user.user_id || user.email;
        if (!acc.has(key)) {
          acc.set(key, user);
        }
        return acc;
      },
      new Map()
    );

    for (const additionalUser of uniqueAdditionalUsers.values()) {
      await sendNotificationIfEnabled({
        tenantId,
        to: additionalUser.email!,
        subject: `You have been added as additional agent to task: ${task.task_name}`,
        template: 'project-task-assigned-additional',
        context: {
          task: {
            name: task.task_name,
            project: task.project_name,
            dueDate: task.due_date,
            assignedBy: assignedByName,
            url: taskUrl,
            role: 'Additional Agent'
          }
        },
        replyContext: {
          projectId: task.project_id || payload.projectId
        }
      }, 'Project Task Assigned', additionalUser.user_id);
    }

  } catch (error) {
    logger.error('Error handling project task assigned event:', {
      error,
      eventId: event.id,
      taskId: payload.taskId
    });
    throw error;
  }
}

/**
 * Handle task comment added events
 */
async function handleTaskCommentAdded(event: TaskCommentAddedEvent): Promise<void> {
  const { payload } = event;
  const { tenantId, taskId, projectId, userId, commentContent } = payload;

  try {
    const { knex: db } = await createTenantKnex();
    const scopedDb = tenantDb(db, tenantId);

    // Get task and project details
    const taskQuery = scopedDb.table('project_tasks as t')
      .select(
        't.task_id',
        't.task_name',
        't.assigned_to',
        't.phase_id',
        'p.project_name',
        'p.project_id'
      );
    scopedDb.tenantJoin(taskQuery, 'project_phases as ph', 'ph.phase_id', 't.phase_id', { type: 'left' });
    scopedDb.tenantJoin(taskQuery, 'projects as p', 'p.project_id', 'ph.project_id', {
      type: 'left',
      rootTenantColumn: 'ph.tenant',
    });

    const task = await taskQuery
      .where('t.task_id', taskId)
      .first<any>();

    if (!task) {
      logger.warn('[ProjectEmailSubscriber] Could not send task comment email - task not found:', {
        eventId: event.id,
        taskId
      });
      return;
    }

    // Get comment author
    const author = await scopedDb.table('users')
      .select('first_name', 'last_name', 'email', 'user_id')
      .where({ user_id: userId })
      .first();

    const authorName = author ? `${author.first_name} ${author.last_name}` : 'Someone';
    const authorEmail = author?.email || '';

    // Parse comment content
    let contentHtml = '';
    let contentText = '';
    if (commentContent) {
      try {
        const formatting = formatBlockNoteContent(commentContent);
        contentHtml = formatting.html;
        contentText = formatting.text;
      } catch {
        try {
          contentText = convertBlockNoteToMarkdown(commentContent);
          contentHtml = contentText;
        } catch {
          contentText = typeof commentContent === 'string' ? commentContent : '';
          contentHtml = contentText;
        }
      }
    }

    // Build task URL
    const taskUrlParams = new URLSearchParams();
    taskUrlParams.set('phaseId', task.phase_id);
    taskUrlParams.set('taskId', task.task_id);
    const taskUrl = `${getBaseUrl()}/msp/projects/${task.project_id}?${taskUrlParams.toString()}`;

    const emailContext = {
      task: {
        name: task.task_name,
        url: taskUrl,
      },
      project: {
        name: task.project_name,
      },
      comment: {
        author: authorName,
        contentHtml,
        contentText,
      },
    };

    const replyContext = {
      projectId: task.project_id || projectId
    };

    // Get all assignees (primary + additional agents)
    const assignees: Array<{ user_id: string; email: string }> = [];

    // Primary assignee
    if (task.assigned_to) {
      const primaryAssignee = await scopedDb.table('users')
        .select('user_id', 'email')
        .where({ user_id: task.assigned_to, is_inactive: false })
        .first<any>();
      if (primaryAssignee && isValidEmail(primaryAssignee.email)) {
        assignees.push({ user_id: primaryAssignee.user_id, email: primaryAssignee.email });
      }
    }

    // Additional agents
    const additionalAgents = await fetchTaskResourceEmails(db, tenantId, taskId);

    for (const agent of additionalAgents) {
      if (agent.email && isValidEmail(agent.email) && agent.user_id && !assignees.some(a => a.user_id === agent.user_id)) {
        assignees.push({ user_id: agent.user_id, email: agent.email });
      }
    }

    // Send email to each assignee (excluding the comment author)
    for (const assignee of assignees) {
      if (assignee.user_id === userId) {
        continue;
      }

      await sendNotificationIfEnabled({
        tenantId,
        to: assignee.email,
        subject: `New Comment on Task: ${task.task_name}`,
        template: 'task-comment-added',
        context: emailContext,
        replyContext
      }, 'Task Comment Added', assignee.user_id);
    }

  } catch (error) {
    logger.error('[ProjectEmailSubscriber] Error handling task comment added event:', {
      error,
      eventId: event.id,
      taskId
    });
    throw error;
  }
}

/**
 * Handle all project events
 */
async function handleProjectEvent(event: BaseEvent): Promise<void> {
  logger.info('[ProjectEmailSubscriber] Handling project event:', {
    eventId: event.id,
    eventType: event.eventType,
    timestamp: event.timestamp
  });

  const eventSchema = EventSchemas[event.eventType];
  if (!eventSchema) {
    logger.warn('[ProjectEmailSubscriber] Unknown event type:', {
      eventType: event.eventType,
      eventId: event.id
    });
    return;
  }

  const validatedEvent = eventSchema.parse(event);

  switch (event.eventType) {
    case 'PROJECT_CREATED':
      await handleProjectCreated(validatedEvent as ProjectCreatedEvent);
      break;
    case 'PROJECT_UPDATED':
      await handleProjectUpdated(validatedEvent as ProjectUpdatedEvent);
      break;
    case 'PROJECT_CLOSED':
      await handleProjectClosed(validatedEvent as ProjectClosedEvent);
      break;
    case 'PROJECT_ASSIGNED':
      await handleProjectAssigned(validatedEvent as ProjectAssignedEvent);
      break;
    case 'PROJECT_TASK_ASSIGNED':
      await handleProjectTaskAssigned(validatedEvent as ProjectTaskAssignedEvent);
      break;
    case 'TASK_COMMENT_ADDED':
      await handleTaskCommentAdded(validatedEvent as TaskCommentAddedEvent);
      break;
    default:
      logger.warn('[ProjectEmailSubscriber] Unhandled project event type:', {
        eventType: event.eventType,
        eventId: event.id
      });
  }
}

/**
 * Register project email subscriber
 */
export async function registerProjectEmailSubscriber(): Promise<void> {
  try {
    logger.info('[ProjectEmailSubscriber] Starting registration');
    
    const projectEventTypes = [
      'PROJECT_CREATED',
      'PROJECT_UPDATED',
      'PROJECT_CLOSED',
      'PROJECT_ASSIGNED',
      'PROJECT_TASK_ASSIGNED',
      'TASK_COMMENT_ADDED'
    ] as const;

    const channel = getEmailEventChannel();
    logger.info('[ProjectEmailSubscriber] Using channel for subscriptions', { channel });

    for (const eventType of projectEventTypes) {
      // @ts-ignore - EventType union
      await getEventBus().subscribe(eventType, handleProjectEvent, { channel });
      logger.info(`[ProjectEmailSubscriber] Successfully subscribed to ${eventType} events on channel "${channel}"`);
    }

  } catch (error) {
    logger.error('Failed to register project email subscribers:', error);
    throw error;
  }
}

/**
 * Unregister project email subscriber
 */
export async function unregisterProjectEmailSubscriber(): Promise<void> {
  try {
    const projectEventTypes = [
      'PROJECT_CREATED',
      'PROJECT_UPDATED',
      'PROJECT_CLOSED',
      'PROJECT_ASSIGNED',
      'PROJECT_TASK_ASSIGNED',
      'TASK_COMMENT_ADDED'
    ] as const;

    const channel = getEmailEventChannel();

    for (const eventType of projectEventTypes) {
      // @ts-ignore - EventType union
      await getEventBus().unsubscribe(eventType, handleProjectEvent, { channel });
    }

    logger.info('[ProjectEmailSubscriber] Successfully unregistered from project events', { channel });
  } catch (error) {
    logger.error('Failed to unregister project email subscribers:', error);
    throw error;
  }
}
