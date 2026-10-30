/**
 * Display/selection identity for a row in the unified ticket list.
 *
 * The native list and the qualified co-managed queue share a table frame but
 * not a record model. A shared (customer-owned) ticket has its own tenant,
 * relationship and ticket id; it must never be cast to `ITicketListItem` or fed
 * into a local-ID metadata loader, tag loader, avatar resolver or mutation
 * route. This union is the seam: the table, selection, request caches and
 * automation ids key off the identity, and navigation dispatches on its kind.
 */

export type TicketListIdentity =
  | { kind: 'native'; tenant: string; ticketId: string }
  | { kind: 'shared'; tenant: string; relationshipId: string; ticketId: string };

export interface TicketListIdentitySource {
  tenant: string;
  relationshipId?: string | null;
  ticketId: string;
}

export function nativeTicketListIdentity(tenant: string, ticketId: string): TicketListIdentity {
  return { kind: 'native', tenant, ticketId };
}

export function sharedTicketListIdentity(
  tenant: string,
  relationshipId: string,
  ticketId: string,
): TicketListIdentity {
  return { kind: 'shared', tenant, relationshipId, ticketId };
}

/**
 * Build the identity for a qualified queue row. A row without a relationship is
 * a native MSP ticket surfaced by the combined reader; one with a relationship
 * is shared work.
 */
export function ticketListIdentityFromQueueItem(item: TicketListIdentitySource): TicketListIdentity {
  return item.relationshipId
    ? sharedTicketListIdentity(item.tenant, item.relationshipId, item.ticketId)
    : nativeTicketListIdentity(item.tenant, item.ticketId);
}

export function isSharedTicketListIdentity(identity: TicketListIdentity): identity is Extract<TicketListIdentity, { kind: 'shared' }> {
  return identity.kind === 'shared';
}

/**
 * Deterministic, collision-safe key for table `id`, selection sets, request
 * caches and automation ids. Lower-cased so a duplicate UUID in a different
 * case cannot create two rows for one record.
 */
export function ticketListIdentityKey(identity: TicketListIdentity): string {
  if (identity.kind === 'shared') {
    return `shared|${identity.tenant.toLowerCase()}|${identity.relationshipId.toLowerCase()}|${identity.ticketId.toLowerCase()}`;
  }
  return `native|${identity.tenant.toLowerCase()}|${identity.ticketId.toLowerCase()}`;
}

/**
 * The existing detail route for an identity.
 *
 * Native rows keep the routed MSP ticket detail. Shared rows use the existing
 * MSP-shell co-management detail route. Both stay inside the MSP shell and
 * continue under ordinary authorization; this is navigation, not a permission
 * decision. Callers append a validated list-return target when they have one.
 */
export function ticketListDetailHref(identity: TicketListIdentity): string {
  if (identity.kind === 'shared') {
    return `/msp/co-management/tickets/${encodeURIComponent(identity.tenant)}/${encodeURIComponent(identity.relationshipId)}/${encodeURIComponent(identity.ticketId)}`;
  }
  return `/msp/tickets/${encodeURIComponent(identity.ticketId)}`;
}

/** True when a qualified row may enter the shared handback flow. */
/**
 * Whether a qualified row may be handed back: it is shared work, the MSP holds
 * it, and we know the revision to write against.
 *
 * `responsibility` and `work_revision` are read from `fields`, which is where
 * `CoManagedTicketQueueItem` actually carries them. This predicate previously
 * read them from the top level, and because the parameter type made them
 * optional, every production caller passing a real queue item typechecked and
 * silently evaluated `undefined === 'msp'` -> false. Nothing was ever eligible:
 * the qualified list's selection column offered no rows and the single handback
 * composer never rendered. The only unit test passed a hand-written FLAT object,
 * so it agreed with the bug rather than catching it.
 *
 * The parameter type is therefore the real shape, not a permissive structural
 * one, so a flat object is a type error rather than a silent false.
 */
export function isQualifiedHandbackEligible(item: {
  relationshipId?: string | null;
  fields?: { responsibility?: string | null; work_revision?: number | null } | null;
}): boolean {
  return Boolean(item.relationshipId)
    && item.fields?.responsibility === 'msp'
    && typeof item.fields?.work_revision === 'number';
}
