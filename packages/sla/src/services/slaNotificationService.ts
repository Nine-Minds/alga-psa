/**
 * SLA Notification Service
 *
 * Handles sending SLA-related notifications for:
 * - SLA warnings (approaching breach threshold)
 * - SLA breaches (threshold exceeded)
 * - SLA met (response/resolution completed within SLA)
 * - Escalations
 *
 * Notifications can be sent through:
 * - In-app notifications (internal_notifications)
 * - Email notifications
 *
 * Recipients are determined by the notification threshold configuration:
 * - Ticket assignee
 * - Board manager
 * - Escalation manager (from SLA policy)
 */

import { Knex } from 'knex';
import { SlaNotificationChannel, SlaNotificationType } from '../types';
import { formatRemainingTime } from './businessHoursCalculator';

/**
 * Notification recipient information
 */
interface NotificationRecipient {
  user_id: string;
  email?: string;
  first_name?: string;
  last_name?: string;
}

/**
 * SLA notification context - data needed to send a notification
 */
export interface SlaNotificationContext {
  tenant: string;
  ticketId: string;
  ticketNumber: string;
  ticketTitle: string;
  clientName?: string;
  priorityName?: string;
  assigneeId?: string | null;
  boardId?: string | null;
  slaPolicyId: string;
  /** Which threshold was hit (e.g., 75, 100) */
  thresholdPercent: number;
  /** Whether this is for response or resolution SLA */
  slaType: 'response' | 'resolution';
  /** Minutes remaining (negative if breached) */
  remainingMinutes: number;
  /** Due date/time */
  dueAt: Date;
}

/**
 * Result of sending notifications
 */
export interface NotificationResult {
  success: boolean;
  recipientCount: number;
  inAppSent: number;
  emailSent: number;
  errors: string[];
}

/**
 * Send SLA warning or breach notifications based on threshold configuration.
 *
 * This is the main entry point for SLA notifications. It:
 * 1. Looks up the notification threshold configuration
 * 2. Determines recipients based on configuration
 * 3. Sends notifications through configured channels
 *
 * @param trx - Database transaction
 * @param context - Notification context with ticket and SLA details
 */
export async function sendSlaNotification(
  trx: Knex.Transaction,
  context: SlaNotificationContext
): Promise<NotificationResult> {
  const result: NotificationResult = {
    success: true,
    recipientCount: 0,
    inAppSent: 0,
    emailSent: 0,
    errors: []
  };

  try {
    // 1. Find the matching notification threshold
    const threshold = await findMatchingThreshold(
      trx,
      context.tenant,
      context.slaPolicyId,
      context.thresholdPercent
    );

    if (!threshold) {
      // No threshold configured for this percentage - skip notification
      return result;
    }

    // 2. Determine notification type
    const notificationType: SlaNotificationType =
      context.thresholdPercent >= 100 ? 'breach' : 'warning';

    // 3. Get recipients based on threshold configuration
    const recipients = await getRecipients(
      trx,
      context.tenant,
      context,
      threshold
    );

    result.recipientCount = recipients.length;

    if (recipients.length === 0) {
      return result;
    }

    // 4. Determine template name based on notification type
    const templateName = notificationType === 'breach'
      ? 'sla-breach'
      : 'sla-warning';

    const emailTemplateName = notificationType === 'breach'
      ? 'SLA Breach'
      : 'SLA Warning';

    // 5. Prepare template data
    const templateData = {
      ticketNumber: context.ticketNumber,
      ticketTitle: context.ticketTitle,
      clientName: context.clientName || 'Unknown',
      priorityName: context.priorityName || 'Unknown',
      slaType: context.slaType === 'response' ? 'Response' : 'Resolution',
      thresholdPercent: context.thresholdPercent,
      remainingTime: formatRemainingTime(context.remainingMinutes),
      dueAt: context.dueAt.toISOString(),
      ticketUrl: `/msp/tickets/${context.ticketId}`
    };

    // 6. Parse channels from threshold
    const channels: SlaNotificationChannel[] = threshold.channels || ['in_app'];

    // 7. Send notifications to each recipient
    for (const recipient of recipients) {
      try {
        // Send in-app notification
        if (channels.includes('in_app')) {
          const inAppResult = await sendInAppNotification(
            trx,
            context.tenant,
            recipient.user_id,
            templateName,
            templateData,
            context.ticketId
          );

          if (inAppResult) {
            result.inAppSent++;
          }
        }

        // Send email notification
        if (channels.includes('email') && recipient.email) {
          const emailResult = await sendEmailNotification(
            trx,
            context.tenant,
            recipient,
            emailTemplateName,
            templateData
          );

          if (emailResult) {
            result.emailSent++;
          }
        }
      } catch (recipientError) {
        const errorMsg = recipientError instanceof Error
          ? recipientError.message
          : 'Unknown error';
        result.errors.push(`Failed to notify ${recipient.user_id}: ${errorMsg}`);
      }
    }

    // Log the notification event
    await logNotificationEvent(trx, context.tenant, context.ticketId, {
      type: notificationType,
      threshold_percent: context.thresholdPercent,
      sla_type: context.slaType,
      recipient_count: recipients.length,
      in_app_sent: result.inAppSent,
      email_sent: result.emailSent,
      errors: result.errors
    });

    return result;
  } catch (error) {
    console.error('Error sending SLA notification:', error);
    result.success = false;
    result.errors.push(error instanceof Error ? error.message : 'Unknown error');
    return result;
  }
}

