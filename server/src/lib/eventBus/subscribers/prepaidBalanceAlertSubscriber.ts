/**
 * Prepaid balance alert subscriber (task 29.8.20).
 *
 * Handles PREPAID_BALANCE_ALERT_SCAN_REQUESTED published by the daily 09:00 UTC
 * maintenance handler. This subscriber is the only layer allowed to evaluate
 * the feature flag, query ledgers, resolve recipients, or invoke
 * notifications. It fails closed: while `release-v1.5-feature` is disabled or
 * its checker is unavailable, the scan performs no alert/delivery/notification
 * writes.
 */

import logger from '@alga-psa/core/logger';
import { isFeatureFlagEnabled } from '@alga-psa/core';
import { getEventBus } from '../index';
import { EventSchemas } from '@alga-psa/event-schemas';
import { createTenantKnex, runWithTenant } from '@alga-psa/db';
import { evaluatePrepaidBalanceAlertsForTenant } from './prepaidBalanceAlertEvaluator';
import { planAndDrainDeliveriesForTenant } from './prepaidBalanceAlertDelivery';

export const PREPAID_BALANCE_ALERT_FLAG = 'release-v1.5-feature';

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

async function featureEnabled(tenantId: string): Promise<boolean> {
  try {
    return await isFeatureFlagEnabled(PREPAID_BALANCE_ALERT_FLAG, { tenantId });
  } catch {
    // Missing, unavailable, or throwing flag infrastructure fails closed.
    return false;
  }
}

export async function handlePrepaidBalanceAlertScanRequested(event: unknown): Promise<void> {
  const validated = EventSchemas.PREPAID_BALANCE_ALERT_SCAN_REQUESTED.parse(event);
  const { tenantId, clientId } = validated.payload;

  try {
    await runWithTenant(tenantId, async () => {
      const enabled = await featureEnabled(tenantId);
      if (!enabled) {
        logger.info('[PrepaidBalanceAlertSubscriber] Feature flag disabled; skipping scan', { tenantId });
        return;
      }

      const { knex } = await createTenantKnex();
      const evaluation = await evaluatePrepaidBalanceAlertsForTenant(knex, tenantId, clientId);
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
        plannedInternal: delivery.plannedInternal,
        plannedEmail: delivery.plannedEmail,
        sent: delivery.sent,
        skipped: delivery.skipped,
        retried: delivery.retried,
        exhausted: delivery.exhausted,
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
          clientName: warning.clientName,
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
