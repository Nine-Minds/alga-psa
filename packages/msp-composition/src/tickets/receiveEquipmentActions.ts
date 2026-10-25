"use server";

import { withAuth, hasPermission } from "@alga-psa/auth";
import { createTenantKnex } from "@alga-psa/db";
import { deleteDocument } from "@alga-psa/documents/actions/documentActions";
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
 * Photos are uploaded by the dialog BEFORE this call (client-hidden documents). When the receive fails,
 * the documents passed in are deleted so no orphans remain.
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
  ): Promise<
    CustodyActionResult<ReceiveEquipmentActionData> | ActionPermissionError
  > => {
    const { knex } = await createTenantKnex();
    let parsed: ReceiveEquipmentInput | null = null;
    const documentIds: string[] = Array.isArray((input as any)?.document_ids)
      ? (input as any).document_ids
      : [];

    const cleanup = async () => {
      for (const documentId of documentIds) {
        try {
          await deleteDocument(documentId, user.user_id);
        } catch (error) {
          console.error(
            `Failed to remove intake photo ${documentId} after a failed receive:`,
            error,
          );
        }
      }
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
