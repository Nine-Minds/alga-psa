import type { TicketListItem } from "../api/tickets";

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

/** Children lock status, priority and assignee; work happens on the master. */
export function isBundleChild(ticket: TicketBundleFields | null | undefined): boolean {
  return getTicketBundleRole(ticket) === "child";
}

export type BundleView = "bundled" | "individual";

export const DEFAULT_BUNDLE_VIEW: BundleView = "bundled";

export function normalizeBundleView(value: unknown): BundleView {
  return value === "individual" ? "individual" : DEFAULT_BUNDLE_VIEW;
}
