"use server";

import { withAuth, hasPermission } from "@alga-psa/auth";
import { createTenantKnex } from "@alga-psa/db";
import { deleteDocument, uploadDocument } from "@alga-psa/documents/actions/documentActions";
import { authorizeTicketRecordAccess } from "@alga-psa/tickets/lib/ticketRecordAuthorization";
import {
  receiveEquipmentInputSchema,
  type ReceiveEquipmentInput,
} from "@alga-psa/assets/lib/schemas/assetCustody.schema";
import { receiveEquipmentService } from "@alga-psa/assets/lib/custody/service";
import {
  toCustodyResult,
  type CustodyActionResult,
} from "@alga-psa/assets/lib/custody/actionResult";
import { custodyPhotosWithinLimit } from '@alga-psa/assets/lib/custody/photoLimits';
import { CustodyError } from "@alga-psa/assets/lib/custody/errors";
import {
  permissionError,
  type ActionPermissionError,
} from "@alga-psa/ui/lib/errorHandling";
import type { IAssetCustody, IAssetCustodyEvent } from "@alga-psa/types";

/**
 * Receive client equipment on a ticket (alga-2026-0002683 C4, design D4).
 *
 * Lives in the composition layer because the ticket record check needs @alga-psa/tickets, which depends
 * on inventory, which depends on @alga-psa/assets, so assets cannot import it. Permissions: `ticket:read`
 * plus the ticket record check, `asset:update` for an existing device, `asset:create` as well for a new
 * one. Nothing here touches stock, billing or time.
 *
 * Photos are uploaded within this invocation as client-hidden ticket documents. Only documents created
 * by this invocation are eligible for cleanup if upload or receive fails.
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
    photos?: FormData,
  ): Promise<
    CustodyActionResult<ReceiveEquipmentActionData> | ActionPermissionError
  > => {
    const { knex } = await createTenantKnex();
    let parsed: ReceiveEquipmentInput | null = null;
    // Only IDs returned by uploads in this invocation are eligible for cleanup.
    const documentIds: string[] = [];
    const cleanup = async () => {
      const failures: string[] = [];
      for (const documentId of documentIds) {
        try {
          const deletion = await deleteDocument(documentId, user.user_id);
          if (!deletion.success) failures.push(documentId);
        } catch (error) {
          console.error('Failed to remove intake photo:', error);
          failures.push(documentId);
        }
      }
      if (failures.length) throw new Error('Failed to clean up one or more intake photos. Contact an administrator.');
    };

    if (
      !(await hasPermission(user, "ticket", "read")) ||
      !(await hasPermission(user, "asset", "update")) ||
      ((input as any)?.new_asset &&
        !(await hasPermission(user, "asset", "create")))
    ) {
      await cleanup();
      return permissionError(
        "Permission denied: Cannot receive equipment",
      ) as ActionPermissionError;
    }

    let result: CustodyActionResult<ReceiveEquipmentActionData>;
    try {
      result = await toCustodyResult(async () => {
        parsed = receiveEquipmentInputSchema.parse(input);
        if (parsed.document_ids.length) {
          throw new CustodyError('permission_denied', 'Existing documents cannot be submitted as intake photos.');
        }
        const files = photos?.getAll('photos') ?? [];
        if (files.length && !await hasPermission(user, 'document', 'read')) {
          throw new CustodyError('permission_denied', 'Permission denied: Cannot read documents.');
        }
        if (files.length && user.user_type === 'client') {
          throw new CustodyError('permission_denied', 'Only internal users can upload custody photos.');
        }
        if (files.some((file) => typeof file === 'string' || !file.type.startsWith('image/')) || !custodyPhotosWithinLimit(files.filter((file): file is File => typeof file !== 'string'))) {
          throw new CustodyError('permission_denied', 'Choose up to 20 image files totalling no more than 10 MB.');
        }
        try {
          await authorizeTicketRecordAccess({
            trx: knex,
            tenant,
            user,
            ticketId: parsed.ticket_id,
            action: "read",
          });
        } catch {
          throw new CustodyError("ticket_not_found", "Ticket not found.");
        }
        for (const file of files) {
          const form = new FormData();
          form.append('file', file);
          const uploaded = await uploadDocument(form, { userId: '', ticketId: parsed.ticket_id, isClientVisible: false });
          if ('permissionError' in uploaded) throw new CustodyError('permission_denied', String(uploaded.permissionError));
          if (!uploaded.success) throw new CustodyError('permission_denied', uploaded.error);
          documentIds.push(uploaded.document.document_id);
        }
        parsed.document_ids = documentIds;
        const r = await receiveEquipmentService(
          knex,
          tenant,
          user as any,
          parsed,
        );
        return {
          asset: r.asset as ReceiveEquipmentActionData["asset"],
          createdAsset: r.createdAsset,
          custody: r.custody,
          event: r.event,
        };
      });
    } catch (error) {
      await cleanup();
      throw error;
    }
    if (!result.success) await cleanup();
    return result;
  },
);
