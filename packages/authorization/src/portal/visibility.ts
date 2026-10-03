import type { Knex } from 'knex';

// ---------------------------------------------------------------------------
// Client-portal visibility: the single definition of "what may this portal
// contact read".
//
// The resolver (visibility.server.ts) turns a contact into a
// ContactVisibilityContext. The predicates below turn that context into either
// a SQL restriction (applyTicketVisibilityFilter) or an in-memory decision
// (ticketMatchesVisibility). The two facets live side by side, and the kernel's
// `contact_visibility` template calls them, so the portal list, the REST API
// and the kernel paths cannot drift apart.
//
// Every grant is optional on the context and every adapter column is optional
// on the call: a producer or call site that has not been taught about a grant
// *narrows* visibility, it never widens it.
// ---------------------------------------------------------------------------

export type PortalVisibilityScope = 'client' | 'contact';

/** The part of the context the ticket predicates need. */
export interface TicketVisibilityScope {
  effectiveTicketScope: PortalVisibilityScope;
  contactId: string;
  clientId: string;
  /** null = every board of the tenant that the portal exposes. */
  visibleBoardIds: string[] | null;
  /**
   * Billing profiles this contact may see *every* ticket of, from
   * `billing_profile_contacts.can_view_profile_tickets`. Empty for almost
   * everyone: it is an explicit per-contact grant, not something a manager
   * designation confers. Only consulted under contact scope.
   */
  grantedTicketProfileIds?: string[];
  /**
   * The contact's client's default billing profile. A ticket with no profile
   * of its own belongs to it by the attribution chain, so granting the default
   * has to also reveal the NULLs — otherwise a manager of the only profile a
   * client has would see nothing.
   */
  defaultBillingProfileId?: string | null;
  /**
   * The contact plus everyone who reports to them, directly or indirectly
   * (`contacts.manager_contact_id`). Only populated under contact scope. When
   * absent the contact sees only their own records.
   */
  visibleContactIds?: string[];
  /**
   * Contact-scoped users can read tickets they actively watch. Only takes
   * effect when the call site also supplies `watchListColumn`.
   */
  watchGrant?: boolean;
}

export interface ContactVisibilityContext extends TicketVisibilityScope {
  ticketScope: PortalVisibilityScope;
  isClientAdmin: boolean;
  visibilityGroupId: string | null;
}

export const VISIBILITY_GROUP_MISMATCH_ERROR =
  'Assigned visibility group does not match contact client';
export const VISIBILITY_GROUP_MISSING_ERROR =
  'Assigned visibility group is missing or inaccessible';

/** A ticket as the in-memory predicate sees it. Missing fields never widen. */
export interface TicketVisibilityRecord {
  clientId?: string | null;
  boardId?: string | null;
  contactId?: string | null;
  /**
   * `undefined` = the caller did not load the column (profile grants cannot
   * match); `null` = the ticket has no profile of its own.
   */
  billingProfileId?: string | null;
  /** Contact ids of the ticket's *active* contact watch-list entries. */
  watcherContactIds?: string[];
}

export interface TicketVisibilityColumns {
  boardColumn: string;
  contactColumn: string;
  billingProfileColumn?: string;
  /**
   * The JSONB `attributes` column of the ticket; the watch list is its
   * `watch_list` array (see shared/lib/tickets/watchList.ts).
   */
  watchListColumn?: string;
}

/** The ids whose records this contact may see: always includes the contact. */
export function resolveVisibleContactIds(scope: {
  contactId: string;
  visibleContactIds?: string[];
}): string[] {
  const ids = new Set<string>([scope.contactId]);
  for (const id of scope.visibleContactIds ?? []) {
    if (typeof id === 'string' && id.length > 0) ids.add(id);
  }
  return Array.from(ids);
}

function profileGrantShape(scope: TicketVisibilityScope): {
  grantedProfileIds: string[];
  includesUnattributed: boolean;
} {
  const grantedProfileIds = scope.grantedTicketProfileIds ?? [];
  const defaultProfileId = scope.defaultBillingProfileId ?? null;
  return {
    grantedProfileIds,
    includesUnattributed: defaultProfileId !== null && grantedProfileIds.includes(defaultProfileId),
  };
}

function assertValidTicketScope(scope: TicketVisibilityScope): void {
  if (scope.effectiveTicketScope !== 'client' && scope.effectiveTicketScope !== 'contact') {
    throw new Error('Ticket visibility context has an invalid effective scope');
  }
  if (scope.effectiveTicketScope === 'contact' && !scope.contactId) {
    throw new Error('Contact-scoped ticket visibility requires a contact');
  }
}

