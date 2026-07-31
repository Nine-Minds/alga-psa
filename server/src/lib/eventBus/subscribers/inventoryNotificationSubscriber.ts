import logger from '@alga-psa/core/logger';
import { createNotificationFromTemplateInternal } from '@alga-psa/notifications/actions';

import { getConnection } from '../../db/db';
import { getEventBus } from '../index';

const TEMPLATE_NAME = 'inventory-po-received';

let isRegistered = false;

export async function registerInventoryNotificationSubscriber(): Promise<void> {
  if (isRegistered) return;

  await getEventBus().subscribe('INVENTORY_PO_RECEIVED', handleInventoryPoReceived, {
    subscriberId: 'inventoryNotification',
  });
  isRegistered = true;
  logger.info('[InventoryNotificationSubscriber] Registered');
}

export async function unregisterInventoryNotificationSubscriber(): Promise<void> {
  if (!isRegistered) return;

  await getEventBus().unsubscribe('INVENTORY_PO_RECEIVED', handleInventoryPoReceived);
  isRegistered = false;
}

async function handleInventoryPoReceived(event: unknown): Promise<void> {
  const payload =
    typeof event === 'object' && event !== null && 'payload' in event
      ? ((event as { payload?: Record<string, unknown> }).payload ?? {})
      : {};

  const tenant = typeof payload.tenant === 'string' ? payload.tenant : typeof payload.tenantId === 'string' ? payload.tenantId : null;
  const poId = typeof payload.po_id === 'string' ? payload.po_id : typeof payload.poId === 'string' ? payload.poId : null;
  if (!tenant || !poId) return;

  try {
    const knex = await getConnection(tenant);
    const po = await knex('purchase_orders as po')
      .leftJoin('vendors as v', function () {
        this.on('v.vendor_id', '=', 'po.vendor_id').andOn('v.tenant', '=', 'po.tenant');
      })
      .leftJoin('stock_locations as loc', function () {
        this.on('loc.location_id', '=', 'po.ship_to_location_id').andOn('loc.tenant', '=', 'po.tenant');
      })
      .where({ 'po.tenant': tenant, 'po.po_id': poId })
      .select(
        'po.po_number',
        'po.created_by',
        'v.vendor_name',
        'loc.manager_user_id',
      )
      .first();

    if (!po) return;

    const recipients = [...new Set([po.created_by, po.manager_user_id].filter(Boolean))] as string[];
    if (recipients.length === 0) return;

    const poNumber = typeof payload.po_number === 'string' ? payload.po_number : po.po_number;
    const vendorName = typeof payload.vendor_name === 'string' && payload.vendor_name
      ? payload.vendor_name
      : po.vendor_name ?? 'vendor';
    const receivedLineCount = Number(payload.received_line_count ?? 0);
    const link = `/msp/inventory/purchase-orders?poId=${poId}`;

    for (const userId of recipients) {
      await createNotificationFromTemplateInternal(knex, {
        tenant,
        user_id: userId,
        template_name: TEMPLATE_NAME,
        type: 'info',
        category: 'inventory',
        link,
        data: {
          poNumber,
          vendorName,
          receivedLineCount: String(receivedLineCount),
        },
      });
    }
  } catch (error) {
    logger.error('[InventoryNotificationSubscriber] Failed handling INVENTORY_PO_RECEIVED', {
      tenant,
      poId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
