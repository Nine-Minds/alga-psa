import { getEventBus } from '../index';
import {
  EventType,
  BaseEvent,
  EventSchemas,
  ProjectCreatedEvent,
  ProjectUpdatedEvent,
  ProjectClosedEvent,
  ProjectAssignedEvent,
  ProjectTaskAssignedEvent
} from '../events';
import { sendEventEmail, SendEmailParams } from '../../notifications/sendEventEmail';
import logger from '@shared/core/logger';
import { createTenantKnex } from '../../db';
import { formatBlockNoteContent } from '../../utils/blocknoteUtils';
import { getEmailEventChannel } from '@/lib/notifications/emailChannel';

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

    // 1. Check global notification settings
    const settings = await knex('notification_settings')
      .where({ tenant: params.tenantId })
      .first();

    if (settings && !settings.is_enabled) {
      logger.info('[ProjectEmailSubscriber] Notifications disabled globally for tenant:', {
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
      logger.warn('[ProjectEmailSubscriber] Notification subtype not found:', {
        subtypeName,
        recipient: params.to
      });
      // Continue anyway to avoid breaking existing functionality
      await sendEventEmail(params);
      return;
    }

    // 3. Check if subtype is enabled
    if (!subtype.is_enabled) {
      logger.info('[ProjectEmailSubscriber] Notification subtype disabled:', {
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
        logger.info('[ProjectEmailSubscriber] User has opted out of this notification type:', {
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
          logger.warn('[ProjectEmailSubscriber] Rate limit exceeded for user:', {
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
        logger.warn('[ProjectEmailSubscriber] Failed to log notification:', {
          error: logError instanceof Error ? logError.message : 'Unknown error',
          userId: recipientUserId,
          recipient: params.to
        });
      }
    }

  } catch (error) {
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
 * Format changes record into a readable string
 */
async function formatChanges(db: any, changes: Record<string, unknown>): Promise<string> {
  const formattedChanges = await Promise.all(
    Object.entries(changes).map(async ([field, value]) => {
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

  switch (field) {
    case 'status':
      const status = await db('statuses')
        .where('status_id', value)
        .first();
      return status?.name || String(value);

    case 'assigned_to':
    case 'updated_by':
    case 'closed_by':
      const user = await db('users')
        .where({
          user_id: value,
          is_inactive: false
        })
        .first();
      return user ? `${user.first_name} ${user.last_name}` : String(value);

    case 'client_id':
      const client = await db('clients')
        .where('client_id', value)
        .first();
      return client ? client.client_name : String(value);

      case 'contact_name_id':
        const contact_name = await db('contacts')
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

  return specialCases[field] || field
    .split('_')
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

    const { knex: db, tenant } = await createTenantKnex();
    
    logger.info('[ProjectEmailSubscriber] Fetching project details');
    
    // Get project details with debug logging
    const query = db('projects as p')
      .where('p.tenant', tenant!)
      .select(
        'p.*',
        'dcl.email as client_email',
        'c.client_name',
        's.name as status_name',
        'u.first_name as manager_first_name',
        'u.last_name as manager_last_name',
        'u.email as assigned_user_email',
        'ct.email as contact_email'
      )
      .leftJoin('clients as c', function() {
        this.on('c.client_id', '=', 'p.client_id')
            .andOn('c.tenant', '=', 'p.tenant');
      })
      .leftJoin('client_locations as dcl', function() {
        this.on('dcl.client_id', '=', 'p.client_id')
            .andOn('dcl.tenant', '=', 'p.tenant')
            .andOn('dcl.is_default', '=', db.raw('true'))
            .andOn('dcl.is_active', '=', db.raw('true'));
      })
      .leftJoin('statuses as s', function() {
        this.on('s.status_id', '=', 'p.status')
            .andOn('s.tenant', '=', 'p.tenant');
      })
      .leftJoin('users as u', function() {
        this.on('u.user_id', '=', 'p.assigned_to')
            .andOn('u.tenant', '=', 'p.tenant')
            .andOn('u.is_inactive', '=', db.raw('false'));
      })
      .leftJoin('contacts as ct', function() {
        this.on('ct.contact_name_id', '=', 'p.contact_name_id')
          .andOn('ct.tenant', '=', 'p.tenant');
      })
      .where('p.project_id', payload.projectId)
      .andWhere('p.tenant', tenantId);  // Add explicit tenant filter on main table

    // Log the query for debugging
    logger.info('[ProjectEmailSubscriber] Project query:', {
      sql: query.toString(),
      bindings: query.toSQL().bindings
    });

    const project = await query.first();

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
      const contact = await db('contacts')
        .where({
          contact_name_id: project.contact_name_id,
          tenant: tenant!
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
    if (project.contact_email) {
      recipients.push(project.contact_email);
      logger.info('[ProjectEmailSubscriber] Adding contact email as recipient', {
        contactEmail: project.contact_email
      });
    } else if (project.client_email) {
      recipients.push(project.client_email);
      logger.info('[ProjectEmailSubscriber] Adding client email as recipient', {
        clientEmail: project.client_email
      });
    }

    // Always add assigned user email if available
    if (project.assigned_user_email) {
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

    const emailContext = {
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
        url: `/projects/${project.project_number}`,
        client: project.client_name || 'No Client'
      }
    };

    const replyContext = {
      projectId: project.project_id || payload.projectId
    };

    // Send to contact or client (external users - no userId check)
    if (project.contact_email) {
      await sendNotificationIfEnabled({
        tenantId,
        to: project.contact_email,
        subject: `Project Created: ${project.project_name}`,
        template: 'project-created',
        context: emailContext,
        replyContext
      }, 'Project Created');
    } else if (project.client_email) {
      await sendNotificationIfEnabled({
        tenantId,
        to: project.client_email,
        subject: `Project Created: ${project.project_name}`,
        template: 'project-created',
        context: emailContext,
        replyContext
      }, 'Project Created');
    }

    // Send to assigned user (internal user - check preferences)
    if (project.assigned_user_email) {
      await sendNotificationIfEnabled({
        tenantId,
        to: project.assigned_user_email,
        subject: `Project Created: ${project.project_name}`,
        template: 'project-created',
        context: emailContext,
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
  const { tenantId, changes } = payload;

  // Check if the status change indicates the project is being closed
  if (changes?.status) {
    const { knex: db, tenant } = await createTenantKnex();
    const status = await db('statuses')
      .where('status_id', changes.status)
      .andWhere('tenant', tenant!)
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
    const { knex: db, tenant } = await createTenantKnex();
    
    // Get project details with debug logging
    const query = db('projects as p')
      .where('p.tenant', tenant!)
      .select(
        'p.*',
        'dcl.email as client_email',
        'c.client_name',
        's.name as status_name',
        'u.first_name as manager_first_name',
        'u.last_name as manager_last_name',
        'u.email as assigned_user_email',
        'ct.email as contact_email'
      )
      .leftJoin('clients as c', function() {
        this.on('c.client_id', '=', 'p.client_id')
            .andOn('c.tenant', '=', 'p.tenant');
      })
      .leftJoin('client_locations as dcl', function() {
        this.on('dcl.client_id', '=', 'p.client_id')
            .andOn('dcl.tenant', '=', 'p.tenant')
            .andOn('dcl.is_default', '=', db.raw('true'))
            .andOn('dcl.is_active', '=', db.raw('true'));
      })
      .leftJoin('statuses as s', function() {
        this.on('s.status_id', '=', 'p.status')
            .andOn('s.tenant', '=', 'p.tenant');
      })
      .leftJoin('users as u', function() {
        this.on('u.user_id', '=', 'p.assigned_to')
            .andOn('u.tenant', '=', 'p.tenant')
            .andOn('u.is_inactive', '=', db.raw('false'));
      })
      .leftJoin('contacts as ct', function() {
        this.on('ct.contact_name_id', '=', 'p.contact_name_id')
          .andOn('ct.tenant', '=', 'p.tenant');
      })
      .where('p.project_id', payload.projectId)
      .andWhere('p.tenant', tenantId);  // Add explicit tenant filter on main table

    // Log the query for debugging
    logger.info('[ProjectEmailSubscriber] Project query:', {
      sql: query.toString(),
      bindings: query.toSQL().bindings
    });

    const project = await query.first();

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
      const contact = await db('contacts')
        .where({
          contact_name_id: project.contact_name_id,
          tenant: tenant!
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
    if (project.contact_email) {
      recipients.push(project.contact_email);
      logger.info('[ProjectEmailSubscriber] Adding contact email as recipient', {
        contactEmail: project.contact_email
      });
    } else if (project.client_email) {
      recipients.push(project.client_email);
      logger.info('[ProjectEmailSubscriber] Adding client email as recipient', {
        clientEmail: project.client_email
      });
    }

    // Always add assigned user email if available
    if (project.assigned_user_email) {
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
    const formattedChanges = await formatChanges(db, payload.changes || {});

    // Log the formatted changes
    logger.info('[ProjectEmailSubscriber] Formatted changes:', {
      projectId: payload.projectId,
      formattedChanges
    });

    // Get updater's name
    const updater = await db('users')
      .where({
        user_id: payload.userId,
        is_inactive: false,
        tenant: tenant!
      })
      .first();

    const emailContext = {
      project: {
        id: project.project_number,
        name: project.project_name,
        status: project.status_name || 'Unknown',
        manager: project.manager_first_name && project.manager_last_name ?
          `${project.manager_first_name} ${project.manager_last_name}` : 'Unassigned',
        changes: formattedChanges,
        updatedBy: updater ? `${updater.first_name} ${updater.last_name}` : payload.userId,
        url: `/projects/${project.project_number}`,
        client: project.client_name || 'No Client'
      }
    };

    const replyContext = {
      projectId: project.project_id || payload.projectId
    };

    // Send to contact or client (external users - no userId check)
    if (project.contact_email) {
      await sendNotificationIfEnabled({
        tenantId,
        to: project.contact_email,
        subject: `Project Updated: ${project.project_name}`,
        template: 'project-updated',
        context: emailContext,
        replyContext
      }, 'Project Updated');
    } else if (project.client_email) {
      await sendNotificationIfEnabled({
        tenantId,
        to: project.client_email,
        subject: `Project Updated: ${project.project_name}`,
        template: 'project-updated',
        context: emailContext,
        replyContext
      }, 'Project Updated');
    }

    // Send to assigned user (internal user - check preferences)
    if (project.assigned_user_email) {
      await sendNotificationIfEnabled({
        tenantId,
        to: project.assigned_user_email,
        subject: `Project Updated: ${project.project_name}`,
        template: 'project-updated',
        context: emailContext,
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
  
  try {
    const { knex: db, tenant } = await createTenantKnex();
    
    // Get project details with debug logging
    const query = db('projects as p')
      .select(
        'p.*',
        'dcl.email as client_email',
        'c.client_name',
        's.name as status_name',
        'u.first_name as manager_first_name',
        'u.last_name as manager_last_name',
        'u.email as assigned_user_email',
        'ct.email as contact_email'
      )
      .leftJoin('clients as c', function() {
        this.on('c.client_id', '=', 'p.client_id')
            .andOn('c.tenant', '=', 'p.tenant');
      })
      .leftJoin('client_locations as dcl', function() {
        this.on('dcl.client_id', '=', 'p.client_id')
            .andOn('dcl.tenant', '=', 'p.tenant')
            .andOn('dcl.is_default', '=', db.raw('true'))
            .andOn('dcl.is_active', '=', db.raw('true'));
      })
      .leftJoin('statuses as s', function() {
        this.on('s.status_id', '=', 'p.status')
            .andOn('s.tenant', '=', 'p.tenant');
      })
      .leftJoin('users as u', function() {
        this.on('u.user_id', '=', 'p.assigned_to')
            .andOn('u.tenant', '=', 'p.tenant')
            .andOn('u.is_inactive', '=', db.raw('false'));
      })
      .leftJoin('contacts as ct', function() {
        this.on('ct.contact_name_id', '=', 'p.contact_name_id')
          .andOn('ct.tenant', '=', 'p.tenant');
      })
      .where('p.project_id', payload.projectId)
      .andWhere('p.tenant', tenantId);  // Add explicit tenant filter on main table

    // Log the query for debugging
    logger.info('[ProjectEmailSubscriber] Project query:', {
      sql: query.toString(),
      bindings: query.toSQL().bindings
    });

    const project = await query.first();

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
      const contact = await db('contacts')
        .where({
          contact_name_id: project.contact_name_id,
          tenant: tenant!
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
    if (project.contact_email) {
      recipients.push(project.contact_email);
      logger.info('[ProjectEmailSubscriber] Adding contact email as recipient', {
        contactEmail: project.contact_email
      });
    } else if (project.client_email) {
      recipients.push(project.client_email);
      logger.info('[ProjectEmailSubscriber] Adding client email as recipient', {
        clientEmail: project.client_email
      });
    }

    // Always add assigned user email if available
    if (project.assigned_user_email) {
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

    const emailContext = {
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
        changes: await formatChanges(db, payload.changes || {}),
        closedBy: await resolveValue(db, 'closed_by', payload.userId),
        closedAt: new Date().toISOString(),
        url: `/projects/${project.project_number}`,
        client: project.client_name || 'No Client'
      }
    };

    const replyContext = {
      projectId: project.project_id || payload.projectId
    };

    // Send to contact or client (external users - no userId check)
    if (project.contact_email) {
      await sendNotificationIfEnabled({
        tenantId,
        to: project.contact_email,
        subject: `Project Closed: ${project.project_name}`,
        template: 'project-closed',
        context: emailContext,
        replyContext
      }, 'Project Closed');
    } else if (project.client_email) {
      await sendNotificationIfEnabled({
        tenantId,
        to: project.client_email,
        subject: `Project Closed: ${project.project_name}`,
        template: 'project-closed',
        context: emailContext,
        replyContext
      }, 'Project Closed');
    }

    // Send to assigned user (internal user - check preferences)
    if (project.assigned_user_email) {
      await sendNotificationIfEnabled({
        tenantId,
        to: project.assigned_user_email,
        subject: `Project Closed: ${project.project_name}`,
        template: 'project-closed',
        context: emailContext,
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
    const { knex: db, tenant } = await createTenantKnex();
    
    // Get project and user details
    const query = db('projects as p')
      .select(
        'p.*',
        'c.client_name',
        'dcl.email as client_email',
        'u.email as user_email',
        'u.first_name as user_first_name',
        'u.last_name as user_last_name',
        'au.first_name as assigner_first_name',
        'au.last_name as assigner_last_name'
      )
      .leftJoin('clients as c', function() {
        this.on('c.client_id', '=', 'p.client_id')
            .andOn('c.tenant', '=', 'p.tenant');
      })
      .leftJoin('client_locations as dcl', function() {
        this.on('dcl.client_id', '=', 'p.client_id')
            .andOn('dcl.tenant', '=', 'p.tenant')
            .andOn('dcl.is_default', '=', db.raw('true'))
            .andOn('dcl.is_active', '=', db.raw('true'));
      })
      .leftJoin('users as u', function() {
        this.on('u.user_id', '=', assignedTo)
            .andOn('u.tenant', '=', 'p.tenant')
            .andOn('u.is_inactive', '=', db.raw('false'));
      })
      .leftJoin('users as au', function() {
        this.on('au.user_id', '=', db.raw('?', [payload.userId]))
            .andOn('au.tenant', '=', 'p.tenant')
            .andOn('au.is_inactive', '=', db.raw('false'));
      })
      .where('p.project_id', payload.projectId)
      .andWhere('p.tenant', tenantId);  // Add explicit tenant filter on main table

    // Log the query for debugging
    logger.info('[ProjectEmailSubscriber] Project query:', {
      sql: query.toString(),
      bindings: query.toSQL().bindings
    });

    const project = await query.first();

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

    if (!project.user_email) {
      logger.warn('Could not send project assigned email - user email not found:', {
        eventId: event.id,
        projectId: payload.projectId,
        userId: assignedTo,
        project
      });
      return;
    }

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
          assignedBy: `${project.assigner_first_name} ${project.assigner_last_name}`,
          url: `/projects/${project.project_number}`,
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
  const { tenantId, assignedTo, additionalUsers = [] } = payload;
  
  try {
    const { knex: db, tenant } = await createTenantKnex();
    
    // Get task, project and user details
    const query = db('project_tasks as t')
      .select(
        't.task_id',
        't.task_name',
        't.description',
        't.due_date',
        'p.project_name',
        'p.project_id',
        'p.wbs_code as project_number',
        'u.email as user_email',
        'u.first_name as user_first_name',
        'u.last_name as user_last_name',
        'au.first_name as assigner_first_name',
        'au.last_name as assigner_last_name'
      )
      .leftJoin('project_phases as ph', function() {
        this.on('ph.phase_id', '=', 't.phase_id')
            .andOn('ph.tenant', '=', 't.tenant');
      })
      .leftJoin('projects as p', function() {
        this.on('p.project_id', '=', 'ph.project_id')
            .andOn('p.tenant', '=', 'ph.tenant');
      })
      .leftJoin('users as u', function() {
        this.on('u.user_id', '=', 't.assigned_to')
            .andOn('u.tenant', '=', 't.tenant')
            .andOn('u.is_inactive', '=', db.raw('false'));
      })
      .leftJoin('users as au', function() {
        this.on('au.user_id', '=', db.raw('?', [payload.userId]))
            .andOn('au.tenant', '=', 't.tenant')
            .andOn('au.is_inactive', '=', db.raw('false'));
      })
      .where('t.task_id', payload.taskId)
      .andWhere('t.tenant', tenantId);  // Explicit tenant filter on main table

    logger.debug('[ProjectEmailSubscriber] Task query:', {
      sql: query.toString(),
      bindings: query.toSQL().bindings
    });

    const task = await query
      .first();

    if (!task) {
      logger.warn('Could not send task assigned email - task not found:', {
        eventId: event.id,
        taskId: payload.taskId
      });
      return;
    }

    // Get additional users' emails from task_resources
    const additionalUserEmails = await db('task_resources as tr')
      .select('u.email', 'u.user_id')
      .leftJoin('users as u', function() {
        this.on('u.user_id', '=', 'tr.additional_user_id')
            .andOn('u.tenant', '=', 'tr.tenant')
            .andOn('u.is_inactive', '=', db.raw('false'));
      })
      .where('tr.task_id', payload.taskId)
      .andWhere('tr.tenant', tenantId)  // Explicit tenant filter on main table
      .whereNotNull('tr.additional_user_id');

    // Send email to primary assignee
    if (task.user_email) {
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
            assignedBy: `${task.assigner_first_name} ${task.assigner_last_name}`,
            url: `/projects/${task.project_number}/tasks/${task.task_id}`,
            role: 'Primary Assignee'
          }
        },
        replyContext: {
          projectId: task.project_id || payload.projectId
        }
      }, 'Project Task Assigned', assignedTo);
    }

    // Send emails to additional users (deduplicate by user_id/email)
    const uniqueAdditionalUsers = additionalUserEmails.reduce<Map<string, typeof additionalUserEmails[number]>>(
      (acc, user) => {
        if (!user.email) {
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
            assignedBy: `${task.assigner_first_name} ${task.assigner_last_name}`,
            url: `/projects/${task.project_number}/tasks/${task.task_id}`,
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
      'PROJECT_TASK_ASSIGNED'
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
      'PROJECT_TASK_ASSIGNED'
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
