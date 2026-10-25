"use server";

import { withAuth, hasPermission } from "@alga-psa/auth";
import { createTenantKnex } from "@alga-psa/db";
import { authorizeTicketRecordAccess } from "@alga-psa/tickets/lib/ticketRecordAuthorization";
import { addExternalLink } from "@alga-psa/tickets/actions/externalLinks/externalLinkActions";
import { openWarrantyClaim, getRmaCase } from "@alga-psa/inventory/actions";
import { actionError, permissionError, type ActionMessageError, type ActionPermissionError } from "@alga-psa/ui/lib/errorHandling";
import type { IRmaCase } from "@alga-psa/types";

/**
 * Ticket-aware wrappers for warranty claims (alga-2026-0002683 C5).
 *
 * Lives in the composition layer for the same reason as `receiveEquipment`: the ticket record check needs
 * `@alga-psa/tickets`, which depends on inventory, so inventory cannot import it. The warranty actions in
 * inventory stay ticket-agnostic; this layer checks that the caller may see the ticket before a claim is tied to it.
 */
type RmaTicketError = ActionMessageError | ActionPermissionError;

/** Open a claim from a ticket. `ticket:read` plus the ticket record check, then the normal warranty permissions. */
export const openWarrantyClaimFromTicket = withAuth(
  async (user, { tenant }, input: { ticket_id: string } & Record<string, unknown>): Promise<IRmaCase | RmaTicketError> => {
    if (!(await hasPermission(user, "ticket", "read"))) {
      return permissionError("Permission denied: Cannot read tickets") as ActionPermissionError;
    }
    const { knex } = await createTenantKnex();
    try {
      await authorizeTicketRecordAccess({ trx: knex, tenant, user, ticketId: input.ticket_id, action: "read" });
    } catch {
      return actionError("Ticket not found.", "features/inventory:errors.rma.ticketNotFound");
    }
    return openWarrantyClaim(input) as Promise<IRmaCase | RmaTicketError>;
  },
);

/**
 * Mirror the RMA's vendor case onto its ticket as an external link (reference). An explicit action, not an
 * automatic copy: `rma_reference` stays the source of truth and the link only snapshots it.
 */
// LEVERAGE: friction rma-vendor-case-link — there is no "link this record to a ticket" primitive; a vendor
// case is mirrored as a generic external link whose metadata carries the rma_id. A first-class linked-record
// table (or the ticket-conversations vendor thread) would replace this.
export const mirrorRmaToTicketLinks = withAuth(
  async (user, _ctx, rmaId: string): Promise<{ link_id: string } | RmaTicketError> => {
    const rma = await getRmaCase(rmaId);
    if (!rma || "actionError" in rma || "permissionError" in rma) {
      return (rma as RmaTicketError | null) ?? actionError("RMA case not found.", "features/inventory:errors.rma.caseNotFound");
    }
    if (!rma.ticket_id) return actionError("This RMA is not linked to a ticket.", "features/inventory:errors.rma.noTicket");
    if (!rma.rma_reference) {
      return actionError("Add the vendor's case number first.", "features/inventory:errors.rma.referenceRequired");
    }
    const result = await addExternalLink({
      ticket_id: rma.ticket_id,
      system: "generic",
      external_id: rma.rma_reference,
      relationship: "reference",
      external_status: rma.status,
      metadata: { source: "rma", rma_id: rma.rma_id, rma_number: rma.rma_number, vendor_name: rma.vendor_name ?? null },
    });
    if ("link_id" in (result as object)) return { link_id: (result as { link_id: string }).link_id };
    const err = result as { actionError?: string; permissionError?: string; messageKey?: string };
    return err.permissionError
      ? (permissionError(err.permissionError) as ActionPermissionError)
      : actionError(err.actionError ?? "Could not add the link.", err.messageKey);
  },
);
