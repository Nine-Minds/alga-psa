import { getEventBus } from '../index';
import {
  EventType,
  BaseEvent,
  EventSchemas,
  TicketCreatedEvent,
  TicketUpdatedEvent,
  TicketClosedEvent,
  TicketAssignedEvent,
  TicketCommentAddedEvent,
  ProjectCreatedEvent,
  ProjectAssignedEvent,
  ProjectTaskAssignedEvent,
  InvoiceGeneratedEvent,
  MessageSentEvent
} from '../events';
import { createNotificationFromTemplateAction } from '../../actions/internal-notification-actions/internalNotificationActions';
import logger from '@alga-psa/shared/core/logger';
import { getConnection } from '../../db/db';
import type { Knex } from 'knex';

/**
 * Handle ticket created events
 */
async function handleTicketCreated(event: TicketCreatedEvent): Promise<void> {
  const { payload } = event;
  const { tenantId, ticketId, userId } = payload;

  try {
    const db = await getConnection(tenantId);

    // Get ticket details including contact
    const ticket = await db('tickets as t')
      .select(
        't.ticket_id',
        't.ticket_number',
        't.title',
        't.assigned_to',
        't.contact_name_id',
        't.client_id',
        'c.client_name'
      )
      .leftJoin('clients as c', function() {
        this.on('t.client_id', 'c.client_id')
            .andOn('t.tenant', 'c.tenant');
      })
      .where('t.ticket_id', ticketId)
      .first();

    if (!ticket) {
      logger.warn('[InternalNotificationSubscriber] Ticket not found', {
        ticketId,
        tenantId
      });
      return;
    }

    // Create notification for assigned MSP user if ticket is assigned
    if (ticket.assigned_to) {
      await createNotificationFromTemplateAction({
        tenant: tenantId,
        user_id: ticket.assigned_to,
        template_name: 'ticket-created',
        type: 'info',
        category: 'tickets',
        link: `/msp/tickets/${ticketId}`,
        data: {
          ticketId: ticket.ticket_number || ticketId,
          ticketTitle: ticket.title,
          clientName: ticket.client_name || 'Unknown'
        }
      });

      logger.info('[InternalNotificationSubscriber] Created notification for ticket created (MSP user)', {
        ticketId,
        userId: ticket.assigned_to,
        tenantId
      });
    }

    // Create notification for client contact if they have portal access
    if (ticket.contact_name_id) {
      // Check if contact has a user account
      const contactUser = await db('users')
        .select('user_id', 'user_type')
        .where({
          contact_id: ticket.contact_name_id,
          tenant: tenantId,
          user_type: 'client'
        })
        .first();

      if (contactUser) {
        await createNotificationFromTemplateAction({
          tenant: tenantId,
          user_id: contactUser.user_id,
          template_name: 'ticket-created-client',
          type: 'info',
          category: 'tickets',
          link: `/client-portal/tickets/${ticketId}`,
          data: {
            ticketId: ticket.ticket_number || ticketId,
            ticketTitle: ticket.title
          }
        });

        logger.info('[InternalNotificationSubscriber] Created notification for ticket created (client portal)', {
          ticketId,
          userId: contactUser.user_id,
          tenantId
        });
      }
    }
  } catch (error) {
    logger.error('[InternalNotificationSubscriber] Error handling ticket created', {
      error,
      ticketId,
      tenantId
    });
  }
}

/**
 * Handle ticket assigned events
 */
async function handleTicketAssigned(event: TicketAssignedEvent): Promise<void> {
  const { payload } = event;
  const { tenantId, ticketId } = payload;

  try {
    const db = await getConnection(tenantId);

    // Get ticket details
    const ticket = await db('tickets')
      .select('ticket_id', 'ticket_number', 'title', 'assigned_to', 'tenant')
      .where({ ticket_id: ticketId, tenant: tenantId })
      .first();

    if (!ticket || !ticket.assigned_to) {
      logger.warn('[InternalNotificationSubscriber] Ticket not found or not assigned', {
        ticketId,
        tenantId
      });
      return;
    }

    // Create notification for assigned user
    await createNotificationFromTemplateAction({
      tenant: tenantId,
      user_id: ticket.assigned_to,
      template_name: 'ticket-assigned',
      type: 'info',
      category: 'tickets',
      link: `/msp/tickets/${ticketId}`,
      data: {
        ticketId: ticket.ticket_number || ticketId,
        ticketTitle: ticket.title
      }
    });

    logger.info('[InternalNotificationSubscriber] Created notification for ticket assigned', {
      ticketId,
      userId: ticket.assigned_to,
      tenantId
    });
  } catch (error) {
    logger.error('[InternalNotificationSubscriber] Error handling ticket assigned', {
      error,
      ticketId,
      tenantId
    });
  }
}

