import type { PredicateGroup } from '@alga-psa/predicates';
import { ticketWhereClauses } from './ticketWhere';
import type { TicketResponsibility } from './ticketResponsibility';

/**
 * The responsibility filter is a `where` clause on the ticket query schema's `seat_responsibility`
 * path (the one definition of what responsibility means; see shared/lib/ticketQuery). The toolbar
 * reads and writes that one clause and leaves every other clause alone.
 */
export const SEAT_RESPONSIBILITY_PATH = 'seat_responsibility';

export function getSeatResponsibilityFilter(where: PredicateGroup | undefined): TicketResponsibility | null {
  const clause = ticketWhereClauses(where).find((c) => c.path === SEAT_RESPONSIBILITY_PATH && c.operator === 'equals');
  return clause?.value === 'client_it' || clause?.value === 'msp' ? clause.value : null;
}

export function setSeatResponsibilityFilter(
  where: PredicateGroup | undefined,
  value: TicketResponsibility | null,
): PredicateGroup | undefined {
  const others = ticketWhereClauses(where).filter((c) => c.path !== SEAT_RESPONSIBILITY_PATH);
  const next = value ? [...others, { path: SEAT_RESPONSIBILITY_PATH, operator: 'equals' as const, value }] : others;
  return next.length > 0 ? { join: 'and', clauses: next } : undefined;
}
