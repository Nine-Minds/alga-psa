import { getEventBus } from '../index';
import { 
  EventType, 
  BaseEvent,
  TicketCreatedEvent,
  TicketUpdatedEvent,
  TicketClosedEvent,
  TicketAssignedEvent,
  TicketCommentAddedEvent,
  ProjectCreatedEvent,
  ProjectUpdatedEvent,
  ProjectAssignedEvent,
  ProjectTaskAssignedEvent,
  InvoiceGeneratedEvent,
  InvoiceFinalizedEvent,
  TimeEntrySubmittedEvent,
  TimeEntryApprovedEvent,
  ProjectClosedEvent
} from '../events';
import { NotificationPublisher } from '../../notifications/publisher';
import logger from '@shared/core/logger';
import { getConnection } from 'server/src/lib/db/db';
import { withTransaction } from '@shared/db';
import { getUsersWithPermission } from 'server/src/lib/actions/user-actions/userActions';
import { getUserInternalNotificationPreferences } from 'server/src/lib/actions/notification-actions/internalNotificationSettingsActions';

/**
 * Configuration mapping event types to notification types and user determination logic
 */
interface NotificationEventConfig {
  notificationType: string;
  permission: string;
  getTemplateData: (event: any, tenantKnex: any) => Promise<Record<string, any>>;
  getActionUrl?: (event: any, tenantKnex: any) => Promise<string | undefined>;
  getAdditionalUsers?: (event: any, tenantKnex: any) => Promise<string[]>;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
}

/**
 * Parse @mentions from text content
 */
function parseUserMentions(content: string): string[] {
  const mentionRegex = /@(\w+)/g;
  const mentions = [];
  let match;
  while ((match = mentionRegex.exec(content)) !== null) {
    mentions.push(match[1]); // Extract username without @
  }
  return mentions;
}

/**
 * Get user IDs from usernames/mentions
 */
async function getUserIdsFromMentions(mentions: string[], tenantId: string, tenantKnex: any): Promise<string[]> {
  if (mentions.length === 0) return [];
  
  const users = await tenantKnex('users')
    .where('tenant', tenantId)
    .where('is_active', true)
    .whereIn('username', mentions)
    .pluck('user_id');
  
  return users.map((id: any) => String(id));
}

/**
 * Event to notification configuration mapping
 */