/**
 * Handle ticket updated events
 */
async function handleTicketUpdated(event: TicketUpdatedEvent): Promise<void> {
  const { payload } = event;
  const { tenantId, ticketId } = payload;

  try {
    const db = await getConnection(tenantId);

    // Get ticket details including contact
    const ticket = await db('tickets')
      .select('ticket_id', 'ticket_number', 'title', 'assigned_to', 'contact_name_id', 'tenant')
      .where({ ticket_id: ticketId, tenant: tenantId })
      .first();

    if (!ticket) {
      return;
    }

    // Create notification for assigned MSP user if ticket is assigned
    if (ticket.assigned_to) {
      await createNotificationFromTemplateAction({
        tenant: tenantId,
        user_id: ticket.assigned_to,
        template_name: 'ticket-updated',
        type: 'info',
        category: 'tickets',
        link: `/msp/tickets/${ticketId}`,
        data: {
          ticketId: ticket.ticket_number || ticketId,
          ticketTitle: ticket.title
        }
      });

      logger.info('[InternalNotificationSubscriber] Created notification for ticket updated (MSP user)', {
        ticketId,
        userId: ticket.assigned_to,
        tenantId
      });
    }

    // Create notification for client contact if they have portal access
    if (ticket.contact_name_id) {
      const contactUser = await db('users')
        .select('user_id', 'user_type')
        .where({
          contact_id: ticket.contact_name_id,
          tenant: tenantId,
          user_type: 'client'
        })
        .first();

      if (contactUser) {
        await createNotificationFromTemplateAction({
          tenant: tenantId,
          user_id: contactUser.user_id,
          template_name: 'ticket-updated-client',
          type: 'info',
          category: 'tickets',
          link: `/client-portal/tickets/${ticketId}`,
          data: {
            ticketId: ticket.ticket_number || ticketId,
            ticketTitle: ticket.title
          }
        });

        logger.info('[InternalNotificationSubscriber] Created notification for ticket updated (client portal)', {
          ticketId,
          userId: contactUser.user_id,
          tenantId
        });
      }
    }
  } catch (error) {
    logger.error('[InternalNotificationSubscriber] Error handling ticket updated', {
      error,
      ticketId,
      tenantId
    });
  }
}

/**
 * Handle ticket closed events
 */
async function handleTicketClosed(event: TicketClosedEvent): Promise<void> {
  const { payload } = event;
  const { tenantId, ticketId } = payload;

  try {
    const db = await getConnection(tenantId);

    // Get ticket details including contact
    const ticket = await db('tickets')
      .select('ticket_id', 'ticket_number', 'title', 'assigned_to', 'contact_name_id', 'tenant')
      .where({ ticket_id: ticketId, tenant: tenantId })
      .first();

    if (!ticket) {
      return;
    }

    // Create notification for assigned MSP user if ticket is assigned
    if (ticket.assigned_to) {
      await createNotificationFromTemplateAction({
        tenant: tenantId,
        user_id: ticket.assigned_to,
        template_name: 'ticket-closed',
        type: 'success',
        category: 'tickets',
        link: `/msp/tickets/${ticketId}`,
        data: {
          ticketId: ticket.ticket_number || ticketId,
          ticketTitle: ticket.title
        }
      });

      logger.info('[InternalNotificationSubscriber] Created notification for ticket closed (MSP user)', {
        ticketId,
        userId: ticket.assigned_to,
        tenantId
      });
    }

    // Create notification for client contact if they have portal access
    if (ticket.contact_name_id) {
      const contactUser = await db('users')
        .select('user_id', 'user_type')
        .where({
          contact_id: ticket.contact_name_id,
          tenant: tenantId,
          user_type: 'client'
        })
        .first();

      if (contactUser) {
        await createNotificationFromTemplateAction({
          tenant: tenantId,
          user_id: contactUser.user_id,
          template_name: 'ticket-closed-client',
          type: 'success',
          category: 'tickets',
          link: `/client-portal/tickets/${ticketId}`,
          data: {
            ticketId: ticket.ticket_number || ticketId,
            ticketTitle: ticket.title
          }
        });

        logger.info('[InternalNotificationSubscriber] Created notification for ticket closed (client portal)', {
          ticketId,
          userId: contactUser.user_id,
          tenantId
        });
      }
    }
  } catch (error) {
    logger.error('[InternalNotificationSubscriber] Error handling ticket closed', {
      error,
      ticketId,
      tenantId
    });
  }
}