/**
 * Send a notification for SLA response met/not met.
 */
export async function sendSlaResponseMetNotification(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string,
  ticketNumber: string,
  ticketTitle: string,
  met: boolean,
  respondedAt: Date,
  dueAt: Date
): Promise<NotificationResult> {
  const result: NotificationResult = {
    success: true,
    recipientCount: 0,
    inAppSent: 0,
    emailSent: 0,
    errors: []
  };

  try {
    // Get ticket details for assignee
    const ticket = await trx('tickets')
      .where({ tenant, ticket_id: ticketId })
      .select('assigned_to', 'board_id')
      .first();

    if (!ticket?.assigned_to) {
      return result;
    }

    const templateName = met ? 'sla-response-met' : 'sla-breach';
    const templateData = {
      ticketNumber,
      ticketTitle,
      slaType: 'Response',
      met,
      respondedAt: respondedAt.toISOString(),
      dueAt: dueAt.toISOString(),
      ticketUrl: `/msp/tickets/${ticketId}`
    };

    // Send to assignee
    const inAppResult = await sendInAppNotification(
      trx,
      tenant,
      ticket.assigned_to,
      templateName,
      templateData,
      ticketId
    );

    if (inAppResult) {
      result.inAppSent++;
      result.recipientCount++;
    }

    return result;
  } catch (error) {
    console.error('Error sending SLA response met notification:', error);
    result.success = false;
    result.errors.push(error instanceof Error ? error.message : 'Unknown error');
    return result;
  }
}

/**
 * Send a notification for SLA resolution met/not met.
 */
