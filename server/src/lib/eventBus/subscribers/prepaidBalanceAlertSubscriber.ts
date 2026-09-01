/**
 * Prepaid balance alert subscriber (task 29.8.20).
 *
 * Handles PREPAID_BALANCE_ALERT_SCAN_REQUESTED published by the daily 09:00 UTC
 * maintenance handler. This subscriber is the only layer allowed to query
 * ledgers, resolve recipients, or invoke notifications.
 */

import logger from '@alga-psa/core/logger';
import { getEventBus } from '../index';
import { EventSchemas } from '@alga-psa/event-schemas';
import { createTenantKnex, runWithTenant } from '@alga-psa/db';
import { evaluatePrepaidBalanceAlertsForTenant } from './prepaidBalanceAlertEvaluator';
import { planAndDrainDeliveriesForTenant } from './prepaidBalanceAlertDelivery';
import { replenishOpenPrepaidBalanceAlerts } from './prepaidAutoReplenishment';

let isRegistered = false;

export async function registerPrepaidBalanceAlertSubscriber(): Promise<void> {
  if (isRegistered) {
    return;
  }

  await getEventBus().subscribe('PREPAID_BALANCE_ALERT_SCAN_REQUESTED', handlePrepaidBalanceAlertScanRequested);

  isRegistered = true;
  logger.info('[PrepaidBalanceAlertSubscriber] Registered');
}

export async function unregisterPrepaidBalanceAlertSubscriber(): Promise<void> {
  if (!isRegistered) {
    return;
  }

  await getEventBus().unsubscribe('PREPAID_BALANCE_ALERT_SCAN_REQUESTED', handlePrepaidBalanceAlertScanRequested);

  isRegistered = false;
  logger.info('[PrepaidBalanceAlertSubscriber] Unregistered');
}

export async function handlePrepaidBalanceAlertScanRequested(event: unknown): Promise<void> {
  const validated = EventSchemas.PREPAID_BALANCE_ALERT_SCAN_REQUESTED.parse(event);
  const { tenantId, clientId } = validated.payload;

  try {
    await runWithTenant(tenantId, async () => {
      const { knex } = await createTenantKnex();
      const evaluation = await evaluatePrepaidBalanceAlertsForTenant(knex, tenantId, clientId);
      // Replenishment is the action half of this same alert episode. It runs
      // after evaluation has opened/rearmed subjects, and before delivery so
      // the existing alert notification can mention the linked draft/issued
      // action without creating a second detector or scan rail.
      const replenishment = await replenishOpenPrepaidBalanceAlerts(knex, tenantId, clientId);
      const delivery = await planAndDrainDeliveriesForTenant(knex, tenantId);

      logger.info('[PrepaidBalanceAlertSubscriber] Prepaid balance alert scan complete', {
        tenantId,
        configuredClients: evaluation.configuredClients,
        creditSubjects: evaluation.creditSubjects,
        bucketSubjects: evaluation.bucketSubjects,
        creditAlertsOpened: evaluation.creditAlertsOpened,
        creditAlertsResolved: evaluation.creditAlertsResolved,
        creditAlertsDeduplicated: evaluation.creditAlertsDeduplicated,
        bucketAlertsOpened: evaluation.bucketAlertsOpened,
        bucketAlertsResolved: evaluation.bucketAlertsResolved,
        bucketAlertsDeduplicated: evaluation.bucketAlertsDeduplicated,
        invalidSubjects: evaluation.invalidSubjects,
        replenishmentConsidered: replenishment.considered,
        replenishmentsCreated: replenishment.created,
        replenishmentsAutoIssued: replenishment.autoIssued,
        replenishmentsSkipped: replenishment.skipped,
        replenishmentsFailed: replenishment.failed,
        plannedInternal: delivery.plannedInternal,
        plannedEmail: delivery.plannedEmail,
        sent: delivery.sent,
        skipped: delivery.skipped,
        retried: delivery.retried,
        exhausted: delivery.exhausted,
        superseded: delivery.superseded,
        unroutable: delivery.unroutable,
      });

      for (const warning of [...evaluation.warnings, ...delivery.warnings] as Array<{
        code: string;
        clientId?: string;
        clientName?: string;
        bucketUsageId?: string;
        currencyCode?: string;
        alertId?: string;
        deliveryId?: string;
        channel?: string;
        message: string;
      }>) {
        logger.warn('[PrepaidBalanceAlertSubscriber] Scan warning', {
          tenantId,
          code: warning.code,
          clientId: warning.clientId,
          bucketUsageId: warning.bucketUsageId,
          currencyCode: warning.currencyCode,
          alertId: warning.alertId,
          deliveryId: warning.deliveryId,
          channel: warning.channel,
          message: warning.message,
        });
      }
    });
  } catch (error) {
    logger.error('[PrepaidBalanceAlertSubscriber] Failed to handle scan request', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    // Rethrow so the event bus redelivers (matches maintenanceJobSubscriber);
    // the tenant scan is idempotent and safe to replay.
    throw error;
  }
}