/**
 * Handle ticket comment added events
 */
async function handleTicketCommentAdded(event: TicketCommentAddedEvent): Promise<void> {
  const { payload } = event;
  const { tenantId, ticketId, userId, comment } = payload;

  try {
    const db = await getConnection(tenantId);

    // Get ticket details including contact
    const ticket = await db('tickets')
      .select('ticket_id', 'ticket_number', 'title', 'assigned_to', 'contact_name_id', 'tenant')
      .where({ ticket_id: ticketId, tenant: tenantId })
      .first();

    if (!ticket) {
      return;
    }

    // Get author name
    const author = await db('users')
      .select('first_name', 'last_name')
      .where({ user_id: userId, tenant: tenantId })
      .first();

    const authorName = author ? `${author.first_name} ${author.last_name}` : 'Someone';

    // Create notification for assigned MSP user (if not the comment author)
    if (ticket.assigned_to && ticket.assigned_to !== userId) {
      await createNotificationFromTemplateAction({
        tenant: tenantId,
        user_id: ticket.assigned_to,
        template_name: 'ticket-comment-added',
        type: 'info',
        category: 'tickets',
        link: `/msp/tickets/${ticketId}`,
        data: {
          authorName,
          ticketId: ticket.ticket_number || ticketId
        }
      });

      logger.info('[InternalNotificationSubscriber] Created notification for ticket comment (MSP user)', {
        ticketId,
        userId: ticket.assigned_to,
        tenantId
      });
    }

    // Create notification for client contact if they have portal access (and are not the comment author)
    // Skip if comment is internal - internal comments are not visible to client portal users
    if (ticket.contact_name_id && !comment?.isInternal) {
      const contactUser = await db('users')
        .select('user_id', 'user_type')
        .where({
          contact_id: ticket.contact_name_id,
          tenant: tenantId,
          user_type: 'client'
        })
        .first();

      if (contactUser && contactUser.user_id !== userId) {
        await createNotificationFromTemplateAction({
          tenant: tenantId,
          user_id: contactUser.user_id,
          template_name: 'ticket-comment-added-client',
          type: 'info',
          category: 'tickets',
          link: `/client-portal/tickets/${ticketId}`,
          data: {
            authorName,
            ticketId: ticket.ticket_number || ticketId
          }
        });

        logger.info('[InternalNotificationSubscriber] Created notification for ticket comment (client portal)', {
          ticketId,
          userId: contactUser.user_id,
          tenantId
        });
      }
    }
  } catch (error) {
    logger.error('[InternalNotificationSubscriber] Error handling ticket comment added', {
      error,
      ticketId,
      tenantId
    });
  }
}

/**
 * Handle project created events
 */
async function handleProjectCreated(event: ProjectCreatedEvent): Promise<void> {
  const { payload } = event;
  const { tenantId, projectId, userId } = payload;

  try {
    const db = await getConnection(tenantId);

    // Get project details
    const project = await db('projects as p')
      .select(
        'p.project_id',
        'p.project_name',
        'p.wbs_code',
        'c.client_name'
      )
      .leftJoin('companies as c', function() {
        this.on('p.company_id', 'c.company_id')
            .andOn('p.tenant', 'c.tenant');
      })
      .where('p.project_id', projectId)
      .first();

    if (!project) {
      logger.warn('[InternalNotificationSubscriber] Project not found', {
        projectId,
        tenantId
      });
      return;
    }

    // Get project manager
    const projectManager = await db('project_team_members')
      .select('user_id')
      .where({
        project_id: projectId,
        tenant: tenantId,
        role: 'manager'
      })
      .first();

    if (projectManager && projectManager.user_id !== userId) {
      await createNotificationFromTemplateAction({
        tenant: tenantId,
        user_id: projectManager.user_id,
        template_name: 'project-created',
        type: 'info',
        category: 'projects',
        link: `/msp/projects/${projectId}`,
        data: {
          projectName: project.project_name,
          clientName: project.client_name || 'Unknown'
        }
      });

      logger.info('[InternalNotificationSubscriber] Created notification for project created', {
        projectId,
        userId: projectManager.user_id,
        tenantId
      });
    }
  } catch (error) {
    logger.error('[InternalNotificationSubscriber] Error handling project created', {
      error,
      projectId,
      tenantId
    });
  }
}

