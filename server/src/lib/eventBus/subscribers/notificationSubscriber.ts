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
  TimeEntryApprovedEvent
} from '../events';
import { NotificationPublisher } from '../../notifications/publisher';
import logger from '@shared/core/logger';
import { createTenantKnex } from '../../db';

/**
 * Configuration mapping event types to notification types and user determination logic
 */
interface NotificationEventConfig {
  notificationType: string;
  getUserIds: (event: any, tenantKnex: any) => Promise<string[]>;
  getTemplateData: (event: any, tenantKnex: any) => Promise<Record<string, any>>;
  getActionUrl?: (event: any, tenantKnex: any) => Promise<string | undefined>;
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
    getUserIds: async (event: TicketCreatedEvent, tenantKnex) => {
      // Notify managers and team leads for new tickets
      const managers = await tenantKnex('users')
        .where('tenant', event.payload.tenantId)
        .whereIn('role', ['admin', 'manager'])
        .where('is_active', true)
        .pluck('user_id');
      return managers.map((id: any) => String(id));
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
    getUserIds: async (event: TicketAssignedEvent, tenantKnex) => {
      // Notify the assigned user
      const ticket = await tenantKnex('tickets')
        .where('ticket_id', event.payload.ticketId)
        .first();
      
      return ticket?.assigned_to ? [String(ticket.assigned_to)] : [];
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
    getUserIds: async (event: TicketUpdatedEvent, tenantKnex) => {
      // Check if this is a priority escalation
      const priorityChange = event.payload.changes?.priority_id;
      const isPriorityEscalation = priorityChange && typeof priorityChange === 'object' && priorityChange;
      
      if (isPriorityEscalation) {
        // For priority escalations, notify managers and assigned user
        const ticket = await tenantKnex('tickets')
          .where('ticket_id', event.payload.ticketId)
          .first();
        
        const userIds = [];
        if (ticket?.assigned_to) {
          userIds.push(String(ticket.assigned_to));
        }
        
        // Notify managers for priority escalations
        const managers = await tenantKnex('users')
          .where('tenant', event.payload.tenantId)
          .whereIn('role', ['admin', 'manager'])
          .where('is_active', true)
          .pluck('user_id');
        userIds.push(...managers.map((id: any) => String(id)));
        
        return [...new Set(userIds)]; // Remove duplicates
      } else {
        // Regular update - notify assigned user and watchers
        const ticket = await tenantKnex('tickets')
          .where('ticket_id', event.payload.ticketId)
          .first();
        
        const userIds = [];
        if (ticket?.assigned_to) {
          userIds.push(String(ticket.assigned_to));
        }
        
        // TODO: Add watchers/followers when that feature exists
        return userIds;
      }
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
    getUserIds: async (event: ProjectTaskAssignedEvent, tenantKnex) => {
      // Notify the assigned user
      const task = await tenantKnex('project_tasks')
        .where('task_id', event.payload.taskId)
        .first();
      
      return task?.assigned_to ? [String(task.assigned_to)] : [];
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
    getUserIds: async (event: InvoiceGeneratedEvent, tenantKnex) => {
      // Notify accounting staff and managers
      const accountingUsers = await tenantKnex('users')
        .where('tenant', event.payload.tenantId)
        .whereIn('role', ['admin', 'manager', 'accountant'])
        .where('is_active', true)
        .pluck('user_id');
      return accountingUsers.map(id => String(id));
    },
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
    getUserIds: async (event: TicketCommentAddedEvent, tenantKnex) => {
      // Notify assigned user and managers, exclude comment author
      const ticket = await tenantKnex('tickets')
        .where('ticket_id', event.payload.ticketId)
        .first();
      
      const userIds = [];
      if (ticket?.assigned_to && ticket.assigned_to !== event.payload.userId) {
        userIds.push(String(ticket.assigned_to));
      }
      
      // Notify managers if comment is from client (external)
      if (!event.payload.comment?.isInternal) {
        const managers = await tenantKnex('users')
          .where('tenant', event.payload.tenantId)
          .whereIn('role', ['admin', 'manager'])
          .where('is_active', true)
          .where('user_id', '!=', event.payload.userId)
          .pluck('user_id');
        userIds.push(...managers.map((id: any) => String(id)));
      }
      
      // Check for @mentions in the comment
      if (event.payload.comment?.content) {
        const mentions = parseUserMentions(event.payload.comment.content);
        const mentionedUserIds = await getUserIdsFromMentions(mentions, event.payload.tenantId, tenantKnex);
        userIds.push(...mentionedUserIds);
      }
      
      return [...new Set(userIds)]; // Remove duplicates
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
    getUserIds: async (event: TicketClosedEvent, tenantKnex) => {
      // Notify assigned user and ticket creator
      const ticket = await tenantKnex('tickets')
        .where('ticket_id', event.payload.ticketId)
        .first();
      
      const userIds = [];
      if (ticket?.assigned_to) {
        userIds.push(String(ticket.assigned_to));
      }
      if (ticket?.entered_by && ticket.entered_by !== ticket.assigned_to) {
        userIds.push(String(ticket.entered_by));
      }
      
      return userIds;
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
    getUserIds: async (event: ProjectCreatedEvent, tenantKnex) => {
      // Notify project managers and team leads
      const managers = await tenantKnex('users')
        .where('tenant', event.payload.tenantId)
        .whereIn('role', ['admin', 'manager', 'project_manager'])
        .where('is_active', true)
        .pluck('user_id');
      return managers.map((id: any) => String(id));
    },
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
    getUserIds: async (event: ProjectAssignedEvent, tenantKnex) => {
      // Notify assigned user
      return event.payload.assignedTo ? [String(event.payload.assignedTo)] : [];
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
    getUserIds: async (event: ProjectClosedEvent, tenantKnex) => {
      // Notify project team members and managers
      const projectUsers = await tenantKnex('project_team_members')
        .where('project_id', event.payload.projectId)
        .pluck('user_id');
      
      const managers = await tenantKnex('users')
        .where('tenant', event.payload.tenantId)
        .whereIn('role', ['admin', 'manager'])
        .where('is_active', true)
        .pluck('user_id');
      
      return [...new Set([...projectUsers, ...managers])].map(id => String(id));
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
    getUserIds: async (event: TimeEntrySubmittedEvent, tenantKnex) => {
      // Notify managers for approval
      const managers = await tenantKnex('users')
        .where('tenant', event.payload.tenantId)
        .whereIn('role', ['admin', 'manager'])
        .where('is_active', true)
        .pluck('user_id');
      return managers.map((id: any) => String(id));
    },
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
    getUserIds: async (event: TimeEntryApprovedEvent, tenantKnex) => {
      // Notify the user who submitted the time entry
      const timeEntry = await tenantKnex('time_entries')
        .where('entry_id', event.payload.timeEntryId)
        .first();
      
      return timeEntry?.user_id ? [String(timeEntry.user_id)] : [];
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
    getUserIds: async (event: InvoiceFinalizedEvent, tenantKnex) => {
      // Notify accounting staff
      const accountingUsers = await tenantKnex('users')
        .where('tenant', event.payload.tenantId)
        .whereIn('role', ['admin', 'manager', 'accountant'])
        .where('is_active', true)
        .pluck('user_id');
      return accountingUsers.map(id => String(id));
    },
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
async function handleNotificationEvent(event: BaseEvent): Promise<void> {
  try {
    logger.info(`Processing notification event: ${event.eventType}`, { eventId: event.id });

    const config = eventNotificationConfigs[event.eventType];
    if (!config) {
      logger.debug(`No notification configuration for event type: ${event.eventType}`);
      return;
    }

    // Set up tenant-specific database connection
    const { knex: tenantKnex } = await createTenantKnex();
    
    // Get the notification type ID
    const notificationType = await tenantKnex('internal_notification_types')
      .where('type_name', config.notificationType)
      .first();

    if (!notificationType) {
      logger.error(`Notification type ${config.notificationType} not found`);
      return;
    }

    // Get user IDs to notify
    const userIds = await config.getUserIds(event, tenantKnex);
    if (userIds.length === 0) {
      logger.debug(`No users to notify for event ${event.eventType}`);
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
      for (const userId of userIds) {
        await publisher.publishNotification({
          user_id: userId,
          type_id: notificationType.internal_notification_type_id,
          title: '', // Will be populated from template
          data: templateData,
          action_url: actionUrl,
          priority_id: priorityId
        });
      }
      
      logger.info(`Created ${userIds.length} notifications for event ${event.eventType}`, {
        eventId: event.id,
        userIds,
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