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
 * The asset whose billing profile the new ticket inherits, or null when there
 * is nothing unambiguous to inherit.
 *
 * Exactly one asset behaves like the from-asset dialog: the ticket takes that
 * asset's profile (or its location's default). With several assets there is no
 * single right answer, so billing_profile_id is left to the normal client
 * default rather than picking one device's profile arbitrarily.
 */
export function assetIdForBillingProfileInheritance(assetIds: readonly string[]): string | null {
  return assetIds.length === 1 ? assetIds[0] : null;
}
