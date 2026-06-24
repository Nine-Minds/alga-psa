import { Knex } from 'knex';
import { runWithTenant, getConnection } from '@alga-psa/db';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import { ICreditTracking } from '@alga-psa/types';
import { toPlainDate, toISODate } from '../handler-utils/dateTimeUtils';

export interface ExpiringCreditsNotificationJobData extends Record<string, unknown> {
  tenantId: string;
  clientId?: string; // Optional: process only a specific client
}

/**
 * Job handler for sending notifications about credits that will expire soon
 * This job:
 * 1. Finds credits that will expire within the configured notification thresholds
 * 2. Groups them by client and expiration date
 * 3. Sends notifications to client contacts
 *
 * @param data Job data containing tenant ID and optional client ID
 */
export async function expiringCreditsNotificationHandler(data: ExpiringCreditsNotificationJobData): Promise<void> {
  const { tenantId, clientId } = data;

  if (!tenantId) {
    throw new Error('Tenant ID is required for expiring credits notification job');
  }

  await runWithTenant(tenantId, async () => {
    const knex = await getConnection(tenantId);

    console.log(`Processing expiring credits notifications for tenant ${tenantId}${clientId ? ` and client ${clientId}` : ''}`);

    try {
      // Get notification thresholds from settings
      const defaultSettings = await knex('default_billing_settings')
        .where({ tenant: tenantId })
        .first();

      if (!defaultSettings || !defaultSettings.credit_expiration_notification_days) {
        console.log('No notification thresholds configured, skipping notifications');
        return;
      }

      const notificationThresholds: number[] = defaultSettings.credit_expiration_notification_days;

      if (!notificationThresholds.length) {
        console.log('Empty notification thresholds array, skipping notifications');
        return;
      }

      // Process each threshold
      for (const daysBeforeExpiration of notificationThresholds) {
        await processNotificationsForThreshold(knex, tenantId, daysBeforeExpiration, clientId);
      }

    } catch (error: any) {
      console.error(`Error processing expiring credits notifications: ${error.message}`, error);
      throw error; // Re-throw to let pg-boss handle the failure
    }
  });
}

/**
 * Process notifications for a specific threshold (days before expiration)
 */
async function processNotificationsForThreshold(
  knex: Knex,
  tenant: string,
  daysBeforeExpiration: number,
  clientId?: string
): Promise<void> {
  // Calculate the target date (credits expiring in exactly daysBeforeExpiration days)
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + daysBeforeExpiration);

  // Format dates for SQL comparison (start and end of the target day)
  const startOfDay = new Date(targetDate);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(targetDate);
  endOfDay.setHours(23, 59, 59, 999);

  // Find credits expiring on the target date
  let query = knex('credit_tracking')
    .where('tenant', tenant)
    .where('is_expired', false)
    .whereNotNull('expiration_date')
    .where('remaining_amount', '>', 0)
    .whereBetween('expiration_date', [startOfDay.toISOString(), endOfDay.toISOString()]);

  // Add client filter if provided
  if (clientId) {
    query = query.where('client_id', clientId);
  }

  const expiringCredits: ICreditTracking[] = await query;

  if (!expiringCredits.length) {
    console.log(`No credits expiring in ${daysBeforeExpiration} days`);
    return;
  }

  console.log(`Found ${expiringCredits.length} credits expiring in ${daysBeforeExpiration} days`);

  // Group credits by client
  const creditsByClient: Record<string, ICreditTracking[]> = {};

  for (const credit of expiringCredits) {
    if (!creditsByClient[credit.client_id]) {
      creditsByClient[credit.client_id] = [];
    }
    creditsByClient[credit.client_id].push(credit);
  }

  // Process each client
  for (const [clientId, credits] of Object.entries(creditsByClient)) {
    await sendClientNotification(knex, tenant, clientId, credits, daysBeforeExpiration);
  }
}

/**
 * Emit a domain event for a specific client's expiring credits.
 *
 * The handler runs in the Temporal worker (plain Node ESM) and must not depend
 * on @alga-psa/notifications. It only publishes a CREDIT_EXPIRING event; the
 * server-side creditExpiringSubscriber re-resolves the client contacts and
 * sends the actual email notification.
 */
async function sendClientNotification(
  knex: Knex,
  tenant: string,
  clientId: string,
  credits: ICreditTracking[],
  daysBeforeExpiration: number
): Promise<void> {
  try {
    await publishEvent({
      eventType: 'CREDIT_EXPIRING',
      payload: {
        tenantId: tenant,
        clientId,
        daysBeforeExpiration,
        occurredAt: new Date().toISOString(),
        credits: credits.map(credit => ({
          creditId: credit.credit_id,
          amount: Number(credit.remaining_amount),
          expirationDate: toISODate(toPlainDate(credit.expiration_date)),
        })),
      },
    });

    console.log(`Published CREDIT_EXPIRING event for client ${clientId} (${credits.length} credits, ${daysBeforeExpiration} days)`);
  } catch (error: any) {
    console.error(`Error publishing credit expiration event for ${clientId}: ${error.message}`);
    throw error;
  }
}
