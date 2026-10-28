"use server";

import { withAuth, hasPermission } from "@alga-psa/auth";
import { createTenantKnex } from "@alga-psa/db";
import { authorizeTicketRecordAccess } from "@alga-psa/tickets/lib/ticketRecordAuthorization";
import {
  addExternalLink, getTicketExternalLinks, removeExternalLink, updateExternalLink,
} from "@alga-psa/tickets/actions/externalLinks/externalLinkActions";
import { openWarrantyClaim } from "@alga-psa/inventory/actions/rmaWarrantyActions";
import { getRmaCase } from "@alga-psa/inventory/actions/rmaActions";
import { actionError, permissionError, type ActionMessageError, type ActionPermissionError } from "@alga-psa/ui/lib/errorHandling";
import {
  customExternalSystemToDefinition, isCustomExternalSystemKey, recordUrl, renderExternalLinkUrl,
  type IRmaCase, type ITenantExternalSystem,
} from "@alga-psa/types";

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
  async (user, { tenant }, rmaId: string, systemKey?: string): Promise<{ link_id: string } | RmaTicketError> => {
    const rma = await getRmaCase(rmaId);
    if (!rma || "actionError" in rma || "permissionError" in rma) {
      return (rma as RmaTicketError | null) ?? actionError("RMA case not found.", "features/inventory:errors.rma.caseNotFound");
    }
    if (!rma.ticket_id) return actionError("This RMA is not linked to a ticket.", "features/inventory:errors.rma.noTicket");
    if (!rma.rma_reference) {
      return actionError("Add the vendor's case number first.", "features/inventory:errors.rma.referenceRequired");
    }
    // The explicit-URL fallback (and the `generic` system) needs an absolute http(s) url; C1's recordUrl gives the RMA record's.
    const baseUrl = process.env.NEXTAUTH_URL;
    if (!baseUrl) return actionError("The application URL is not configured.", "features/inventory:errors.rma.baseUrlMissing");
    const recordLink = recordUrl("rma", rma.rma_id, baseUrl);

    // No system chosen: the built-in `generic` system with the RMA record URL. A chosen system must be one of
    // this tenant's `custom:<slug>` rows (a row existing is what "active" means; deleting it deactivates it).
    let system = "generic";
    let url = recordLink;
    if (systemKey !== undefined && systemKey !== null && systemKey !== "") {
      const notFound = () => actionError("That vendor-case system is not available.", "features/inventory:errors.rma.vendorSystemNotFound");
      if (!isCustomExternalSystemKey(systemKey)) return notFound();
      const { knex } = await createTenantKnex();
      const row = (await knex("tenant_external_systems").where({ tenant, key: systemKey }).first()) as ITenantExternalSystem | undefined;
      const definition = row ? customExternalSystemToDefinition(row) : null;
      if (!definition) return notFound();
      system = definition.key;
      if (definition.urlTemplate) {
        // Only {external_id} is available; no realm exists for an RMA, so a {realm} template cannot render.
        const rendered = definition.urlTemplate.includes("{realm}")
          ? null
          : renderExternalLinkUrl(definition, { external_id: rma.rma_reference, realm: null, url: null });
        if (!rendered) {
          return actionError("That system's link template can't be used for a vendor case.", "features/inventory:errors.rma.vendorSystemTemplateInvalid");
        }
        url = rendered;
      }
      // A null url_template keeps the explicit RMA record URL: the store requires some URL for such a system.
    }
    const fields = {
      external_status: rma.status,
      metadata: { source: "rma", rma_id: rma.rma_id, rma_number: rma.rma_number, vendor_name: rma.vendor_name ?? null },
    };

    // Upsert keyed by (ticket, metadata.rma_id) regardless of system: clicking twice refreshes the one link instead
    // of adding another, and switching system replaces it.
    const links = await getTicketExternalLinks(rma.ticket_id);
    if (!Array.isArray(links)) return asError(links, "Could not read the ticket's links.");
    const existing = links.find((l) => (l.metadata as { rma_id?: string } | null)?.rma_id === rma.rma_id);
    if (existing && existing.system === system && existing.external_id === rma.rma_reference) {
      const updated = await updateExternalLink(existing.link_id, { url, ...fields });
      return "link_id" in (updated as object) ? { link_id: existing.link_id } : asError(updated, "Could not update the link.");
    }
    // The system or the vendor case number changed (neither is patchable): replace the stale link.
    if (existing) {
      const removed = await removeExternalLink(existing.link_id);
      if (!("link_id" in (removed as object))) return asError(removed, "Could not replace the link.");
    }
    const result = await addExternalLink({
      ticket_id: rma.ticket_id,
      system,
      external_id: rma.rma_reference,
      relationship: "reference",
      url,
      ...fields,
    });
    return "link_id" in (result as object) ? { link_id: (result as { link_id: string }).link_id } : asError(result, "Could not add the link.");
  },
);

/**
 * The vendor-case system currently mirrored to this RMA's ticket, if any (`''` for the generic link, `null`
 * when nothing has been mirrored yet). Lets the picker reopen on the system actually in use instead of
 * resetting to generic, without guessing: it reads the same link `mirrorRmaToTicketLinks` writes.
 */
export const getMirroredVendorCaseSystem = withAuth(
  async (_user, _ctx, rmaId: string): Promise<string | null | RmaTicketError> => {
    const rma = await getRmaCase(rmaId);
    if (!rma || "actionError" in rma || "permissionError" in rma) {
      return (rma as RmaTicketError | null) ?? actionError("RMA case not found.", "features/inventory:errors.rma.caseNotFound");
    }
    if (!rma.ticket_id) return null;
    const links = await getTicketExternalLinks(rma.ticket_id);
    if (!Array.isArray(links)) return asError(links, "Could not read the ticket's links.");
    const existing = links.find((l) => (l.metadata as { rma_id?: string } | null)?.rma_id === rma.rma_id);
    if (!existing) return null;
    return existing.system === "generic" ? "" : existing.system;
  },
);

export interface RmaVendorCaseSystem { key: string; label: string }

/** The tenant's custom external systems, offered as targets for "Mirror vendor case to ticket". */
export const listRmaVendorCaseSystems = withAuth(
  async (user, { tenant }): Promise<RmaVendorCaseSystem[]> => {
    if (!(await hasPermission(user, "ticket", "update"))) return [];
    const { knex } = await createTenantKnex();
    const rows = (await knex("tenant_external_systems").where({ tenant }).orderBy("label")) as ITenantExternalSystem[];
    return rows.map((r) => ({ key: r.key, label: r.label }));
  },
);

function asError(value: unknown, fallback: string): RmaTicketError {
  const err = value as { actionError?: string; permissionError?: string; messageKey?: string };
  return err.permissionError
    ? (permissionError(err.permissionError) as ActionPermissionError)
    : actionError(err.actionError ?? fallback, err.messageKey);
}
