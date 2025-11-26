/**
 * NinjaOne Alert Processor
 *
 * Evaluates alert rules and triggers automated actions like ticket creation.
 * Processes alerts from the webhook handler and applies configured rules.
 */

import { Knex } from 'knex';
import { createTenantKnex } from '../../../../../../../server/src/lib/db';
import { withTransaction } from '@shared/db';
import logger from '@shared/core/logger';
import { publishEvent } from '@shared/events/publisher';
import {
  RmmAlert,
  RmmAlertRule,
  RmmAlertRuleConditions,
  RmmAlertRuleActions,
} from '../../../../interfaces/rmm.interfaces';
import { createTicketFromAlert, CreateTicketFromAlertOptions } from './ticketCreator';

/**
 * Alert rule match result
 */
export interface AlertRuleMatch {
  rule: RmmAlertRule;
  matchedConditions: string[];
}

/**
 * Alert processing result
 */
export interface AlertProcessingResult {
  alertId: string;
  rulesEvaluated: number;
  matchedRules: string[];
  actionsExecuted: string[];
  ticketCreated?: string;
  errors: string[];
}

/**
 * Evaluate all active rules against an alert
 */
export async function evaluateAlertRules(
  tenantId: string,
  integrationId: string,
  alert: RmmAlert
): Promise<AlertRuleMatch | null> {
  const { knex } = await createTenantKnex();

  // Get all active rules for this integration, ordered by priority
  const rules = await knex('rmm_alert_rules')
    .where({
      tenant: tenantId,
      integration_id: integrationId,
      is_active: true,
    })
    .orderBy('priority_order', 'asc') as RmmAlertRule[];

  if (rules.length === 0) {
    return null;
  }

  // Evaluate each rule in priority order
  for (const rule of rules) {
    const matchResult = evaluateRule(rule, alert);
    if (matchResult) {
      return {
        rule,
        matchedConditions: matchResult,
      };
    }
  }

  return null;
}

/**
 * Evaluate a single rule against an alert
 */
function evaluateRule(rule: RmmAlertRule, alert: RmmAlert): string[] | null {
  const conditions = typeof rule.conditions === 'string'
    ? JSON.parse(rule.conditions) as RmmAlertRuleConditions
    : rule.conditions as RmmAlertRuleConditions;

  const matchedConditions: string[] = [];

  // Check severity condition
  if (conditions.severities && conditions.severities.length > 0) {
    if (!conditions.severities.includes(alert.severity)) {
      return null; // Does not match
    }
    matchedConditions.push(`severity:${alert.severity}`);
  }

  // Check activity type condition
  if (conditions.activityTypes && conditions.activityTypes.length > 0) {
    if (!conditions.activityTypes.includes(alert.activity_type)) {
      return null;
    }
    matchedConditions.push(`activityType:${alert.activity_type}`);
  }

  // Check organization filter
  if (conditions.organizationIds && conditions.organizationIds.length > 0) {
    // Get organization ID from the alert's external device ID context
    // This would need to be passed through or looked up
    // For now, skip org filtering if not available
  }

  // Check status codes
  if (conditions.statusCodes && conditions.statusCodes.length > 0) {
    if (!conditions.statusCodes.includes(alert.status)) {
      return null;
    }
    matchedConditions.push(`status:${alert.status}`);
  }

  // Check keywords in message
  if (conditions.keywords && conditions.keywords.length > 0) {
    const message = (alert.message || '').toLowerCase();
    const hasKeyword = conditions.keywords.some(keyword =>
      message.includes(keyword.toLowerCase())
    );
    if (!hasKeyword) {
      return null;
    }
    matchedConditions.push('keyword:matched');
  }

  // If we got here with at least one condition checked, it's a match
  // If no conditions were specified (empty rule), don't match
  if (matchedConditions.length === 0) {
    // Check if the rule has any conditions at all
    const hasConditions =
      (conditions.severities && conditions.severities.length > 0) ||
      (conditions.activityTypes && conditions.activityTypes.length > 0) ||
      (conditions.statusCodes && conditions.statusCodes.length > 0) ||
      (conditions.keywords && conditions.keywords.length > 0);

    if (!hasConditions) {
      // Rule matches all alerts (no conditions = catch-all)
      matchedConditions.push('catchAll');
    }
  }

  return matchedConditions.length > 0 ? matchedConditions : null;
}