export async function sendSlaResolutionMetNotification(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string,
  ticketNumber: string,
  ticketTitle: string,
  met: boolean,
  resolvedAt: Date,
  dueAt: Date
): Promise<NotificationResult> {
  const result: NotificationResult = {
    success: true,
    recipientCount: 0,
    inAppSent: 0,
    emailSent: 0,
    errors: []
  };

  try {
    // Get ticket details for assignee
    const ticket = await trx('tickets')
      .where({ tenant, ticket_id: ticketId })
      .select('assigned_to', 'board_id')
      .first();

    if (!ticket?.assigned_to) {
      return result;
    }

    const templateName = met ? 'sla-resolution-met' : 'sla-breach';
    const templateData = {
      ticketNumber,
      ticketTitle,
      slaType: 'Resolution',
      met,
      resolvedAt: resolvedAt.toISOString(),
      dueAt: dueAt.toISOString(),
      ticketUrl: `/msp/tickets/${ticketId}`
    };

    // Send to assignee
    const inAppResult = await sendInAppNotification(
      trx,
      tenant,
      ticket.assigned_to,
      templateName,
      templateData,
      ticketId
    );

    if (inAppResult) {
      result.inAppSent++;
      result.recipientCount++;
    }

    return result;
  } catch (error) {
    console.error('Error sending SLA resolution met notification:', error);
    result.success = false;
    result.errors.push(error instanceof Error ? error.message : 'Unknown error');
    return result;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Find the notification threshold that matches the given percentage.
 */
async function findMatchingThreshold(
  trx: Knex.Transaction,
  tenant: string,
  policyId: string,
  thresholdPercent: number
): Promise<{
  threshold_id: string;
  threshold_percent: number;
  notification_type: SlaNotificationType;
  notify_assignee: boolean;
  notify_board_manager: boolean;
  notify_escalation_manager: boolean;
  channels: SlaNotificationChannel[];
} | null> {
  // Find threshold that matches or is just below the current percentage
  const threshold = await trx('sla_notification_thresholds')
    .where({ tenant, sla_policy_id: policyId })
    .where('threshold_percent', '<=', thresholdPercent)
    .orderBy('threshold_percent', 'desc')
    .first();

  if (!threshold) {
    return null;
  }

  return {
    threshold_id: threshold.threshold_id,
    threshold_percent: threshold.threshold_percent,
    notification_type: threshold.notification_type,
    notify_assignee: threshold.notify_assignee,
    notify_board_manager: threshold.notify_board_manager,
    notify_escalation_manager: threshold.notify_escalation_manager,
    channels: threshold.channels || ['in_app']
  };
}

/**
 * Get recipients based on notification threshold configuration.
 */
async function getRecipients(
  trx: Knex.Transaction,
  tenant: string,
  context: SlaNotificationContext,
  threshold: {
    notify_assignee: boolean;
    notify_board_manager: boolean;
    notify_escalation_manager: boolean;
  }
): Promise<NotificationRecipient[]> {
  const recipients: NotificationRecipient[] = [];
  const seenUserIds = new Set<string>();

  // Get assignee
  if (threshold.notify_assignee && context.assigneeId) {
    const assignee = await trx('users')
      .where({ tenant, user_id: context.assigneeId })
      .select('user_id', 'email', 'first_name', 'last_name')
      .first();

    if (assignee && !seenUserIds.has(assignee.user_id)) {
      recipients.push(assignee);
      seenUserIds.add(assignee.user_id);
    }
  }

  // Get board manager
  if (threshold.notify_board_manager && context.boardId) {
    const board = await trx('boards')
      .where({ tenant, board_id: context.boardId })
      .select('manager_user_id')
      .first();

    if (board?.manager_user_id && !seenUserIds.has(board.manager_user_id)) {
      const manager = await trx('users')
        .where({ tenant, user_id: board.manager_user_id })
        .select('user_id', 'email', 'first_name', 'last_name')
        .first();

      if (manager) {
        recipients.push(manager);
        seenUserIds.add(manager.user_id);
      }
    }
  }

  // Get escalation manager (from SLA policy)
  if (threshold.notify_escalation_manager) {
    const policy = await trx('sla_policies')
      .where({ tenant, sla_policy_id: context.slaPolicyId })
      .select('escalation_manager_id')
      .first();

    if (policy?.escalation_manager_id && !seenUserIds.has(policy.escalation_manager_id)) {
      const manager = await trx('users')
        .where({ tenant, user_id: policy.escalation_manager_id })
        .select('user_id', 'email', 'first_name', 'last_name')
        .first();

      if (manager) {
        recipients.push(manager);
        seenUserIds.add(manager.user_id);
      }
    }
  }

  return recipients;
}

/**
 * Send an in-app notification using the internal notification system.
 */
async function sendInAppNotification(
  trx: Knex.Transaction,
  tenant: string,
  userId: string,
  templateName: string,
  data: Record<string, unknown>,
  ticketId: string
): Promise<boolean> {
  try {
    // Import the internal notification action
    const { createNotificationFromTemplateInternal } = await import(
      '@alga-psa/notifications/actions/internal-notification-actions/internalNotificationActions'
    );

    const notification = await createNotificationFromTemplateInternal(trx, {
      tenant,
      user_id: userId,
      template_name: templateName,
      data,
      type: templateName.includes('breach') ? 'error' : 'warning',
      category: 'sla',
      link: `/msp/tickets/${ticketId}`,
      metadata: {
        ticket_id: ticketId,
        sla_template: templateName
      }
    });

    return notification !== null;
  } catch (error) {
    console.error('Error sending in-app notification:', error);
    return false;
  }
}

/**
 * Send an email notification using the email notification service.
 */
async function sendEmailNotification(
  trx: Knex.Transaction,
  tenant: string,
  recipient: NotificationRecipient,
  templateName: string,
  data: Record<string, unknown>
): Promise<boolean> {
  try {
    if (!recipient.email) {
      return false;
    }

    // Import the email notification service
    const { getEmailNotificationService } = await import(
      '@alga-psa/notifications/notifications/email'
    );

    const emailService = getEmailNotificationService();

    // Get the SLA notification subtype ID
    const subtype = await trx('notification_subtypes')
      .whereIn('name', [templateName, 'SLA Warning', 'SLA Breach'])
      .first();

    if (!subtype) {
      console.warn(`Email notification subtype not found for ${templateName}`);
      return false;
    }

    await emailService.sendNotification({
      tenant,
      userId: recipient.user_id,
      subtypeId: subtype.id,
      emailAddress: recipient.email,
      templateName,
      data: data as Record<string, string | number | boolean>
    });

    return true;
  } catch (error) {
    console.error('Error sending email notification:', error);
    return false;
  }
}

/**
 * Log a notification event to the audit log.
 */
async function logNotificationEvent(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string,
  eventData: Record<string, unknown>
): Promise<void> {
  await trx('sla_audit_log').insert({
    tenant,
    ticket_id: ticketId,
    event_type: 'notification_sent',
    event_data: JSON.stringify(eventData)
  });
}

/**
 * Check which thresholds have been crossed for a ticket and send notifications.
 *
 * This is called by the SLA timer job to check if any thresholds have been
 * newly crossed and need notifications.
 *
 * @param trx - Database transaction
 * @param tenant - Tenant ID
 * @param ticketId - Ticket ID
 * @param elapsedPercent - Current elapsed percentage of SLA time
 * @param slaType - Whether this is for response or resolution
 * @param lastNotifiedThreshold - The last threshold percentage that was notified
 */
export async function checkAndSendThresholdNotifications(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string,
  elapsedPercent: number,
  slaType: 'response' | 'resolution',
  lastNotifiedThreshold: number = 0
): Promise<{ notifiedThreshold: number; result: NotificationResult | null }> {
  // Get all thresholds above the last notified one, up to current elapsed
  const thresholds = await trx('sla_notification_thresholds as snt')
    .join('tickets as t', function() {
      this.on('t.sla_policy_id', 'snt.sla_policy_id')
          .andOn('t.tenant', 'snt.tenant');
    })
    .where('t.tenant', tenant)
    .where('t.ticket_id', ticketId)
    .where('snt.threshold_percent', '>', lastNotifiedThreshold)
    .where('snt.threshold_percent', '<=', elapsedPercent)
    .orderBy('snt.threshold_percent', 'asc')
    .select('snt.*');

  if (thresholds.length === 0) {
    return { notifiedThreshold: lastNotifiedThreshold, result: null };
  }

  // Get ticket details for notification context
  const ticket = await trx('tickets as t')
    .leftJoin('clients as c', function() {
      this.on('t.client_id', 'c.client_id')
          .andOn('t.tenant', 'c.tenant');
    })
    .leftJoin('priorities as p', function() {
      this.on('t.priority_id', 'p.priority_id')
          .andOn('t.tenant', 'p.tenant');
    })
    .where('t.tenant', tenant)
    .where('t.ticket_id', ticketId)
    .select(
      't.ticket_id',
      't.ticket_number',
      't.title',
      't.assigned_to',
      't.board_id',
      't.sla_policy_id',
      't.sla_response_due_at',
      't.sla_resolution_due_at',
      'c.company_name as client_name',
      'p.priority_name'
    )
    .first();

  if (!ticket || !ticket.sla_policy_id) {
    return { notifiedThreshold: lastNotifiedThreshold, result: null };
  }

  // Find the highest threshold that needs notification
  const highestThreshold = thresholds[thresholds.length - 1];
  const dueAt = slaType === 'response'
    ? new Date(ticket.sla_response_due_at)
    : new Date(ticket.sla_resolution_due_at);

  const remainingMinutes = Math.floor(
    (dueAt.getTime() - Date.now()) / 60000
  );

  const context: SlaNotificationContext = {
    tenant,
    ticketId: ticket.ticket_id,
    ticketNumber: ticket.ticket_number,
    ticketTitle: ticket.title,
    clientName: ticket.client_name,
    priorityName: ticket.priority_name,
    assigneeId: ticket.assigned_to,
    boardId: ticket.board_id,
    slaPolicyId: ticket.sla_policy_id,
    thresholdPercent: highestThreshold.threshold_percent,
    slaType,
    remainingMinutes,
    dueAt
  };

  const result = await sendSlaNotification(trx, context);

  return {
    notifiedThreshold: highestThreshold.threshold_percent,
    result
  };
}
