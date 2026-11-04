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

/** Paths whose values are tag definition ids, and so can be checked against a universe. */
export const TICKET_TAG_PATHS = ['tags', 'contact.tags', 'client.tags'] as const;

export interface SanitizedTicketWhere {
  where?: PredicateGroup;
  /** Clauses removed because they were malformed or referenced a deleted tag. */
  dropped: { field: string; count: number }[];
}

/**
 * Read-side counterpart of `ticketWhereSchema`: keeps the clauses that are valid and, where a
 * universe of tag definition ids is known for a tag path, drops the ids that no longer exist (a
 * clause left with no ids goes). An absent universe means "cannot validate", never "drop".
 */
export function sanitizeTicketWhere(
  raw: unknown,
  knownTagIds?: Partial<Record<(typeof TICKET_TAG_PATHS)[number], ReadonlySet<string>>>,
): SanitizedTicketWhere {
  const dropped = new Map<string, number>();
  const note = (field: string, count = 1) => dropped.set(field, (dropped.get(field) ?? 0) + count);
  const rawClauses = (raw as { join?: unknown; clauses?: unknown } | null | undefined)?.clauses;
  if (!raw || typeof raw !== 'object' || !Array.isArray(rawClauses)) {
    if (raw !== undefined && raw !== null) note('where');
    return { dropped: [...dropped].map(([field, count]) => ({ field, count })) };
  }

  const kept: PredicateClause[] = [];
  for (const candidate of rawClauses.slice(0, TICKET_WHERE_MAX_CLAUSES)) {
    const parsed = predicateClauseSchema.safeParse(candidate);
    if (!parsed.success || validateClause(ticketQuerySchema, parsed.data)) {
      note('where');
      continue;
    }
    const clause = parsed.data;
    const universe = knownTagIds?.[clause.path as (typeof TICKET_TAG_PATHS)[number]];
    if (universe && Array.isArray(clause.value) && (clause.operator === 'in' || clause.operator === 'not_in')) {
      const ids = clause.value.filter((id) => typeof id === 'string' && universe.has(id));
      const removed = clause.value.length - ids.length;
      if (removed > 0) note(clause.path, removed);
      if (ids.length === 0) continue;
      kept.push({ ...clause, value: ids });
      continue;
    }
    kept.push(clause);
  }
  note('where', Math.max(0, rawClauses.length - TICKET_WHERE_MAX_CLAUSES));
  const droppedList = [...dropped].filter(([, c]) => c > 0).map(([field, count]) => ({ field, count }));
  return kept.length > 0
    ? { where: { join: 'and', clauses: kept }, dropped: droppedList }
    : { dropped: droppedList };
}
