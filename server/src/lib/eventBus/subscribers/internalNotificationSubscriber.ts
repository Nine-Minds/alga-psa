import { getEventBus } from '../index';
import {
  EventType,
  BaseEvent,
  EventSchemas,
  TicketCreatedEvent,
  TicketUpdatedEvent,
  TicketClosedEvent,
  TicketAssignedEvent,
  TicketAdditionalAgentAssignedEvent,
  TicketCommentAddedEvent,
  TicketCommentUpdatedEvent,
  ProjectCreatedEvent,
  ProjectAssignedEvent,
  ProjectTaskAssignedEvent,
  ProjectTaskAdditionalAgentAssignedEvent,
  TaskCommentAddedEvent,
  TaskCommentUpdatedEvent,
  InvoiceGeneratedEvent,
  MessageSentEvent,
  UserMentionedInDocumentEvent,
  AppointmentRequestCreatedEvent,
  AppointmentRequestApprovedEvent,
  AppointmentRequestDeclinedEvent,
  AppointmentRequestCancelledEvent
} from '../events';
import { createNotificationFromTemplateInternal } from '../../actions/internal-notification-actions/internalNotificationActions';
import logger from '@alga-psa/shared/core/logger';
import { getConnection } from '../../db/db';
import type { Knex } from 'knex';
import { convertBlockNoteToMarkdown } from '../../utils/blocknoteUtils';
import { resolveNotificationLinks } from '../../utils/notificationLinkResolver';

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

    // Resolve links for both MSP and client portal
    const { internalUrl, portalUrl } = await resolveNotificationLinks(db, tenantId, {
      type: 'ticket',
      ticketId,
      ticketNumber: ticket.ticket_number
    });

    // Create notification for assigned MSP user if ticket is assigned
    if (ticket.assigned_to) {
      await createNotificationFromTemplateInternal(db, {
        tenant: tenantId,
        user_id: ticket.assigned_to,
        template_name: 'ticket-created',
        type: 'info',
        category: 'tickets',
        link: internalUrl,
        data: {
          ticketId: ticket.ticket_number || 'New Ticket',
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
    if (ticket.contact_name_id && portalUrl) {
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
        await createNotificationFromTemplateInternal(db, {
          tenant: tenantId,
          user_id: contactUser.user_id,
          template_name: 'ticket-created-client',
          type: 'info',
          category: 'tickets',
          link: portalUrl,
          data: {
            ticketId: ticket.ticket_number || 'New Ticket',
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
 * Get all users assigned to a ticket (primary + additional agents)
 */
async function getAllTicketAssignees(
  db: Knex,
  tenantId: string,
  ticketId: string
): Promise<string[]> {
  // Get primary assignee
  const ticket = await db('tickets')
    .select('assigned_to')
    .where({ ticket_id: ticketId, tenant: tenantId })
    .first();

  const assignees: string[] = [];
  if (ticket?.assigned_to) {
    assignees.push(ticket.assigned_to);
  }

  // Get additional agents
  const additionalAgents = await db('ticket_resources')
    .select('additional_user_id')
    .where({ tenant: tenantId, ticket_id: ticketId })
    .whereNotNull('additional_user_id');

  for (const agent of additionalAgents) {
    if (agent.additional_user_id && !assignees.includes(agent.additional_user_id)) {
      assignees.push(agent.additional_user_id);
    }
  }

  return assignees;
}

/**
 * Get all users assigned to a project task (primary + additional agents)
 */
async function getAllTaskAssignees(
  db: Knex,
  tenantId: string,
  taskId: string
): Promise<string[]> {
  // Get primary assignee
  const task = await db('project_tasks')
    .select('assigned_to')
    .where({ task_id: taskId, tenant: tenantId })
    .first();

  const assignees: string[] = [];
  if (task?.assigned_to) {
    assignees.push(task.assigned_to);
  }

  // Get additional agents
  const additionalAgents = await db('task_resources')
    .select('additional_user_id')
    .where({ tenant: tenantId, task_id: taskId })
    .whereNotNull('additional_user_id');

  for (const agent of additionalAgents) {
    if (agent.additional_user_id && !assignees.includes(agent.additional_user_id)) {
      assignees.push(agent.additional_user_id);
    }
  }

  return assignees;
}

/**
 * Handle ticket assigned events (primary assignment only)
 */
async function handleTicketAssigned(event: TicketAssignedEvent): Promise<void> {
  const { tenantId, ticketId, userId, assignedByUserId } = event.payload;

  try {
    const db = await getConnection(tenantId);

    // Get ticket details including priority
    const ticket = await db('tickets as t')
      .select(
        't.ticket_number',
        't.title',
        't.assigned_to',
        'p.priority_name as priority'
      )
      .leftJoin('priorities as p', function() {
        this.on('t.priority_id', 'p.priority_id')
            .andOn('t.tenant', 'p.tenant');
      })
      .where({ 't.ticket_id': ticketId, 't.tenant': tenantId })
      .first();

    if (!ticket) {
      logger.warn('[InternalNotificationSubscriber] Ticket not found for assignment', {
        ticketId,
        tenantId
      });
      return;
    }

    // Get the user who performed the assignment
    const assignedByUser = assignedByUserId ? await db('users')
      .select('first_name', 'last_name')
      .where({ user_id: assignedByUserId, tenant: tenantId })
      .first() : null;

    const performedByName = assignedByUser
      ? `${assignedByUser.first_name} ${assignedByUser.last_name}`
      : 'Someone';

    // Resolve notification link
    const { internalUrl } = await resolveNotificationLinks(db, tenantId, {
      type: 'ticket',
      ticketId,
      ticketNumber: ticket.ticket_number
    });

    // Simple: just notify the assigned user (primary assignment)
    await createNotificationFromTemplateInternal(db, {
      tenant: tenantId,
      user_id: userId,
      template_name: 'ticket-assigned',
      type: 'info',
      category: 'tickets',
      link: internalUrl,
      data: {
        ticketId: ticket.ticket_number,
        ticketNumber: ticket.ticket_number,
        ticketTitle: ticket.title,
        priority: ticket.priority,
        performedByName
      }
    });

    logger.info('[InternalNotificationSubscriber] Created notification for ticket assigned', {
      ticketId,
      userId,
      tenantId
    });
  } catch (error) {
    logger.error('[InternalNotificationSubscriber] Error handling ticket assigned:', error);
  }
}

/**
 * Handle ticket additional agent assigned events
 */
async function handleTicketAdditionalAgentAssigned(
  event: TicketAdditionalAgentAssignedEvent
): Promise<void> {
  const { tenantId, ticketId, primaryAgentId, additionalAgentId, assignedByUserId } = event.payload;

  try {
    const db = await getConnection(tenantId);

    // Get ticket details including priority
    const ticket = await db('tickets as t')
      .select(
        't.ticket_number',
        't.title',
        't.contact_name_id',
        'p.priority_name as priority'
      )
      .leftJoin('priorities as p', function() {
        this.on('t.priority_id', 'p.priority_id')
            .andOn('t.tenant', 'p.tenant');
      })
      .where({ 't.ticket_id': ticketId, 't.tenant': tenantId })
      .first();

    if (!ticket) {
      logger.warn('[InternalNotificationSubscriber] Ticket not found for additional agent assignment', {
        ticketId,
        tenantId
      });
      return;
    }

    // Get assigner name
    const assigner = await db('users')
      .select('first_name', 'last_name')
      .where({ user_id: assignedByUserId, tenant: tenantId })
      .first();

    const assignerName = assigner
      ? `${assigner.first_name} ${assigner.last_name}`
      : 'Someone';

    // Resolve notification link
    const { internalUrl } = await resolveNotificationLinks(db, tenantId, {
      type: 'ticket',
      ticketId,
      ticketNumber: ticket.ticket_number
    });

    // 1. Notify the additional agent being added
    await createNotificationFromTemplateInternal(db, {
      tenant: tenantId,
      user_id: additionalAgentId,
      template_name: 'ticket-additional-agent-assigned',
      type: 'info',
      category: 'tickets',
      link: internalUrl,
      data: {
        ticketId: ticket.ticket_number,
        ticketNumber: ticket.ticket_number,
        ticketTitle: ticket.title,
        priority: ticket.priority,
        assignedByName: assignerName
      }
    });

    logger.info('[InternalNotificationSubscriber] Notified additional agent', {
      ticketId,
      additionalAgentId,
      tenantId
    });

    // 2. Notify the primary agent (if they exist and didn't perform the action)
    if (primaryAgentId && primaryAgentId !== assignedByUserId) {
      const additionalAgent = await db('users')
        .select('first_name', 'last_name')
        .where({ user_id: additionalAgentId, tenant: tenantId })
        .first();

      const additionalAgentName = additionalAgent
        ? `${additionalAgent.first_name} ${additionalAgent.last_name}`
        : 'An agent';

      await createNotificationFromTemplateInternal(db, {
        tenant: tenantId,
        user_id: primaryAgentId,
        template_name: 'ticket-additional-agent-added',
        type: 'info',
        category: 'tickets',
        link: internalUrl,
        data: {
          ticketId: ticket.ticket_number,
          ticketNumber: ticket.ticket_number,
          ticketTitle: ticket.title,
          additionalAgentName: additionalAgentName
        }
      });

      logger.info('[InternalNotificationSubscriber] Notified primary agent about additional agent', {
        ticketId,
        primaryAgentId,
        tenantId
      });
    } else {
      logger.debug('[InternalNotificationSubscriber] Skipping primary agent notification', {
        ticketId,
        primaryAgentId,
        assignedByUserId,
        reason: !primaryAgentId ? 'No primary agent' : 'Primary agent performed the action'
      });
    }

    // 3. Notify client (if they have portal access)
    if (ticket.contact_name_id) {
      const contactUser = await db('users')
        .select('user_id', 'first_name', 'last_name')
        .where({ contact_id: ticket.contact_name_id, tenant: tenantId })
        .first();

      if (contactUser) {
        const additionalAgent = await db('users')
          .select('first_name', 'last_name')
          .where({ user_id: additionalAgentId, tenant: tenantId })
          .first();

        const additionalAgentName = additionalAgent
          ? `${additionalAgent.first_name} ${additionalAgent.last_name}`
          : 'An agent';

        await createNotificationFromTemplateInternal(db, {
          tenant: tenantId,
          user_id: contactUser.user_id,
          template_name: 'ticket-additional-agent-added-client',
          type: 'info',
          category: 'tickets',
          link: internalUrl,
          data: {
            ticketId: ticket.ticket_number,
            ticketNumber: ticket.ticket_number,
            ticketTitle: ticket.title,
            additionalAgentName: additionalAgentName
          }
        });

        logger.info('[InternalNotificationSubscriber] Notified client about additional agent', {
          ticketId,
          contactUserId: contactUser.user_id,
          tenantId
        });
      }
    }
  } catch (error) {
    logger.error('[InternalNotificationSubscriber] Error handling ticket additional agent assigned:', error);
  }
}

/**
 * Handle project task additional agent assigned events
 */
async function handleProjectTaskAdditionalAgentAssigned(
  event: ProjectTaskAdditionalAgentAssignedEvent
): Promise<void> {
  const { tenantId, projectId, taskId, primaryAgentId, additionalAgentId, assignedByUserId } = event.payload;

  try {
    const db = await getConnection(tenantId);

    // Get task and project details
    const taskData = await db('project_tasks as pt')
      .select('pt.task_name', 'p.project_name')
      .leftJoin('project_phases as ph', function() {
        this.on('pt.phase_id', 'ph.phase_id')
           .andOn('pt.tenant', 'ph.tenant');
      })
      .leftJoin('projects as p', function() {
        this.on('ph.project_id', 'p.project_id')
           .andOn('ph.tenant', 'p.tenant');
      })
      .where({ 'pt.task_id': taskId, 'pt.tenant': tenantId })
      .first();

    if (!taskData) {
      logger.warn('[InternalNotificationSubscriber] Task not found for additional agent assignment', {
        taskId,
        tenantId
      });
      return;
    }

    // Get assigner name
    const assigner = await db('users')
      .select('first_name', 'last_name')
      .where({ user_id: assignedByUserId, tenant: tenantId })
      .first();

    const assignerName = assigner
      ? `${assigner.first_name} ${assigner.last_name}`
      : 'Someone';

    // Resolve notification link
    const { internalUrl } = await resolveNotificationLinks(db, tenantId, {
      type: 'project_task',
      taskId,
      projectId
    });

    // 1. Notify the additional agent being added
    await createNotificationFromTemplateInternal(db, {
      tenant: tenantId,
      user_id: additionalAgentId,
      template_name: 'task-additional-agent-assigned',
      type: 'info',
      category: 'projects',
      link: internalUrl,
      data: {
        taskName: taskData.task_name,
        projectName: taskData.project_name,
        assignedByName: assignerName
      }
    });

    logger.info('[InternalNotificationSubscriber] Notified additional agent for task', {
      taskId,
      additionalAgentId,
      tenantId
    });

    // 2. Notify the primary agent (if they didn't perform the action)
    if (primaryAgentId !== assignedByUserId) {
      const additionalAgent = await db('users')
        .select('first_name', 'last_name')
        .where({ user_id: additionalAgentId, tenant: tenantId })
        .first();

      const additionalAgentName = additionalAgent
        ? `${additionalAgent.first_name} ${additionalAgent.last_name}`
        : 'An agent';

      await createNotificationFromTemplateInternal(db, {
        tenant: tenantId,
        user_id: primaryAgentId,
        template_name: 'task-additional-agent-added',
        type: 'info',
        category: 'projects',
        link: internalUrl,
        data: {
          taskName: taskData.task_name,
          projectName: taskData.project_name,
          additionalAgentName: additionalAgentName
        }
      });

      logger.info('[InternalNotificationSubscriber] Notified primary agent about additional agent on task', {
        taskId,
        primaryAgentId,
        tenantId
      });
    }
  } catch (error) {
    logger.error('[InternalNotificationSubscriber] Error handling task additional agent assigned:', error);
  }
}

/**
 * Handle ticket updated events
 */
async function handleTicketUpdated(event: TicketUpdatedEvent): Promise<void> {
  const { payload } = event;
  const { tenantId, ticketId, userId, changes } = payload;

  try {
    const db = await getConnection(tenantId);

    // Get ticket details including contact
    const ticket = await db('tickets')
      .select('ticket_id', 'ticket_number', 'title', 'assigned_to', 'contact_name_id', 'status_id', 'priority_id', 'tenant')
      .where({ ticket_id: ticketId, tenant: tenantId })
      .first();

    if (!ticket) {
      return;
    }

    // Get user who made the change
    const performedByUser = await db('users')
      .select('user_id', 'first_name', 'last_name')
      .where({ user_id: userId, tenant: tenantId })
      .first();

    const performedByName = performedByUser ? `${performedByUser.first_name} ${performedByUser.last_name}` : 'Someone';

    // Build metadata with change details
    const metadata: Record<string, any> = {
      ticketId: ticket.ticket_number || 'New Ticket',
      ticketTitle: ticket.title,
      performedByName,
      performedById: userId
    };

    // Process changes to get human-readable names
    if (changes && typeof changes === 'object') {
      const changeDetails: Record<string, any> = {};

      // Handle status change
      if (changes.status_id && typeof changes.status_id === 'object') {
        const oldStatus = await db('statuses')
          .select('name')
          .where({ status_id: changes.status_id.old, tenant: tenantId })
          .first();
        const newStatus = await db('statuses')
          .select('name')
          .where({ status_id: changes.status_id.new, tenant: tenantId })
          .first();

        if (oldStatus || newStatus) {
          changeDetails.status = {
            old: oldStatus?.name || 'Unknown',
            new: newStatus?.name || 'Unknown'
          };
          metadata.oldStatus = oldStatus?.name || 'Unknown';
          metadata.newStatus = newStatus?.name || 'Unknown';
        }
      }

      // Handle priority change
      if (changes.priority_id && typeof changes.priority_id === 'object') {
        const oldPriority = await db('priorities')
          .select('priority_name', 'priority_color')
          .where({ priority_id: changes.priority_id.old, tenant: tenantId })
          .first();
        const newPriority = await db('priorities')
          .select('priority_name', 'priority_color')
          .where({ priority_id: changes.priority_id.new, tenant: tenantId })
          .first();

        if (oldPriority || newPriority) {
          changeDetails.priority = {
            old: oldPriority?.priority_name || 'None',
            oldColor: oldPriority?.priority_color,
            new: newPriority?.priority_name || 'None',
            newColor: newPriority?.priority_color
          };
          metadata.oldPriority = oldPriority?.priority_name || 'None';
          metadata.oldPriorityColor = oldPriority?.priority_color;
          metadata.newPriority = newPriority?.priority_name || 'None';
          metadata.newPriorityColor = newPriority?.priority_color;
        }
      }

      // Handle assignment change
      if (changes.assigned_to && typeof changes.assigned_to === 'object') {
        const oldAssignee = changes.assigned_to.old ? await db('users')
          .select('first_name', 'last_name')
          .where({ user_id: changes.assigned_to.old, tenant: tenantId })
          .first() : null;
        const newAssignee = changes.assigned_to.new ? await db('users')
          .select('first_name', 'last_name')
          .where({ user_id: changes.assigned_to.new, tenant: tenantId })
          .first() : null;

        changeDetails.assigned_to = {
          old: oldAssignee ? `${oldAssignee.first_name} ${oldAssignee.last_name}` : 'Unassigned',
          new: newAssignee ? `${newAssignee.first_name} ${newAssignee.last_name}` : 'Unassigned'
        };
        metadata.oldAssignedTo = oldAssignee ? `${oldAssignee.first_name} ${oldAssignee.last_name}` : 'Unassigned';
        metadata.newAssignedTo = newAssignee ? `${newAssignee.first_name} ${newAssignee.last_name}` : 'Unassigned';
      }

      metadata.changes = changeDetails;
    }

    // Determine template name based on changes
    let templateName = 'ticket-updated';
    if (metadata.changes?.status) {
      templateName = 'ticket-status-changed';
    } else if (metadata.changes?.priority) {
      templateName = 'ticket-priority-changed';
    } else if (metadata.changes?.assigned_to) {
      templateName = 'ticket-reassigned';
    }

    // Resolve links for both MSP and client portal
    const { internalUrl, portalUrl } = await resolveNotificationLinks(db, tenantId, {
      type: 'ticket',
      ticketId,
      ticketNumber: ticket.ticket_number
    });

    // Notify all assigned agents
    const allAssignees = await getAllTicketAssignees(db, tenantId, ticketId);
    const notifiedUserIds = new Set<string>([userId]); // Don't notify the person who made the change

    for (const assigneeId of allAssignees) {
      if (!notifiedUserIds.has(assigneeId)) {
        await createNotificationFromTemplateInternal(db, {
          tenant: tenantId,
          user_id: assigneeId,
          template_name: templateName,
          type: 'info',
          category: 'tickets',
          link: internalUrl,
          data: metadata
        });
        notifiedUserIds.add(assigneeId);

        logger.info('[InternalNotificationSubscriber] Created notification for ticket updated (MSP user)', {
          ticketId,
          userId: assigneeId,
          tenantId,
          changes: metadata.changes
        });
      }
    }

    // Create notification for client contact if they have portal access
    if (ticket.contact_name_id && portalUrl) {
      const contactUser = await db('users')
        .select('user_id', 'user_type')
        .where({
          contact_id: ticket.contact_name_id,
          tenant: tenantId,
          user_type: 'client'
        })
        .first();

      if (contactUser) {
        await createNotificationFromTemplateInternal(db, {
          tenant: tenantId,
          user_id: contactUser.user_id,
          template_name: 'ticket-updated-client',
          type: 'info',
          category: 'tickets',
          link: portalUrl,
          data: metadata
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

    // Get user who closed the ticket
    const userId = payload.userId || '';

    // Get user who closed it for the notification
    const performedByUser = userId ? await db('users')
      .select('first_name', 'last_name')
      .where({ user_id: userId, tenant: tenantId })
      .first() : null;

    const performedByName = performedByUser ? `${performedByUser.first_name} ${performedByUser.last_name}` : 'Someone';

    // Resolve links for both MSP and client portal
    const { internalUrl, portalUrl } = await resolveNotificationLinks(db, tenantId, {
      type: 'ticket',
      ticketId,
      ticketNumber: ticket.ticket_number
    });

    // Notify all assigned agents
    const allAssignees = await getAllTicketAssignees(db, tenantId, ticketId);
    const notifiedUserIds = new Set<string>([userId]);

    for (const assigneeId of allAssignees) {
      if (!notifiedUserIds.has(assigneeId)) {
        await createNotificationFromTemplateInternal(db, {
          tenant: tenantId,
          user_id: assigneeId,
          template_name: 'ticket-closed',
          type: 'success',
          category: 'tickets',
          link: internalUrl,
          data: {
            ticketId: ticket.ticket_number || 'New Ticket',
            ticketTitle: ticket.title,
            closedByName: performedByName
          }
        });
        notifiedUserIds.add(assigneeId);

        logger.info('[InternalNotificationSubscriber] Created notification for ticket closed (MSP user)', {
          ticketId,
          userId: assigneeId,
          tenantId
        });
      }
    }

    // Create notification for client contact if they have portal access
    if (ticket.contact_name_id && portalUrl) {
      const contactUser = await db('users')
        .select('user_id', 'user_type')
        .where({
          contact_id: ticket.contact_name_id,
          tenant: tenantId,
          user_type: 'client'
        })
        .first();

      if (contactUser) {
        await createNotificationFromTemplateInternal(db, {
          tenant: tenantId,
          user_id: contactUser.user_id,
          template_name: 'ticket-closed-client',
          type: 'success',
          category: 'tickets',
          link: portalUrl,
          data: {
            ticketId: ticket.ticket_number || 'New Ticket',
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
 * Truncate text to a maximum length, breaking at word boundaries
 */
function truncateText(text: string, maxLength: number = 100): string {
  if (!text || text.length <= maxLength) {
    return text;
  }

  // Truncate to maxLength
  let truncated = text.substring(0, maxLength);

  // Find the last space to avoid breaking mid-word
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > maxLength * 0.8) { // Only break at word if we're not losing too much
    truncated = truncated.substring(0, lastSpace);
  }

  return truncated.trim() + '...';
}

/**
 * Strip HTML tags and decode HTML entities from text
 */
function stripHtml(html: string): string {
  if (!html) return '';

  // Remove HTML tags
  let text = html.replace(/<[^>]*>/g, '');

  // Decode common HTML entities
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");

  // Replace multiple spaces/newlines with single space
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}

/**
 * Extract user IDs from BlockNote mention inline content
 * Searches through BlockNote blocks for mention inline content
 * Returns array of user IDs (including special '@everyone' string)
 */
function extractMentionUserIds(content: any): string[] {
  if (!content) return [];

  const userIds: string[] = [];

  try {
    // Parse content if it's a string
    const blocks = typeof content === 'string' ? JSON.parse(content) : content;

    if (!Array.isArray(blocks)) return [];

    // Traverse blocks to find mention inline content
    for (const block of blocks) {
      if (block.content && Array.isArray(block.content)) {
        for (const inlineContent of block.content) {
          // Check if this is a mention inline content
          if (inlineContent.type === 'mention' && inlineContent.props?.userId) {
            userIds.push(inlineContent.props.userId);
          }
        }
      }
    }
  } catch (error) {
    console.error('[extractMentionUserIds] Error parsing content:', error);
  }

  // Remove duplicates
  return Array.from(new Set(userIds));
}

/**
 * Resolve @everyone to all internal users in the tenant
 * Also handles regular user IDs
 */
async function resolveEveryoneMention(
  db: Knex,
  tenantId: string,
  mentionedUserIds: string[]
): Promise<string[]> {
  const resolvedUserIds: string[] = [];

  for (const userId of mentionedUserIds) {
    if (userId === '@everyone') {
      // Get all active internal users in the tenant
      const internalUsers = await db('users')
        .select('user_id')
        .where({ tenant: tenantId, user_type: 'internal', is_inactive: false });

      resolvedUserIds.push(...internalUsers.map(u => u.user_id));
    } else {
      // Regular user ID
      resolvedUserIds.push(userId);
    }
  }

  // Remove duplicates
  return Array.from(new Set(resolvedUserIds));
}

/**
 * Parse comment text for @mentions (legacy fallback)
 * Supports both @username and @[Display Name] formats
 */
function extractMentions(text: string): string[] {
  if (!text) return [];

  const mentions: string[] = [];

  // Pattern 1: @username (alphanumeric and underscores, must start with letter)
  const usernamePattern = /@([a-zA-Z][a-zA-Z0-9_]*)/g;
  let match;
  while ((match = usernamePattern.exec(text)) !== null) {
    mentions.push(match[1]);
  }

  // Pattern 2: @[Display Name] (any characters between brackets)
  const displayNamePattern = /@\[([^\]]+)\]/g;
  while ((match = displayNamePattern.exec(text)) !== null) {
    mentions.push(match[1]);
  }

  // Remove duplicates and return
  return Array.from(new Set(mentions));
}

/**
 * Look up users by username or display name
 */
async function findMentionedUsers(db: Knex, tenantId: string, mentions: string[]): Promise<Array<{user_id: string, username: string, display_name: string}>> {
  if (mentions.length === 0) return [];

  // Query users by username or display name
  const users = await db('users')
    .select('user_id', 'username', db.raw("CONCAT(first_name, ' ', last_name) as display_name"))
    .where('tenant', tenantId)
    .andWhere(function() {
      this.whereIn('username', mentions)
        .orWhereRaw("CONCAT(first_name, ' ', last_name) IN (?)", [mentions]);
    });

  return users;
}

/**
 * Handle task comment added events
 */
async function handleTaskCommentAdded(event: TaskCommentAddedEvent): Promise<void> {
  const { payload } = event;
  const { tenantId, taskId, projectId, userId, taskCommentId, taskName, commentContent } = payload;

  console.log('[InternalNotificationSubscriber] handleTaskCommentAdded START', {
    taskId,
    userId,
    taskCommentId,
    hasContent: !!commentContent
  });

  try {
    const db = await getConnection(tenantId);

    // Get task details
    const task = await db('project_tasks as pt')
      .select(
        'pt.task_id',
        'pt.task_name',
        'pt.assigned_to',
        'p.project_id',
        'p.project_name'
      )
      .leftJoin('project_phases as ph', function() {
        this.on('pt.phase_id', 'ph.phase_id')
           .andOn('pt.tenant', 'ph.tenant');
      })
      .leftJoin('projects as p', function() {
        this.on('ph.project_id', 'p.project_id')
           .andOn('ph.tenant', 'p.tenant');
      })
      .where({ 'pt.task_id': taskId, 'pt.tenant': tenantId })
      .first();

    if (!task) {
      console.log('[InternalNotificationSubscriber] Task not found:', taskId);
      return;
    }

    // Get author name
    const author = await db('users')
      .select('first_name', 'last_name')
      .where({ user_id: userId, tenant: tenantId })
      .first();

    const authorName = author ? `${author.first_name} ${author.last_name}` : 'Someone';

    // Extract comment text preview from BlockNote content
    let commentPreview = '';
    let commentText = '';
    if (commentContent) {
      try {
        commentText = convertBlockNoteToMarkdown(commentContent);
        // Remove markdown formatting for preview
        commentPreview = truncateText(commentText.replace(/[*_~`#\[\]]/g, ''), 100);
      } catch (error) {
        console.error('[InternalNotificationSubscriber] Failed to parse BlockNote content:', error);
        // Fallback to stripHtml for older content
        commentText = stripHtml(commentContent);
        commentPreview = truncateText(commentText, 100);
      }
    }

    console.log('[InternalNotificationSubscriber] About to extract mentions from task comment:', {
      contentType: typeof commentContent,
      contentLength: commentContent?.length
    });

    // Extract user IDs from BlockNote mention inline content
    const mentionedUserIds = extractMentionUserIds(commentContent);
    console.log('[InternalNotificationSubscriber] Found mentioned user IDs in task comment:', mentionedUserIds);

    // Resolve @everyone mentions
    const resolvedMentionedUserIds = await resolveEveryoneMention(db, tenantId, mentionedUserIds);
    console.log('[InternalNotificationSubscriber] Resolved mentioned user IDs:', resolvedMentionedUserIds);

    // Get user details for mentioned users
    const mentionedUsers = resolvedMentionedUserIds.length > 0
      ? await db('users')
          .select('user_id', 'username', db.raw("CONCAT(first_name, ' ', last_name) as display_name"))
          .whereIn('user_id', resolvedMentionedUserIds)
          .andWhere('tenant', tenantId)
      : [];

    console.log('[InternalNotificationSubscriber] Found mentioned users in task comment:', mentionedUsers.length);

    // Resolve notification link
    const { internalUrl } = await resolveNotificationLinks(db, tenantId, {
      type: 'project_task',
      projectId,
      taskId,
      taskCommentId
    });

    // Track users who have been notified to avoid duplicates
    const notifiedUserIds = new Set<string>();

    // Create notifications for mentioned users (excluding the comment author)
    for (const mentionedUser of mentionedUsers) {
      if (mentionedUser.user_id !== userId && !notifiedUserIds.has(mentionedUser.user_id)) {
        await createNotificationFromTemplateInternal(db, {
          tenant: tenantId,
          user_id: mentionedUser.user_id,
          template_name: 'user-mentioned',
          type: 'info',
          category: 'messages',
          link: internalUrl,
          data: {
            authorName,
            entityType: 'task comment',
            entityName: task.task_name
          },
          metadata: {
            taskId: task.task_id,
            projectId: task.project_id,
            taskName: task.task_name,
            projectName: task.project_name,
            taskCommentId: taskCommentId,
            commentText: commentText,
            commentPreview: commentPreview,
            commentAuthor: authorName,
            commentAuthorId: userId,
            contextType: 'task',
            contextId: taskId
          }
        });

        notifiedUserIds.add(mentionedUser.user_id);

        console.log('[InternalNotificationSubscriber] Created notification for user mentioned in task comment', {
          taskId,
          mentionedUserId: mentionedUser.user_id,
          mentionedUsername: mentionedUser.username,
          commentAuthor: userId,
          tenantId
        });

        logger.info('[InternalNotificationSubscriber] Created notification for user mentioned in task comment', {
          taskId,
          mentionedUserId: mentionedUser.user_id,
          commentAuthor: userId,
          tenantId
        });
      }
    }

    // Resolve link without comment anchor for general notifications
    const { internalUrl: taskUrl } = await resolveNotificationLinks(db, tenantId, {
      type: 'project_task',
      projectId,
      taskId
    });

    // Notify all assigned agents
    const allAssignees = await getAllTaskAssignees(db, tenantId, taskId);

    for (const assigneeId of allAssignees) {
      if (assigneeId !== userId && !notifiedUserIds.has(assigneeId)) {
        await createNotificationFromTemplateInternal(db, {
          tenant: tenantId,
          user_id: assigneeId,
          template_name: 'task-comment-added',
          type: 'info',
          category: 'projects',
          link: taskUrl,
          data: {
            authorName,
            taskName: task.task_name,
            projectName: task.project_name,
            commentPreview
          },
          metadata: {
            taskId: task.task_id,
            projectId: task.project_id,
            taskName: task.task_name,
            projectName: task.project_name,
            comment: {
              id: taskCommentId,
              text: commentPreview,
              author: authorName,
              authorId: userId
            }
          }
        });
        notifiedUserIds.add(assigneeId);

        logger.info('[InternalNotificationSubscriber] Created notification for task comment (assigned user)', {
          taskId,
          userId: assigneeId,
          tenantId
        });
      }
    }
  } catch (error) {
    console.error('[InternalNotificationSubscriber] Error handling task comment added (full error):', error);
    logger.error('[InternalNotificationSubscriber] Error handling task comment added', {
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name
      } : error,
      taskId,
      tenantId
    });
  }
}

/**
 * Handle task comment updated events
 */
async function handleTaskCommentUpdated(event: TaskCommentUpdatedEvent): Promise<void> {
  const { payload } = event;
  const { tenantId, taskId, projectId, userId, taskCommentId, taskName, oldCommentContent, newCommentContent } = payload;

  console.log('[InternalNotificationSubscriber] handleTaskCommentUpdated START', {
    taskId,
    userId,
    taskCommentId,
    hasOldContent: !!oldCommentContent,
    hasNewContent: !!newCommentContent
  });

  try {
    const db = await getConnection(tenantId);

    // Get task details
    const task = await db('project_tasks as pt')
      .select(
        'pt.task_id',
        'pt.task_name',
        'pt.assigned_to',
        'p.project_id',
        'p.project_name'
      )
      .leftJoin('project_phases as ph', function() {
        this.on('pt.phase_id', 'ph.phase_id')
           .andOn('pt.tenant', 'ph.tenant');
      })
      .leftJoin('projects as p', function() {
        this.on('ph.project_id', 'p.project_id')
           .andOn('ph.tenant', 'p.tenant');
      })
      .where({ 'pt.task_id': taskId, 'pt.tenant': tenantId })
      .first();

    if (!task) {
      console.log('[InternalNotificationSubscriber] Task not found:', taskId);
      return;
    }

    // Get author name
    const author = await db('users')
      .select('first_name', 'last_name')
      .where({ user_id: userId, tenant: tenantId })
      .first();

    const authorName = author ? `${author.first_name} ${author.last_name}` : 'Someone';

    // Extract comment text preview from BlockNote content
    let commentPreview = '';
    let commentText = '';
    if (newCommentContent) {
      try {
        commentText = convertBlockNoteToMarkdown(newCommentContent);
        // Remove markdown formatting for preview
        commentPreview = truncateText(commentText.replace(/[*_~`#\[\]]/g, ''), 100);
      } catch (error) {
        console.error('[InternalNotificationSubscriber] Failed to parse BlockNote content:', error);
        // Fallback to stripHtml for older content
        commentText = stripHtml(newCommentContent);
        commentPreview = truncateText(commentText, 100);
      }
    }

    // Extract user IDs from old and new content
    const oldMentionedUserIds = extractMentionUserIds(oldCommentContent);
    const newMentionedUserIds = extractMentionUserIds(newCommentContent);

    console.log('[InternalNotificationSubscriber] Mentions comparison:', {
      oldMentions: oldMentionedUserIds,
      newMentions: newMentionedUserIds
    });

    // Find only NEW mentions (not in old content)
    const newlyMentionedUserIds = newMentionedUserIds.filter(
      userId => !oldMentionedUserIds.includes(userId)
    );

    console.log('[InternalNotificationSubscriber] Newly mentioned user IDs:', newlyMentionedUserIds);

    // Resolve @everyone mentions
    const resolvedNewlyMentionedUserIds = await resolveEveryoneMention(db, tenantId, newlyMentionedUserIds);
    console.log('[InternalNotificationSubscriber] Resolved newly mentioned user IDs:', resolvedNewlyMentionedUserIds);

    // Get user details for newly mentioned users
    const newlyMentionedUsers = resolvedNewlyMentionedUserIds.length > 0
      ? await db('users')
          .select('user_id', 'username', db.raw("CONCAT(first_name, ' ', last_name) as display_name"))
          .whereIn('user_id', resolvedNewlyMentionedUserIds)
          .andWhere('tenant', tenantId)
      : [];

    console.log('[InternalNotificationSubscriber] Found newly mentioned users:', newlyMentionedUsers.length);

    // Resolve notification link
    const { internalUrl } = await resolveNotificationLinks(db, tenantId, {
      type: 'project_task',
      projectId,
      taskId,
      taskCommentId
    });

    // Track users who have been notified to avoid duplicates
    const notifiedUserIds = new Set<string>();

    // Create notifications for NEWLY mentioned users only (excluding the comment author)
    for (const mentionedUser of newlyMentionedUsers) {
      if (mentionedUser.user_id !== userId && !notifiedUserIds.has(mentionedUser.user_id)) {
        await createNotificationFromTemplateInternal(db, {
          tenant: tenantId,
          user_id: mentionedUser.user_id,
          template_name: 'user-mentioned',
          type: 'info',
          category: 'messages',
          link: internalUrl,
          data: {
            authorName,
            entityType: 'task comment',
            entityName: task.task_name
          },
          metadata: {
            taskId: task.task_id,
            projectId: task.project_id,
            taskName: task.task_name,
            projectName: task.project_name,
            taskCommentId: taskCommentId,
            commentText: commentText,
            commentPreview: commentPreview,
            commentAuthor: authorName,
            commentAuthorId: userId,
            contextType: 'task',
            contextId: taskId
          }
        });

        notifiedUserIds.add(mentionedUser.user_id);

        console.log('[InternalNotificationSubscriber] Created notification for newly mentioned user in updated task comment', {
          taskId,
          mentionedUserId: mentionedUser.user_id,
          mentionedUsername: mentionedUser.username,
          commentAuthor: userId,
          tenantId
        });

        logger.info('[InternalNotificationSubscriber] Created notification for newly mentioned user in updated task comment', {
          taskId,
          mentionedUserId: mentionedUser.user_id,
          commentAuthor: userId,
          tenantId
        });
      }
    }
  } catch (error) {
    logger.error('[InternalNotificationSubscriber] Error handling task comment updated', {
      error,
      taskId,
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

  console.log('[InternalNotificationSubscriber] handleTicketCommentAdded START', {
    ticketId,
    userId,
    hasComment: !!comment,
    commentContent: comment?.content ? 'present' : 'missing'
  });

  try {
    const db = await getConnection(tenantId);

    // Get ticket details including contact
    const ticket = await db('tickets')
      .select('ticket_id', 'ticket_number', 'title', 'assigned_to', 'contact_name_id', 'tenant')
      .where({ ticket_id: ticketId, tenant: tenantId })
      .first();

    if (!ticket) {
      console.log('[InternalNotificationSubscriber] Ticket not found:', ticketId);
      return;
    }

    // Get author name
    const author = await db('users')
      .select('first_name', 'last_name')
      .where({ user_id: userId, tenant: tenantId })
      .first();

    const authorName = author ? `${author.first_name} ${author.last_name}` : 'Someone';

    // Extract comment text preview from BlockNote content
    let commentPreview = '';
    let commentText = '';
    if (comment?.content) {
      // Parse BlockNote JSON to plain text
      try {
        commentText = convertBlockNoteToMarkdown(comment.content);
        // Remove markdown formatting for preview
        commentPreview = truncateText(commentText.replace(/[*_~`#\[\]]/g, ''), 100);
      } catch (error) {
        console.error('[InternalNotificationSubscriber] Failed to parse BlockNote content:', error);
        // Fallback to stripHtml for older content
        commentText = stripHtml(comment.content);
        commentPreview = truncateText(commentText, 100);
      }
    }

    console.log('[InternalNotificationSubscriber] About to extract mentions from:', {
      contentType: typeof comment?.content,
      contentLength: comment?.content?.length,
      contentPreview: comment?.content?.substring(0, 200)
    });

    // Extract user IDs from BlockNote mention inline content
    const mentionedUserIds = extractMentionUserIds(comment?.content);
    console.log('[InternalNotificationSubscriber] Found mentioned user IDs:', mentionedUserIds);

    // Resolve @everyone mentions
    const resolvedMentionedUserIds = await resolveEveryoneMention(db, tenantId, mentionedUserIds);
    console.log('[InternalNotificationSubscriber] Resolved mentioned user IDs:', resolvedMentionedUserIds);

    // Get user details for mentioned users
    const mentionedUsers = resolvedMentionedUserIds.length > 0
      ? await db('users')
          .select('user_id', 'username', db.raw("CONCAT(first_name, ' ', last_name) as display_name"))
          .whereIn('user_id', resolvedMentionedUserIds)
          .andWhere('tenant', tenantId)
      : [];

    console.log('[InternalNotificationSubscriber] Found mentioned users:', mentionedUsers.length);

    // Resolve links for both MSP and client portal
    const { internalUrl, portalUrl } = await resolveNotificationLinks(db, tenantId, {
      type: 'ticket',
      ticketId,
      ticketNumber: ticket.ticket_number,
      commentId: comment?.id
    });

    // Track users who have been notified to avoid duplicates
    const notifiedUserIds = new Set<string>();

    // Create notifications for mentioned users (excluding the comment author)
    for (const mentionedUser of mentionedUsers) {
      if (mentionedUser.user_id !== userId && !notifiedUserIds.has(mentionedUser.user_id)) {
        await createNotificationFromTemplateInternal(db, {
          tenant: tenantId,
          user_id: mentionedUser.user_id,
          template_name: 'user-mentioned-in-comment',
          type: 'info',
          category: 'messages',
          link: internalUrl,
          data: {
            commentAuthor: authorName,
            ticketNumber: ticket.ticket_number || 'New Ticket',
            commentPreview
          },
          metadata: {
            ticketId: ticket.ticket_id,
            ticketNumber: ticket.ticket_number || 'New Ticket',
            ticketTitle: ticket.title,
            commentId: comment?.id || '',
            commentText: commentText, // Full parsed text
            commentPreview: commentPreview, // Truncated preview
            commentAuthor: authorName,
            commentAuthorId: userId,
            contextType: 'ticket',
            contextId: ticketId
          }
        });

        notifiedUserIds.add(mentionedUser.user_id);

        console.log('[InternalNotificationSubscriber] Created notification for user mentioned in comment', {
          ticketId,
          mentionedUserId: mentionedUser.user_id,
          mentionedUsername: mentionedUser.username,
          commentAuthor: userId,
          tenantId
        });

        logger.info('[InternalNotificationSubscriber] Created notification for user mentioned in comment', {
          ticketId,
          mentionedUserId: mentionedUser.user_id,
          commentAuthor: userId,
          tenantId
        });
      }
    }

    // Resolve link without comment anchor for general notifications
    const { internalUrl: ticketUrl, portalUrl: ticketPortalUrl } = await resolveNotificationLinks(db, tenantId, {
      type: 'ticket',
      ticketId,
      ticketNumber: ticket.ticket_number
    });

    // Notify all assigned agents (if not internal comment)
    if (!comment?.isInternal) {
      const allAssignees = await getAllTicketAssignees(db, tenantId, ticketId);

      for (const assigneeId of allAssignees) {
        if (assigneeId !== userId && !notifiedUserIds.has(assigneeId)) {
          await createNotificationFromTemplateInternal(db, {
            tenant: tenantId,
            user_id: assigneeId,
            template_name: 'ticket-comment-added',
            type: 'info',
            category: 'tickets',
            link: ticketUrl,
            data: {
              authorName,
              ticketId: ticket.ticket_number || 'New Ticket',
              commentPreview
            },
            metadata: {
              ticketId: ticket.ticket_id,
              ticketNumber: ticket.ticket_number || 'New Ticket',
              comment: {
                id: comment?.id,
                text: commentPreview,
                author: authorName,
                authorId: userId,
                isInternal: false
              }
            }
          });
          notifiedUserIds.add(assigneeId);

          logger.info('[InternalNotificationSubscriber] Created notification for ticket comment (MSP user)', {
            ticketId,
            userId: assigneeId,
            tenantId
          });
        }
      }
    }

    // Create notification for client contact if they have portal access (and are not the comment author)
    // Skip if comment is internal - internal comments are not visible to client portal users
    if (ticket.contact_name_id && !comment?.isInternal && ticketPortalUrl) {
      const contactUser = await db('users')
        .select('user_id', 'user_type')
        .where({
          contact_id: ticket.contact_name_id,
          tenant: tenantId,
          user_type: 'client'
        })
        .first();

      if (contactUser && contactUser.user_id !== userId && !notifiedUserIds.has(contactUser.user_id)) {
        await createNotificationFromTemplateInternal(db, {
          tenant: tenantId,
          user_id: contactUser.user_id,
          template_name: 'ticket-comment-added-client',
          type: 'info',
          category: 'tickets',
          link: ticketPortalUrl,
          data: {
            authorName,
            ticketId: ticket.ticket_number || 'New Ticket',
            commentPreview
          },
          metadata: {
            ticketId: ticket.ticket_id,
            ticketNumber: ticket.ticket_number || 'New Ticket',
            comment: {
              id: comment?.id,
              text: commentPreview,
              author: authorName,
              authorId: userId,
              isInternal: false
            }
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
 * Handle ticket comment updated events
 */
async function handleTicketCommentUpdated(event: TicketCommentUpdatedEvent): Promise<void> {
  const { payload } = event;
  const { tenantId, ticketId, userId, oldComment, newComment } = payload;

  console.log('[InternalNotificationSubscriber] handleTicketCommentUpdated START', {
    ticketId,
    userId,
    hasOldComment: !!oldComment,
    hasNewComment: !!newComment
  });

  try {
    const db = await getConnection(tenantId);

    // Get ticket details including contact
    const ticket = await db('tickets')
      .select('ticket_id', 'ticket_number', 'title', 'assigned_to', 'contact_name_id', 'tenant')
      .where({ ticket_id: ticketId, tenant: tenantId })
      .first();

    if (!ticket) {
      console.log('[InternalNotificationSubscriber] Ticket not found:', ticketId);
      return;
    }

    // Get author name
    const author = await db('users')
      .select('first_name', 'last_name')
      .where({ user_id: userId, tenant: tenantId })
      .first();

    const authorName = author ? `${author.first_name} ${author.last_name}` : 'Someone';

    // Extract comment text preview from BlockNote content
    let commentPreview = '';
    let commentText = '';
    if (newComment?.content) {
      try {
        commentText = convertBlockNoteToMarkdown(newComment.content);
        // Remove markdown formatting for preview
        commentPreview = truncateText(commentText.replace(/[*_~`#\[\]]/g, ''), 100);
      } catch (error) {
        console.error('[InternalNotificationSubscriber] Failed to parse BlockNote content:', error);
        // Fallback to stripHtml for older content
        commentText = stripHtml(newComment.content);
        commentPreview = truncateText(commentText, 100);
      }
    }

    // Extract user IDs from old and new content
    const oldMentionedUserIds = extractMentionUserIds(oldComment?.content);
    const newMentionedUserIds = extractMentionUserIds(newComment?.content);

    console.log('[InternalNotificationSubscriber] Mentions comparison:', {
      oldMentions: oldMentionedUserIds,
      newMentions: newMentionedUserIds
    });

    // Find only NEW mentions (not in old content)
    const newlyMentionedUserIds = newMentionedUserIds.filter(
      userId => !oldMentionedUserIds.includes(userId)
    );

    console.log('[InternalNotificationSubscriber] Newly mentioned user IDs:', newlyMentionedUserIds);

    // Resolve @everyone mentions
    const resolvedNewlyMentionedUserIds = await resolveEveryoneMention(db, tenantId, newlyMentionedUserIds);
    console.log('[InternalNotificationSubscriber] Resolved newly mentioned user IDs:', resolvedNewlyMentionedUserIds);

    // Get user details for newly mentioned users
    const newlyMentionedUsers = resolvedNewlyMentionedUserIds.length > 0
      ? await db('users')
          .select('user_id', 'username', db.raw("CONCAT(first_name, ' ', last_name) as display_name"))
          .whereIn('user_id', resolvedNewlyMentionedUserIds)
          .andWhere('tenant', tenantId)
      : [];

    console.log('[InternalNotificationSubscriber] Found newly mentioned users:', newlyMentionedUsers.length);

    // Resolve links for both MSP and client portal
    const { internalUrl, portalUrl } = await resolveNotificationLinks(db, tenantId, {
      type: 'ticket',
      ticketId,
      ticketNumber: ticket.ticket_number,
      commentId: newComment?.id
    });

    // Track users who have been notified to avoid duplicates
    const notifiedUserIds = new Set<string>();

    // Create notifications for NEWLY mentioned users only (excluding the comment author)
    for (const mentionedUser of newlyMentionedUsers) {
      if (mentionedUser.user_id !== userId && !notifiedUserIds.has(mentionedUser.user_id)) {
        await createNotificationFromTemplateInternal(db, {
          tenant: tenantId,
          user_id: mentionedUser.user_id,
          template_name: 'user-mentioned-in-comment',
          type: 'info',
          category: 'messages',
          link: internalUrl,
          data: {
            commentAuthor: authorName,
            ticketNumber: ticket.ticket_number || 'New Ticket',
            commentPreview
          },
          metadata: {
            ticketId: ticket.ticket_id,
            ticketNumber: ticket.ticket_number || 'New Ticket',
            ticketTitle: ticket.title,
            commentId: newComment?.id || '',
            commentText: commentText,
            commentPreview: commentPreview,
            commentAuthor: authorName,
            commentAuthorId: userId,
            contextType: 'ticket',
            contextId: ticketId
          }
        });

        notifiedUserIds.add(mentionedUser.user_id);

        console.log('[InternalNotificationSubscriber] Created notification for newly mentioned user in updated ticket comment', {
          ticketId,
          mentionedUserId: mentionedUser.user_id,
          mentionedUsername: mentionedUser.username,
          commentAuthor: userId,
          tenantId
        });

        logger.info('[InternalNotificationSubscriber] Created notification for newly mentioned user in updated ticket comment', {
          ticketId,
          mentionedUserId: mentionedUser.user_id,
          commentAuthor: userId,
          tenantId
        });
      }
    }
  } catch (error) {
    logger.error('[InternalNotificationSubscriber] Error handling ticket comment updated', {
      error,
      ticketId,
      tenantId
    });
  }
}

/**
 * Handle user mentioned in document events
 */
async function handleUserMentionedInDocument(event: UserMentionedInDocumentEvent): Promise<void> {
  const { payload } = event;
  const { tenantId, documentId, documentName, userId, content, oldContent, newContent, isUpdate } = payload;

  console.log('[InternalNotificationSubscriber] handleUserMentionedInDocument START', {
    documentId,
    userId,
    hasContent: !!content,
    hasOldContent: !!oldContent,
    hasNewContent: !!newContent,
    isUpdate
  });

  try {
    const db = await getConnection(tenantId);

    // Get document details
    const document = await db('documents')
      .select('document_id', 'document_name', 'tenant')
      .where({ document_id: documentId, tenant: tenantId })
      .first();

    if (!document) {
      console.log('[InternalNotificationSubscriber] Document not found:', documentId);
      return;
    }

    // Get author name
    const author = await db('users')
      .select('first_name', 'last_name')
      .where({ user_id: userId, tenant: tenantId })
      .first();

    const authorName = author ? `${author.first_name} ${author.last_name}` : 'Someone';

    // Determine which content to use based on payload structure
    let mentionedUserIds: string[] = [];

    if (isUpdate && oldContent && newContent) {
      // Smart mention detection: compare old vs new
      const oldMentionedUserIds = extractMentionUserIds(oldContent);
      const newMentionedUserIds = extractMentionUserIds(newContent);

      console.log('[InternalNotificationSubscriber] Document mentions comparison:', {
        oldMentions: oldMentionedUserIds,
        newMentions: newMentionedUserIds
      });

      // Find only NEW mentions (not in old content)
      mentionedUserIds = newMentionedUserIds.filter(
        userId => !oldMentionedUserIds.includes(userId)
      );

      console.log('[InternalNotificationSubscriber] Newly mentioned user IDs in document:', mentionedUserIds);
    } else {
      // New document or no old/new content provided - use all mentions from content
      mentionedUserIds = extractMentionUserIds(content || newContent);
      console.log('[InternalNotificationSubscriber] Found mentioned user IDs in document:', mentionedUserIds);
    }

    // Resolve @everyone mentions
    const resolvedMentionedUserIds = await resolveEveryoneMention(db, tenantId, mentionedUserIds);
    console.log('[InternalNotificationSubscriber] Resolved mentioned user IDs in document:', resolvedMentionedUserIds);

    // Get user details for mentioned users
    const mentionedUsers = resolvedMentionedUserIds.length > 0
      ? await db('users')
          .select('user_id', 'username', db.raw("CONCAT(first_name, ' ', last_name) as display_name"))
          .whereIn('user_id', resolvedMentionedUserIds)
          .andWhere('tenant', tenantId)
      : [];

    console.log('[InternalNotificationSubscriber] Found mentioned users in document:', mentionedUsers.length);

    // Resolve links for MSP portal
    const { internalUrl } = await resolveNotificationLinks(db, tenantId, {
      type: 'document',
      documentId
    });

    // Track users who have been notified to avoid duplicates
    const notifiedUserIds = new Set<string>();

    // Create notifications for mentioned users (excluding the document author)
    for (const mentionedUser of mentionedUsers) {
      if (mentionedUser.user_id !== userId && !notifiedUserIds.has(mentionedUser.user_id)) {
        await createNotificationFromTemplateInternal(db, {
          tenant: tenantId,
          user_id: mentionedUser.user_id,
          template_name: 'user-mentioned-in-document',
          type: 'info',
          category: 'messages',
          link: internalUrl,
          data: {
            authorName,
            documentName: document.document_name || 'Untitled Document'
          },
          metadata: {
            documentId: document.document_id,
            documentName: document.document_name || 'Untitled Document',
            authorName: authorName,
            authorId: userId
          }
        });

        notifiedUserIds.add(mentionedUser.user_id);

        console.log('[InternalNotificationSubscriber] Created notification for user mentioned in document', {
          documentId,
          mentionedUserId: mentionedUser.user_id,
          mentionedUsername: mentionedUser.username,
          documentAuthor: userId,
          tenantId
        });

        logger.info('[InternalNotificationSubscriber] Created notification for user mentioned in document', {
          documentId,
          mentionedUserId: mentionedUser.user_id,
          documentAuthor: userId,
          tenantId
        });
      }
    }
  } catch (error) {
    logger.error('[InternalNotificationSubscriber] Error handling user mentioned in document', {
      error,
      documentId,
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

    // Get project details including assigned_to
    const project = await db('projects as p')
      .select(
        'p.project_id',
        'p.project_name',
        'p.wbs_code',
        'p.assigned_to',
        'c.client_name'
      )
      .leftJoin('clients as c', function() {
        this.on('p.client_id', 'c.client_id')
            .andOn('p.tenant', 'c.tenant');
      })
      .where('p.project_id', projectId)
      .andWhere('p.tenant', tenantId)
      .first();

    if (!project) {
      logger.warn('[InternalNotificationSubscriber] Project not found', {
        projectId,
        tenantId
      });
      return;
    }

    // Resolve links for MSP portal
    const { internalUrl } = await resolveNotificationLinks(db, tenantId, {
      type: 'project',
      projectId
    });

    // Notify the assigned user (if assigned and not the creator)
    if (project.assigned_to && project.assigned_to !== userId) {
      await createNotificationFromTemplateInternal(db, {
        tenant: tenantId,
        user_id: project.assigned_to,
        template_name: 'project-created',
        type: 'info',
        category: 'projects',
        link: internalUrl,
        data: {
          projectName: project.project_name,
          clientName: project.client_name || 'Unknown'
        },
        metadata: {
          projectId: project.project_id,
          projectName: project.project_name,
          wbsCode: project.wbs_code
        }
      });

      logger.info('[InternalNotificationSubscriber] Created notification for project created', {
        projectId,
        userId: project.assigned_to,
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

    // Resolve links for MSP portal
    const { internalUrl } = await resolveNotificationLinks(db, tenantId, {
      type: 'project',
      projectId
    });

    // Create notification for assigned user
    await createNotificationFromTemplateInternal(db, {
      tenant: tenantId,
      user_id: assignedTo,
      template_name: 'project-assigned',
      type: 'info',
      category: 'projects',
      link: internalUrl,
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
  const { tenantId, projectId, taskId, userId, assignedByUserId } = payload;

  try {
    const db = await getConnection(tenantId);

    // Get task and project details
    const task = await db('project_tasks as pt')
      .select(
        'pt.task_name',
        'p.project_name'
      )
      .leftJoin('project_phases as ph', function() {
        this.on('pt.phase_id', 'ph.phase_id')
            .andOn('pt.tenant', 'ph.tenant');
      })
      .leftJoin('projects as p', function() {
        this.on('ph.project_id', 'p.project_id')
            .andOn('ph.tenant', 'p.tenant');
      })
      .where({
        'pt.task_id': taskId,
        'pt.tenant': tenantId
      })
      .first();

    if (!task || !userId) {
      logger.warn('[InternalNotificationSubscriber] Task not found or not assigned', {
        taskId,
        projectId,
        tenantId
      });
      return;
    }

    // Look up who performed the assignment
    const assignedByUser = assignedByUserId ? await db('users')
      .select('first_name', 'last_name')
      .where({ user_id: assignedByUserId, tenant: tenantId })
      .first() : null;

    const performedByName = assignedByUser
      ? `${assignedByUser.first_name} ${assignedByUser.last_name}`
      : 'Someone';

    // Resolve links for MSP portal
    const { internalUrl } = await resolveNotificationLinks(db, tenantId, {
      type: 'project_task',
      projectId,
      taskId
    });

    // Primary assignment notification
    await createNotificationFromTemplateInternal(db, {
      tenant: tenantId,
      user_id: userId,
      template_name: 'task-assigned',
      type: 'info',
      category: 'projects',
      link: internalUrl,
      data: {
        taskName: task.task_name,
        projectName: task.project_name,
        performedByName
      }
    });

    logger.info('[InternalNotificationSubscriber] Created notification for task assigned', {
      taskId,
      projectId,
      userId: userId,
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
        this.on('i.client_id', 'c.client_id')
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

    // Resolve links for MSP portal
    const { internalUrl } = await resolveNotificationLinks(db, tenantId, {
      type: 'invoice',
      invoiceId
    });

    // Get users who should be notified about invoices (e.g., accounting team)
    // For now, notify the user who created the invoice
    if (userId) {
      await createNotificationFromTemplateInternal(db, {
        tenant: tenantId,
        user_id: userId,
        template_name: 'invoice-generated',
        type: 'success',
        category: 'invoices',
        link: internalUrl,
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
    const db = await getConnection(tenantId);

    // Resolve links for MSP portal
    const { internalUrl } = await resolveNotificationLinks(db, tenantId, {
      type: 'message',
      conversationId
    });

    // Create notification for the recipient
    await createNotificationFromTemplateInternal(db, {
      tenant: tenantId,
      user_id: recipientId,
      template_name: 'message-sent',
      type: 'info',
      category: 'messages',
      link: internalUrl,
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
 * Handle appointment request created events
 */
async function handleAppointmentRequestCreated(event: AppointmentRequestCreatedEvent): Promise<void> {
  const { payload } = event;
  const {
    tenantId,
    appointmentRequestId,
    clientId,
    clientUserId,
    serviceName,
    requestedDate,
    requestedTime,
    requesterName,
    isAuthenticated
  } = payload;

  try {
    const db = await getConnection(tenantId);

    // Send notification to CLIENT who created the request (if authenticated)
    if (isAuthenticated && clientUserId) {
      await createNotificationFromTemplateInternal(db, {
        tenant: tenantId,
        user_id: clientUserId,
        template_name: 'appointment-request-created-client',
        type: 'info',
        category: 'appointments',
        link: `/client-portal/appointments/${appointmentRequestId}`,
        data: {
          serviceName,
          requestedDate,
          requestedTime,
          referenceNumber: appointmentRequestId.slice(0, 8).toUpperCase()
        }
      });

      logger.info('[InternalNotificationSubscriber] Created notification for appointment request (client)', {
        appointmentRequestId,
        clientUserId,
        tenantId
      });
    }

    // Send notification to MSP STAFF
    // Get users with 'schedule' 'update' permission
    const staffUsers = await db('users as u')
      .join('user_roles as ur', function() {
        this.on('u.user_id', 'ur.user_id')
            .andOn('u.tenant', 'ur.tenant');
      })
      .join('roles as r', function() {
        this.on('ur.role_id', 'r.role_id')
            .andOn('ur.tenant', 'r.tenant');
      })
      .join('role_permissions as rp', function() {
        this.on('r.role_id', 'rp.role_id')
            .andOn('r.tenant', 'rp.tenant');
      })
      .join('permissions as p', function() {
        this.on('rp.permission_id', 'p.permission_id');
      })
      .where({
        'u.tenant': tenantId,
        'u.user_type': 'internal',
        'p.resource': 'schedule',
        'p.action': 'update'
      })
      .distinct('u.user_id');

    // Get client name if available
    let clientName = 'Unknown';
    if (clientId) {
      const client = await db('companies')
        .select('company_name')
        .where({ company_id: clientId, tenant: tenantId })
        .first();
      clientName = client?.company_name || 'Unknown';
    }

    for (const staffUser of staffUsers) {
      await createNotificationFromTemplateInternal(db, {
        tenant: tenantId,
        user_id: staffUser.user_id,
        template_name: 'appointment-request-created-staff',
        type: 'info',
        category: 'appointments',
        link: `/msp/appointments/requests/${appointmentRequestId}`,
        data: {
          requesterName: requesterName || 'Unknown',
          clientName,
          serviceName,
          requestedDate,
          requestedTime
        },
        metadata: {
          appointment_request_id: appointmentRequestId,
          requires_action: true
        }
      });
    }

    logger.info('[InternalNotificationSubscriber] Created notifications for appointment request (staff)', {
      appointmentRequestId,
      staffCount: staffUsers.length,
      tenantId
    });
  } catch (error) {
    logger.error('[InternalNotificationSubscriber] Error handling appointment request created', {
      error,
      appointmentRequestId,
      tenantId
    });
  }
}

/**
 * Handle appointment request approved events
 */
async function handleAppointmentRequestApproved(event: AppointmentRequestApprovedEvent): Promise<void> {
  const { payload } = event;
  const {
    tenantId,
    appointmentRequestId,
    clientUserId,
    serviceName,
    requestedDate,
    requestedTime,
    assignedUserId
  } = payload;

  try {
    const db = await getConnection(tenantId);

    // Send notification to CLIENT
    if (clientUserId) {
      // Get technician name
      let technicianName = 'Your technician';
      if (assignedUserId) {
        const technician = await db('users')
          .select('first_name', 'last_name')
          .where({ user_id: assignedUserId, tenant: tenantId })
          .first();

        if (technician) {
          technicianName = `${technician.first_name} ${technician.last_name}`;
        }
      }

      await createNotificationFromTemplateInternal(db, {
        tenant: tenantId,
        user_id: clientUserId,
        template_name: 'appointment-request-approved',
        type: 'success',
        category: 'appointments',
        link: `/client-portal/appointments/${appointmentRequestId}`,
        data: {
          serviceName,
          appointmentDate: requestedDate,
          appointmentTime: requestedTime,
          technicianName
        }
      });

      logger.info('[InternalNotificationSubscriber] Created notification for appointment approved', {
        appointmentRequestId,
        clientUserId,
        tenantId
      });
    }
  } catch (error) {
    logger.error('[InternalNotificationSubscriber] Error handling appointment request approved', {
      error,
      appointmentRequestId,
      tenantId
    });
  }
}

/**
 * Handle appointment request declined events
 */
async function handleAppointmentRequestDeclined(event: AppointmentRequestDeclinedEvent): Promise<void> {
  const { payload } = event;
  const {
    tenantId,
    appointmentRequestId,
    clientUserId,
    serviceName,
    declineReason
  } = payload;

  try {
    const db = await getConnection(tenantId);

    // Send notification to CLIENT
    if (clientUserId) {
      await createNotificationFromTemplateInternal(db, {
        tenant: tenantId,
        user_id: clientUserId,
        template_name: 'appointment-request-declined',
        type: 'warning',
        category: 'appointments',
        link: `/client-portal/appointments/${appointmentRequestId}`,
        data: {
          serviceName,
          declineReason: declineReason || 'No reason provided'
        }
      });

      logger.info('[InternalNotificationSubscriber] Created notification for appointment declined', {
        appointmentRequestId,
        clientUserId,
        tenantId
      });
    }
  } catch (error) {
    logger.error('[InternalNotificationSubscriber] Error handling appointment request declined', {
      error,
      appointmentRequestId,
      tenantId
    });
  }
}

/**
 * Handle appointment request cancelled events
 */
async function handleAppointmentRequestCancelled(event: AppointmentRequestCancelledEvent): Promise<void> {
  const { payload } = event;
  const {
    tenantId,
    appointmentRequestId,
    serviceName,
    requestedDate,
    requesterName
  } = payload;

  try {
    const db = await getConnection(tenantId);

    // Send notification to MSP STAFF (who had been notified about this request)
    const staffUsers = await db('users as u')
      .join('user_roles as ur', function() {
        this.on('u.user_id', 'ur.user_id')
            .andOn('u.tenant', 'ur.tenant');
      })
      .join('roles as r', function() {
        this.on('ur.role_id', 'r.role_id')
            .andOn('ur.tenant', 'r.tenant');
      })
      .join('role_permissions as rp', function() {
        this.on('r.role_id', 'rp.role_id')
            .andOn('r.tenant', 'rp.tenant');
      })
      .join('permissions as p', function() {
        this.on('rp.permission_id', 'p.permission_id');
      })
      .where({
        'u.tenant': tenantId,
        'u.user_type': 'internal',
        'p.resource': 'schedule',
        'p.action': 'update'
      })
      .distinct('u.user_id');

    for (const staffUser of staffUsers) {
      await createNotificationFromTemplateInternal(db, {
        tenant: tenantId,
        user_id: staffUser.user_id,
        template_name: 'appointment-request-cancelled-staff',
        type: 'info',
        category: 'appointments',
        link: `/msp/appointments/requests/${appointmentRequestId}`,
        data: {
          requesterName: requesterName || 'A client',
          serviceName,
          requestedDate
        }
      });
    }

    logger.info('[InternalNotificationSubscriber] Created notifications for appointment cancelled', {
      appointmentRequestId,
      staffCount: staffUsers.length,
      tenantId
    });
  } catch (error) {
    logger.error('[InternalNotificationSubscriber] Error handling appointment request cancelled', {
      error,
      appointmentRequestId,
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
    case 'TICKET_ADDITIONAL_AGENT_ASSIGNED':
      await handleTicketAdditionalAgentAssigned(validatedEvent as TicketAdditionalAgentAssignedEvent);
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
    case 'TICKET_COMMENT_UPDATED':
      await handleTicketCommentUpdated(validatedEvent as TicketCommentUpdatedEvent);
      break;
    case 'TASK_COMMENT_ADDED':
      await handleTaskCommentAdded(validatedEvent as TaskCommentAddedEvent);
      break;
    case 'TASK_COMMENT_UPDATED':
      await handleTaskCommentUpdated(validatedEvent as TaskCommentUpdatedEvent);
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
    case 'PROJECT_TASK_ADDITIONAL_AGENT_ASSIGNED':
      await handleProjectTaskAdditionalAgentAssigned(validatedEvent as ProjectTaskAdditionalAgentAssignedEvent);
      break;
    case 'INVOICE_GENERATED':
      await handleInvoiceGenerated(validatedEvent as InvoiceGeneratedEvent);
      break;
    case 'MESSAGE_SENT':
      await handleMessageSent(validatedEvent as MessageSentEvent);
      break;
    case 'USER_MENTIONED_IN_DOCUMENT':
      await handleUserMentionedInDocument(validatedEvent as UserMentionedInDocumentEvent);
      break;
    case 'APPOINTMENT_REQUEST_CREATED':
      await handleAppointmentRequestCreated(validatedEvent as AppointmentRequestCreatedEvent);
      break;
    case 'APPOINTMENT_REQUEST_APPROVED':
      await handleAppointmentRequestApproved(validatedEvent as AppointmentRequestApprovedEvent);
      break;
    case 'APPOINTMENT_REQUEST_DECLINED':
      await handleAppointmentRequestDeclined(validatedEvent as AppointmentRequestDeclinedEvent);
      break;
    case 'APPOINTMENT_REQUEST_CANCELLED':
      await handleAppointmentRequestCancelled(validatedEvent as AppointmentRequestCancelledEvent);
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
      'TICKET_ADDITIONAL_AGENT_ASSIGNED',
      'TICKET_UPDATED',
      'TICKET_CLOSED',
      'TICKET_COMMENT_ADDED',
      'TICKET_COMMENT_UPDATED',
      'TASK_COMMENT_ADDED',
      'TASK_COMMENT_UPDATED',
      'PROJECT_CREATED',
      'PROJECT_ASSIGNED',
      'PROJECT_TASK_ASSIGNED',
      'PROJECT_TASK_ADDITIONAL_AGENT_ASSIGNED',
      'INVOICE_GENERATED',
      'MESSAGE_SENT',
      'USER_MENTIONED_IN_DOCUMENT',
      'APPOINTMENT_REQUEST_CREATED',
      'APPOINTMENT_REQUEST_APPROVED',
      'APPOINTMENT_REQUEST_DECLINED',
      'APPOINTMENT_REQUEST_CANCELLED'
    ];

    // Use a dedicated channel for internal notifications
    const channel = 'internal-notifications';

    for (const eventType of eventTypes) {
      await getEventBus().subscribe(eventType as any, handleInternalNotificationEvent, { channel });
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
      'TICKET_ADDITIONAL_AGENT_ASSIGNED',
      'TICKET_UPDATED',
      'TICKET_CLOSED',
      'TICKET_COMMENT_ADDED',
      'TICKET_COMMENT_UPDATED',
      'TASK_COMMENT_ADDED',
      'TASK_COMMENT_UPDATED',
      'PROJECT_CREATED',
      'PROJECT_ASSIGNED',
      'PROJECT_TASK_ASSIGNED',
      'PROJECT_TASK_ADDITIONAL_AGENT_ASSIGNED',
      'INVOICE_GENERATED',
      'MESSAGE_SENT',
      'USER_MENTIONED_IN_DOCUMENT',
      'APPOINTMENT_REQUEST_CREATED',
      'APPOINTMENT_REQUEST_APPROVED',
      'APPOINTMENT_REQUEST_DECLINED',
      'APPOINTMENT_REQUEST_CANCELLED'
    ];

    const channel = 'internal-notifications';

    for (const eventType of eventTypes) {
      await getEventBus().unsubscribe(eventType as any, handleInternalNotificationEvent, { channel });
    }

    logger.info('[InternalNotificationSubscriber] Successfully unregistered');
  } catch (error) {
    logger.error('[InternalNotificationSubscriber] Failed to unregister:', error);
    throw error;
  }
}
