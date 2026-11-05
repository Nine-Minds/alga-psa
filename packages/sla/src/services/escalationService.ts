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
import { registerAfterCommitWithConnection, tenantDb } from '@alga-psa/db';
import type { Knex as RootKnex } from 'knex';
import { IEscalationManagerWithUser } from '../types';
import { getEmailNotificationService } from '@alga-psa/notifications/notifications/email';
import type { EmailNotificationResult } from '@alga-psa/notifications/notifications/email';
import { createNotificationFromTemplateInternal } from '@alga-psa/notifications/actions/internal-notification-actions/internalNotificationActions';

/** Resolve the email consumer through this module's configured worker import. */
export function getEscalationEmailNotificationService() {
  return getEmailNotificationService();
}

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
    const scopedDb = tenantDb(trx, tenant);

    // 1. Get ticket details
    const ticket = await scopedDb.table('tickets')
      .where({ ticket_id: ticketId })
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
    await scopedDb.table('tickets')
      .where({ ticket_id: ticketId })
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
        manager_found: false,
        notifications: { inApp: false, email: 'skipped' },
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

    let sendEmail: (() => Promise<EmailNotificationResult>) | null = null;
    if (notifyVia.includes('email') && manager.manager_email) {
      sendEmail = await sendEscalationEmailNotification(
        trx,
        tenant,
        manager.manager_user_id,
        manager.manager_email,
        ticketId,
        ticket.ticket_number,
        ticket.title,
        newLevel
      );
      result.notificationsSent.email = sendEmail !== null;
    }

    // 6. Log the escalation event
    const auditLogId = await logEscalationEvent(trx, tenant, ticketId, {
      level: newLevel,
      escalated_by: escalatedBy,
      manager_found: true,
      manager_id: manager.manager_user_id,
      resource_added: resourceAdded,
      notifications: {
        inApp: result.notificationsSent.inApp,
        email: sendEmail ? 'queued' : 'skipped',
      }
    });

    if (sendEmail) {
      registerEmailOutcome(trx, tenant, ticketId, auditLogId, sendEmail);
    }

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
  const scopedDb = tenantDb(trx, tenant);

  // Get ticket's board
  const ticket = await scopedDb.table('tickets')
    .where({ ticket_id: ticketId })
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
  const scopedDb = tenantDb(trx, tenant);

  // Get ticket and its SLA policy target
  const ticket = await scopedDb.table('tickets')
    .where({ ticket_id: ticketId })
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
  const target = await scopedDb.table('sla_policy_targets')
    .where({
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
  const scopedDb = tenantDb(trx, tenant);
  const configQuery = scopedDb.table<any>('escalation_managers as em');
  scopedDb.tenantJoin(configQuery, 'users as u', 'em.manager_user_id', 'u.user_id', { type: 'left' });

  const config = await configQuery
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
  const scopedDb = tenantDb(trx, tenant);

  // Check if this manager is already a resource on this ticket
  const existingResource = await scopedDb.table('ticket_resources')
    .where({
      ticket_id: ticketId,
      additional_user_id: managerId
    })
    .first();

  if (existingResource) {
    // Update the role to reflect new escalation level
    await scopedDb.table('ticket_resources')
      .where({
        assignment_id: existingResource.assignment_id
      })
      .update({
        role: `escalation_manager_L${level}`
      });
    return true;
  }

  // Add as new resource
  await scopedDb.table('ticket_resources')
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
  // Use the central template creation path so enablement, locale, configured
  // priority resolution, broadcasts, and post-creation delivery hooks all run.
  const notification = await createNotificationFromTemplateInternal(trx, {
    tenant,
    user_id: userId,
    template_name: 'sla-escalation',
    type: 'warning',
    data: {
      ticketNumber,
      ticketTitle,
      escalationLevel: level,
    },
    category: 'sla',
    link: `/msp/tickets/${ticketId}`,
    metadata: {
      ticket_id: ticketId,
      escalation_level: level,
      subtype: 'sla-escalation'
    },
  });

  return notification !== null;
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
): Promise<(() => Promise<EmailNotificationResult>) | null> {
  const emailService = getEscalationEmailNotificationService();

  // Get the SLA Escalation notification subtype ID
  const subtype = await tenantDb(trx, tenant)
    .unscoped('notification_subtypes', 'global notification subtype catalog shared across tenants')
    .where({ name: 'SLA Escalation' })
    .first();

  let resolvedSubtype = subtype;
  if (!resolvedSubtype) {
    console.warn('SLA Escalation notification subtype not found, falling back to SLA Warning');
    // Try to fall back to SLA Warning subtype
    resolvedSubtype = await tenantDb(trx, tenant)
      .unscoped('notification_subtypes', 'global notification subtype catalog shared across tenants')
      .where({ name: 'SLA Warning' })
      .first();

    if (!resolvedSubtype) {
      console.error('No suitable notification subtype found for escalation email');
      return null;
    }
  }

  // Get additional ticket context for the email template
  const scopedDb = tenantDb(trx, tenant);
  const ticketDetailsQuery = scopedDb.table<any>('tickets as t');
  scopedDb.tenantJoin(ticketDetailsQuery, 'clients as c', 't.client_id', 'c.client_id', { type: 'left' });
  scopedDb.tenantJoin(ticketDetailsQuery, 'priorities as p', 't.priority_id', 'p.priority_id', { type: 'left' });
  scopedDb.tenantJoin(ticketDetailsQuery, 'users as u', 't.assigned_to', 'u.user_id', { type: 'left' });

  const ticketDetails = await ticketDetailsQuery
    .where('t.ticket_id', ticketId)
    .select(
      't.board_id',
      'c.client_name as client_name',
      'p.priority_name',
      trx.raw("CONCAT(u.first_name, ' ', u.last_name) as assignee_name")
    )
    .first();

  // Get recipient name
  const recipient = await scopedDb.table('users')
    .where({ user_id: userId })
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

  // Defer the send until the escalation transaction commits: a rollback (and the
  // Temporal retry that follows) must not leave a stray email behind.
  const boardId = ticketDetails?.board_id;
  const subtypeId = resolvedSubtype.id;
  return () =>
      emailService.sendNotification({
        mailClass: 'ticket',
        boardId,
        tenant,
        userId,
        subtypeId,
        emailAddress: email,
        templateName: 'sla-escalation',
        data: templateData as Record<string, string | number | boolean>
      });
}

/**
 * Log escalation event to audit log.
 */
async function logEscalationEvent(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string,
  eventData: Record<string, unknown>
): Promise<string> {
  const logId = crypto.randomUUID();
  await tenantDb(trx, tenant).table('sla_audit_log').insert({
    log_id: logId,
    tenant,
    ticket_id: ticketId,
    event_type: 'ticket_escalated',
    event_data: JSON.stringify(eventData),
    created_at: trx.fn.now()
  });
  return logId;
}

function registerEmailOutcome(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string,
  auditLogId: string,
  sendEmail: () => Promise<EmailNotificationResult>,
): void {
  registerAfterCommitWithConnection(trx, async (connection: RootKnex) => {
    let outcome: EmailNotificationResult | { status: 'failed'; reason: string };
    try {
      outcome = await sendEmail();
      if (outcome.status === 'skipped') outcome = { status: 'skipped', reason: outcome.reason };
    } catch (error) {
      outcome = { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
      console.error('SLA escalation email delivery failed', { ticketId, auditLogId, error });
    }

    try {
      const scoped = tenantDb(connection, tenant);
      const row = await scoped.table('sla_audit_log').where({ log_id: auditLogId, ticket_id: ticketId }).first('event_data');
      if (!row) throw new Error('SLA escalation audit row no longer exists');
      const eventData = typeof row.event_data === 'string' ? JSON.parse(row.event_data) : row.event_data;
      const status = outcome.status === 'sent' ? 'sent' : outcome.status;
      eventData.notifications = {
        ...eventData.notifications,
        email: status,
        ...(outcome.status === 'sent' && outcome.messageId ? { emailMessageId: outcome.messageId } : {}),
        ...(outcome.status !== 'sent' ? { emailReason: outcome.reason } : {}),
      };
      await scoped.table('sla_audit_log').where({ log_id: auditLogId, ticket_id: ticketId }).update({ event_data: JSON.stringify(eventData) });
    } catch (error) {
      console.error('Failed to persist SLA escalation email outcome', { ticketId, auditLogId, error });
      throw error;
    }
  }, `sla-escalation-email ticket=${ticketId} audit=${auditLogId}`);
}