/**
 * Handle project assigned events
 */
async function handleProjectAssigned(event: ProjectAssignedEvent): Promise<void> {
  const { payload } = event;
  const { tenantId, projectId, assignedTo } = payload;

  try {
    const db = await getConnection(tenantId);

    // Get project details
    const project = await db('projects')
      .select('project_id', 'project_name', 'tenant')
      .where({ project_id: projectId, tenant: tenantId })
      .first();

    if (!project || !assignedTo) {
      logger.warn('[InternalNotificationSubscriber] Project not found or not assigned', {
        projectId,
        tenantId
      });
      return;
    }

    // Create notification for assigned user
    await createNotificationFromTemplateAction({
      tenant: tenantId,
      user_id: assignedTo,
      template_name: 'project-assigned',
      type: 'info',
      category: 'projects',
      link: `/msp/projects/${projectId}`,
      data: {
        projectName: project.project_name
      }
    });

    logger.info('[InternalNotificationSubscriber] Created notification for project assigned', {
      projectId,
      userId: assignedTo,
      tenantId
    });
  } catch (error) {
    logger.error('[InternalNotificationSubscriber] Error handling project assigned', {
      error,
      projectId,
      tenantId
    });
  }
}

/**
 * Handle task assigned events
 */
async function handleTaskAssigned(event: ProjectTaskAssignedEvent): Promise<void> {
  const { payload } = event;
  const { tenantId, projectId, taskId, assignedTo } = payload;

  try {
    const db = await getConnection(tenantId);

    // Get task and project details
    const task = await db('project_tasks as pt')
      .select(
        'pt.task_name',
        'p.project_name'
      )
      .leftJoin('projects as p', function() {
        this.on('pt.project_id', 'p.project_id')
            .andOn('pt.tenant', 'p.tenant');
      })
      .where({
        'pt.task_id': taskId,
        'pt.tenant': tenantId
      })
      .first();

    if (!task || !assignedTo) {
      logger.warn('[InternalNotificationSubscriber] Task not found or not assigned', {
        taskId,
        projectId,
        tenantId
      });
      return;
    }

    // Create notification for assigned user
    await createNotificationFromTemplateAction({
      tenant: tenantId,
      user_id: assignedTo,
      template_name: 'task-assigned',
      type: 'info',
      category: 'projects',
      link: `/msp/projects/${projectId}/tasks/${taskId}`,
      data: {
        taskName: task.task_name,
        projectName: task.project_name
      }
    });

    logger.info('[InternalNotificationSubscriber] Created notification for task assigned', {
      taskId,
      projectId,
      userId: assignedTo,
      tenantId
    });
  } catch (error) {
    logger.error('[InternalNotificationSubscriber] Error handling task assigned', {
      error,
      taskId,
      projectId,
      tenantId
    });
  }
}

/**
 * Handle invoice generated events
 */
async function handleInvoiceGenerated(event: InvoiceGeneratedEvent): Promise<void> {
  const { payload } = event;
  const { tenantId, invoiceId, clientId, userId } = payload;

  try {
    const db = await getConnection(tenantId);

    // Get invoice and client details
    const invoice = await db('invoices as i')
      .select(
        'i.invoice_number',
        'c.client_name'
      )
      .leftJoin('clients as c', function() {
        this.on('i.company_id', 'c.client_id')
            .andOn('i.tenant', 'c.tenant');
      })
      .where('i.invoice_id', invoiceId)
      .first();

    if (!invoice) {
      logger.warn('[InternalNotificationSubscriber] Invoice not found', {
        invoiceId,
        tenantId
      });
      return;
    }

    // Get users who should be notified about invoices (e.g., accounting team)
    // For now, notify the user who created the invoice
    if (userId) {
      await createNotificationFromTemplateAction({
        tenant: tenantId,
        user_id: userId,
        template_name: 'invoice-generated',
        type: 'success',
        category: 'invoices',
        link: `/msp/invoices/${invoiceId}`,
        data: {
          invoiceNumber: invoice.invoice_number || invoiceId,
          clientName: invoice.client_name || 'Unknown'
        }
      });

      logger.info('[InternalNotificationSubscriber] Created notification for invoice generated', {
        invoiceId,
        userId,
        tenantId
      });
    }
  } catch (error) {
    logger.error('[InternalNotificationSubscriber] Error handling invoice generated', {
      error,
      invoiceId,
      tenantId
    });
  }
}

/**
 * Handle message sent events
 */
