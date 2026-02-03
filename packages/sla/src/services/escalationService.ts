/**
 * Escalation Service
 *
 * Handles ticket escalation logic when SLA thresholds are reached.
 * When escalation level increases:
 * 1. Looks up the configured escalation manager for the board/level
 * 2. Adds the manager as an additional resource on the ticket
 * 3. Sends notifications to the manager
 * 4. Updates ticket escalation fields
 */

import { Knex } from 'knex';
import { IEscalationManagerWithUser } from '../types';

/**
 * Result of escalating a ticket
 */
export interface EscalationResult {
  success: boolean;
  escalationLevel: number;
  managerId: string | null;
  managerName: string | null;
  resourceAdded: boolean;
  notificationsSent: {
    inApp: boolean;
    email: boolean;
  };
  error?: string;
}

/**
 * Escalate a ticket to a new level.
 *
 * This function:
 * 1. Updates the ticket's escalation fields
 * 2. Finds the escalation manager for the board/level
 * 3. Adds the manager as an additional resource
 * 4. Sends notifications to the manager
 */
export async function escalateTicket(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string,
  newLevel: 1 | 2 | 3,
  escalatedBy?: string
): Promise<EscalationResult> {
  const result: EscalationResult = {
    success: false,
    escalationLevel: newLevel,
    managerId: null,
    managerName: null,
    resourceAdded: false,
    notificationsSent: { inApp: false, email: false }
  };

  try {
    // 1. Get ticket details
    const ticket = await trx('tickets')
      .where({ tenant, ticket_id: ticketId })
      .select(
        'ticket_id',
        'ticket_number',
        'title',
        'board_id',
        'assigned_to',
        'escalation_level',
        'escalated'
      )
      .first();

    if (!ticket) {
      result.error = 'Ticket not found';
      return result;
    }

    // Don't escalate if already at this level or higher
    if (ticket.escalation_level && ticket.escalation_level >= newLevel) {
      result.success = true;
      result.error = 'Ticket already at or above this escalation level';
      return result;
    }

    // 2. Update ticket escalation fields
    await trx('tickets')
      .where({ tenant, ticket_id: ticketId })
      .update({
        escalated: true,
        escalation_level: newLevel,
        escalated_at: trx.fn.now(),
        escalated_by: escalatedBy || null
      });

    // 3. Get the escalation manager for this board/level
    const manager = await getEscalationManagerInternal(
      trx,
      tenant,
      ticket.board_id,
      newLevel
    );

    if (!manager || !manager.manager_user_id) {
      // No manager configured - still successful escalation, just no notification
      result.success = true;
      await logEscalationEvent(trx, tenant, ticketId, {
        level: newLevel,
        escalated_by: escalatedBy,
        manager_found: false
      });
      return result;
    }

    result.managerId = manager.manager_user_id;
    result.managerName = `${manager.manager_first_name || ''} ${manager.manager_last_name || ''}`.trim() || null;

    // 4. Add manager as additional resource
    const resourceAdded = await addEscalationManagerAsResource(
      trx,
      tenant,
      ticketId,
      ticket.assigned_to,
      manager.manager_user_id,
      newLevel
    );
    result.resourceAdded = resourceAdded;

    // 5. Send notifications
    const notifyVia = manager.notify_via || ['in_app', 'email'];

    if (notifyVia.includes('in_app')) {
      const inAppSent = await sendEscalationInAppNotification(
        trx,
        tenant,
        manager.manager_user_id,
        ticketId,
        ticket.ticket_number,
        ticket.title,
        newLevel
      );
      result.notificationsSent.inApp = inAppSent;
    }

    if (notifyVia.includes('email') && manager.manager_email) {
      const emailSent = await sendEscalationEmailNotification(
        trx,
        tenant,
        manager.manager_user_id,
        manager.manager_email,
        ticketId,
        ticket.ticket_number,
        ticket.title,
        newLevel
      );
      result.notificationsSent.email = emailSent;
    }

    // 6. Log the escalation event
    await logEscalationEvent(trx, tenant, ticketId, {
      level: newLevel,
      escalated_by: escalatedBy,
      manager_found: true,
      manager_id: manager.manager_user_id,
      resource_added: resourceAdded,
      notifications: result.notificationsSent
    });

    result.success = true;
    return result;
  } catch (error) {
    console.error('Error escalating ticket:', error);
    result.error = error instanceof Error ? error.message : 'Unknown error';
    return result;
  }
}

