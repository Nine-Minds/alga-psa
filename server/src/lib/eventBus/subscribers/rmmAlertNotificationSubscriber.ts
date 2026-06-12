/**
 * Delivers in-app and email notifications for RMM alerts. Listens on
 * RMM_ALERT_TRIGGERED (published by the shared alert pipeline) and notifies
 * the matched rule's notifyUserIds when the alert just created a ticket —
 * repeat occurrences append to the existing ticket and stay quiet.
 *
 * Per-user preferences are honored on both channels: the in-app helper checks
 * internal subtype preferences itself; the email path checks the tenant gate
 * and user_notification_preferences before sending.
 */

import logger from '@alga-psa/core/logger';
import { createNotificationFromTemplateInternal } from '@alga-psa/notifications/actions';
import { rmmAlertRuleActionsSchema, providerLabel } from '@alga-psa/shared/rmm/alerts';
import type { Knex } from 'knex';
import { getConnection } from '../../db/db';
import { getEventBus } from '../index';
import { sendEventEmail } from '../../notifications/sendEventEmail';

const SUBTYPE_NAME = 'RMM Alert Triggered';
const TEMPLATE_NAME = 'rmm-alert-triggered';

let isRegistered = false;

export async function registerRmmAlertNotificationSubscriber(): Promise<void> {
  if (isRegistered) return;
  await getEventBus().subscribe('RMM_ALERT_TRIGGERED', handleAlertTriggered, {
    subscriberId: 'rmmAlertNotification',
  });
  isRegistered = true;
  logger.info('[RmmAlertNotificationSubscriber] Registered');
}

export async function unregisterRmmAlertNotificationSubscriber(): Promise<void> {
  if (!isRegistered) return;
  await getEventBus().unsubscribe('RMM_ALERT_TRIGGERED', handleAlertTriggered);
  isRegistered = false;
}

async function handleAlertTriggered(event: unknown): Promise<void> {
  const payload =
    typeof event === 'object' && event !== null && 'payload' in event
      ? ((event as { payload?: Record<string, unknown> }).payload ?? {})
      : {};
  const tenantId = typeof payload.tenantId === 'string' ? payload.tenantId : null;
  const alertId = typeof payload.alertId === 'string' ? payload.alertId : null;
  if (!tenantId || !alertId) return;

  try {
    const knex = await getConnection(tenantId);

    const alert = await knex('rmm_alerts')
      .where({ tenant: tenantId, alert_id: alertId })
      .first('matched_rule_id', 'auto_ticket_created', 'ticket_id', 'device_name', 'severity', 'message');
    // Notify only when this alert just created its ticket.
    if (!alert?.auto_ticket_created || !alert.ticket_id || !alert.matched_rule_id) return;

    const rule = await knex('rmm_alert_rules')
      .where({ tenant: tenantId, rule_id: alert.matched_rule_id })
      .first('actions');
    if (!rule) return;
    const parsed = rmmAlertRuleActionsSchema.safeParse(
      typeof rule.actions === 'string' ? JSON.parse(rule.actions) : rule.actions ?? {}
    );
    const notifyUserIds = parsed.success ? parsed.data.notifyUserIds ?? [] : [];
    if (notifyUserIds.length === 0) return;

    const ticket = await knex('tickets')
      .where({ tenant: tenantId, ticket_id: alert.ticket_id })
      .first('ticket_number');
    const provider = typeof payload.provider === 'string' ? providerLabel(payload.provider) : 'RMM';
    const deviceName = alert.device_name ?? 'unknown device';
    const link = `/msp/tickets/${alert.ticket_id}`;
    const context = {
      severity: alert.severity,
      deviceName,
      message: alert.message ?? '',
      provider,
      ticketNumber: ticket?.ticket_number ?? '',
      url: link,
    };

    for (const userId of notifyUserIds) {
      await deliverInApp(knex, tenantId, userId, alert.severity, link, context);
      await deliverEmail(knex, tenantId, userId, context);
    }
  } catch (error) {
    logger.error('[RmmAlertNotificationSubscriber] Failed handling RMM_ALERT_TRIGGERED', {
      tenantId,
      alertId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function deliverInApp(
  knex: Knex,
  tenantId: string,
  userId: string,
  severity: string,
  link: string,
  context: Record<string, string>
): Promise<void> {
  try {
    await createNotificationFromTemplateInternal(knex, {
      tenant: tenantId,
      user_id: userId,
      template_name: TEMPLATE_NAME,
      type: severity === 'critical' ? 'error' : 'warning',
      category: 'rmm-alerts',
      link,
      data: context,
    });
  } catch (error) {
    logger.warn('[RmmAlertNotificationSubscriber] In-app notification failed', {
      tenantId,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function deliverEmail(
  knex: Knex,
  tenantId: string,
  userId: string,
  context: Record<string, string>
): Promise<void> {
  try {
    const settings = await knex('notification_settings').where({ tenant: tenantId }).first();
    if (settings && !settings.is_enabled) return;

    const subtype = await knex('notification_subtypes').where({ name: SUBTYPE_NAME }).first();
    if (!subtype || !subtype.is_enabled) return;

    const preference = await knex('user_notification_preferences')
      .where({ tenant: tenantId, user_id: userId, subtype_id: subtype.id })
      .first();
    if (preference && !preference.is_enabled) return;

    const user = await knex('users').where({ tenant: tenantId, user_id: userId }).first('email');
    if (!user?.email) return;

    await sendEventEmail({
      tenantId,
      to: user.email,
      subject: `RMM Alert (${context.severity}): ${context.deviceName}`,
      template: TEMPLATE_NAME,
      context,
      entityType: 'ticket',
      recipientUserId: userId,
      notificationSubtypeId: subtype.id,
    });
  } catch (error) {
    logger.warn('[RmmAlertNotificationSubscriber] Email notification failed', {
      tenantId,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
