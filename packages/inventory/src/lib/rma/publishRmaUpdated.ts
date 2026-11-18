import { buildInventoryRmaCreatedPayload, buildInventoryRmaUpdatedPayload } from '@alga-psa/shared/workflow/streams/domainEventBuilders/inventoryEventBuilders';
import type { IRmaCase } from '@alga-psa/types';
import { publishInventoryEvent } from '../inventoryEvents';

/**
 * INVENTORY_RMA_UPDATED after commit. Same contract as INVENTORY_STOCK_UNIT_UPDATED: publishInventoryEvent logs
 * and swallows bus failures, because the transition is already durable and must not be reported as failed.
 */
export async function publishRmaUpdated(
  tenant: string,
  rma: IRmaCase,
  previousStatus: string | null,
  changedFields: string[],
  userId: string
): Promise<void> {
  await publishInventoryEvent(
    'INVENTORY_RMA_UPDATED',
    buildInventoryRmaUpdatedPayload({
      tenant,
      rmaId: rma.rma_id,
      rmaNumber: rma.rma_number,
      status: rma.status,
      previousStatus,
      rmaType: rma.rma_type,
      assetId: rma.asset_id ?? null,
      ticketId: rma.ticket_id ?? null,
      clientId: rma.client_id ?? null,
      warrantyOutcome: rma.warranty_outcome ?? null,
      changedFields,
      userId,
      timestamp: new Date().toISOString(),
    })
  );
}

export async function publishWarrantyClaimOpened(tenant: string, rma: IRmaCase, serialNumber: string | null): Promise<void> {
  await publishInventoryEvent(
    'INVENTORY_RMA_CREATED',
    buildInventoryRmaCreatedPayload({
      tenant,
      rmaId: rma.rma_id,
      rmaReference: rma.rma_reference ?? null,
      clientId: rma.client_id ?? null,
      serviceId: null,
      serialNumber,
    })
  );
}
