import { z } from 'zod';
import { isPredicateGroup, predicateClauseSchema, validateClause } from '@alga-psa/predicates';
import type { PredicateClause, PredicateGroup } from '@alga-psa/predicates';
import { ticketQuerySchema } from './ticketQuerySchema';

/** Wire/storage shape of `ITicketListFilters.where`: a flat `and` group of clauses on known paths. */
export const TICKET_WHERE_MAX_CLAUSES = 50;

/**
 * Ticket `where` is one flat `and` group in storage, URLs and the toolbar. The predicate model
 * allows nesting and `or`; ticket storage does not until a schema-version bump says so.
 */
export const ticketWhereSchema: z.ZodType<PredicateGroup> = z
  .object({
    join: z.literal('and'),
    clauses: z.array(predicateClauseSchema).max(TICKET_WHERE_MAX_CLAUSES),
  })
  .strict()
  .superRefine((group, ctx) => {
    group.clauses.forEach((clause, index) => {
      const issue = validateClause(ticketQuerySchema, clause);
      if (issue) ctx.addIssue({ code: 'custom', path: ['clauses', index], message: issue.message });
    });
  }) as z.ZodType<PredicateGroup>;

export const emptyTicketWhere = (): PredicateGroup => ({ join: 'and', clauses: [] });

/** The clauses of a flat group (nested groups never occur after `ticketWhereSchema`). */
export const ticketWhereClauses = (where: PredicateGroup | undefined): PredicateClause[] =>
  (where?.clauses ?? []).filter((node): node is PredicateClause => !isPredicateGroup(node));
