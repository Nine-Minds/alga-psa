import type { Knex } from 'knex';

export interface ContactVisibilityContext {
  ticketScope: 'client' | 'contact';
  effectiveTicketScope: 'client' | 'contact';
  isClientAdmin: boolean;
  contactId: string;
  clientId: string;
  visibilityGroupId: string | null;
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
}

export const VISIBILITY_GROUP_MISMATCH_ERROR =
  'Assigned visibility group does not match contact client';
export const VISIBILITY_GROUP_MISSING_ERROR =
  'Assigned visibility group is missing or inaccessible';

/** Ticket authorization only; board discovery for creation has no contact predicate. */
export function applyTicketVisibilityFilter(
  query: Knex.QueryBuilder,
  visibility: ContactVisibilityContext,
  {
    boardColumn,
    contactColumn,
    billingProfileColumn,
  }: { boardColumn: string; contactColumn: string; billingProfileColumn?: string }
): Knex.QueryBuilder {
  if (visibility.effectiveTicketScope !== 'client' && visibility.effectiveTicketScope !== 'contact') {
    throw new Error('Ticket visibility context has an invalid effective scope');
  }
  if (visibility.effectiveTicketScope === 'contact' && !visibility.contactId) {
    throw new Error('Contact-scoped ticket visibility requires a contact');
  }
  const { visibleBoardIds } = visibility;
  if (visibleBoardIds !== null) {
    if (visibleBoardIds.length === 0) {
      query.whereRaw('1 = 0');
      return query;
    }
    query.whereIn(boardColumn, visibleBoardIds);
  }

  if (visibility.effectiveTicketScope === 'contact') {
    const grantedProfileIds = visibility.grantedTicketProfileIds ?? [];
    // Omitting billingProfileColumn *narrows* to own tickets, which is the safe
    // direction: a call site that has not been taught about profiles cannot
    // accidentally widen what a portal user reads.
    if (!billingProfileColumn || grantedProfileIds.length === 0) {
      // Draft OQ1 policy: NULL contacts do not satisfy equality. Admins resolve
      // to client scope, while retaining the same board restriction above.
      query.where(contactColumn, visibility.contactId);
      return query;
    }

    const defaultProfileId = visibility.defaultBillingProfileId ?? null;
    const includesUnattributed = defaultProfileId !== null && grantedProfileIds.includes(defaultProfileId);

    query.where((builder: Knex.QueryBuilder) => {
      builder.where(contactColumn, visibility.contactId);
      builder.orWhereIn(billingProfileColumn, grantedProfileIds);
      if (includesUnattributed) {
        builder.orWhereNull(billingProfileColumn);
      }
    });
  }
  return query;
}
