/**
 * Hour Block Expiring Subscriber
 *
 * Handles HOUR_BLOCK_EXPIRING events published by the expiringHourBlocks
 * maintenance handler (which runs in the Temporal worker and may only publish
 * events). Re-resolves the client's billing contacts and sends the email
 * notification about hour blocks that are about to expire. Mirrors the credit
 * expiring subscriber.
 */

import logger from '@alga-psa/core/logger';
import { getEventBus } from '../index';
import { EventSchemas } from '@alga-psa/event-schemas';
import { createTenantKnex, runWithTenant, withTransaction, tenantDb } from '@alga-psa/db';
import { getEmailNotificationService } from '@alga-psa/notifications';
import { formatCalendarDate } from '@alga-psa/core';
import { getTenantDefaultLocale } from '@alga-psa/notifications/notifications/emailLocaleResolver';
import type { Knex } from 'knex';

const HOUR_BLOCK_EXPIRING_SUBTYPE = 'Hour Block Expiring';
const HOUR_BLOCK_EXPIRING_TEMPLATE = 'hour-block-expiring';

let isRegistered = false;

export async function registerHourBlockExpiringSubscriber(): Promise<void> {
  if (isRegistered) {
    return;
  }

  await getEventBus().subscribe('HOUR_BLOCK_EXPIRING', handleHourBlockExpiringEvent);

  isRegistered = true;
  logger.info('[HourBlockExpiringSubscriber] Registered');
}

export async function unregisterHourBlockExpiringSubscriber(): Promise<void> {
  if (!isRegistered) {
    return;
  }

  await getEventBus().unsubscribe('HOUR_BLOCK_EXPIRING', handleHourBlockExpiringEvent);

  isRegistered = false;
  logger.info('[HourBlockExpiringSubscriber] Unregistered');
}

async function handleHourBlockExpiringEvent(event: unknown): Promise<void> {
  try {
    const validated = EventSchemas.HOUR_BLOCK_EXPIRING.parse(event);
    const { tenantId, clientId, daysBeforeExpiration, blocks } = validated.payload;

    logger.info('[HourBlockExpiringSubscriber] Handling HOUR_BLOCK_EXPIRING', {
      tenantId,
      clientId,
      daysBeforeExpiration,
      blockCount: blocks.length,
    });

    await runWithTenant(tenantId, async () => {
      const { knex } = await createTenantKnex();

      await withTransaction(knex, async (trx: Knex.Transaction) => {
        const scopedDb = tenantDb(trx, tenantId);

        const client = await scopedDb.table('clients')
          .where({ client_id: clientId })
          .first();

        if (!client) {
          logger.warn('[HourBlockExpiringSubscriber] Client not found, skipping', {
            tenantId,
            clientId,
          });
          return;
        }

        const contacts = await scopedDb.table('client_contacts')
          .where({ client_id: clientId })
          .where('is_billing_contact', true)
          .select('user_id', 'email');

        if (!contacts.length) {
          logger.info('[HourBlockExpiringSubscriber] No billing contacts found, skipping', {
            tenantId,
            clientId,
          });
          return;
        }

        const blockIds = blocks.map((block) => block.blockId);
        const blockRows = await scopedDb.table('hour_blocks')
          .whereIn('block_id', blockIds)
          .select('block_id', 'service_id', 'total_minutes', 'remaining_minutes');

        const serviceIds = Array.from(new Set(blockRows.map((row) => row.service_id)));
        const services = serviceIds.length
          ? await scopedDb.table('service_catalog')
              .whereIn('service_id', serviceIds)
              .select('service_id', 'service_name')
          : [];
        const serviceNameByServiceId = services.reduce((acc, row) => {
          acc[row.service_id] = row.service_name;
          return acc;
        }, {} as Record<string, string>);

        const currencyCode =
          client.default_currency_code ||
          (
            await scopedDb.table('default_billing_settings')
              .select('default_currency_code')
              .first()
          )?.default_currency_code ||
          'USD';
        const emailLocale = await getTenantDefaultLocale(tenantId, 'client');

        const totalMinutesRemaining = blockRows.reduce(
          (sum, row) => sum + Number(row.remaining_minutes || 0),
          0,
        );

        const blockItems = blocks.map((block) => {
          const row = blockRows.find((candidate) => candidate.block_id === block.blockId);
          // LEVERAGE: pattern expiring-date-email-render — creditExpiringSubscriber.ts
          // still renders date-only strings through formatDate (UTC-midnight reparse);
          // converge it onto formatCalendarDate when next touched.
          return {
            blockId: block.blockId,
            serviceName: row?.service_id ? (serviceNameByServiceId[row.service_id] ?? 'Prepaid hours') : 'Prepaid hours',
            remainingHours: (Number(block.remainingMinutes) / 60).toFixed(1),
            expirationDate: formatCalendarDate(block.expirationDate, 'M/d/yyyy') ?? '',
          };
        });

        const templateData = {
          client: {
            id: client.client_id,
            name: client.name,
          },
          hourBlocks: {
            totalRemainingHours: (totalMinutesRemaining / 60).toFixed(1),
            expirationDate: formatCalendarDate(blocks[0].expirationDate, 'M/d/yyyy') ?? '',
            daysRemaining: daysBeforeExpiration,
            items: blockItems,
            url: `${process.env.APP_URL}/client-portal/billing`,
          },
        };

        const notificationService = getEmailNotificationService();

        const subtype = await scopedDb.table('notification_subtypes')
          .where({ name: HOUR_BLOCK_EXPIRING_SUBTYPE })
          .first();

        if (!subtype) {
          logger.warn('[HourBlockExpiringSubscriber] Hour Block Expiring notification subtype not found, skipping', {
            tenantId,
            clientId,
          });
          return;
        }

        for (const contact of contacts) {
          await notificationService.sendNotification({
            tenant: tenantId,
            userId: contact.user_id,
            subtypeId: subtype.id,
            emailAddress: contact.email,
            templateName: HOUR_BLOCK_EXPIRING_TEMPLATE,
            data: templateData,
          });

          logger.info('[HourBlockExpiringSubscriber] Sent hour block expiration notification', {
            tenantId,
            clientId,
            clientName: client.name,
            email: contact.email,
          });
        }
      });
    });
  } catch (error) {
    logger.error('[HourBlockExpiringSubscriber] Failed to handle event', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