/**
 * Execute the actions defined in a matched rule
 */
export async function executeAlertActions(
  tenantId: string,
  alert: RmmAlert,
  rule: RmmAlertRule
): Promise<{ actionsExecuted: string[]; ticketId?: string; errors: string[] }> {
  const actions = typeof rule.actions === 'string'
    ? JSON.parse(rule.actions) as RmmAlertRuleActions
    : rule.actions as RmmAlertRuleActions;

  const actionsExecuted: string[] = [];
  const errors: string[] = [];
  let ticketId: string | undefined;

  // Create ticket if configured
  if (actions.createTicket) {
    try {
      const ticketOptions: CreateTicketFromAlertOptions = {
        priority: actions.ticketPriority || mapSeverityToPriority(alert.severity),
        channelId: actions.assignToChannel,
        assignToUserId: actions.assignToUser,
        notifyUsers: actions.notifyUsers,
        addToBoard: actions.addToBoard,
        customFields: actions.customFields,
      };

      const ticket = await createTicketFromAlert(tenantId, alert, ticketOptions);
      ticketId = ticket.ticket_id;
      actionsExecuted.push('createTicket');

      // Update alert with ticket reference
      const { knex } = await createTenantKnex();
      await knex('rmm_alerts')
        .where({ tenant: tenantId, alert_id: alert.alert_id })
        .update({
          ticket_id: ticketId,
          auto_ticket_created: true,
          updated_at: new Date().toISOString(),
        });

      logger.info('Created ticket from alert', {
        tenantId,
        alertId: alert.alert_id,
        ticketId,
        ruleName: rule.name,
      });

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to create ticket: ${message}`);
      logger.error('Error creating ticket from alert', {
        tenantId,
        alertId: alert.alert_id,
        error: message,
      });
    }
  }

  // Send notifications if configured
  if (actions.notifyUsers && actions.notifyUsers.length > 0) {
    try {
      await sendAlertNotifications(tenantId, alert, actions.notifyUsers);
      actionsExecuted.push('notifyUsers');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to send notifications: ${message}`);
    }
  }

  // Add custom webhook if configured
  if (actions.webhookUrl) {
    try {
      await triggerCustomWebhook(actions.webhookUrl, alert);
      actionsExecuted.push('webhook');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to trigger webhook: ${message}`);
    }
  }

  return { actionsExecuted, ticketId, errors };
}

/**
 * Process an alert through the full rule evaluation and action execution pipeline
 */
export async function processAlert(
  tenantId: string,
  integrationId: string,
  alert: RmmAlert
): Promise<AlertProcessingResult> {
  const result: AlertProcessingResult = {
    alertId: alert.alert_id,
    rulesEvaluated: 0,
    matchedRules: [],
    actionsExecuted: [],
    errors: [],
  };

  try {
    // Evaluate rules
    const match = await evaluateAlertRules(tenantId, integrationId, alert);
    result.rulesEvaluated = 1; // Could track actual count if needed

    if (match) {
      result.matchedRules.push(match.rule.name);

      // Execute actions
      const actionResult = await executeAlertActions(tenantId, alert, match.rule);
      result.actionsExecuted = actionResult.actionsExecuted;
      result.ticketCreated = actionResult.ticketId;
      result.errors = actionResult.errors;
    }

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(message);
    logger.error('Error processing alert', {
      tenantId,
      alertId: alert.alert_id,
      error: message,
    });
    return result;
  }
}

/**
 * Map alert severity to ticket priority
 */
function mapSeverityToPriority(severity: string): string {
  switch (severity.toLowerCase()) {
    case 'critical':
      return 'urgent';
    case 'major':
      return 'high';
    case 'moderate':
      return 'medium';
    case 'minor':
      return 'low';
    default:
      return 'medium';
  }
}

/**
 * Send notifications to specified users
 */
async function sendAlertNotifications(
  tenantId: string,
  alert: RmmAlert,
  userIds: string[]
): Promise<void> {
  // Emit notification events for each user
  for (const userId of userIds) {
    try {
      await publishEvent({
        eventType: 'NOTIFICATION_CREATED',
        tenant: tenantId,
        payload: {
          user_id: userId,
          notification_type: 'rmm_alert',
          title: `RMM Alert: ${alert.activity_type}`,
          message: alert.message || 'New alert from NinjaOne',
          severity: alert.severity,
          link: alert.asset_id ? `/msp/assets/${alert.asset_id}` : undefined,
          metadata: {
            alert_id: alert.alert_id,
            device_id: alert.external_device_id,
          },
        },
      });
    } catch (error) {
      logger.warn('Failed to send notification', { userId, alertId: alert.alert_id, error });
    }
  }
}

/**
 * Trigger a custom webhook with alert data
 */
async function triggerCustomWebhook(
  webhookUrl: string,
  alert: RmmAlert
): Promise<void> {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: 'rmm_alert',
        alert: {
          id: alert.alert_id,
          severity: alert.severity,
          priority: alert.priority,
          activity_type: alert.activity_type,
          message: alert.message,
          asset_id: alert.asset_id,
          triggered_at: alert.triggered_at,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Webhook returned ${response.status}`);
    }
  } catch (error) {
    logger.error('Failed to trigger custom webhook', { webhookUrl, error });
    throw error;
  }
}