const eventNotificationConfigs: Partial<Record<EventType, NotificationEventConfig>> = {
  'TICKET_CREATED': {
    notificationType: 'TICKET_CREATED',
    permission: 'user:read', // Only managers/supervisors get notified about all new tickets
    getAdditionalUsers: async (event: TicketCreatedEvent, tenantKnex) => {
      // Only notify managers - you could make this configurable
      return []; // For now, disable general ticket creation notifications
    },
    getTemplateData: async (event: TicketCreatedEvent, tenantKnex) => {
      const ticket = await tenantKnex('tickets')
        .where('ticket_id', event.payload.ticketId)
        .first();
      
      return {
        ticket_number: ticket?.ticket_number || '',
        ticket_title: ticket?.title || '',
        ticket_id: event.payload.ticketId
      };
    },
    getActionUrl: async (event: TicketCreatedEvent) => `/msp/tickets/${event.payload.ticketId}`,
    priority: 'normal'
  },

  'TICKET_ASSIGNED': {
    notificationType: 'TICKET_ASSIGNED',
    permission: 'nonexistent:permission', // Don't notify based on general permissions
    getAdditionalUsers: async (event: TicketAssignedEvent, tenantKnex) => {
      // Only notify the specifically assigned user
      const ticket = await tenantKnex('tickets').where('ticket_id', event.payload.ticketId).first();
      return ticket?.assigned_to ? [ticket.assigned_to] : [];
    },
    getTemplateData: async (event: TicketAssignedEvent, tenantKnex) => {
      const ticket = await tenantKnex('tickets')
        .where('ticket_id', event.payload.ticketId)
        .first();
      
      return {
        ticket_number: ticket?.ticket_number || '',
        ticket_title: ticket?.title || '',
        ticket_id: event.payload.ticketId
      };
    },
    getActionUrl: async (event: TicketAssignedEvent) => `/msp/tickets/${event.payload.ticketId}`,
    priority: 'normal'
  },

  'TICKET_UPDATED': {
    notificationType: 'TICKET_STATUS_CHANGED',
    permission: 'ticket:read', // Users who can read tickets can be notified about updates
    getAdditionalUsers: async (event: TicketUpdatedEvent, tenantKnex) => {
      const ticket = await tenantKnex('tickets').where('ticket_id', event.payload.ticketId).first();
      const userIds = new Set<string>();
      if (ticket?.assigned_to) {
        userIds.add(ticket.assigned_to);
      }
      const priorityChange = event.payload.changes?.priority_id;
      if (priorityChange && typeof priorityChange === 'object' && priorityChange) {
        const usersWithPerm = await getUsersWithPermission('notification:ticket:escalation', 'read', tenantKnex);
        usersWithPerm.forEach(id => userIds.add(id));
      }
      return Array.from(userIds);
    },
    getTemplateData: async (event: TicketUpdatedEvent, tenantKnex) => {
      const ticket = await tenantKnex('tickets')
        .where('ticket_id', event.payload.ticketId)
        .first();
      
      // Check if this is a priority escalation
      const priorityChange = event.payload.changes?.priority_id;
      if (priorityChange && typeof priorityChange === 'object' && priorityChange) {
        return {
          ticket_number: ticket?.ticket_number || '',
          ticket_title: ticket?.title || '',
          ticket_id: event.payload.ticketId,
          old_priority: 'Standard',
          new_priority: 'High'
        };
      }
      
      // Extract status change from event changes
      const statusChange = event.payload.changes?.status;
      const newStatus = typeof statusChange === 'object' && statusChange ? (statusChange as any).to : 'Updated';
      
      return {
        ticket_number: ticket?.ticket_number || '',
        ticket_title: ticket?.title || '',
        new_status: newStatus,
        ticket_id: event.payload.ticketId
      };
    },
    getActionUrl: async (event: TicketUpdatedEvent) => `/msp/tickets/${event.payload.ticketId}`,
    priority: 'low'
  },

  'PROJECT_TASK_ASSIGNED': {
    notificationType: 'PROJECT_TASK_ASSIGNED',
    permission: 'project:read', // Users who can read projects can be notified about task assignments
    getAdditionalUsers: async (event: ProjectTaskAssignedEvent, tenantKnex) => {
      const task = await tenantKnex('project_tasks').where('task_id', event.payload.taskId).first();
      return task?.assigned_to ? [task.assigned_to] : [];
    },
    getTemplateData: async (event: ProjectTaskAssignedEvent, tenantKnex) => {
      const task = await tenantKnex('project_tasks as pt')
        .join('projects as p', 'pt.project_id', 'p.project_id')
        .where('pt.task_id', event.payload.taskId)
        .select('pt.task_name', 'p.project_name', 'pt.project_id')
        .first();
      
      return {
        task_name: task?.task_name || '',
        project_name: task?.project_name || '',
        project_id: task?.project_id || '',
        task_id: event.payload.taskId
      };
    },
    getActionUrl: async (event: ProjectTaskAssignedEvent, tenantKnex) => {
      const task = await tenantKnex('project_tasks')
        .where('task_id', event.payload.taskId)
        .first();
      return task ? `/msp/projects/${task.project_id}` : undefined;
    },
    priority: 'normal'
  },

  'INVOICE_GENERATED': {
    notificationType: 'INVOICE_GENERATED',
    permission: 'billing:read', // Users who can read billing can be notified about invoices
    getTemplateData: async (event: InvoiceGeneratedEvent, tenantKnex) => {
      const invoice = await tenantKnex('invoices')
        .where('invoice_id', event.payload.invoiceId)
        .first();
      
      return {
        invoice_number: invoice?.invoice_number || '',
        amount: invoice?.total_amount ? `$${invoice.total_amount}` : '',
        invoice_id: event.payload.invoiceId
      };
    },
    getActionUrl: async (event: InvoiceGeneratedEvent) => `/msp/invoices/${event.payload.invoiceId}`,
    priority: 'normal'
  },

  'TICKET_COMMENT_ADDED': {
    notificationType: 'TICKET_CLIENT_RESPONSE',
    permission: 'ticket:read', // Users who can read tickets can be notified about client responses
    getAdditionalUsers: async (event: TicketCommentAddedEvent, tenantKnex) => {
      const ticket = await tenantKnex('tickets').where('ticket_id', event.payload.ticketId).first();
      const userIds = new Set<string>();
      if (ticket?.assigned_to && ticket.assigned_to !== event.payload.userId) {
        userIds.add(ticket.assigned_to);
      }
      if (event.payload.comment?.content) {
        const mentions = parseUserMentions(event.payload.comment.content);
        const mentionedUserIds = await getUserIdsFromMentions(mentions, event.payload.tenantId, tenantKnex);
        mentionedUserIds.forEach(id => userIds.add(id));
      }
      return Array.from(userIds);
    },
    getTemplateData: async (event: TicketCommentAddedEvent, tenantKnex) => {
      const ticket = await tenantKnex('tickets')
        .where('ticket_id', event.payload.ticketId)
        .first();
      
      // Check for mentions
      const mentions = event.payload.comment?.content ? parseUserMentions(event.payload.comment.content) : [];
      
      return {
        ticket_number: ticket?.ticket_number || '',
        ticket_title: ticket?.title || '',
        ticket_id: event.payload.ticketId,
        comment_preview: event.payload.comment?.content?.substring(0, 100) || '',
        mentions: mentions.join(', ')
      };
    },
    getActionUrl: async (event: TicketCommentAddedEvent) => `/msp/tickets/${event.payload.ticketId}`,
    priority: 'normal'
  },

  'TICKET_CLOSED': {
    notificationType: 'TICKET_STATUS_CHANGED',
    permission: 'ticket:read', // Users who can read tickets can be notified about closures
    getAdditionalUsers: async (event: TicketClosedEvent, tenantKnex) => {
      const ticket = await tenantKnex('tickets').where('ticket_id', event.payload.ticketId).first();
      const userIds = new Set<string>();
      if (ticket?.assigned_to) {
        userIds.add(ticket.assigned_to);
      }
      if (ticket?.entered_by && ticket.entered_by !== ticket.assigned_to) {
        userIds.add(ticket.entered_by);
      }
      return Array.from(userIds);
    },
    getTemplateData: async (event: TicketClosedEvent, tenantKnex) => {
      const ticket = await tenantKnex('tickets')
        .where('ticket_id', event.payload.ticketId)
        .first();
      
      return {
        ticket_number: ticket?.ticket_number || '',
        ticket_title: ticket?.title || '',
        new_status: 'Closed',
        ticket_id: event.payload.ticketId
      };
    },
    getActionUrl: async (event: TicketClosedEvent) => `/msp/tickets/${event.payload.ticketId}`,
    priority: 'low'
  },

  'PROJECT_CREATED': {
    notificationType: 'PROJECT_TASK_ASSIGNED', // Reusing for project notifications
    permission: 'project:read', // Users who can read projects can be notified about new projects
    getTemplateData: async (event: ProjectCreatedEvent, tenantKnex) => {
      const project = await tenantKnex('projects')
        .where('project_id', event.payload.projectId)
        .first();
      
      return {
        task_name: 'New Project Created',
        project_name: project?.project_name || '',
        project_id: event.payload.projectId
      };
    },
    getActionUrl: async (event: ProjectCreatedEvent) => `/msp/projects/${event.payload.projectId}`,
    priority: 'normal'
  },

  'PROJECT_ASSIGNED': {
    notificationType: 'PROJECT_TASK_ASSIGNED',
    permission: 'project:read', // Users who can read projects can be notified about assignments
    getAdditionalUsers: async (event: ProjectAssignedEvent, tenantKnex) => {
      return event.payload.assignedTo ? [event.payload.assignedTo] : [];
    },
    getTemplateData: async (event: ProjectAssignedEvent, tenantKnex) => {
      const project = await tenantKnex('projects')
        .where('project_id', event.payload.projectId)
        .first();
      
      return {
        task_name: 'Project Assignment',
        project_name: project?.project_name || '',
        project_id: event.payload.projectId
      };
    },
    getActionUrl: async (event: ProjectAssignedEvent) => `/msp/projects/${event.payload.projectId}`,
    priority: 'normal'
  },

  'PROJECT_CLOSED': {
    notificationType: 'PROJECT_TASK_ASSIGNED', // Reusing for project notifications
    permission: 'project:read', // Users who can read projects can be notified about closures
    getAdditionalUsers: async (event: ProjectClosedEvent, tenantKnex) => {
      const projectUsers = await tenantKnex('project_team_members')
        .where('project_id', event.payload.projectId)
        .pluck('user_id');
      return projectUsers.map((id: any) => String(id));
    },
    getTemplateData: async (event: ProjectClosedEvent, tenantKnex) => {
      const project = await tenantKnex('projects')
        .where('project_id', event.payload.projectId)
        .first();
      
      return {
        task_name: 'Project Completed',
        project_name: project?.project_name || '',
        project_id: event.payload.projectId
      };
    },
    getActionUrl: async (event: ProjectClosedEvent) => `/msp/projects/${event.payload.projectId}`,
    priority: 'normal'
  },

  'TIME_ENTRY_SUBMITTED': {
    notificationType: 'PROJECT_TASK_DUE', // Reusing as approval needed
    permission: 'user:read', // Managers who can read users can be notified about time submissions
    getTemplateData: async (event: TimeEntrySubmittedEvent, tenantKnex) => {
      const timeEntry = await tenantKnex('time_entries as te')
        .leftJoin('users as u', 'te.user_id', 'u.user_id')
        .where('te.entry_id', event.payload.timeEntryId)
        .select('te.*', 'u.first_name', 'u.last_name')
        .first();
      
      return {
        task_name: `Time Entry Approval`,
        due_date: 'pending approval',
        user_name: timeEntry ? `${timeEntry.first_name} ${timeEntry.last_name}` : 'Unknown',
        hours: timeEntry?.work_hours || 0
      };
    },
    getActionUrl: async (event: TimeEntrySubmittedEvent) => `/msp/time-tracking`,
    priority: 'normal'
  },

  'TIME_ENTRY_APPROVED': {
    notificationType: 'PROJECT_TASK_DUE', // Reusing for time entry notifications
    permission: 'user:read', // Users can be notified about their time entry approvals
    getAdditionalUsers: async (event: TimeEntryApprovedEvent, tenantKnex) => {
      const timeEntry = await tenantKnex('time_entries').where('entry_id', event.payload.timeEntryId).first();
      return timeEntry?.user_id ? [timeEntry.user_id] : [];
    },
    getTemplateData: async (event: TimeEntryApprovedEvent, tenantKnex) => {
      const timeEntry = await tenantKnex('time_entries')
        .where('entry_id', event.payload.timeEntryId)
        .first();
      
      return {
        task_name: `Time Entry Approved`,
        due_date: 'approved',
        hours: timeEntry?.work_hours || 0,
        entry_date: timeEntry?.work_date || ''
      };
    },
    getActionUrl: async (event: TimeEntryApprovedEvent) => `/msp/time-tracking`,
    priority: 'low'
  },

  'INVOICE_FINALIZED': {
    notificationType: 'INVOICE_PAYMENT_RECEIVED', // Reusing for invoice finalization
    permission: 'billing:read', // Users who can read billing can be notified about finalized invoices
    getTemplateData: async (event: InvoiceFinalizedEvent, tenantKnex) => {
      const invoice = await tenantKnex('invoices')
        .where('invoice_id', event.payload.invoiceId)
        .first();
      
      return {
        invoice_number: invoice?.invoice_number || '',
        amount: invoice?.total_amount ? `$${invoice.total_amount}` : '',
        invoice_id: event.payload.invoiceId
      };
    },
    getActionUrl: async (event: InvoiceFinalizedEvent) => `/msp/invoices/${event.payload.invoiceId}`,
    priority: 'normal'
  }
};

