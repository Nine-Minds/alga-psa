import type { Knex } from 'knex';
import { runWithTenant, getConnection, tenantDb } from '@alga-psa/db';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import { IHourBlock } from '@alga-psa/types';
import { toPlainDate, toISODate } from '../handler-utils/dateTimeUtils';

export interface ExpiringHourBlocksNotificationJobData extends Record<string, unknown> {
  tenantId: string;
  clientId?: string; // Optional: process only a specific client
}

const tenantScopedTable = (knex: Knex, table: string, tenant: string) =>
  tenantDb(knex, tenant).table(table);

/**
 * Job handler for sending notifications about hour blocks that will expire
 * soon. Reuses the credit notification lead-time settings
 * (default_billing_settings.credit_expiration_notification_days) — v1 has no
 * dedicated settings UI. Emits a HOUR_BLOCK_EXPIRING event per client; the
 * server-side hourBlockExpiringSubscriber sends the email.
 */
export async function expiringHourBlocksNotificationHandler(
  data: ExpiringHourBlocksNotificationJobData,
): Promise<void> {
  const { tenantId, clientId } = data;

  if (!tenantId) {
    throw new Error('Tenant ID is required for expiring hour blocks notification job');
  }

  await runWithTenant(tenantId, async () => {
    const knex = await getConnection(tenantId);

    console.log(`Processing expiring hour blocks notifications for tenant ${tenantId}${clientId ? ` and client ${clientId}` : ''}`);

    try {
      const defaultSettings = await tenantScopedTable(knex, 'default_billing_settings', tenantId)
        .first();

      if (!defaultSettings || !defaultSettings.credit_expiration_notification_days) {
        console.log('No notification thresholds configured, skipping hour block notifications');
        return;
      }

      const notificationThresholds: number[] = defaultSettings.credit_expiration_notification_days;

      if (!notificationThresholds.length) {
        console.log('Empty notification thresholds array, skipping hour block notifications');
        return;
      }

      for (const daysBeforeExpiration of notificationThresholds) {
        await processNotificationsForThreshold(knex, tenantId, daysBeforeExpiration, clientId);
      }
    } catch (error: any) {
      console.error(`Error processing expiring hour blocks notifications: ${error.message}`, error);
      throw error; // Re-throw to let pg-boss handle the failure
    }
  });
}

async function processNotificationsForThreshold(
  knex: Knex,
  tenant: string,
  daysBeforeExpiration: number,
  clientId?: string,
): Promise<void> {
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + daysBeforeExpiration);

  const startOfDay = new Date(targetDate);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(targetDate);
  endOfDay.setHours(23, 59, 59, 999);

  let query = (tenantScopedTable(knex, 'hour_blocks', tenant) as Knex.QueryBuilder<IHourBlock, IHourBlock[]>)
    .where('status', 'active')
    .whereNotNull('expiration_date')
    .where('remaining_minutes', '>', 0)
    .whereBetween('expiration_date', [
      startOfDay.toISOString().slice(0, 10),
      endOfDay.toISOString().slice(0, 10),
    ]);

  if (clientId) {
    query = query.where('client_id', clientId);
  }

  const expiringBlocks: IHourBlock[] = await query;

  if (!expiringBlocks.length) {
    console.log(`No hour blocks expiring in ${daysBeforeExpiration} days`);
    return;
  }

  const blocksByClient: Record<string, IHourBlock[]> = {};
  for (const block of expiringBlocks) {
    if (!blocksByClient[block.client_id]) {
      blocksByClient[block.client_id] = [];
    }
    blocksByClient[block.client_id].push(block);
  }

  for (const [client, blocks] of Object.entries(blocksByClient)) {
    await publishExpiringEvent(knex, tenant, client, blocks, daysBeforeExpiration);
  }
}

async function publishExpiringEvent(
  knex: Knex,
  tenant: string,
  clientId: string,
  blocks: IHourBlock[],
  daysBeforeExpiration: number,
): Promise<void> {
  try {
    await publishEvent({
      eventType: 'HOUR_BLOCK_EXPIRING',
      payload: {
        tenantId: tenant,
        clientId,
        daysBeforeExpiration,
        occurredAt: new Date().toISOString(),
        blocks: blocks.map((block) => ({
          blockId: block.block_id,
          remainingMinutes: Number(block.remaining_minutes),
          expirationDate: toISODate(toPlainDate(block.expiration_date)),
        })),
      },
    });

    console.log(`Published HOUR_BLOCK_EXPIRING event for client ${clientId} (${blocks.length} blocks, ${daysBeforeExpiration} days)`);
  } catch (error: any) {
    console.error(`Error publishing hour block expiration event for ${clientId}: ${error.message}`);
    throw error;
  }
}
