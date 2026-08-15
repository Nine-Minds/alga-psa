import { publishEvent } from '@alga-psa/event-bus/publishers';
import logger from '@alga-psa/core/logger';

export interface PrepaidBalanceAlertScanJobData extends Record<string, unknown> {
  tenantId: string;
  clientId?: string;
}

export const PREPAID_BALANCE_ALERT_SCAN_JOB = 'prepaid-balance-alert-scan';

/**
 * Server-free handler for the daily 09:00 UTC low-balance scan. It only
 * validates the tenant context and publishes PREPAID_BALANCE_ALERT_SCAN_REQUESTED;
 * the server-side subscriber owns feature-flag gating, ledger queries, alert
 * lifecycle, recipient planning, and delivery draining. This module must stay
 * free of server billing, PostHog, and notification imports so it can run in
 * the Temporal worker / pg-boss runner.
 */
export async function prepaidBalanceAlertScanHandler(data: PrepaidBalanceAlertScanJobData): Promise<void> {
  const { tenantId } = data;
  if (!tenantId) {
    throw new Error('Tenant ID is required for prepaid balance alert scan job');
  }

  await publishEvent({
    eventType: 'PREPAID_BALANCE_ALERT_SCAN_REQUESTED',
    payload: {
      tenantId,
      occurredAt: new Date().toISOString(),
      ...(data.clientId ? { clientId: data.clientId } : {}),
    },
  });

  logger.info('Published PREPAID_BALANCE_ALERT_SCAN_REQUESTED', { tenantId });
}
