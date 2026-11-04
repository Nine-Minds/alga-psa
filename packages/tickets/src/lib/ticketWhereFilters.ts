import type { PredicateClause, PredicateGroup } from '@alga-psa/predicates';
import { ticketWhereClauses } from './ticketWhere';

/**
 * Toolbar descriptors for filters that live only in `ITicketListFilters.where`. One row per filter:
 * the toolbar control, the active-filter chips and the chip's individual clear are all derived from
 * this table, so a new `where` filter is a new row (plus its options source), not new bespoke wiring.
 */
export type WhereTagMode = 'in' | 'not_in';

export interface WhereTagFilterDescriptor {
  /** Path in the ticket query schema. */
  path: 'contact.tags' | 'client.tags';
  /** Which tag definitions the control offers. */
  taggedType: 'contact' | 'client';
  labelKey: string;
  defaultLabel: string;
}

export const WHERE_TAG_FILTERS: readonly WhereTagFilterDescriptor[] = [
  { path: 'contact.tags', taggedType: 'contact', labelKey: 'filters.requesterTags', defaultLabel: 'Requester tags' },
  { path: 'client.tags', taggedType: 'client', labelKey: 'filters.clientTags', defaultLabel: 'Client tags' },
];

export interface WhereTagSelection {
  mode: WhereTagMode;
  /** Tag definition ids. */
  ids: string[];
}

const isTagClause = (clause: PredicateClause, path: string): boolean =>
  clause.path === path && (clause.operator === 'in' || clause.operator === 'not_in');

/** The current selection for a tag path, or null when the path has no (valid) clause. */
export function getWhereTagSelection(where: PredicateGroup | undefined, path: string): WhereTagSelection | null {
  const clause = ticketWhereClauses(where).find((c) => isTagClause(c, path));
  if (!clause || !Array.isArray(clause.value)) return null;
  const ids = clause.value.filter((v): v is string => typeof v === 'string');
  return ids.length > 0 ? { mode: clause.operator as WhereTagMode, ids } : null;
}

/**
 * Replaces the clause for `path` (any-of / none-of) and leaves every other clause untouched. An
 * empty selection removes the clause; an empty group becomes `undefined` so it leaves the URL.
 */
export function setWhereTagSelection(
  where: PredicateGroup | undefined,
  path: string,
  selection: WhereTagSelection | null,
): PredicateGroup | undefined {
  const others = ticketWhereClauses(where).filter((c) => !isTagClause(c, path));
  const next: PredicateClause[] =
    selection && selection.ids.length > 0
      ? [...others, { path, operator: selection.mode, value: [...new Set(selection.ids)] }]
      : others;
  return next.length > 0 ? { join: 'and', clauses: next } : undefined;
}

export interface WhereFilterChip {
  key: string;
  path: string;
  mode: WhereTagMode;
  tagId: string;
  label: string;
  /** The `where` after clearing just this chip. */
  clear: () => PredicateGroup | undefined;
}

/**
 * One chip per selected tag id for each tag descriptor. `tagLabel` resolves an id to the tag's text;
 * an id with no known definition falls back to the id so the chip can still be cleared.
 */
export function whereTagFilterChips(
  where: PredicateGroup | undefined,
  tagLabel: (descriptor: WhereTagFilterDescriptor, tagId: string) => string | undefined,
  labelFor: (descriptor: WhereTagFilterDescriptor) => string,
): WhereFilterChip[] {
  const chips: WhereFilterChip[] = [];
  for (const descriptor of WHERE_TAG_FILTERS) {
    const selection = getWhereTagSelection(where, descriptor.path);
    if (!selection) continue;
    const label = labelFor(descriptor);
    for (const tagId of selection.ids) {
      const text = tagLabel(descriptor, tagId) ?? tagId;
      chips.push({
        key: `where:${descriptor.path}:${selection.mode}:${tagId}`,
        path: descriptor.path,
        mode: selection.mode,
        tagId,
        label: `${label} ${selection.mode === 'in' ? '=' : '≠'} ${text}`,
        clear: () =>
          setWhereTagSelection(where, descriptor.path, {
            mode: selection.mode,
            ids: selection.ids.filter((id) => id !== tagId),
          }),
      });
    }
  }
  return chips;
}
