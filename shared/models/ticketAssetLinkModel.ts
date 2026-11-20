/**
 * The rules for the devices named when a ticket is created (alga-2026-0002785).
 *
 * Pure on purpose: the REST create (TicketService.createTicket), the web
 * QuickAddTicket server action (addTicket) and the mobile client all have to
 * agree about what a list of picked assets means, and the billing rule in
 * particular is easy to get subtly different in three places.
 */

/** Ignores blanks and repeats while keeping the order the caller picked. */
export function dedupeTicketAssetIds(assetIds: readonly (string | null | undefined)[] | null | undefined): string[] {
  if (!assetIds) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of assetIds) {
    const assetId = typeof raw === 'string' ? raw.trim() : '';
    if (!assetId || seen.has(assetId)) continue;
    seen.add(assetId);
    out.push(assetId);
  }
  return out;
}

/**
 * The asset whose billing profile the new ticket inherits, or null when no
 * asset was picked.
 *
 * The first picked asset lends its profile (or its location's default), exactly
 * as the from-asset dialog does — including when several devices are named: the
 * picker lists them in the order they were chosen, so the first is the device
 * the ticket was raised about. Ticket 2785 shipped this rule on the web create
 * first; REST and mobile read it from here so the three agree.
 */
export function assetIdForBillingProfileInheritance(assetIds: readonly string[]): string | null {
  return assetIds[0] ?? null;
}
