'use server';

import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { withCustodyPhotos } from '../assets/withCustodyPhotos';
import { authorizeTicketRecordAccess } from '@alga-psa/tickets/lib/ticketRecordAuthorization';
import {
  receiveEquipmentInputSchema,
  type ReceiveEquipmentInput,
} from '@alga-psa/assets/lib/schemas/assetCustody.schema';
import { receiveEquipmentInTransaction, publishEquipmentReceived } from '@alga-psa/assets/lib/custody/service';
import { toCustodyResult, type CustodyActionResult } from '@alga-psa/assets/lib/custody/actionResult';
import { CustodyError } from '@alga-psa/assets/lib/custody/errors';
import { permissionError, type ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import type { IAssetCustody, IAssetCustodyEvent } from '@alga-psa/types';

/**
 * Receive client equipment on a ticket (alga-2026-0002683 C4, design D4).
 *
 * Lives in the composition layer because the ticket record check needs @alga-psa/tickets, which depends
 * on inventory, which depends on @alga-psa/assets, so assets cannot import it. Permissions: `ticket:read`
 * plus the ticket record check, `asset:update` for an existing device, `asset:create` as well for a new
 * one. Nothing here touches stock, billing or time.
 *
 * Private documents and receive commit together. Storage ownership is durable before each upload,
 * so rollback or an interrupted request can recover originals and derived files without trusting IDs.
 */
export interface ReceiveEquipmentActionData {
  asset: {
    asset_id: string;
    asset_tag: string;
    name: string;
    client_id: string;
  };
  createdAsset: boolean;
  custody: IAssetCustody;
  event: IAssetCustodyEvent;
}

export const receiveEquipment = withAuth(
  async (
    user,
    { tenant },
    input: unknown,
    photos?: FormData
  ): Promise<CustodyActionResult<ReceiveEquipmentActionData> | ActionPermissionError> => {
    const { knex } = await createTenantKnex();
    if (
      !(await hasPermission(user, 'ticket', 'read')) ||
      !(await hasPermission(user, 'asset', 'update')) ||
      ((input as any)?.new_asset && !(await hasPermission(user, 'asset', 'create')))
    ) {
      return permissionError('Permission denied: Cannot receive equipment') as ActionPermissionError;
    }

    return toCustodyResult(async () => {
      const parsed: ReceiveEquipmentInput = receiveEquipmentInputSchema.parse(input);
      if (parsed.document_ids.length) {
        throw new CustodyError('permission_denied', 'Existing documents cannot be submitted as intake photos.');
      }
      try {
        await authorizeTicketRecordAccess({
          trx: knex,
          tenant,
          user,
          ticketId: parsed.ticket_id,
          action: 'read',
        });
      } catch {
        throw new CustodyError('ticket_not_found', 'Ticket not found.');
      }
      const r = await withCustodyPhotos(
        knex,
        tenant,
        user,
        photos,
        [{ entity_type: 'ticket', entity_id: parsed.ticket_id }],
        (trx, documentIds) => receiveEquipmentInTransaction(trx, tenant, user, { ...parsed, document_ids: documentIds })
      );
      await publishEquipmentReceived(tenant, user, r);
      return {
        asset: r.asset as ReceiveEquipmentActionData['asset'],
        createdAsset: r.createdAsset,
        custody: r.custody,
        event: r.event,
      };
    });
  }
);