/** Ticket authorization only; board discovery for creation has no contact predicate. */
export function applyTicketVisibilityFilter(
  query: Knex.QueryBuilder,
  visibility: TicketVisibilityScope,
  { boardColumn, contactColumn, billingProfileColumn, watchListColumn }: TicketVisibilityColumns
): Knex.QueryBuilder {
  assertValidTicketScope(visibility);
  const { visibleBoardIds } = visibility;
  if (visibleBoardIds !== null) {
    if (visibleBoardIds.length === 0) {
      query.whereRaw('1 = 0');
      return query;
    }
    query.whereIn(boardColumn, visibleBoardIds);
  }

  if (visibility.effectiveTicketScope === 'contact') {
    const contactIds = resolveVisibleContactIds(visibility);
    const { grantedProfileIds, includesUnattributed } = profileGrantShape(visibility);
    // Omitting an adapter column *narrows*: a call site that has not been
    // taught about profiles or watchers cannot accidentally widen what a
    // portal user reads.
    const useProfiles = Boolean(billingProfileColumn) && grantedProfileIds.length > 0;
    const useWatch = Boolean(watchListColumn) && visibility.watchGrant === true;

    if (!useProfiles && !useWatch) {
      // Draft OQ1 policy: NULL contacts do not satisfy equality. Admins resolve
      // to client scope, while retaining the same board restriction above.
      if (contactIds.length === 1) {
        query.where(contactColumn, contactIds[0]);
      } else {
        query.whereIn(contactColumn, contactIds);
      }
      return query;
    }

    query.where((builder: Knex.QueryBuilder) => {
      if (contactIds.length === 1) {
        builder.where(contactColumn, contactIds[0]);
      } else {
        builder.whereIn(contactColumn, contactIds);
      }
      if (useProfiles) {
        builder.orWhereIn(billingProfileColumn as string, grantedProfileIds);
        if (includesUnattributed) {
          builder.orWhereNull(billingProfileColumn as string);
        }
      }
      if (useWatch) {
        builder.orWhereRaw("(?? -> 'watch_list') @> ?::jsonb", [
          watchListColumn as string,
          JSON.stringify([{ entity_type: 'contact', entity_id: visibility.contactId, active: true }]),
        ]);
      }
    });
  }
  return query;
}

/**
 * In-memory equivalent of `applyTicketVisibilityFilter`, plus the client
 * restriction every SQL call site applies separately (`client_id = ...`).
 * Never throws: an unusable context simply matches nothing.
 */
export function ticketMatchesVisibility(
  record: TicketVisibilityRecord | null | undefined,
  scope: TicketVisibilityScope | null | undefined
): boolean {
  if (!record || !scope || !scope.clientId) return false;
  if (record.clientId !== scope.clientId) return false;

  const { visibleBoardIds } = scope;
  if (visibleBoardIds !== null && !(record.boardId && visibleBoardIds.includes(record.boardId))) {
    return false;
  }

  if (scope.effectiveTicketScope === 'client') return true;
  if (scope.effectiveTicketScope !== 'contact' || !scope.contactId) return false;

  if (record.contactId && resolveVisibleContactIds(scope).includes(record.contactId)) {
    return true;
  }

  const { grantedProfileIds, includesUnattributed } = profileGrantShape(scope);
  if (grantedProfileIds.length > 0 && record.billingProfileId !== undefined) {
    if (record.billingProfileId === null ? includesUnattributed : grantedProfileIds.includes(record.billingProfileId)) {
      return true;
    }
  }

  if (scope.watchGrant === true && record.watcherContactIds?.includes(scope.contactId)) {
    return true;
  }
  return false;
}

/**
 * Contact ids of the *active* contact entries on a ticket's `attributes`
 * (`attributes.watch_list`). Matches on the resolved `entity_id` only, never on
 * email; the SQL predicate matches the same shape.
 */
export function extractActiveWatcherContactIds(attributes: unknown): string[] {
  if (!attributes || typeof attributes !== 'object') return [];
  const watchList = (attributes as Record<string, unknown>).watch_list;
  if (!Array.isArray(watchList)) return [];
  const ids = new Set<string>();
  for (const entry of watchList) {
    if (!entry || typeof entry !== 'object') continue;
    const { entity_type, entity_id, active } = entry as Record<string, unknown>;
    if (entity_type === 'contact' && active === true && typeof entity_id === 'string' && entity_id) {
      ids.add(entity_id);
    }
  }
  return Array.from(ids);
}