/**
 * Handle notification events by creating appropriate in-app notifications
 */
export async function handleNotificationEvent(event: BaseEvent): Promise<void> {
  try {
    console.log('🔔 [NOTIFICATION SUBSCRIBER] Event received!', {
      eventType: event.eventType,
      eventId: event.id,
      payload: event.payload
    });
    
    logger.info(`[NOTIFICATION DEBUG] Processing event: ${event.eventType}`, { 
      eventId: event.id, 
      payload: event.payload 
    });

    const config = eventNotificationConfigs[event.eventType];
    if (!config) {
      logger.info(`[NOTIFICATION DEBUG] No configuration for event type: ${event.eventType}`);
      return;
    }
    
    logger.info(`[NOTIFICATION DEBUG] Found config for ${event.eventType}`, { 
      notificationType: config.notificationType,
      permission: config.permission 
    });

    // Extract tenant from event payload
    const tenantId = (event.payload as any)?.tenantId;
    if (!tenantId) {
      logger.error(`No tenant information in event ${event.eventType}`, { eventId: event.id });
      return;
    }

    // Set up tenant-specific database connection
    const tenantKnex = await getConnection(tenantId);
    
    // Get the notification type ID
    const notificationType = await tenantKnex('internal_notification_types')
      .where('type_name', config.notificationType)
      .first();

    if (!notificationType) {
      logger.error(`Notification type ${config.notificationType} not found`);
      return;
    }

    // Get user IDs to notify
    const [resource, action] = config.permission.split(':');
    const usersWithPermission = await getUsersWithPermission(resource, action, tenantKnex);
    const additionalUsers = config.getAdditionalUsers ? await config.getAdditionalUsers(event, tenantKnex) : [];
    const allUserIds = [...new Set([...usersWithPermission, ...additionalUsers])];

    logger.info(`[NOTIFICATION DEBUG] Users to notify for ${event.eventType}`, {
      usersWithPermission: usersWithPermission.length,
      additionalUsers: additionalUsers.length,
      totalUsers: allUserIds.length,
      userIds: allUserIds
    });

    if (allUserIds.length === 0) {
      logger.info(`[NOTIFICATION DEBUG] No users to notify for event ${event.eventType}`);
      return;
    }

    // Filter users based on their notification preferences
    const userPreferences = await getUserInternalNotificationPreferences(allUserIds, tenantId);
    const userIdsToNotify = allUserIds
        .filter(userId => {
            const pref = userPreferences.find(p => p.internal_notification_type_id === notificationType.internal_notification_type_id && p.user_id === userId);
            return pref ? pref.enabled : true; // Default to notify if no preference is set
        });

    if (userIdsToNotify.length === 0) {
        logger.debug(`All users for event ${event.eventType} have disabled this notification`);
        return;
    }

    // Get template data
    const templateData = await config.getTemplateData(event, tenantKnex);
    
    // Get action URL if configured
    const actionUrl = config.getActionUrl ? await config.getActionUrl(event, tenantKnex) : undefined;

    // Get priority if specified
    let priorityId = undefined;
    if (config.priority) {
      const priority = await tenantKnex('standard_priorities')
        .where('item_type', 'internal_notification')
        .where('priority_name', config.priority)
        .first();
      priorityId = priority?.priority_id;
    }

    // Create notifications for each user
    const publisher = new NotificationPublisher();
    try {
      for (const userId of userIdsToNotify) {
        await publisher.publishNotification({
          user_id: userId,
          type_id: notificationType.internal_notification_type_id,
          title: '', // Will be populated from template
          data: templateData,
          action_url: actionUrl,
          priority_id: priorityId
        }, tenantId);
      }
      
      logger.info(`Created ${userIdsToNotify.length} notifications for event ${event.eventType}`, {
        eventId: event.id,
        userIds: userIdsToNotify,
        notificationType: config.notificationType
      });
    } finally {
      publisher.disconnect();
    }

  } catch (error) {
    logger.error(`Failed to handle notification event: ${event.eventType}`, {
      eventId: event.id,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * Register notification subscriber for all relevant event types
 */
export async function registerNotificationSubscriber(): Promise<void> {
  const eventBus = getEventBus();
  
  // Subscribe to all configured event types
  const eventTypes = Object.keys(eventNotificationConfigs) as EventType[];
  
  for (const eventType of eventTypes) {
    await eventBus.subscribe(eventType, handleNotificationEvent);
    logger.info(`Registered notification subscriber for ${eventType}`);
  }
}

/**
 * Unregister notification subscriber
 */
export async function unregisterNotificationSubscriber(): Promise<void> {
  const eventBus = getEventBus();
  
  // Unsubscribe from all configured event types
  const eventTypes = Object.keys(eventNotificationConfigs) as EventType[];
  
  for (const eventType of eventTypes) {
    await eventBus.unsubscribe(eventType, handleNotificationEvent);
    logger.info(`Unregistered notification subscriber for ${eventType}`);
  }
}