/**
 * Credit Expiring Subscriber
 *
 * Handles CREDIT_EXPIRING events published by the expiringCredits maintenance
 * handler (which runs in the Temporal worker and may only publish events).
 * Re-resolves the client's billing contacts and sends the email notification
 * about credits that are about to expire.
 */

import logger from '@alga-psa/core/logger';
import { getEventBus } from '../index';
import { EventSchemas } from '@alga-psa/event-schemas';
import { createTenantKnex, runWithTenant, withTransaction, tenantDb } from '@alga-psa/db';
import { getEmailNotificationService } from '@alga-psa/notifications';
import { formatCurrency, formatDate } from '@alga-psa/core/formatters';
import type { Knex } from 'knex';

const CREDIT_EXPIRING_SUBTYPE = 'Credit Expiring';
const CREDIT_EXPIRING_TEMPLATE = 'credit-expiring';

let isRegistered = false;

export async function registerCreditExpiringSubscriber(): Promise<void> {
  if (isRegistered) {
    return;
  }

  await getEventBus().subscribe('CREDIT_EXPIRING', handleCreditExpiringEvent);

  isRegistered = true;
  logger.info('[CreditExpiringSubscriber] Registered');
}

export async function unregisterCreditExpiringSubscriber(): Promise<void> {
  if (!isRegistered) {
    return;
  }

  await getEventBus().unsubscribe('CREDIT_EXPIRING', handleCreditExpiringEvent);

  isRegistered = false;
  logger.info('[CreditExpiringSubscriber] Unregistered');
}

async function handleCreditExpiringEvent(event: unknown): Promise<void> {
  try {
    const validated = EventSchemas.CREDIT_EXPIRING.parse(event);
    const { tenantId, clientId, daysBeforeExpiration, credits } = validated.payload;

    logger.info('[CreditExpiringSubscriber] Handling CREDIT_EXPIRING', {
      tenantId,
      clientId,
      daysBeforeExpiration,
      creditCount: credits.length,
    });

    await runWithTenant(tenantId, async () => {
      const { knex } = await createTenantKnex();

      await withTransaction(knex, async (trx: Knex.Transaction) => {
        const scopedDb = tenantDb(trx, tenantId);

        // Get client details
        const client = await scopedDb.table('clients')
          .where({ client_id: clientId })
          .first();

        if (!client) {
          logger.warn('[CreditExpiringSubscriber] Client not found, skipping', {
            tenantId,
            clientId,
          });
          return;
        }

        // Get client billing contacts
        const contacts = await scopedDb.table('client_contacts')
          .where({ client_id: clientId })
          .where('is_billing_contact', true)
          .select('user_id', 'email');

        if (!contacts.length) {
          logger.info('[CreditExpiringSubscriber] No billing contacts found, skipping', {
            tenantId,
            clientId,
          });
          return;
        }

        // Re-resolve credit + transaction details for the email template
        const creditIds = credits.map((credit) => credit.creditId);
        const creditRows = await scopedDb.table('credit_tracking')
          .whereIn('credit_id', creditIds)
          .select('credit_id', 'transaction_id');

        const transactionIdByCreditId = creditRows.reduce((acc, row) => {
          acc[row.credit_id] = row.transaction_id;
          return acc;
        }, {} as Record<string, string>);

        const transactionIds = creditRows
          .map((row) => row.transaction_id)
          .filter((id): id is string => Boolean(id));

        const transactions = transactionIds.length
          ? await scopedDb.table('transactions')
              .whereIn('transaction_id', transactionIds)
          : [];

        const transactionMap = transactions.reduce((acc, tx) => {
          acc[tx.transaction_id] = tx;
          return acc;
        }, {} as Record<string, any>);

        // Calculate total expiring amount
        const totalAmount = credits.reduce((sum, credit) => sum + Number(credit.amount), 0);

        // Format credit data for the email template
        const creditItems = credits.map((credit) => {
          const transactionId = transactionIdByCreditId[credit.creditId];
          return {
            creditId: credit.creditId,
            amount: formatCurrency(Number(credit.amount)),
            expirationDate: formatDate(credit.expirationDate),
            transactionId,
            description: transactionMap[transactionId]?.description || 'N/A',
          };
        });

        // Prepare email template data
        const templateData = {
          client: {
            id: client.client_id,
            name: client.name,
          },
          credits: {
            totalAmount: formatCurrency(totalAmount),
            expirationDate: formatDate(credits[0].expirationDate),
            daysRemaining: daysBeforeExpiration,
            items: creditItems,
            url: `${process.env.APP_URL}/billing/credits?client=${clientId}`,
          },
        };

        // Get notification service
        const notificationService = getEmailNotificationService();

        // Get notification subtype
        const subtype = await trx('notification_subtypes')
          .where({ name: CREDIT_EXPIRING_SUBTYPE })
          .first();

        if (!subtype) {
          logger.warn('[CreditExpiringSubscriber] Credit Expiring notification subtype not found, skipping', {
            tenantId,
            clientId,
          });
          return;
        }

        // Send notification to each contact
        for (const contact of contacts) {
          await notificationService.sendNotification({
            tenant: tenantId,
            userId: contact.user_id,
            subtypeId: subtype.id,
            emailAddress: contact.email,
            templateName: CREDIT_EXPIRING_TEMPLATE,
            data: templateData,
          });

          logger.info('[CreditExpiringSubscriber] Sent credit expiration notification', {
            tenantId,
            clientId,
            clientName: client.name,
            email: contact.email,
          });
        }
      });
    });
  } catch (error) {
    logger.error('[CreditExpiringSubscriber] Failed to handle event', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Rethrow so the event bus redelivers (matches maintenanceJobSubscriber);
    // swallowing would silently drop the expiring-credit notification.
    throw error;
  }
}