/**
 * Get the escalation manager for a ticket based on its board.
 */
export async function getEscalationManagerForTicket(
  trx: Knex | Knex.Transaction,
  tenant: string,
  ticketId: string,
  level: 1 | 2 | 3
): Promise<IEscalationManagerWithUser | null> {
  // Get ticket's board
  const ticket = await trx('tickets')
    .where({ tenant, ticket_id: ticketId })
    .select('board_id')
    .first();

  if (!ticket || !ticket.board_id) {
    return null;
  }

  return getEscalationManagerInternal(trx, tenant, ticket.board_id, level);
}

/**
 * Check if escalation is needed based on SLA elapsed percentage.
 *
 * @returns The escalation level that should be triggered, or null if none
 */
export async function checkEscalationNeeded(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string,
  elapsedPercent: number
): Promise<1 | 2 | 3 | null> {
  // Get ticket and its SLA policy target
  const ticket = await trx('tickets')
    .where({ tenant, ticket_id: ticketId })
    .select(
      'sla_policy_id',
      'priority_id',
      'escalation_level'
    )
    .first();

  if (!ticket || !ticket.sla_policy_id || !ticket.priority_id) {
    return null;
  }

  // Get the SLA target for this priority
  const target = await trx('sla_policy_targets')
    .where({
      tenant,
      sla_policy_id: ticket.sla_policy_id,
      priority_id: ticket.priority_id
    })
    .select(
      'escalation_1_percent',
      'escalation_2_percent',
      'escalation_3_percent'
    )
    .first();

  if (!target) {
    return null;
  }

  const currentLevel = ticket.escalation_level || 0;

  // Check which escalation level should be triggered
  // Only trigger if we haven't already escalated to this level
  if (target.escalation_3_percent && elapsedPercent >= target.escalation_3_percent && currentLevel < 3) {
    return 3;
  } else if (target.escalation_2_percent && elapsedPercent >= target.escalation_2_percent && currentLevel < 2) {
    return 2;
  } else if (target.escalation_1_percent && elapsedPercent >= target.escalation_1_percent && currentLevel < 1) {
    return 1;
  }

  return null;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Internal function to get escalation manager.
 */
async function getEscalationManagerInternal(
  trx: Knex | Knex.Transaction,
  tenant: string,
  boardId: string,
  level: 1 | 2 | 3
): Promise<IEscalationManagerWithUser | null> {
  const config = await trx('escalation_managers as em')
    .leftJoin('users as u', function() {
      this.on('em.manager_user_id', 'u.user_id')
          .andOn('em.tenant', 'u.tenant');
    })
    .where('em.tenant', tenant)
    .where('em.board_id', boardId)
    .where('em.escalation_level', level)
    .select(
      'em.*',
      'u.first_name as manager_first_name',
      'u.last_name as manager_last_name',
      'u.email as manager_email'
    )
    .first();

  return config || null;
}

/**
 * Add escalation manager as an additional resource on the ticket.
 */
async function addEscalationManagerAsResource(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string,
  assignedTo: string | null,
  managerId: string,
  level: number
): Promise<boolean> {
  try {
    // Check if this manager is already a resource on this ticket
    const existingResource = await trx('ticket_resources')
      .where({
        tenant,
        ticket_id: ticketId,
        additional_user_id: managerId
      })
      .first();

    if (existingResource) {
      // Update the role to reflect new escalation level
      await trx('ticket_resources')
        .where({
          tenant,
          assignment_id: existingResource.assignment_id
        })
        .update({
          role: `escalation_manager_L${level}`
        });
      return true;
    }

    // Add as new resource
    await trx('ticket_resources')
      .insert({
        assignment_id: crypto.randomUUID(),
        tenant,
        ticket_id: ticketId,
        assigned_to: assignedTo,
        additional_user_id: managerId,
        role: `escalation_manager_L${level}`,
        assigned_at: trx.fn.now()
      });

    return true;
  } catch (error) {
    console.error('Error adding escalation manager as resource:', error);
    return false;
  }
}

/**
 * Send in-app notification for escalation.
 */
async function sendEscalationInAppNotification(
  trx: Knex.Transaction,
  tenant: string,
  userId: string,
  ticketId: string,
  ticketNumber: string,
  ticketTitle: string,
  level: number
): Promise<boolean> {
  try {
    // Insert notification directly into internal_notifications table
    await trx('internal_notifications').insert({
      notification_id: crypto.randomUUID(),
      tenant,
      user_id: userId,
      type: 'warning',
      title: `Ticket Escalated to Level ${level}`,
      message: `Ticket #${ticketNumber}: "${ticketTitle}" has been escalated to level ${level} and requires your attention.`,
      category: 'sla',
      link: `/msp/tickets/${ticketId}`,
      metadata: JSON.stringify({
        ticket_id: ticketId,
        escalation_level: level,
        subtype: 'sla-escalation'
      }),
      read: false,
      created_at: trx.fn.now()
    });

    return true;
  } catch (error) {
    console.error('Error sending escalation in-app notification:', error);
    return false;
  }
}

/**
 * Send email notification for escalation.
 */
async function sendEscalationEmailNotification(
  trx: Knex.Transaction,
  tenant: string,
  userId: string,
  email: string,
  ticketId: string,
  ticketNumber: string,
  ticketTitle: string,
  level: number
): Promise<boolean> {
  try {
    // Import the email notification service
    const { getEmailNotificationService } = await import(
      '@alga-psa/notifications/notifications/email'
    );

    const emailService = getEmailNotificationService();

    // Get the SLA Escalation notification subtype ID
    const subtype = await trx('notification_subtypes')
      .where({ name: 'SLA Escalation' })
      .first();

    if (!subtype) {
      console.warn('SLA Escalation notification subtype not found, falling back to SLA Warning');
      // Try to fall back to SLA Warning subtype
      const fallbackSubtype = await trx('notification_subtypes')
        .where({ name: 'SLA Warning' })
        .first();

      if (!fallbackSubtype) {
        console.error('No suitable notification subtype found for escalation email');
        return false;
      }
    }

    // Get additional ticket context for the email template
    const ticketDetails = await trx('tickets as t')
      .leftJoin('clients as c', function() {
        this.on('t.client_id', 'c.client_id')
            .andOn('t.tenant', 'c.tenant');
      })
      .leftJoin('priorities as p', function() {
        this.on('t.priority_id', 'p.priority_id')
            .andOn('t.tenant', 'p.tenant');
      })
      .leftJoin('users as u', function() {
        this.on('t.assigned_to', 'u.user_id')
            .andOn('t.tenant', 'u.tenant');
      })
      .where('t.tenant', tenant)
      .where('t.ticket_id', ticketId)
      .select(
        'c.client_name as client_name',
        'p.priority_name',
        trx.raw("CONCAT(u.first_name, ' ', u.last_name) as assignee_name")
      )
      .first();

    // Get recipient name
    const recipient = await trx('users')
      .where({ tenant, user_id: userId })
      .select('first_name', 'last_name')
      .first();

    const recipientName = recipient
      ? `${recipient.first_name || ''} ${recipient.last_name || ''}`.trim() || 'Team Member'
      : 'Team Member';

    // Build template data matching sla-escalation template variables
    const templateData = {
      recipientName,
      ticketNumber,
      ticketTitle,
      escalationLevel: level,
      escalationReason: `SLA threshold reached - escalated to level ${level}`,
      priority: ticketDetails?.priority_name || 'Not set',
      clientName: ticketDetails?.client_name || 'Unknown',
      assigneeName: ticketDetails?.assignee_name || 'Unassigned',
      ticketUrl: `/msp/tickets/${ticketId}`
    };

    await emailService.sendNotification({
      tenant,
      userId,
      subtypeId: subtype?.id || 1,
      emailAddress: email,
      templateName: 'SLA Escalation',
      data: templateData as Record<string, string | number | boolean>
    });

    return true;
  } catch (error) {
    console.error('Error sending escalation email notification:', error);
    return false;
  }
}

/**
 * Log escalation event to audit log.
 */
async function logEscalationEvent(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string,
  eventData: Record<string, unknown>
): Promise<void> {
  try {
    await trx('sla_audit_log').insert({
      log_id: crypto.randomUUID(),
      tenant,
      ticket_id: ticketId,
      event_type: 'ticket_escalated',
      event_data: JSON.stringify(eventData),
      created_at: trx.fn.now()
    });
  } catch (error) {
    console.error('Error logging escalation event:', error);
  }
}
