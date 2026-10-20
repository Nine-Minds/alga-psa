import type { TicketBundleView, TicketListItem } from "../api/tickets";
import { isChildWorkflowLocked } from "../../../../packages/tickets/src/lib/bundleWorkflowLock";

/**
 * Bundle role derived from the list/detail payload, so rows and the detail
 * header can render without a second request. Mirrors the web list's
 * "Bundled → master" and "Bundle · n" badges.
 */
export type TicketBundleRole = "child" | "master" | "standalone";

export type TicketBundleFields = Pick<TicketListItem, "master_ticket_id" | "bundle_master_ticket_number" | "bundle_child_count">;

export function getTicketBundleRole(ticket: TicketBundleFields | null | undefined): TicketBundleRole {
  if (!ticket) return "standalone";
  if (ticket.master_ticket_id) return "child";
  if ((ticket.bundle_child_count ?? 0) > 0) return "master";
  return "standalone";
}

/** Bundle membership only. Whether a child's fields are locked depends on the master's mode: see isBundleWorkflowLocked. */
export function isBundleChild(ticket: TicketBundleFields | null | undefined): boolean {
  return getTicketBundleRole(ticket) === "child";
}

/**
 * Same rule as the web ticket details: a child's status, priority and assignee
 * are locked only under a sync_updates master. The master's mode comes from the
 * bundle payload (`GET /tickets/{id}/bundle`), which can lag the ticket payload;
 * until it has loaded the mode is unknown, so a child stays locked rather than
 * briefly offering edits the server may reject.
 */
export function isBundleChildLocked(bundle: Pick<TicketBundleView, "settings"> | null | undefined): boolean {
  if (!bundle) return true;
  return isChildWorkflowLocked({ isBundledChild: true, masterSettings: bundle.settings });
}

export function isBundleWorkflowLocked(
  ticket: TicketBundleFields | null | undefined,
  bundle: Pick<TicketBundleView, "settings"> | null | undefined,
): boolean {
  return isBundleChild(ticket) && isBundleChildLocked(bundle);
}

export type BundleView = "bundled" | "individual";

export const DEFAULT_BUNDLE_VIEW: BundleView = "bundled";

export function normalizeBundleView(value: unknown): BundleView {
  return value === "individual" ? "individual" : DEFAULT_BUNDLE_VIEW;
}
