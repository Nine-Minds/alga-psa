import type { Knex } from 'knex';

export interface ContactVisibilityContext {
  ticketScope: 'client' | 'contact';
  effectiveTicketScope: 'client' | 'contact';
  isClientAdmin: boolean;
  contactId: string;
  clientId: string;
  visibilityGroupId: string | null;
  visibleBoardIds: string[] | null;
}

export const VISIBILITY_GROUP_MISMATCH_ERROR =
  'Assigned visibility group does not match contact client';
export const VISIBILITY_GROUP_MISSING_ERROR =
  'Assigned visibility group is missing or inaccessible';

/** Ticket authorization only; board discovery for creation has no contact predicate. */
export function applyTicketVisibilityFilter(
  query: Knex.QueryBuilder,
  visibility: ContactVisibilityContext,
  { boardColumn, contactColumn }: { boardColumn: string; contactColumn: string }
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
    // Draft OQ1 policy: NULL contacts do not satisfy equality. Admins resolve
    // to client scope, while retaining the same board restriction above.
    query.where(contactColumn, visibility.contactId);
  }
  return query;
}