/**
 * Get active alerts for a tenant
 */
export async function getActiveAlerts(
  tenantId: string,
  integrationId: string,
  filters?: {
    assetId?: string;
    severity?: string[];
    status?: string[];
    limit?: number;
    offset?: number;
  }
): Promise<{ alerts: RmmAlert[]; total: number }> {
  const { knex } = await createTenantKnex();

  let query = knex('rmm_alerts')
    .where({
      tenant: tenantId,
      integration_id: integrationId,
    });

  // Apply filters
  if (filters?.assetId) {
    query = query.where('asset_id', filters.assetId);
  }
  if (filters?.severity && filters.severity.length > 0) {
    query = query.whereIn('severity', filters.severity);
  }
  if (filters?.status && filters.status.length > 0) {
    query = query.whereIn('status', filters.status);
  } else {
    // Default to active alerts
    query = query.where('status', 'active');
  }

  // Get total count
  const [{ count }] = await query.clone().count('alert_id as count');
  const total = Number(count);

  // Apply pagination
  const limit = filters?.limit || 50;
  const offset = filters?.offset || 0;

  const alerts = await query
    .orderBy('triggered_at', 'desc')
    .limit(limit)
    .offset(offset);

  return { alerts, total };
}

/**
 * Acknowledge an alert
 */
export async function acknowledgeAlert(
  tenantId: string,
  alertId: string,
  userId: string
): Promise<RmmAlert> {
  const { knex } = await createTenantKnex();
  const now = new Date().toISOString();

  const [alert] = await knex('rmm_alerts')
    .where({ tenant: tenantId, alert_id: alertId })
    .update({
      acknowledged_at: now,
      acknowledged_by: userId,
      updated_at: now,
    })
    .returning('*');

  if (!alert) {
    throw new Error('Alert not found');
  }

  logger.info('Alert acknowledged', { tenantId, alertId, userId });

  return alert;
}

/**
 * Resolve an alert
 */
export async function resolveAlert(
  tenantId: string,
  alertId: string,
  userId: string,
  resetInNinjaOne = false
): Promise<RmmAlert> {
  const { knex } = await createTenantKnex();
  const now = new Date().toISOString();

  const [alert] = await knex('rmm_alerts')
    .where({ tenant: tenantId, alert_id: alertId })
    .update({
      status: 'resolved',
      resolved_at: now,
      resolved_by: userId,
      updated_at: now,
    })
    .returning('*');

  if (!alert) {
    throw new Error('Alert not found');
  }

  // Emit resolved event
  await publishEvent({
    eventType: 'RMM_ALERT_RESOLVED',
    tenant: tenantId,
    payload: {
      alert_id: alertId,
      asset_id: alert.asset_id,
      resolved_by: userId,
      provider: 'ninjaone',
      resolved_at: now,
    },
  });

  logger.info('Alert resolved', { tenantId, alertId, userId });

  // TODO: If resetInNinjaOne is true, call NinjaOne API to reset the alert

  return alert;
}