async function handleMessageSent(event: MessageSentEvent): Promise<void> {
  const { payload } = event;
  const { tenantId, recipientId, senderName, messagePreview, conversationId } = payload;

  try {
    // Create notification for the recipient
    await createNotificationFromTemplateAction({
      tenant: tenantId,
      user_id: recipientId,
      template_name: 'message-sent',
      type: 'info',
      category: 'messages',
      link: conversationId ? `/msp/messages/${conversationId}` : '/msp/messages',
      data: {
        senderName,
        messagePreview
      }
    });

    logger.info('[InternalNotificationSubscriber] Created notification for message sent', {
      recipientId,
      tenantId
    });
  } catch (error) {
    logger.error('[InternalNotificationSubscriber] Error handling message sent', {
      error,
      recipientId,
      tenantId
    });
  }
}

/**
 * Handle all internal notification events
 */
async function handleInternalNotificationEvent(event: BaseEvent): Promise<void> {
  const eventSchema = EventSchemas[event.eventType];
  if (!eventSchema) {
    logger.warn('[InternalNotificationSubscriber] Unknown event type:', {
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
    case 'TICKET_ASSIGNED':
      await handleTicketAssigned(validatedEvent as TicketAssignedEvent);
      break;
    case 'TICKET_UPDATED':
      await handleTicketUpdated(validatedEvent as TicketUpdatedEvent);
      break;
    case 'TICKET_CLOSED':
      await handleTicketClosed(validatedEvent as TicketClosedEvent);
      break;
    case 'TICKET_COMMENT_ADDED':
      await handleTicketCommentAdded(validatedEvent as TicketCommentAddedEvent);
      break;
    case 'PROJECT_CREATED':
      await handleProjectCreated(validatedEvent as ProjectCreatedEvent);
      break;
    case 'PROJECT_ASSIGNED':
      await handleProjectAssigned(validatedEvent as ProjectAssignedEvent);
      break;
    case 'PROJECT_TASK_ASSIGNED':
      await handleTaskAssigned(validatedEvent as ProjectTaskAssignedEvent);
      break;
    case 'INVOICE_GENERATED':
      await handleInvoiceGenerated(validatedEvent as InvoiceGeneratedEvent);
      break;
    case 'MESSAGE_SENT':
      await handleMessageSent(validatedEvent as MessageSentEvent);
      break;
    default:
      // Silently ignore other events
      break;
  }
}

/**
 * Register internal notification subscriber
 */
export async function registerInternalNotificationSubscriber(): Promise<void> {
  try {
    logger.info('[InternalNotificationSubscriber] Starting registration');

    const eventTypes: EventType[] = [
      'TICKET_CREATED',
      'TICKET_ASSIGNED',
      'TICKET_UPDATED',
      'TICKET_CLOSED',
      'TICKET_COMMENT_ADDED',
      'PROJECT_CREATED',
      'PROJECT_ASSIGNED',
      'PROJECT_TASK_ASSIGNED',
      'INVOICE_GENERATED',
      'MESSAGE_SENT'
    ];

    // Use a dedicated channel for internal notifications
    const channel = 'internal-notifications';

    for (const eventType of eventTypes) {
      await getEventBus().subscribe(eventType, handleInternalNotificationEvent, { channel });
      logger.info(`[InternalNotificationSubscriber] Subscribed to ${eventType} on channel "${channel}"`);
    }

    logger.info('[InternalNotificationSubscriber] Successfully registered for all internal notification events');
  } catch (error) {
    logger.error('[InternalNotificationSubscriber] Failed to register:', error);
    throw error;
  }
}

/**
 * Unregister internal notification subscriber
 */
export async function unregisterInternalNotificationSubscriber(): Promise<void> {
  try {
    const eventTypes: EventType[] = [
      'TICKET_CREATED',
      'TICKET_ASSIGNED',
      'TICKET_UPDATED',
      'TICKET_CLOSED',
      'TICKET_COMMENT_ADDED',
      'PROJECT_CREATED',
      'PROJECT_ASSIGNED',
      'PROJECT_TASK_ASSIGNED',
      'INVOICE_GENERATED',
      'MESSAGE_SENT'
    ];

    const channel = 'internal-notifications';

    for (const eventType of eventTypes) {
      await getEventBus().unsubscribe(eventType, handleInternalNotificationEvent, { channel });
    }

    logger.info('[InternalNotificationSubscriber] Successfully unregistered');
  } catch (error) {
    logger.error('[InternalNotificationSubscriber] Failed to unregister:', error);
    throw error;
  }
}
